import os
from dataclasses import dataclass


@dataclass
class Config:
    flask_env: str = os.getenv("FLASK_ENV", "development")
    aws_region: str = os.getenv("AWS_REGION", "us-east-2")
    s3_bucket_name: str = os.getenv("QUILT_USER_BUCKET", "")
    s3_prefix: str = os.getenv("PKG_PREFIX", "benchling")
    package_key: str = os.getenv("PKG_KEY", "experiment_id")
    package_bucket_only: bool = os.getenv("PKG_BUCKET_ONLY", "false").lower() == "true"
    quilt_catalog: str = os.getenv("QUILT_CATALOG", "stable.quilttest.com")
    quilt_database: str = os.getenv("QUILT_DATABASE", "")
    sqs_queue_url: str = os.getenv("SQS_QUEUE_URL", "")
    benchling_tenant: str = os.getenv("BENCHLING_TENANT", "")
    benchling_client_id: str = os.getenv("BENCHLING_CLIENT_ID", "")
    benchling_client_secret: str = os.getenv("BENCHLING_CLIENT_SECRET", "")
    benchling_app_definition_id: str = os.getenv("BENCHLING_APP_DEFINITION_ID", "")
    enable_webhook_verification: bool = os.getenv("ENABLE_WEBHOOK_VERIFICATION", "true").lower() == "true"

    def __post_init__(self):
        # Required fields for Python orchestration
        required_fields = [
            "aws_region",
            "s3_bucket_name",
            "sqs_queue_url",
        ]

        missing = [field for field in required_fields if not getattr(self, field)]
        if missing:
            raise ValueError(f"Missing required configuration: {', '.join(missing)}")

        # Require app_definition_id when webhook verification is enabled
        if self.enable_webhook_verification and not self.benchling_app_definition_id:
            raise ValueError(
                "BENCHLING_APP_DEFINITION_ID is required when ENABLE_WEBHOOK_VERIFICATION=true. "
                "Either provide the app definition ID or set ENABLE_WEBHOOK_VERIFICATION=false for local development."
            )


def get_config() -> Config:
    return Config()
