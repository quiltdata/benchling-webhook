import { ConfigurationSaver } from "../lib/configuration-saver";
import { XDGConfig } from "../lib/xdg-config";
import * as fs from "fs";
import * as path from "path";

describe("ConfigurationSaver", () => {
    const testConfigDir = path.join(__dirname, ".test-config-saver");
    let xdgConfig: XDGConfig;

    beforeEach(() => {
        // Create test config directory
        if (!fs.existsSync(testConfigDir)) {
            fs.mkdirSync(testConfigDir, { recursive: true });
        }
        xdgConfig = new XDGConfig(testConfigDir);
        xdgConfig.ensureDirectories();
    });

    afterEach(() => {
        // Clean up test config directory
        if (fs.existsSync(testConfigDir)) {
            fs.rmSync(testConfigDir, { recursive: true, force: true });
        }
    });

    describe("save", () => {
        it("should save complete configuration to user config", async () => {
            // Arrange
            const config = {
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "client-secret",
                benchlingAppDefinitionId: "app-id",
            };

            // Act
            const result = await ConfigurationSaver.save(config, { xdgConfig });

            // Assert
            expect(result).toEqual(config);
            const savedConfig = xdgConfig.readConfig("user");
            expect(savedConfig).toMatchObject(config);
        });

        it("should save configuration with metadata", async () => {
            // Arrange
            const config = {
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
            };

            // Act
            await ConfigurationSaver.save(config, { xdgConfig });

            // Assert
            const savedConfig = xdgConfig.readConfig("user");
            expect(savedConfig).toHaveProperty("_metadata");
            expect(savedConfig._metadata).toHaveProperty("savedAt");
            expect(savedConfig._metadata).toHaveProperty("source");
        });

        it("should update derived configuration with inferred values", async () => {
            // Arrange
            const config = {
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "test-tenant",
            };

            // Act
            await ConfigurationSaver.save(config, { source: "quilt-cli", xdgConfig });

            // Assert
            const derivedConfig = xdgConfig.readConfig("derived");
            expect(derivedConfig).toHaveProperty("_metadata");
            expect((derivedConfig._metadata as any).source).toBe("quilt-cli");
            expect(derivedConfig._metadata).toHaveProperty("inferredAt");
        });

        it("should preserve existing configuration fields", async () => {
            // Arrange
            const existingConfig = {
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "existing-tenant",
            };
            xdgConfig.writeConfig("user", existingConfig);

            const newConfig = {
                benchlingClientId: "new-client-id",
                benchlingClientSecret: "new-secret",
            };

            // Act
            await ConfigurationSaver.save(newConfig, { merge: true, xdgConfig });

            // Assert
            const savedConfig = xdgConfig.readConfig("user");
            expect(savedConfig).toEqual({
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "existing-tenant",
                benchlingClientId: "new-client-id",
                benchlingClientSecret: "new-secret",
                _metadata: expect.any(Object),
            });
        });

        it("should validate configuration before saving", async () => {
            // Arrange
            const invalidConfig = {
                // Missing required fields
            };

            // Act & Assert
            await expect(ConfigurationSaver.save(invalidConfig, { xdgConfig }))
                .rejects.toThrow("Configuration validation failed");
        });

        it("should support custom save options", async () => {
            // Arrange
            const config = {
                catalogUrl: "https://quilt.example.com",
            };

            // Act
            await ConfigurationSaver.save(config, {
                source: "manual",
                skipValidation: true,
                xdgConfig,
            });

            // Assert
            const savedConfig = xdgConfig.readConfig("user");
            expect((savedConfig._metadata as any).source).toBe("manual");
        });
    });

    describe("saveToDerived", () => {
        it("should save inferred configuration to derived config", async () => {
            // Arrange
            const inferredConfig = {
                quiltUserBucket: "my-bucket",
                quiltRegion: "us-west-2",
            };

            // Act
            await ConfigurationSaver.saveToDerived(inferredConfig, { xdgConfig });

            // Assert
            const derivedConfig = xdgConfig.readConfig("derived");
            expect(derivedConfig).toMatchObject(inferredConfig);
            expect(derivedConfig).toHaveProperty("_metadata");
        });

        it("should track inference source", async () => {
            // Arrange
            const inferredConfig = {
                quiltUserBucket: "my-bucket",
            };

            // Act
            await ConfigurationSaver.saveToDerived(inferredConfig, { source: "quilt-cli", xdgConfig });

            // Assert
            const derivedConfig = xdgConfig.readConfig("derived");
            expect((derivedConfig._metadata as any).source).toBe("quilt-cli");
        });
    });

    describe("saveToDeployment", () => {
        it("should save deployment outputs to deployment config", async () => {
            // Arrange
            const deploymentConfig = {
                webhookEndpoint: "https://api.example.com/webhook",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789:stack/test",
                deployedAt: new Date().toISOString(),
            };

            // Act
            await ConfigurationSaver.saveToDeployment(deploymentConfig, { xdgConfig });

            // Assert
            const deployConfig = xdgConfig.readConfig("deploy");
            expect(deployConfig).toMatchObject(deploymentConfig);
        });
    });

    describe("getMetadata", () => {
        it("should create metadata with timestamp", () => {
            // Act
            const metadata = ConfigurationSaver.getMetadata({ source: "test" });

            // Assert
            expect(metadata).toHaveProperty("savedAt");
            expect(metadata).toHaveProperty("source", "test");
            expect(new Date(metadata.savedAt)).toBeInstanceOf(Date);
        });

        it("should include version information", () => {
            // Act
            const metadata = ConfigurationSaver.getMetadata({});

            // Assert
            expect(metadata).toHaveProperty("version");
        });
    });
});
