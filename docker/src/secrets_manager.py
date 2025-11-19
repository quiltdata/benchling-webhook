"""AWS Secrets Manager utilities for Benchling credentials.

This module provides helper functions to fetch and validate Benchling credentials
from AWS Secrets Manager.

Usage:
    from src.secrets_manager import fetch_benchling_secret

    secret = fetch_benchling_secret(sm_client, region, "my-benchling-secret")
    print(f"Tenant: {secret.tenant}")
"""

from dataclasses import dataclass
from typing import Any

import structlog
from botocore.exceptions import ClientError

logger = structlog.get_logger(__name__)


class SecretsManagerError(Exception):
    """Raised when Secrets Manager operations fail."""

    def __init__(self, message: str, suggestion: str = "", details: str = ""):
        # Include all parts in the base exception message for better error reporting
        full_message = message
        if suggestion:
            full_message += f"\n\n{suggestion}"
        if details:
            full_message += f"\n\n{details}"
        super().__init__(full_message)
        self.message = message
        self.suggestion = suggestion
        self.details = details

    def format(self) -> str:
        """Format error for console output with suggestions."""
        output = f"❌ Secrets Manager Error: {self.message}"
        if self.suggestion:
            output += f"\n   💡 {self.suggestion}"
        if self.details:
            output += f"\n   ℹ️  {self.details}"
        return output


@dataclass
class BenchlingSecretData:
    """All runtime parameters from Benchling secret.

    All fields are REQUIRED. Missing fields cause startup failure.
    This dataclass contains all 10 runtime configuration parameters
    that must be stored in AWS Secrets Manager.

    Attributes:
        tenant: Benchling subdomain (e.g., 'quilt-dtt' from 'quilt-dtt.benchling.com')
        client_id: OAuth client ID from Benchling app
        client_secret: OAuth client secret from Benchling app (sensitive)
        app_definition_id: App definition ID for webhook signature verification
        pkg_prefix: Quilt package name prefix
        pkg_key: Metadata key for linking Benchling entries to Quilt packages
        user_bucket: S3 bucket name for Benchling exports
        log_level: Application logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        enable_webhook_verification: Verify webhook signatures (boolean)
        webhook_allow_list: Comma-separated IP allowlist (empty string for no restrictions)
        queue_url: SQS queue URL for package creation (optional, v0.8.0+ gets from env)
    """

    # Benchling Authentication
    tenant: str
    client_id: str
    client_secret: str
    app_definition_id: str

    # Quilt Package Configuration
    pkg_prefix: str
    pkg_key: str
    user_bucket: str

    # Application Behavior
    log_level: str
    enable_webhook_verification: bool
    webhook_allow_list: str

    # Optional: SQS queue URL (v0.8.0+ gets from environment variable instead)
    queue_url: str = ""


def parse_bool(value: Any) -> bool:
    """Parse boolean from JSON (native bool or string representation).

    Args:
        value: Value to parse (bool, str, or other)

    Returns:
        Boolean value

    Raises:
        ValueError: If value cannot be parsed as boolean

    Accepts:
        - Native JSON booleans: true, false
        - String representations: "true", "false", "True", "False", "1", "0"
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if value.lower() in ["true", "1"]:
            return True
        if value.lower() in ["false", "0"]:
            return False
    raise ValueError(f"Invalid boolean value: {value!r}. Expected: true, false, 'true', 'false', '1', or '0'")


def fetch_benchling_secret(client, region: str, secret_identifier: str) -> BenchlingSecretData:
    """Fetch and validate Benchling credentials from AWS Secrets Manager.

    Args:
        client: boto3 Secrets Manager client
        region: AWS region
        secret_identifier: Secret name or ARN

    Returns:
        BenchlingSecretData with validated credentials

    Raises:
        SecretsManagerError: If secret not found or invalid
    """
    try:
        response = client.get_secret_value(SecretId=secret_identifier)
        secret_string = response.get("SecretString")

        if not secret_string:
            raise SecretsManagerError(
                "Secret does not contain string data", "Ensure secret is stored as JSON string, not binary"
            )

        # Parse JSON
        import json

        try:
            data = json.loads(secret_string)
        except json.JSONDecodeError as e:
            raise SecretsManagerError(
                "Secret contains invalid JSON", "Ensure secret value is valid JSON", f"Parse error: {str(e)}"
            )

        # Validate all required parameters
        required = [
            "tenant",
            "client_id",
            "client_secret",
            "app_definition_id",
            "pkg_prefix",
            "pkg_key",
            "user_bucket",
            "log_level",
            "enable_webhook_verification",
            "webhook_allow_list",
        ]
        # Check if parameters exist in data (not checking for truthy values yet, as webhook_allow_list can be "")
        missing = [f for f in required if f not in data]

        if missing:
            example_secret = {
                "tenant": "quilt-dtt",
                "client_id": "wqFfVOhbYe",
                "client_secret": "6NUPNtpWP7f...",
                "app_definition_id": "appdef_wqFfaXBVMu",
                "pkg_prefix": "benchling",
                "pkg_key": "experiment_id",
                "user_bucket": "my-s3-bucket",
                "log_level": "INFO",
                "enable_webhook_verification": "true",
                "webhook_allow_list": "",
            }

            raise SecretsManagerError(
                f"Missing required parameters in secret '{secret_identifier}'",
                f"Missing: {', '.join(missing)}",
                f"Expected secret format (JSON):\n{json.dumps(example_secret, indent=2)}\n\n"
                "See: https://github.com/quiltdata/benchling-webhook#secret-format",
            )

        # Validate log level
        valid_log_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        log_level = data["log_level"]
        if log_level not in valid_log_levels:
            raise SecretsManagerError(
                "Invalid value for parameter 'log_level'",
                f"Received: {log_level!r}",
                f"Expected one of: {', '.join(valid_log_levels)}",
            )

        # Parse boolean parameter
        try:
            enable_webhook_verification = parse_bool(data["enable_webhook_verification"])
        except ValueError as e:
            raise SecretsManagerError(
                "Invalid value for parameter 'enable_webhook_verification'",
                str(e),
                "Expected: true, false, 'true', 'false', '1', or '0'",
            )

        # Validate non-empty strings for required string parameters
        string_params = [
            "tenant",
            "client_id",
            "client_secret",
            "app_definition_id",
            "pkg_prefix",
            "pkg_key",
            "user_bucket",
        ]
        for param in string_params:
            if not isinstance(data[param], str) or len(data[param]) == 0:
                raise SecretsManagerError(
                    f"Invalid value for parameter '{param}'",
                    f"Received: {data[param]!r}",
                    "Expected: non-empty string",
                )

        # Optional: queue_url (v0.8.0+ gets from environment variable instead)
        queue_url = data.get("queue_url", "")

        return BenchlingSecretData(
            tenant=data["tenant"],
            client_id=data["client_id"],
            client_secret=data["client_secret"],
            app_definition_id=data["app_definition_id"],
            pkg_prefix=data["pkg_prefix"],
            pkg_key=data["pkg_key"],
            user_bucket=data["user_bucket"],
            log_level=data["log_level"],
            enable_webhook_verification=enable_webhook_verification,
            webhook_allow_list=data["webhook_allow_list"],
            queue_url=queue_url,
        )

    except ClientError as e:
        error_code = e.response["Error"]["Code"]

        if error_code == "ResourceNotFoundException":
            raise SecretsManagerError(
                f"Secret not found: {secret_identifier}",
                "Ensure the secret exists in AWS Secrets Manager and is accessible",
                f"Region: {region}",
            )

        if error_code == "AccessDeniedException":
            raise SecretsManagerError(
                f"Access denied to secret: {secret_identifier}",
                "Ensure the IAM role has secretsmanager:GetSecretValue permission",
                f"Region: {region}",
            )

        raise SecretsManagerError(
            f"Failed to fetch secret: {e.response['Error']['Message']}", "Check AWS credentials and permissions"
        )

    except SecretsManagerError:
        # Re-raise SecretsManagerError
        raise
    except Exception as e:
        raise SecretsManagerError(
            f"Unexpected error fetching secret: {str(e)}", "Check AWS credentials and permissions"
        )
