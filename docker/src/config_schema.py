"""
Pydantic Configuration Schema Models

Defines the canonical data models for XDG configuration with:
- Type safety and validation
- Automatic serialization/deserialization
- Field name aliasing (camelCase <-> snake_case)
- Schema documentation

This module serves as the single source of truth for configuration structure,
ensuring consistency between TypeScript and Python code.

Module: config_schema
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class ConfigType(str, Enum):
    """Configuration type enumeration"""

    USER = "user"
    DERIVED = "derived"
    DEPLOY = "deploy"


class ConfigMetadata(BaseModel):
    """Configuration metadata tracking provenance and versioning"""

    saved_at: Optional[str] = Field(None, alias="savedAt", description="ISO timestamp when configuration was saved")
    source: Optional[str] = Field(None, description="Source of configuration (e.g., 'cli', 'wizard', 'sync-secrets')")
    version: Optional[str] = Field(None, description="Configuration schema version")
    inferred_at: Optional[str] = Field(None, alias="inferredAt", description="ISO timestamp when config was inferred")
    inferred_from: Optional[str] = Field(
        None, alias="inferredFrom", description="Source of inference (e.g., 'quilt3-cli')"
    )

    class Config:
        populate_by_name = True  # Allow both camelCase and snake_case
        extra = "allow"  # Allow additional fields


class UserConfig(BaseModel):
    """
    User Configuration

    User-provided settings that define the core configuration.
    This is the primary configuration file edited by users.
    """

    # Quilt Configuration
    quilt_catalog: Optional[str] = Field(None, alias="quiltCatalog", description="Quilt catalog URL")
    quilt_user_bucket: Optional[str] = Field(None, alias="quiltUserBucket", description="Quilt user bucket name")
    quilt_database: Optional[str] = Field(None, alias="quiltDatabase", description="Quilt database identifier")
    quilt_stack_arn: Optional[str] = Field(None, alias="quiltStackArn", description="Quilt CloudFormation stack ARN")
    quilt_region: Optional[str] = Field(None, alias="quiltRegion", description="AWS region for Quilt resources")

    # Benchling Configuration
    benchling_tenant: Optional[str] = Field(None, alias="benchlingTenant", description="Benchling tenant identifier")
    benchling_client_id: Optional[str] = Field(
        None, alias="benchlingClientId", description="Benchling OAuth client ID"
    )
    benchling_client_secret: Optional[str] = Field(
        None, alias="benchlingClientSecret", description="Benchling OAuth client secret"
    )
    benchling_app_definition_id: Optional[str] = Field(
        None, alias="benchlingAppDefinitionId", description="Benchling app definition ID"
    )
    benchling_pkg_bucket: Optional[str] = Field(
        None, alias="benchlingPkgBucket", description="S3 bucket for Benchling packages"
    )
    benchling_test_entry: Optional[str] = Field(
        None, alias="benchlingTestEntry", description="Benchling test entry ID (for validation)"
    )
    benchling_secret_arn: Optional[str] = Field(
        None, alias="benchlingSecretArn", description="AWS Secrets Manager secret ARN"
    )

    # AWS Configuration
    cdk_account: Optional[str] = Field(None, alias="cdkAccount", description="AWS account ID for CDK deployment")
    cdk_region: Optional[str] = Field(None, alias="cdkRegion", description="AWS region for CDK deployment")
    aws_profile: Optional[str] = Field(None, alias="awsProfile", description="AWS profile to use")

    # Package Configuration
    queue_arn: Optional[str] = Field(None, alias="queueArn", description="SQS queue ARN for package creation")
    pkg_prefix: Optional[str] = Field(
        "benchling", alias="pkgPrefix", description="S3 key prefix for Benchling packages"
    )
    pkg_key: Optional[str] = Field(
        "experiment_id", alias="pkgKey", description="Package metadata key (e.g., 'experiment_id')"
    )

    # Operational Configuration
    log_level: Optional[str] = Field("INFO", alias="logLevel", description="Logging level")
    webhook_allow_list: Optional[str] = Field("", alias="webhookAllowList", description="Comma-separated IP allowlist")
    enable_webhook_verification: Optional[str] = Field(
        "true", alias="enableWebhookVerification", description="Enable webhook signature verification"
    )

    # ECR Configuration
    create_ecr_repository: Optional[str] = Field(
        None, alias="createEcrRepository", description="Create ECR repository flag"
    )
    ecr_repository_name: Optional[str] = Field(None, alias="ecrRepositoryName", description="ECR repository name")
    image_tag: Optional[str] = Field(None, alias="imageTag", description="Docker image tag")

    # Metadata
    metadata: Optional[ConfigMetadata] = Field(None, alias="_metadata", description="Configuration metadata")

    class Config:
        populate_by_name = True  # Allow both camelCase and snake_case
        extra = "allow"  # Allow extra fields for flexibility (strict validation can be enabled separately)

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: Optional[str]) -> Optional[str]:
        """Validate log level"""
        if v is None:
            return v
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        if v.upper() not in valid_levels:
            raise ValueError(f"Invalid log level: {v}. Must be one of {valid_levels}")
        return v.upper()


class DerivedConfig(UserConfig):
    """
    Derived Configuration

    Configuration values inferred from CLI tools (e.g., quilt3 config)
    or computed from user configuration.
    """

    catalog_url: Optional[str] = Field(None, alias="catalogUrl", description="Catalog URL inferred from quilt3 CLI")

    class Config:
        populate_by_name = True
        extra = "allow"  # Allow additional inferred fields


class DeploymentConfig(DerivedConfig):
    """
    Deployment Configuration

    Configuration artifacts generated during deployment.
    Contains deployment-specific values like webhook URLs and stack ARNs.
    """

    webhook_endpoint: Optional[str] = Field(None, alias="webhookEndpoint", description="Deployed webhook endpoint URL")
    webhook_url: Optional[str] = Field(
        None, alias="webhookUrl", description="Deployed webhook URL (alias for webhookEndpoint)"
    )
    stack_arn: Optional[str] = Field(None, alias="stackArn", description="CloudFormation stack ARN")
    deployment_timestamp: Optional[str] = Field(None, alias="deploymentTimestamp", description="Deployment timestamp")
    deployed_at: Optional[str] = Field(None, alias="deployedAt", description="ISO timestamp of deployment")

    class Config:
        populate_by_name = True
        extra = "allow"


class BenchlingSecret(BaseModel):
    """
    Benchling Secret Schema

    Defines the structure of secrets stored in AWS Secrets Manager.
    Uses snake_case field names to match Python config_resolver expectations.
    """

    tenant: str = Field(..., description="Benchling tenant identifier")
    client_id: str = Field(..., description="Benchling OAuth client ID")
    client_secret: str = Field(..., description="Benchling OAuth client secret")
    app_definition_id: str = Field(..., description="Benchling app definition ID")
    user_bucket: str = Field(..., description="S3 bucket for package storage")
    pkg_prefix: str = Field("benchling", description="S3 key prefix for packages")
    pkg_key: str = Field("experiment_id", description="Package metadata key")
    log_level: str = Field("INFO", description="Logging level")
    enable_webhook_verification: str = Field("true", description="Enable webhook signature verification")
    webhook_allow_list: str = Field("", description="Comma-separated IP allowlist")
    queue_arn: Optional[str] = Field(None, description="SQS queue ARN (optional)")

    class Config:
        extra = "forbid"

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate log level"""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        if v.upper() not in valid_levels:
            raise ValueError(f"Invalid log level: {v}. Must be one of {valid_levels}")
        return v.upper()

    @field_validator("enable_webhook_verification")
    @classmethod
    def validate_webhook_verification(cls, v: str) -> str:
        """Validate webhook verification flag"""
        if v.lower() not in ["true", "false"]:
            raise ValueError(f"Invalid webhook verification flag: {v}. Must be 'true' or 'false'")
        return v.lower()


def get_config_model(config_type: ConfigType) -> type[BaseModel]:
    """
    Get the Pydantic model for a configuration type

    Args:
        config_type: Type of configuration

    Returns:
        Pydantic model class

    Raises:
        ValueError: If config_type is invalid
    """
    models = {
        ConfigType.USER: UserConfig,
        ConfigType.DERIVED: DerivedConfig,
        ConfigType.DEPLOY: DeploymentConfig,
    }

    if config_type not in models:
        raise ValueError(f"Unknown configuration type: {config_type}")

    return models[config_type]
