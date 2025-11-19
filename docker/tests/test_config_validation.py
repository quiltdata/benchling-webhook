"""Tests for configuration validation in secrets-only mode.

Tests validate that all 10 runtime parameters are required in the secret
and that proper error messages are displayed for missing or invalid parameters.
"""

import json
from unittest.mock import MagicMock

import pytest

from src.secrets_manager import SecretsManagerError, parse_bool, fetch_benchling_secret


class TestBooleanParsing:
    """Test boolean parameter parsing logic."""

    def test_parse_bool_native_true(self):
        """Test parsing native JSON boolean true."""
        assert parse_bool(True) is True

    def test_parse_bool_native_false(self):
        """Test parsing native JSON boolean false."""
        assert parse_bool(False) is False

    def test_parse_bool_string_true_lowercase(self):
        """Test parsing string 'true' (lowercase)."""
        assert parse_bool("true") is True

    def test_parse_bool_string_true_uppercase(self):
        """Test parsing string 'True' (uppercase)."""
        assert parse_bool("True") is True

    def test_parse_bool_string_false_lowercase(self):
        """Test parsing string 'false' (lowercase)."""
        assert parse_bool("false") is False

    def test_parse_bool_string_false_uppercase(self):
        """Test parsing string 'False' (uppercase)."""
        assert parse_bool("False") is False

    def test_parse_bool_string_one(self):
        """Test parsing string '1' as true."""
        assert parse_bool("1") is True

    def test_parse_bool_string_zero(self):
        """Test parsing string '0' as false."""
        assert parse_bool("0") is False

    def test_parse_bool_invalid_string(self):
        """Test parsing invalid string raises ValueError."""
        with pytest.raises(ValueError, match="Invalid boolean value"):
            parse_bool("yes")

    def test_parse_bool_invalid_type(self):
        """Test parsing invalid type raises ValueError."""
        with pytest.raises(ValueError, match="Invalid boolean value"):
            parse_bool(1)


class TestSecretValidation:
    """Test secret parameter validation."""

    @pytest.fixture
    def mock_sm_client(self):
        """Create mock Secrets Manager client."""
        client = MagicMock()
        return client

    @pytest.fixture
    def valid_secret_data(self):
        """Return valid secret data with all 10 parameters."""
        return {
            "tenant": "test-tenant",
            "client_id": "test-client-id",
            "client_secret": "test-client-secret",
            "app_definition_id": "appdef_test123",
            "pkg_prefix": "benchling",
            "pkg_key": "experiment_id",
            "user_bucket": "test-bucket",
            "log_level": "INFO",
            "enable_webhook_verification": "true",
            "webhook_allow_list": "",
        }

    def test_valid_secret_all_parameters(self, mock_sm_client, valid_secret_data):
        """Test that secret with all 10 parameters validates successfully."""
        mock_sm_client.get_secret_value.return_value = {"SecretString": json.dumps(valid_secret_data)}

        secret = fetch_benchling_secret(mock_sm_client, "us-east-1", "test-secret")

        assert secret.tenant == "test-tenant"
        assert secret.client_id == "test-client-id"
        assert secret.client_secret == "test-client-secret"
        assert secret.app_definition_id == "appdef_test123"
        assert secret.pkg_prefix == "benchling"
        assert secret.pkg_key == "experiment_id"
        assert secret.user_bucket == "test-bucket"
        assert secret.log_level == "INFO"
        assert secret.enable_webhook_verification is True
        assert secret.webhook_allow_list == ""

    def test_missing_single_parameter(self, mock_sm_client, valid_secret_data):
        """Test that missing single parameter raises clear error."""
        del valid_secret_data["log_level"]

        mock_sm_client.get_secret_value.return_value = {"SecretString": json.dumps(valid_secret_data)}

        with pytest.raises(SecretsManagerError) as exc_info:
            fetch_benchling_secret(mock_sm_client, "us-east-1", "test-secret")

        error_message = str(exc_info.value)
        assert "Missing required parameters" in error_message
        assert "log_level" in error_message

    def test_missing_multiple_parameters(self, mock_sm_client, valid_secret_data):
        """Test that missing multiple parameters lists all missing."""
        del valid_secret_data["log_level"]
        del valid_secret_data["pkg_prefix"]
        del valid_secret_data["user_bucket"]

        mock_sm_client.get_secret_value.return_value = {"SecretString": json.dumps(valid_secret_data)}

        with pytest.raises(SecretsManagerError) as exc_info:
            fetch_benchling_secret(mock_sm_client, "us-east-1", "test-secret")

        error_message = str(exc_info.value)
        assert "Missing required parameters" in error_message
        assert "log_level" in error_message
        assert "pkg_prefix" in error_message
        assert "user_bucket" in error_message

    def test_invalid_log_level(self, mock_sm_client, valid_secret_data):
        """Test that invalid log level raises error."""
        valid_secret_data["log_level"] = "TRACE"

        mock_sm_client.get_secret_value.return_value = {"SecretString": json.dumps(valid_secret_data)}

        with pytest.raises(SecretsManagerError) as exc_info:
            fetch_benchling_secret(mock_sm_client, "us-east-1", "test-secret")

        error_message = str(exc_info.value)
        assert "Invalid value for parameter 'log_level'" in error_message
        assert "TRACE" in error_message

    def test_invalid_boolean_value(self, mock_sm_client, valid_secret_data):
        """Test that invalid boolean value raises error."""
        valid_secret_data["enable_webhook_verification"] = "yes"

        mock_sm_client.get_secret_value.return_value = {"SecretString": json.dumps(valid_secret_data)}

        with pytest.raises(SecretsManagerError) as exc_info:
            fetch_benchling_secret(mock_sm_client, "us-east-1", "test-secret")

        error_message = str(exc_info.value)
        assert "Invalid value for parameter 'enable_webhook_verification'" in error_message

    def test_empty_string_parameter(self, mock_sm_client, valid_secret_data):
        """Test that empty string for required parameter raises error."""
        valid_secret_data["tenant"] = ""

        mock_sm_client.get_secret_value.return_value = {"SecretString": json.dumps(valid_secret_data)}

        with pytest.raises(SecretsManagerError) as exc_info:
            fetch_benchling_secret(mock_sm_client, "us-east-1", "test-secret")

        error_message = str(exc_info.value)
        assert "Invalid value for parameter 'tenant'" in error_message

    def test_boolean_as_native_json_true(self, mock_sm_client, valid_secret_data):
        """Test that native JSON boolean true is accepted."""
        valid_secret_data["enable_webhook_verification"] = True

        mock_sm_client.get_secret_value.return_value = {"SecretString": json.dumps(valid_secret_data)}

        secret = fetch_benchling_secret(mock_sm_client, "us-east-1", "test-secret")
        assert secret.enable_webhook_verification is True

    def test_boolean_as_native_json_false(self, mock_sm_client, valid_secret_data):
        """Test that native JSON boolean false is accepted."""
        valid_secret_data["enable_webhook_verification"] = False

        mock_sm_client.get_secret_value.return_value = {"SecretString": json.dumps(valid_secret_data)}

        secret = fetch_benchling_secret(mock_sm_client, "us-east-1", "test-secret")
        assert secret.enable_webhook_verification is False

    def test_all_log_levels_valid(self, mock_sm_client, valid_secret_data):
        """Test that all valid log levels are accepted."""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]

        for level in valid_levels:
            valid_secret_data["log_level"] = level

            mock_sm_client.get_secret_value.return_value = {"SecretString": json.dumps(valid_secret_data)}

            secret = fetch_benchling_secret(mock_sm_client, "us-east-1", "test-secret")
            assert secret.log_level == level

    def test_webhook_allow_list_empty_string(self, mock_sm_client, valid_secret_data):
        """Test that empty webhook_allow_list is valid (no restrictions)."""
        valid_secret_data["webhook_allow_list"] = ""

        mock_sm_client.get_secret_value.return_value = {"SecretString": json.dumps(valid_secret_data)}

        secret = fetch_benchling_secret(mock_sm_client, "us-east-1", "test-secret")
        assert secret.webhook_allow_list == ""

    def test_webhook_allow_list_with_ips(self, mock_sm_client, valid_secret_data):
        """Test that webhook_allow_list with IPs is valid."""
        valid_secret_data["webhook_allow_list"] = "192.168.1.0/24,10.0.0.1"

        mock_sm_client.get_secret_value.return_value = {"SecretString": json.dumps(valid_secret_data)}

        secret = fetch_benchling_secret(mock_sm_client, "us-east-1", "test-secret")
        assert secret.webhook_allow_list == "192.168.1.0/24,10.0.0.1"
