"""Webhook verification using Benchling SDK helpers (FastAPI-compatible)."""

import structlog
from benchling_sdk.apps.helpers.webhook_helpers import verify
from fastapi import HTTPException, Request, status

logger = structlog.get_logger(__name__)


class WebhookVerificationError(Exception):
    """Raised when webhook verification fails."""

    pass


async def verify_webhook(app_definition_id: str, request: Request) -> None:
    """
    Verify webhook signature using Benchling SDK.

    Args:
        app_definition_id: Benchling app definition ID
        request: FastAPI request object

    Raises:
        WebhookVerificationError: If verification fails
    """
    if not app_definition_id:
        logger.error("Webhook verification failed - no app_definition_id configured")
        raise WebhookVerificationError("Webhook verification requires app_definition_id but none was configured")

    data = ""
    headers = {}

    try:
        body = await request.body()
        data = body.decode("utf-8")

        headers = {key.lower(): value for key, value in request.headers.items()}

        logger.debug(
            "Webhook verification starting",
            app_definition_id=app_definition_id,
            headers=headers,
            data_length=len(data),
            data_preview=data[:200] if data else None,
        )

        logger.debug(
            "Benchling signature headers",
            webhook_id=headers.get("webhook-id"),
            webhook_signature=headers.get("webhook-signature"),
            webhook_timestamp=headers.get("webhook-timestamp"),
            content_type=headers.get("content-type"),
        )

        verify(app_definition_id, data, headers)  # type: ignore[arg-type]

        logger.debug("Webhook signature verified successfully")

    except Exception as e:
        logger.error(
            "Webhook verification failed",
            error=str(e),
            error_type=type(e).__name__,
            app_definition_id=app_definition_id,
            headers=headers,
            data_length=len(data),
            exc_info=True,
        )
        raise WebhookVerificationError(f"Webhook verification failed: {str(e)}")


def webhook_verification_dependency(config):
    """
    Dependency to verify webhook signatures on FastAPI routes.

    Args:
        config: Application config with app_definition_id and enable_webhook_verification

    Returns:
        Dependency function
    """

    async def verify_request(request: Request):
        if not config.enable_webhook_verification:
            logger.debug("Webhook verification disabled")
            return

        try:
            await verify_webhook(config.benchling_app_definition_id, request)
        except WebhookVerificationError as e:
            logger.warning("Webhook verification failed", error=str(e))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Webhook verification failed",
            ) from e

    return verify_request
