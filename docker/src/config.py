import os
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import boto3
import structlog
from botocore.config import Config as BotocoreConfig

from .secrets_manager import BenchlingSecretData, fetch_benchling_secret

# Default TTL for cached secrets (seconds).
# Secrets are refreshed after this interval, balancing rotation speed vs latency.
# Secrets Manager calls can take 10-30s in VPC environments without a VPC endpoint,
# so caching avoids per-request latency that exceeds the 29s API Gateway timeout.
SECRETS_CACHE_TTL_SECONDS = 60

logger = structlog.get_logger(__name__)


@dataclass
class Config:
    """Application configuration - hybrid approach with on-demand secret fetching.

    v1.2.0+: Secrets fetched on-demand with TTL cache (default 60s)

    Quilt/AWS configuration comes from environment variables (set by XDG Launch or CDK):
        - QUILT_WEB_HOST, ATHENA_USER_DATABASE, PACKAGER_SQS_URL, etc.
        - QUILT_WRITE_ROLE_ARN (optional, for cross-account access)

    Benchling credentials come from AWS Secrets Manager (cached with TTL):
        - BenchlingSecret environment variable points to the secret name
        - Secret contains: tenant, client_id, client_secret, app_definition_id, etc.
        - Secrets are cached for SECRETS_CACHE_TTL_SECONDS (default 60s)
        - Rotation takes effect within one TTL interval (no restart needed)

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
    enable_webhook_verification: bool = True
    pkg_prefix: str = ""
    workflow: str = ""
    quilt_write_role_arn: str = ""

    # Secret fetching infrastructure (not the secrets themselves)
    _benchling_secret_name: str = ""
    _sm_client: Optional[object] = None
    _test_mode: bool = False

    # TTL cache for Secrets Manager responses with background refresh
    _cached_secrets: Optional[BenchlingSecretData] = field(default=None, repr=False)
    _cache_timestamp: float = 0.0
    _cache_ttl: float = SECRETS_CACHE_TTL_SECONDS
    _refresh_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _refresh_in_progress: bool = False

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
              Query results are managed automatically by the workgroup's AWS-managed configuration.
            - QUILT_WRITE_ROLE_ARN: IAM role ARN for S3 access (default: "", v1.1.0+)

        Package configuration (bucket, prefix, metadata_key) comes from Secrets Manager.
        """
        # Read Quilt service environment variables (NO CLOUDFORMATION!)
        self.quilt_catalog = os.getenv("QUILT_WEB_HOST", "")
        self.quilt_database = os.getenv("ATHENA_USER_DATABASE", "")
        self.queue_url = os.getenv("PACKAGER_SQS_URL", "")
        self.aws_region = os.getenv("AWS_REGION", "")

        # Optional IAM role ARN for cross-account S3 access (v1.1.0+)
        self.quilt_write_role_arn = os.getenv("QUILT_WRITE_ROLE_ARN", "")

        # Optional Quilt service configuration (v0.8.0+)
        # Used by PackageQuery for Athena queries
        # Query results are managed automatically by the workgroup's AWS-managed configuration
        self.athena_user_workgroup = os.getenv("ATHENA_USER_WORKGROUP", "primary")

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

        # Test mode override: disable webhook verification for local integration tests
        self._test_mode = os.getenv("BENCHLING_TEST_MODE", "").lower() in ("true", "1", "yes")
        if self._test_mode:
            self.enable_webhook_verification = False

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
                '  "enable_webhook_verification": "true"\n'
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

    def _fetch_and_cache_secrets(self) -> BenchlingSecretData:
        """Fetch secrets from Secrets Manager and update the cache.

        This is the core fetch logic, used by both synchronous and background paths.
        """
        secret_data = fetch_benchling_secret(
            self._sm_client,
            self.aws_region,
            self._benchling_secret_name,
        )

        self._cached_secrets = secret_data
        self._cache_timestamp = time.monotonic()

        logger.info(
            "Benchling secrets cached",
            has_tenant=bool(secret_data.tenant),
            has_client_id=bool(secret_data.client_id),
            has_client_secret=bool(secret_data.client_secret),
            has_app_definition_id=bool(secret_data.app_definition_id),
            cache_ttl=self._cache_ttl,
        )

        return secret_data

    def _background_refresh(self) -> None:
        """Refresh secrets in a background thread."""
        try:
            logger.info(
                "Background refresh of Benchling secrets started",
                secret_name=self._benchling_secret_name,
            )
            self._fetch_and_cache_secrets()
        except Exception as exc:
            logger.warning(
                "Background refresh of Benchling secrets failed, serving stale cache",
                error=str(exc),
                error_type=type(exc).__name__,
                cache_age_seconds=round(time.monotonic() - self._cache_timestamp, 1),
            )
        finally:
            self._refresh_in_progress = False

    def get_benchling_secrets(self) -> BenchlingSecretData:
        """Fetch Benchling secrets from Secrets Manager with TTL cache and background refresh.

        Cache behavior:
        1. Cache valid (within TTL) → return cached value instantly
        2. Cache expired, stale value exists → return stale value, refresh in background
        3. Cache empty (first call) → block and fetch synchronously

        Case 3 is handled by startup pre-warming, so in practice no request blocks.
        Background refresh ensures that at most one SM call is in flight at a time,
        and no request ever waits on a cache miss.

        The TTL cache (default 60s) balances two concerns:
        - Secret rotation takes effect within ~TTL + fetch_time (no restart needed)
        - Avoids per-request Secrets Manager calls that can take 10-30s in VPC
          environments without a VPC endpoint, exceeding the 29s API Gateway timeout

        Returns:
            BenchlingSecretData with current secret values from Secrets Manager

        Raises:
            SecretsManagerError: If secret fetch fails and no cached value exists
        """
        now = time.monotonic()
        cache_age = now - self._cache_timestamp

        # Case 1: Cache is fresh — return immediately
        if self._cached_secrets is not None and cache_age < self._cache_ttl:
            logger.debug(
                "Using cached Benchling secrets",
                secret_name=self._benchling_secret_name,
                cache_age_seconds=round(cache_age, 1),
                cache_ttl=self._cache_ttl,
            )
            return self._cached_secrets

        # Case 2: Cache expired but we have a stale value — return stale, refresh in background
        if self._cached_secrets is not None:
            with self._refresh_lock:
                if not self._refresh_in_progress:
                    self._refresh_in_progress = True
                    thread = threading.Thread(target=self._background_refresh, daemon=True)
                    thread.start()
            logger.debug(
                "Returning stale cached secrets while background refresh runs",
                secret_name=self._benchling_secret_name,
                cache_age_seconds=round(cache_age, 1),
            )
            return self._cached_secrets

        # Case 3: No cached value — must block (startup pre-warming normally prevents this)
        logger.info(
            "Fetching Benchling secrets from Secrets Manager (no cache)",
            secret_name=self._benchling_secret_name,
        )
        return self._fetch_and_cache_secrets()

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
            self.workflow = secret_data.workflow or ""

            # Security configuration from secret, unless env var explicitly disables it
            env_override = os.getenv("ENABLE_WEBHOOK_VERIFICATION", "").lower()
            if env_override in ("false", "0", "no"):
                self.enable_webhook_verification = False
            else:
                self.enable_webhook_verification = secret_data.enable_webhook_verification

            # Log level from secret
            if secret_data.log_level:
                self.log_level = secret_data.log_level


def get_config() -> Config:
    """Get configuration instance with on-demand secret fetching.

    NOTE: This returns a Config instance that does NOT have Benchling secrets
    populated. Call config.get_benchling_secrets() to fetch fresh secrets on-demand.
    """
    return Config()
