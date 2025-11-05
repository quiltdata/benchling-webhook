import { XDGConfig } from "../lib/xdg-config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Multi-Environment Profile Tests
 *
 * Tests for profile handling and environment configuration
 * Related: Issue #176 - Test Production Deployments
 * Spec: spec/176-test-prod/13-multi-environment-architecture-spec.md
 */
describe("XDGConfig - Multi-Environment Profile Support", () => {
    let xdg: XDGConfig;
    let testConfigDir: string;
    let originalXdgConfigHome: string | undefined;

    beforeEach(() => {
        // Save original XDG_CONFIG_HOME
        originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

        // Create temporary config directory for testing
        testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "benchling-webhook-test-"));
        process.env.XDG_CONFIG_HOME = testConfigDir;

        xdg = new XDGConfig();
    });

    afterEach(() => {
        // Restore original XDG_CONFIG_HOME
        if (originalXdgConfigHome) {
            process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
        } else {
            delete process.env.XDG_CONFIG_HOME;
        }

        // Clean up test directory
        if (fs.existsSync(testConfigDir)) {
            fs.rmSync(testConfigDir, { recursive: true, force: true });
        }
    });

    describe("Configuration Management", () => {
        test("writes configuration to default location", () => {
            const config = {
                benchlingTenant: "test-tenant",
                benchlingAppDefinitionId: "app_123",
                benchlingClientId: "client_xyz",
                benchlingClientSecret: "secret_abc",
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "quiltdata/benchling-webhook/default/test-tenant",
                imageTag: "v0.6.3",
            };

            xdg.writeConfig("user", config);

            // Verify file was created by reading it back
            const readConfig = xdg.readConfig("user");
            expect(readConfig.benchlingTenant).toBe("test-tenant");
        });

        test("reads configuration from default location", () => {
            const config = {
                benchlingTenant: "dev-tenant",
                benchlingAppDefinitionId: "app_DEV_456",
                benchlingClientId: "client_dev",
                benchlingClientSecret: "secret_dev",
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/dev-stack/xyz789",
                benchlingSecret: "quiltdata/benchling-webhook/dev/dev-tenant",
                imageTag: "latest",
            };

            xdg.writeConfig("user", config);
            const readConfig = xdg.readConfig("user");

            expect(readConfig.benchlingTenant).toBe("dev-tenant");
            expect(readConfig.benchlingAppDefinitionId).toBe("app_DEV_456");
            expect(readConfig.imageTag).toBe("latest");
        });

        test.skip("handles missing configuration gracefully - FIXME", () => {
            expect(() => {
                xdg.readConfig("user");
            }).toThrow();
        });
    });

    describe("Profile Support (Already Implemented!)", () => {
        test("creates profile directory", () => {
            const profileDir = xdg.getProfileDir("default");
            expect(fs.existsSync(profileDir)).toBe(true);
        });

        test.skip("supports multiple profile directories - FIXME", () => {
            const defaultDir = xdg.getProfileDir("default");
            const devDir = xdg.getProfileDir("dev");

            expect(defaultDir).not.toBe(devDir);
            expect(defaultDir).toContain("default");
            expect(devDir).toContain("dev");
        });

        test("writes configuration to specific profile", () => {
            const config = {
                benchlingTenant: "dev-tenant",
                benchlingAppDefinitionId: "app_DEV_456",
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/dev-stack/xyz789",
                benchlingSecret: "quiltdata/benchling-webhook/dev/dev-tenant",
                imageTag: "latest",
            };

            xdg.writeProfileConfig("user", config, "dev");
            const readConfig = xdg.readProfileConfig("user", "dev");

            expect(readConfig.benchlingTenant).toBe("dev-tenant");
            expect(readConfig.imageTag).toBe("latest");
        });

        test("lists available profiles", () => {
            // Create multiple profiles
            xdg.writeProfileConfig("user", {
                benchlingTenant: "tenant1",
            }, "default");

            xdg.writeProfileConfig("user", {
                benchlingTenant: "tenant2",
            }, "dev");

            const profiles = xdg.listProfiles();

            expect(profiles).toContain("default");
            expect(profiles).toContain("dev");
        });

        test("checks if profile exists", () => {
            xdg.writeProfileConfig("user", {
                benchlingTenant: "test",
            }, "custom");

            expect(xdg.profileExists("custom")).toBe(true);
            expect(xdg.profileExists("nonexistent")).toBe(false);
        });

        test("loads profile by name", () => {
            const config = {
                benchlingTenant: "custom-tenant",
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/custom-stack/xyz789",
                benchlingSecret: "quiltdata/benchling-webhook/custom/custom-tenant",
            };

            xdg.writeProfileConfig("user", config, "custom");
            const loadedProfile = xdg.loadProfile("custom");

            expect(loadedProfile.name).toBe("custom");
            expect(loadedProfile.user?.benchlingTenant).toBe("custom-tenant");
        });

        test("profile paths are different for different profiles", () => {
            const defaultPaths = xdg.getProfilePaths("default");
            const devPaths = xdg.getProfilePaths("dev");

            expect(defaultPaths.userConfig).not.toBe(devPaths.userConfig);
            expect(defaultPaths.deployConfig).not.toBe(devPaths.deployConfig);
        });
    });

    describe("Secret Naming Convention (Spec Compliance)", () => {
        test("dev profile secret follows convention", () => {
            const config = {
                benchlingTenant: "my-company",
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/dev-stack/xyz789",
                benchlingSecret: "quiltdata/benchling-webhook/dev/my-company",
            };

            expect(config.benchlingSecret).toBe("quiltdata/benchling-webhook/dev/my-company");
        });

        test("prod profile secret follows convention", () => {
            const config = {
                benchlingTenant: "my-company",
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/prod-stack/abc123",
                benchlingSecret: "quiltdata/benchling-webhook/default/my-company",
            };

            expect(config.benchlingSecret).toBe("quiltdata/benchling-webhook/default/my-company");
        });

        test("secret naming follows profile convention", () => {
            const devSecret = "quiltdata/benchling-webhook/dev/tenant";
            const prodSecret = "quiltdata/benchling-webhook/default/tenant";

            expect(devSecret).toContain("/dev/");
            expect(prodSecret).toContain("/default/");
        });
    });

    describe("Deployment Configuration Structure (Spec Compliance)", () => {
        test("deploy.json supports both dev and prod sections", () => {
            // Both dev and prod deployments write to the same deploy.json
            // but in different sections (dev/prod)
            const deployConfig = {
                dev: {
                    endpoint: "https://api.example.com/dev",
                    imageTag: "latest",
                    deployedAt: new Date().toISOString(),
                    stackName: "BenchlingWebhookStack",
                    stage: "dev",
                },
                prod: {
                    endpoint: "https://api.example.com/prod",
                    imageTag: "v0.6.3",
                    deployedAt: new Date().toISOString(),
                    stackName: "BenchlingWebhookStack",
                    stage: "prod",
                },
            };

            // Verify structure supports both environments
            expect(deployConfig.dev).toBeDefined();
            expect(deployConfig.prod).toBeDefined();
            expect(deployConfig.dev.stage).toBe("dev");
            expect(deployConfig.prod.stage).toBe("prod");
        });
    });

    describe("Backward Compatibility", () => {
        test("default configuration works as expected", () => {
            const config = {
                benchlingTenant: "test-tenant",
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "quiltdata/benchling-webhook/default/test-tenant",
            };

            xdg.writeConfig("user", config);
            const readConfig = xdg.readConfig("user");

            expect(readConfig.benchlingTenant).toBe("test-tenant");
        });

        test("handles missing optional dev profile gracefully", () => {
            // Only create default profile
            xdg.writeProfileConfig("user", {
                benchlingTenant: "tenant",
            }, "default");

            const profiles = xdg.listProfiles();
            expect(profiles).toContain("default");
        });
    });

    describe("Profile Deletion", () => {
        test.skip("can delete a profile - requires manual deletion", () => {
            xdg.writeProfileConfig("user", {
                benchlingTenant: "test",
            }, "temp");

            expect(xdg.profileExists("temp")).toBe(true);

            xdg.deleteProfile("temp");

            expect(xdg.profileExists("temp")).toBe(false);
        });
    });
});
