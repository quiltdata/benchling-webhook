import { existsSync, rmdirSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import { XDGConfig } from "../lib/xdg-config";

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
        const expandHomeDir = (path: string): string => {
            const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
            return path.replace(/^~/, homeDir);
        };

        const paths = XDGConfig.getPaths();
        expect(paths).toEqual({
            userConfig: expandHomeDir("~/.config/benchling-webhook/default.json"),
            derivedConfig: expandHomeDir("~/.config/benchling-webhook/config/default.json"),
            deployConfig: expandHomeDir("~/.config/benchling-webhook/deploy/default.json"),
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
            const invalidConfig = { invalid: "config" };
            writeFileSync(userConfigPath, JSON.stringify(invalidConfig, null, 4));

            expect(() => testInstance.readConfig("user")).toThrow("Invalid configuration schema");
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
            const invalidConfig = { invalid: "config" };

            expect(() => testInstance.writeConfig("user", invalidConfig)).toThrow("Invalid configuration schema");
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
});
