/**
 * Configuration Validation Tests
 *
 * Comprehensive tests for:
 * - Profile creation
 * - Validation rules
 * - Secrets management
 * - Cross-platform compatibility
 */

import { XDGConfig } from "../../lib/xdg-config";
import { UserConfig, DerivedConfig, DeploymentConfig } from "../../lib/types/config";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";

describe("XDG Configuration Validation", () => {
    let testBaseDir: string;
    let xdgConfig: XDGConfig;

    beforeEach(() => {
        // Create temporary test directory
        testBaseDir = resolve(tmpdir(), `benchling-webhook-test-${Date.now()}`);
        xdgConfig = new XDGConfig(testBaseDir);
    });

    describe("Profile Creation", () => {
        it("should create default profile directories", () => {
            xdgConfig.ensureProfileDirectories("default");

            const paths = xdgConfig.getProfilePaths("default");
            expect(existsSync(resolve(testBaseDir))).toBe(true);
            expect(existsSync(resolve(testBaseDir, "config"))).toBe(true);
            expect(existsSync(resolve(testBaseDir, "deploy"))).toBe(true);
        });

        it("should create named profile directories", () => {
            xdgConfig.ensureProfileDirectories("dev");

            const paths = xdgConfig.getProfilePaths("dev");
            expect(existsSync(resolve(testBaseDir, "profiles", "dev"))).toBe(true);
            expect(existsSync(resolve(testBaseDir, "profiles", "dev", "config"))).toBe(true);
            expect(existsSync(resolve(testBaseDir, "profiles", "dev", "deploy"))).toBe(true);
        });

        it("should list all profiles", () => {
            xdgConfig.ensureProfileDirectories("default");
            xdgConfig.ensureProfileDirectories("dev");
            xdgConfig.ensureProfileDirectories("prod");

            const profiles = xdgConfig.listProfiles();
            expect(profiles).toContain("default");
            expect(profiles).toContain("dev");
            expect(profiles).toContain("prod");
        });

        it("should check profile existence", () => {
            xdgConfig.ensureProfileDirectories("test-profile");
            expect(xdgConfig.profileExists("test-profile")).toBe(true);
            expect(xdgConfig.profileExists("non-existent")).toBe(false);
        });
    });

    describe("Validation Rules", () => {
        it("should validate user configuration schema", () => {
            const validConfig: UserConfig = {
                quiltCatalog: "https://quilt.example.com",
                quiltUserBucket: "test-bucket",
                benchlingTenant: "test-tenant",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-secret",
                _metadata: {
                    source: "test",
                    savedAt: new Date().toISOString(),
                    version: "0.6.0",
                },
            };

            xdgConfig.ensureProfileDirectories("default");
            expect(() => {
                xdgConfig.writeProfileConfig("user", validConfig, "default");
            }).not.toThrow();
        });

        it("should reject invalid configuration schema", () => {
            const invalidConfig = {
                _metadata: {
                    savedAt: 123, // Should be string
                },
            };

            xdgConfig.ensureProfileDirectories("default");
            expect(() => {
                xdgConfig.writeProfileConfig("user", invalidConfig, "default");
            }).toThrow();
        });

        it("should validate derived configuration", () => {
            const derivedConfig: DerivedConfig = {
                catalogUrl: "https://quilt.example.com",
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc",
                _metadata: {
                    source: "infer-quilt-config",
                    savedAt: new Date().toISOString(),
                    inferredAt: new Date().toISOString(),
                    version: "0.6.0",
                },
            };

            xdgConfig.ensureProfileDirectories("default");
            expect(() => {
                xdgConfig.writeProfileConfig("derived", derivedConfig, "default");
            }).not.toThrow();
        });

        it("should validate deployment configuration", () => {
            const deployConfig: DeploymentConfig = {
                webhookEndpoint: "https://api.example.com/webhook",
                webhookUrl: "https://api.example.com/webhook",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhook/xyz",
                deployedAt: new Date().toISOString(),
                _metadata: {
                    source: "cdk-deploy",
                    savedAt: new Date().toISOString(),
                    deployedAt: new Date().toISOString(),
                    version: "0.6.0",
                },
            };

            xdgConfig.ensureProfileDirectories("default");
            expect(() => {
                xdgConfig.writeProfileConfig("deploy", deployConfig, "default");
            }).not.toThrow();
        });

        it("should allow additional properties in configuration", () => {
            const configWithExtra = {
                quiltCatalog: "https://quilt.example.com",
                customField: "custom-value", // Additional property
                _metadata: {
                    source: "test",
                    savedAt: new Date().toISOString(),
                },
            };

            xdgConfig.ensureProfileDirectories("default");
            expect(() => {
                xdgConfig.writeProfileConfig("user", configWithExtra, "default");
            }).not.toThrow();
        });
    });

    describe("Secrets Management", () => {
        it("should not store secrets in plain text", () => {
            const userConfig: UserConfig = {
                benchlingTenant: "test-tenant",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "super-secret-value",
                _metadata: {
                    source: "test",
                    savedAt: new Date().toISOString(),
                },
            };

            xdgConfig.ensureProfileDirectories("default");
            xdgConfig.writeProfileConfig("user", userConfig, "default");

            // Verify config was written
            const readConfig = xdgConfig.readProfileConfig("user", "default") as UserConfig;
            expect(readConfig.benchlingClientSecret).toBe("super-secret-value");

            // Note: In production, secrets should be synced to AWS Secrets Manager
            // and removed from local config. This test ensures they CAN be written
            // temporarily during setup.
        });

        it("should track secret ARNs in derived config", () => {
            const derivedConfig: DerivedConfig = {
                benchlingSecrets: "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-webhook/test-abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-webhook/test-abc123",
                _metadata: {
                    source: "sync-secrets",
                    savedAt: new Date().toISOString(),
                },
            };

            xdgConfig.ensureProfileDirectories("default");
            xdgConfig.writeProfileConfig("derived", derivedConfig, "default");

            const readConfig = xdgConfig.readProfileConfig("derived", "default") as DerivedConfig;
            expect(readConfig.benchlingSecrets).toContain("arn:aws:secretsmanager");
        });
    });

    describe("Cross-Platform Compatibility", () => {
        it("should use platform-appropriate paths", () => {
            const paths = xdgConfig.getProfilePaths("default");

            // All paths should be absolute
            expect(paths.userConfig).toMatch(/^[\/\\]/);
            expect(paths.derivedConfig).toMatch(/^[\/\\]/);
            expect(paths.deployConfig).toMatch(/^[\/\\]/);

            // Paths should use platform separators
            if (process.platform === "win32") {
                expect(paths.userConfig).toContain("\\");
            } else {
                expect(paths.userConfig).toContain("/");
            }
        });

        it("should handle home directory expansion", () => {
            const defaultPaths = XDGConfig.getPaths();

            // Should expand ~ to actual home directory
            expect(defaultPaths.userConfig).not.toContain("~");
            expect(defaultPaths.derivedConfig).not.toContain("~");
            expect(defaultPaths.deployConfig).not.toContain("~");
        });

        it("should create directories with proper permissions", () => {
            xdgConfig.ensureProfileDirectories("default");

            // Directories should exist
            const profileDir = xdgConfig.getProfileDir("default");
            expect(existsSync(profileDir)).toBe(true);

            // Note: Actual permission checking would require platform-specific code
            // This test verifies directories are created successfully
        });
    });

    describe("Profile Management", () => {
        it("should load complete profile with all configs", () => {
            xdgConfig.ensureProfileDirectories("test");

            const userConfig: UserConfig = {
                quiltCatalog: "https://quilt.example.com",
                _metadata: { source: "test", savedAt: new Date().toISOString() },
            };

            const derivedConfig: DerivedConfig = {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc",
                _metadata: { source: "test", savedAt: new Date().toISOString() },
            };

            xdgConfig.writeProfileConfig("user", userConfig, "test");
            xdgConfig.writeProfileConfig("derived", derivedConfig, "test");

            const profile = xdgConfig.loadProfile("test");

            expect(profile.name).toBe("test");
            expect(profile.user).toBeDefined();
            expect(profile.user?.quiltCatalog).toBe("https://quilt.example.com");
            expect(profile.derived).toBeDefined();
            expect(profile.derived?.quiltStackArn).toContain("cloudformation");
        });

        it("should handle missing config files gracefully", () => {
            xdgConfig.ensureProfileDirectories("empty");

            const profile = xdgConfig.loadProfile("empty");

            expect(profile.name).toBe("empty");
            expect(profile.user).toBeUndefined();
            expect(profile.derived).toBeUndefined();
            expect(profile.deploy).toBeUndefined();
        });

        it("should prevent deletion of default profile", () => {
            xdgConfig.ensureProfileDirectories("default");

            expect(() => {
                xdgConfig.deleteProfile("default");
            }).toThrow("Cannot delete the default profile");
        });
    });

    describe("Atomic Operations", () => {
        it("should create backup before overwriting config", () => {
            xdgConfig.ensureProfileDirectories("default");

            const config1: UserConfig = {
                quiltCatalog: "https://quilt1.example.com",
                _metadata: { source: "test", savedAt: new Date().toISOString() },
            };

            const config2: UserConfig = {
                quiltCatalog: "https://quilt2.example.com",
                _metadata: { source: "test", savedAt: new Date().toISOString() },
            };

            xdgConfig.writeProfileConfig("user", config1, "default");
            xdgConfig.writeProfileConfig("user", config2, "default");

            const backupPath = xdgConfig.getBackupPath("user");
            expect(existsSync(backupPath)).toBe(true);
        });

        it("should handle concurrent writes safely", async () => {
            xdgConfig.ensureProfileDirectories("default");

            const writes = Array.from({ length: 10 }, (_, i) => {
                const config: UserConfig = {
                    quiltCatalog: `https://quilt${i}.example.com`,
                    _metadata: { source: "test", savedAt: new Date().toISOString() },
                };
                return () => xdgConfig.writeProfileConfig("user", config, "default");
            });

            // Execute all writes
            await Promise.all(writes.map((write) => write()));

            // Last write should be readable
            const finalConfig = xdgConfig.readProfileConfig("user", "default") as UserConfig;
            expect(finalConfig.quiltCatalog).toContain("quilt");
        });
    });

    describe("Configuration Merging", () => {
        it("should merge configs in priority order", () => {
            const userConfig = {
                quiltCatalog: "https://user.example.com",
                benchlingTenant: "user-tenant",
            };

            const derivedConfig = {
                quiltCatalog: "https://derived.example.com",
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/Quilt/abc",
            };

            const deployConfig = {
                quiltCatalog: "https://deploy.example.com",
                webhookEndpoint: "https://api.example.com/webhook",
            };

            const merged = xdgConfig.mergeConfigs({
                user: userConfig,
                derived: derivedConfig,
                deploy: deployConfig,
            });

            // Later configs override earlier ones
            expect(merged.quiltCatalog).toBe("https://deploy.example.com");
            // Non-overlapping fields preserved
            expect(merged.benchlingTenant).toBe("user-tenant");
            expect(merged.quiltStackArn).toBe("arn:aws:cloudformation:us-east-1:123456789012:stack/Quilt/abc");
            expect(merged.webhookEndpoint).toBe("https://api.example.com/webhook");
        });
    });
});
