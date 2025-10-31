import os
from dataclasses import dataclass

from .secrets_resolver import SecretsResolutionError, resolve_benchling_secrets


@dataclass
class Config:
    flask_env: str = ""
    log_level: str = ""
    aws_region: str = ""
    s3_bucket_name: str = ""
    s3_prefix: str = ""
    package_key: str = ""
    quilt_catalog: str = ""
    quilt_database: str = ""
    queue_arn: str = ""
    benchling_tenant: str = ""  # Will be resolved in __post_init__
    benchling_client_id: str = ""  # Will be resolved in __post_init__
    benchling_client_secret: str = ""  # Will be resolved in __post_init__
    benchling_app_definition_id: str = ""  # Will be resolved in __post_init__
    enable_webhook_verification: bool = True

    def __post_init__(self):
        # Read environment variables at instantiation time (not import time)
        # This allows tests to override environment variables via monkeypatch
        self.flask_env = os.getenv("FLASK_ENV", "development")
        self.log_level = os.getenv("LOG_LEVEL", "INFO")
        self.aws_region = os.getenv("AWS_REGION", "us-east-2")
        self.s3_bucket_name = os.getenv("QUILT_USER_BUCKET", "")
        self.s3_prefix = os.getenv("PKG_PREFIX", "benchling")
        self.package_key = os.getenv("PKG_KEY", "experiment_id")
        self.quilt_catalog = os.getenv("QUILT_CATALOG", "stable.quilttest.com")
        self.quilt_database = os.getenv("QUILT_DATABASE", "")
        self.queue_arn = os.getenv("QUEUE_ARN", "")
        self.benchling_app_definition_id = os.getenv("BENCHLING_APP_DEFINITION_ID", "")
        self.enable_webhook_verification = os.getenv("ENABLE_WEBHOOK_VERIFICATION", "true").lower() == "true"
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
