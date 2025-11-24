/**
 * Shared TypeScript interfaces for setup wizard phases
 *
 * This module defines all the input/output types for the 7 wizard phases,
 * ensuring type-safe data flow between phases.
 *
 * @module wizard/types
 */

import { ProfileConfig, LogGroupInfo } from "../types/config";
import { XDGBase } from "../xdg-base";

/**
 * Phase 1: Catalog Discovery Result
 */
export interface CatalogDiscoveryResult {
    /** Confirmed catalog DNS (without protocol) */
    catalogDns: string;
    /** Whether the catalog was manually entered by user */
    wasManuallyEntered: boolean;
    /** The catalog that was initially detected (if any) */
    detectedCatalog?: string;
}

/**
 * Phase 2: Stack Query Result
 */
export interface StackQueryResult {
    /** CloudFormation stack ARN */
    stackArn: string;
    /** Catalog URL */
    catalog: string;
    /** Athena database name */
    database: string;
    /** SQS queue URL */
    queueUrl: string;
    /** AWS region */
    region: string;
    /** AWS account ID */
    account: string;
    /** Quilt stack version from catalog config.json */
    stackVersion?: string;
    /** BenchlingSecret ARN from stack outputs (if exists) */
    benchlingSecretArn?: string;
    /** Whether BenchlingWebhook parameter is enabled in the stack */
    benchlingIntegrationEnabled?: boolean;
    /** Whether stack query succeeded */
    stackQuerySucceeded: boolean;
    /** Athena workgroup for user queries (optional) */
    athenaUserWorkgroup?: string;
    /** Athena user policy ARN (optional) */
    athenaUserPolicy?: string;
    /** Athena workgroup for Iceberg queries (optional) */
    icebergWorkgroup?: string;
    /** Iceberg database name - now from both outputs and resources */
    icebergDatabase?: string;
    /** User Athena results bucket (S3 bucket for query results) */
    athenaResultsBucket?: string;
    /** User Athena results bucket policy ARN */
    athenaResultsBucketPolicy?: string;
    /** IAM role ARN for read-only S3 access (from T4BucketReadRole) */
    readRoleArn?: string;
    /** IAM role ARN for read-write S3 access (from T4BucketWriteRole) */
    writeRoleArn?: string;
    /** Discovered CloudWatch log groups from the Quilt stack */
    logGroups?: LogGroupInfo[];
    // New integrated architecture fields (PR #2199)
    /** Benchling webhook URL from API Gateway (integrated mode) */
    benchlingUrl?: string;
    /** API Gateway ID (integrated mode) */
    benchlingApiId?: string;
    /** Docker image URI for Benchling webhook container (integrated mode) */
    benchlingDockerImage?: string;
    /** IAM role ARN for Benchling webhook operations (may differ from T4BucketWriteRole) */
    benchlingWriteRoleArn?: string;
    /** ECS container log group name (integrated mode) */
    ecsLogGroup?: string;
    /** API Gateway log group name (integrated mode) */
    apiGatewayLogGroup?: string;
}

/**
 * Phase 3: Parameter Collection Input
 */
export interface ParameterCollectionInput {
    stackQuery: StackQueryResult;
    existingConfig?: ProfileConfig | null; // Existing config to use as defaults
    yes?: boolean;
    // CLI overrides
    benchlingTenant?: string;
    benchlingClientId?: string;
    benchlingClientSecret?: string;
    benchlingAppDefinitionId?: string;
    benchlingTestEntryId?: string;
    userBucket?: string;
    pkgPrefix?: string;
    pkgKey?: string;
    logLevel?: string;
    webhookAllowList?: string;
}

/**
 * Phase 3: Parameter Collection Result
 */
export interface ParameterCollectionResult {
    benchling: {
        tenant: string;
        clientId: string;
        clientSecret: string;
        appDefinitionId: string;
        testEntryId?: string;
    };
    packages: {
        bucket: string;
        prefix: string;
        metadataKey: string;
    };
    deployment: {
        region: string;
        account: string;
    };
    logging: {
        level: "DEBUG" | "INFO" | "WARNING" | "ERROR";
    };
    security: {
        enableVerification: boolean;
        webhookAllowList: string;
    };
}

/**
 * Phase 4: Validation Input
 */
export interface ValidationInput {
    stackQuery: StackQueryResult;
    parameters: ParameterCollectionResult;
    awsProfile?: string;
}

/**
 * Phase 4: Validation Result
 */
export interface ValidationResult {
    /** Whether validation passed */
    success: boolean;
    /** Fatal validation errors */
    errors: string[];
    /** Non-fatal warnings */
    warnings: string[];
    /** Whether to exit for manifest creation flow */
    shouldExitForManifest: boolean;
}

/**
 * Phase 5: Mode Decision Input
 */
export interface ModeDecisionInput {
    stackQuery: StackQueryResult;
    yes?: boolean;
}

/**
 * Phase 5: Mode Decision Result
 */
export interface ModeDecisionResult {
    /** Chosen deployment mode */
    mode: "integrated" | "standalone";
    /** BenchlingSecret ARN (for integrated mode) */
    benchlingSecretArn?: string;
}

/**
 * Phase 6: Integrated Mode Input
 */
export interface IntegratedModeInput {
    profile: string;
    catalogDns: string;
    stackQuery: StackQueryResult;
    parameters: ParameterCollectionResult;
    benchlingSecretArn: string;
    configStorage: XDGBase;
    awsProfile?: string;
    yes?: boolean;
}

/**
 * Phase 6: Integrated Mode Result
 */
export interface IntegratedModeResult {
    /** Whether integrated mode setup succeeded */
    success: boolean;
    /** Path to saved configuration file */
    configPath: string;
    /** BenchlingSecret ARN that was updated */
    secretArn: string;
}

/**
 * Phase 7: Standalone Mode Input
 */
export interface StandaloneModeInput {
    profile: string;
    catalogDns: string;
    stackQuery: StackQueryResult;
    parameters: ParameterCollectionResult;
    configStorage: XDGBase;
    yes?: boolean;
    setupOnly?: boolean;
    awsProfile?: string;
}

/**
 * Phase 7: Standalone Mode Result
 */
export interface StandaloneModeResult {
    /** Whether standalone mode setup succeeded */
    success: boolean;
    /** Path to saved configuration file */
    configPath: string;
    /** Secret ARN that was created */
    secretArn: string;
    /** Whether deployment was executed */
    deployed: boolean;
    /** Whether Phase 7 already handled deployment decision (asked user or deployed) */
    deploymentHandled: boolean;
}
