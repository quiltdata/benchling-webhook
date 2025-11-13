/**
 * Unit tests for Install Command
 *
 * Tests the install command orchestration that chains setup → deploy workflow.
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
};

// Make methods chainable
Object.keys(chalkMethods).forEach(method => {
    (chalkMethods as any)[method] = Object.assign(mockChalkFn, chalkMethods);
});

jest.mock("chalk", () => ({
    default: chalkMethods,
    ...chalkMethods,
}));

jest.mock("boxen", () => ({
    default: (text: string) => text,
}));

jest.mock("ora", () => ({
    default: () => ({
        start: jest.fn().mockReturnThis(),
        succeed: jest.fn().mockReturnThis(),
        fail: jest.fn().mockReturnThis(),
        stop: jest.fn().mockReturnThis(),
    }),
}));

jest.mock("enquirer", () => ({
    prompt: jest.fn(),
}));

jest.mock("inquirer");
jest.mock("../../bin/commands/setup-wizard");
jest.mock("../../bin/commands/deploy");
jest.mock("../../lib/next-steps-generator", () => ({
    generateNextSteps: jest.fn(() => "Next steps: ..."),
}));

import { installCommand, InstallCommandOptions } from "../../bin/commands/install";
import { setupWizardCommand } from "../../bin/commands/setup-wizard";
import { deployCommand } from "../../bin/commands/deploy";

const mockSetupWizard = setupWizardCommand as jest.MockedFunction<typeof setupWizardCommand>;
const mockDeploy = deployCommand as jest.MockedFunction<typeof deployCommand>;

describe("installCommand", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Default: setup succeeds
        mockSetupWizard.mockResolvedValue({
            success: true,
            profile: "default",
            config: {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "test.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    account: "123456789012",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-13T00:00:00Z",
                    updatedAt: "2025-11-13T00:00:00Z",
                    source: "wizard",
                },
            },
        });
    });

    describe("Episode 1: Foundation", () => {
        it("should call setup wizard", async () => {
            const options: InstallCommandOptions = {
                profile: "test",
                setupOnly: true, // Skip deploy for this test
            };

            await installCommand(options);

            expect(mockSetupWizard).toHaveBeenCalledWith(
                expect.objectContaining({
                    profile: "test",
                    isPartOfInstall: true,
                })
            );
        });

        it("should propagate errors from setup wizard", async () => {
            mockSetupWizard.mockRejectedValue(new Error("Setup failed"));

            await expect(installCommand({ profile: "test" })).rejects.toThrow("Setup failed");
        });

        it("should handle setup wizard returning error status", async () => {
            mockSetupWizard.mockResolvedValue({
                success: false,
                profile: "test",
                config: {} as any,
            });

            await expect(installCommand({ profile: "test" })).rejects.toThrow(
                "Setup failed. Please check the errors above and try again."
            );
        });
    });

    describe("Episode 3: Confirmation Prompt", () => {
        it("should skip deployment when --setup-only flag is provided", async () => {
            await installCommand({
                profile: "test",
                setupOnly: true,
            });

            expect(mockSetupWizard).toHaveBeenCalled();
            expect(mockDeploy).not.toHaveBeenCalled();
        });

        it("should throw error when both --yes and --setup-only are provided", async () => {
            await expect(
                installCommand({
                    profile: "test",
                    yes: true,
                    setupOnly: true,
                })
            ).rejects.toThrow("Cannot use both --setup-only and --yes flags");
        });
    });

    describe("Episode 4: Deploy Integration", () => {
        it("should call deploy command with --yes flag", async () => {
            mockSetupWizard.mockResolvedValue({
                success: true,
                profile: "dev",
                config: {} as any,
            });
            mockDeploy.mockResolvedValue(undefined);

            await installCommand({
                profile: "dev",
                yes: true,
            });

            expect(mockDeploy).toHaveBeenCalledWith(
                expect.objectContaining({
                    profile: "dev",
                    stage: "dev",
                })
            );
        });

        it("should determine stage as 'prod' for prod profile", async () => {
            mockSetupWizard.mockResolvedValue({
                success: true,
                profile: "prod",
                config: {} as any,
            });
            mockDeploy.mockResolvedValue(undefined);

            await installCommand({
                profile: "prod",
                yes: true,
            });

            expect(mockDeploy).toHaveBeenCalledWith(
                expect.objectContaining({
                    stage: "prod",
                })
            );
        });

        it("should determine stage as 'dev' for default profile", async () => {
            mockSetupWizard.mockResolvedValue({
                success: true,
                profile: "default",
                config: {} as any,
            });
            mockDeploy.mockResolvedValue(undefined);

            await installCommand({
                profile: "default",
                yes: true,
            });

            expect(mockDeploy).toHaveBeenCalledWith(
                expect.objectContaining({
                    stage: "dev",
                })
            );
        });

        it("should handle deploy command errors", async () => {
            mockDeploy.mockRejectedValue(new Error("Deploy failed"));

            await expect(
                installCommand({
                    profile: "test",
                    yes: true,
                })
            ).rejects.toThrow("Deploy failed");
        });

        it("should not call deploy if setup fails", async () => {
            mockSetupWizard.mockRejectedValue(new Error("Setup failed"));

            await expect(installCommand({ yes: true })).rejects.toThrow("Setup failed");

            expect(mockDeploy).not.toHaveBeenCalled();
        });
    });

    describe("Options Passing", () => {
        it("should pass profile to setup wizard", async () => {
            await installCommand({
                profile: "custom",
                setupOnly: true,
            });

            expect(mockSetupWizard).toHaveBeenCalledWith(
                expect.objectContaining({
                    profile: "custom",
                })
            );
        });

        it("should pass inheritFrom to setup wizard", async () => {
            await installCommand({
                profile: "test",
                inheritFrom: "prod",
                setupOnly: true,
            });

            expect(mockSetupWizard).toHaveBeenCalledWith(
                expect.objectContaining({
                    inheritFrom: "prod",
                })
            );
        });

        it("should pass AWS options to setup wizard", async () => {
            await installCommand({
                profile: "test",
                awsProfile: "my-profile",
                awsRegion: "us-west-2",
                setupOnly: true,
            });

            expect(mockSetupWizard).toHaveBeenCalledWith(
                expect.objectContaining({
                    awsProfile: "my-profile",
                    awsRegion: "us-west-2",
                })
            );
        });
    });
});
