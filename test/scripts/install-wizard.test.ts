/**
 * Tests for Interactive Configuration Wizard
 */

import { runInstallWizard } from "../../scripts/install-wizard";
import { XDGConfig } from "../../lib/xdg-config";

// Mock inquirer
jest.mock("inquirer");
// Mock XDG Config
jest.mock("../../lib/xdg-config");
// Mock AWS SDK
jest.mock("@aws-sdk/client-s3");
jest.mock("@aws-sdk/client-secrets-manager");
// Mock infer-quilt-config
jest.mock("../../scripts/infer-quilt-config");
// Mock sync-secrets
jest.mock("../../scripts/sync-secrets");

describe("Interactive Configuration Wizard", () => {
    let mockXDGConfig: jest.Mocked<XDGConfig>;

    beforeEach(() => {
        mockXDGConfig = {
            ensureProfileDirectories: jest.fn(),
            writeProfileConfig: jest.fn(),
        } as unknown as jest.Mocked<XDGConfig>;

        (XDGConfig as jest.Mock).mockImplementation(() => mockXDGConfig);

        // Mock infer-quilt-config
        const { inferQuiltConfig } = require("../../scripts/infer-quilt-config");
        inferQuiltConfig.mockResolvedValue({
            catalogUrl: "https://quilt.example.com",
            quiltUserBucket: "test-bucket",
            quiltRegion: "us-east-1",
            source: "quilt3-cli",
        });
    });

    describe("runInstallWizard", () => {
        it("should handle non-interactive mode", async () => {
            // Set environment variables for non-interactive mode
            process.env.BENCHLING_TENANT = "test-tenant";
            process.env.BENCHLING_CLIENT_ID = "test-client-id";
            process.env.BENCHLING_CLIENT_SECRET = "test-secret";
            process.env.BENCHLING_APP_DEFINITION_ID = "test-app-id";

            const config = await runInstallWizard({
                nonInteractive: true,
                skipValidation: true,
            });

            expect(config.benchlingTenant).toBe("test-tenant");
            expect(config.benchlingClientId).toBe("test-client-id");
            expect(mockXDGConfig.writeProfileConfig).toHaveBeenCalled();

            // Clean up
            delete process.env.BENCHLING_TENANT;
            delete process.env.BENCHLING_CLIENT_ID;
            delete process.env.BENCHLING_CLIENT_SECRET;
            delete process.env.BENCHLING_APP_DEFINITION_ID;
        });

        it("should fail in non-interactive mode without required env vars", async () => {
            await expect(
                runInstallWizard({
                    nonInteractive: true,
                })
            ).rejects.toThrow("Non-interactive mode requires");
        });

        it("should use default profile when not specified", async () => {
            process.env.BENCHLING_TENANT = "test-tenant";
            process.env.BENCHLING_CLIENT_ID = "test-client-id";
            process.env.BENCHLING_CLIENT_SECRET = "test-secret";
            process.env.BENCHLING_APP_DEFINITION_ID = "test-app-id";

            await runInstallWizard({
                nonInteractive: true,
                skipValidation: true,
            });

            expect(mockXDGConfig.writeProfileConfig).toHaveBeenCalledWith(
                "user",
                expect.any(Object),
                "default"
            );

            // Clean up
            delete process.env.BENCHLING_TENANT;
            delete process.env.BENCHLING_CLIENT_ID;
            delete process.env.BENCHLING_CLIENT_SECRET;
            delete process.env.BENCHLING_APP_DEFINITION_ID;
        });

        it("should set default values for optional fields", async () => {
            process.env.BENCHLING_TENANT = "test-tenant";
            process.env.BENCHLING_CLIENT_ID = "test-client-id";
            process.env.BENCHLING_CLIENT_SECRET = "test-secret";
            process.env.BENCHLING_APP_DEFINITION_ID = "test-app-id";

            const config = await runInstallWizard({
                nonInteractive: true,
                skipValidation: true,
            });

            expect(config.pkgPrefix).toBe("benchling");
            expect(config.pkgKey).toBe("experiment_id");
            expect(config.logLevel).toBe("INFO");

            // Clean up
            delete process.env.BENCHLING_TENANT;
            delete process.env.BENCHLING_CLIENT_ID;
            delete process.env.BENCHLING_CLIENT_SECRET;
            delete process.env.BENCHLING_APP_DEFINITION_ID;
        });
    });
});
