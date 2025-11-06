import os
from dataclasses import dataclass

from .config_resolver import ConfigResolver, ConfigResolverError


@dataclass
class Config:
    """Application configuration - production uses secrets-only mode.

    In production (ECS/Fargate):
        - Only requires QuiltStackARN and BenchlingSecret environment variables
        - All other configuration derived from AWS CloudFormation and Secrets Manager

    In tests:
        - ConfigResolver is mocked to return test data
        - No environment variables needed
    """

    flask_env: str = ""
    log_level: str = ""
    aws_region: str = ""
    s3_bucket_name: str = ""
    s3_prefix: str = ""
    package_key: str = ""
    quilt_catalog: str = ""
    quilt_database: str = ""
    queue_arn: str = ""
    benchling_tenant: str = ""
    benchling_client_id: str = ""
    benchling_client_secret: str = ""
    benchling_app_definition_id: str = ""
    enable_webhook_verification: bool = True
    webhook_allow_list: str = ""
    pkg_prefix: str = ""

    def __post_init__(self):
        """Initialize configuration from AWS or environment variables.

        Two modes supported:
        1. Production mode (secrets-only):
            - Requires: QuiltStackARN and BenchlingSecret environment variables
            - All other configuration resolved from AWS CloudFormation and Secrets Manager

        2. Local/testing mode (direct config):
            - Requires: All configuration provided via environment variables
            - Used for local development and integration testing
        """
        quilt_stack_arn = os.getenv("QuiltStackARN") or os.getenv("QUILT_STACK_ARN")
        benchling_secret = os.getenv("BenchlingSecret")

        # Check if we have direct configuration (local/testing mode)
        has_direct_config = all(
            [
                os.getenv("BENCHLING_TENANT"),
                os.getenv("BENCHLING_CLIENT_ID"),
                os.getenv("BENCHLING_CLIENT_SECRET"),
                os.getenv("QUILT_QUEUE_ARN"),
            ]
        )

        if has_direct_config:
            # Local/testing mode: read from environment variables directly
            self.aws_region = os.getenv("AWS_REGION", "us-east-1")
            self.s3_bucket_name = os.getenv("PACKAGES_BUCKET", "")
            self.s3_prefix = os.getenv("PACKAGES_PREFIX", "benchling")
            self.package_key = os.getenv("METADATA_KEY", "experiment_id")
            self.quilt_catalog = os.getenv("QUILT_CATALOG", "")
            self.quilt_database = os.getenv("QUILT_DATABASE", "")
            self.queue_arn = os.getenv("QUILT_QUEUE_ARN", "")
            self.benchling_tenant = os.getenv("BENCHLING_TENANT", "")
            self.benchling_client_id = os.getenv("BENCHLING_CLIENT_ID", "")
            self.benchling_client_secret = os.getenv("BENCHLING_CLIENT_SECRET", "")
            self.benchling_app_definition_id = os.getenv("BENCHLING_APP_DEFINITION_ID", "")
            self.pkg_prefix = os.getenv("PACKAGES_PREFIX", "benchling")
            self.log_level = os.getenv("LOG_LEVEL", "INFO")
            self.flask_env = os.getenv("FLASK_ENV", "development")

            # Disable webhook verification for local testing
            self.enable_webhook_verification = False
            self.webhook_allow_list = ""

        elif quilt_stack_arn and benchling_secret:
            # Production mode: resolve from AWS
            try:
                resolver = ConfigResolver()
                resolved = resolver.resolve(quilt_stack_arn, benchling_secret)

                # Map resolved config to Config fields
                self.aws_region = resolved.aws_region
                self.s3_bucket_name = resolved.user_bucket
                self.s3_prefix = resolved.pkg_prefix
                self.package_key = resolved.pkg_key
                self.quilt_catalog = resolved.quilt_catalog
                self.quilt_database = resolved.quilt_database
                self.queue_arn = resolved.queue_arn
                self.benchling_tenant = resolved.benchling_tenant
                self.benchling_client_id = resolved.benchling_client_id
                self.benchling_client_secret = resolved.benchling_client_secret
                self.benchling_app_definition_id = resolved.benchling_app_definition_id
                self.pkg_prefix = resolved.pkg_prefix
                self.log_level = resolved.log_level
                self.flask_env = "production"

                # Test mode override: disable webhook verification for integration tests
                test_mode = os.getenv("BENCHLING_TEST_MODE", "").lower() in ("true", "1", "yes")
                if test_mode:
                    self.enable_webhook_verification = False
                    self.webhook_allow_list = ""
                else:
                    self.enable_webhook_verification = resolved.enable_webhook_verification
                    self.webhook_allow_list = resolved.webhook_allow_list

            except (ConfigResolverError, ValueError) as e:
                raise ValueError(f"Failed to resolve configuration from AWS: {str(e)}")

        else:
            raise ValueError(
                "Missing required configuration.\n"
                "\n"
                "Two modes supported:\n"
                "1. Production mode (secrets-only):\n"
                "     - QuiltStackARN: CloudFormation stack ARN\n"
                "     - BenchlingSecret: Secrets Manager secret name\n"
                "\n"
                "2. Local/testing mode (direct config):\n"
                "     - BENCHLING_TENANT, BENCHLING_CLIENT_ID, BENCHLING_CLIENT_SECRET\n"
                "     - QUILT_QUEUE_ARN, QUILT_CATALOG, QUILT_DATABASE\n"
                "     - PACKAGES_BUCKET, PACKAGES_PREFIX, METADATA_KEY\n"
            )


def get_config() -> Config:
    return Config()
