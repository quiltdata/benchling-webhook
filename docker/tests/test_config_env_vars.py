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
        "BENCHLING_TEST_MODE",  # Optional: disable webhook verification for local tests
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
        assert config.queue_url == "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
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

    Secrets-only mode (v0.6.0+): Only QuiltStackARN and BenchlingSecret are passed.
    All other configuration is resolved at runtime from AWS.
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

    # Secrets-only mode variables (v0.6.0+) - REQUIRED
    # These are the ONLY variables that config.py reads via os.getenv()
    secrets_only_vars = [
        "QuiltStackARN",
        "BenchlingSecret",
    ]

    # Check that secrets-only vars are present in CDK
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

    assert not missing_secrets_only_vars, (
        f"CDK Fargate service missing secrets-only mode environment variables: {missing_secrets_only_vars}\n"
        f"These variables are REQUIRED for secrets-only mode (v0.6.0+)"
    )

    # Additional environment variables set by CDK (but NOT read by config.py)
    # These are set for Flask/application runtime, not for config resolution
    cdk_runtime_vars = [
        "AWS_REGION",
        "AWS_DEFAULT_REGION",
        "FLASK_ENV",
        "LOG_LEVEL",
        "ENABLE_WEBHOOK_VERIFICATION",
        "BENCHLING_WEBHOOK_VERSION",
    ]

    # Check that runtime vars are present in CDK
    missing_runtime_vars = []
    for var in cdk_runtime_vars:
        if (
            f"{var}:" not in fargate_content
            and f'"{var}":' not in fargate_content
            and f"'{var}':" not in fargate_content
            and f"environmentVars.{var}" not in fargate_content
        ):
            missing_runtime_vars.append(var)

    assert not missing_runtime_vars, (
        f"CDK Fargate service missing runtime environment variables: {missing_runtime_vars}\n"
        f"These variables are set by CDK for Flask runtime (not used by config.py)"
    )

    # Verify legacy mode variables are NOT present
    legacy_vars = [
        "QUEUE_URL",
        "QUEUE_ARN",
        "QUILT_USER_BUCKET",
        "PKG_PREFIX",
        "PKG_KEY",
        "QUILT_CATALOG",
        "QUILT_DATABASE",
        "BENCHLING_TENANT",
        "BENCHLING_CLIENT_ID",
        "BENCHLING_CLIENT_SECRET",
        "BENCHLING_APP_DEFINITION_ID",
    ]

    found_legacy_vars = []
    for var in legacy_vars:
        # More strict matching for legacy vars - they should NOT appear as env var assignments
        if (
            f'"{var}"' in fargate_content
            or f"'{var}'" in fargate_content
            or f"environmentVars.{var}" in fargate_content
        ):
            found_legacy_vars.append(var)

    assert not found_legacy_vars, (
        f"CDK Fargate service should NOT contain legacy mode environment variables: {found_legacy_vars}\n"
        f"Legacy mode has been removed. Only secrets-only mode is supported."
    )
