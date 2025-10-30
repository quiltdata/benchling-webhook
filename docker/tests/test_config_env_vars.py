"""Test environment variable naming consistency between CDK and Flask config.

This test file specifically validates that the environment variable names
used in config.py match what the CDK stack provides, preventing issues
like the QUEUE_URL vs QUEUE_URL bug.
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
    expected_env_vars = {
        "FLASK_ENV",
        "LOG_LEVEL",
        "AWS_REGION",
        "QUILT_USER_BUCKET",
        "PKG_PREFIX",
        "PKG_KEY",
        "QUILT_CATALOG",
        "QUILT_DATABASE",
        "QUEUE_URL",  # NOT QUEUE_URL!
        "BENCHLING_TENANT",
        "BENCHLING_CLIENT_ID",
        "BENCHLING_CLIENT_SECRET",
        "BENCHLING_APP_DEFINITION_ID",
        "ENABLE_WEBHOOK_VERIFICATION",
    }

    # Verify all expected variables are present
    assert expected_env_vars == actual_env_vars, (
        f"Environment variable mismatch!\n"
        f"Expected: {sorted(expected_env_vars)}\n"
        f"Actual: {sorted(actual_env_vars)}\n"
        f"Missing: {sorted(expected_env_vars - actual_env_vars)}\n"
        f"Extra: {sorted(actual_env_vars - expected_env_vars)}"
    )



def test_cdk_environment_variables_match_config():
    """
    Test that the CDK stack's Fargate service provides all required env vars.

    This cross-checks the TypeScript CDK code against the Python config to
    ensure they stay in sync.
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

    # Critical environment variables that must be set by CDK
    critical_vars = [
        "QUEUE_URL",  # NOT QUEUE_URL!
        "QUILT_USER_BUCKET",
        "PKG_PREFIX",
        "PKG_KEY",
        "QUILT_CATALOG",
        "QUILT_DATABASE",
        "BENCHLING_TENANT",
        "LOG_LEVEL",
        "AWS_REGION",
        "ENABLE_WEBHOOK_VERIFICATION",
    ]

    missing_vars = []
    for var in critical_vars:
        # Match either: VAR: or "VAR": or 'VAR':
        if (
            f"{var}:" not in fargate_content
            and f'"{var}":' not in fargate_content
            and f"'{var}':" not in fargate_content
        ):
            missing_vars.append(var)

    assert not missing_vars, (
        f"CDK Fargate service missing environment variables: {missing_vars}\n"
        f"These variables are required by the Flask config but not set in fargate-service.ts"
    )

    # Specifically verify QUEUE_URL is used (not QUEUE_URL)
    assert 'QUEUE_URL' in fargate_content, (
        "fargate-service.ts must set QUEUE_URL environment variable"
    )

    # Check that QUEUE_URL is not used instead
    if 'QUEUE_URL' in fargate_content and 'QUEUE_URL' not in fargate_content:
        raise AssertionError(
            "fargate-service.ts uses QUEUE_URL but should use QUEUE_URL"
        )
