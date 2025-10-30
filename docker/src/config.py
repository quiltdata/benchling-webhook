import os
from dataclasses import dataclass


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
    queue_url: str = os.getenv("QUEUE_URL", "")
    benchling_tenant: str = os.getenv("BENCHLING_TENANT", "")
    benchling_client_id: str = os.getenv("BENCHLING_CLIENT_ID", "")
    benchling_client_secret: str = os.getenv("BENCHLING_CLIENT_SECRET", "")
    benchling_app_definition_id: str = os.getenv("BENCHLING_APP_DEFINITION_ID", "")
    enable_webhook_verification: bool = os.getenv("ENABLE_WEBHOOK_VERIFICATION", "true").lower() == "true"

    def __post_init__(self):
        # Required fields - these are always needed
        required_fields = [
            # AWS & Quilt
            "aws_region",
            "s3_bucket_name",
            "queue_url",
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
