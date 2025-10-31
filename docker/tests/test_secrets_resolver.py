"""Test suite for secrets_resolver module."""

import json

import pytest

from src.secrets_resolver import (
    BenchlingSecrets,
    SecretFormat,
    SecretsResolutionError,
    detect_secret_format,
    parse_secrets_json,
)


def test_benchling_secrets_dataclass_creation():
    """Test BenchlingSecrets dataclass can be created with valid data."""
    secrets = BenchlingSecrets(tenant="test-tenant", client_id="test-client-id", client_secret="test-client-secret")

    assert secrets.tenant == "test-tenant"
    assert secrets.client_id == "test-client-id"
    assert secrets.client_secret == "test-client-secret"


def test_benchling_secrets_validation_success():
    """Test validation passes with all required fields."""
    secrets = BenchlingSecrets(tenant="test-tenant", client_id="test-client-id", client_secret="test-client-secret")

    # Should not raise
    secrets.validate()


def test_benchling_secrets_validation_missing_tenant():
    """Test validation fails when tenant is missing."""
    secrets = BenchlingSecrets(tenant="", client_id="test-client-id", client_secret="test-client-secret")

    with pytest.raises(SecretsResolutionError, match="tenant is required"):
        secrets.validate()


def test_benchling_secrets_validation_missing_client_id():
    """Test validation fails when client_id is missing."""
    secrets = BenchlingSecrets(tenant="test-tenant", client_id="", client_secret="test-client-secret")

    with pytest.raises(SecretsResolutionError, match="client_id is required"):
        secrets.validate()


def test_benchling_secrets_validation_missing_client_secret():
    """Test validation fails when client_secret is missing."""
    secrets = BenchlingSecrets(tenant="test-tenant", client_id="test-client-id", client_secret="")

    with pytest.raises(SecretsResolutionError, match="client_secret is required"):
        secrets.validate()


def test_secret_format_enum_exists():
    """Test SecretFormat enum has expected values."""
    assert SecretFormat.ARN
    assert SecretFormat.JSON


class TestFormatDetection:
    """Test suite for secret format detection."""

    def test_detect_arn_format(self):
        """Test ARN format is correctly detected."""
        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"
        result = detect_secret_format(arn)
        assert result == SecretFormat.ARN

    def test_detect_json_format(self):
        """Test JSON format is correctly detected."""
        json_str = '{"tenant": "test", "clientId": "id", "clientSecret": "secret"}'
        result = detect_secret_format(json_str)
        assert result == SecretFormat.JSON

    def test_detect_json_format_with_whitespace(self):
        """Test JSON format with leading whitespace."""
        json_str = '  \n  {"tenant": "test", "clientId": "id", "clientSecret": "secret"}'
        result = detect_secret_format(json_str)
        assert result == SecretFormat.JSON

    def test_detect_invalid_format(self):
        """Test invalid format raises error."""
        invalid = "not-an-arn-or-json"
        with pytest.raises(SecretsResolutionError, match="Invalid BENCHLING_SECRETS format"):
            detect_secret_format(invalid)

    def test_detect_empty_string(self):
        """Test empty string raises error."""
        with pytest.raises(SecretsResolutionError, match="Invalid BENCHLING_SECRETS format"):
            detect_secret_format("")

    def test_detect_partial_arn(self):
        """Test partial ARN (wrong service) raises error."""
        invalid_arn = "arn:aws:s3:::my-bucket"
        with pytest.raises(SecretsResolutionError, match="Invalid BENCHLING_SECRETS format"):
            detect_secret_format(invalid_arn)


class TestJSONParsing:
    """Test suite for JSON secret parsing."""

    def test_parse_valid_json(self):
        """Test parsing valid JSON with all required fields."""
        json_str = json.dumps(
            {"tenant": "test-tenant", "clientId": "test-client-id", "clientSecret": "test-client-secret"}
        )

        secrets = parse_secrets_json(json_str)

        assert secrets.tenant == "test-tenant"
        assert secrets.client_id == "test-client-id"
        assert secrets.client_secret == "test-client-secret"

    def test_parse_json_missing_tenant(self):
        """Test parsing fails when tenant is missing."""
        json_str = json.dumps({"clientId": "test-client-id", "clientSecret": "test-client-secret"})

        with pytest.raises(SecretsResolutionError, match="tenant is required"):
            parse_secrets_json(json_str)

    def test_parse_json_missing_client_id(self):
        """Test parsing fails when clientId is missing."""
        json_str = json.dumps({"tenant": "test-tenant", "clientSecret": "test-client-secret"})

        with pytest.raises(SecretsResolutionError, match="client_id is required"):
            parse_secrets_json(json_str)

    def test_parse_json_missing_client_secret(self):
        """Test parsing fails when clientSecret is missing."""
        json_str = json.dumps({"tenant": "test-tenant", "clientId": "test-client-id"})

        with pytest.raises(SecretsResolutionError, match="client_secret is required"):
            parse_secrets_json(json_str)

    def test_parse_json_empty_fields(self):
        """Test parsing fails when fields are empty strings."""
        json_str = json.dumps({"tenant": "", "clientId": "test-client-id", "clientSecret": "test-client-secret"})

        with pytest.raises(SecretsResolutionError, match="tenant is required"):
            parse_secrets_json(json_str)

    def test_parse_invalid_json(self):
        """Test parsing fails with invalid JSON syntax."""
        invalid_json = '{"tenant": "test", invalid}'

        with pytest.raises(SecretsResolutionError, match="Invalid JSON"):
            parse_secrets_json(invalid_json)

    def test_parse_json_extra_fields_ignored(self):
        """Test extra fields are ignored gracefully."""
        json_str = json.dumps(
            {
                "tenant": "test-tenant",
                "clientId": "test-client-id",
                "clientSecret": "test-client-secret",
                "extraField": "ignored",
            }
        )

        secrets = parse_secrets_json(json_str)

        # Should succeed, extra field ignored
        assert secrets.tenant == "test-tenant"
