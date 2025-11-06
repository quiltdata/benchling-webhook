/**
 * Unit tests for Profile Validation (v0.7.0)
 *
 * Tests profile configuration validation with JSON schema.
 */

import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig } from "../../lib/types/config";
import { mkdirSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Profile Validation", () => {
    let testBaseDir: string;
    let xdg: XDGConfig;

    beforeEach(() => {
        // Create temporary test directory for each test
        testBaseDir = join(tmpdir(), `xdg-validate-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
        mkdirSync(testBaseDir, { recursive: true });
        xdg = new XDGConfig(testBaseDir);
    });

    afterEach(() => {
        // Clean up test directory after each test
        if (existsSync(testBaseDir)) {
            rmSync(testBaseDir, { recursive: true, force: true });
        }
    });

    describe("validateProfile() with valid configs", () => {
        it("should validate minimal valid configuration", () => {
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
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            const result = xdg.validateProfile(minimalConfig);

            expect(result.isValid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it("should validate complete configuration with all optional fields", () => {
            const completeConfig: ProfileConfig = {
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
                    clientSecret: "test-secret",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
                    appDefinitionId: "test-app",
                    testEntryId: "etr_test123",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    account: "123456789012",
                    ecrRepository: "benchling-webhook",
                    imageTag: "0.7.0",
                },
                logging: {
                    level: "DEBUG",
                },
                security: {
                    webhookAllowList: "192.168.1.0/24,10.0.0.0/8",
                    enableVerification: true,
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            const result = xdg.validateProfile(completeConfig);

            expect(result.isValid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it("should validate configuration with inheritance field", () => {
            const configWithInheritance: ProfileConfig = {
                _inherits: "default",
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

            const result = xdg.validateProfile(configWithInheritance);

            expect(result.isValid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it("should accept all valid logging levels", () => {
            const levels: Array<"DEBUG" | "INFO" | "WARNING" | "ERROR"> = ["DEBUG", "INFO", "WARNING", "ERROR"];

            levels.forEach((level) => {
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
                    logging: {
                        level,
                    },
                    _metadata: {
                        version: "0.7.0",
                        createdAt: "2025-11-04T10:00:00Z",
                        updatedAt: "2025-11-04T10:00:00Z",
                        source: "wizard",
                    },
                };

                const result = xdg.validateProfile(config);
                expect(result.isValid).toBe(true);
            });
        });

        it("should accept all valid metadata sources", () => {
            const sources: Array<"wizard" | "manual" | "cli"> = ["wizard", "manual", "cli"];

            sources.forEach((source) => {
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
                        createdAt: "2025-11-04T10:00:00Z",
                        updatedAt: "2025-11-04T10:00:00Z",
                        source,
                    },
                };

                const result = xdg.validateProfile(config);
                expect(result.isValid).toBe(true);
            });
        });
    });

    describe("validation errors for missing required fields", () => {
        it("should reject configuration missing quilt section", () => {
            const invalidConfig = {
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
            } as unknown as ProfileConfig;

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes("quilt"))).toBe(true);
        });

        it("should reject configuration missing benchling section", () => {
            const invalidConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
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
            } as unknown as ProfileConfig;

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes("benchling"))).toBe(true);
        });

        it("should reject configuration missing packages section", () => {
            const invalidConfig = {
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
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            } as unknown as ProfileConfig;

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes("packages"))).toBe(true);
        });

        it("should reject configuration missing deployment section", () => {
            const invalidConfig = {
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
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            } as unknown as ProfileConfig;

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes("deployment"))).toBe(true);
        });

        it("should reject configuration missing _metadata section", () => {
            const invalidConfig = {
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
            } as unknown as ProfileConfig;

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes("_metadata"))).toBe(true);
        });

        it("should reject configuration with missing nested required fields", () => {
            const invalidConfig = {
                quilt: {
                    catalog: "https://quilt.example.com",
                    // Missing stackArn, database, queueUrl, region
                },
                benchling: {
                    tenant: "test-tenant",
                    // Missing clientId, appDefinitionId
                },
                packages: {
                    bucket: "test-packages",
                    // Missing prefix, metadataKey
                },
                deployment: {
                    // Missing region
                },
                _metadata: {
                    version: "0.7.0",
                    // Missing createdAt, updatedAt, source
                },
            } as unknown as ProfileConfig;

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(5);
        });
    });

    describe("JSON schema validation", () => {
        it("should reject invalid ARN format", () => {
            const invalidConfig: ProfileConfig = {
                quilt: {
                    stackArn: "not-an-arn",
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

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes("stackArn"))).toBe(true);
        });

        it("should reject empty catalog domain", () => {
            const invalidConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "",
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

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes("catalog"))).toBe(true);
        });

        it("should reject invalid region format", () => {
            const invalidConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "invalid-region",
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

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
        });

        it("should reject invalid AWS account ID format", () => {
            const invalidConfig: ProfileConfig = {
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
                    account: "12345",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes("account"))).toBe(true);
        });

        it("should reject invalid logging level", () => {
            const invalidConfig = {
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
                logging: {
                    level: "INVALID",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            } as unknown as ProfileConfig;

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes("level"))).toBe(true);
        });
    });

    describe("invalid nested structure", () => {
        it("should reject configuration with empty strings for required fields", () => {
            const invalidConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "",
                    clientId: "",
                    appDefinitionId: "",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "",
                    metadataKey: "",
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
            } as ProfileConfig;

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it("should reject configuration with additional properties", () => {
            const invalidConfig = {
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
                unknownProperty: "should-not-be-here",
            } as unknown as ProfileConfig;

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes("additional"))).toBe(true);
        });
    });
});
