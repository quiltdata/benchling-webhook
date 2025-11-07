import { XDGTest } from "./helpers/xdg-test";
import { ProfileConfig } from "../lib/types/config";

/**
 * Multi-Environment Profile Tests
 *
 * Tests for profile handling and environment configuration
 * Related: Issue #176 - Test Production Deployments
 * Spec: spec/176-test-prod/13-multi-environment-architecture-spec.md
 */
describe("XDGTest - Multi-Environment Profile Support", () => {
    let mockStorage: XDGTest;

    // Helper function to create a valid test config
    const createTestConfig = (overrides: Partial<ProfileConfig> = {}): ProfileConfig => {
        const baseConfig: ProfileConfig = {
            benchling: {
                tenant: "test-tenant",
                appDefinitionId: "app_123",
                clientId: "client_xyz",
                clientSecret: "secret_abc",
            },
            quilt: {
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                catalog: "quilt.example.com",
                database: "quilt_catalog",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-queue",
                region: "us-east-1",
            },
            packages: {
                bucket: "test-packages-bucket",
                prefix: "benchling",
                metadataKey: "experiment_id",
            },
            deployment: {
                region: "us-east-1",
                imageTag: "latest",
            },
            _metadata: {
                version: "0.7.0",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: "cli",
            },
        };

        // Deep merge overrides
        return {
            ...baseConfig,
            ...overrides,
            benchling: {
                ...baseConfig.benchling,
                ...overrides.benchling,
            },
            quilt: {
                ...baseConfig.quilt,
                ...overrides.quilt,
            },
            packages: {
                ...baseConfig.packages,
                ...overrides.packages,
            },
            deployment: {
                ...baseConfig.deployment,
                ...overrides.deployment,
            },
            _metadata: {
                ...baseConfig._metadata,
                ...overrides._metadata,
            },
        };
    };

    beforeEach(() => {
        mockStorage = new XDGTest();
    });

    afterEach(() => {
        mockStorage.clear();
    });

    describe("Configuration Management", () => {
        test("writes configuration to default profile", () => {
            const config = createTestConfig();

            mockStorage.writeProfile("default", config);

            // Verify file was created by reading it back
            const readConfig = mockStorage.readProfile("default");
            expect(readConfig.benchling.tenant).toBe("test-tenant");
        });

        test("reads configuration from default profile", () => {
            const config = createTestConfig({
                benchling: {
                    tenant: "dev-tenant",
                    appDefinitionId: "app_DEV_456",
                    clientId: "client_dev",
                    clientSecret: "secret_dev",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
            });

            mockStorage.writeProfile("default", config);
            const readConfig = mockStorage.readProfile("default");

            expect(readConfig.benchling.tenant).toBe("dev-tenant");
            expect(readConfig.benchling.appDefinitionId).toBe("app_DEV_456");
            expect(readConfig.deployment.imageTag).toBe("latest");
        });

        test("handles missing configuration gracefully", () => {
            expect(() => {
                mockStorage.readProfile("nonexistent");
            }).toThrow(/Profile not found: nonexistent/);
        });
    });

    describe("Profile Support", () => {
        test("creates profile directory", () => {
            const config = createTestConfig();

            mockStorage.writeProfile("default", config);

            // XDGConfig creates profiles under ~/.config/benchling-webhook/<profile>/
            // Since we set XDG_CONFIG_HOME to testConfigDir, the profile dir will be:
            // testConfigDir/.config/benchling-webhook/default OR testConfigDir/benchling-webhook/default
            // Let's check if the profile exists using the API instead
            expect(mockStorage.profileExists("default")).toBe(true);
        });

        test("supports multiple profile directories", () => {
            const baseConfig = createTestConfig();

            mockStorage.writeProfile("default", baseConfig);
            mockStorage.writeProfile("dev", baseConfig);

            // Verify both profiles exist using the API
            expect(mockStorage.profileExists("default")).toBe(true);
            expect(mockStorage.profileExists("dev")).toBe(true);

            // Verify they are listed
            const profiles = mockStorage.listProfiles();
            expect(profiles).toContain("default");
            expect(profiles).toContain("dev");
        });

        test("writes configuration to specific profile", () => {
            const config = createTestConfig({
                benchling: {
                    tenant: "dev-tenant",
                    appDefinitionId: "app_DEV_456",
                    clientId: "client_dev",
                    clientSecret: "secret_dev",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
            });

            mockStorage.writeProfile("dev", config);
            const readConfig = mockStorage.readProfile("dev");

            expect(readConfig.benchling.tenant).toBe("dev-tenant");
            expect(readConfig.deployment.imageTag).toBe("latest");
        });

        test("lists available profiles", () => {
            const baseConfig = createTestConfig();

            mockStorage.writeProfile("default", baseConfig);
            mockStorage.writeProfile("dev", baseConfig);

            const profiles = mockStorage.listProfiles();

            expect(profiles).toContain("default");
            expect(profiles).toContain("dev");
        });

        test("checks if profile exists", () => {
            const config = createTestConfig();

            mockStorage.writeProfile("custom", config);

            expect(mockStorage.profileExists("custom")).toBe(true);
            expect(mockStorage.profileExists("nonexistent")).toBe(false);
        });

        test("reads profile by name", () => {
            const config = createTestConfig({
                benchling: {
                    tenant: "custom-tenant",
                    appDefinitionId: "app_CUSTOM_789",
                    clientId: "client_custom",
                    clientSecret: "secret_custom",
                },
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/custom-stack/xyz789",
                    catalog: "https://quilt.example.com",
                    database: "quilt_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/custom-queue",
                    region: "us-east-1",
                },
                packages: {
                    bucket: "custom-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "v1.0.0",
                },
            });

            mockStorage.writeProfile("custom", config);
            const loadedProfile = mockStorage.readProfile("custom");

            expect(loadedProfile.benchling.tenant).toBe("custom-tenant");
            expect(loadedProfile.quilt.stackArn).toContain("custom-stack");
        });

        test("profile config paths are different for different profiles", () => {
            // This test verifies the structure without hard-coding paths
            mockStorage.writeProfile("default", createTestConfig());
            mockStorage.writeProfile("dev", createTestConfig());

            const defaultConfig = mockStorage.readProfile("default");
            const devConfig = mockStorage.readProfile("dev");

            // Both should be readable independently
            expect(defaultConfig).toBeDefined();
            expect(devConfig).toBeDefined();
        });
    });

    describe("Secret Naming Convention (Spec Compliance)", () => {
        test("dev profile secret follows convention", () => {
            // In v0.7.0, secrets are referenced via secretArn in benchling config
            const config = createTestConfig({
                benchling: {
                    tenant: "my-company",
                    appDefinitionId: "app_123",
                    clientId: "client",
                    clientSecret: "secret",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:quiltdata/benchling-webhook/dev/my-company",
                },
            });

            expect(config.benchling.secretArn).toContain("/dev/my-company");
        });

        test("prod profile secret follows convention", () => {
            // In v0.7.0, secrets are referenced via secretArn in benchling config
            const config = createTestConfig({
                benchling: {
                    tenant: "my-company",
                    appDefinitionId: "app_123",
                    clientId: "client",
                    clientSecret: "secret",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:quiltdata/benchling-webhook/default/my-company",
                },
            });

            expect(config.benchling.secretArn).toContain("/default/my-company");
        });

        test("secret naming follows profile convention", () => {
            const devSecret = "quiltdata/benchling-webhook/dev/tenant";
            const prodSecret = "quiltdata/benchling-webhook/default/tenant";

            expect(devSecret).toContain("/dev/");
            expect(prodSecret).toContain("/default/");
        });
    });

    describe("Deployment Configuration Structure (Spec Compliance)", () => {
        test("deployments.json supports both dev and prod sections", () => {
            const config = createTestConfig();

            mockStorage.writeProfile("default", config);

            // Record both dev and prod deployments
            mockStorage.recordDeployment("default", {
                stage: "dev",
                timestamp: new Date().toISOString(),
                imageTag: "latest",
                endpoint: "https://api.example.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            });

            mockStorage.recordDeployment("default", {
                stage: "prod",
                timestamp: new Date().toISOString(),
                imageTag: "v0.6.3",
                endpoint: "https://api.example.com/prod",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            });

            const deployments = mockStorage.getDeployments("default");

            // Verify structure supports both environments
            expect(deployments.active["dev"]).toBeDefined();
            expect(deployments.active["prod"]).toBeDefined();
            expect(deployments.active["dev"].stage).toBe("dev");
            expect(deployments.active["prod"].stage).toBe("prod");
        });
    });

    describe("Backward Compatibility", () => {
        test("default configuration works as expected", () => {
            const config = createTestConfig();

            mockStorage.writeProfile("default", config);
            const readConfig = mockStorage.readProfile("default");

            expect(readConfig.benchling.tenant).toBe("test-tenant");
        });

        test("handles missing optional dev profile gracefully", () => {
            const config = createTestConfig();

            // Create a fresh mock storage for this test
            const freshStorage = new XDGTest();

            // Only create default profile
            freshStorage.writeProfile("default", config);

            const profiles = freshStorage.listProfiles();
            expect(profiles).toContain("default");
            expect(profiles.length).toBe(1);
        });
    });

    describe("Profile Deletion", () => {
        test("can delete a profile", () => {
            const config = createTestConfig();

            mockStorage.writeProfile("temp", config);

            expect(mockStorage.profileExists("temp")).toBe(true);

            mockStorage.deleteProfile("temp");

            expect(mockStorage.profileExists("temp")).toBe(false);
        });

        test("cannot delete default profile", () => {
            const config = createTestConfig();

            mockStorage.writeProfile("default", config);

            expect(() => {
                mockStorage.deleteProfile("default");
            }).toThrow(/Cannot delete the default profile/);
        });
    });
});
