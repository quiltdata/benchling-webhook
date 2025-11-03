import { existsSync, rmdirSync, mkdirSync } from "fs";
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
});
