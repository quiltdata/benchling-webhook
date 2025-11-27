"""Lambda authorizer for Benchling webhook HMAC verification.

This module is designed for AWS API Gateway REST API (REQUEST authorizer).
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


def _build_policy(
    effect: str, method_arn: str, principal_id: str, context: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    return {
        "principalId": principal_id or "benchling-webhook",
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": "execute-api:Invoke",
                    "Effect": effect,
                    "Resource": method_arn or "*",
                },
            ],
        },
        "context": context or {},
    }


def _ensure_required_headers(headers: Dict[str, str]) -> None:
    missing = [name for name in REQUIRED_HEADERS if name not in headers]
    if missing:
        logger.warning("Missing required webhook headers: %s", ", ".join(missing))
        raise AuthorizationError("missing_headers")


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """Entrypoint for API Gateway Lambda authorizer."""
    method_arn = event.get("methodArn", "*")
    headers = _normalize_headers(event.get("headers"))
    principal = headers.get("webhook-id", "benchling-webhook")

    try:
        secret_arn = os.environ.get("BENCHLING_SECRET_ARN")
        if not secret_arn:
            logger.error("BENCHLING_SECRET_ARN is not configured")
            raise AuthorizationError("missing_secret_arn")

        _ensure_required_headers(headers)
        body = _decode_body(event)
        app_definition_id = _load_app_definition_id(secret_arn)

        try:
            verify(app_definition_id, body, headers)  # type: ignore[arg-type]
        except Exception as exc:
            logger.warning("Webhook signature verification failed: %s", exc)
            raise AuthorizationError("invalid_signature") from exc
        logger.info("Webhook authorization succeeded for webhook_id=%s", headers.get("webhook-id"))

        return _build_policy(
            "Allow",
            method_arn,
            principal,
            {
                "authorized": "true",
                "webhookId": headers.get("webhook-id", ""),
            },
        )

    except AuthorizationError as exc:
        logger.warning(
            "Authorization rejected (reason=%s, webhook_id=%s)",
            exc.reason,
            headers.get("webhook-id"),
        )
        return _build_policy(
            "Deny",
            method_arn,
            principal,
            {
                "authorized": "false",
                "reason": exc.reason,
            },
        )
    except Exception as exc:  # pragma: no cover - defense for unexpected errors
        logger.error("Unexpected error during authorization: %s", exc, exc_info=True)
        return _build_policy(
            "Deny",
            method_arn,
            principal,
            {
                "authorized": "false",
                "reason": "unexpected_error",
            },
        )
