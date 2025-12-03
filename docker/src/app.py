import logging
import os
import threading
from typing import Any, Callable, Dict

import httpx
import structlog
from benchling_api_client.v2.stable.models.app_canvas_update import AppCanvasUpdate
from benchling_sdk.apps.helpers.webhook_helpers import jwks_by_app_definition, verify
from benchling_sdk.auth.client_credentials_oauth2 import ClientCredentialsOAuth2
from benchling_sdk.benchling import Benchling
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .canvas import CanvasManager
from .config import get_config
from .entry_packager import EntryPackager
from .payload import Payload
from .version import __version__

# Load environment variables
load_dotenv()

# Configure logging level from environment variable
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, log_level, logging.INFO))

# Configure structured logging
# Use human-friendly console output in development, JSON in production
use_json_logs = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).lower() == "production"

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer() if use_json_logs else structlog.dev.ConsoleRenderer(),
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

# Required webhook headers for HMAC verification
REQUIRED_WEBHOOK_HEADERS = ("webhook-id", "webhook-signature", "webhook-timestamp")


class WebhookVerificationError(Exception):
    """Raised when webhook signature verification fails."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


async def verify_webhook_signature(request: Request, config, jwks_fetcher: Callable[[str], Any]) -> None:
    """Verify Benchling webhook HMAC signature (defense-in-depth layer).

    This function implements webhook signature verification in the FastAPI application
    as a defense-in-depth security measure. While the Lambda authorizer provides the
    first line of defense, this application-layer verification:

    1. Guards against authorization bypass scenarios
    2. Provides detailed logging for security auditing
    3. Enables graceful degradation if authorizer is disabled
    4. Allows local testing without Lambda infrastructure

    Args:
        request: FastAPI request object containing headers and body
        config: Application configuration containing app_definition_id
        jwks_fetcher: Function to fetch JWKS keys (supports connection pooling)

    Raises:
        WebhookVerificationError: If signature verification fails or required headers are missing

    Environment Variables:
        ENABLE_WEBHOOK_VERIFICATION: Enable/disable verification (default: true)
    """
    # Check if verification is enabled
    if not config.enable_webhook_verification:
        logger.info(
            "Webhook verification disabled",
            path=request.url.path,
            verification_enabled=False,
        )
        return

    # Extract and normalize headers (case-insensitive)
    headers = {key.lower(): value for key, value in request.headers.items()}

    # Log incoming webhook details for security auditing
    webhook_id = headers.get("webhook-id", "unknown")
    logger.info(
        "Verifying webhook signature",
        path=request.url.path,
        webhook_id=webhook_id,
        has_app_definition_id=bool(config.benchling_app_definition_id),
        header_keys=list(headers.keys()),
    )

    # Validate required headers are present
    missing_headers = [h for h in REQUIRED_WEBHOOK_HEADERS if h not in headers]
    if missing_headers:
        error_msg = f"Missing required webhook headers: {', '.join(missing_headers)}"
        logger.warning(
            "Webhook verification failed - missing headers",
            webhook_id=webhook_id,
            missing_headers=missing_headers,
            path=request.url.path,
        )
        raise WebhookVerificationError("missing_headers", error_msg)

    # Validate app_definition_id is configured
    if not config.benchling_app_definition_id:
        error_msg = "app_definition_id not configured in Benchling secret"
        logger.error(
            "Webhook verification failed - missing app_definition_id",
            webhook_id=webhook_id,
            path=request.url.path,
        )
        raise WebhookVerificationError("missing_app_definition_id", error_msg)

    # Read request body (needed for HMAC computation)
    body = await request.body()
    body_str = body.decode("utf-8")

    # Log diagnostic information for troubleshooting
    logger.debug(
        "Webhook verification details",
        webhook_id=webhook_id,
        app_definition_id=config.benchling_app_definition_id,
        body_length=len(body_str),
        signature=headers.get("webhook-signature", "")[:20] + "...",  # Log first 20 chars
        timestamp=headers.get("webhook-timestamp"),
    )

    # Verify HMAC signature using Benchling SDK with custom JWKS fetcher
    try:
        verify(config.benchling_app_definition_id, body_str, headers, jwk_function=jwks_fetcher)  # type: ignore[arg-type]
    except Exception as exc:
        # Log detailed error for security auditing and troubleshooting
        logger.error(
            "Webhook signature verification failed",
            webhook_id=webhook_id,
            app_definition_id=config.benchling_app_definition_id,
            error=str(exc),
            error_type=type(exc).__name__,
            path=request.url.path,
            troubleshooting=(
                f"Ensure the webhook in Benchling is configured under app '{config.benchling_app_definition_id}'. "
                "Check that this matches the app_definition_id in your AWS Secrets Manager secret."
            ),
        )
        raise WebhookVerificationError(
            "invalid_signature",
            f"Webhook signature verification failed: {str(exc)}",
        ) from exc

    # Log successful verification for security auditing
    logger.info(
        "Webhook signature verified successfully",
        webhook_id=webhook_id,
        path=request.url.path,
    )


def create_app() -> FastAPI:
    app = FastAPI(title="Benchling Webhook", version=__version__)

    # Initialize configuration and clients
    try:
        config = get_config()

        # Create persistent HTTP client with connection pooling for JWKS fetches
        # This prevents the 40-second TCP connection delay on every webhook request
        jwks_http_client = httpx.Client(
            timeout=httpx.Timeout(30.0, connect=5.0),
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
        )
        logger.info(
            "Persistent HTTP client created for JWKS fetching",
            max_keepalive=10,
            max_connections=20,
            connect_timeout=5.0,
            total_timeout=30.0,
        )

        # Create custom JWKS fetcher that uses the persistent client with connection pooling
        def jwks_fetcher_with_pooling(app_definition_id: str) -> Any:
            """Fetch JWKS keys using persistent HTTP client with connection pooling."""
            return jwks_by_app_definition(app_definition_id, httpx_client=jwks_http_client)

        # Create a dependency factory for webhook verification that captures config and JWKS fetcher
        async def verify_webhook_dependency(request: Request) -> None:
            """FastAPI dependency for webhook signature verification."""
            await verify_webhook_signature(request, config, jwks_fetcher_with_pooling)

        logger.info("Python orchestration enabled")

        # Log IAM role configuration for cross-account S3 access
        if config.quilt_write_role_arn:
            logger.info(
                "IAM role ARN configured for cross-account S3 access",
                has_role=bool(config.quilt_write_role_arn),
                role_arn=config.quilt_write_role_arn,
            )
        else:
            logger.info(
                "No IAM role ARN configured - using direct ECS task role credentials",
                role_arn="not-configured",
            )

        # Initialize Benchling SDK with OAuth
        auth_method = ClientCredentialsOAuth2(
            client_id=config.benchling_client_id,
            client_secret=config.benchling_client_secret,
        )
        benchling = Benchling(url=f"https://{config.benchling_tenant}.benchling.com", auth_method=auth_method)

        entry_packager = EntryPackager(
            benchling=benchling,
            config=config,
        )

        # Validate role assumption at startup (blocking - fail fast)
        role_arn = getattr(config, "quilt_write_role_arn", None)
        if role_arn and isinstance(role_arn, str):
            logger.info("Validating IAM role assumption at startup")
            try:
                validation_results = entry_packager.role_manager.validate_roles()

                if validation_results["role"]["configured"]:
                    if validation_results["role"]["valid"]:
                        logger.info("Role validated successfully", role_arn=role_arn)
                    else:
                        logger.error(
                            "Role validation failed at startup - container cannot function correctly",
                            role_arn=role_arn,
                            error=validation_results["role"]["error"],
                        )
                        raise RuntimeError(f"IAM role validation failed: {validation_results['role']['error']}")
            except Exception as e:
                logger.error(
                    "Role validation failed at startup - failing container to prevent data misrouting",
                    error=str(e),
                    error_type=type(e).__name__,
                )
                raise

    except Exception as e:
        logger.error("Failed to initialize application", error=str(e))
        raise

    # ============================================================================
    # Health Endpoints - Support both direct paths and stage-prefixed paths
    # ============================================================================
    # Direct paths (for NLB health checks)
    # Stage-prefixed paths (for API Gateway requests via HTTP_PROXY)
    #
    # This dual-path approach maintains compatibility with:
    # 1. Direct health checks from NLB (no prefix)
    # 2. API Gateway requests with stage prefix (e.g., /prod/health)
    # 3. Future migration flexibility
    # ============================================================================

    async def _health_impl() -> Dict[str, Any]:
        """Shared health check implementation."""
        return {
            "status": "healthy",
            "service": "benchling-webhook",
            "version": __version__,
        }

    @app.get("/health")
    async def health() -> Dict[str, Any]:
        """Application health status - direct path."""
        return await _health_impl()

    @app.get("/{stage}/health")
    async def health_with_stage(stage: str) -> Dict[str, Any]:
        """Application health status - stage-prefixed path."""
        return await _health_impl()

    async def _readiness_impl():
        """Shared readiness probe implementation."""
        try:
            if not entry_packager:
                raise Exception("EntryPackager not initialized")
            return {
                "status": "ready",
                "orchestration": "python",
            }
        except Exception as e:
            logger.error("Readiness check failed", error=str(e))
            return JSONResponse({"status": "not ready", "error": str(e)}, status_code=503)

    @app.get("/health/ready")
    async def readiness():
        """Readiness probe for orchestration - direct path."""
        return await _readiness_impl()

    @app.get("/{stage}/health/ready")
    async def readiness_with_stage(stage: str):
        """Readiness probe for orchestration - stage-prefixed path."""
        return await _readiness_impl()

    async def _liveness_impl():
        """Shared liveness probe implementation."""
        return {"status": "alive"}

    @app.get("/health/live")
    async def liveness():
        """Liveness probe for orchestration - direct path."""
        return await _liveness_impl()

    @app.get("/{stage}/health/live")
    async def liveness_with_stage(stage: str):
        """Liveness probe for orchestration - stage-prefixed path."""
        return await _liveness_impl()

    @app.get("/config")
    async def config_status():
        """Display resolved configuration (secrets masked)."""
        try:
            quilt_stack_arn = os.getenv("QuiltStackARN")
            benchling_secret_name = os.getenv("BenchlingSecret")

            def mask_value(value: str | None, show_last: int = 4):
                if not value:
                    return None
                if len(value) <= show_last:
                    return "***"
                return f"***{value[-show_last:]}"

            def mask_arn(arn: str | None):
                if not arn or not arn.startswith("arn:"):
                    return arn
                parts = arn.split(":")
                if len(parts) >= 5:
                    masked = mask_value(parts[4], 4)
                    parts[4] = masked if masked is not None else "***"
                return ":".join(parts)

            def mask_queue_url(url: str | None):
                if not url or not url.startswith("https://sqs."):
                    return url
                prefix, _, remainder = url.partition("amazonaws.com/")
                if not remainder:
                    return url
                parts = remainder.split("/", 1)
                if len(parts) != 2:
                    return url
                account_id, queue_path = parts
                masked_account = mask_value(account_id, 4)
                return f"{prefix}amazonaws.com/{masked_account}/{queue_path}"

            response = {
                "aws": {
                    "region": config.aws_region or os.getenv("AWS_REGION", "not-set"),
                    "quilt_stack_arn": mask_arn(quilt_stack_arn),
                    "benchling_secret_name": benchling_secret_name,
                },
                "security": {
                    "webhook_verification_enabled": config.enable_webhook_verification,
                    "verification_layers": ["fastapi", "lambda_authorizer"],
                    "defense_in_depth": True,
                },
                "quilt": {
                    "catalog": config.quilt_catalog,
                    "database": config.quilt_database,
                    "bucket": config.s3_bucket_name,
                    "queue_url": mask_queue_url(config.queue_url) if config.queue_url else None,
                },
                "benchling": {
                    "tenant": config.benchling_tenant,
                    "client_id": mask_value(config.benchling_client_id, 4),
                    "has_client_secret": bool(config.benchling_client_secret),
                    "has_app_definition_id": bool(config.benchling_app_definition_id),
                },
                "parameters": {
                    "pkg_prefix": config.pkg_prefix,
                    "pkg_key": config.pkg_key,  # type: ignore[attr-defined]
                    "user_bucket": config.s3_bucket_name,
                    "log_level": config.log_level,
                    "webhook_allow_list": config.webhook_allow_list if config.webhook_allow_list else "",
                    "enable_webhook_verification": config.enable_webhook_verification,
                },
            }

            return response

        except Exception as e:
            logger.error("Config status check failed", error=str(e))
            return JSONResponse({"status": "error", "error": str(e)}, status_code=500)

    # ============================================================================
    # Webhook Endpoints - Support both direct paths and stage-prefixed paths
    # ============================================================================
    # These endpoints require HMAC signature verification for security
    # ============================================================================

    async def _handle_event_impl(request: Request, _verified: None = None):
        """Shared event webhook handling implementation."""
        try:
            logger.info("Received /event", headers=dict(request.headers))
            payload = await Payload.from_request(request, benchling)

            logger.info(
                "Event webhook received - parsed",
                event_type=payload.event_type,
                entry_id=payload.entry_id,
                canvas_id=payload.canvas_id,
                orchestration="python",
            )

            if payload.event_type.startswith("v2.canvas."):
                logger.warning(
                    "Canvas event received at /event endpoint - should use /canvas",
                    event_type=payload.event_type,
                    canvas_id=payload.canvas_id,
                )
                canvas_manager = CanvasManager(benchling, config, payload)
                canvas_response = canvas_manager.get_canvas_response()

                logger.debug("Starting background export workflow from /event", entry_id=payload.entry_id)
                entry_packager.execute_workflow_async(payload)

                logger.info("Returning canvas response from /event endpoint", canvas_id=payload.canvas_id)
                return canvas_response

            supported_event_types = {
                "v2.entry.updated.fields",
                "v2.entry.created",
            }
            if payload.event_type not in supported_event_types:
                logger.info("Event type not processed", event_type=payload.event_type)
                return {
                    "status": "ignored",
                    "message": f"Event type {payload.event_type} not processed",
                }

            logger.debug("Starting background export workflow for entry event", entry_id=payload.entry_id)
            entry_id = entry_packager.execute_workflow_async(payload)

            logger.info(
                "Entry event processed - workflow started",
                entry_id=entry_id,
                event_type=payload.event_type,
            )

            return {
                "entry_id": entry_id,
                "status": "ACCEPTED",
                "message": "Workflow started successfully",
                "orchestration": "python",
            }

        except ValueError as e:
            logger.warning("Invalid webhook payload", error=str(e))
            return JSONResponse({"error": str(e)}, status_code=400)
        except Exception as e:
            error_msg = str(e)
            logger.error("Webhook processing failed", error=error_msg, exc_info=True)
            return JSONResponse({"error": "Internal server error"}, status_code=500)

    @app.post("/event")
    async def handle_event(request: Request, _verified: None = Depends(verify_webhook_dependency)):
        """Handle Benchling webhook events with HMAC signature verification - direct path."""
        return await _handle_event_impl(request, _verified)

    @app.post("/{stage}/event")
    async def handle_event_with_stage(
        stage: str, request: Request, _verified: None = Depends(verify_webhook_dependency)
    ):
        """Handle Benchling webhook events with HMAC signature verification - stage-prefixed path."""
        return await _handle_event_impl(request, _verified)

    async def _handle_lifecycle_impl(request: Request, _verified: None = None):
        """Shared lifecycle event handling implementation."""
        try:
            logger.info("Received /lifecycle", headers=dict(request.headers))
            payload_obj = await Payload.from_request(request, benchling)
            payload = payload_obj.raw_payload

            event_type = payload.get("message", {}).get("type")
            logger.info("Received lifecycle event", event_type=event_type, payload=payload)

            if event_type == "v2.app.installed":
                return handle_app_installed(payload)
            if event_type == "v2.app.activateRequested":
                return handle_app_activate_requested(payload)
            if event_type == "v2.app.deactivated":
                return handle_app_deactivated(payload)
            if event_type == "v2-beta.app.configuration.updated":
                return handle_app_configuration_updated(payload)

            logger.warning("Unknown lifecycle event type", event_type=event_type)
            return {
                "status": "ignored",
                "message": f"Unknown event type: {event_type}",
            }

        except Exception as e:
            logger.error("Lifecycle event processing failed", error=str(e))
            return JSONResponse({"error": "Internal server error"}, status_code=500)

    @app.post("/lifecycle")
    async def lifecycle(request: Request, _verified: None = Depends(verify_webhook_dependency)):
        """Handle Benchling app lifecycle events with HMAC signature verification - direct path."""
        return await _handle_lifecycle_impl(request, _verified)

    @app.post("/{stage}/lifecycle")
    async def lifecycle_with_stage(stage: str, request: Request, _verified: None = Depends(verify_webhook_dependency)):
        """Handle Benchling app lifecycle events with HMAC signature verification - stage-prefixed path."""
        return await _handle_lifecycle_impl(request, _verified)

    def handle_app_installed(payload):
        logger.info("App installed", installation_id=payload.get("installationId"))
        return {"status": "success", "message": "App installed successfully"}

    def handle_app_activate_requested(payload):
        logger.info("App activation requested", installation_id=payload.get("installationId"))
        return {"status": "activated", "message": "App activated successfully"}

    def handle_app_deactivated(payload):
        logger.info("App deactivated", installation_id=payload.get("installationId"))
        return {"status": "success", "message": "App deactivated successfully"}

    def handle_app_configuration_updated(payload):
        logger.info("App configuration updated", installation_id=payload.get("installationId"))
        return {"status": "success", "message": "Configuration updated successfully"}

    async def _handle_canvas_impl(request: Request, _verified: None = None):
        """Shared canvas webhook handling implementation."""
        try:
            logger.info("Received /canvas", headers=dict(request.headers))
            payload = await Payload.from_request(request, benchling)

            logger.info(
                "Canvas webhook received - parsed",
                event_type=payload.event_type,
                canvas_id=payload.canvas_id,
                entry_id=payload.entry_id,
            )

            if payload.event_type == "v2.canvas.userInteracted":
                button_id = payload.raw_payload.get("message", {}).get("buttonId", "")
                logger.info("Button interaction detected", button_id=button_id)

                if button_id.startswith("browse-files-"):
                    return handle_browse_files(payload, button_id, benchling, config)
                if button_id.startswith("browse-linked-"):
                    return handle_browse_linked(payload, button_id, benchling, config)
                if button_id.startswith("next-page-linked-") or button_id.startswith("prev-page-linked-"):
                    return handle_page_navigation_linked(payload, button_id, benchling, config)
                if button_id.startswith("next-page-") or button_id.startswith("prev-page-"):
                    return handle_page_navigation(payload, button_id, benchling, config)
                if button_id.startswith("back-to-package-"):
                    return handle_back_to_main(payload, button_id, benchling, config)
                if button_id.startswith("view-metadata-linked-"):
                    return handle_view_metadata_linked(payload, button_id, benchling, config)
                if button_id.startswith("view-metadata-"):
                    return handle_view_metadata(payload, button_id, benchling, config)
                if button_id.startswith("update-package-"):
                    return handle_update_package(payload, entry_packager, benchling, config)

                logger.warning("Unknown button action from /canvas", button_id=button_id)

            logger.debug("Starting background export workflow", entry_id=payload.entry_id)
            execution_arn = entry_packager.execute_workflow_async(payload)

            canvas_manager = CanvasManager(benchling, config, payload)
            canvas_manager.handle_async()

            logger.info(
                "Canvas update triggered asynchronously",
                canvas_id=payload.canvas_id,
                entry_id=payload.entry_id,
                event_type=payload.event_type,
                execution_arn=execution_arn,
            )

            return JSONResponse(
                {
                    "status": "ACCEPTED",
                    "message": "Canvas update initiated",
                    "execution_arn": execution_arn,
                },
                status_code=202,
            )

        except ValueError as e:
            logger.warning("Invalid canvas payload", error=str(e))
            return JSONResponse({"error": str(e)}, status_code=400)
        except Exception as e:
            logger.error("Canvas webhook failed", error=str(e), exc_info=True)
            return JSONResponse({"error": str(e)}, status_code=500)

    @app.post("/canvas")
    async def canvas_initialize(request: Request, _verified: None = Depends(verify_webhook_dependency)):
        """Handle /canvas webhook from Benchling with HMAC signature verification - direct path."""
        return await _handle_canvas_impl(request, _verified)

    @app.post("/{stage}/canvas")
    async def canvas_initialize_with_stage(
        stage: str, request: Request, _verified: None = Depends(verify_webhook_dependency)
    ):
        """Handle /canvas webhook from Benchling with HMAC signature verification - stage-prefixed path."""
        return await _handle_canvas_impl(request, _verified)

    def handle_browse_files(payload, button_id, benchling, config):
        """Handle Browse Files button click."""
        from .pagination import parse_button_id

        try:
            _, entry_id, page_state = parse_button_id(button_id)

            page_number = page_state.page_number if page_state else 0
            page_size = page_state.page_size if page_state else 15

            logger.info("Browse files requested", entry_id=entry_id, page=page_number)

            canvas_manager = CanvasManager(benchling, config, payload)

            def async_update():
                try:
                    blocks = canvas_manager.get_package_browser_blocks(page_number, page_size)
                    canvas_update = AppCanvasUpdate(blocks=blocks, enabled=True)  # type: ignore
                    benchling.apps.update_canvas(canvas_id=payload.canvas_id, canvas=canvas_update)
                    logger.info("Canvas updated with browser view", canvas_id=payload.canvas_id)
                except Exception as e:
                    logger.error("Failed to update canvas", error=str(e))

            threading.Thread(target=async_update, daemon=True).start()

            return JSONResponse({"status": "ACCEPTED", "message": "Loading files..."}, status_code=202)

        except Exception as e:
            logger.error("Browse files failed", error=str(e))
            return JSONResponse({"error": str(e)}, status_code=500)

    def handle_browse_linked(payload, button_id, benchling, config):
        """Handle Browse Linked Package button click."""
        from .pagination import parse_browse_linked_button_id

        try:
            entry_id, package_name, page_number, page_size = parse_browse_linked_button_id(button_id)
        except ValueError as e:
            logger.error("Invalid browse-linked button ID", button_id=button_id, error=str(e))
            return JSONResponse({"error": "Invalid button ID"}, status_code=400)

        logger.info(
            "Browse linked package requested",
            entry_id=entry_id,
            package_name=package_name,
            page=page_number,
            size=page_size,
        )

        canvas_manager = CanvasManager(benchling, config, payload)

        try:
            blocks = canvas_manager.get_package_browser_blocks(page_number, page_size, package_name)
        except Exception as e:
            logger.error(
                "Failed to get package browser blocks",
                entry_id=entry_id,
                package_name=package_name,
                error=str(e),
            )
            blocks = canvas_manager._make_blocks()

        def update_canvas_async():
            try:
                canvas_manager.update_canvas_with_blocks(blocks)  # type: ignore[attr-defined]
                logger.info(
                    "Canvas updated with linked package browser",
                    entry_id=entry_id,
                    package_name=package_name,
                    page=page_number,
                )
            except Exception as e:
                logger.error(
                    "Failed to update canvas with linked package browser",
                    entry_id=entry_id,
                    package_name=package_name,
                    error=str(e),
                    exc_info=True,
                )

        thread = threading.Thread(target=update_canvas_async)
        thread.daemon = True
        thread.start()

        return JSONResponse({"status": "processing"}, status_code=202)

    def handle_page_navigation(payload, button_id, benchling, config):
        """Handle Next/Previous page button clicks for primary package."""
        from .pagination import parse_button_id

        try:
            action, entry_id, page_state = parse_button_id(button_id)

            page_number = page_state.page_number if page_state else 0
            page_size = page_state.page_size if page_state else 15

            logger.info("Page navigation", entry_id=entry_id, action=action, page=page_number)

            canvas_manager = CanvasManager(benchling, config, payload)

            def async_update():
                try:
                    blocks = canvas_manager.get_package_browser_blocks(page_number, page_size)
                    canvas_update = AppCanvasUpdate(blocks=blocks, enabled=True)  # type: ignore
                    benchling.apps.update_canvas(canvas_id=payload.canvas_id, canvas=canvas_update)
                    logger.info("Canvas updated with page", canvas_id=payload.canvas_id, page=page_number)
                except Exception as e:
                    logger.error("Failed to update canvas", error=str(e))

            threading.Thread(target=async_update, daemon=True).start()

            return JSONResponse(
                {"status": "ACCEPTED", "message": f"Loading page {page_number + 1}..."}, status_code=202
            )

        except Exception as e:
            logger.error("Page navigation failed", error=str(e))
            return JSONResponse({"error": str(e)}, status_code=500)

    def handle_page_navigation_linked(payload, button_id, benchling, config):
        """Handle Next/Previous page button clicks for linked packages."""
        from .pagination import parse_browse_linked_button_id

        try:
            entry_id, package_name, page_number, page_size = parse_browse_linked_button_id(button_id)

            logger.info(
                "Linked package page navigation",
                entry_id=entry_id,
                package_name=package_name,
                page=page_number,
            )

            canvas_manager = CanvasManager(benchling, config, payload)

            def async_update():
                try:
                    blocks = canvas_manager.get_package_browser_blocks(page_number, page_size, package_name)
                    canvas_update = AppCanvasUpdate(blocks=blocks, enabled=True)  # type: ignore
                    benchling.apps.update_canvas(canvas_id=payload.canvas_id, canvas=canvas_update)
                    logger.info(
                        "Canvas updated with linked package page",
                        canvas_id=payload.canvas_id,
                        package_name=package_name,
                        page=page_number,
                    )
                except Exception as e:
                    logger.error("Failed to update canvas for linked package navigation", error=str(e))

            threading.Thread(target=async_update, daemon=True).start()

            return JSONResponse(
                {"status": "ACCEPTED", "message": f"Loading page {page_number + 1}..."}, status_code=202
            )

        except Exception as e:
            logger.error("Linked package page navigation failed", error=str(e))
            return JSONResponse({"error": str(e)}, status_code=500)

    def handle_back_to_main(payload, button_id, benchling, config):
        """Handle Back to Package button click."""
        logger.info("Back to package requested", entry_id=payload.entry_id)

        canvas_manager = CanvasManager(benchling, config, payload)

        def async_update():
            try:
                blocks = canvas_manager._make_blocks()
                canvas_update = AppCanvasUpdate(blocks=blocks, enabled=True)  # type: ignore
                benchling.apps.update_canvas(canvas_id=payload.canvas_id, canvas=canvas_update)
                logger.info("Canvas updated with main package view", canvas_id=payload.canvas_id)
            except Exception as e:
                logger.error("Failed to return to main package view", error=str(e))

        threading.Thread(target=async_update, daemon=True).start()

        return JSONResponse({"status": "ACCEPTED", "message": "Returning to package view..."}, status_code=202)

    def handle_view_metadata(payload, button_id, benchling, config):
        """Handle View Metadata button click for primary package."""
        from .pagination import parse_button_id

        try:
            _, entry_id, page_state = parse_button_id(button_id)

            page_number = page_state.page_number if page_state else 0
            page_size = page_state.page_size if page_state else 15

            logger.info("Metadata view requested", entry_id=entry_id)

            canvas_manager = CanvasManager(benchling, config, payload)

            def async_update():
                try:
                    blocks = canvas_manager.get_metadata_blocks(page_number, page_size)
                    canvas_update = AppCanvasUpdate(blocks=blocks, enabled=True)  # type: ignore
                    benchling.apps.update_canvas(canvas_id=payload.canvas_id, canvas=canvas_update)
                    logger.info("Canvas updated with metadata view", canvas_id=payload.canvas_id)
                except Exception as e:
                    logger.error("Failed to update canvas", error=str(e))

            threading.Thread(target=async_update, daemon=True).start()

            return JSONResponse({"status": "ACCEPTED", "message": "Loading metadata..."}, status_code=202)

        except Exception as e:
            logger.error("Metadata view failed", error=str(e))
            return JSONResponse({"error": str(e)}, status_code=500)

    def handle_view_metadata_linked(payload, button_id, benchling, config):
        """Handle View Metadata button click for linked packages."""
        from .pagination import parse_browse_linked_button_id

        try:
            entry_id, package_name, page_number, page_size = parse_browse_linked_button_id(button_id)

            logger.info("Metadata view requested for linked package", entry_id=entry_id, package_name=package_name)

            canvas_manager = CanvasManager(benchling, config, payload)

            def async_update():
                try:
                    blocks = canvas_manager.get_metadata_blocks(page_number, page_size, package_name)
                    canvas_update = AppCanvasUpdate(blocks=blocks, enabled=True)  # type: ignore
                    benchling.apps.update_canvas(canvas_id=payload.canvas_id, canvas=canvas_update)
                    logger.info(
                        "Canvas updated with linked package metadata view",
                        canvas_id=payload.canvas_id,
                        package_name=package_name,
                    )
                except Exception as e:
                    logger.error("Failed to update canvas with linked package metadata", error=str(e))

            threading.Thread(target=async_update, daemon=True).start()

            return JSONResponse({"status": "ACCEPTED", "message": "Loading metadata..."}, status_code=202)

        except Exception as e:
            logger.error("Metadata view for linked package failed", error=str(e))
            return JSONResponse({"error": str(e)}, status_code=500)

    def handle_update_package(payload, entry_packager, benchling, config):
        """Handle Update Package button click (existing functionality)."""
        logger.info("Update package requested", entry_id=payload.entry_id)

        execution_arn = entry_packager.execute_workflow_async(payload)

        canvas_manager = CanvasManager(benchling, config, payload)
        canvas_manager.handle_async()

        return JSONResponse(
            {
                "status": "ACCEPTED",
                "message": "Package update started!",
                "execution_arn": execution_arn,
            },
            status_code=202,
        )

    @app.exception_handler(WebhookVerificationError)
    async def webhook_verification_exception_handler(request: Request, exc: WebhookVerificationError):
        """Handle webhook signature verification failures with 403 Forbidden."""
        logger.warning(
            "Webhook verification failed - returning 403",
            reason=exc.reason,
            message=exc.message,
            path=request.url.path,
        )
        return JSONResponse(
            {
                "error": "Forbidden",
                "reason": exc.reason,
                "message": exc.message,
            },
            status_code=status.HTTP_403_FORBIDDEN,
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            return JSONResponse({"error": "Endpoint not found"}, status_code=exc.status_code)
        detail = exc.detail if hasattr(exc, "detail") else str(exc)
        return JSONResponse({"error": detail}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        logger.warning("Request validation failed", errors=exc.errors())
        return JSONResponse({"error": "Invalid request", "details": exc.errors()}, status_code=400)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.error("Unhandled exception", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)

    return app


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8080"))
    uvicorn.run(
        "src.app:create_app",
        host="0.0.0.0",
        port=port,
        log_level=log_level.lower(),
        factory=True,
    )
