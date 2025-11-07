"""Test environment variable naming consistency between CDK and Flask config.

This test file specifically validates that the environment variable names
used in config.py match what the CDK stack provides.
"""

import re
from pathlib import Path

import pytest

from src.config import get_config


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
        """Test that Config raises error when required env vars are missing.

        v1.0.0+: QuiltStackARN is no longer used. Config needs explicit service parameters
        or BenchlingSecret for backward compatibility during transition.
        """
        # isolate_environment fixture already clears all env vars
        with pytest.raises(
            ValueError,
            match="Missing required environment variables",
        ):
            get_config()


def test_cdk_environment_variables_match_config():
    """
    Test that the CDK stack's Fargate service provides all required env vars.

    This cross-checks the TypeScript CDK code against the Python config to
    ensure they stay in sync.

    v1.0.0+: Services resolved at deployment time and passed as explicit env vars.
    QuiltStackARN no longer used at runtime (removed from container environment).
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

    # v1.0.0+: Explicit service parameters (no QuiltStackARN)
    required_service_vars = [
        "PACKAGER_SQS_URL",
        "ATHENA_USER_DATABASE",
        "QUILT_WEB_HOST",
        "ICEBERG_DATABASE",
    ]

    # Check that service vars are present in CDK
    missing_service_vars = []
    for var in required_service_vars:
        # Match patterns like: VAR:, "VAR":, 'VAR':, or environmentVars.VAR
        if (
            f"{var}:" not in fargate_content
            and f'"{var}":' not in fargate_content
            and f"'{var}':" not in fargate_content
            and f"environmentVars.{var}" not in fargate_content
        ):
            missing_service_vars.append(var)

    assert not missing_service_vars, (
        f"CDK Fargate service missing v1.0.0 service environment variables: {missing_service_vars}\n"
        f"These variables are REQUIRED for v1.0.0+ (explicit service resolution)"
    )

    # Legacy variable for backward compatibility during transition
    legacy_compat_vars = [
        "BenchlingSecret",  # Kept temporarily for compatibility
    ]

    # Check that compatibility vars are present
    missing_compat_vars = []
    for var in legacy_compat_vars:
        if (
            f"{var}:" not in fargate_content
            and f'"{var}":' not in fargate_content
            and f"'{var}':" not in fargate_content
            and f"environmentVars.{var}" not in fargate_content
        ):
            missing_compat_vars.append(var)

    assert not missing_compat_vars, (
        f"CDK Fargate service missing compatibility environment variables: {missing_compat_vars}\n"
        f"These variables are kept for backward compatibility"
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

    # Verify removed variables are NOT present (breaking changes in v1.0.0)
    removed_vars = [
        "QuiltStackARN",  # Removed in v1.0.0 - no longer passed to container
    ]

    found_removed_vars = []
    for var in removed_vars:
        # Check if these appear as environment variable assignments
        if (
            f'"{var}"' in fargate_content
            or f"'{var}'" in fargate_content
            or f"environmentVars.{var}" in fargate_content
        ):
            # Additional check: make sure it's actually being assigned, not just in a comment
            if f"environmentVars.{var} =" in fargate_content or f'"{var}":' in fargate_content:
                found_removed_vars.append(var)

    assert not found_removed_vars, (
        f"CDK Fargate service should NOT contain removed v1.0.0 environment variables: {found_removed_vars}\n"
        f"These variables were removed as breaking changes in v1.0.0"
    )

    # Verify old variable names are NOT present
    old_var_names = [
        "QUEUE_URL",
        "QUEUE_ARN",
        "QUILT_USER_BUCKET",
        "PKG_PREFIX",
        "PKG_KEY",
        "QUILT_CATALOG",
        "QUILT_DATABASE",
    ]

    found_old_vars = []
    for var in old_var_names:
        # More strict matching - they should NOT appear as env var assignments
        if (
            f'"{var}"' in fargate_content
            or f"'{var}'" in fargate_content
            or f"environmentVars.{var}" in fargate_content
        ):
            found_old_vars.append(var)

    assert not found_old_vars, (
        f"CDK Fargate service should NOT contain old variable names: {found_old_vars}\n"
        f"These have been replaced with new v1.0.0 naming conventions"
    )
