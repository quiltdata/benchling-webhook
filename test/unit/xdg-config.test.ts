/**
 * Unit tests for XDGConfig class
 *
 * Tests the new profile-based configuration API with NO backward compatibility.
 */

import { ProfileConfig, DeploymentRecord } from "../../lib/types/config";
import { XDGTest } from "../helpers/xdg-test";

describe("XDGConfig", () => {
    let mockStorage: XDGTest;

    beforeEach(() => {
        mockStorage = new XDGTest();
    });

    afterEach(() => {
        mockStorage.clear();
    });

    describe("readProfile()", () => {
        it("should read valid profile configuration", () => {
            const validConfig: ProfileConfig = {
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

            mockStorage.writeProfile("default", validConfig);

            const result = mockStorage.readProfile("default");

            expect(result).toEqual(validConfig);
            expect(result.benchling.tenant).toBe("test-tenant");
        });

        it("should throw error when profile not found", () => {
            expect(() => mockStorage.readProfile("nonexistent")).toThrow(/Profile not found: nonexistent/);
        });

        it("should provide helpful error message for missing profile", () => {
            try {
                mockStorage.readProfile("nonexistent");
                fail("Should have thrown error");
            } catch (error) {
                expect((error as Error).message).toContain("Profile not found: nonexistent");
            }
        });

        it("should throw error for invalid config schema", () => {
            // Missing required fields
            const invalidConfig = {
                benchling: {
                    tenant: "test",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            } as unknown as ProfileConfig;

            expect(() => mockStorage.writeProfile("default", invalidConfig)).toThrow(/Invalid configuration/);
        });
    });

    describe("writeProfile()", () => {
        it("should write valid profile configuration", () => {
            const validConfig: ProfileConfig = {
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

            mockStorage.writeProfile("test-profile", validConfig);

            expect(mockStorage.profileExists("test-profile")).toBe(true);

            const written = mockStorage.readProfile("test-profile");
            expect(written).toEqual(validConfig);
        });

        it("should create profile if it does not exist", () => {
            const validConfig: ProfileConfig = {
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

            mockStorage.writeProfile("new-profile", validConfig);

            expect(mockStorage.profileExists("new-profile")).toBe(true);
        });

        it("should overwrite existing config", () => {
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

            const read = mockStorage.readProfile("default");
            expect(read.benchling.tenant).toBe("updated-tenant");
        });

        it("should throw error for invalid configuration", () => {
            const invalidConfig = {
                benchling: {
                    tenant: "test",
                },
            } as unknown as ProfileConfig;

            expect(() => mockStorage.writeProfile("test", invalidConfig)).toThrow(/Invalid configuration/);
        });
    });

    describe("listProfiles()", () => {
        it("should return empty array when no profiles exist", () => {
            const profiles = mockStorage.listProfiles();
            expect(profiles).toEqual([]);
        });

        it("should list all valid profiles", () => {
            const validConfig: ProfileConfig = {
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

            mockStorage.writeProfile("default", validConfig);
            mockStorage.writeProfile("dev", validConfig);
            mockStorage.writeProfile("prod", validConfig);

            const profiles = mockStorage.listProfiles();
            expect(profiles).toContain("default");
            expect(profiles).toContain("dev");
            expect(profiles).toContain("prod");
            expect(profiles.length).toBe(3);
        });
    });

    describe("profileExists()", () => {
        it("should return false when profile does not exist", () => {
            expect(mockStorage.profileExists("nonexistent")).toBe(false);
        });

        it("should return true when profile exists", () => {
            const validConfig: ProfileConfig = {
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

            mockStorage.writeProfile("test-profile", validConfig);

            expect(mockStorage.profileExists("test-profile")).toBe(true);
        });
    });

    describe("deleteProfile()", () => {
        it("should delete profile and all its data", () => {
            const validConfig: ProfileConfig = {
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

            mockStorage.writeProfile("test-delete", validConfig);
            expect(mockStorage.profileExists("test-delete")).toBe(true);

            mockStorage.deleteProfile("test-delete");
            expect(mockStorage.profileExists("test-delete")).toBe(false);
        });

        it("should throw error when attempting to delete default profile", () => {
            expect(() => mockStorage.deleteProfile("default")).toThrow(/Cannot delete the default profile/);
        });

        it("should throw error when profile does not exist", () => {
            expect(() => mockStorage.deleteProfile("nonexistent")).toThrow(/Profile does not exist/);
        });
    });

    describe("validateProfile()", () => {
        it("should validate correct profile configuration", () => {
            const validConfig: ProfileConfig = {
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

            const result = mockStorage.validateProfile(validConfig);

            expect(result.isValid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it("should reject configuration with missing required fields", () => {
            const invalidConfig = {
                benchling: {
                    tenant: "test",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            } as unknown as ProfileConfig;

            const result = mockStorage.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors.some(e => e.includes("quilt"))).toBe(true);
        });

        it("should reject configuration with invalid nested structure", () => {
            const invalidConfig = {
                quilt: {
                    stackArn: "invalid-arn",
                    catalog: "not-a-url",
                    bucket: "ab",
                    database: "",
                    queueUrl: "invalid",
                    region: "invalid-region",
                },
                benchling: {
                    tenant: "",
                    clientId: "",
                    appDefinitionId: "",
                },
                packages: {
                    bucket: "",
                    prefix: "",
                    metadataKey: "",
                },
                deployment: {
                    region: "invalid",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            } as ProfileConfig;

            const result = mockStorage.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });
});
