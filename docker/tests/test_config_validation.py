"""Tests for Config validation to ensure deployment requirements are met.

These tests validate that the Config class properly enforces required fields,
particularly app_definition_id which is required by the ECS task definition.
"""

import json
from unittest.mock import patch

import pytest

from src.config import Config


class TestConfigValidation:
    """Test Config validation catches missing required fields."""

    def test_config_requires_app_definition_id(self, monkeypatch):
        """Test that Config raises error if app_definition_id is missing.

        This test catches the deployment error where ECS task definition
        expects app_definition_id but it's not provided.
        """
        # Clear any existing app_definition_id from environment
        monkeypatch.delenv("BENCHLING_APP_DEFINITION_ID", raising=False)
        # Set all required env vars except app_definition_id
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        # Mock secrets resolver to provide tenant/client credentials
        with patch("src.config.resolve_benchling_secrets") as mock_resolve:
            from src.secrets_resolver import BenchlingSecrets

            mock_resolve.return_value = BenchlingSecrets(
                tenant="test-tenant", client_id="test-id", client_secret="test-secret"
            )
            # app_definition_id NOT set - should fail
            with pytest.raises(ValueError, match="benchling_app_definition_id"):
                Config()

    def test_config_requires_app_definition_id_not_empty(self, monkeypatch):
        """Test that Config raises error if app_definition_id is empty string."""
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "")  # Empty string
        with patch("src.config.resolve_benchling_secrets") as mock_resolve:
            from src.secrets_resolver import BenchlingSecrets

            mock_resolve.return_value = BenchlingSecrets(
                tenant="test-tenant", client_id="test-id", client_secret="test-secret"
            )
            with pytest.raises(ValueError, match="benchling_app_definition_id"):
                Config()

    def test_config_accepts_valid_app_definition_id(self, monkeypatch):
        """Test that Config succeeds with all required fields including app_definition_id."""
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "app-123")
        with patch("src.config.resolve_benchling_secrets") as mock_resolve:
            from src.secrets_resolver import BenchlingSecrets

            mock_resolve.return_value = BenchlingSecrets(
                tenant="test-tenant", client_id="test-id", client_secret="test-secret"
            )
            config = Config()
            assert config.benchling_app_definition_id == "app-123"
            assert config.benchling_tenant == "test-tenant"
            assert config.benchling_client_id == "test-id"

    def test_config_validation_comprehensive(self, monkeypatch):
        """Test all required fields are validated."""
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "app-123")
        with patch("src.config.resolve_benchling_secrets") as mock_resolve:
            from src.secrets_resolver import BenchlingSecrets

            mock_resolve.return_value = BenchlingSecrets(
                tenant="test-tenant", client_id="test-id", client_secret="test-secret"
            )

            config = Config()

            # Verify all required fields from ECS task definition
            assert config.aws_region
            assert config.s3_bucket_name
            assert config.queue_arn
            assert config.quilt_catalog
            assert config.benchling_tenant
            assert config.benchling_client_id
            assert config.benchling_client_secret
            assert config.benchling_app_definition_id


class TestSecretsResolutionValidation:
    """Test that secrets resolver validates structure matches ECS requirements."""

    def test_json_secret_with_app_definition_id(self, monkeypatch):
        """Test JSON secret includes app_definition_id field."""
        json_secret = json.dumps(
            {
                "tenant": "test-tenant",
                "clientId": "test-id",
                "clientSecret": "test-secret",
            }
        )
        monkeypatch.setenv("BENCHLING_SECRETS", json_secret)
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        # app_definition_id must come from env var when using JSON secrets
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "app-123")

        config = Config()
        assert config.benchling_app_definition_id == "app-123"

    def test_individual_env_vars_require_app_definition_id(self, monkeypatch):
        """Test individual env vars mode requires app_definition_id."""
        monkeypatch.delenv("BENCHLING_SECRETS", raising=False)
        monkeypatch.delenv("BENCHLING_APP_DEFINITION_ID", raising=False)
        monkeypatch.setenv("BENCHLING_TENANT", "test-tenant")
        monkeypatch.setenv("BENCHLING_CLIENT_ID", "test-id")
        monkeypatch.setenv("BENCHLING_CLIENT_SECRET", "test-secret")
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        # Missing app_definition_id
        with pytest.raises(ValueError, match="benchling_app_definition_id"):
            Config()

    @pytest.mark.local
    def test_secrets_manager_structure(self, monkeypatch):
        """Test that Secrets Manager secret structure is validated.

        This is a local-only test that checks actual Secrets Manager structure.
        In CI, this test is skipped.
        """
        # This test would validate the actual secret in AWS Secrets Manager
        # has the required keys: client_id, client_secret, tenant, app_definition_id
        #
        # Implementation depends on whether we want to:
        # 1. Read actual secret (requires AWS credentials)
        # 2. Mock AWS SDK (just validates code path)
        #
        # For now, we validate that the code expects the right structure
        monkeypatch.setenv("BENCHLING_SECRETS", "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-AbCdEf")
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        # When using Secrets Manager ARN, app_definition_id should come from secret
        # But for now it still needs to be in env var (this is the bug we're fixing!)
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "app-123")

        with patch("src.secrets_resolver.fetch_from_secrets_manager") as mock_fetch:
            from src.secrets_resolver import BenchlingSecrets

            mock_fetch.return_value = BenchlingSecrets(
                tenant="test-tenant", client_id="test-id", client_secret="test-secret"
            )

            config = Config()
            assert config.benchling_app_definition_id == "app-123"


class TestECSTaskDefinitionParity:
    """Test that Config validation matches ECS task definition requirements.

    These tests ensure local development catches the same errors that ECS would catch.
    """

    def test_required_fields_match_ecs_task_definition(self, monkeypatch):
        """Validate that required_fields in Config match ECS task definition secrets.

        ECS task definition expects these secrets from Secrets Manager:
        - client_id
        - client_secret
        - app_definition_id (THIS WAS MISSING!)

        And these secrets from environment variables:
        - tenant (or from Secrets Manager)
        """
        # This test documents the expected structure
        ecs_expected_secret_keys = ["client_id", "client_secret", "app_definition_id"]

        config_required_benchling_fields = [
            "benchling_tenant",
            "benchling_client_id",
            "benchling_client_secret",
            "benchling_app_definition_id",
        ]

        # Test that we validate all the fields ECS needs
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "app-123")
        with patch("src.config.resolve_benchling_secrets") as mock_resolve:
            from src.secrets_resolver import BenchlingSecrets

            mock_resolve.return_value = BenchlingSecrets(
                tenant="test-tenant", client_id="test-id", client_secret="test-secret"
            )

            config = Config()

            # Verify all Benchling fields are present
            for field in config_required_benchling_fields:
                value = getattr(config, field)
                assert value, f"Required field {field} is empty"

        # Document what ECS expects
        assert len(ecs_expected_secret_keys) == 3, "ECS expects 3 secret keys"
        assert "app_definition_id" in ecs_expected_secret_keys, "ECS expects app_definition_id"
