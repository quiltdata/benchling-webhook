import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

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

// Mock XDGConfig before importing
jest.mock("../lib/xdg-config", () => {
    return {
        XDGConfig: jest.fn().mockImplementation(() => ({
            profileExists: jest.fn().mockReturnValue(false),
            readProfile: jest.fn().mockReturnValue({
                quilt: { catalog: "test.catalog.com" },
            }),
        })),
    };
});

import { manifestCommand, generateManifest } from "../bin/commands/manifest";

describe("generateManifest (pure function)", () => {
    describe("manifest content generation", () => {
        it("should generate manifest with correct structure", () => {
            const content = generateManifest();
            expect(content).toContain("manifestVersion: 1");
            expect(content).toContain("info:");
            expect(content).toContain("name:");
            expect(content).toContain("features:");
            expect(content).toContain("subscriptions:");
        });

        it("should include version from package.json", () => {
            const content = generateManifest();
            const pkg = require("../package.json");
            expect(content).toContain(`version: ${pkg.version}`);
        });

        it("should use default name when no catalog provided", () => {
            const content = generateManifest();
            expect(content).toContain("name: Quilt Integration");
        });

        it("should use catalog URL for app name when provided", () => {
            const content = generateManifest("nightly.quilttest.com");
            expect(content).toContain("name: nightly-quilttest-com");
        });

        it("should replace dots with hyphens in catalog domain", () => {
            const content = generateManifest("my.catalog.example.com");
            expect(content).toContain("name: my-catalog-example-com");
        });

        it("should handle domains with port numbers", () => {
            const content = generateManifest("catalog.local:8080");
            expect(content).toContain("name: catalog-local-8080");
        });
    });

    describe("CLI identifier format", () => {
        it("should generate manifest with hyphenated feature ID", () => {
            const content = generateManifest();
            expect(content).toContain("id: quilt-entry");
        });

        it("should not contain underscores in feature ID", () => {
            const content = generateManifest();
            expect(content).not.toContain("id: quilt_entry");
            expect(content).not.toContain("id: quilt_");

            const lines = content.split("\n");
            const idLine = lines.find((line) => line.trim().startsWith("id:"));
            expect(idLine).toBeDefined();
            expect(idLine).toContain("quilt-entry");
            expect(idLine).not.toContain("_");
        });

        it("should use hyphen as separator in feature ID", () => {
            const content = generateManifest();
            const lines = content.split("\n");
            const idLine = lines.find((line) => line.trim().startsWith("id:"));
            expect(idLine).toBeDefined();

            const idValue = idLine!.split("id:")[1].trim();
            expect(idValue).toBe("quilt-entry");
            expect(idValue).toMatch(/^[a-z]+-[a-z]+$/);
        });

        it("should conform to DNS naming conventions", () => {
            const content = generateManifest();
            const lines = content.split("\n");
            const idLine = lines.find((line) => line.trim().startsWith("id:"));
            const idValue = idLine!.split("id:")[1].trim();

            expect(idValue).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
            expect(idValue.toLowerCase()).toBe(idValue);
        });
    });

    describe("feature definition", () => {
        it("should have feature with type CANVAS", () => {
            const content = generateManifest();
            expect(content).toContain("type: CANVAS");
        });

        it("should have feature named 'Quilt Package'", () => {
            const content = generateManifest();
            expect(content).toContain("name: Quilt Package");
        });
    });

    describe("subscription definitions", () => {
        it("should define webhook delivery method", () => {
            const content = generateManifest();
            expect(content).toContain("deliveryMethod: WEBHOOK");
        });

        it("should subscribe to all required event types", () => {
            const content = generateManifest();
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
        it("should produce valid YAML structure", () => {
            const content = generateManifest();
            expect(content).not.toContain("\t");

            const lines = content.split("\n");
            lines.forEach((line) => {
                if (line.trim() && !line.trim().startsWith("#")) {
                    const isKeyValue = line.includes(":");
                    const isListItem = line.trim().startsWith("-");
                    const isEmpty = line.trim() === "";
                    expect(isKeyValue || isListItem || isEmpty).toBe(true);
                }
            });
        });

        it("should use consistent indentation (2 spaces)", () => {
            const content = generateManifest();
            const lines = content.split("\n");
            lines.forEach((line) => {
                if (line.length > 0 && line[0] === " ") {
                    const leadingSpaces = line.match(/^ */)?.[0].length || 0;
                    expect(leadingSpaces % 2).toBe(0);
                }
            });
        });

        it("should end with newline", () => {
            const content = generateManifest();
            expect(content[content.length - 1]).toBe("\n");
        });
    });
});

describe("manifestCommand", () => {
    const testOutputPath = resolve(__dirname, "test-manifest.yaml");

    afterEach(() => {
        // Clean up test manifest file
        if (existsSync(testOutputPath)) {
            unlinkSync(testOutputPath);
        }
    });

    describe("file creation", () => {
        it("should create manifest file at specified path", async () => {
            await manifestCommand({ output: testOutputPath });
            expect(existsSync(testOutputPath)).toBe(true);
        });

        it("should create manifest at default path if no output specified", async () => {
            const defaultPath = resolve(process.cwd(), "app-manifest.yaml");
            const testDefault = resolve(__dirname, "../app-manifest.yaml");

            try {
                await manifestCommand({});
                const exists = existsSync(defaultPath) || existsSync(testDefault);
                expect(exists).toBe(true);
            } finally {
                if (existsSync(defaultPath)) {
                    unlinkSync(defaultPath);
                }
                if (existsSync(testDefault)) {
                    unlinkSync(testDefault);
                }
            }
        });
    });

    describe("catalog URL handling", () => {
        it("should use catalog from CLI option when provided", async () => {
            await manifestCommand({
                output: testOutputPath,
                catalog: "cli.catalog.com"
            });

            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("name: cli-catalog-com");
        });

        it("should use default name when no catalog or profile provided", async () => {
            await manifestCommand({ output: testOutputPath });
            const content = readFileSync(testOutputPath, "utf-8");
            expect(content).toContain("name: Quilt Integration");
        });
    });

    describe("error handling", () => {
        it("should call process.exit on write errors", async () => {
            const invalidPath = "/invalid/path/that/does/not/exist/manifest.yaml";
            await manifestCommand({ output: invalidPath });
            expect(process.exit).toHaveBeenCalledWith(1);
        });
    });
});
