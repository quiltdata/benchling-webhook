import { ConfigurationWizard } from "../lib/configuration-wizard";
import inquirer from "inquirer";

// Mock inquirer
jest.mock("inquirer");
const mockPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;

describe("ConfigurationWizard", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("run", () => {
        it("should prompt for missing Benchling credentials", async () => {
            // Arrange
            const partialConfig = {
                catalogUrl: "https://quilt.example.com",
            };

            mockPrompt.mockResolvedValueOnce({
                benchlingTenant: "test-tenant",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-client-secret",
                benchlingAppDefinitionId: "test-app-id",
            });

            // Act
            const result = await ConfigurationWizard.run({ partialConfig });

            // Assert
            expect(result).toEqual({
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "test-tenant",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-client-secret",
                benchlingAppDefinitionId: "test-app-id",
            });
            expect(mockPrompt).toHaveBeenCalledTimes(1);
        });

        it("should not prompt for fields that are already provided", async () => {
            // Arrange
            const partialConfig = {
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "existing-tenant",
                benchlingClientId: "existing-client-id",
            };

            mockPrompt.mockResolvedValueOnce({
                benchlingClientSecret: "test-secret",
                benchlingAppDefinitionId: "test-app-id",
            });

            // Act
            const result = await ConfigurationWizard.run({ partialConfig });

            // Assert
            expect(result).toEqual({
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "existing-tenant",
                benchlingClientId: "existing-client-id",
                benchlingClientSecret: "test-secret",
                benchlingAppDefinitionId: "test-app-id",
            });
        });

        it("should validate input values", async () => {
            // Arrange
            const partialConfig = {};

            mockPrompt.mockResolvedValueOnce({
                benchlingTenant: "", // Invalid empty value
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-secret",
                benchlingAppDefinitionId: "test-app-id",
            });

            // Act & Assert
            await expect(ConfigurationWizard.run({ partialConfig }))
                .rejects.toThrow("Benchling tenant cannot be empty");
        });

        it("should provide helpful descriptions for each field", async () => {
            // Arrange
            const partialConfig = {};

            mockPrompt.mockResolvedValueOnce({
                benchlingTenant: "test-tenant",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-secret",
                benchlingAppDefinitionId: "test-app-id",
            });

            // Act
            await ConfigurationWizard.run({ partialConfig });

            // Assert
            const promptCalls = mockPrompt.mock.calls[0][0];
            expect(Array.isArray(promptCalls) ? promptCalls : [promptCalls]).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: "benchlingTenant",
                        message: expect.stringContaining("Benchling tenant"),
                    }),
                ])
            );
        });

        it("should handle cancellation gracefully", async () => {
            // Arrange
            const partialConfig = {};

            mockPrompt.mockRejectedValueOnce(new Error("User cancelled"));

            // Act & Assert
            await expect(ConfigurationWizard.run({ partialConfig }))
                .rejects.toThrow("Configuration wizard cancelled");
        });

        it("should support optional configuration fields", async () => {
            // Arrange
            const partialConfig = {
                catalogUrl: "https://quilt.example.com",
            };

            mockPrompt.mockResolvedValueOnce({
                benchlingTenant: "test-tenant",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-secret",
                benchlingAppDefinitionId: "test-app-id",
                benchlingTestEntry: "", // Optional field left empty
            });

            // Act
            const result = await ConfigurationWizard.run({ partialConfig });

            // Assert
            expect(result).toEqual({
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "test-tenant",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-secret",
                benchlingAppDefinitionId: "test-app-id",
            });
            expect(result).not.toHaveProperty("benchlingTestEntry");
        });
    });

    describe("promptForMissingFields", () => {
        it("should identify missing required fields", () => {
            // Arrange
            const partialConfig = {
                benchlingTenant: "test-tenant",
            };

            // Act
            const missingFields = ConfigurationWizard.getMissingFields(partialConfig);

            // Assert
            expect(missingFields).toEqual([
                "benchlingClientId",
                "benchlingClientSecret",
                "benchlingAppDefinitionId",
            ]);
        });

        it("should return empty array when all required fields are present", () => {
            // Arrange
            const completeConfig = {
                benchlingTenant: "test-tenant",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-secret",
                benchlingAppDefinitionId: "test-app-id",
            };

            // Act
            const missingFields = ConfigurationWizard.getMissingFields(completeConfig);

            // Assert
            expect(missingFields).toEqual([]);
        });
    });

    describe("validateInput", () => {
        it("should validate tenant format", () => {
            expect(ConfigurationWizard.validateTenant("valid-tenant")).toBe(true);
            expect(ConfigurationWizard.validateTenant("")).toBe(false);
            expect(ConfigurationWizard.validateTenant("  ")).toBe(false);
        });

        it("should validate client ID format", () => {
            expect(ConfigurationWizard.validateClientId("valid-client-id")).toBe(true);
            expect(ConfigurationWizard.validateClientId("")).toBe(false);
        });

        it("should validate client secret format", () => {
            expect(ConfigurationWizard.validateClientSecret("valid-secret-123")).toBe(true);
            expect(ConfigurationWizard.validateClientSecret("")).toBe(false);
            expect(ConfigurationWizard.validateClientSecret("short")).toBe(false);
        });

        it("should validate app definition ID format", () => {
            expect(ConfigurationWizard.validateAppDefinitionId("valid-app-id")).toBe(true);
            expect(ConfigurationWizard.validateAppDefinitionId("")).toBe(false);
        });
    });
});
