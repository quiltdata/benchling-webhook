/**
 * Test to verify XDG_CONFIG_HOME isolation
 * This test proves that tests don't overwrite real user config
 */
import { XDGConfig } from "../lib/xdg-config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("XDG_CONFIG_HOME Isolation", () => {
    let originalXdgConfigHome: string | undefined;
    let testTempDir: string;

    beforeEach(() => {
        originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
        testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xdg-isolation-test-"));
        process.env.XDG_CONFIG_HOME = testTempDir;
    });

    afterEach(() => {
        if (originalXdgConfigHome) {
            process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
        } else {
            delete process.env.XDG_CONFIG_HOME;
        }
        if (fs.existsSync(testTempDir)) {
            fs.rmSync(testTempDir, { recursive: true, force: true });
        }
    });

    test("XDGConfig respects XDG_CONFIG_HOME environment variable", () => {
        const xdg = new XDGConfig();
        const expectedBaseDir = path.join(testTempDir, "benchling-webhook");

        // Access private property for testing
        const actualBaseDir = (xdg as any).baseDir;

        expect(actualBaseDir).toBe(expectedBaseDir);
        expect(actualBaseDir).toContain(os.tmpdir());
        expect(actualBaseDir).not.toContain(os.homedir());
    });

    test("XDGConfig without XDG_CONFIG_HOME uses home directory", () => {
        delete process.env.XDG_CONFIG_HOME;

        const xdg = new XDGConfig();
        const expectedBaseDir = path.join(os.homedir(), ".config", "benchling-webhook");
        const actualBaseDir = (xdg as any).baseDir;

        expect(actualBaseDir).toBe(expectedBaseDir);
        expect(actualBaseDir).toContain(os.homedir());
    });

    test("Tests write to temp directory, not real config", () => {
        const xdg = new XDGConfig();

        // Write a test config
        const testConfig = {
            benchling: {
                tenant: "test-isolation",
                clientId: "test-client",
                clientSecret: "test-secret",
                appDefinitionId: "test-app",
            },
            quilt: {
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                catalog: "test.example.com",
                database: "test_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                region: "us-east-1",
            },
            packages: {
                prefix: "test",
                metadataKey: "test_id",
            },
            deployment: {
                region: "us-east-1",
                imageTag: "test",
            },
            _metadata: {
                version: "0.7.2",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: "cli" as const,
            },
        };

        xdg.writeProfile("default", testConfig);

        // Verify it wrote to temp dir
        const configPath = path.join(testTempDir, "benchling-webhook", "default", "config.json");
        expect(fs.existsSync(configPath)).toBe(true);

        // Verify it did NOT write to real home directory
        const realConfigPath = path.join(os.homedir(), ".config", "benchling-webhook", "default", "config.json");
        // If real config exists, verify it wasn't modified by checking content
        if (fs.existsSync(realConfigPath)) {
            const realConfigContent = JSON.parse(fs.readFileSync(realConfigPath, "utf-8"));
            expect(realConfigContent.benchling.tenant).not.toBe("test-isolation");
        }
    });
});
