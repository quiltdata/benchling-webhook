import logging
import os
import threading
from typing import Any, Dict

import structlog
from benchling_api_client.v2.stable.models.app_canvas_update import AppCanvasUpdate
from benchling_sdk.auth.client_credentials_oauth2 import ClientCredentialsOAuth2
from benchling_sdk.benchling import Benchling
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .canvas import CanvasManager
from .config import get_config
from .entry_packager import EntryPackager
from .payload import Payload
from .version import __version__
from .webhook_verification import webhook_verification_dependency

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


def create_app() -> FastAPI:
    app = FastAPI(title="Benchling Webhook", version=__version__)

    # Initialize configuration and clients
    try:
        config = get_config()

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

    verification_dependency = webhook_verification_dependency(config)

    @app.get("/health")
    async def health() -> Dict[str, Any]:
        """Application health status."""
        response = {
            "status": "healthy",
            "service": "benchling-webhook",
            "version": __version__,
        }

        return response

    @app.get("/health/ready")
    async def readiness():
        """Readiness probe for orchestration."""
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

    @app.get("/health/live")
    async def liveness():
        """Liveness probe for orchestration."""
        return {"status": "alive"}

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
                    parts[4] = mask_value(parts[4], 4)
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

    @app.post("/event")
    async def handle_event(request: Request, _: None = Depends(verification_dependency)):
        """Handle Benchling webhook events."""
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

    @app.post("/lifecycle")
    async def lifecycle(request: Request, _: None = Depends(verification_dependency)):
        """Handle Benchling app lifecycle events."""
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

    @app.post("/canvas")
    async def canvas_initialize(request: Request, _: None = Depends(verification_dependency)):
        """Handle /canvas webhook from Benchling."""
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

            return JSONResponse({"status": "ACCEPTED", "message": f"Loading page {page_number + 1}..."}, status_code=202)

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

            return JSONResponse({"status": "ACCEPTED", "message": f"Loading page {page_number + 1}..."}, status_code=202)

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
