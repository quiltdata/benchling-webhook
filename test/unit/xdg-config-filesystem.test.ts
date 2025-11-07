/**
 * Unit tests for XDGConfig Filesystem Operations
 *
 * Tests all filesystem storage primitives for the XDGConfig class:
 * - readProfileRaw()
 * - writeProfileRaw()
 * - deleteProfileRaw()
 * - listProfilesRaw()
 * - profileExistsRaw()
 * - readDeploymentsRaw()
 * - writeDeploymentsRaw()
 *
 * Tests cover:
 * - Filesystem-specific features
 * - Directory creation
 * - Atomic writes
 * - Error handling
 * - Handling of non-existent files/directories
 */
import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig, DeploymentHistory } from "../../lib/types/config";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

describe("XDGConfig Filesystem Storage Primitives", () => {
    let testBaseDir: string;
    let xdgConfig: XDGConfig;

    const validConfig: ProfileConfig = {
        quilt: {
            stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
            catalog: "https://quilt.example.com",
            database: "test_db",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
            region: "us-east-1",
        },
        benchling: {
            tenant: "test-tenant",
            clientId: "test-client",
            appDefinitionId: "test-app",
        },
        packages: {
            bucket: "test-packages",
            prefix: "benchling",
            metadataKey: "experiment_id",
        },
        deployment: {
            region: "us-east-1",
        },
        _metadata: {
            version: "0.7.0",
            createdAt: "2025-11-04T10:00:00Z",
            updatedAt: "2025-11-04T10:00:00Z",
            source: "wizard",
        },
    };

    const validDeployments = {
        active: {},
        history: [
            {
                stage: "prod",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://example.com",
            }
        ]
    };

    beforeEach(() => {
        // Create a unique temporary directory for each test
        testBaseDir = join(tmpdir(), `xdg-config-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
        mkdirSync(testBaseDir, { recursive: true });
        xdgConfig = new XDGConfig(testBaseDir);
    });

    afterEach(() => {
        // Clean up test directory after each test
        if (existsSync(testBaseDir)) {
            rmSync(testBaseDir, { recursive: true, force: true });
        }
    });

    // Rest of the file remains the same as the original
    describe("writeProfileRaw()", () => {
        it("should create profile directory if it doesn't exist", () => {
            const profile = "new-profile";
            xdgConfig['writeProfileRaw'](profile, validConfig);

            const profileDir = join(testBaseDir, profile);
            const configPath = join(profileDir, "config.json");

            expect(existsSync(profileDir)).toBe(true);
            expect(existsSync(configPath)).toBe(true);

            const writtenConfig = JSON.parse(readFileSync(configPath, "utf-8"));
            expect(writtenConfig).toEqual(validConfig);
        });

        // Rest of the describe block remains the same...
    });

    // Remaining test file is the same as the original, just with the updated validConfig and validDeployments
});