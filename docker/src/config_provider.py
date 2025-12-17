"""Configuration provider with on-demand secret fetching.

This module provides a ConfigProvider that wraps Config and fetches secrets
on-demand for each request, enabling instant secret rotation without restart.
"""

import structlog
from benchling_sdk.auth.client_credentials_oauth2 import ClientCredentialsOAuth2
from benchling_sdk.benchling import Benchling

from .config import Config
from .secrets_manager import BenchlingSecretData

logger = structlog.get_logger(__name__)


class ConfigProvider:
    """Provides configuration with on-demand secret fetching.

    This class wraps a Config instance and fetches fresh secrets from
    Secrets Manager on every call to get_benchling_secrets(). This enables
    instant secret rotation without container restarts.

    Usage:
        provider = ConfigProvider(config)
        secrets = provider.get_benchling_secrets()  # Fresh fetch every time
        benchling = provider.create_benchling_client()
    """

    def __init__(self, config: Config):
        """Initialize provider with config instance.

        Args:
            config: Config instance with Secrets Manager client configured
        """
        self.config = config
        self._last_secrets: BenchlingSecretData | None = None

    def get_benchling_secrets(self) -> BenchlingSecretData:
        """Fetch fresh Benchling secrets from Secrets Manager.

        Returns:
            BenchlingSecretData with current secret values

        Raises:
            SecretsManagerError: If secret fetch fails
        """
        logger.debug("ConfigProvider: fetching fresh secrets on-demand")
        secrets = self.config.get_benchling_secrets()
        self._last_secrets = secrets

        # Apply secrets to config instance for backward compatibility
        self.config.apply_benchling_secrets(secrets)

        return secrets

    def create_benchling_client(self) -> Benchling:
        """Create Benchling SDK client with fresh secrets.

        Fetches current secrets and creates a new Benchling client instance.

        Returns:
            Benchling SDK client with current credentials
        """
        secrets = self.get_benchling_secrets()

        auth_method = ClientCredentialsOAuth2(
            client_id=secrets.client_id,
            client_secret=secrets.client_secret,
        )

        benchling = Benchling(url=f"https://{secrets.tenant}.benchling.com", auth_method=auth_method)

        logger.debug(
            "Created Benchling client with fresh credentials",
            tenant=secrets.tenant,
            has_client_id=bool(secrets.client_id),
        )

        return benchling

    @property
    def benchling_app_definition_id(self) -> str:
        """Get app_definition_id from last fetched secrets.

        Returns empty string if secrets haven't been fetched yet.
        """
        if self._last_secrets:
            return self._last_secrets.app_definition_id
        # Fallback: fetch secrets if not already done
        secrets = self.get_benchling_secrets()
        return secrets.app_definition_id

    @property
    def enable_webhook_verification(self) -> bool:
        """Get webhook verification setting from config."""
        return self.config.enable_webhook_verification

    @property
    def s3_bucket_name(self) -> str:
        """Get S3 bucket name from config."""
        return self.config.s3_bucket_name

    @property
    def benchling_tenant(self) -> str:
        """Get Benchling tenant from last fetched secrets."""
        if self._last_secrets:
            return self._last_secrets.tenant
        secrets = self.get_benchling_secrets()
        return secrets.tenant

    @property
    def benchling_client_id(self) -> str:
        """Get Benchling client ID from last fetched secrets."""
        if self._last_secrets:
            return self._last_secrets.client_id
        secrets = self.get_benchling_secrets()
        return secrets.client_id

    @property
    def benchling_client_secret(self) -> str:
        """Get Benchling client secret from last fetched secrets."""
        if self._last_secrets:
            return self._last_secrets.client_secret
        secrets = self.get_benchling_secrets()
        return secrets.client_secret
