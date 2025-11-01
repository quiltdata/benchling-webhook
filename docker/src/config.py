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

    def __post_init__(self):
        """Initialize configuration from AWS CloudFormation and Secrets Manager.

        Requires environment variables:
            - QuiltStackARN: CloudFormation stack ARN for Quilt infrastructure
            - BenchlingSecret: Secrets Manager secret name for Benchling credentials

        All other configuration is automatically resolved from AWS.
        """
        quilt_stack_arn = os.getenv("QuiltStackARN")
        benchling_secret = os.getenv("BenchlingSecret")

        if not quilt_stack_arn or not benchling_secret:
            raise ValueError(
                "Missing required environment variables: QuiltStackARN and BenchlingSecret\n"
                "\n"
                "Secrets-only mode requires exactly 2 environment variables:\n"
                "  - QuiltStackARN: CloudFormation stack ARN (e.g., arn:aws:cloudformation:...)\n"
                "  - BenchlingSecret: Secrets Manager secret name (e.g., benchling-webhook-prod)\n"
                "\n"
                "All other configuration is automatically resolved from AWS.\n"
            )

        # Resolve all configuration from AWS
        try:
            resolver = ConfigResolver()
            resolved = resolver.resolve(quilt_stack_arn, benchling_secret)

            # Map resolved config to Config fields
            self.aws_region = resolved.aws_region
            self.s3_bucket_name = resolved.quilt_user_bucket
            self.s3_prefix = resolved.pkg_prefix
            self.package_key = resolved.pkg_key
            self.quilt_catalog = resolved.quilt_catalog
            self.quilt_database = resolved.quilt_database
            self.queue_arn = resolved.queue_arn
            self.benchling_tenant = resolved.benchling_tenant
            self.benchling_client_id = resolved.benchling_client_id
            self.benchling_client_secret = resolved.benchling_client_secret
            self.benchling_app_definition_id = resolved.benchling_app_definition_id or ""
            self.enable_webhook_verification = resolved.enable_webhook_verification
            self.log_level = resolved.log_level
            self.flask_env = "production"

        except (ConfigResolverError, ValueError) as e:
            raise ValueError(f"Failed to resolve configuration from AWS: {str(e)}")


def get_config() -> Config:
    return Config()
