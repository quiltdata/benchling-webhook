"""Test environment variable naming consistency between CDK and Flask config.

This test file specifically validates that the environment variable names
used in config.py match what the CDK stack provides, preventing issues
like the QUEUE_URL vs QUEUE_ARN bug.
"""

import re
from pathlib import Path


def test_environment_variable_names_are_documented():
    """
    Test that critical environment variable names are correctly used in config.py.

    This test parses config.py to ensure it reads from the correct environment
    variable names that match what the CDK stack provides.
    """
    config_path = Path(__file__).parent.parent / "src" / "config.py"
    config_content = config_path.read_text()

    # Extract all os.getenv() calls from config.py
    env_var_pattern = r'os\.getenv\("([^"]+)"'
    actual_env_vars = set(re.findall(env_var_pattern, config_content))

    # Expected environment variable names (must match CDK stack)
    # NOTE: BENCHLING_TENANT, BENCHLING_CLIENT_ID, BENCHLING_CLIENT_SECRET are now
    # resolved through secrets_resolver.py, not directly via os.getenv()
    # NOTE: QuiltStackARN and BenchlingSecret are new secrets-only mode parameters
    expected_env_vars = {
        "FLASK_ENV",
        "LOG_LEVEL",
        "AWS_REGION",
        "QUILT_USER_BUCKET",
        "PKG_PREFIX",
        "PKG_KEY",
        "QUILT_CATALOG",
        "QUILT_DATABASE",
        "QUEUE_ARN",  # SQS Queue ARN (not URL!)
        "BENCHLING_APP_DEFINITION_ID",
        "ENABLE_WEBHOOK_VERIFICATION",
        "QuiltStackARN",  # New: secrets-only mode
        "BenchlingSecret",  # New: secrets-only mode
    }

    # Verify all expected variables are present
    assert expected_env_vars == actual_env_vars, (
        f"Environment variable mismatch!\n"
        f"Expected: {sorted(expected_env_vars)}\n"
        f"Actual: {sorted(actual_env_vars)}\n"
        f"Missing: {sorted(expected_env_vars - actual_env_vars)}\n"
        f"Extra: {sorted(actual_env_vars - expected_env_vars)}"
    )


# Episode 6: Config integration with secrets resolver
import json

import pytest

from src.config import get_config
from src.secrets_resolver import SecretsResolutionError


class TestConfigWithSecretsResolver:
    """Test Config integration with secrets resolver."""

    @pytest.fixture
    def minimal_env_vars(self, monkeypatch):
        """Set minimal required env vars (non-Benchling)."""
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test-queue")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "app-123")

    @pytest.mark.local
    def test_config_with_benchling_secrets_json(self, monkeypatch, minimal_env_vars):
        """Test Config initialization with BENCHLING_SECRETS JSON."""
        json_str = json.dumps({"tenant": "json-tenant", "clientId": "json-id", "clientSecret": "json-secret"})
        monkeypatch.setenv("BENCHLING_SECRETS", json_str)

        config = get_config()

        assert config.benchling_tenant == "json-tenant"
        assert config.benchling_client_id == "json-id"
        assert config.benchling_client_secret == "json-secret"

    @pytest.mark.local
    def test_config_with_individual_env_vars(self, monkeypatch, minimal_env_vars):
        """Test Config with individual Benchling env vars (backward compatible)."""
        monkeypatch.setenv("BENCHLING_TENANT", "env-tenant")
        monkeypatch.setenv("BENCHLING_CLIENT_ID", "env-id")
        monkeypatch.setenv("BENCHLING_CLIENT_SECRET", "env-secret")

        config = get_config()

        assert config.benchling_tenant == "env-tenant"
        assert config.benchling_client_id == "env-id"
        assert config.benchling_client_secret == "env-secret"

    def test_config_fails_without_secrets(self, monkeypatch, minimal_env_vars):
        """Test Config fails when no Benchling secrets provided."""
        # Remove all Benchling env vars
        monkeypatch.delenv("BENCHLING_SECRETS", raising=False)
        monkeypatch.delenv("BENCHLING_TENANT", raising=False)
        monkeypatch.delenv("BENCHLING_CLIENT_ID", raising=False)
        monkeypatch.delenv("BENCHLING_CLIENT_SECRET", raising=False)

        with pytest.raises(ValueError, match="Failed to resolve Benchling secrets"):
            get_config()

    @pytest.mark.local
    def test_config_priority_benchling_secrets_over_individual(self, monkeypatch, minimal_env_vars):
        """Test BENCHLING_SECRETS takes priority over individual vars."""
        # Set both
        json_str = json.dumps({"tenant": "json-tenant", "clientId": "json-id", "clientSecret": "json-secret"})
        monkeypatch.setenv("BENCHLING_SECRETS", json_str)
        monkeypatch.setenv("BENCHLING_TENANT", "env-tenant")
        monkeypatch.setenv("BENCHLING_CLIENT_ID", "env-id")
        monkeypatch.setenv("BENCHLING_CLIENT_SECRET", "env-secret")

        config = get_config()

        # Should use BENCHLING_SECRETS (JSON)
        assert config.benchling_tenant == "json-tenant"


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
