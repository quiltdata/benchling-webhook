"""Secret resolution for Benchling credentials.

This module provides runtime resolution of Benchling secrets from multiple sources
with hierarchical fallback:

1. AWS Secrets Manager (via ARN in BENCHLING_SECRETS env var)
2. JSON environment variable (BENCHLING_SECRETS with JSON content)
3. Individual environment variables (legacy: BENCHLING_TENANT, etc.)

Usage:
    from src.secrets_resolver import resolve_benchling_secrets

    secrets = resolve_benchling_secrets(aws_region="us-east-2")
    print(f"Tenant: {secrets.tenant}")

Environment Variables:
    BENCHLING_SECRETS: ARN or JSON string with Benchling credentials
    BENCHLING_TENANT: (Legacy) Benchling tenant name
    BENCHLING_CLIENT_ID: (Legacy) OAuth client ID
    BENCHLING_CLIENT_SECRET: (Legacy) OAuth client secret

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
from typing import Optional

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
    """Benchling credentials resolved from Secrets Manager or environment.

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

    # Map from JSON camelCase to Python snake_case
    secrets = BenchlingSecrets(
        tenant=data.get("tenant", ""),
        client_id=data.get("clientId", ""),
        client_secret=data.get("clientSecret", ""),
    )

    # Validate all required fields are present and non-empty
    secrets.validate()

    return secrets
