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
