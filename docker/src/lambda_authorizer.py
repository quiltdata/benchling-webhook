"""Lambda authorizer for Benchling webhook HMAC verification.

This module is designed for AWS API Gateway HTTP API v2 (Lambda authorizer).
It validates webhook signatures using the Benchling SDK before allowing the
request to proceed to the backend service.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any, Dict, Optional

import boto3
from benchling_sdk.apps.helpers.webhook_helpers import verify
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

REQUIRED_HEADERS = ("webhook-id", "webhook-signature", "webhook-timestamp")


class AuthorizationError(Exception):
    """Raised when a request cannot be authorized."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _get_secrets_client():
    return boto3.client("secretsmanager")


def _load_app_definition_id(secret_arn: str, secrets_client=None) -> str:
    client = secrets_client or _get_secrets_client()

    try:
        response = client.get_secret_value(SecretId=secret_arn)
    except ClientError as exc:
        logger.error("Failed to load Benchling secret: %s", exc, exc_info=True)
        raise AuthorizationError("secrets_manager_error") from exc

    secret_string = response.get("SecretString")
    if not secret_string:
        logger.error("Benchling secret missing SecretString for ARN %s", secret_arn)
        raise AuthorizationError("missing_secret_string")

    try:
        secret = json.loads(secret_string)
    except json.JSONDecodeError as exc:
        logger.error("Benchling secret is not valid JSON: %s", exc)
        raise AuthorizationError("invalid_secret_json") from exc

    app_definition_id = secret.get("app_definition_id") or secret.get("appDefinitionId")
    if not app_definition_id:
        logger.error("Benchling secret missing app_definition_id (keys: %s)", list(secret.keys()))
        raise AuthorizationError("missing_app_definition_id")

    return app_definition_id


def _normalize_headers(headers: Optional[Dict[str, Any]]) -> Dict[str, str]:
    normalized: Dict[str, str] = {}
    if not headers:
        return normalized

    for key, value in headers.items():
        if value is None:
            continue
        normalized[key.lower()] = str(value)
    return normalized


def _decode_body(event: Dict[str, Any]) -> str:
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        try:
            return base64.b64decode(body).decode("utf-8")
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Failed to decode base64 body: %s", exc)
            raise AuthorizationError("invalid_body_encoding") from exc
    if isinstance(body, bytes):
        return body.decode("utf-8")
    if not isinstance(body, str):
        return str(body)
    return body


def _build_response(is_authorized: bool, context: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Build HTTP API v2 authorizer response (simple format)."""
    response: Dict[str, Any] = {"isAuthorized": is_authorized}
    if context:
        response["context"] = context
    return response


def _ensure_required_headers(headers: Dict[str, str]) -> None:
    missing = [name for name in REQUIRED_HEADERS if name not in headers]
    if missing:
        logger.warning("Missing required webhook headers: %s", ", ".join(missing))
        raise AuthorizationError("missing_headers")


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """Entrypoint for API Gateway Lambda authorizer."""
    # Log comprehensive invocation details
    version = event.get("version")
    route_key = event.get("routeKey", "unknown")
    request_id = event.get("requestContext", {}).get("requestId", "unknown")

    logger.info(
        "Lambda authorizer invoked | " "version=%s route=%s request_id=%s has_body=%s body_length=%s is_base64=%s",
        version,
        route_key,
        request_id,
        "body" in event,
        len(event.get("body", "")) if event.get("body") else 0,
        event.get("isBase64Encoded", False),
    )

    # Validate HTTP API v2 event format
    if version != "2.0":
        logger.error("Unsupported event version: %s (expected 2.0)", version)
        return _build_response(
            False,
            {
                "authorized": "false",
                "error": "invalid_version",
                "message": f"Expected HTTP API v2 (version 2.0), got {version}",
            },
        )

    headers = _normalize_headers(event.get("headers"))

    try:
        secret_arn = os.environ.get("BENCHLING_SECRET_ARN")
        if not secret_arn:
            logger.error("BENCHLING_SECRET_ARN is not configured")
            raise AuthorizationError("missing_secret_arn")

        _ensure_required_headers(headers)
        body = _decode_body(event)
        app_definition_id = _load_app_definition_id(secret_arn)

        # Log diagnostic information for troubleshooting
        logger.info(
            "Verifying webhook signature | "
            "webhook_id=%s app_definition_id=%s body_received=%s body_length=%s "
            "headers=%s",
            headers.get("webhook-id"),
            app_definition_id,
            bool(body),
            len(body),
            list(headers.keys()),
        )

        try:
            verify(app_definition_id, body, headers)  # type: ignore[arg-type]
        except Exception as exc:
            logger.error(
                "Webhook signature verification failed: %s | "
                "TROUBLESHOOTING: Ensure the webhook in Benchling is configured under app '%s'. "
                "Check that this matches the app_definition_id in secret '%s'. "
                "webhook_id=%s",
                exc,
                app_definition_id,
                secret_arn,
                headers.get("webhook-id"),
            )
            raise AuthorizationError("invalid_signature") from exc
        logger.info("Webhook authorization succeeded for webhook_id=%s", headers.get("webhook-id"))

        return _build_response(
            True,
            {
                "authorized": "true",
                "webhookId": headers.get("webhook-id", ""),
            },
        )

    except AuthorizationError as exc:
        # Build detailed error messages with troubleshooting guidance
        secret_arn = os.environ.get("BENCHLING_SECRET_ARN", "not_configured")
        try:
            app_def_id = _load_app_definition_id(secret_arn) if secret_arn != "not_configured" else "unknown"
        except Exception:
            app_def_id = "error_loading"

        error_messages = {
            "invalid_signature": (
                f"Webhook signature verification failed. "
                f"Expected app: {app_def_id}. "
                f"Check that the webhook in Benchling is configured under this app, "
                f"or update app_definition_id in secret: {secret_arn}"
            ),
            "missing_headers": "Required webhook headers missing (webhook-id, webhook-signature, webhook-timestamp)",
            "missing_secret_arn": "Authorizer configuration error: BENCHLING_SECRET_ARN not set",
            "secrets_manager_error": f"Failed to retrieve Benchling credentials from secret: {secret_arn}",
            "missing_secret_string": f"Benchling secret is empty: {secret_arn}",
            "invalid_secret_json": f"Benchling secret is not valid JSON: {secret_arn}",
            "missing_app_definition_id": f"Benchling secret missing app_definition_id field: {secret_arn}",
            "invalid_body_encoding": "Request body encoding is invalid",
        }
        message = error_messages.get(exc.reason, f"Authorization failed: {exc.reason}")

        logger.warning(
            "Authorization rejected (reason=%s, webhook_id=%s) - %s",
            exc.reason,
            headers.get("webhook-id"),
            message,
        )

        # Return HTTP API v2 response with context containing the error message
        # API Gateway will return 403 Forbidden with this information
        return _build_response(
            False,
            {
                "authorized": "false",
                "error": exc.reason,
                "message": message,  # Full message for gateway response template
                "webhookId": headers.get("webhook-id", "unknown"),
            },
        )
    except Exception as exc:  # pragma: no cover - defense for unexpected errors
        logger.error("Unexpected error during authorization: %s", exc, exc_info=True)
        # Return HTTP API v2 response for unexpected errors
        return _build_response(
            False,
            {
                "authorized": "false",
                "error": "unexpected_error",
                "message": "Authorization failed: unexpected error",
                "webhookId": headers.get("webhook-id", "unknown"),
            },
        )
