"""Configuration resolver for secrets-only architecture.

This module resolves complete application configuration from just two sources:
1. QuiltStackARN - CloudFormation stack ARN for Quilt infrastructure
2. BenchlingSecret - AWS Secrets Manager secret containing Benchling credentials

All other configuration is derived by querying AWS CloudFormation and Secrets Manager.

Usage:
    from src.config_resolver import ConfigResolver

    resolver = ConfigResolver()
    config = resolver.resolve(
        quilt_stack_arn="arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc",
        benchling_secret="my-benchling-secret"
    )

    print(f"Database: {config['quilt_database']}")
    print(f"Tenant: {config['benchling_tenant']}")
"""

import os
import re
from dataclasses import dataclass
from typing import Dict, Optional
from urllib.parse import urlparse

import boto3
import structlog
from botocore.exceptions import ClientError

logger = structlog.get_logger(__name__)

QUEUE_URL_REGEX = re.compile(r"^arn:aws:sqs:([a-z0-9-]+):(\d+):(.+)$", re.IGNORECASE)
QUEUE_URL_REGEX = re.compile(r"^https://sqs\.[a-z0-9-]+\.amazonaws\.com/\d+/.+", re.IGNORECASE)


def to_queue_url(identifier: Optional[str]) -> Optional[str]:
    """Normalize an SQS queue identifier (ARN or URL) to a queue URL."""

    if not identifier:
        return identifier

    trimmed = identifier.strip()
    if not trimmed:
        return None

    if is_queue_url(trimmed):
        return trimmed

    match = QUEUE_URL_REGEX.match(trimmed)
    if not match:
        return trimmed

    region, account, queue_name = match.groups()
    return f"https://sqs.{region}.amazonaws.com/{account}/{queue_name}"


def is_queue_url(value: Optional[str]) -> bool:
    if not value:
        return False
    return bool(QUEUE_URL_REGEX.match(value.strip()))


class ConfigResolverError(Exception):
    """Raised when configuration resolution fails."""

    def __init__(self, message: str, suggestion: Optional[str] = None, details: Optional[str] = None):
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
        output = f"❌ Configuration Error: {self.message}"
        if self.suggestion:
            output += f"\n   💡 {self.suggestion}"
        if self.details:
            output += f"\n   ℹ️  {self.details}"
        return output


@dataclass
class ParsedStackArn:
    """Components of a CloudFormation stack ARN."""

    region: str
    account: str
    stack_name: str
    stack_id: str


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


@dataclass
class ResolvedConfig:
    """Complete resolved configuration from AWS sources.

    All fields are required. No defaults.
    Configuration is assembled from CloudFormation outputs and Benchling secret.

    Infrastructure parameters come from CloudFormation:
        - aws_region, aws_account: Parsed from stack ARN
        - quilt_catalog, quilt_database, queue_url: Stack outputs
        - benchling_api_url: Stack output (optional)

    Runtime parameters come from Benchling secret:
        - All Benchling authentication fields
        - All Quilt package configuration fields
        - All application behavior fields
    """

    # AWS Context (from ARN parsing)
    aws_region: str
    aws_account: str

    # Infrastructure (from CloudFormation outputs)
    quilt_catalog: str
    quilt_database: str
    queue_url: str

    # Runtime Configuration (from Benchling secret - all 10 parameters)
    benchling_tenant: str
    benchling_client_id: str
    benchling_client_secret: str
    benchling_app_definition_id: str
    pkg_prefix: str
    pkg_key: str
    user_bucket: str
    log_level: str
    enable_webhook_verification: bool
    webhook_allow_list: str

    # Optional infrastructure outputs
    benchling_api_url: Optional[str] = None

    def to_dict(self) -> Dict[str, any]:
        """Convert to dictionary for easier access."""
        return {
            "aws_region": self.aws_region,
            "aws_account": self.aws_account,
            "quilt_catalog": self.quilt_catalog,
            "quilt_database": self.quilt_database,
            "queue_url": self.queue_url,
            "user_bucket": self.user_bucket,
            "benchling_tenant": self.benchling_tenant,
            "benchling_client_id": self.benchling_client_id,
            "benchling_client_secret": self.benchling_client_secret,
            "benchling_app_definition_id": self.benchling_app_definition_id,
            "benchling_api_url": self.benchling_api_url,
            "pkg_prefix": self.pkg_prefix,
            "pkg_key": self.pkg_key,
            "log_level": self.log_level,
            "webhook_allow_list": self.webhook_allow_list,
            "enable_webhook_verification": self.enable_webhook_verification,
        }


def parse_bool(value: any) -> bool:
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


def parse_stack_arn(arn: str) -> ParsedStackArn:
    """Parse CloudFormation stack ARN into components.

    Args:
        arn: CloudFormation stack ARN

    Returns:
        ParsedStackArn with region, account, stack_name, stack_id

    Raises:
        ConfigResolverError: If ARN format is invalid
    """
    pattern = r"^arn:aws:cloudformation:([a-z0-9-]+):(\d{12}):stack/([^/]+)/(.+)$"
    match = re.match(pattern, arn)

    if not match:
        raise ConfigResolverError(
            "Invalid CloudFormation stack ARN format",
            "ARN must match: arn:aws:cloudformation:region:account:stack/name/id",
            f"Received: {arn}",
        )

    region, account, stack_name, stack_id = match.groups()

    return ParsedStackArn(region=region, account=account, stack_name=stack_name, stack_id=stack_id)


def extract_stack_outputs(client, stack_name: str) -> Dict[str, str]:
    """Extract outputs from CloudFormation stack.

    Args:
        client: boto3 CloudFormation client
        stack_name: Name of the stack

    Returns:
        Dictionary of output keys to values

    Raises:
        ConfigResolverError: If stack not found or inaccessible
    """
    try:
        response = client.describe_stacks(StackName=stack_name)
        stacks = response.get("Stacks", [])

        if not stacks:
            raise ConfigResolverError(
                f"Stack not found: {stack_name}", "Ensure the CloudFormation stack exists and is accessible"
            )

        outputs = stacks[0].get("Outputs", [])
        return {output["OutputKey"]: output["OutputValue"] for output in outputs}

    except ClientError as e:
        error_code = e.response["Error"]["Code"]

        if error_code == "ValidationError":
            raise ConfigResolverError(f"Invalid stack name: {stack_name}", "Check that the stack name is correct")

        raise ConfigResolverError(
            f"Failed to describe stack: {e.response['Error']['Message']}", "Check AWS credentials and permissions"
        )

    except Exception as e:
        raise ConfigResolverError(
            f"Unexpected error describing stack: {str(e)}", "Check AWS credentials and permissions"
        )


def resolve_and_fetch_secret(client, region: str, secret_identifier: str) -> BenchlingSecretData:
    """Fetch and validate secret from AWS Secrets Manager.

    Args:
        client: boto3 Secrets Manager client
        region: AWS region
        secret_identifier: Secret name or ARN

    Returns:
        BenchlingSecretData with validated credentials

    Raises:
        ConfigResolverError: If secret not found or invalid
    """
    try:
        response = client.get_secret_value(SecretId=secret_identifier)
        secret_string = response.get("SecretString")

        if not secret_string:
            raise ConfigResolverError(
                "Secret does not contain string data", "Ensure secret is stored as JSON string, not binary"
            )

        # Parse JSON
        import json

        try:
            data = json.loads(secret_string)
        except json.JSONDecodeError as e:
            raise ConfigResolverError(
                "Secret contains invalid JSON", "Ensure secret value is valid JSON", f"Parse error: {str(e)}"
            )

        # Validate all 10 required parameters
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
            import json

            raise ConfigResolverError(
                f"Missing required parameters in secret '{secret_identifier}'",
                f"Missing: {', '.join(missing)}",
                f"Expected secret format (JSON):\n{json.dumps(example_secret, indent=2)}\n\n"
                "See: https://github.com/quiltdata/benchling-webhook#secret-format",
            )

        # Validate log level
        valid_log_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        log_level = data["log_level"]
        if log_level not in valid_log_levels:
            raise ConfigResolverError(
                "Invalid value for parameter 'log_level'",
                f"Received: {log_level!r}",
                f"Expected one of: {', '.join(valid_log_levels)}",
            )

        # Parse boolean parameter
        try:
            enable_webhook_verification = parse_bool(data["enable_webhook_verification"])
        except ValueError as e:
            raise ConfigResolverError(
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
                raise ConfigResolverError(
                    f"Invalid value for parameter '{param}'",
                    f"Received: {data[param]!r}",
                    "Expected: non-empty string",
                )

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
        )

    except ClientError as e:
        error_code = e.response["Error"]["Code"]

        if error_code == "ResourceNotFoundException":
            raise ConfigResolverError(
                f"Secret not found: {secret_identifier}",
                "Ensure the secret exists in AWS Secrets Manager and is accessible",
                f"Region: {region}",
            )

        if error_code == "AccessDeniedException":
            raise ConfigResolverError(
                f"Access denied to secret: {secret_identifier}",
                "Ensure the IAM role has secretsmanager:GetSecretValue permission",
                f"Region: {region}",
            )

        raise ConfigResolverError(
            f"Failed to fetch secret: {e.response['Error']['Message']}", "Check AWS credentials and permissions"
        )

    except ConfigResolverError:
        # Re-raise ConfigResolverError
        raise
    except Exception as e:
        raise ConfigResolverError(
            f"Unexpected error fetching secret: {str(e)}", "Check AWS credentials and permissions"
        )


class ConfigResolver:
    """Main configuration resolver class.

    Resolves complete application configuration from CloudFormation and Secrets Manager.
    Implements caching to avoid repeated AWS API calls.
    """

    def __init__(self):
        self._cache: Optional[ResolvedConfig] = None

    def resolve(self, quilt_stack_arn: Optional[str] = None, benchling_secret: Optional[str] = None) -> ResolvedConfig:
        """Resolve complete configuration from AWS.

        Args:
            quilt_stack_arn: CloudFormation stack ARN (or from env QuiltStackARN)
            benchling_secret: Secret name or ARN (or from env BenchlingSecret)

        Returns:
            ResolvedConfig with complete configuration

        Raises:
            ConfigResolverError: If resolution fails
            ValueError: If required parameters missing
        """
        # Return cached config if available
        if self._cache:
            logger.debug("Returning cached configuration")
            return self._cache

        # Get from environment if not provided
        if not quilt_stack_arn:
            quilt_stack_arn = os.getenv("QuiltStackARN")
        if not benchling_secret:
            benchling_secret = os.getenv("BenchlingSecret")

        # Validate required parameters
        if not quilt_stack_arn or not benchling_secret:
            missing = []
            if not quilt_stack_arn:
                missing.append("QuiltStackARN")
            if not benchling_secret:
                missing.append("BenchlingSecret")

            raise ValueError(
                f"Missing required parameters: {', '.join(missing)}\n\n"
                "The container requires exactly 2 environment variables:\n"
                "  QuiltStackARN: ARN of your Quilt CloudFormation stack\n"
                "    Example: arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123\n\n"
                "  BenchlingSecret: Name or ARN of AWS Secrets Manager secret\n"
                "    Example: my-benchling-creds"
            )

        logger.info(
            "Resolving configuration from AWS", quilt_stack_arn=quilt_stack_arn, benchling_secret=benchling_secret
        )

        # Step 1: Parse stack ARN
        parsed = parse_stack_arn(quilt_stack_arn)
        logger.debug("Parsed stack ARN", region=parsed.region, account=parsed.account, stack_name=parsed.stack_name)

        # Step 2: Create AWS clients
        cfn_client = boto3.client("cloudformation", region_name=parsed.region)
        sm_client = boto3.client("secretsmanager", region_name=parsed.region)

        # Step 3: Fetch stack outputs
        logger.info("Fetching CloudFormation stack outputs", stack_name=parsed.stack_name)
        outputs = extract_stack_outputs(cfn_client, parsed.stack_name)
        logger.debug("Retrieved stack outputs", output_count=len(outputs))

        # Step 4: Validate required outputs
        self._validate_required_outputs(outputs)

        # Step 5: Fetch Benchling secret
        logger.info("Fetching Benchling secret", secret_identifier=benchling_secret)
        secret = resolve_and_fetch_secret(sm_client, parsed.region, benchling_secret)
        logger.debug("Retrieved Benchling secret")

        # Step 6: Resolve catalog URL
        catalog = self._resolve_catalog_url(outputs)

        # Step 6.5: Normalize queue identifier
        queue_identifier = (
            outputs.get("PackagerQueueUrl")
            or outputs.get("QueueUrl")
            or outputs.get("PackagerQueueArn")
        )

        queue_url = to_queue_url(queue_identifier)

        if not queue_url or not is_queue_url(queue_url):
            raise ConfigResolverError(
                "Missing SQS queue URL in CloudFormation outputs",
                "Ensure your Quilt stack exports PackagerQueueUrl or PackagerQueueArn",
                f"Available outputs: {', '.join(outputs.keys())}",
            )

        # Step 7: Assemble complete configuration
        config = ResolvedConfig(
            # AWS Context (from ARN parsing)
            aws_region=parsed.region,
            aws_account=parsed.account,
            # Infrastructure (from CloudFormation outputs)
            quilt_catalog=catalog,
            quilt_database=outputs["UserAthenaDatabaseName"],
            queue_url=queue_url,
            # Runtime Configuration (from Benchling secret - all 10 parameters)
            benchling_tenant=secret.tenant,
            benchling_client_id=secret.client_id,
            benchling_client_secret=secret.client_secret,
            benchling_app_definition_id=secret.app_definition_id,
            pkg_prefix=secret.pkg_prefix,
            pkg_key=secret.pkg_key,
            user_bucket=secret.user_bucket,
            log_level=secret.log_level,
            enable_webhook_verification=secret.enable_webhook_verification,
            webhook_allow_list=secret.webhook_allow_list,
            # Optional infrastructure outputs
            benchling_api_url=outputs.get("ApiGatewayEndpoint"),
        )

        # Cache for container lifetime
        self._cache = config

        logger.info(
            "Configuration resolved successfully",
            region=config.aws_region,
            catalog=config.quilt_catalog,
            database=config.quilt_database,
        )

        return config

    def _validate_required_outputs(self, outputs: Dict[str, str]) -> None:
        """Validate that required CloudFormation outputs are present.

        USER_BUCKET now comes from secret, not CloudFormation.
        """
        missing = []

        if "UserAthenaDatabaseName" not in outputs or not outputs.get("UserAthenaDatabaseName"):
            missing.append("UserAthenaDatabaseName")

        if not (
            outputs.get("PackagerQueueUrl")
            or outputs.get("QueueUrl")
            or outputs.get("PackagerQueueUrl")
        ):
            missing.append("PackagerQueueUrl or PackagerQueueUrl")

        if missing:
            raise ConfigResolverError(
                f"Missing required CloudFormation outputs: {', '.join(missing)}",
                "Ensure your Quilt stack exports these outputs",
                f"Available outputs: {', '.join(outputs.keys())}",
            )

    def _resolve_catalog_url(self, outputs: Dict[str, str]) -> str:
        """Resolve catalog URL from stack outputs."""
        # Option 1: Direct from QuiltWebHost (preferred for Quilt stacks)
        if "QuiltWebHost" in outputs:
            return self._normalize_catalog_url(outputs["QuiltWebHost"])

        # Option 2: Direct from Catalog or CatalogDomain output
        if "Catalog" in outputs:
            return self._normalize_catalog_url(outputs["Catalog"])

        if "CatalogDomain" in outputs:
            return self._normalize_catalog_url(outputs["CatalogDomain"])

        # Option 3: Extract from API Gateway endpoint
        if "ApiGatewayEndpoint" in outputs:
            try:
                parsed = urlparse(outputs["ApiGatewayEndpoint"])
                return parsed.hostname or parsed.netloc
            except Exception:
                pass  # Fall through to error

        raise ConfigResolverError(
            "Cannot determine catalog URL",
            'Stack must export "QuiltWebHost", "Catalog", "CatalogDomain", or "ApiGatewayEndpoint"',
        )

    def _normalize_catalog_url(self, url: str) -> str:
        """Normalize catalog URL to hostname only (remove protocol and trailing slash)."""
        return url.replace("https://", "").replace("http://", "").rstrip("/")

    def clear_cache(self) -> None:
        """Clear cached configuration (for testing only)."""
        self._cache = None
