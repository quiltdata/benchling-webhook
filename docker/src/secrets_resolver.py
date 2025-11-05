"""Secret resolution for Benchling credentials.

This module provides runtime resolution of Benchling secrets from AWS Secrets Manager.

Secrets-only mode (v0.6.0+):
    - Supports ARN format: arn:aws:secretsmanager:region:account:secret:name
    - Supports JSON format: {"tenant": "...", "clientId": "...", "clientSecret": "..."}
    - No longer supports individual environment variables

Usage:
    from src.secrets_resolver import resolve_benchling_secrets

    secrets = resolve_benchling_secrets(aws_region="us-east-2")
    print(f"Tenant: {secrets.tenant}")

Environment Variables:
    BENCHLING_SECRETS: ARN or JSON string with Benchling credentials

Raises:
    SecretsResolutionError: When secrets cannot be resolved or are invalid

Security:
    - Never logs secret values
    - Validates all required fields
    - Provides clear error messages without exposing secrets
"""

import json
import os
from dataclasses import dataclass
from enum import Enum

import structlog

logger = structlog.get_logger(__name__)


class SecretsResolutionError(Exception):
    """Raised when secrets cannot be resolved or are invalid."""

    pass


class SecretFormat(Enum):
    """Format of BENCHLING_SECRETS environment variable."""

    ARN = "arn"
    JSON = "json"


@dataclass
class BenchlingSecrets:
    """Benchling credentials resolved from Secrets Manager.

    Attributes:
        tenant: Benchling tenant name (e.g., 'mycompany')
        client_id: OAuth client ID for Benchling API authentication
        client_secret: OAuth client secret for Benchling API authentication
    """

    tenant: str
    client_id: str
    client_secret: str

    def validate(self) -> None:
        """Validate that all required fields are present and non-empty.

        Raises:
            SecretsResolutionError: If any required field is missing or empty
        """
        if not self.tenant:
            raise SecretsResolutionError("tenant is required")
        if not self.client_id:
            raise SecretsResolutionError("client_id is required")
        if not self.client_secret:
            raise SecretsResolutionError("client_secret is required")


def detect_secret_format(value: str) -> SecretFormat:
    """Detect if value is an ARN or JSON string.

    Args:
        value: String value from BENCHLING_SECRETS env var

    Returns:
        SecretFormat.ARN or SecretFormat.JSON

    Raises:
        SecretsResolutionError: If format is invalid or cannot be determined
    """
    if not value or not value.strip():
        raise SecretsResolutionError("Invalid BENCHLING_SECRETS format: empty value")

    # Check for ARN format
    if value.startswith("arn:aws:secretsmanager:"):
        return SecretFormat.ARN

    # Check for JSON format
    if value.strip().startswith("{"):
        return SecretFormat.JSON

    # Neither format recognized
    raise SecretsResolutionError(
        f"Invalid BENCHLING_SECRETS format. Must be ARN starting with "
        f"'arn:aws:secretsmanager:' or JSON starting with '{{'. "
        f"Got: {value[:50]}..."
    )


def parse_secrets_json(json_str: str) -> BenchlingSecrets:
    """Parse JSON string into BenchlingSecrets.

    Args:
        json_str: JSON string with Benchling credentials

    Returns:
        BenchlingSecrets with validated data

    Raises:
        SecretsResolutionError: If JSON is invalid or missing required fields
    """
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        raise SecretsResolutionError(f"Invalid JSON in BENCHLING_SECRETS: {str(e)}")

    def _get_field(*names: str) -> str:
        """Return the first non-empty string value for the provided keys."""
        for name in names:
            value = data.get(name)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    # Map from JSON keys (camelCase or snake_case) to dataclass fields
    secrets = BenchlingSecrets(
        tenant=_get_field("tenant"),
        client_id=_get_field("clientId", "client_id"),
        client_secret=_get_field("clientSecret", "client_secret"),
    )

    # Validate all required fields are present and non-empty
    secrets.validate()

    return secrets


def fetch_from_secrets_manager(arn: str, aws_region: str) -> BenchlingSecrets:
    """Fetch secret from AWS Secrets Manager and parse.

    Args:
        arn: Secret ARN
        aws_region: AWS region for client

    Returns:
        BenchlingSecrets with parsed data

    Raises:
        SecretsResolutionError: If fetch fails or secret is invalid
    """
    try:
        import boto3
        from botocore.exceptions import ClientError

        logger.debug("Fetching secret from Secrets Manager", arn=arn, region=aws_region)

        client = boto3.client("secretsmanager", region_name=aws_region)
        response = client.get_secret_value(SecretId=arn)
        secret_string = response["SecretString"]

        logger.debug("Successfully fetched secret from Secrets Manager")

        return parse_secrets_json(secret_string)

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "ResourceNotFoundException":
            raise SecretsResolutionError(
                f"Secret not found: {arn}. " "Verify the ARN is correct and the secret exists."
            )
        elif error_code == "AccessDeniedException":
            raise SecretsResolutionError(
                f"Access denied to secret: {arn}. " "Check IAM permissions for secretsmanager:GetSecretValue"
            )
        else:
            raise SecretsResolutionError(f"Failed to fetch secret: {e.response['Error']['Message']}")
    except SecretsResolutionError:
        # Re-raise secrets resolution errors (from parse_secrets_json)
        raise
    except Exception as e:
        raise SecretsResolutionError(f"Unexpected error fetching secret from Secrets Manager: {str(e)}")


def resolve_benchling_secrets(aws_region: str) -> BenchlingSecrets:
    """Resolve Benchling secrets from AWS Secrets Manager.

    Secrets-only mode (v0.6.0+):
        Requires BENCHLING_SECRETS environment variable in one of two formats:
        1. ARN format: arn:aws:secretsmanager:region:account:secret:name
        2. JSON format: {"tenant": "...", "clientId": "...", "clientSecret": "..."}

    Args:
        aws_region: AWS region for Secrets Manager client

    Returns:
        BenchlingSecrets with resolved credentials

    Raises:
        SecretsResolutionError: If secrets cannot be resolved
    """
    benchling_secrets_env = os.getenv("BENCHLING_SECRETS")

    if not benchling_secrets_env:
        raise SecretsResolutionError(
            "BENCHLING_SECRETS environment variable is required.\n"
            "\n"
            "Supported formats:\n"
            "  1. ARN: arn:aws:secretsmanager:region:account:secret:name\n"
            '  2. JSON: {"tenant": "...", "clientId": "...", "clientSecret": "..."}\n'
            "\n"
            "Legacy mode with individual environment variables (BENCHLING_TENANT, etc.) "
            "is no longer supported in v0.6.0+."
        )

    secret_format = detect_secret_format(benchling_secrets_env)

    if secret_format == SecretFormat.ARN:
        logger.info("Resolving Benchling secrets from Secrets Manager")
        return fetch_from_secrets_manager(benchling_secrets_env, aws_region)
    else:  # JSON
        logger.info("Resolving Benchling secrets from JSON environment variable")
        return parse_secrets_json(benchling_secrets_env)
