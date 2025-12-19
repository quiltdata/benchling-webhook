/**
 * Unit tests for Clean Command
 *
 * Tests the clean command that removes configuration profiles and associated data.
 */

// Mock all ESM dependencies BEFORE importing anything else
const mockChalkFn = (str: string) => str;
const chalkMethods = {
    blue: mockChalkFn,
    green: mockChalkFn,
    yellow: mockChalkFn,
    red: mockChalkFn,
    bold: mockChalkFn,
    cyan: mockChalkFn,
    dim: mockChalkFn,
};

// Make methods chainable
Object.keys(chalkMethods).forEach((method) => {
    (chalkMethods as any)[method] = Object.assign(mockChalkFn, chalkMethods);
});

jest.mock("chalk", () => ({
    default: chalkMethods,
    ...chalkMethods,
}));

// Mock inquirer - must be before imports
jest.mock("inquirer");

import { cleanCommand } from "../../../bin/commands/clean";
import { XDGTest } from "../../helpers/xdg-test";
import { ProfileConfig } from "../../../lib/types/config";
import inquirer from "inquirer";

const mockPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;

describe("cleanCommand", () => {
    let xdg: XDGTest;
    const originalLog = console.log;

    // Sample profile configuration
    const testConfig: ProfileConfig = {
        quilt: {
            stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123",
            catalog: "quilt.example.com",
            database: "test_db",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
            region: "us-east-1",
        },
        benchling: {
            tenant: "example",
            clientId: "client-123",
            appDefinitionId: "app_123",
        },
        packages: {
            bucket: "benchling-packages",
            prefix: "benchling",
            metadataKey: "experiment_id",
        },
        deployment: {
            region: "us-east-1",
            account: "123456789012",
        },
        integratedStack: true,
        _metadata: {
            version: "0.9.7",
            createdAt: "2025-11-04T10:00:00Z",
            updatedAt: "2025-11-04T10:00:00Z",
            source: "wizard",
        },
    };

    beforeEach(() => {
        // Create temporary test directory
        xdg = new XDGTest();

        // Suppress console.log during tests
        console.log = jest.fn();

        // Reset mocks
        jest.clearAllMocks();
    });

    afterEach(() => {
        // Restore console.log
        console.log = originalLog;

        // Clean up test data
        xdg.clear();
    });

    describe("profile does not exist", () => {
        it("should show warning and list available profiles", async () => {
            // Create a different profile so we have something in the list
            xdg.writeProfile("other", testConfig);

            await cleanCommand({ profile: "nonexistent", xdg });

            // Check that console.log was called with appropriate messages
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("does not exist"));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("other"));
        });

        it("should show no profiles when none exist", async () => {
            await cleanCommand({ profile: "nonexistent", xdg });

            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("does not exist"));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("(none)"));
        });
    });

    describe("profile exists", () => {
        beforeEach(() => {
            xdg.writeProfile("test", testConfig);
        });

        it("should prompt for confirmation by default", async () => {
            mockPrompt.mockResolvedValue({ confirmed: false } as any);

            await cleanCommand({ profile: "test", xdg });

            expect(mockPrompt).toHaveBeenCalledWith([
                expect.objectContaining({
                    type: "confirm",
                    name: "confirmed",
                    message: expect.stringContaining("delete profile"),
                }),
            ]);
        });

        it("should cancel deletion when user declines", async () => {
            mockPrompt.mockResolvedValue({ confirmed: false } as any);

            await cleanCommand({ profile: "test", xdg });

            // Profile should still exist
            expect(xdg.profileExists("test")).toBe(true);
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("cancelled"));
        });

        it("should delete profile when user confirms", async () => {
            mockPrompt.mockResolvedValue({ confirmed: true } as any);

            await cleanCommand({ profile: "test", xdg });

            // Profile should be deleted
            expect(xdg.profileExists("test")).toBe(false);
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("deleted successfully"));
        });

        it("should skip confirmation with --yes flag", async () => {
            await cleanCommand({ profile: "test", yes: true, xdg });

            // Should not prompt
            expect(mockPrompt).not.toHaveBeenCalled();

            // Profile should be deleted
            expect(xdg.profileExists("test")).toBe(false);
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("deleted successfully"));
        });
    });

    describe("profile with active deployments", () => {
        beforeEach(() => {
            xdg.writeProfile("test", testConfig);
            xdg.recordDeployment("test", {
                stage: "dev",
                timestamp: new Date().toISOString(),
                imageTag: "latest",
                endpoint: "https://example.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack-test",
                region: "us-east-1",
            });
        });

        it("should show warning about active deployments", async () => {
            mockPrompt.mockResolvedValue({ confirmed: false } as any);

            await cleanCommand({ profile: "test", xdg });

            // Should show warning about active deployments
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Active Deployments"));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("dev"));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("destroy"));
        });

        it("should still allow deletion with confirmation", async () => {
            mockPrompt.mockResolvedValue({ confirmed: true } as any);

            await cleanCommand({ profile: "test", xdg });

            expect(xdg.profileExists("test")).toBe(false);
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("deleted successfully"));
        });
    });

    describe("default profile", () => {
        it("should throw error when trying to delete default profile", async () => {
            xdg.writeProfile("default", testConfig);
            mockPrompt.mockResolvedValue({ confirmed: true } as any);

            await expect(cleanCommand({ xdg })).rejects.toThrow(/Cannot delete the default profile/);
        });
    });

    describe("error handling", () => {
        it("should handle profile read errors gracefully", async () => {
            // Create a profile, then manually break it
            xdg.writeProfile("test", testConfig);

            // Mock readProfile to throw an error
            const originalReadProfile = xdg.readProfile.bind(xdg);
            xdg.readProfile = jest.fn().mockImplementation(() => {
                throw new Error("Read error");
            });

            mockPrompt.mockResolvedValue({ confirmed: true } as any);

            await cleanCommand({ profile: "test", xdg });

            // Should show warning but continue
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Warning"));

            // Restore original method
            xdg.readProfile = originalReadProfile;
        });
    });
});
