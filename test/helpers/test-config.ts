/**
 * Test Helper: Mock ProfileConfig
 *
 * Provides utility functions to create mock ProfileConfig objects for testing.
 * This centralizes test fixture creation and ensures consistency across tests.
 *
 * Use with test-profile.ts for complete test setup:
 * - mock-config.ts: Creates ProfileConfig objects
 * - test-profile.ts: Manages the 'test' profile lifecycle
 */

import { ProfileConfig } from "../../lib/types/config";

/**
 * Create a mock ProfileConfig for testing
 *
 * @param overrides - Partial ProfileConfig to override defaults
 * @returns Complete ProfileConfig for testing
 */
export function createMockConfig(overrides?: Partial<ProfileConfig>): ProfileConfig {
    const defaults: ProfileConfig = {
        quilt: {
            stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
            catalog: "quilt.example.com",
            database: "quilt_catalog",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
            region: "us-east-1",
        },
        benchling: {
            tenant: "test-tenant",
            clientId: "client_test123",
            secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
            appDefinitionId: "app_test456",
        },
        packages: {
            bucket: "test-packages-bucket",
            prefix: "benchling",
            metadataKey: "experiment_id",
        },
        deployment: {
            region: "us-east-1",
            account: "123456789012",
            ecrRepository: "benchling-webhook",
            imageTag: "latest",
        },
        logging: {
            level: "INFO",
        },
        security: {
            webhookAllowList: "",
            enableVerification: true,
        },
        _metadata: {
            version: "0.7.0",
            createdAt: "2025-11-04T10:00:00Z",
            updatedAt: "2025-11-04T10:00:00Z",
            source: "cli",
        },
    };

    return deepMerge(defaults, overrides || {});
}

/**
 * Create a mock ProfileConfig for dev environment
 */
export function createDevConfig(overrides?: Partial<ProfileConfig>): ProfileConfig {
    return createMockConfig({
        quilt: {
            stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/dev-quilt-stack/xyz789",
            catalog: "dev.quilt.example.com",
            database: "dev_quilt_catalog",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/dev-queue",
            region: "us-east-1",
        },
        benchling: {
            tenant: "dev-tenant",
            clientId: "client_dev123",
            secretArn: "quiltdata/benchling-webhook/dev/tenant",
            appDefinitionId: "app_dev456",
        },
        deployment: {
            region: "us-east-1",
            imageTag: "latest",
        },
        logging: {
            level: "DEBUG",
        },
        ...overrides,
    });
}

/**
 * Create a mock ProfileConfig for prod environment
 */
export function createProdConfig(overrides?: Partial<ProfileConfig>): ProfileConfig {
    return createMockConfig({
        quilt: {
            stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/prod-quilt-stack/abc123",
            catalog: "prod.quilt.example.com",
            database: "prod_quilt_catalog",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/prod-queue",
            region: "us-east-1",
        },
        benchling: {
            tenant: "prod-tenant",
            clientId: "client_prod123",
            secretArn: "quiltdata/benchling-webhook/default/tenant",
            appDefinitionId: "app_prod456",
        },
        deployment: {
            region: "us-east-1",
            imageTag: "v0.6.3",
        },
        logging: {
            level: "INFO",
        },
        ...overrides,
    });
}

/**
 * Deep merge two objects (simple implementation for test purposes)
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            const sourceValue = source[key];
            const targetValue = result[key];

            if (
                sourceValue &&
                typeof sourceValue === "object" &&
                !Array.isArray(sourceValue) &&
                targetValue &&
                typeof targetValue === "object" &&
                !Array.isArray(targetValue)
            ) {
                result[key] = deepMerge(targetValue, sourceValue);
            } else {
                result[key] = sourceValue as T[Extract<keyof T, string>];
            }
        }
    }

    return result;
}
