import os
from dataclasses import dataclass
from typing import Optional

import boto3
import structlog
from botocore.config import Config as BotocoreConfig

from .secrets_manager import BenchlingSecretData, fetch_benchling_secret

logger = structlog.get_logger(__name__)


@dataclass
class Config:
    """Application configuration - hybrid approach with on-demand secret fetching.

    v1.2.0+: Secrets fetched on-demand per request (no caching)

    Quilt/AWS configuration comes from environment variables (set by XDG Launch or CDK):
        - QUILT_WEB_HOST, ATHENA_USER_DATABASE, PACKAGER_SQS_URL, etc.
        - QUILT_WRITE_ROLE_ARN (optional, for cross-account access)

    Benchling credentials come from AWS Secrets Manager (fetched on EVERY request):
        - BenchlingSecret environment variable points to the secret name
        - Secret contains: tenant, client_id, client_secret, app_definition_id, etc.
        - Secrets are NOT cached - fresh fetch on every webhook for instant rotation

    No CloudFormation queries! Only Secrets Manager for Benchling credentials.
    """

    app_env: str = ""
    log_level: str = ""
    aws_region: str = ""
    s3_bucket_name: str = ""
    s3_prefix: str = ""
    package_key: str = ""
    quilt_catalog: str = ""
    quilt_database: str = ""
    queue_url: str = ""
    athena_user_workgroup: str = ""
    athena_results_bucket: str = ""
    enable_webhook_verification: bool = True
    webhook_allow_list: str = ""
    pkg_prefix: str = ""
    quilt_write_role_arn: str = ""

    # Secret fetching infrastructure (not the secrets themselves)
    _benchling_secret_name: str = ""
    _sm_client: Optional[object] = None
    _test_mode: bool = False

    def __post_init__(self):
        """Initialize configuration from environment variables.

        NOTE: Benchling secrets are NOT fetched here - they are fetched on-demand
        via get_benchling_secrets() to enable instant rotation without restart.

        Required environment variables (Quilt/AWS services):
            - QUILT_WEB_HOST: Quilt catalog URL
            - ATHENA_USER_DATABASE: Athena database name
            - PACKAGER_SQS_URL: SQS queue URL for package creation
            - AWS_REGION: AWS region
            - BenchlingSecret: Secrets Manager secret name for Benchling credentials

        Optional environment variables:
            - APP_ENV: Application environment (default: production)
            - LOG_LEVEL: Logging level (default: INFO)
            - ENABLE_WEBHOOK_VERIFICATION: Enable Lambda authorizer verification (default: true)
            - BENCHLING_TEST_MODE: Disable verification for testing workflows (default: false)
            - ATHENA_USER_WORKGROUP: Athena workgroup (default: primary, v0.8.0+)
            - ATHENA_RESULTS_BUCKET: Athena results S3 bucket (default: "", v0.8.0+)
            - QUILT_WRITE_ROLE_ARN: IAM role ARN for S3 access (default: "", v1.1.0+)

        Package configuration (bucket, prefix, metadata_key) comes from Secrets Manager.
        Security configuration (webhook_allow_list) comes from Secrets Manager.
        """
        # Read Quilt service environment variables (NO CLOUDFORMATION!)
        self.quilt_catalog = os.getenv("QUILT_WEB_HOST", "")
        self.quilt_database = os.getenv("ATHENA_USER_DATABASE", "")
        self.queue_url = os.getenv("PACKAGER_SQS_URL", "")
        self.aws_region = os.getenv("AWS_REGION", "")

        # Optional IAM role ARN for cross-account S3 access (v1.1.0+)
        self.quilt_write_role_arn = os.getenv("QUILT_WRITE_ROLE_ARN", "")

        # Optional Quilt service configuration (v0.8.0+)
        # These are used by PackageQuery for Athena queries
        self.athena_user_workgroup = os.getenv("ATHENA_USER_WORKGROUP", "primary")
        self.athena_results_bucket = os.getenv("ATHENA_RESULTS_BUCKET", "")

        # Package configuration - initialized to defaults, will be set from on-demand secret fetch
        self.s3_bucket_name = ""
        self.s3_prefix = "benchling"
        self.package_key = "experiment_id"
        self.pkg_prefix = "benchling"

        # Application configuration
        self.app_env = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "production"))
        self.log_level = os.getenv("LOG_LEVEL", "INFO")

        # Security configuration - propagated to API Gateway Lambda authorizer
        enable_verification = os.getenv("ENABLE_WEBHOOK_VERIFICATION", "true").lower()
        self.enable_webhook_verification = enable_verification in ("true", "1", "yes")
        self.webhook_allow_list = ""  # Will be set from on-demand secret fetch

        # Test mode override: disable webhook verification for local integration tests
        self._test_mode = os.getenv("BENCHLING_TEST_MODE", "").lower() in ("true", "1", "yes")
        if self._test_mode:
            self.enable_webhook_verification = False
            self.webhook_allow_list = ""

        # Store secret name and client for on-demand fetching
        self._benchling_secret_name = os.getenv("BenchlingSecret", "")
        if not self._benchling_secret_name:
            raise ValueError(
                "Missing required environment variable: BenchlingSecret\n"
                "\n"
                "BenchlingSecret must be set to the name of your AWS Secrets Manager secret.\n"
                "Example: BenchlingSecret=benchling-webhook-prod\n"
                "\n"
                "The secret should contain Benchling credentials in JSON format:\n"
                "{\n"
                '  "tenant": "your-tenant",\n'
                '  "client_id": "...",\n'
                '  "client_secret": "...",\n'
                '  "app_definition_id": "...",\n'
                '  "pkg_prefix": "benchling",\n'
                '  "pkg_key": "experiment_id",\n'
                '  "user_bucket": "s3-bucket-name",\n'
                '  "log_level": "INFO",\n'
                '  "enable_webhook_verification": "true",\n'
                '  "webhook_allow_list": ""\n'
                "}\n"
            )

        # Create Secrets Manager client for on-demand fetching
        session = boto3.Session(region_name=self.aws_region)
        self._sm_client = session.client(
            "secretsmanager",
            config=BotocoreConfig(
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=5,
                read_timeout=10,
            ),
        )

        # Validate required environment variable fields only
        self._validate_env_vars()

    def _validate_env_vars(self):
        """Validate required environment variable fields (not secrets)."""
        required = {
            "QUILT_WEB_HOST": self.quilt_catalog,
            "ATHENA_USER_DATABASE": self.quilt_database,
            "PACKAGER_SQS_URL": self.queue_url,
            "AWS_REGION": self.aws_region,
        }

        missing = [key for key, value in required.items() if not value]

        if missing:
            raise ValueError(
                f"Missing required configuration: {', '.join(missing)}\n"
                "\n"
                "Required environment variables:\n"
                "  - QUILT_WEB_HOST: Quilt catalog URL (e.g., https://example.quiltdata.com)\n"
                "  - ATHENA_USER_DATABASE: Athena database name\n"
                "  - PACKAGER_SQS_URL: SQS queue URL\n"
                "  - AWS_REGION: AWS region (e.g., us-east-1)\n"
                "  - BenchlingSecret: Secrets Manager secret name\n"
                "\n"
                "Package configuration comes from AWS Secrets Manager.\n"
                "\n"
                "For local development, use:\n"
                "  npm run test:local\n"
                "\n"
                "For production deployment, these are set automatically by CDK.\n"
            )

    def get_benchling_secrets(self) -> BenchlingSecretData:
        """Fetch Benchling secrets from Secrets Manager on-demand.

        This method fetches fresh secrets on EVERY call, enabling instant rotation
        without container restart. The latency cost (~100-500ms) is acceptable
        compared to 40-second JWKS fetches and overall webhook processing time.

        Returns:
            BenchlingSecretData with current secret values from Secrets Manager

        Raises:
            SecretsManagerError: If secret fetch fails
        """
        logger.debug(
            "Fetching Benchling secrets on-demand (no cache)",
            secret_name=self._benchling_secret_name,
        )

        secret_data = fetch_benchling_secret(
            self._sm_client,
            self.aws_region,
            self._benchling_secret_name,
        )

        logger.debug(
            "Benchling secrets fetched successfully",
            has_tenant=bool(secret_data.tenant),
            has_client_id=bool(secret_data.client_id),
            has_client_secret=bool(secret_data.client_secret),
            has_app_definition_id=bool(secret_data.app_definition_id),
        )

        return secret_data

    def apply_benchling_secrets(self, secret_data: BenchlingSecretData) -> None:
        """Apply fetched secrets to config instance fields.

        This updates the config instance with fresh secret values. Called after
        get_benchling_secrets() to populate instance fields for backward compatibility.

        Args:
            secret_data: Fresh secret data from Secrets Manager
        """
        # Set package/security config from secret (NOT environment variables!)
        if not self._test_mode:
            # Package configuration ALWAYS comes from secret
            self.s3_bucket_name = secret_data.user_bucket
            self.s3_prefix = secret_data.pkg_prefix or "benchling"
            self.pkg_prefix = self.s3_prefix
            self.package_key = secret_data.pkg_key or "experiment_id"

            # Security configuration ALWAYS comes from secret
            self.enable_webhook_verification = secret_data.enable_webhook_verification
            self.webhook_allow_list = secret_data.webhook_allow_list

            # Log level from secret
            if secret_data.log_level:
                self.log_level = secret_data.log_level


def get_config() -> Config:
    """Get configuration instance with on-demand secret fetching.

    NOTE: This returns a Config instance that does NOT have Benchling secrets
    populated. Call config.get_benchling_secrets() to fetch fresh secrets on-demand.
    """
    return Config()
