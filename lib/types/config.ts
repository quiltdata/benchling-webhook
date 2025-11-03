/**
 * Comprehensive Type Definitions for XDG Configuration System
 *
 * This module defines all TypeScript types and interfaces for the
 * XDG-compliant configuration management system.
 *
 * @module types/config
 */

/**
 * Configuration profile identifier
 * Profiles allow multiple named configurations (e.g., "default", "dev", "prod")
 */
export type ProfileName = string;

/**
 * Configuration type identifier
 */
export type ConfigType = "user" | "derived" | "deploy" | "complete";

/**
 * User Configuration
 *
 * User-provided settings that define the core configuration.
 * This is the primary configuration file edited by users.
 */
export interface UserConfig {
    /**
     * Quilt catalog URL (e.g., "https://quilt.example.com")
     */
    quiltCatalog?: string;

    /**
     * Quilt user bucket name for package storage
     */
    quiltUserBucket?: string;

    /**
     * Quilt database (Athena/Glue) identifier
     */
    quiltDatabase?: string;

    /**
     * Quilt CloudFormation stack ARN
     */
    quiltStackArn?: string;

    /**
     * AWS region for Quilt resources
     */
    quiltRegion?: string;

    /**
     * Benchling tenant identifier
     */
    benchlingTenant?: string;

    /**
     * Benchling OAuth client ID
     */
    benchlingClientId?: string;

    /**
     * Benchling OAuth client secret (stored in Secrets Manager in production)
     */
    benchlingClientSecret?: string;

    /**
     * Benchling app definition ID
     */
    benchlingAppDefinitionId?: string;

    /**
     * S3 bucket for Benchling package storage
     */
    benchlingPkgBucket?: string;

    /**
     * Benchling test entry ID (optional, for validation)
     */
    benchlingTestEntry?: string;

    /**
     * AWS Secrets Manager secret ARN for Benchling credentials
     */
    benchlingSecretArn?: string;

    /**
     * AWS account ID for CDK deployment
     */
    cdkAccount?: string;

    /**
     * AWS region for CDK deployment
     */
    cdkRegion?: string;

    /**
     * AWS profile to use for deployment operations
     */
    awsProfile?: string;

    /**
     * SQS queue ARN for package creation
     */
    queueArn?: string;

    /**
     * S3 key prefix for Benchling packages
     */
    pkgPrefix?: string;

    /**
     * Package metadata key (e.g., "experiment_id")
     */
    pkgKey?: string;

    /**
     * Logging level (DEBUG, INFO, WARNING, ERROR)
     */
    logLevel?: string;

    /**
     * Comma-separated IP allowlist for webhook access
     */
    webhookAllowList?: string;

    /**
     * Enable webhook signature verification
     */
    enableWebhookVerification?: string;

    /**
     * Create ECR repository flag
     */
    createEcrRepository?: string;

    /**
     * ECR repository name
     */
    ecrRepositoryName?: string;

    /**
     * Docker image tag
     */
    imageTag?: string;

    /**
     * Configuration metadata (optional)
     */
    _metadata?: ConfigMetadata;
}

/**
 * Derived Configuration
 *
 * Configuration values inferred from CLI tools (e.g., quilt3 config)
 * or computed from user configuration.
 */
export interface DerivedConfig extends UserConfig {
    /**
     * Catalog URL inferred from quilt3 CLI
     */
    catalogUrl?: string;

    /**
     * Metadata tracking inference source and timestamp
     */
    _metadata?: ConfigMetadata & {
        inferredAt?: string;
        inferredFrom?: string;
    };
}

/**
 * Deployment Configuration
 *
 * Configuration artifacts generated during deployment.
 * Contains deployment-specific values like webhook URLs and stack ARNs.
 */
export interface DeploymentConfig extends DerivedConfig {
    /**
     * Deployed webhook endpoint URL
     */
    webhookEndpoint?: string;

    /**
     * Deployed webhook URL (alias for webhookEndpoint)
     */
    webhookUrl?: string;

    /**
     * CloudFormation stack ARN
     */
    stackArn?: string;

    /**
     * Deployment timestamp
     */
    deploymentTimestamp?: string;

    /**
     * ISO timestamp of deployment
     */
    deployedAt?: string;

    /**
     * Metadata tracking deployment details
     */
    _metadata?: ConfigMetadata & {
        deployedAt?: string;
        deployedBy?: string;
        stackName?: string;
    };
}

/**
 * Configuration Metadata
 *
 * Tracks configuration provenance, timestamps, and versioning.
 */
export interface ConfigMetadata {
    /**
     * ISO timestamp when configuration was saved
     */
    savedAt?: string;

    /**
     * Source of configuration (e.g., "cli", "wizard", "manual")
     */
    source?: string;

    /**
     * Configuration version
     */
    version?: string;

    /**
     * Additional metadata fields
     */
    [key: string]: string | undefined;
}

/**
 * Complete Configuration
 *
 * Merged configuration from all sources (user + derived + deploy).
 */
export type CompleteConfig = DeploymentConfig;

/**
 * Configuration Set
 *
 * Collection of configurations for merging operations.
 */
export interface ConfigSet {
    user?: UserConfig;
    derived?: DerivedConfig;
    deploy?: DeploymentConfig;
}

/**
 * Configuration Profile
 *
 * Named configuration with metadata for profile management.
 */
export interface ConfigProfile {
    /**
     * Profile name (e.g., "default", "dev", "prod")
     */
    name: ProfileName;

    /**
     * User configuration for this profile
     */
    user?: UserConfig;

    /**
     * Derived configuration for this profile
     */
    derived?: DerivedConfig;

    /**
     * Deployment configuration for this profile
     */
    deploy?: DeploymentConfig;

    /**
     * Profile metadata
     */
    metadata?: {
        createdAt?: string;
        updatedAt?: string;
        description?: string;
    };
}

/**
 * Configuration Validation Result
 *
 * Result of configuration validation operations.
 */
export interface ValidationResult {
    /**
     * Whether the configuration is valid
     */
    isValid: boolean;

    /**
     * Validation errors (if any)
     */
    errors: string[];

    /**
     * Validation warnings (non-fatal issues)
     */
    warnings?: string[];

    /**
     * Additional validation details
     */
    details?: Record<string, unknown>;
}

/**
 * XDG Configuration Paths
 *
 * File paths for XDG-compliant configuration storage.
 */
export interface XDGConfigPaths {
    /**
     * Path to user configuration file
     */
    userConfig: string;

    /**
     * Path to derived configuration file
     */
    derivedConfig: string;

    /**
     * Path to deployment configuration file
     */
    deployConfig: string;
}

/**
 * Profile Management Options
 */
export interface ProfileOptions {
    /**
     * Base configuration directory (defaults to ~/.config/benchling-webhook)
     */
    baseDir?: string;

    /**
     * Profile name to use
     */
    profile?: ProfileName;

    /**
     * Create profile if it doesn't exist
     */
    createIfMissing?: boolean;
}

/**
 * Configuration Read Options
 */
export interface ConfigReadOptions {
    /**
     * Configuration type to read
     */
    type: ConfigType;

    /**
     * Profile name (defaults to "default")
     */
    profile?: ProfileName;

    /**
     * Throw error if file doesn't exist
     */
    throwIfMissing?: boolean;

    /**
     * Validate schema after reading
     */
    validate?: boolean;
}

/**
 * Configuration Write Options
 */
export interface ConfigWriteOptions {
    /**
     * Configuration type to write
     */
    type: ConfigType;

    /**
     * Profile name (defaults to "default")
     */
    profile?: ProfileName;

    /**
     * Create backup before writing
     */
    backup?: boolean;

    /**
     * Validate schema before writing
     */
    validate?: boolean;

    /**
     * Add metadata to configuration
     */
    addMetadata?: boolean;
}

/**
 * AWS Profile Configuration
 *
 * Integration with AWS credentials and profiles.
 */
export interface AWSProfileConfig {
    /**
     * AWS profile name from ~/.aws/credentials
     */
    profileName: string;

    /**
     * AWS region
     */
    region?: string;

    /**
     * AWS account ID
     */
    accountId?: string;
}

/**
 * Quilt CLI Configuration
 *
 * Configuration inferred from quilt3 CLI.
 */
export interface QuiltCLIConfig {
    /**
     * Catalog URL from quilt3 config
     */
    catalog?: string;

    /**
     * Default bucket from quilt3 config
     */
    defaultBucket?: string;

    /**
     * AWS region from quilt3 config
     */
    region?: string;

    /**
     * Registry URL from quilt3 config
     */
    registryUrl?: string;
}
