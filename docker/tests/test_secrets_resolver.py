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


class TestSecretsManagerFetch:
    """Test suite for AWS Secrets Manager fetching."""

    @pytest.fixture
    def valid_secrets_json(self):
        """Valid secrets JSON for testing."""
        return json.dumps({
            "tenant": "test-tenant",
            "clientId": "test-client-id",
            "clientSecret": "test-client-secret"
        })

    @pytest.fixture
    def mock_secrets_manager_success(self, mocker, valid_secrets_json):
        """Mock successful Secrets Manager fetch."""
        from unittest.mock import Mock
        mock_client = Mock()
        mock_client.get_secret_value.return_value = {
            'SecretString': valid_secrets_json
        }
        mocker.patch('boto3.client', return_value=mock_client)
        return mock_client

    def test_fetch_from_secrets_manager_success(self, mock_secrets_manager_success, valid_secrets_json):
        """Test successful secret fetch from Secrets Manager."""
        from src.secrets_resolver import fetch_from_secrets_manager

        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"

        secrets = fetch_from_secrets_manager(arn, "us-east-2")

        assert secrets.tenant == "test-tenant"
        assert secrets.client_id == "test-client-id"
        assert secrets.client_secret == "test-client-secret"

        # Verify boto3 client was called correctly
        mock_secrets_manager_success.get_secret_value.assert_called_once_with(SecretId=arn)

    def test_fetch_resource_not_found(self, mocker):
        """Test fetch fails gracefully when secret doesn't exist."""
        from unittest.mock import Mock
        from botocore.exceptions import ClientError

        mock_client = Mock()
        mock_client.get_secret_value.side_effect = ClientError(
            {'Error': {'Code': 'ResourceNotFoundException', 'Message': 'Secret not found'}},
            'GetSecretValue'
        )
        mocker.patch('boto3.client', return_value=mock_client)

        from src.secrets_resolver import fetch_from_secrets_manager
        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:nonexistent-AbCdEf"

        with pytest.raises(SecretsResolutionError, match="Secret not found"):
            fetch_from_secrets_manager(arn, "us-east-2")

    def test_fetch_access_denied(self, mocker):
        """Test fetch fails gracefully when IAM permissions insufficient."""
        from unittest.mock import Mock
        from botocore.exceptions import ClientError

        mock_client = Mock()
        mock_client.get_secret_value.side_effect = ClientError(
            {'Error': {'Code': 'AccessDeniedException', 'Message': 'Access denied'}},
            'GetSecretValue'
        )
        mocker.patch('boto3.client', return_value=mock_client)

        from src.secrets_resolver import fetch_from_secrets_manager
        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"

        with pytest.raises(SecretsResolutionError, match="Access denied.*IAM permissions"):
            fetch_from_secrets_manager(arn, "us-east-2")

    def test_fetch_generic_aws_error(self, mocker):
        """Test fetch handles generic AWS errors."""
        from unittest.mock import Mock
        from botocore.exceptions import ClientError

        mock_client = Mock()
        mock_client.get_secret_value.side_effect = ClientError(
            {'Error': {'Code': 'InternalServiceError', 'Message': 'AWS service error'}},
            'GetSecretValue'
        )
        mocker.patch('boto3.client', return_value=mock_client)

        from src.secrets_resolver import fetch_from_secrets_manager
        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"

        with pytest.raises(SecretsResolutionError, match="Failed to fetch secret"):
            fetch_from_secrets_manager(arn, "us-east-2")

    def test_fetch_invalid_json_in_secret(self, mocker):
        """Test fetch fails when secret contains invalid JSON."""
        from unittest.mock import Mock

        mock_client = Mock()
        mock_client.get_secret_value.return_value = {
            'SecretString': 'not valid json'
        }
        mocker.patch('boto3.client', return_value=mock_client)

        from src.secrets_resolver import fetch_from_secrets_manager
        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"

        with pytest.raises(SecretsResolutionError, match="Invalid JSON"):
            fetch_from_secrets_manager(arn, "us-east-2")
