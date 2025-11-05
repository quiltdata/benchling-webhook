/**
 * Unit tests for XDGConfig class (v0.7.0)
 *
 * Tests the new profile-based configuration API with NO backward compatibility.
 */

import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig, DeploymentRecord } from "../../lib/types/config";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("XDGConfig", () => {
    let testBaseDir: string;
    let xdg: XDGConfig;

    beforeEach(() => {
        // Create temporary test directory for each test
        testBaseDir = join(tmpdir(), `xdg-config-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
        mkdirSync(testBaseDir, { recursive: true });
        xdg = new XDGConfig(testBaseDir);
    });

    afterEach(() => {
        // Clean up test directory after each test
        if (existsSync(testBaseDir)) {
            rmSync(testBaseDir, { recursive: true, force: true });
        }
    });

    describe("readProfile()", () => {
        it("should read valid profile configuration", () => {
            // Create a valid profile config
            const profileDir = join(testBaseDir, "default");
            mkdirSync(profileDir, { recursive: true });

            const validConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket",
                    database: "test_db",
                    queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
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

            writeFileSync(
                join(profileDir, "config.json"),
                JSON.stringify(validConfig, null, 4),
                "utf-8"
            );

            const result = xdg.readProfile("default");

            expect(result).toEqual(validConfig);
            expect(result.benchling.tenant).toBe("test-tenant");
        });

        it("should throw error when profile not found", () => {
            expect(() => xdg.readProfile("nonexistent")).toThrow(/Profile not found: nonexistent/);
        });

        it("should provide helpful error message for missing profile", () => {
            try {
                xdg.readProfile("nonexistent");
                fail("Should have thrown error");
            } catch (error) {
                expect((error as Error).message).toContain("Profile not found: nonexistent");
                expect((error as Error).message).toContain("Run setup wizard");
            }
        });

        it("should detect legacy v0.6.x files and provide upgrade guidance", () => {
            // Create mock legacy files
            writeFileSync(join(testBaseDir, "default.json"), "{}", "utf-8");
            writeFileSync(join(testBaseDir, "deploy.json"), "{}", "utf-8");

            try {
                xdg.readProfile("default");
                fail("Should have thrown error");
            } catch (error) {
                expect((error as Error).message).toContain("Configuration format changed in v0.7.0");
                expect((error as Error).message).toContain("not compatible");
                expect((error as Error).message).toContain("default.json");
                expect((error as Error).message).toContain("deploy.json");
            }
        });

        it("should throw error for invalid JSON", () => {
            const profileDir = join(testBaseDir, "default");
            mkdirSync(profileDir, { recursive: true });
            writeFileSync(join(profileDir, "config.json"), "{ invalid json", "utf-8");

            expect(() => xdg.readProfile("default")).toThrow(/Invalid JSON/);
        });

        it("should throw error for invalid config schema", () => {
            const profileDir = join(testBaseDir, "default");
            mkdirSync(profileDir, { recursive: true });

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
            };

            writeFileSync(
                join(profileDir, "config.json"),
                JSON.stringify(invalidConfig, null, 4),
                "utf-8"
            );

            expect(() => xdg.readProfile("default")).toThrow(/Invalid configuration/);
        });
    });

    describe("writeProfile()", () => {
        it("should write valid profile configuration", () => {
            const validConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket",
                    database: "test_db",
                    queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
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

            xdg.writeProfile("test-profile", validConfig);

            const configPath = join(testBaseDir, "test-profile", "config.json");
            expect(existsSync(configPath)).toBe(true);

            const written = JSON.parse(readFileSync(configPath, "utf-8"));
            expect(written).toEqual(validConfig);
        });

        it("should create profile directory if it does not exist", () => {
            const validConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket",
                    database: "test_db",
                    queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
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

            xdg.writeProfile("new-profile", validConfig);

            const profileDir = join(testBaseDir, "new-profile");
            expect(existsSync(profileDir)).toBe(true);
        });

        it("should create backup when overwriting existing config", () => {
            const config1: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket-1",
                    database: "test_db",
                    queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
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

            xdg.writeProfile("default", config1);

            const config2 = { ...config1 };
            config2.quilt.bucket = "test-bucket-2";
            xdg.writeProfile("default", config2);

            const backupPath = join(testBaseDir, "default", "config.json.backup");
            expect(existsSync(backupPath)).toBe(true);

            const backup = JSON.parse(readFileSync(backupPath, "utf-8"));
            expect(backup.quilt.bucket).toBe("test-bucket-1");
        });

        it("should throw error for invalid configuration", () => {
            const invalidConfig = {
                benchling: {
                    tenant: "test",
                },
            } as unknown as ProfileConfig;

            expect(() => xdg.writeProfile("test", invalidConfig)).toThrow(/Invalid configuration/);
        });
    });

    describe("listProfiles()", () => {
        it("should return empty array when no profiles exist", () => {
            const profiles = xdg.listProfiles();
            expect(profiles).toEqual([]);
        });

        it("should list all valid profiles", () => {
            const validConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket",
                    database: "test_db",
                    queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
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

            xdg.writeProfile("default", validConfig);
            xdg.writeProfile("dev", validConfig);
            xdg.writeProfile("prod", validConfig);

            const profiles = xdg.listProfiles();
            expect(profiles).toContain("default");
            expect(profiles).toContain("dev");
            expect(profiles).toContain("prod");
            expect(profiles.length).toBe(3);
        });

        it("should not list directories without config.json", () => {
            // Create directory without config.json
            const emptyDir = join(testBaseDir, "empty");
            mkdirSync(emptyDir, { recursive: true });

            const profiles = xdg.listProfiles();
            expect(profiles).not.toContain("empty");
        });
    });

    describe("profileExists()", () => {
        it("should return false when profile does not exist", () => {
            expect(xdg.profileExists("nonexistent")).toBe(false);
        });

        it("should return true when profile exists", () => {
            const validConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket",
                    database: "test_db",
                    queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
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

            xdg.writeProfile("test-profile", validConfig);

            expect(xdg.profileExists("test-profile")).toBe(true);
        });

        it("should return false for directory without config.json", () => {
            const emptyDir = join(testBaseDir, "empty");
            mkdirSync(emptyDir, { recursive: true });

            expect(xdg.profileExists("empty")).toBe(false);
        });
    });

    describe("deleteProfile()", () => {
        it("should delete profile and all its files", () => {
            const validConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket",
                    database: "test_db",
                    queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
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

            xdg.writeProfile("test-delete", validConfig);
            expect(xdg.profileExists("test-delete")).toBe(true);

            xdg.deleteProfile("test-delete");
            expect(xdg.profileExists("test-delete")).toBe(false);
        });

        it("should throw error when attempting to delete default profile", () => {
            expect(() => xdg.deleteProfile("default")).toThrow(/Cannot delete the default profile/);
        });

        it("should throw error when profile does not exist", () => {
            expect(() => xdg.deleteProfile("nonexistent")).toThrow(/Profile does not exist/);
        });
    });

    describe("validateProfile()", () => {
        it("should validate correct profile configuration", () => {
            const validConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket",
                    database: "test_db",
                    queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
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

            const result = xdg.validateProfile(validConfig);

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

            const result = xdg.validateProfile(invalidConfig);

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
                    queueArn: "invalid",
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

            const result = xdg.validateProfile(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });
});
