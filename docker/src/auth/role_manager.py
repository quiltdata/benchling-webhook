"""AWS IAM role assumption manager for cross-account S3 access.

This module provides credential caching and automatic refresh for assumed roles,
enabling transparent cross-account access to Quilt S3 buckets.
"""

import socket
import time
from datetime import datetime, timedelta
from typing import Optional

import boto3
import structlog
from botocore.credentials import RefreshableCredentials
from botocore.session import Session

logger = structlog.get_logger(__name__)


class RoleManager:
    """Manages AWS role assumption for cross-account access.

    This class provides S3 clients with automatically refreshed credentials
    from an assumed IAM role. It caches credentials to avoid repeated STS calls
    and gracefully falls back to default credentials when role ARN is not provided.

    Usage:
        role_manager = RoleManager(
            role_arn="arn:aws:iam::123456789012:role/T4BucketWriteRole-XYZ"
        )

        # Get S3 client with role credentials
        s3_client = role_manager.get_s3_client()

    Attributes:
        role_arn: Optional ARN of the IAM role for S3 access
        region: AWS region for STS and S3 clients
    """

    def __init__(
        self,
        role_arn: Optional[str] = None,
        region: str = "us-east-1",
    ):
        """Initialize RoleManager with write role ARN.

        Args:
            role_arn: ARN of IAM role for S3 access (from T4BucketWriteRole)
            region: AWS region for STS and S3 clients (default: us-east-1)
        """
        # Guard against Mock objects in tests - treat them as None
        if role_arn is not None and not isinstance(role_arn, str):
            logger.warning(
                "RoleManager received non-string role_arn (likely Mock object in tests) - treating as None",
                role_arn_type=type(role_arn).__name__,
            )
            role_arn = None

        self.role_arn = role_arn
        self.region = region

        # Credential cache
        self._session: Optional[boto3.Session] = None
        self._default_session: Optional[boto3.Session] = None

        # Track credential expiration time
        self._expires_at: Optional[datetime] = None

        logger.info(
            "RoleManager initialized",
            has_role=bool(role_arn),
            region=region,
        )

    def _generate_session_name(self) -> str:
        """Generate unique session name for role assumption.

        Session names include hostname/container info for CloudTrail auditing.

        Returns:
            Session name in format: "benchling-webhook-{hostname}-{timestamp}"
        """
        try:
            hostname = socket.gethostname()
        except Exception as e:
            logger.warning(
                "Failed to get hostname for session name - using 'unknown' instead",
                error=str(e),
                error_type=type(e).__name__,
            )
            hostname = "unknown"

        # Truncate hostname to fit AWS session name limits (64 chars max)
        # Format: benchling-webhook-{hostname}-{timestamp}
        # Reserve 30 chars for prefix and timestamp, leaving 34 for hostname
        hostname = hostname[:34]

        timestamp = int(time.time())
        return f"benchling-webhook-{hostname}-{timestamp}"

    def _assume_role(self, role_arn: str) -> dict:
        """Assume IAM role and return temporary credentials.

        Args:
            role_arn: ARN of IAM role to assume

        Returns:
            Dictionary with AccessKeyId, SecretAccessKey, SessionToken, Expiration

        Raises:
            Exception: If role assumption fails
        """
        try:
            sts_client = boto3.client("sts", region_name=self.region)

            session_name = self._generate_session_name()

            logger.debug(
                "Assuming IAM role",
                role_arn=role_arn,
                session_name=session_name,
            )

            response = sts_client.assume_role(
                RoleArn=role_arn,
                RoleSessionName=session_name,
                DurationSeconds=3600,  # 1 hour (AWS default)
            )

            credentials = response["Credentials"]

            logger.info(
                "Role assumed successfully",
                role_arn=role_arn,
                expires_at=credentials["Expiration"].isoformat(),
            )

            return credentials

        except Exception as e:
            logger.error(
                "Failed to assume role",
                role_arn=role_arn,
                error=str(e),
                error_type=type(e).__name__,
            )
            raise

    def _create_session_with_assumed_role(self, role_arn: str) -> tuple[boto3.Session, datetime]:
        """Create boto3 session with refreshable credentials from assumed role.

        Uses botocore's RefreshableCredentials to automatically refresh
        credentials before they expire.

        Args:
            role_arn: ARN of IAM role to assume

        Returns:
            Tuple of (boto3.Session, expiration_datetime)
        """
        # Get initial credentials
        credentials = self._assume_role(role_arn)
        expiration = credentials["Expiration"]

        # Create refresh function for automatic credential renewal
        def refresh_credentials():
            """Refresh credentials by assuming role again."""
            logger.debug("Refreshing credentials", role_arn=role_arn)
            new_creds = self._assume_role(role_arn)
            return {
                "access_key": new_creds["AccessKeyId"],
                "secret_key": new_creds["SecretAccessKey"],
                "token": new_creds["SessionToken"],
                "expiry_time": new_creds["Expiration"].isoformat(),
            }

        # Create refreshable credentials
        session_credentials = RefreshableCredentials.create_from_metadata(
            metadata={
                "access_key": credentials["AccessKeyId"],
                "secret_key": credentials["SecretAccessKey"],
                "token": credentials["SessionToken"],
                "expiry_time": expiration.isoformat(),
            },
            refresh_using=refresh_credentials,
            method="sts-assume-role",
        )

        # Create botocore session with refreshable credentials
        botocore_session = Session()
        botocore_session._credentials = session_credentials

        # Create boto3 session from botocore session
        session = boto3.Session(botocore_session=botocore_session, region_name=self.region)

        return session, expiration

    def _get_or_create_session(
        self,
        role_arn: Optional[str],
        cached_session: Optional[boto3.Session],
        expires_at: Optional[datetime],
    ) -> tuple[boto3.Session, Optional[datetime]]:
        """Get cached session or create new one with role assumption.

        Args:
            role_arn: Role ARN to assume (None for default credentials)
            cached_session: Cached boto3 session (if any)
            expires_at: Credential expiration time (if cached)

        Returns:
            Tuple of (boto3.Session, Optional[expiration_datetime])
        """
        # Check if cached credentials are still valid
        if cached_session and expires_at:
            # Refresh if expiring within 5 minutes
            time_until_expiry = expires_at - datetime.now(expires_at.tzinfo)
            if time_until_expiry > timedelta(minutes=5):
                logger.debug(
                    "Using cached credentials",
                    role_arn=role_arn,
                    expires_in_seconds=time_until_expiry.total_seconds(),
                )
                return cached_session, expires_at

        # No role ARN - use default credentials
        if not role_arn:
            if not self._default_session:
                logger.info("Using default AWS credentials (no role ARN provided)")
                self._default_session = boto3.Session(region_name=self.region)
            return self._default_session, None

        # Assume role and create new session
        try:
            session, expiration = self._create_session_with_assumed_role(role_arn)
            return session, expiration
        except Exception as e:
            # Log error at ERROR level - this is a critical failure
            logger.error(
                "Failed to assume IAM role - this may indicate insufficient permissions",
                role_arn=role_arn,
                error=str(e),
                error_type=type(e).__name__,
            )
            # Re-raise - do not silently fall back to default credentials
            # Falling back could write data to wrong AWS account
            raise RuntimeError(
                f"Failed to assume role {role_arn}. "
                f"Please verify IAM permissions and trust relationship. Error: {str(e)}"
            ) from e

    def get_s3_client(self):
        """Get S3 client with write role credentials.

        Credentials are cached and automatically refreshed before expiration.
        Falls back to default credentials if role ARN not provided or assumption fails.

        Returns:
            boto3 S3 client with assumed role credentials
        """
        session, expiration = self._get_or_create_session(
            self.role_arn,
            self._session,
            self._expires_at,
        )
        self._session = session
        self._expires_at = expiration

        logger.debug(
            "Creating S3 client with role credentials",
            has_role_arn=bool(self.role_arn),
            role_arn=self.role_arn if self.role_arn else "default-credentials",
        )

        # Create S3 client from session
        return session.client("s3")

    def validate_roles(self) -> dict:
        """Validate that role can be assumed successfully.

        This method attempts to assume the write role to verify
        that the ECS task role has permission to assume it.

        Returns:
            Dictionary with validation results:
            {
                "role": {"configured": bool, "valid": bool, "error": str}
            }
        """
        results = {
            "role": {
                "configured": bool(self.role_arn),
                "valid": False,
                "error": None,
            },
        }

        # Validate write role
        if self.role_arn:
            try:
                self._assume_role(self.role_arn)
                results["role"]["valid"] = True
                logger.info("Role validated successfully", role_arn=self.role_arn)
            except Exception as e:
                error_type = type(e).__name__
                results["role"]["error"] = f"{error_type}: {str(e)}"
                logger.error(
                    "Role validation failed",
                    role_arn=self.role_arn,
                    error=str(e),
                    error_type=error_type,
                    exc_info=True,
                )

        return results
