"""Tests for webhook verification."""

from unittest.mock import Mock, patch

import pytest
from flask import Flask

from src.webhook_verification import WebhookVerificationError, require_webhook_verification, verify_webhook


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


@pytest.fixture
def mock_request():
    """Create a mock Flask request."""
    request = Mock()
    request.get_data.return_value = '{"test": "data"}'
    request.headers = {
        "webhook-id": "msg_123",
        "webhook-timestamp": "1234567890",
        "webhook-signature": "v1,signature_here",
    }
    return request


class TestVerifyWebhook:
    """Tests for verify_webhook function."""

    @patch("src.webhook_verification.verify")
    def test_verify_webhook_success(self, mock_verify, mock_request):
        """Test successful webhook verification."""
        app_definition_id = "appdef_test123"

        # Should not raise exception
        verify_webhook(app_definition_id, mock_request)

        # Verify SDK function was called with correct parameters
        mock_verify.assert_called_once_with(app_definition_id, '{"test": "data"}', dict(mock_request.headers))

    @patch("src.webhook_verification.verify")
    def test_verify_webhook_failure(self, mock_verify, mock_request):
        """Test webhook verification failure."""
        mock_verify.side_effect = Exception("Signature verification failed")
        app_definition_id = "appdef_test123"

        with pytest.raises(WebhookVerificationError, match="Webhook verification failed"):
            verify_webhook(app_definition_id, mock_request)

    def test_verify_webhook_no_app_id(self, mock_request):
        """Test webhook verification fails when no app_definition_id."""
        # Should raise exception for empty string
        with pytest.raises(WebhookVerificationError, match="Webhook verification requires app_definition_id"):
            verify_webhook("", mock_request)

        # Should raise exception for None
        with pytest.raises(WebhookVerificationError, match="Webhook verification requires app_definition_id"):
            verify_webhook(None, mock_request)


class TestRequireWebhookVerification:
    """Tests for require_webhook_verification decorator."""

    def test_decorator_success(self, mock_config):
        """Test decorator with successful verification."""
        app = Flask(__name__)

        @require_webhook_verification(mock_config)
        def test_route():
            return {"status": "ok"}

        with app.test_request_context(
            "/test",
            method="POST",
            data='{"test": "data"}',
            headers={
                "webhook-id": "msg_123",
                "webhook-timestamp": "1234567890",
                "webhook-signature": "v1,signature_here",
            },
        ):
            with patch("src.webhook_verification.verify") as mock_verify:
                result = test_route()
                assert result == {"status": "ok"}
                mock_verify.assert_called_once()

    def test_decorator_failure(self, mock_config):
        """Test decorator with failed verification."""
        app = Flask(__name__)

        @require_webhook_verification(mock_config)
        def test_route():
            return {"status": "ok"}

        with app.test_request_context(
            "/test",
            method="POST",
            data='{"test": "data"}',
            headers={
                "webhook-id": "msg_123",
                "webhook-timestamp": "1234567890",
                "webhook-signature": "v1,invalid_signature",
            },
        ):
            with patch("src.webhook_verification.verify") as mock_verify:
                mock_verify.side_effect = Exception("Signature verification failed")
                result, status_code = test_route()
                assert status_code == 401
                assert "error" in result.json

    def test_decorator_disabled(self, mock_config_disabled):
        """Test decorator with verification disabled."""
        app = Flask(__name__)

        @require_webhook_verification(mock_config_disabled)
        def test_route():
            return {"status": "ok"}

        with app.test_request_context(
            "/test",
            method="POST",
            data='{"test": "data"}',
        ):
            with patch("src.webhook_verification.verify") as mock_verify:
                result = test_route()
                assert result == {"status": "ok"}
                # Verify SDK function was NOT called
                mock_verify.assert_not_called()

    def test_request_body_accessible_after_verification(self, mock_config):
        """Test that request body is still accessible after verification (cache=True fix)."""
        app = Flask(__name__)

        @require_webhook_verification(mock_config)
        def test_route():
            from flask import request

            # This should work after verification because we use cache=True
            json_data = request.get_json()
            return {"received": json_data}

        with app.test_request_context(
            "/test",
            method="POST",
            json={"test": "data", "foo": "bar"},
            headers={
                "webhook-id": "msg_123",
                "webhook-timestamp": "1234567890",
                "webhook-signature": "v1,signature_here",
            },
        ):
            with patch("src.webhook_verification.verify") as mock_verify:
                result = test_route()
                # Verify we can still read the JSON body after verification
                assert result == {"received": {"test": "data", "foo": "bar"}}
                mock_verify.assert_called_once()

    def test_decorator_preserves_function_metadata(self, mock_config):
        """Test that @wraps preserves function name and docstring."""

        @require_webhook_verification(mock_config)
        def my_webhook_handler():
            """This is a webhook handler."""
            return {"status": "ok"}

        # Check that function metadata is preserved
        assert my_webhook_handler.__name__ == "my_webhook_handler"
        assert my_webhook_handler.__doc__ == "This is a webhook handler."
