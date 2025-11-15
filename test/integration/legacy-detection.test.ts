/**
 * Integration tests for Legacy Configuration Detection (v0.7.0)
 *
 * Tests detection and error messages for v0.6.x configuration files.
 *
 * NOTE: This test intentionally uses the real XDGConfig with temp directories
 * to test legacy filesystem detection behavior.
 */

import { XDGConfig } from "../../lib/xdg-config";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Legacy Configuration Detection (Filesystem Integration)", () => {
    let testBaseDir: string;
    let xdg: XDGConfig;

    beforeEach(() => {
        // Create temporary test directory for each test
        testBaseDir = join(tmpdir(), `xdg-legacy-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
        mkdirSync(testBaseDir, { recursive: true });
        xdg = new XDGConfig(testBaseDir);
    });

    afterEach(() => {
        // Clean up test directory after each test
        if (existsSync(testBaseDir)) {
            rmSync(testBaseDir, { recursive: true, force: true });
        }
    });

    describe("legacy v0.6.x file detection", () => {
        it("should detect legacy default.json file", () => {
            // Create mock v0.6.x default.json
            const legacyConfig = {
                BENCHLING_TENANT: "legacy-tenant",
                BENCHLING_CLIENT_ID: "legacy-client",
                QUILT_PKG_BUCKET: "legacy-bucket",
            };

            writeFileSync(
                join(testBaseDir, "default.json"),
                JSON.stringify(legacyConfig, null, 4),
                "utf-8"
            );

            try {
                xdg.readProfile("default");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("Configuration format changed in v0.7.0");
                expect(message).toContain("not compatible");
                expect(message).toContain("default.json");
            }
        });

        it("should detect legacy deploy.json file", () => {
            // Create mock v0.6.x deploy.json
            const legacyDeployConfig = {
                endpoint: "https://legacy.execute-api.us-east-1.amazonaws.com",
                imageTag: "0.6.0",
            };

            writeFileSync(
                join(testBaseDir, "deploy.json"),
                JSON.stringify(legacyDeployConfig, null, 4),
                "utf-8"
            );

            try {
                xdg.readProfile("default");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("Configuration format changed in v0.7.0");
                expect(message).toContain("deploy.json");
            }
        });

        it("should detect legacy profiles directory", () => {
            // Create mock v0.6.x profiles directory
            const profilesDir = join(testBaseDir, "profiles");
            mkdirSync(profilesDir, { recursive: true });

            try {
                xdg.readProfile("default");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("Configuration format changed in v0.7.0");
            }
        });

        it("should detect multiple legacy files simultaneously", () => {
            // Create multiple v0.6.x files
            writeFileSync(join(testBaseDir, "default.json"), "{}", "utf-8");
            writeFileSync(join(testBaseDir, "deploy.json"), "{}", "utf-8");
            mkdirSync(join(testBaseDir, "profiles"), { recursive: true });

            try {
                xdg.readProfile("default");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("Configuration format changed in v0.7.0");
                expect(message).toContain("default.json");
                expect(message).toContain("deploy.json");
            }
        });
    });

    describe("helpful error messages", () => {
        it("should provide setup wizard command in error message", () => {
            writeFileSync(join(testBaseDir, "default.json"), "{}", "utf-8");

            try {
                xdg.readProfile("default");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("npx @quiltdata/benchling-webhook@latest setup");
            }
        });

        it("should mention old configuration file locations", () => {
            writeFileSync(join(testBaseDir, "default.json"), "{}", "utf-8");
            writeFileSync(join(testBaseDir, "deploy.json"), "{}", "utf-8");

            try {
                xdg.readProfile("default");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("~/.config/benchling-webhook/default.json");
                expect(message).toContain("~/.config/benchling-webhook/deploy.json");
            }
        });

        it("should indicate files can be manually referenced", () => {
            writeFileSync(join(testBaseDir, "default.json"), "{}", "utf-8");

            try {
                xdg.readProfile("default");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("manually reference");
                expect(message).toContain("re-enter your settings");
            }
        });

        it("should provide different message when no legacy files exist", () => {
            try {
                xdg.readProfile("nonexistent");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("Profile not found: nonexistent");
                expect(message).not.toContain("Configuration format changed in v0.7.0");
                expect(message).toContain("Run setup wizard");
            }
        });
    });

    describe("legacy detection with existing v0.7.0 profiles", () => {
        it("should not trigger legacy warning when v0.7.0 profile exists", () => {
            // Create v0.7.0 profile
            const newConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket",
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

            const profileDir = join(testBaseDir, "default");
            mkdirSync(profileDir, { recursive: true });
            writeFileSync(
                join(profileDir, "config.json"),
                JSON.stringify(newConfig, null, 4),
                "utf-8"
            );

            // Also create legacy files (to simulate partial migration)
            writeFileSync(join(testBaseDir, "default.json"), "{}", "utf-8");
            writeFileSync(join(testBaseDir, "deploy.json"), "{}", "utf-8");

            // Should successfully read v0.7.0 profile without legacy warning
            const config = xdg.readProfile("default");
            expect(config.benchling.tenant).toBe("test-tenant");
        });

        it("should warn about legacy files when requesting nonexistent profile", () => {
            // Create v0.7.0 profile
            const newConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket",
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

            const profileDir = join(testBaseDir, "default");
            mkdirSync(profileDir, { recursive: true });
            writeFileSync(
                join(profileDir, "config.json"),
                JSON.stringify(newConfig, null, 4),
                "utf-8"
            );

            // Create legacy files
            writeFileSync(join(testBaseDir, "default.json"), "{}", "utf-8");

            // Try to read non-existent profile
            try {
                xdg.readProfile("nonexistent");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("Configuration format changed in v0.7.0");
            }
        });
    });

    describe("migration guidance", () => {
        it("should list available profiles when legacy files detected", () => {
            // Create a v0.7.0 profile
            const newConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket",
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

            const profileDir = join(testBaseDir, "existing-profile");
            mkdirSync(profileDir, { recursive: true });
            writeFileSync(
                join(profileDir, "config.json"),
                JSON.stringify(newConfig, null, 4),
                "utf-8"
            );

            // Create legacy files
            writeFileSync(join(testBaseDir, "default.json"), "{}", "utf-8");

            // Try to read non-existent profile
            try {
                xdg.readProfile("nonexistent");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("Configuration format changed in v0.7.0");
            }
        });

        it("should provide clear action items in error message", () => {
            writeFileSync(join(testBaseDir, "default.json"), "{}", "utf-8");
            writeFileSync(join(testBaseDir, "deploy.json"), "{}", "utf-8");

            try {
                xdg.readProfile("default");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;

                // Should mention breaking change
                expect(message).toContain("v0.7.0");

                // Should provide setup command
                expect(message).toContain("setup");

                // Should mention old files
                expect(message).toContain("default.json");
                expect(message).toContain("deploy.json");

                // Should indicate files remain for reference
                expect(message).toContain("remain");
            }
        });
    });

    describe("edge cases", () => {
        it("should handle empty legacy files gracefully", () => {
            writeFileSync(join(testBaseDir, "default.json"), "", "utf-8");

            try {
                xdg.readProfile("default");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("Configuration format changed in v0.7.0");
            }
        });

        it("should handle legacy files with invalid JSON", () => {
            writeFileSync(join(testBaseDir, "default.json"), "{ invalid json", "utf-8");

            try {
                xdg.readProfile("default");
                fail("Should have thrown error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("Configuration format changed in v0.7.0");
            }
        });

        it("should not falsely detect legacy files in profile directories", () => {
            // Create v0.7.0 profile with a file named "default.json" inside it
            const profileDir = join(testBaseDir, "default");
            mkdirSync(profileDir, { recursive: true });

            const newConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    bucket: "test-bucket",
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

            writeFileSync(
                join(profileDir, "config.json"),
                JSON.stringify(newConfig, null, 4),
                "utf-8"
            );

            // This should work fine - profile exists with correct structure
            const config = xdg.readProfile("default");
            expect(config.benchling.tenant).toBe("test-tenant");
        });
    });
});
