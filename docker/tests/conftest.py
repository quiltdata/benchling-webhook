"""Pytest configuration for test suite."""

import os
import pytest


@pytest.fixture(autouse=True)
def isolate_tests(monkeypatch):
    """
    Automatically isolate each test by clearing Benchling-related env vars.

    This prevents test pollution where one test's environment variables
    affect subsequent tests. Applied to all tests automatically.
    """
    # Clear all Benchling-related environment variables before each test
    benchling_vars = [
        "BENCHLING_SECRETS",
        "BENCHLING_TENANT",
        "BENCHLING_CLIENT_ID",
        "BENCHLING_CLIENT_SECRET",
        "BENCHLING_APP_DEFINITION_ID",
        "BENCHLING_API_URL",
        # Also clear other config vars to ensure clean state
        "AWS_REGION",
        "QUILT_USER_BUCKET",
        "QUEUE_ARN",
        "QUILT_CATALOG",
        "QUILT_DATABASE",
        "PKG_PREFIX",
        "PKG_KEY",
        "LOG_LEVEL",
        "ENABLE_WEBHOOK_VERIFICATION",
    ]

    for var in benchling_vars:
        monkeypatch.delenv(var, raising=False)

    # Let the test run
    yield

    # Cleanup is handled automatically by monkeypatch
