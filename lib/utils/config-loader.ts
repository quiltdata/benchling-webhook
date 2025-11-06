/**
 * Configuration loading helpers for application startup
 *
 * Provides simplified configuration loading for both production (from AWS)
 * and testing (from environment variables).
 */

import { ConfigResolver, type ResolvedConfig, ConfigResolverError } from "./config-resolver";

/**
 * Load configuration for production (from AWS CloudFormation and Secrets Manager)
 *
 * Reads QuiltStackARN and BenchlingSecret from environment variables and
 * resolves complete configuration by querying AWS APIs.
 *
 * @returns Complete resolved configuration
 * @throws Error if required environment variables are missing
 * @throws ConfigResolverError if AWS resolution fails
 *
 * @example
 * // In production/container
 * const config = await loadConfig();
 * console.log(`Database: ${config.quiltDatabase}`);
 */
export async function loadConfig(): Promise<ResolvedConfig> {
    const quiltStackArn = process.env.QuiltStackARN;
    const benchlingSecret = process.env.BenchlingSecret;

    if (!quiltStackArn || !benchlingSecret) {
        const missing: string[] = [];
        if (!quiltStackArn) missing.push("QuiltStackARN");
        if (!benchlingSecret) missing.push("BenchlingSecret");

        throw new Error(
            `Missing required environment variables: ${missing.join(", ")}\n\n` +
      "The container requires exactly 2 environment variables:\n" +
      "  QuiltStackARN: ARN of your Quilt CloudFormation stack\n" +
      "    Example: arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123\n\n" +
      "  BenchlingSecret: Name or ARN of AWS Secrets Manager secret\n" +
      "    Example: my-benchling-creds\n\n" +
      "Documentation: https://github.com/quiltdata/benchling-webhook#configuration",
        );
    }

    const resolver = new ConfigResolver();
    return await resolver.resolve({
        quiltStackArn,
        benchlingSecret,
    });
}

/**
 * Load configuration for testing (from environment variables directly)
 *
 * Only available when NODE_ENV=test. Provides backward compatibility
 * with existing test suite by reading configuration from individual
 * environment variables instead of AWS services.
 *
 * @returns Partial configuration from environment variables
 * @throws Error if called outside test environment
 *
 * @example
 * // In test files
 * process.env.NODE_ENV = 'test';
 * process.env.QUILT_CATALOG = 'test.catalog.com';
 * const config = loadConfigForTesting();
 */
export function loadConfigForTesting(): Partial<ResolvedConfig> {
    if (process.env.NODE_ENV !== "test") {
        throw new Error(
            "loadConfigForTesting() should only be used in test environment (NODE_ENV=test)",
        );
    }

    return {
    // AWS
        awsRegion: process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || "us-east-1",
        awsAccount: process.env.CDK_DEFAULT_ACCOUNT || "123456789012",

        // Quilt
        quiltCatalog: process.env.QUILT_CATALOG || "test.catalog.com",
        quiltDatabase: process.env.QUILT_DATABASE || "test_db",
        quiltUserBucket: process.env.QUILT_USER_BUCKET || "test-bucket",
        queueUrl: process.env.QUEUE_URL ||
            "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",

        // Benchling
        benchlingTenant: process.env.BENCHLING_TENANT || "test-tenant",
        benchlingClientId: process.env.BENCHLING_CLIENT_ID || "test-client-id",
        benchlingClientSecret: process.env.BENCHLING_CLIENT_SECRET || "test-client-secret",
        benchlingAppDefinitionId: process.env.BENCHLING_APP_DEFINITION_ID,
        benchlingApiUrl: process.env.BENCHLING_API_URL,

        // Optional
        pkgPrefix: process.env.PKG_PREFIX || "benchling",
        pkgKey: process.env.PKG_KEY || "experiment_id",
        logLevel: process.env.LOG_LEVEL || "INFO",
        webhookAllowList: process.env.WEBHOOK_ALLOW_LIST,
        enableWebhookVerification: process.env.ENABLE_WEBHOOK_VERIFICATION !== "false",
    };
}

/**
 * Format ConfigResolverError for console output
 *
 * @param error - The error to format
 * @returns Formatted error message
 */
export function formatConfigError(error: unknown): string {
    if (error instanceof ConfigResolverError) {
        return error.format();
    }

    if (error instanceof Error) {
        return `Error: ${error.message}`;
    }

    return `Unknown error: ${String(error)}`;
}
