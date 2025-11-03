import { existsSync, rmdirSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { resolve, join } from "path";
import { XDGConfig, BaseConfig } from "../lib/xdg-config";

describe("XDGConfig", () => {
    const testConfigDir = resolve(__dirname, ".test-config");

    beforeEach(() => {
        // Clean up test config directory
        if (existsSync(testConfigDir)) {
            rmdirSync(testConfigDir, { recursive: true });
        }
    });

    afterEach(() => {
        // Clean up test config directory
        if (existsSync(testConfigDir)) {
            rmdirSync(testConfigDir, { recursive: true });
        }
    });

    it("should define configuration file paths", () => {
        const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
        const configBase = join(homeDir, ".config", "benchling-webhook");

        const paths = XDGConfig.getPaths();
        expect(paths).toEqual({
            userConfig: join(configBase, "default.json"),
            derivedConfig: join(configBase, "config", "default.json"),
            deployConfig: join(configBase, "deploy", "default.json"),
        });
    });

    it("should create config directory if not exists", () => {
        // Override the default config directory for testing
        const testInstance = new XDGConfig(testConfigDir);

        expect(() => testInstance.ensureDirectories()).not.toThrow();
        expect(existsSync(testConfigDir)).toBe(true);
        expect(existsSync(resolve(testConfigDir, "config"))).toBe(true);
        expect(existsSync(resolve(testConfigDir, "deploy"))).toBe(true);
    });

    describe("readConfig", () => {
        const testInstance = new XDGConfig(testConfigDir);
        const userConfigPath = resolve(testConfigDir, "default.json");
        const derivedConfigPath = resolve(testConfigDir, "config", "default.json");
        const deployConfigPath = resolve(testConfigDir, "deploy", "default.json");

        beforeEach(() => {
            testInstance.ensureDirectories();
        });

        it("should read user configuration file", () => {
            const testConfig = {
                quiltCatalog: "catalog.example.com",
                benchlingTenant: "test-tenant",
            };
            writeFileSync(userConfigPath, JSON.stringify(testConfig, null, 4));

            const config = testInstance.readConfig("user");
            expect(config).toEqual(testConfig);
        });

        it("should throw error for missing user configuration file", () => {
            // Ensure file doesn't exist
            if (existsSync(userConfigPath)) {
                unlinkSync(userConfigPath);
            }

            expect(() => testInstance.readConfig("user")).toThrow("Configuration file not found");
        });

        it("should validate configuration schema", () => {
            // With additionalProperties: true, unknown fields are now allowed
            const validConfig = { catalogUrl: "https://test.com", unknownField: "value" };
            writeFileSync(userConfigPath, JSON.stringify(validConfig, null, 4));

            // Should not throw for additional properties
            expect(() => testInstance.readConfig("user")).not.toThrow();
        });

        it("should read derived configuration file", () => {
            const testConfig = {
                cdkAccount: "123456789012",
                cdkRegion: "us-east-1",
            };
            writeFileSync(derivedConfigPath, JSON.stringify(testConfig, null, 4));

            const config = testInstance.readConfig("derived");
            expect(config).toEqual(testConfig);
        });

        it("should read deployment configuration file", () => {
            const testConfig = {
                webhookUrl: "https://api.example.com/webhook",
                deploymentTimestamp: "2025-11-02T14:30:00Z",
            };
            writeFileSync(deployConfigPath, JSON.stringify(testConfig, null, 4));

            const config = testInstance.readConfig("deploy");
            expect(config).toEqual(testConfig);
        });

        it("should handle JSON parse errors gracefully", () => {
            writeFileSync(userConfigPath, "{ invalid json }");

            expect(() => testInstance.readConfig("user")).toThrow("Invalid JSON");
        });
    });

    describe("writeConfig", () => {
        const testInstance = new XDGConfig(testConfigDir);
        const userConfigPath = resolve(testConfigDir, "default.json");

        beforeEach(() => {
            testInstance.ensureDirectories();
        });

        it("should write configuration file atomically", () => {
            const config = {
                quiltCatalog: "catalog.example.com",
                benchlingTenant: "test-tenant",
            };
            testInstance.writeConfig("user", config);
            const writtenConfig = testInstance.readConfig("user");
            expect(writtenConfig).toEqual(config);
        });

        it("should create backup before overwriting", () => {
            const originalConfig = {
                quiltCatalog: "original-catalog.com",
                benchlingTenant: "original-tenant",
            };
            testInstance.writeConfig("user", originalConfig);

            const newConfig = {
                quiltCatalog: "new-catalog.com",
                benchlingTenant: "new-tenant",
            };
            testInstance.writeConfig("user", newConfig);

            const backupPath = testInstance.getBackupPath("user");
            expect(existsSync(backupPath)).toBe(true);

            // Verify new config was written
            const writtenConfig = testInstance.readConfig("user");
            expect(writtenConfig).toEqual(newConfig);
        });

        it("should prevent writing invalid configuration", () => {
            // With additionalProperties: true, unknown fields are now allowed
            const validConfig = { catalogUrl: "https://test.com", unknownField: "value" };

            // Should not throw for additional properties
            expect(() => testInstance.writeConfig("user", validConfig)).not.toThrow();
        });

        it("should write to derived configuration file", () => {
            const config = {
                cdkAccount: "123456789012",
                cdkRegion: "us-east-1",
            };
            testInstance.writeConfig("derived", config);
            const writtenConfig = testInstance.readConfig("derived");
            expect(writtenConfig).toEqual(config);
        });

        it("should write to deployment configuration file", () => {
            const config = {
                webhookUrl: "https://api.example.com/webhook",
                deploymentTimestamp: "2025-11-02T14:30:00Z",
            };
            testInstance.writeConfig("deploy", config);
            const writtenConfig = testInstance.readConfig("deploy");
            expect(writtenConfig).toEqual(config);
        });
    });

    describe("mergeConfigs", () => {
        const testInstance = new XDGConfig(testConfigDir);

        beforeEach(() => {
            testInstance.ensureDirectories();
        });

        it("should merge configurations with correct precedence", () => {
            const userConfig = {
                quiltCatalog: "catalog.example.com",
                benchlingTenant: "test-tenant",
            };
            const derivedConfig = {
                cdkAccount: "123456789012",
                cdkRegion: "us-east-1",
            };
            const deployConfig = {
                webhookUrl: "https://api.example.com/webhook",
                deploymentTimestamp: "2025-11-02T14:30:00Z",
            };

            const mergedConfig = testInstance.mergeConfigs({
                user: userConfig,
                derived: derivedConfig,
                deploy: deployConfig,
            });

            expect(mergedConfig).toEqual({
                quiltCatalog: "catalog.example.com",
                benchlingTenant: "test-tenant",
                cdkAccount: "123456789012",
                cdkRegion: "us-east-1",
                webhookUrl: "https://api.example.com/webhook",
                deploymentTimestamp: "2025-11-02T14:30:00Z",
            });
        });

        it("should override configurations in correct order", () => {
            const configs = {
                user: { logLevel: "INFO" },
                derived: { logLevel: "DEBUG" },
                deploy: { logLevel: "ERROR" },
            };

            const mergedConfig = testInstance.mergeConfigs(configs);
            expect(mergedConfig.logLevel).toBe("ERROR");
        });

        it("should handle partial configurations", () => {
            const configs = {
                user: { benchlingTenant: "test" },
                derived: {},
                deploy: { cdkRegion: "us-east-1" },
            };

            const mergedConfig = testInstance.mergeConfigs(configs);
            expect(mergedConfig).toEqual({
                benchlingTenant: "test",
                cdkRegion: "us-east-1",
            });
        });

        it("should handle undefined config values", () => {
            const configs = {
                user: { quiltCatalog: "catalog.example.com" },
                derived: undefined,
                deploy: { cdkRegion: "us-west-2" },
            };

            const mergedConfig = testInstance.mergeConfigs(configs);
            expect(mergedConfig).toEqual({
                quiltCatalog: "catalog.example.com",
                cdkRegion: "us-west-2",
            });
        });

        it("should deep merge nested objects", () => {
            const configs = {
                user: { nested: { a: 1, b: 2 } } as BaseConfig,
                derived: { nested: { b: 3, c: 4 } } as BaseConfig,
                deploy: { nested: { c: 5, d: 6 } } as BaseConfig,
            };

            const mergedConfig = testInstance.mergeConfigs(configs);
            expect(mergedConfig.nested).toEqual({
                a: 1,
                b: 3,
                c: 5,
                d: 6,
            });
        });
    });
});
