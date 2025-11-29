import os
from dataclasses import dataclass

import boto3
from botocore.config import Config as BotocoreConfig

from .secrets_manager import fetch_benchling_secret


@dataclass
class Config:
    """Application configuration - hybrid approach.

    v0.8.0+: Service-specific environment variables + Secrets Manager for Benchling

    Quilt/AWS configuration comes from environment variables (set by XDG Launch or CDK):
        - QUILT_WEB_HOST, ATHENA_USER_DATABASE, PACKAGER_SQS_URL, etc.
        - QUILT_WRITE_ROLE_ARN (optional, for cross-account access)

    Benchling credentials come from AWS Secrets Manager:
        - BenchlingSecret environment variable points to the secret name
        - Secret contains: tenant, client_id, client_secret, app_definition_id, etc.

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
    iceberg_database: str = ""
    iceberg_workgroup: str = ""
    benchling_tenant: str = ""
    benchling_client_id: str = ""
    benchling_client_secret: str = ""
    benchling_app_definition_id: str = ""
    enable_webhook_verification: bool = True
    webhook_allow_list: str = ""
    pkg_prefix: str = ""
    quilt_write_role_arn: str = ""

    def __post_init__(self):
        """Initialize configuration from environment variables and Secrets Manager.

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
            - ICEBERG_DATABASE: Iceberg database name (default: "", v0.8.0+)
            - ICEBERG_WORKGROUP: Iceberg Athena workgroup (default: "", v0.8.0+)
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
        # These are used by PackageQuery for Athena/Iceberg queries
        self.athena_user_workgroup = os.getenv("ATHENA_USER_WORKGROUP", "primary")
        self.athena_results_bucket = os.getenv("ATHENA_RESULTS_BUCKET", "")
        self.iceberg_database = os.getenv("ICEBERG_DATABASE", "")
        self.iceberg_workgroup = os.getenv("ICEBERG_WORKGROUP", "")

        # Package configuration - initialized to defaults, will be set from Secrets Manager
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
        self.webhook_allow_list = ""  # Will be set from Secrets Manager

        # Test mode override: disable webhook verification for local integration tests
        test_mode = os.getenv("BENCHLING_TEST_MODE", "").lower() in ("true", "1", "yes")
        if test_mode:
            self.enable_webhook_verification = False
            self.webhook_allow_list = ""

        # Fetch Benchling credentials from Secrets Manager
        benchling_secret = os.getenv("BenchlingSecret")
        if not benchling_secret:
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

        # Fetch secret from Secrets Manager
        # Use a session with proper credential caching to avoid signature expiration
        # during container startup (especially important for ECS Fargate)
        session = boto3.Session(region_name=self.aws_region)
        sm_client = session.client(
            "secretsmanager",
            config=BotocoreConfig(
                retries={"max_attempts": 3, "mode": "standard"},
                # Use a longer timeout to handle slow network conditions
                connect_timeout=5,
                read_timeout=10,
            ),
        )
        secret_data = fetch_benchling_secret(sm_client, self.aws_region, benchling_secret)

        # Set Benchling configuration from secret
        self.benchling_tenant = secret_data.tenant
        self.benchling_client_id = secret_data.client_id
        self.benchling_client_secret = secret_data.client_secret
        self.benchling_app_definition_id = secret_data.app_definition_id

        # Set package/security config from secret (NOT environment variables!)
        if not test_mode:
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

        # Validate required fields
        self._validate()

    def _validate(self):
        """Validate required configuration fields."""
        required = {
            "QUILT_WEB_HOST": self.quilt_catalog,
            "ATHENA_USER_DATABASE": self.quilt_database,
            "PACKAGER_SQS_URL": self.queue_url,
            "AWS_REGION": self.aws_region,
            "benchling_tenant": self.benchling_tenant,
            "benchling_client_id": self.benchling_client_id,
            "benchling_client_secret": self.benchling_client_secret,
            "benchling_app_definition_id": self.benchling_app_definition_id,
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


def get_config() -> Config:
    return Config()
