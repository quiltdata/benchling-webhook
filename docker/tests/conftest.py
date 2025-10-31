"""Pytest configuration and fixtures for test isolation."""

import os

import pytest


@pytest.fixture(scope="function", autouse=True)
def isolate_environment(monkeypatch):
    """Automatically isolate each test from the host environment.

    This fixture runs for every test and clears sensitive environment
    variables that could leak from the developer's environment into tests.

    This ensures tests run the same way in CI as they do locally.
    """
    # Clear Benchling-related env vars that might exist in dev environment
    env_vars_to_clear = [
        "BENCHLING_SECRETS",
        "BENCHLING_TENANT",
        "BENCHLING_CLIENT_ID",
        "BENCHLING_CLIENT_SECRET",
        "BENCHLING_APP_DEFINITION_ID",
        "QUILT_USER_BUCKET",
        "QUEUE_ARN",
        "QUILT_CATALOG",
        "QUILT_DATABASE",
        "AWS_REGION",
        "PKG_PREFIX",
        "PKG_KEY",
    ]

    for var in env_vars_to_clear:
        monkeypatch.delenv(var, raising=False)

    # Yield to run the test
    yield
