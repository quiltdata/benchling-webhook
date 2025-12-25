/**
 * Minimal Stack Configuration Interface
 *
 * This interface defines ONLY the fields required by the CDK stack infrastructure.
 * It is deliberately minimal to:
 * - Reduce coupling between setup wizard and CDK stack
 * - Simplify testing (fewer fields to mock)
 * - Make explicit what the stack actually needs
 *
 * Transformation: ProfileConfig → StackConfig happens in config-transform.ts
 *
 * @module types/stack-config
 * @version 0.10.0
 */

import type { VpcConfig } from "./config";

// Re-export VpcConfig for convenience
export type { VpcConfig } from "./config";

/**
 * Minimal Stack Configuration
 *
 * Contains only the fields that the CDK stack actually uses for infrastructure provisioning.
 * Derived from ProfileConfig via profileToStackConfig() transformation.
 *
 * **Design principles:**
 * - Only infrastructure-related fields (no wizard metadata)
 * - Only fields actually referenced in CDK constructs
 * - Optional fields remain optional (preserve deployment flexibility)
 *
 * **What's NOT included:**
 * - Benchling OAuth credentials (stored in secret, referenced by ARN)
 * - Package configuration (passed as env vars to container)
 * - Logging level (passed as env var to container)
 * - Metadata fields (_metadata, _inherits)
 *
 * @example
 * ```typescript
 * const stackConfig: StackConfig = {
 *   benchling: {
 *     secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-..."
 *   },
 *   quilt: {
 *     catalog: "quilt.example.com",
 *     database: "quilt_catalog",
 *     queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-queue",
 *     region: "us-east-1"
 *   },
 *   deployment: {
 *     region: "us-east-1",
 *     imageTag: "0.10.0"
 *   }
 * };
 * ```
 */
export interface StackConfig {
    /**
     * Benchling configuration (secret reference only)
     */
    benchling: {
        /**
         * AWS Secrets Manager ARN for Benchling OAuth credentials
         *
         * Stack uses this to grant ECS task read access to the secret.
         * FastAPI reads credentials from secret at runtime.
         *
         * @example "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-oauth-abc123"
         */
        secretArn: string;
    };

    /**
     * Quilt catalog configuration (service endpoints only)
     */
    quilt: {
        /**
         * Quilt catalog domain (without protocol)
         *
         * Passed to container as QUILT_WEB_HOST environment variable.
         *
         * @example "quilt.example.com"
         */
        catalog: string;

        /**
         * Athena/Glue database name for catalog metadata
         *
         * Passed to container as ATHENA_USER_DATABASE environment variable.
         *
         * @example "quilt_catalog"
         */
        database: string;

        /**
         * SQS queue URL for package creation jobs
         *
         * Passed to container as PACKAGER_SQS_URL environment variable.
         * Stack also grants ECS task send message permissions.
         *
         * @example "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-package-queue"
         */
        queueUrl: string;

        /**
         * AWS region for Quilt resources
         *
         * Used for SQS/S3 client configuration.
         *
         * @example "us-east-1"
         */
        region: string;

        /**
         * IAM managed policy ARN for S3 bucket write access (optional)
         *
         * This policy grants read-write permissions to all Quilt S3 buckets.
         * Attached directly to the ECS task role, eliminating the need for role assumption.
         *
         * Resolved from BucketWritePolicy stack resource during setup.
         *
         * @example "arn:aws:iam::123456789012:policy/quilt-staging-BucketWritePolicy-XXXXX"
         */
        bucketWritePolicyArn?: string;

        /**
         * IAM managed policy ARN for Athena query access (optional)
         *
         * This policy grants permissions to execute Athena queries, access Glue catalog,
         * and write query results to the Athena results bucket.
         * Attached directly to the ECS task role.
         *
         * Resolved from UserAthenaNonManagedRolePolicy stack resource during setup.
         *
         * @example "arn:aws:iam::123456789012:policy/quilt-staging-UserAthenaNonManagedRolePolicy-XXXXX"
         */
        athenaUserPolicyArn?: string;
    };

    /**
     * AWS deployment configuration
     */
    deployment: {
        /**
         * AWS region for deployment
         *
         * @example "us-east-1"
         */
        region: string;

        /**
         * Docker image tag to deploy
         *
         * @example "latest"
         * @example "0.10.0"
         * @default "latest"
         */
        imageTag?: string;

        /**
         * VPC configuration for ECS deployment (optional)
         *
         * If not specified, a new VPC will be created with private subnets and NAT Gateway.
         */
        vpc?: VpcConfig;

        /**
         * CloudFormation stack name (optional)
         *
         * If not specified, stack name is auto-generated based on profile:
         * - "default" profile → "BenchlingWebhookStack" (backwards compatible)
         * - Other profiles → "BenchlingWebhookStack-{profile}"
         *
         * @example "BenchlingWebhookStack-sales"
         * @default Auto-generated based on profile name
         */
        stackName?: string;
    };

    /**
     * Security configuration (optional)
     */
    security?: {
        /**
         * Comma-separated list of allowed IP addresses/CIDR blocks for webhook endpoints
         *
         * Enforced via REST API Gateway resource policy (free).
         * Empty string means no IP filtering (all IPs allowed).
         *
         * @example "192.168.1.0/24,10.0.0.0/8"
         * @default ""
         */
        webhookAllowList?: string;
    };
}
