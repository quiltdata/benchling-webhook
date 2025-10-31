"""Test suite for secrets_resolver module."""

import pytest

from src.secrets_resolver import BenchlingSecrets, SecretFormat, SecretsResolutionError, detect_secret_format


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
