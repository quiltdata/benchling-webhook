"""Unit tests for RoleManager.

Tests credential caching, role assumption, fallback behavior, and error handling.
"""

import os
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from src.auth.role_manager import RoleManager


@pytest.fixture
def mock_sts_response():
    """Mock STS assume_role response."""
    expiration = datetime.now(timezone.utc) + timedelta(hours=1)
    return {
        "Credentials": {
            "AccessKeyId": "AKIAIOSFODNN7EXAMPLE",
            "SecretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            "SessionToken": "FwoGZXIvYXdzEBMaDJ...",
            "Expiration": expiration,
        },
        "AssumedRoleUser": {
            "AssumedRoleId": "AROA123456789EXAMPLE:session-name",
            "Arn": "arn:aws:sts::123456789012:assumed-role/RoleName/session-name",
        },
    }


@pytest.fixture
def sample_role_arn():
    """Sample IAM role ARN for testing."""
    return "arn:aws:iam::123456789012:role/T4BucketWriteRole-XYZ789"


class TestRoleManagerInitialization:
    """Test RoleManager initialization."""

    def test_init_with_role(self, sample_role_arn):
        """Test initialization with role ARN."""
        manager = RoleManager(
            role_arn=sample_role_arn,
            region="us-west-2",
        )

        assert manager.role_arn == sample_role_arn
        assert manager.region == "us-west-2"
        assert manager._session is None

    def test_init_with_no_role(self):
        """Test initialization with no role (fallback mode)."""
        manager = RoleManager()

        assert manager.role_arn is None
        assert manager.region == "us-east-1"  # default


class TestSessionNameGeneration:
    """Test session name generation for CloudTrail auditing."""

    def test_generate_session_name_format(self):
        """Test session name format includes hostname and timestamp."""
        manager = RoleManager()
        session_name = manager._generate_session_name()

        # Should start with prefix
        assert session_name.startswith("benchling-webhook-")

        # Should contain only valid AWS session name characters (alphanumeric, hyphens, underscores, periods)
        # AWS allows: a-z, A-Z, 0-9, -, _, .
        valid_chars = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
        assert all(c in valid_chars for c in session_name)

        # Should be within AWS limits (64 chars)
        assert len(session_name) <= 64

    @patch("socket.gethostname")
    def test_generate_session_name_with_long_hostname(self, mock_hostname):
        """Test session name truncation for long hostnames."""
        mock_hostname.return_value = "a" * 100  # Very long hostname

        manager = RoleManager()
        session_name = manager._generate_session_name()

        # Should still be within AWS limits
        assert len(session_name) <= 64
        assert session_name.startswith("benchling-webhook-")

    @patch("socket.gethostname", side_effect=Exception("No hostname"))
    def test_generate_session_name_fallback(self, mock_hostname):
        """Test session name generation when hostname unavailable."""
        manager = RoleManager()
        session_name = manager._generate_session_name()

        # Should use "unknown" as fallback
        assert "unknown" in session_name
        assert session_name.startswith("benchling-webhook-")


class TestRoleAssumption:
    """Test IAM role assumption."""

    @patch("boto3.client")
    def test_assume_role_success(self, mock_boto_client, sample_role_arn, mock_sts_response):
        """Test successful role assumption."""
        mock_sts = MagicMock()
        mock_sts.assume_role.return_value = mock_sts_response
        mock_boto_client.return_value = mock_sts

        manager = RoleManager(role_arn=sample_role_arn)
        credentials = manager._assume_role(sample_role_arn)

        # Verify STS call
        mock_sts.assume_role.assert_called_once()
        call_kwargs = mock_sts.assume_role.call_args.kwargs
        assert call_kwargs["RoleArn"] == sample_role_arn
        assert "RoleSessionName" in call_kwargs
        assert call_kwargs["DurationSeconds"] == 3600

        # Verify credentials returned
        assert credentials["AccessKeyId"] == "AKIAIOSFODNN7EXAMPLE"
        assert credentials["SessionToken"] == "FwoGZXIvYXdzEBMaDJ..."

    @patch("boto3.client")
    def test_assume_role_failure(self, mock_boto_client, sample_role_arn):
        """Test role assumption failure."""
        mock_sts = MagicMock()
        mock_sts.assume_role.side_effect = Exception("AccessDenied")
        mock_boto_client.return_value = mock_sts

        manager = RoleManager(role_arn=sample_role_arn)

        with pytest.raises(Exception, match="AccessDenied"):
            manager._assume_role(sample_role_arn)


class TestS3ClientCreation:
    """Test S3 client creation with role assumption."""

    @patch("src.auth.role_manager.RoleManager._assume_role")
    @patch("boto3.Session")
    def test_get_s3_client_with_role(self, mock_session_class, mock_assume_role, sample_role_arn, mock_sts_response):
        """Test getting S3 client with role ARN."""
        mock_assume_role.return_value = mock_sts_response["Credentials"]

        # Mock boto3.Session
        mock_session = MagicMock()
        mock_s3_client = MagicMock()
        mock_session.client.return_value = mock_s3_client
        mock_session_class.return_value = mock_session

        manager = RoleManager(role_arn=sample_role_arn)
        s3_client = manager.get_s3_client()

        # Verify role assumption called
        mock_assume_role.assert_called_once_with(sample_role_arn)

        # Verify S3 client created
        assert s3_client == mock_s3_client

    @patch("boto3.Session")
    def test_get_s3_client_no_role_arn(self, mock_session_class):
        """Test S3 client creation without role ARN (fallback to default credentials)."""
        mock_session = MagicMock()
        mock_s3_client = MagicMock()
        mock_session.client.return_value = mock_s3_client
        mock_session_class.return_value = mock_session

        manager = RoleManager()  # No role ARN
        s3_client = manager.get_s3_client()

        # Should create session with default credentials
        mock_session_class.assert_called()
        assert s3_client == mock_s3_client


class TestCredentialCaching:
    """Test credential caching and refresh behavior."""

    @patch("src.auth.role_manager.RoleManager._assume_role")
    @patch("boto3.Session")
    def test_credentials_cached(self, mock_session_class, mock_assume_role, sample_role_arn, mock_sts_response):
        """Test that credentials are cached and not re-assumed."""
        mock_assume_role.return_value = mock_sts_response["Credentials"]

        mock_session = MagicMock()
        mock_s3_client = MagicMock()
        mock_session.client.return_value = mock_s3_client
        mock_session_class.return_value = mock_session

        manager = RoleManager(role_arn=sample_role_arn)

        # First call - should assume role
        s3_client_1 = manager.get_s3_client()
        assert mock_assume_role.call_count == 1

        # Second call - should use cached credentials
        s3_client_2 = manager.get_s3_client()
        assert mock_assume_role.call_count == 1  # Not called again

        # Both clients should be from same session
        assert s3_client_1 == s3_client_2

    @patch("src.auth.role_manager.RoleManager._assume_role")
    @patch("boto3.Session")
    def test_credentials_refreshed_near_expiration(
        self, mock_session_class, mock_assume_role, sample_role_arn, mock_sts_response
    ):
        """Test that credentials are refreshed when close to expiration."""
        # First call - credentials expire in 3 minutes
        expired_response = mock_sts_response.copy()
        expired_response["Credentials"]["Expiration"] = datetime.now(timezone.utc) + timedelta(minutes=3)
        mock_assume_role.return_value = expired_response["Credentials"]

        mock_session = MagicMock()
        mock_s3_client = MagicMock()
        mock_session.client.return_value = mock_s3_client
        mock_session_class.return_value = mock_session

        manager = RoleManager(role_arn=sample_role_arn)

        # First call
        manager.get_s3_client()
        assert mock_assume_role.call_count == 1

        # Second call - credentials expiring soon (< 5 minutes), should refresh
        fresh_response = mock_sts_response.copy()
        fresh_response["Credentials"]["Expiration"] = datetime.now(timezone.utc) + timedelta(hours=1)
        mock_assume_role.return_value = fresh_response["Credentials"]

        manager.get_s3_client()
        assert mock_assume_role.call_count == 2  # Refreshed


class TestFallbackBehavior:
    """Test graceful fallback to default credentials."""

    @patch("src.auth.role_manager.RoleManager._assume_role", side_effect=Exception("AccessDenied"))
    def test_no_fallback_on_assume_role_failure(self, mock_assume_role, sample_role_arn):
        """Test that role assumption failures raise exceptions instead of falling back.

        This is critical security behavior - we must fail fast rather than silently
        falling back to default credentials, which could write to the wrong AWS account.
        """
        manager = RoleManager(role_arn=sample_role_arn)

        # Should raise RuntimeError, not fall back to default credentials
        with pytest.raises(RuntimeError) as exc_info:
            manager.get_s3_client()

        # Verify the error message is informative
        assert "Failed to assume role" in str(exc_info.value)
        assert sample_role_arn in str(exc_info.value)

        # Verify attempt to assume role was made
        mock_assume_role.assert_called_once()


class TestRoleValidation:
    """Test role validation at startup."""

    @patch("src.auth.role_manager.RoleManager._assume_role")
    def test_validate_roles_success(self, mock_assume_role, sample_role_arn, mock_sts_response):
        """Test successful role validation."""
        mock_assume_role.return_value = mock_sts_response["Credentials"]

        manager = RoleManager(role_arn=sample_role_arn)

        results = manager.validate_roles()

        # Role should be valid
        assert results["role"]["configured"] is True
        assert results["role"]["valid"] is True
        assert results["role"]["error"] is None

        # Verify role was tested
        assert mock_assume_role.call_count == 1

    @patch("src.auth.role_manager.RoleManager._assume_role")
    def test_validate_roles_failure(self, mock_assume_role, sample_role_arn):
        """Test role validation with access denied."""
        mock_assume_role.side_effect = Exception("AccessDenied: User not authorized")

        manager = RoleManager(role_arn=sample_role_arn)

        results = manager.validate_roles()

        # Role should be configured but not valid
        assert results["role"]["configured"] is True
        assert results["role"]["valid"] is False
        assert "AccessDenied" in results["role"]["error"]

    def test_validate_roles_not_configured(self):
        """Test validation when role not configured."""
        manager = RoleManager()  # No role

        results = manager.validate_roles()

        # Role should show as not configured
        assert results["role"]["configured"] is False
        assert results["role"]["valid"] is False


class TestIntegrationScenarios:
    """Test realistic integration scenarios."""

    @patch("src.auth.role_manager.RoleManager._assume_role")
    @patch("boto3.Session")
    def test_multiple_operations_with_caching(
        self, mock_session_class, mock_assume_role, sample_role_arn, mock_sts_response
    ):
        """Test multiple operations with credential caching."""
        mock_assume_role.return_value = mock_sts_response["Credentials"]

        mock_session = MagicMock()
        mock_s3_client = MagicMock()
        mock_session.client.return_value = mock_s3_client
        mock_session_class.return_value = mock_session

        manager = RoleManager(role_arn=sample_role_arn)

        # First operation - should assume role
        manager.get_s3_client()
        assert mock_assume_role.call_count == 1

        # Subsequent operations should use cached credentials
        manager.get_s3_client()
        manager.get_s3_client()
        assert mock_assume_role.call_count == 1  # No new calls

    @patch("boto3.Session")
    def test_no_role_multiple_operations(self, mock_session_class):
        """Test multiple operations without role ARN (fallback mode)."""
        mock_session = MagicMock()
        mock_s3_client = MagicMock()
        mock_session.client.return_value = mock_s3_client
        mock_session_class.return_value = mock_session

        manager = RoleManager()  # No role

        # Multiple operations should all use default credentials
        for _ in range(3):
            s3_client = manager.get_s3_client()
            assert s3_client == mock_s3_client

        # Should create session once and reuse
        assert mock_session_class.call_count >= 1
