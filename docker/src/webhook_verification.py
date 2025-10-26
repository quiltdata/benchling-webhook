"""Webhook verification using Benchling SDK helpers."""

from functools import wraps

import structlog
from benchling_sdk.apps.helpers.webhook_helpers import verify
from flask import Request, jsonify

logger = structlog.get_logger(__name__)


class WebhookVerificationError(Exception):
    """Raised when webhook verification fails."""

    pass


def verify_webhook(app_definition_id: str, request: Request) -> None:
    """
    Verify webhook signature using Benchling SDK.

    Args:
        app_definition_id: Benchling app definition ID
        request: Flask request object

    Raises:
        WebhookVerificationError: If verification fails
    """
    if not app_definition_id:
        logger.error("Webhook verification failed - no app_definition_id configured")
        raise WebhookVerificationError("Webhook verification requires app_definition_id but none was configured")

    # Initialize variables for exception handler
    data = ""
    headers = {}

    try:
        # Get raw request data as string without consuming the stream
        # Use cache=True to allow subsequent reads (e.g., request.get_json())
        data = request.get_data(as_text=True, cache=True)

        # Convert Flask headers to dict with lowercase keys
        # Benchling SDK expects lowercase header names (webhook-id, webhook-signature, webhook-timestamp)
        # but Flask/Werkzeug capitalizes them (Webhook-Id, Webhook-Signature, Webhook-Timestamp)
        headers = {key.lower(): value for key, value in request.headers.items()}

        # Debug logging for troubleshooting
        logger.debug(
            "Webhook verification starting",
            app_definition_id=app_definition_id,
            headers=headers,
            data_length=len(data),
            data_preview=data[:200] if data else None,
        )

        # Log specific headers expected by Benchling
        logger.debug(
            "Benchling signature headers",
            webhook_id=headers.get("webhook-id"),
            webhook_signature=headers.get("webhook-signature"),
            webhook_timestamp=headers.get("webhook-timestamp"),
            content_type=headers.get("content-type"),
        )

        # Verify using Benchling SDK helper
        verify(app_definition_id, data, headers)

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


def require_webhook_verification(config):
    """
    Decorator to verify webhook signatures on Flask routes.

    Args:
        config: Application config with app_definition_id and enable_webhook_verification

    Returns:
        Decorator function
    """

    def decorator(f):
        @wraps(f)
        def wrapped_function(*args, **kwargs):
            # Skip verification if disabled
            if not config.enable_webhook_verification:
                logger.debug("Webhook verification disabled")
                return f(*args, **kwargs)

            # Import here to avoid circular dependency
            from flask import request

            try:
                verify_webhook(config.benchling_app_definition_id, request)
                return f(*args, **kwargs)
            except WebhookVerificationError as e:
                logger.warning("Webhook verification failed", error=str(e))
                return jsonify({"error": "Webhook verification failed"}), 401

        return wrapped_function

    return decorator
