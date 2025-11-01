"""Test environment variable naming consistency between CDK and Flask config.

This test file specifically validates that the environment variable names
used in config.py match what the CDK stack provides.
"""

import re
from pathlib import Path

import pytest

from src.config import get_config


def test_environment_variable_names_are_documented():
    """
    Test that config.py only reads QuiltStackARN and BenchlingSecret.

    This ensures secrets-only mode is properly implemented with just 2 env vars.
    """
    config_path = Path(__file__).parent.parent / "src" / "config.py"
    config_content = config_path.read_text()

    # Extract all os.getenv() calls from config.py
    env_var_pattern = r'os\.getenv\("([^"]+)"'
    actual_env_vars = set(re.findall(env_var_pattern, config_content))

    # Expected environment variable names (secrets-only mode)
    # Config.py now ONLY reads QuiltStackARN and BenchlingSecret
    # All other configuration is resolved from AWS CloudFormation and Secrets Manager
    expected_env_vars = {
        "QuiltStackARN",  # CloudFormation stack ARN
        "BenchlingSecret",  # Secrets Manager secret name
    }

    # Verify all expected variables are present
    assert expected_env_vars == actual_env_vars, (
        f"Environment variable mismatch!\n"
        f"Expected: {sorted(expected_env_vars)}\n"
        f"Actual: {sorted(actual_env_vars)}\n"
        f"Missing: {sorted(expected_env_vars - actual_env_vars)}\n"
        f"Extra: {sorted(actual_env_vars - expected_env_vars)}"
    )


class TestConfigWithSecretsOnlyMode:
    """Test Config with secrets-only mode (mocked AWS)."""

    def test_config_with_mocked_resolver(self, mock_config_resolver):
        """Test Config initialization with mocked ConfigResolver.

        This tests the SAME code path as production (secrets-only mode)
        but with mocked AWS responses. No individual environment variables needed.
        """
        config = get_config()

        # Verify all configuration was resolved from mocked AWS
        assert config.aws_region == "us-east-1"
        assert config.quilt_catalog == "test.quiltdata.com"
        assert config.quilt_database == "test_database"
        assert config.s3_bucket_name == "test-bucket"
        assert config.queue_arn == "arn:aws:sqs:us-east-1:123456789012:test-queue"
        assert config.s3_prefix == "benchling"
        assert config.package_key == "experiment_id"
        assert config.benchling_tenant == "test-tenant"
        assert config.benchling_client_id == "test-client-id"
        assert config.benchling_client_secret == "test-client-secret"
        assert config.benchling_app_definition_id == "test-app-id"
        assert config.enable_webhook_verification is True
        assert config.log_level == "INFO"
        assert config.flask_env == "production"

    def test_config_fails_without_environment_variables(self, monkeypatch):
        """Test that Config raises error when QuiltStackARN or BenchlingSecret is missing."""
        # isolate_environment fixture already clears all env vars
        with pytest.raises(
            ValueError,
            match="Missing required environment variables: QuiltStackARN and BenchlingSecret",
        ):
            get_config()


def test_cdk_environment_variables_match_config():
    """
    Test that the CDK stack's Fargate service provides all required env vars.

    This cross-checks the TypeScript CDK code against the Python config to
    ensure they stay in sync.

    Note: This test validates both legacy mode (individual env vars) and
    secrets-only mode (QuiltStackARN + BenchlingSecret).
    """
    # Navigate from docker/tests up two levels to project root, then to lib
    test_dir = Path(__file__).parent  # docker/tests
    docker_dir = test_dir.parent  # docker
    project_root = docker_dir.parent  # project root
    fargate_service_path = project_root / "lib" / "fargate-service.ts"

    if not fargate_service_path.exists():
        # Skip if CDK files aren't available (e.g., in docker-only context)
        return

    fargate_content = fargate_service_path.read_text()

    # Critical environment variables that must be set by CDK in LEGACY mode
    # In secrets-only mode, these are resolved at runtime
    legacy_vars = [
        "QUEUE_ARN",  # SQS Queue ARN (not URL!)
        "QUILT_USER_BUCKET",
        "PKG_PREFIX",
        "PKG_KEY",
        "QUILT_CATALOG",
        "QUILT_DATABASE",
        "BENCHLING_TENANT",
    ]

    # Common environment variables set in both modes
    common_vars = [
        "LOG_LEVEL",
        "AWS_REGION",
        "ENABLE_WEBHOOK_VERIFICATION",
    ]

    # Secrets-only mode variables (v0.6.0+)
    secrets_only_vars = [
        "QuiltStackARN",
        "BenchlingSecret",
    ]

    # Check that all common vars are present
    missing_common = []
    for var in common_vars:
        # Match patterns like: VAR:, "VAR":, 'VAR':, or environmentVars.VAR
        if (
            f"{var}:" not in fargate_content
            and f'"{var}":' not in fargate_content
            and f"'{var}':" not in fargate_content
            and f"environmentVars.{var}" not in fargate_content
        ):
            missing_common.append(var)

    assert not missing_common, (
        f"CDK Fargate service missing common environment variables: {missing_common}\n"
        f"These variables are required in both legacy and secrets-only modes"
    )

    # Check that BOTH legacy vars AND secrets-only vars are present
    # (they are used in different conditional branches)
    missing_legacy_vars = []
    for var in legacy_vars:
        # Match patterns like: VAR:, "VAR":, 'VAR':, or environmentVars.VAR
        if (
            f"{var}:" not in fargate_content
            and f'"{var}":' not in fargate_content
            and f"'{var}':" not in fargate_content
            and f"environmentVars.{var}" not in fargate_content
        ):
            missing_legacy_vars.append(var)

    missing_secrets_only_vars = []
    for var in secrets_only_vars:
        # Match patterns like: VAR:, "VAR":, 'VAR':, or environmentVars.VAR
        if (
            f"{var}:" not in fargate_content
            and f'"{var}":' not in fargate_content
            and f"'{var}':" not in fargate_content
            and f"environmentVars.{var}" not in fargate_content
        ):
            missing_secrets_only_vars.append(var)

    assert not missing_legacy_vars, (
        f"CDK Fargate service missing legacy mode environment variables: {missing_legacy_vars}\n"
        f"These variables must be present (used in legacy mode conditional branch)"
    )

    assert not missing_secrets_only_vars, (
        f"CDK Fargate service missing secrets-only mode environment variables: {missing_secrets_only_vars}\n"
        f"These variables must be present (used in secrets-only mode conditional branch)"
    )

    # Both modes should be supported
    has_legacy_vars = not missing_legacy_vars
    has_secrets_only_vars = not missing_secrets_only_vars

    # Specifically verify QUEUE_ARN is used in legacy mode (not QUEUE_URL)
    if has_legacy_vars:
        assert (
            "QUEUE_ARN" in fargate_content
        ), "fargate-service.ts must set QUEUE_ARN environment variable in legacy mode"

        # Check that QUEUE_URL is not used instead (we want ARN, not URL)
        if "QUEUE_URL" in fargate_content and "QUEUE_ARN" not in fargate_content:
            raise AssertionError("fargate-service.ts uses QUEUE_URL but should use QUEUE_ARN")
