/**
 * Type Definitions for v0.7.0 Configuration Architecture
 *
 * BREAKING CHANGE: Complete rewrite with NO backward compatibility.
 * This module defines the new unified configuration system for multi-environment deployments.
 *
 * @module types/config
 * @version 0.7.0
 */

/**
 * Configuration profile identifier
 * Profiles allow multiple named configurations (e.g., "default", "dev", "prod")
 *
 * @example "default"
 * @example "dev"
 * @example "prod"
 */
export type ProfileName = string;

/**
 * Profile Configuration (Single Source of Truth)
 *
 * This is the primary configuration interface for v0.7.0, replacing the previous
 * three-tier system (user/derived/deploy). All configuration is now unified in
 * a single structured format.
 *
 * @example
 * ```json
 * {
 *   "quilt": {
 *     "stackArn": "arn:aws:cloudformation:...",
 *     "catalog": "https://quilt.example.com",
 *     "bucket": "my-quilt-bucket",
 *     "database": "quilt_catalog",
 *     "queueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-queue",
 *     "region": "us-east-1"
 *   },
 *   "benchling": {
 *     "tenant": "my-tenant",
 *     "clientId": "client_123",
 *     "secretArn": "arn:aws:secretsmanager:...",
 *     "appDefinitionId": "app_456"
 *   },
 *   "packages": {
 *     "bucket": "benchling-packages",
 *     "prefix": "benchling",
 *     "metadataKey": "experiment_id"
 *   },
 *   "deployment": {
 *     "region": "us-east-1",
 *     "imageTag": "latest"
 *   },
 *   "integratedStack": true,
 *   "_metadata": {
 *     "version": "0.7.0",
 *     "createdAt": "2025-11-04T10:00:00Z",
 *     "updatedAt": "2025-11-04T10:00:00Z",
 *     "source": "wizard"
 *   }
 * }
 * ```
 */
export interface ProfileConfig {
    /**
     * Quilt catalog and infrastructure configuration
     */
    quilt: QuiltConfig;

    /**
     * Benchling tenant and OAuth configuration
     */
    benchling: BenchlingConfig;

    /**
     * Package storage and metadata configuration
     */
    packages: PackageConfig;

    /**
     * AWS deployment configuration (CDK)
     */
    deployment: DeploymentConfig;

    /**
     * Deployment mode flag
     *
     * - `true`: Integrated mode - uses existing BenchlingSecret in Quilt stack
     * - `false` or undefined: Standalone mode - creates dedicated secret
     *
     * @default false
     */
    integratedStack?: boolean;

    /**
     * Optional logging configuration
     */
    logging?: LoggingConfig;

    /**
     * Optional security configuration (webhook verification, IP allowlist)
     */
    security?: SecurityConfig;

    /**
     * Configuration metadata (provenance, versioning, timestamps)
     */
    _metadata: ConfigMetadata;

    /**
     * Optional profile inheritance (for profile hierarchies)
     *
     * When present, this profile inherits configuration from the specified base profile.
     * Values in this profile override inherited values via deep merge.
     *
     * @example "_inherits": "default"
     */
    _inherits?: string;
}

/**
 * Quilt Catalog Configuration
 *
 * Configuration for Quilt data catalog integration, including CloudFormation stack
 * and SQS queue for package creation.
 */
export interface QuiltConfig {
    /**
     * Quilt CloudFormation stack ARN
     *
     * @example "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-stack/..."
     */
    stackArn: string;

    /**
     * Quilt catalog domain (without protocol)
     *
     * @example "quilt.example.com"
     */
    catalog: string;

    /**
     * Athena/Glue database name for catalog metadata
     *
     * @example "quilt_catalog"
     */
    database: string;

    /**
     * SQS queue URL for package creation jobs
     *
     * @example "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-package-queue"
     */
    queueUrl: string;

    /**
     * AWS region for Quilt resources
     *
     * @example "us-east-1"
     */
    region: string;
}

/**
 * Benchling Configuration
 *
 * OAuth credentials and tenant information for Benchling API integration.
 */
export interface BenchlingConfig {
    /**
     * Benchling tenant identifier (subdomain)
     *
     * @example "my-company"
     */
    tenant: string;

    /**
     * OAuth client ID
     *
     * @example "client_abc123"
     */
    clientId: string;

    /**
     * OAuth client secret (optional, for local dev only)
     *
     * For production, use `secretArn` instead to reference AWS Secrets Manager.
     *
     * @example "secret_xyz789"
     */
    clientSecret?: string;

    /**
     * AWS Secrets Manager ARN for OAuth credentials (production)
     *
     * @example "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-..."
     */
    secretArn?: string;

    /**
     * Benchling app definition ID
     *
     * @example "app_def_456"
     */
    appDefinitionId: string;

    /**
     * Test entry ID for validation (optional)
     *
     * @example "etr_abc123"
     */
    testEntryId?: string;
}

/**
 * Package Configuration
 *
 * S3 storage and metadata settings for Benchling packages.
 */
export interface PackageConfig {
    /**
     * S3 bucket for package storage
     *
     * @example "benchling-packages"
     */
    bucket: string;

    /**
     * S3 key prefix for packages
     *
     * @example "benchling"
     * @default "benchling"
     */
    prefix: string;

    /**
     * Metadata key for package organization
     *
     * @example "experiment_id"
     * @default "experiment_id"
     */
    metadataKey: string;
}

/**
 * Deployment Configuration
 *
 * AWS infrastructure settings for CDK deployment.
 */
export interface DeploymentConfig {
    /**
     * AWS region for deployment
     *
     * @example "us-east-1"
     */
    region: string;

    /**
     * AWS account ID (optional, auto-detected if not provided)
     *
     * @example "123456789012"
     */
    account?: string;

    /**
     * ECR repository name (optional, default: "benchling-webhook")
     *
     * @example "my-custom-repo"
     */
    ecrRepository?: string;

    /**
     * Docker image tag
     *
     * @example "latest"
     * @example "0.7.0"
     * @default "latest"
     */
    imageTag?: string;
}

/**
 * Logging Configuration
 *
 * Python logging level for Flask application.
 */
export interface LoggingConfig {
    /**
     * Python logging level
     *
     * @default "INFO"
     */
    level: "DEBUG" | "INFO" | "WARNING" | "ERROR";
}

/**
 * Security Configuration
 *
 * Webhook security settings including IP allowlist and signature verification.
 */
export interface SecurityConfig {
    /**
     * Comma-separated list of allowed IP addresses/CIDR blocks
     *
     * Empty string means no IP filtering.
     *
     * @example "192.168.1.0/24,10.0.0.0/8"
     * @default ""
     */
    webhookAllowList?: string;

    /**
     * Enable webhook signature verification
     *
     * @default true
     */
    enableVerification?: boolean;
}

/**
 * Configuration Metadata
 *
 * Provenance tracking for configuration files.
 */
export interface ConfigMetadata {
    /**
     * Configuration schema version
     *
     * @example "0.7.0"
     */
    version: string;

    /**
     * ISO 8601 timestamp when configuration was created
     *
     * @example "2025-11-04T10:00:00Z"
     */
    createdAt: string;

    /**
     * ISO 8601 timestamp when configuration was last updated
     *
     * @example "2025-11-04T15:30:00Z"
     */
    updatedAt: string;

    /**
     * Source of configuration
     *
     * - "wizard": Created via interactive setup wizard
     * - "manual": Hand-edited by user
     * - "cli": Created via CLI command
     */
    source: "wizard" | "manual" | "cli";

    /**
     * Additional metadata fields (extensible)
     */
    [key: string]: string | undefined;
}

/**
 * Deployment History
 *
 * Tracks all deployments for a profile, with active deployment pointers per stage.
 */
export interface DeploymentHistory {
    /**
     * Active deployments by stage name
     *
     * Maps stage name (e.g., "dev", "prod") to the currently active deployment.
     *
     * @example
     * ```json
     * {
     *   "dev": { "stage": "dev", "endpoint": "https://...", "imageTag": "latest", ... },
     *   "prod": { "stage": "prod", "endpoint": "https://...", "imageTag": "0.7.0", ... }
     * }
     * ```
     */
    active: Record<string, DeploymentRecord>;

    /**
     * Complete deployment history (newest first)
     *
     * All past deployments for this profile, ordered by timestamp descending.
     */
    history: DeploymentRecord[];
}

/**
 * Deployment Record
 *
 * A single deployment event with full metadata for debugging and rollback.
 */
export interface DeploymentRecord {
    /**
     * API Gateway stage name
     *
     * @example "dev"
     * @example "prod"
     */
    stage: string;

    /**
     * ISO 8601 deployment timestamp
     *
     * @example "2025-11-04T10:30:00Z"
     */
    timestamp: string;

    /**
     * Docker image tag deployed
     *
     * @example "latest"
     * @example "0.7.0"
     */
    imageTag: string;

    /**
     * Deployed webhook endpoint URL
     *
     * @example "https://abc123.execute-api.us-east-1.amazonaws.com/dev"
     */
    endpoint: string;

    /**
     * CloudFormation stack name
     *
     * @example "BenchlingWebhookStack"
     */
    stackName: string;

    /**
     * AWS region
     *
     * @example "us-east-1"
     */
    region: string;

    /**
     * User who triggered deployment (optional)
     *
     * @example "ernest@example.com"
     */
    deployedBy?: string;

    /**
     * Git commit hash (optional)
     *
     * @example "abc123f"
     */
    commit?: string;

    /**
     * Additional metadata (extensible)
     */
    [key: string]: string | undefined;
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
     * Validation errors (fatal issues that prevent deployment)
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
 * Migration Report
 *
 * Result of migrating from legacy configuration format.
 */
export interface MigrationReport {
    /**
     * Whether migration completed successfully
     */
    success: boolean;

    /**
     * Profiles that were successfully migrated
     */
    profilesMigrated: string[];

    /**
     * Migration errors
     */
    errors: string[];

    /**
     * Migration warnings (non-fatal issues)
     */
    warnings?: string[];

    /**
     * Additional migration details
     */
    details?: Record<string, unknown>;
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
 * JSON Schema for ProfileConfig validation
 *
 * This schema can be used with ajv or other JSON Schema validators.
 */
export const ProfileConfigSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "ProfileConfig",
    description: "Benchling Webhook Profile Configuration (v0.7.0)",
    type: "object",
    required: ["quilt", "benchling", "packages", "deployment", "_metadata"],
    properties: {
        quilt: {
            type: "object",
            required: ["stackArn", "catalog", "database", "queueUrl", "region"],
            properties: {
                stackArn: { type: "string", pattern: "^arn:aws:cloudformation:" },
                catalog: { type: "string", minLength: 1 },
                database: { type: "string", minLength: 1 },
                queueUrl: { type: "string", pattern: "^https://sqs\\.[a-z0-9-]+\\.amazonaws\\.com/\\d{12}/.+" },
                region: { type: "string", pattern: "^[a-z]{2}-[a-z]+-[0-9]$" },
            },
        },
        benchling: {
            type: "object",
            required: ["tenant", "clientId", "appDefinitionId"],
            properties: {
                tenant: { type: "string", minLength: 1 },
                clientId: { type: "string", minLength: 1 },
                clientSecret: { type: "string" },
                secretArn: { type: "string", pattern: "^arn:aws:secretsmanager:" },
                appDefinitionId: { type: "string", minLength: 1 },
                testEntryId: { type: "string" },
            },
        },
        packages: {
            type: "object",
            required: ["bucket", "prefix", "metadataKey"],
            properties: {
                bucket: { type: "string", minLength: 3 },
                prefix: { type: "string", minLength: 1 },
                metadataKey: { type: "string", minLength: 1 },
            },
        },
        deployment: {
            type: "object",
            required: ["region"],
            properties: {
                region: { type: "string", pattern: "^[a-z]{2}-[a-z]+-[0-9]$" },
                account: { type: "string", pattern: "^[0-9]{12}$" },
                ecrRepository: { type: "string" },
                imageTag: { type: "string" },
            },
        },
        integratedStack: { type: "boolean" },
        logging: {
            type: "object",
            properties: {
                level: { type: "string", enum: ["DEBUG", "INFO", "WARNING", "ERROR"] },
            },
        },
        security: {
            type: "object",
            properties: {
                webhookAllowList: { type: "string" },
                enableVerification: { type: "boolean" },
            },
        },
        _metadata: {
            type: "object",
            required: ["version", "createdAt", "updatedAt", "source"],
            properties: {
                version: { type: "string" },
                createdAt: { type: "string", format: "date-time" },
                updatedAt: { type: "string", format: "date-time" },
                source: { type: "string", enum: ["wizard", "manual", "cli"] },
            },
        },
        _inherits: { type: "string" },
    },
    additionalProperties: false,
} as const;

/**
 * JSON Schema for DeploymentHistory validation
 */
export const DeploymentHistorySchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "DeploymentHistory",
    description: "Deployment tracking for a profile",
    type: "object",
    required: ["active", "history"],
    properties: {
        active: {
            type: "object",
            additionalProperties: {
                type: "object",
                required: ["stage", "timestamp", "imageTag", "endpoint", "stackName", "region"],
                properties: {
                    stage: { type: "string" },
                    timestamp: { type: "string", format: "date-time" },
                    imageTag: { type: "string" },
                    endpoint: { type: "string", format: "uri" },
                    stackName: { type: "string" },
                    region: { type: "string" },
                    deployedBy: { type: "string" },
                    commit: { type: "string" },
                },
            },
        },
        history: {
            type: "array",
            items: {
                type: "object",
                required: ["stage", "timestamp", "imageTag", "endpoint", "stackName", "region"],
                properties: {
                    stage: { type: "string" },
                    timestamp: { type: "string", format: "date-time" },
                    imageTag: { type: "string" },
                    endpoint: { type: "string", format: "uri" },
                    stackName: { type: "string" },
                    region: { type: "string" },
                    deployedBy: { type: "string" },
                    commit: { type: "string" },
                },
            },
        },
    },
    additionalProperties: false,
} as const;
