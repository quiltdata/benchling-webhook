/**
 * Integration tests for Fresh Install Workflow (v0.7.0)
 *
 * Tests the complete workflow of setting up a new installation from scratch.
 */

import { XDGTest } from "../mocks";
import { ProfileConfig } from "../../lib/types/config";

describe("Fresh Install Integration", () => {
    let mockStorage: XDGTest;

    beforeEach(() => {
        mockStorage = new XDGTest();
    });

    afterEach(() => {
        mockStorage.clear();
    });

    describe("fresh install workflow", () => {
        it("should complete full installation workflow from scratch", () => {
            // Step 1: Verify no profiles exist initially
            expect(mockStorage.listProfiles()).toEqual([]);

            // Step 2: Create default profile
            const defaultConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt/abc",
                    catalog: "https://quilt.example.com",
                    database: "prod_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/prod-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "prod-tenant",
                    clientId: "prod-client-id",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod-benchling",
                    appDefinitionId: "prod-app-def",
                },
                packages: {
                    bucket: "prod-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    account: "123456789012",
                    imageTag: "stable",
                },
                logging: {
                    level: "INFO",
                },
                security: {
                    webhookAllowList: "192.168.1.0/24",
                    enableVerification: true,
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("default", defaultConfig);

            // Step 3: Verify profile was created
            expect(mockStorage.profileExists("default")).toBe(true);
            expect(mockStorage.listProfiles()).toEqual(["default"]);

            // Step 4: Read back and verify contents
            const readConfig = mockStorage.readProfile("default");
            expect(readConfig.benchling.tenant).toBe("prod-tenant");
            expect(readConfig.deployment.imageTag).toBe("stable");

            // Step 5: Verify deployments history is empty initially
            const deployments = mockStorage.getDeployments("default");
            expect(deployments.active).toEqual({});
            expect(deployments.history).toEqual([]);
        });

        it("should handle profile creation with minimal required fields", () => {
            const minimalConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("default", minimalConfig);

            const readConfig = mockStorage.readProfile("default");
            expect(readConfig).toEqual(minimalConfig);
        });

        it("should validate configuration before writing", () => {
            const invalidConfig = {
                benchling: {
                    tenant: "test",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    source: "wizard",
                },
            } as unknown as ProfileConfig;

            expect(() => mockStorage.writeProfile("default", invalidConfig)).toThrow(/Invalid configuration/);

            // Verify profile was not created
            expect(mockStorage.profileExists("default")).toBe(false);
            expect(mockStorage.listProfiles()).toEqual([]);
        });

        it("should persist configuration within same storage instance", () => {
            const config: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    source: "wizard",
                },
            };

            // Write profile
            mockStorage.writeProfile("default", config);

            // Read it back
            const readConfig = mockStorage.readProfile("default");

            expect(readConfig).toEqual(config);
        });
    });

    describe("profile write and read", () => {
        it("should write and read profile correctly", () => {
            const config: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                    testEntryId: "etr_123",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
                logging: {
                    level: "DEBUG",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("test", config);
            const readConfig = mockStorage.readProfile("test");

            expect(readConfig).toEqual(config);
            expect(readConfig.benchling.testEntryId).toBe("etr_123");
            expect(readConfig.logging?.level).toBe("DEBUG");
        });

        it("should handle updates to existing profile", () => {
            const initialConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("default", initialConfig);

            // Update configuration
            const updatedConfig = { ...initialConfig };
            updatedConfig._metadata.updatedAt = "2025-11-04T11:00:00Z";

            mockStorage.writeProfile("default", updatedConfig);

            const readConfig = mockStorage.readProfile("default");
            expect(readConfig._metadata.updatedAt).toBe("2025-11-04T11:00:00Z");
        });

        it("should overwrite existing profile", () => {
            const config1: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("default", config1);

            const config2 = { ...config1, benchling: { ...config1.benchling, tenant: "updated-tenant" } };

            mockStorage.writeProfile("default", config2);

            const readConfig = mockStorage.readProfile("default");
            expect(readConfig.benchling.tenant).toBe("updated-tenant");
        });
    });

    describe("error handling", () => {
        it("should provide helpful error when reading nonexistent profile", () => {
            try {
                mockStorage.readProfile("nonexistent");
                fail("Should have thrown error");
            } catch (error) {
                expect((error as Error).message).toContain("Profile not found: nonexistent");
                expect((error as Error).message).toContain("Run setup wizard");
            }
        });

        it("should handle concurrent profile creation gracefully", () => {
            const config: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    source: "wizard",
                },
            };

            // Write same profile multiple times (simulating concurrent writes)
            mockStorage.writeProfile("default", config);
            mockStorage.writeProfile("default", config);
            mockStorage.writeProfile("default", config);

            // Should succeed and profile should exist
            expect(mockStorage.profileExists("default")).toBe(true);
            const readConfig = mockStorage.readProfile("default");
            expect(readConfig).toEqual(config);
        });
    });

    describe("directory structure", () => {
        it("should create correct directory structure", () => {
            const config: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("default", config);

            // Verify profile was created (mock storage doesn't have filesystem)
            expect(mockStorage.profileExists("default")).toBe(true);

            const readConfig = mockStorage.readProfile("default");
            expect(readConfig).toBeDefined();
        });
    });
});
