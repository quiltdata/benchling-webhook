/**
 * Tests for Configuration Transformation Utilities
 *
 * @module test/config-transform
 */

import { profileToStackConfig, validateStackConfig } from "../lib/utils/config-transform";
import type { ProfileConfig } from "../lib/types/config";
import type { StackConfig } from "../lib/types/stack-config";

describe("config-transform", () => {
    describe("validateStackConfig", () => {
        it("should pass validation for complete valid configuration", () => {
            const validConfig: ProfileConfig = {
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                    appDefinitionId: "app_456",
                },
                quilt: {
                    catalog: "quilt.example.com",
                    database: "quilt_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                    writeRoleArn: "arn:aws:iam::123456789012:role/test-role",
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
                _metadata: {
                    version: "0.10.0",
                    createdAt: "2025-12-24T00:00:00Z",
                    updatedAt: "2025-12-24T00:00:00Z",
                    source: "wizard",
                },
            };

            const result = validateStackConfig(validConfig);

            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("should fail validation when benchling.secretArn is missing", () => {
            const invalidConfig: ProfileConfig = {
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    appDefinitionId: "app_456",
                    // Missing secretArn
                },
                quilt: {
                    catalog: "quilt.example.com",
                    database: "quilt_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.10.0",
                    createdAt: "2025-12-24T00:00:00Z",
                    updatedAt: "2025-12-24T00:00:00Z",
                    source: "wizard",
                },
            };

            const result = validateStackConfig(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors).toContain(
                "Missing 'benchling.secretArn' - run 'npm run setup:sync-secrets' to create secret",
            );
        });

        it("should fail validation when quilt fields are missing", () => {
            const invalidConfig: ProfileConfig = {
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                    appDefinitionId: "app_456",
                },
                quilt: {
                    catalog: "",
                    database: "",
                    queueUrl: "",
                    region: "",
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.10.0",
                    createdAt: "2025-12-24T00:00:00Z",
                    updatedAt: "2025-12-24T00:00:00Z",
                    source: "wizard",
                },
            };

            const result = validateStackConfig(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors.some((e) => e.includes("quilt.catalog"))).toBe(true);
            expect(result.errors.some((e) => e.includes("quilt.database"))).toBe(true);
            expect(result.errors.some((e) => e.includes("quilt.queueUrl"))).toBe(true);
            expect(result.errors.some((e) => e.includes("quilt.region"))).toBe(true);
        });

        it("should warn when optional writeRoleArn is missing", () => {
            const configWithoutWriteRole: ProfileConfig = {
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                    appDefinitionId: "app_456",
                },
                quilt: {
                    catalog: "quilt.example.com",
                    database: "quilt_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                    // Missing writeRoleArn
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.10.0",
                    createdAt: "2025-12-24T00:00:00Z",
                    updatedAt: "2025-12-24T00:00:00Z",
                    source: "wizard",
                },
            };

            const result = validateStackConfig(configWithoutWriteRole);

            expect(result.isValid).toBe(true);
            expect(result.warnings).toBeDefined();
            expect(result.warnings?.some((w) => w.includes("writeRoleArn"))).toBe(true);
        });

        it("should validate VPC configuration when present", () => {
            const configWithInvalidVpc: ProfileConfig = {
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                    appDefinitionId: "app_456",
                },
                quilt: {
                    catalog: "quilt.example.com",
                    database: "quilt_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    vpc: {
                        vpcId: "vpc-123456",
                        // Missing required fields
                    },
                },
                _metadata: {
                    version: "0.10.0",
                    createdAt: "2025-12-24T00:00:00Z",
                    updatedAt: "2025-12-24T00:00:00Z",
                    source: "wizard",
                },
            };

            const result = validateStackConfig(configWithInvalidVpc);

            expect(result.isValid).toBe(false);
            expect(result.errors.some((e) => e.includes("private subnets"))).toBe(true);
        });

        it("should validate CIDR blocks in webhookAllowList", () => {
            const configWithInvalidCidr: ProfileConfig = {
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                    appDefinitionId: "app_456",
                },
                quilt: {
                    catalog: "quilt.example.com",
                    database: "quilt_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                security: {
                    webhookAllowList: "192.168.1.0/24,invalid-cidr",
                },
                _metadata: {
                    version: "0.10.0",
                    createdAt: "2025-12-24T00:00:00Z",
                    updatedAt: "2025-12-24T00:00:00Z",
                    source: "wizard",
                },
            };

            const result = validateStackConfig(configWithInvalidCidr);

            expect(result.isValid).toBe(false);
            expect(result.errors.some((e) => e.includes("invalid-cidr"))).toBe(true);
        });
    });

    describe("profileToStackConfig", () => {
        it("should transform valid ProfileConfig to StackConfig", () => {
            const profileConfig: ProfileConfig = {
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                    appDefinitionId: "app_456",
                },
                quilt: {
                    catalog: "quilt.example.com",
                    database: "quilt_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                    writeRoleArn: "arn:aws:iam::123456789012:role/test-role",
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "0.10.0",
                    stackName: "BenchlingWebhookStack-test",
                },
                security: {
                    webhookAllowList: "192.168.1.0/24",
                },
                _metadata: {
                    version: "0.10.0",
                    createdAt: "2025-12-24T00:00:00Z",
                    updatedAt: "2025-12-24T00:00:00Z",
                    source: "wizard",
                },
            };

            const stackConfig = profileToStackConfig(profileConfig);

            expect(stackConfig).toEqual<StackConfig>({
                benchling: {
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                },
                quilt: {
                    catalog: "quilt.example.com",
                    database: "quilt_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                    writeRoleArn: "arn:aws:iam::123456789012:role/test-role",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "0.10.0",
                    stackName: "BenchlingWebhookStack-test",
                },
                security: {
                    webhookAllowList: "192.168.1.0/24",
                },
            });
        });

        it("should exclude wizard metadata and package config from StackConfig", () => {
            const profileConfig: ProfileConfig = {
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                    appDefinitionId: "app_456",
                    testEntryId: "etr_123",
                },
                quilt: {
                    catalog: "quilt.example.com",
                    database: "quilt_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                logging: {
                    level: "DEBUG",
                },
                _metadata: {
                    version: "0.10.0",
                    createdAt: "2025-12-24T00:00:00Z",
                    updatedAt: "2025-12-24T00:00:00Z",
                    source: "wizard",
                },
                _inherits: "default",
            };

            const stackConfig = profileToStackConfig(profileConfig);

            // Should only include stack-relevant fields
            expect(stackConfig).not.toHaveProperty("packages");
            expect(stackConfig).not.toHaveProperty("logging");
            expect(stackConfig).not.toHaveProperty("_metadata");
            expect(stackConfig).not.toHaveProperty("_inherits");

            // Should not include tenant/clientId in benchling
            expect(stackConfig.benchling).toEqual({
                secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
            });
        });

        it("should handle optional fields correctly", () => {
            const minimalConfig: ProfileConfig = {
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                    appDefinitionId: "app_456",
                },
                quilt: {
                    catalog: "quilt.example.com",
                    database: "quilt_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                    // No writeRoleArn
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    // No imageTag, vpc, or stackName
                },
                _metadata: {
                    version: "0.10.0",
                    createdAt: "2025-12-24T00:00:00Z",
                    updatedAt: "2025-12-24T00:00:00Z",
                    source: "wizard",
                },
            };

            const stackConfig = profileToStackConfig(minimalConfig);

            expect(stackConfig.quilt.writeRoleArn).toBeUndefined();
            expect(stackConfig.deployment.imageTag).toBeUndefined();
            expect(stackConfig.deployment.vpc).toBeUndefined();
            expect(stackConfig.deployment.stackName).toBeUndefined();
            expect(stackConfig.security).toBeUndefined();
        });

        it("should throw error for invalid configuration", () => {
            const invalidConfig: ProfileConfig = {
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    // Missing secretArn
                    appDefinitionId: "app_456",
                },
                quilt: {
                    catalog: "quilt.example.com",
                    database: "quilt_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.10.0",
                    createdAt: "2025-12-24T00:00:00Z",
                    updatedAt: "2025-12-24T00:00:00Z",
                    source: "wizard",
                },
            };

            expect(() => profileToStackConfig(invalidConfig)).toThrow(
                /Invalid profile configuration for stack deployment/,
            );
        });
    });
});
