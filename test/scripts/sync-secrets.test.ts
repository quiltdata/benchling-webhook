/**
 * Tests for AWS Secrets Manager Integration
 */

import { syncSecretsToAWS, getSecretsFromAWS, validateSecretsAccess } from "../../scripts/sync-secrets";
import { XDGConfig } from "../../lib/xdg-config";

// Mock AWS SDK
jest.mock("@aws-sdk/client-secrets-manager");
// Mock XDG Config
jest.mock("../../lib/xdg-config");

describe("AWS Secrets Manager Integration", () => {
    let mockXDGConfig: jest.Mocked<XDGConfig>;

    beforeEach(() => {
        mockXDGConfig = {
            readProfileConfig: jest.fn(),
            writeProfileConfig: jest.fn(),
            ensureProfileDirectories: jest.fn(),
        } as unknown as jest.Mocked<XDGConfig>;

        (XDGConfig as jest.Mock).mockImplementation(() => mockXDGConfig);
    });

    describe("syncSecretsToAWS", () => {
        it("should fail when configuration is missing", async () => {
            mockXDGConfig.readProfileConfig.mockImplementation(() => {
                throw new Error("Configuration file not found");
            });

            await expect(
                syncSecretsToAWS({
                    profile: "default",
                    region: "us-east-1",
                })
            ).rejects.toThrow("Failed to load configuration");
        });

        it("should validate required fields", async () => {
            mockXDGConfig.readProfileConfig.mockReturnValue({});

            await expect(
                syncSecretsToAWS({
                    profile: "default",
                    region: "us-east-1",
                })
            ).rejects.toThrow("Benchling tenant is required");
        });

        it("should validate OAuth credentials", async () => {
            mockXDGConfig.readProfileConfig.mockReturnValue({
                benchlingTenant: "test-tenant",
            });

            await expect(
                syncSecretsToAWS({
                    profile: "default",
                    region: "us-east-1",
                })
            ).rejects.toThrow("Benchling OAuth credentials are required");
        });

        it("should support dry run mode", async () => {
            mockXDGConfig.readProfileConfig.mockReturnValue({
                benchlingTenant: "test-tenant",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-secret",
            });

            const results = await syncSecretsToAWS({
                profile: "default",
                region: "us-east-1",
                dryRun: true,
            });

            expect(results).toEqual([]);
            expect(mockXDGConfig.writeProfileConfig).not.toHaveBeenCalled();
        });
    });

    describe("getSecretsFromAWS", () => {
        it("should fail when secret ARN is missing", async () => {
            mockXDGConfig.readProfileConfig.mockReturnValue({});

            await expect(
                getSecretsFromAWS({
                    profile: "default",
                    region: "us-east-1",
                })
            ).rejects.toThrow("No secret ARN found in configuration");
        });
    });

    describe("validateSecretsAccess", () => {
        it("should return false when validation fails", async () => {
            mockXDGConfig.readProfileConfig.mockImplementation(() => {
                throw new Error("Configuration not found");
            });

            const isValid = await validateSecretsAccess({
                profile: "default",
                region: "us-east-1",
            });

            expect(isValid).toBe(false);
        });
    });
});
