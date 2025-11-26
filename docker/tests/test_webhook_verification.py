"""Tests for webhook verification."""

import asyncio
from typing import Dict
from unittest.mock import Mock, patch

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from src.webhook_verification import WebhookVerificationError, verify_webhook, webhook_verification_dependency


def build_request(body: str = '{"test": "data"}', headers: Dict[str, str] | None = None) -> Request:
    """Create a Starlette Request for testing."""
    headers = headers or {
        "webhook-id": "msg_123",
        "webhook-timestamp": "1234567890",
        "webhook-signature": "v1,signature_here",
    }

    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "path": "/test",
        "headers": [(key.encode("latin-1"), value.encode("latin-1")) for key, value in headers.items()],
        "query_string": b"",
        "scheme": "http",
        "client": ("testserver", 80),
        "server": ("testserver", 80),
    }

    async def receive():
        return {"type": "http.request", "body": body.encode("utf-8"), "more_body": False}

    return Request(scope, receive)


@pytest.fixture
def mock_config():
    """Create a mock config."""
    config = Mock()
    config.benchling_app_definition_id = "appdef_test123"
    config.enable_webhook_verification = True
    return config


@pytest.fixture
def mock_config_disabled():
    """Create a mock config with verification disabled."""
    config = Mock()
    config.benchling_app_definition_id = "appdef_test123"
    config.enable_webhook_verification = False
    return config


class TestVerifyWebhook:
    """Tests for verify_webhook function."""

    @patch("src.webhook_verification.verify")
    def test_verify_webhook_success(self, mock_verify):
        """Test successful webhook verification."""
        app_definition_id = "appdef_test123"
        request = build_request()

        asyncio.run(verify_webhook(app_definition_id, request))

        mock_verify.assert_called_once_with(app_definition_id, '{"test": "data"}', dict(request.headers))

    @patch("src.webhook_verification.verify")
    def test_verify_webhook_failure(self, mock_verify):
        """Test webhook verification failure."""
        mock_verify.side_effect = Exception("Signature verification failed")
        app_definition_id = "appdef_test123"
        request = build_request()

        with pytest.raises(WebhookVerificationError, match="Webhook verification failed"):
            asyncio.run(verify_webhook(app_definition_id, request))

    def test_verify_webhook_no_app_id(self):
        """Test webhook verification fails when no app_definition_id."""
        request = build_request()

        with pytest.raises(WebhookVerificationError, match="Webhook verification requires app_definition_id"):
            asyncio.run(verify_webhook("", request))

        with pytest.raises(WebhookVerificationError, match="Webhook verification requires app_definition_id"):
            asyncio.run(verify_webhook(None, request))  # type: ignore[arg-type]


class TestWebhookVerificationDependency:
    """Tests for FastAPI dependency."""

    def test_dependency_success(self, mock_config):
        app = FastAPI()

        @app.post("/test")
        async def test_route(request: Request, _: None = Depends(webhook_verification_dependency(mock_config))):
            json_data = await request.json()
            return {"received": json_data}

        client = TestClient(app)

        with patch("src.webhook_verification.verify") as mock_verify:
            response = client.post(
                "/test",
                json={"test": "data", "foo": "bar"},
                headers={
                    "webhook-id": "msg_123",
                    "webhook-timestamp": "1234567890",
                    "webhook-signature": "v1,signature_here",
                },
            )

            assert response.status_code == 200
            assert response.json() == {"received": {"test": "data", "foo": "bar"}}
            mock_verify.assert_called_once()

    def test_dependency_failure(self, mock_config):
        app = FastAPI()

        @app.post("/test")
        async def test_route(_: None = Depends(webhook_verification_dependency(mock_config))):
            return {"status": "ok"}

        client = TestClient(app)

        with patch("src.webhook_verification.verify") as mock_verify:
            mock_verify.side_effect = Exception("Signature verification failed")
            response = client.post(
                "/test",
                json={"test": "data"},
                headers={
                    "webhook-id": "msg_123",
                    "webhook-timestamp": "1234567890",
                    "webhook-signature": "v1,invalid_signature",
                },
            )

            assert response.status_code == 401
            assert response.json()["detail"] == "Webhook verification failed"

    def test_dependency_disabled(self, mock_config_disabled):
        app = FastAPI()

        @app.post("/test")
        async def test_route(_: None = Depends(webhook_verification_dependency(mock_config_disabled))):
            return {"status": "ok"}

        client = TestClient(app)

        with patch("src.webhook_verification.verify") as mock_verify:
            response = client.post("/test", json={"test": "data"})
            assert response.status_code == 200
            assert response.json() == {"status": "ok"}
            mock_verify.assert_not_called()
