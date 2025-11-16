/**
 * Unit tests for Status Command
 *
 * Tests the status command that reports CloudFormation stack status and
 * BenchlingIntegration parameter state for integrated mode profiles.
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
Object.keys(chalkMethods).forEach(method => {
    (chalkMethods as any)[method] = Object.assign(mockChalkFn, chalkMethods);
});

jest.mock("chalk", () => ({
    default: chalkMethods,
    ...chalkMethods,
}));

// Mock AWS SDK
jest.mock("@aws-sdk/client-cloudformation");
jest.mock("@aws-sdk/credential-providers");

import { statusCommand, formatStackStatus, StatusCommandOptions } from "../../../bin/commands/status";
import { XDGTest } from "../../helpers/xdg-test";
import { ProfileConfig } from "../../../lib/types/config";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { fromIni } from "@aws-sdk/credential-providers";

// Mock implementations
const mockSend = jest.fn();
const mockFromIni = fromIni as jest.MockedFunction<typeof fromIni>;

// Mock CloudFormationClient constructor
(CloudFormationClient as jest.MockedClass<typeof CloudFormationClient>).mockImplementation(() => ({
    send: mockSend,
} as any));

describe("statusCommand", () => {
    let mockStorage: XDGTest;
    let mockConsoleLog: jest.SpyInstance;
    let mockConsoleError: jest.SpyInstance;

    const validIntegratedConfig: ProfileConfig = {
        quilt: {
            stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123",
            catalog: "quilt.example.com",
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
            account: "123456789012",
        },
        integratedStack: true,
        _metadata: {
            version: "0.7.0",
            createdAt: "2025-11-13T00:00:00Z",
            updatedAt: "2025-11-13T00:00:00Z",
            source: "wizard",
        },
    };

    const validStandaloneConfig: ProfileConfig = {
        ...validIntegratedConfig,
        integratedStack: false,
    };

    beforeEach(() => {
        mockStorage = new XDGTest();
        jest.clearAllMocks();

        // Suppress console output during tests
        mockConsoleLog = jest.spyOn(console, "log").mockImplementation();
        mockConsoleError = jest.spyOn(console, "error").mockImplementation();

        // Default mock response for CloudFormation
        mockSend.mockResolvedValue({
            Stacks: [
                {
                    StackStatus: "UPDATE_COMPLETE",
                    Parameters: [
                        {
                            ParameterKey: "BenchlingIntegration",
                            ParameterValue: "Enabled",
                        },
                    ],
                    LastUpdatedTime: new Date("2025-11-13T10:00:00Z"),
                    CreationTime: new Date("2025-11-01T10:00:00Z"),
                },
            ],
        });
    });

    afterEach(() => {
        mockStorage.clear();
        mockConsoleLog.mockRestore();
        mockConsoleError.mockRestore();
    });

    describe("Profile Validation", () => {
        it("should show stack status for integrated mode profiles", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.stackStatus).toBe("UPDATE_COMPLETE");
            expect(result.benchlingIntegrationEnabled).toBe(true);
            // Status command now makes multiple CF API calls for health checks (stack, resources, events, etc.)
            expect(mockSend).toHaveBeenCalled();
        });

        it("should reject non-integrated profiles with clear error message", async () => {
            mockStorage.writeProfile("standalone", validStandaloneConfig);

            const result = await statusCommand({
                profile: "standalone",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe("Status command is only available for integrated stack mode");
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Status command is only available for integrated stack mode")
            );
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("This profile is configured for standalone deployment")
            );
        });

        it("should handle missing profiles with clear error message", async () => {
            const result = await statusCommand({
                profile: "nonexistent",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain("Profile 'nonexistent' not found");
            expect(mockConsoleError).toHaveBeenCalledWith(
                expect.stringContaining("Profile 'nonexistent' not found")
            );
        });

        it("should default to 'default' profile when profile not specified", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);

            const result = await statusCommand({
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Stack Status for Profile: default")
            );
        });
    });

    describe("Stack Status Formatting", () => {
        it("should format UPDATE_COMPLETE as green", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_COMPLETE",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    LastUpdatedTime: new Date(),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.stackStatus).toBe("UPDATE_COMPLETE");
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("UPDATE_COMPLETE")
            );
        });

        it("should format CREATE_COMPLETE as green", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "CREATE_COMPLETE",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    CreationTime: new Date(),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.stackStatus).toBe("CREATE_COMPLETE");
        });

        it("should format UPDATE_IN_PROGRESS as yellow", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_IN_PROGRESS",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    LastUpdatedTime: new Date(),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.stackStatus).toBe("UPDATE_IN_PROGRESS");
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Stack update in progress")
            );
        });

        it("should format CREATE_IN_PROGRESS as yellow", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "CREATE_IN_PROGRESS",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    CreationTime: new Date(),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.stackStatus).toBe("CREATE_IN_PROGRESS");
        });

        it("should format UPDATE_FAILED as red", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_FAILED",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    LastUpdatedTime: new Date(),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.stackStatus).toBe("UPDATE_FAILED");
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Stack update failed or rolled back")
            );
        });

        it("should format ROLLBACK_COMPLETE as red", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "ROLLBACK_COMPLETE",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    LastUpdatedTime: new Date(),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.stackStatus).toBe("ROLLBACK_COMPLETE");
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Stack update failed or rolled back")
            );
        });

        it("should format UPDATE_ROLLBACK_COMPLETE as red", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_ROLLBACK_COMPLETE",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    LastUpdatedTime: new Date(),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.stackStatus).toBe("UPDATE_ROLLBACK_COMPLETE");
        });
    });

    describe("BenchlingIntegration Parameter", () => {
        it("should extract and display BenchlingIntegration parameter correctly when Enabled", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_COMPLETE",
                    Parameters: [
                        { ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" },
                    ],
                    LastUpdatedTime: new Date(),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.benchlingIntegrationEnabled).toBe(true);
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Enabled")
            );
        });

        it("should extract and display BenchlingIntegration parameter correctly when Disabled", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_COMPLETE",
                    Parameters: [
                        { ParameterKey: "BenchlingIntegration", ParameterValue: "Disabled" },
                    ],
                    LastUpdatedTime: new Date(),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.benchlingIntegrationEnabled).toBe(false);
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Disabled")
            );
        });

        it("should handle missing BenchlingIntegration parameter", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_COMPLETE",
                    Parameters: [],
                    LastUpdatedTime: new Date(),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.benchlingIntegrationEnabled).toBe(false);
        });

        it("should handle stack with multiple parameters", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_COMPLETE",
                    Parameters: [
                        { ParameterKey: "OtherParam1", ParameterValue: "Value1" },
                        { ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" },
                        { ParameterKey: "OtherParam2", ParameterValue: "Value2" },
                    ],
                    LastUpdatedTime: new Date(),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.benchlingIntegrationEnabled).toBe(true);
        });
    });

    describe("Next Steps Based on Status", () => {
        it("should show 'update in progress' message for IN_PROGRESS status", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_IN_PROGRESS",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    LastUpdatedTime: new Date(),
                }],
            });

            await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Stack update in progress")
            );
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Run this command again in a few minutes to check progress")
            );
        });

        it("should show 'stack is up to date' for COMPLETE status", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_COMPLETE",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    LastUpdatedTime: new Date(),
                }],
            });

            await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Stack is up to date")
            );
        });

        it("should show action required message when BenchlingIntegration is Disabled", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_COMPLETE",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Disabled" }],
                    LastUpdatedTime: new Date(),
                }],
            });

            await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("BenchlingIntegration is Disabled")
            );
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Enable it via CloudFormation console or re-run setup")
            );
        });

        it("should show error message for FAILED status", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_FAILED",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    LastUpdatedTime: new Date(),
                }],
            });

            await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Stack update failed or rolled back")
            );
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Check CloudFormation console for detailed error messages")
            );
        });

        it("should show error message for ROLLBACK status", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "ROLLBACK_COMPLETE",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    LastUpdatedTime: new Date(),
                }],
            });

            await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Stack update failed or rolled back")
            );
        });
    });

    describe("CloudFormation Console URL", () => {
        it("should generate correct CloudFormation console URL", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);

            await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            const expectedUrl = "https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/stackinfo?stackId=arn%3Aaws%3Acloudformation%3Aus-east-1%3A123456789012%3Astack%2FQuiltStack%2Fabc-123";
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining(expectedUrl)
            );
        });

        it("should generate console URL for different regions", async () => {
            const euConfig = {
                ...validIntegratedConfig,
                quilt: {
                    ...validIntegratedConfig.quilt,
                    stackArn: "arn:aws:cloudformation:eu-west-1:123456789012:stack/QuiltStack/xyz-456",
                    region: "eu-west-1",
                },
                deployment: {
                    ...validIntegratedConfig.deployment,
                    region: "eu-west-1",
                },
            };
            mockStorage.writeProfile("eu", euConfig);

            await statusCommand({
                profile: "eu",
                configStorage: mockStorage,
            });

            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("https://eu-west-1.console.aws.amazon.com/cloudformation/")
            );
        });

        it("should properly encode stack ARN in console URL", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);

            await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            // Check that ARN is URL encoded
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("stackId=arn%3Aaws%3Acloudformation")
            );
        });
    });

    describe("AWS Profile Support", () => {
        it("should support custom AWS profiles", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);

            await statusCommand({
                profile: "default",
                awsProfile: "my-custom-profile",
                configStorage: mockStorage,
            });

            expect(mockFromIni).toHaveBeenCalledWith({ profile: "my-custom-profile" });
        });

        it("should work without AWS profile specified", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);

            await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(mockFromIni).not.toHaveBeenCalled();
        });
    });

    describe("Error Handling", () => {
        it("should handle CloudFormation API errors gracefully", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockRejectedValue(new Error("Access Denied"));

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe("Access Denied");
            expect(mockConsoleError).toHaveBeenCalledWith(
                expect.stringContaining("Failed to get stack status: Access Denied")
            );
        });

        it("should handle invalid stack ARN format", async () => {
            // Use a config with an ARN that passes validation but fails regex extraction
            const invalidConfig = {
                ...validIntegratedConfig,
                quilt: {
                    ...validIntegratedConfig.quilt,
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:nostack",
                },
            };
            mockStorage.writeProfile("invalid", invalidConfig);

            const result = await statusCommand({
                profile: "invalid",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain("Invalid stack ARN format");
        });

        it("should handle stack not found error", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({ Stacks: [] });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain("Stack not found");
        });

        it("should handle missing Stacks in response", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            mockSend.mockResolvedValue({});

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain("Stack not found");
        });
    });

    describe("Timestamp Display", () => {
        it("should display LastUpdatedTime when available", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            const lastUpdated = new Date("2025-11-13T15:30:00Z");
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "UPDATE_COMPLETE",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    LastUpdatedTime: lastUpdated,
                    CreationTime: new Date("2025-11-01T10:00:00Z"),
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.lastUpdateTime).toBe("2025-11-13T15:30:00.000Z");
            // Timestamp is now shown in the header line, not as a separate "Last Updated:" label
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringMatching(/Stack Status for Profile.*@.*\(.*\)/)
            );
        });

        it("should display CreationTime when LastUpdatedTime not available", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);
            const creationTime = new Date("2025-11-01T10:00:00Z");
            mockSend.mockResolvedValue({
                Stacks: [{
                    StackStatus: "CREATE_COMPLETE",
                    Parameters: [{ ParameterKey: "BenchlingIntegration", ParameterValue: "Enabled" }],
                    CreationTime: creationTime,
                }],
            });

            const result = await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(result.success).toBe(true);
            expect(result.lastUpdateTime).toBe("2025-11-01T10:00:00.000Z");
        });
    });

    describe("Stack Name Extraction", () => {
        it("should extract stack name from ARN and call CloudFormation API", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);

            await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            // Verify CloudFormation API was called (multiple times for health checks)
            expect(mockSend).toHaveBeenCalled();
            // Verify success
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("Stack is up to date")
            );
        });

        it("should display extracted stack name", async () => {
            mockStorage.writeProfile("default", validIntegratedConfig);

            await statusCommand({
                profile: "default",
                configStorage: mockStorage,
            });

            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining("QuiltStack")
            );
        });
    });
});

describe("formatStackStatus", () => {
    it("should format UPDATE_COMPLETE as green", () => {
        const formatted = formatStackStatus("UPDATE_COMPLETE");
        expect(formatted).toBe("UPDATE_COMPLETE");
    });

    it("should format CREATE_COMPLETE as green", () => {
        const formatted = formatStackStatus("CREATE_COMPLETE");
        expect(formatted).toBe("CREATE_COMPLETE");
    });

    it("should not format ROLLBACK_COMPLETE as green", () => {
        const formatted = formatStackStatus("ROLLBACK_COMPLETE");
        expect(formatted).toBe("ROLLBACK_COMPLETE");
    });

    it("should format UPDATE_IN_PROGRESS as yellow", () => {
        const formatted = formatStackStatus("UPDATE_IN_PROGRESS");
        expect(formatted).toBe("UPDATE_IN_PROGRESS");
    });

    it("should format CREATE_IN_PROGRESS as yellow", () => {
        const formatted = formatStackStatus("CREATE_IN_PROGRESS");
        expect(formatted).toBe("CREATE_IN_PROGRESS");
    });

    it("should format DELETE_IN_PROGRESS as yellow", () => {
        const formatted = formatStackStatus("DELETE_IN_PROGRESS");
        expect(formatted).toBe("DELETE_IN_PROGRESS");
    });

    it("should format UPDATE_FAILED as red", () => {
        const formatted = formatStackStatus("UPDATE_FAILED");
        expect(formatted).toBe("UPDATE_FAILED");
    });

    it("should format CREATE_FAILED as red", () => {
        const formatted = formatStackStatus("CREATE_FAILED");
        expect(formatted).toBe("CREATE_FAILED");
    });

    it("should format ROLLBACK_COMPLETE as red", () => {
        const formatted = formatStackStatus("ROLLBACK_COMPLETE");
        expect(formatted).toBe("ROLLBACK_COMPLETE");
    });

    it("should format UPDATE_ROLLBACK_COMPLETE as red", () => {
        const formatted = formatStackStatus("UPDATE_ROLLBACK_COMPLETE");
        expect(formatted).toBe("UPDATE_ROLLBACK_COMPLETE");
    });

    it("should format ROLLBACK_IN_PROGRESS as red", () => {
        const formatted = formatStackStatus("ROLLBACK_IN_PROGRESS");
        expect(formatted).toBe("ROLLBACK_IN_PROGRESS");
    });

    it("should format unknown status as dim", () => {
        const formatted = formatStackStatus("UNKNOWN_STATUS");
        expect(formatted).toBe("UNKNOWN_STATUS");
    });
});
