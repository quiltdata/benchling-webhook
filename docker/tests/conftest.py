"""Pytest configuration and fixtures for test isolation."""

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

    # Default packaging-request queue URL so create_app() doesn't enter
    # degraded mode in tests that don't explicitly need to exercise the
    # missing-queue branch. Tests that need to remove it can call
    # monkeypatch.delenv("PACKAGING_REQUEST_QUEUE_URL").
    monkeypatch.setenv(
        "PACKAGING_REQUEST_QUEUE_URL",
        "https://sqs.us-west-2.amazonaws.com/123/test.fifo",
    )

    # Yield to run the test
    yield
