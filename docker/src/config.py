import os
from dataclasses import dataclass

from .secrets_resolver import SecretsResolutionError, resolve_benchling_secrets


@dataclass
class Config:
    flask_env: str = os.getenv("FLASK_ENV", "development")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    aws_region: str = os.getenv("AWS_REGION", "us-east-2")
    s3_bucket_name: str = os.getenv("QUILT_USER_BUCKET", "")
    s3_prefix: str = os.getenv("PKG_PREFIX", "benchling")
    package_key: str = os.getenv("PKG_KEY", "experiment_id")
    quilt_catalog: str = os.getenv("QUILT_CATALOG", "stable.quilttest.com")
    quilt_database: str = os.getenv("QUILT_DATABASE", "")
    queue_arn: str = os.getenv("QUEUE_ARN", "")
    benchling_tenant: str = ""  # Will be resolved in __post_init__
    benchling_client_id: str = ""  # Will be resolved in __post_init__
    benchling_client_secret: str = ""  # Will be resolved in __post_init__
    benchling_app_definition_id: str = os.getenv("BENCHLING_APP_DEFINITION_ID", "")
    enable_webhook_verification: bool = os.getenv("ENABLE_WEBHOOK_VERIFICATION", "true").lower() == "true"

    def __post_init__(self):
        # Resolve Benchling secrets first using the secrets resolver
        try:
            secrets = resolve_benchling_secrets(self.aws_region)
            self.benchling_tenant = secrets.tenant
            self.benchling_client_id = secrets.client_id
            self.benchling_client_secret = secrets.client_secret
        except SecretsResolutionError as e:
            raise ValueError(f"Failed to resolve Benchling secrets: {str(e)}")

        # Required fields - these are always needed (validation after resolution)
        required_fields = [
            # AWS & Quilt
            "aws_region",
            "s3_bucket_name",
            "queue_arn",
            "quilt_catalog",
            # Benchling
            "benchling_tenant",
            "benchling_client_id",
            "benchling_client_secret",
            "benchling_app_definition_id",
        ]

        missing = [field for field in required_fields if not getattr(self, field)]
        if missing:
            raise ValueError(f"Missing required configuration: {', '.join(missing)}")


def get_config() -> Config:
    return Config()
