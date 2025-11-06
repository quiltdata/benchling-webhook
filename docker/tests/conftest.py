"""Pytest configuration and fixtures for test isolation."""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(scope="function", autouse=True)
def isolate_environment(monkeypatch):
    """Automatically isolate each test from the host environment.

    This fixture runs for every test and clears sensitive environment
    variables that could leak from the developer's environment into tests.

    This ensures tests run the same way in CI as they do locally.
    """
    # Clear all env vars that might exist in dev environment
    env_vars_to_clear = [
        "BENCHLING_SECRETS",
        "BENCHLING_TENANT",
        "BENCHLING_CLIENT_ID",
        "BENCHLING_CLIENT_SECRET",
        "BENCHLING_APP_DEFINITION_ID",
        "QUILT_USER_BUCKET",
        "QUEUE_URL",
        "QUILT_CATALOG",
        "QUILT_DATABASE",
        "AWS_REGION",
        "PKG_PREFIX",
        "PKG_KEY",
        "QuiltStackARN",
        "BenchlingSecret",
    ]

    for var in env_vars_to_clear:
        monkeypatch.delenv(var, raising=False)

    # Yield to run the test
    yield


@pytest.fixture(scope="function")
def mock_config_resolver(monkeypatch):
    """Mock ConfigResolver to return test configuration.

    This fixture provides a complete mocked configuration without
    requiring any environment variables or AWS API calls.

    Tests use the SAME code path as production (secrets-only mode)
    but with mocked AWS responses.
    """
    # Import here to avoid circular dependency
    from src.config_resolver import ResolvedConfig

    # Set required environment variables for secrets-only mode
    monkeypatch.setenv("QuiltStackARN", "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc-123")
    monkeypatch.setenv("BenchlingSecret", "test-secret")

    # Create mock resolved config with all 10 runtime parameters
    mock_resolved = ResolvedConfig(
        # AWS Context
        aws_region="us-east-1",
        aws_account="123456789012",
        # Infrastructure (CloudFormation)
        quilt_catalog="test.quiltdata.com",
        quilt_database="test_database",
        queue_url="https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
        # Runtime Configuration (Secret - all 10 parameters)
        benchling_tenant="test-tenant",
        benchling_client_id="test-client-id",
        benchling_client_secret="test-client-secret",
        benchling_app_definition_id="test-app-id",
        pkg_prefix="benchling",
        pkg_key="experiment_id",
        user_bucket="test-bucket",
        log_level="INFO",
        enable_webhook_verification=True,
        webhook_allow_list="",
        # Optional infrastructure outputs
        benchling_api_url=None,
    )

    # Mock ConfigResolver.resolve() to return our test config
    with patch("src.config.ConfigResolver") as mock_resolver_class:
        mock_resolver_instance = MagicMock()
        mock_resolver_instance.resolve.return_value = mock_resolved
        mock_resolver_class.return_value = mock_resolver_instance
        yield mock_resolver_instance
