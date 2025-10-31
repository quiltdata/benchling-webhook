import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";

// Mock chalk and boxen to avoid ESM issues in Jest
jest.mock("chalk", () => ({
    default: {
        green: (str: string) => str,
        cyan: (str: string) => str,
        dim: (str: string) => str,
        bold: (str: string) => str,
        red: (str: string) => str,
    },
    green: (str: string) => str,
    cyan: (str: string) => str,
    dim: (str: string) => str,
    bold: (str: string) => str,
    red: (str: string) => str,
}));

jest.mock("boxen", () => ({
    default: (str: string) => str,
}));

// Mock loadConfigSync to return config based on env vars and options
jest.mock("../lib/utils/config", () => ({
    loadConfigSync: jest.fn((options = {}) => {
        const config: Record<string, string> = {};

        // Load catalog from CLI option or env var
        if (options.catalog) {
            config.quiltCatalog = options.catalog;
        } else if (process.env.QUILT_CATALOG) {
            config.quiltCatalog = process.env.QUILT_CATALOG;
        }

        return config;
    }),
}));

// Suppress console output during tests and mock process.exit
const originalLog = console.log;
const originalError = console.error;
const originalExit = process.exit;

beforeAll(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    // Mock process.exit globally to prevent tests from exiting
    process.exit = jest.fn() as never;
});

afterAll(() => {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
});

import { manifestCommand } from "../bin/commands/manifest";

describe("manifest command", () => {
    const testOutputPath = resolve(__dirname, "test-manifest.yaml");

    afterEach(() => {
        // Clean up test manifest file
        if (existsSync(testOutputPath)) {
            unlinkSync(testOutputPath);
        }
    });

    describe("manifest generation", () => {
        it("should generate manifest with correct structure", async () => {
            await manifestCommand({ output: testOutputPath });

            expect(existsSync(testOutputPath)).toBe(true);

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("manifestVersion: 1");
            expect(content).toContain("info:");
            expect(content).toContain("name:");
            expect(content).toContain("features:");
            expect(content).toContain("subscriptions:");
        });

        it("should include version from package.json", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const pkg = require("../package.json");
            expect(content).toContain(`version: ${pkg.version}`);
        });

        it("should create manifest at default path if no output specified", async () => {
            const defaultPath = resolve(process.cwd(), "app-manifest.yaml");
            const testDefault = resolve(__dirname, "../app-manifest.yaml");

            try {
                await manifestCommand({});

                // Check that default file was created
                const exists = existsSync(defaultPath) || existsSync(testDefault);
                expect(exists).toBe(true);
            } finally {
                // Clean up default file
                if (existsSync(defaultPath)) {
                    unlinkSync(defaultPath);
                }
                if (existsSync(testDefault)) {
                    unlinkSync(testDefault);
                }
            }
        });
    });

    describe("CLI identifier format", () => {
        it("should generate manifest with hyphenated feature ID", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("id: quilt-entry");
        });

        it("should not contain underscores in feature ID", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).not.toContain("id: quilt_entry");
            expect(content).not.toContain("id: quilt_");

            // Verify the ID line specifically
            const lines = content.split("\n");
            const idLine = lines.find((line) => line.trim().startsWith("id:"));
            expect(idLine).toBeDefined();
            expect(idLine).toContain("quilt-entry");
            expect(idLine).not.toContain("_");
        });

        it("should use hyphen as separator in feature ID", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");

            // Extract the feature ID value
            const lines = content.split("\n");
            const idLine = lines.find((line) => line.trim().startsWith("id:"));
            expect(idLine).toBeDefined();

            const idValue = idLine!.split("id:")[1].trim();
            expect(idValue).toBe("quilt-entry");
            expect(idValue).toMatch(/^[a-z]+-[a-z]+$/);
        });

        it("should conform to DNS naming conventions (lowercase, hyphens only)", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");

            // Extract the feature ID value
            const lines = content.split("\n");
            const idLine = lines.find((line) => line.trim().startsWith("id:"));
            const idValue = idLine!.split("id:")[1].trim();

            // DNS naming rules: lowercase letters, numbers, hyphens only
            // Must start and end with alphanumeric
            expect(idValue).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
            expect(idValue.toLowerCase()).toBe(idValue); // All lowercase
        });

        it("should have feature ID that starts with alphanumeric character", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");

            const lines = content.split("\n");
            const idLine = lines.find((line) => line.trim().startsWith("id:"));
            const idValue = idLine!.split("id:")[1].trim();

            expect(idValue[0]).toMatch(/[a-z0-9]/);
            expect(idValue[0]).not.toBe("-");
        });

        it("should have feature ID that ends with alphanumeric character", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");

            const lines = content.split("\n");
            const idLine = lines.find((line) => line.trim().startsWith("id:"));
            const idValue = idLine!.split("id:")[1].trim();

            expect(idValue[idValue.length - 1]).toMatch(/[a-z0-9]/);
            expect(idValue[idValue.length - 1]).not.toBe("-");
        });
    });

    describe("feature definition", () => {
        it("should have feature with type CANVAS", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("type: CANVAS");
        });

        it("should have feature named 'Quilt Package'", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("name: Quilt Package");
        });

        it("should define feature with correct structure", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");

            // Check the features section has all required fields
            const lines = content.split("\n");
            const featuresIndex = lines.findIndex((line) => line.trim() === "features:");
            expect(featuresIndex).toBeGreaterThanOrEqual(0);

            const featureLines = lines.slice(featuresIndex, featuresIndex + 10).join("\n");
            expect(featureLines).toContain("name:");
            expect(featureLines).toContain("id:");
            expect(featureLines).toContain("type:");
        });
    });

    describe("subscription definitions", () => {
        it("should define webhook delivery method", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("deliveryMethod: WEBHOOK");
        });

        it("should subscribe to canvas interaction events", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("- type: v2.canvas.userInteracted");
            expect(content).toContain("- type: v2.canvas.created");
        });

        it("should subscribe to entry events", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("- type: v2.entry.created");
            expect(content).toContain("- type: v2.entry.updated.fields");
        });

        it("should have all required message types", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");

            const requiredTypes = [
                "v2.canvas.userInteracted",
                "v2.canvas.created",
                "v2.entry.created",
                "v2.entry.updated.fields",
            ];

            requiredTypes.forEach((type) => {
                expect(content).toContain(`- type: ${type}`);
            });
        });
    });

    describe("YAML format validation", () => {
        it("should produce valid YAML structure", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");

            // Basic YAML validation - no tabs, proper indentation
            expect(content).not.toContain("\t");

            // Check for proper YAML structure
            const lines = content.split("\n");
            lines.forEach((line, index) => {
                if (line.trim() && !line.trim().startsWith("#")) {
                    // Lines should be either key-value pairs or list items
                    const isKeyValue = line.includes(":");
                    const isListItem = line.trim().startsWith("-");
                    const isEmpty = line.trim() === "";

                    expect(isKeyValue || isListItem || isEmpty).toBe(true);
                }
            });
        });

        it("should use consistent indentation (2 spaces)", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");

            const lines = content.split("\n");
            lines.forEach((line) => {
                if (line.length > 0 && line[0] === " ") {
                    // Count leading spaces
                    const leadingSpaces = line.match(/^ */)?.[0].length || 0;
                    // Should be multiple of 2
                    expect(leadingSpaces % 2).toBe(0);
                }
            });
        });

        it("should end with newline", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content[content.length - 1]).toBe("\n");
        });
    });

    describe("manifest content completeness", () => {
        it("should include all top-level required fields", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");

            const requiredTopLevel = [
                "manifestVersion:",
                "info:",
                "features:",
                "subscriptions:",
            ];

            requiredTopLevel.forEach((field) => {
                expect(content).toContain(field);
            });
        });

        it("should include all info section fields", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");

            // Check info section
            expect(content).toContain("name:");
            expect(content).toContain("description:");
            expect(content).toContain("version:");
        });

        it("should have meaningful description", async () => {
            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");

            expect(content).toContain("description: Package Benchling notebook entries as Quilt data packages");
        });
    });

    describe("info.name from QUILT_CATALOG", () => {
        const originalEnv = process.env.QUILT_CATALOG;

        afterEach(() => {
            // Restore original env
            if (originalEnv) {
                process.env.QUILT_CATALOG = originalEnv;
            } else {
                delete process.env.QUILT_CATALOG;
            }
        });

        it("should use QUILT_CATALOG with hyphens for info.name when catalog is set", async () => {
            process.env.QUILT_CATALOG = "nightly.quilttest.com";

            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("name: nightly-quilttest-com");
        });

        it("should replace dots with hyphens in catalog domain", async () => {
            process.env.QUILT_CATALOG = "my.catalog.example.com";

            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("name: my-catalog-example-com");
        });

        it("should use CLI option catalog over env variable", async () => {
            process.env.QUILT_CATALOG = "env.catalog.com";

            await manifestCommand({ output: testOutputPath, catalog: "cli.catalog.com" });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("name: cli-catalog-com");
        });

        it("should fall back to default name when no catalog is configured", async () => {
            delete process.env.QUILT_CATALOG;

            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("name: Quilt Integration");
        });

        it("should handle simple domains without multiple dots", async () => {
            process.env.QUILT_CATALOG = "localhost";

            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("name: localhost");
        });

        it("should handle domains with port numbers", async () => {
            process.env.QUILT_CATALOG = "catalog.local:8080";

            await manifestCommand({ output: testOutputPath });

            const content = readFileSync(testOutputPath, "utf-8");
            // Port should be included and colons replaced with hyphens
            expect(content).toContain("name: catalog-local-8080");
        });
    });

    describe("error handling", () => {
        it("should call process.exit on write errors", async () => {
            const invalidPath = "/invalid/path/that/does/not/exist/manifest.yaml";

            await manifestCommand({ output: invalidPath });

            // Verify process.exit was called with error code 1
            expect(process.exit).toHaveBeenCalledWith(1);
        });
    });
});
