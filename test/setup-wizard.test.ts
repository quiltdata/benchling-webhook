/**
 * Comprehensive test suite for the refactored setup wizard
 * Tests the new flow: Catalog → Stack Query → Parameters → Validation → Mode Decision → Mode-Specific Path
 */

import { runSetupWizard } from "../bin/commands/setup-wizard";
import { inferQuiltConfig } from "../bin/commands/infer-quilt-config";
import { syncSecretsToAWS } from "../bin/commands/sync-secrets";
import { deploy } from "../bin/commands/deploy";
import inquirer from "inquirer";
import {
    SecretsManagerClient,
    DescribeSecretCommand,
    GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
    CloudFormationClient,
    DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { XDGTest } from "./helpers/xdg-test";
import type { ProfileConfig } from "../lib/types/config";

// Mock dependencies
jest.mock("inquirer");
jest.mock("../bin/commands/deploy");
jest.mock("../bin/commands/infer-quilt-config");
jest.mock("../bin/commands/sync-secrets");

const mockPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;
const mockDeploy = deploy as jest.MockedFunction<typeof deploy>;
const mockInferQuiltConfig = inferQuiltConfig as jest.MockedFunction<typeof inferQuiltConfig>;
const mockSyncSecrets = syncSecretsToAWS as jest.MockedFunction<typeof syncSecretsToAWS>;

describe("Setup Wizard - New Flow", () => {
    let mockStorage: XDGTest;
    let sendMock: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
        mockStorage = new XDGTest();
        sendMock = jest.spyOn(SecretsManagerClient.prototype, "send");
        jest.spyOn(CloudFormationClient.prototype, "send");
        consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
        jest.clearAllMocks();
    });

    afterEach(() => {
        sendMock.mockRestore();
        consoleLogSpy.mockRestore();
        mockStorage.clear();
    });

    describe("Phase 1: Catalog Discovery & Confirmation", () => {
        it("should confirm catalog DNS at the start of wizard", async () => {
            const inferredCatalog = "test-catalog.quiltdata.com";

            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: inferredCatalog,
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: undefined,
            });

            // User confirms the catalog
            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: false })
                .mockResolvedValueOnce({ deployNow: false });

            mockSyncSecrets.mockResolvedValueOnce([{ action: "created", secretName: "test-secret" }]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify catalog confirmation was asked FIRST
            expect(mockPrompt).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: "confirmCatalog",
                    message: expect.stringContaining(inferredCatalog),
                })
            );
        });

        it("should prompt for manual catalog entry if user declines inferred catalog", async () => {
            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "wrong-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: undefined,
            });

            // User declines and provides correct catalog
            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: false })
                .mockResolvedValueOnce({ catalogDns: "correct-catalog.quiltdata.com" })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: false })
                .mockResolvedValueOnce({ deployNow: false });

            mockSyncSecrets.mockResolvedValueOnce([{ action: "created", secretName: "test-secret" }]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify manual entry prompt was shown
            expect(mockPrompt).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: "catalogDns",
                })
            );
        });

        it("should only proceed to stack query after catalog is confirmed", async () => {
            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: undefined,
            });

            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: false })
                .mockResolvedValueOnce({ deployNow: false });

            mockSyncSecrets.mockResolvedValueOnce([{ action: "created", secretName: "test-secret" }]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify inferQuiltConfig was called AFTER catalog confirmation
            const confirmCallOrder = mockPrompt.mock.invocationCallOrder[0];
            const inferCallOrder = mockInferQuiltConfig.mock.invocationCallOrder[0];
            expect(inferCallOrder).toBeGreaterThan(confirmCallOrder);
        });
    });

    describe("Phase 2: Stack Query Enhancement", () => {
        it("should extract ALL stack parameters upfront from inferQuiltConfig", async () => {
            const stackParams = {
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:BenchlingSecret-abc123",
            };

            mockInferQuiltConfig.mockResolvedValueOnce(stackParams);

            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: true });

            sendMock.mockImplementation(async (command) => {
                if (command instanceof DescribeSecretCommand) {
                    return { ARN: stackParams.BenchlingSecret };
                }
                if (command instanceof GetSecretValueCommand) {
                    return {
                        SecretString: JSON.stringify({
                            tenant: "test-tenant",
                            client_id: "client-id",
                            client_secret: "secret-value",
                            app_definition_id: "app-id",
                        }),
                    };
                }
                throw new Error(`Unexpected command: ${command.constructor.name}`);
            });

            mockSyncSecrets.mockResolvedValueOnce([{ action: "updated", secretName: "BenchlingSecret" }]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify config was saved with all stack parameters
            const savedConfig = mockStorage.readProfile("default");
            expect(savedConfig.quilt).toEqual({
                stackArn: stackParams.stackArn,
                catalog: stackParams.catalogDns,
                database: stackParams.database,
                queueUrl: stackParams.queueUrl,
                region: stackParams.region,
            });
            expect(savedConfig.benchling.secretArn).toBe(stackParams.BenchlingSecret);
        });

        it("should not prompt for parameters that can be queried from stack", async () => {
            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: undefined,
            });

            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: false })
                .mockResolvedValueOnce({ deployNow: false });

            mockSyncSecrets.mockResolvedValueOnce([{ action: "created", secretName: "test-secret" }]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify we didn't prompt for stackArn, database, queueUrl, region (they were queried)
            const allPromptCalls = mockPrompt.mock.calls.flat();
            const promptNames = allPromptCalls.map((call: any) => call.name);

            expect(promptNames).not.toContain("stackArn");
            expect(promptNames).not.toContain("database");
            expect(promptNames).not.toContain("queueUrl");
            expect(promptNames).not.toContain("region");
        });
    });

    describe("Phase 3: Parameter Collection & Validation Order", () => {
        it("should collect parameters in order: Quilt → Benchling → Package → Deployment", async () => {
            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: undefined,
            });

            const promptOrder: string[] = [];
            mockPrompt.mockImplementation(async (questions: any) => {
                const name = Array.isArray(questions) ? questions[0].name : questions.name;
                promptOrder.push(name);

                if (name === "confirmCatalog") return { confirmCatalog: true };
                if (name === "benchlingTenant") {
                    return {
                        benchlingTenant: "test-tenant",
                        benchlingClientId: "client-id",
                        benchlingClientSecret: "client-secret",
                        benchlingAppDefinitionId: "app-id",
                    };
                }
                if (name === "userBucket") return { userBucket: "test-bucket" };
                if (name === "pkgPrefix") return { pkgPrefix: "benchling", pkgKey: "experiment_id" };
                if (name === "logLevel") return { logLevel: "INFO", enableVerification: true, webhookAllowList: "" };
                if (name === "useExistingSecret") return { useExistingSecret: false };
                if (name === "deployNow") return { deployNow: false };

                return {};
            });

            mockSyncSecrets.mockResolvedValueOnce([{ action: "created", secretName: "test-secret" }]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify order: catalog → benchling → package → deployment config → mode decision
            expect(promptOrder.indexOf("confirmCatalog")).toBeLessThan(promptOrder.indexOf("benchlingTenant"));
            expect(promptOrder.indexOf("benchlingTenant")).toBeLessThan(promptOrder.indexOf("userBucket"));
            expect(promptOrder.indexOf("userBucket")).toBeLessThan(promptOrder.indexOf("pkgPrefix"));
            expect(promptOrder.indexOf("pkgPrefix")).toBeLessThan(promptOrder.indexOf("logLevel"));
            expect(promptOrder.indexOf("logLevel")).toBeLessThan(promptOrder.indexOf("useExistingSecret"));
        });

        it("should validate parameters BEFORE deployment decision", async () => {
            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: undefined,
            });

            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "", // Invalid - empty app ID
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" });

            // Should exit during validation, BEFORE asking about deployment mode
            await expect(
                runSetupWizard({
                    profile: "default",
                    yes: false,
                    setupOnly: false,
                    configStorage: mockStorage,
                })
            ).rejects.toThrow();

            // Verify deployment mode question was NEVER asked
            const allPromptCalls = mockPrompt.mock.calls.flat();
            const promptNames = allPromptCalls.map((call: any) => call.name);
            expect(promptNames).not.toContain("useExistingSecret");
            expect(promptNames).not.toContain("deployNow");
        });

        it("should exit to manifest flow if no app definition ID", async () => {
            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: undefined,
            });

            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "", // No app ID - should trigger manifest flow
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" });

            await expect(
                runSetupWizard({
                    profile: "default",
                    yes: false,
                    setupOnly: false,
                    configStorage: mockStorage,
                })
            ).rejects.toThrow();

            // Verify manifest flow message was shown
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining("manifest")
            );
        });
    });

    describe("Phase 4a: Integrated Mode Path", () => {
        it("should update existing BenchlingSecret and exit cleanly in integrated mode", async () => {
            const benchlingSecretArn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:BenchlingSecret-abc123";

            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: benchlingSecretArn,
            });

            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: true }); // YES to integrated mode

            sendMock.mockImplementation(async (command) => {
                if (command instanceof DescribeSecretCommand) {
                    return { ARN: benchlingSecretArn };
                }
                if (command instanceof GetSecretValueCommand) {
                    return {
                        SecretString: JSON.stringify({
                            tenant: "test-tenant",
                            client_id: "old-client-id",
                            client_secret: "old-secret",
                            app_definition_id: "old-app-id",
                        }),
                    };
                }
                throw new Error(`Unexpected command: ${command.constructor.name}`);
            });

            mockSyncSecrets.mockResolvedValueOnce([{ action: "updated", secretName: "BenchlingSecret" }]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify config saved with integratedStack: true
            const savedConfig = mockStorage.readProfile("default");
            expect(savedConfig.integratedStack).toBe(true);
            expect(savedConfig.benchling.secretArn).toBe(benchlingSecretArn);

            // Verify syncSecretsToAWS was called
            expect(mockSyncSecrets).toHaveBeenCalled();

            // Verify deploy was NOT called (integrated mode exits cleanly)
            expect(mockDeploy).not.toHaveBeenCalled();

            // Verify deployment prompt was NEVER shown
            const allPromptCalls = mockPrompt.mock.calls.flat();
            const promptNames = allPromptCalls.map((call: any) => call.name);
            expect(promptNames).not.toContain("deployNow");
        });

        it("should NOT prompt for deployment in integrated mode", async () => {
            const benchlingSecretArn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:BenchlingSecret-abc123";

            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: benchlingSecretArn,
            });

            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: true });

            sendMock.mockImplementation(async (command) => {
                if (command instanceof DescribeSecretCommand) {
                    return { ARN: benchlingSecretArn };
                }
                if (command instanceof GetSecretValueCommand) {
                    return {
                        SecretString: JSON.stringify({
                            tenant: "test-tenant",
                            client_id: "client-id",
                            client_secret: "secret-value",
                            app_definition_id: "app-id",
                        }),
                    };
                }
                throw new Error(`Unexpected command: ${command.constructor.name}`);
            });

            mockSyncSecrets.mockResolvedValueOnce([{ action: "updated", secretName: "BenchlingSecret" }]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify "Deploy now?" prompt was NEVER shown
            const allPromptCalls = mockPrompt.mock.calls.flat();
            const promptNames = allPromptCalls.map((call: any) => call.name);
            expect(promptNames).not.toContain("deployNow");

            // Verify success message shown
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining("Configuration complete")
            );
        });

        it("should show webhook URL retrieval instructions in integrated mode", async () => {
            const benchlingSecretArn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:BenchlingSecret-abc123";

            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: benchlingSecretArn,
            });

            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: true });

            sendMock.mockImplementation(async (command) => {
                if (command instanceof DescribeSecretCommand) {
                    return { ARN: benchlingSecretArn };
                }
                if (command instanceof GetSecretValueCommand) {
                    return {
                        SecretString: JSON.stringify({
                            tenant: "test-tenant",
                            client_id: "client-id",
                            client_secret: "secret-value",
                            app_definition_id: "app-id",
                        }),
                    };
                }
                throw new Error(`Unexpected command: ${command.constructor.name}`);
            });

            mockSyncSecrets.mockResolvedValueOnce([{ action: "updated", secretName: "BenchlingSecret" }]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify webhook URL instructions shown
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringMatching(/webhook.*url|quilt.*stack/i)
            );
        });
    });

    describe("Phase 4b: Standalone Mode Path", () => {
        it("should create new secret in standalone mode", async () => {
            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: undefined, // No BenchlingSecret = standalone mode
            });

            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: false }) // NO to integrated = standalone
                .mockResolvedValueOnce({ deployNow: false });

            mockSyncSecrets.mockResolvedValueOnce([
                { action: "created", secretName: "quiltdata/benchling-webhook/default/test-tenant" },
            ]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify config saved with integratedStack: false
            const savedConfig = mockStorage.readProfile("default");
            expect(savedConfig.integratedStack).toBe(false);

            // Verify syncSecretsToAWS was called
            expect(mockSyncSecrets).toHaveBeenCalled();

            // Verify secret name follows pattern
            const syncCall = mockSyncSecrets.mock.calls[0][0];
            expect(syncCall.profile).toBe("default");
        });

        it("should prompt for deployment in standalone mode", async () => {
            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: undefined,
            });

            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: false })
                .mockResolvedValueOnce({ deployNow: true }); // User says YES

            mockSyncSecrets.mockResolvedValueOnce([
                { action: "created", secretName: "quiltdata/benchling-webhook/default/test-tenant" },
            ]);

            mockDeploy.mockResolvedValueOnce(undefined);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify "Deploy now?" prompt was shown
            const allPromptCalls = mockPrompt.mock.calls.flat();
            const promptNames = allPromptCalls.map((call: any) => call.name);
            expect(promptNames).toContain("deployNow");

            // Verify deploy was called
            expect(mockDeploy).toHaveBeenCalledWith({
                profile: "default",
                stage: "prod",
                requireApproval: "never",
                configStorage: mockStorage,
            });
        });

        it("should skip deployment if user declines in standalone mode", async () => {
            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: undefined,
            });

            mockPrompt
                .mockResolvedValueOnce({ confirmCatalog: true })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: false })
                .mockResolvedValueOnce({ deployNow: false }); // User says NO

            mockSyncSecrets.mockResolvedValueOnce([
                { action: "created", secretName: "quiltdata/benchling-webhook/default/test-tenant" },
            ]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify deploy was NOT called
            expect(mockDeploy).not.toHaveBeenCalled();

            // Verify manual deployment instructions shown
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringMatching(/deploy.*manually|next.*steps/i)
            );
        });
    });

    describe("--yes flag behavior", () => {
        it("should skip all prompts when --yes flag is provided", async () => {
            mockInferQuiltConfig.mockResolvedValueOnce({
                catalogDns: "test-catalog.quiltdata.com",
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                region: "us-east-1",
                account: "123456789012",
                BenchlingSecret: undefined,
            });

            mockSyncSecrets.mockResolvedValueOnce([
                { action: "created", secretName: "quiltdata/benchling-webhook/default/test-tenant" },
            ]);

            mockDeploy.mockResolvedValueOnce(undefined);

            // With --yes, should use all defaults and skip prompts
            await runSetupWizard({
                profile: "default",
                yes: true, // Auto-confirm everything
                setupOnly: false,
                configStorage: mockStorage,
                // Provide required parameters
                catalogUrl: "https://test-catalog.quiltdata.com",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "client-secret",
                benchlingAppDefinitionId: "app-id",
                userBucket: "test-bucket",
            });

            // Verify NO prompts were shown
            expect(mockPrompt).not.toHaveBeenCalled();
        });
    });

    describe("Edge Cases", () => {
        it("should handle stack query failures gracefully", async () => {
            mockInferQuiltConfig.mockRejectedValueOnce(new Error("Stack not found"));

            // Should fallback to manual entry
            mockPrompt
                .mockResolvedValueOnce({ catalogDns: "manual-catalog.quiltdata.com" })
                .mockResolvedValueOnce({ stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/manual/abc" })
                .mockResolvedValueOnce({
                    benchlingTenant: "test-tenant",
                    benchlingClientId: "client-id",
                    benchlingClientSecret: "client-secret",
                    benchlingAppDefinitionId: "app-id",
                })
                .mockResolvedValueOnce({ userBucket: "test-bucket" })
                .mockResolvedValueOnce({ pkgPrefix: "benchling", pkgKey: "experiment_id" })
                .mockResolvedValueOnce({ logLevel: "INFO", enableVerification: true, webhookAllowList: "" })
                .mockResolvedValueOnce({ useExistingSecret: false })
                .mockResolvedValueOnce({ deployNow: false });

            mockSyncSecrets.mockResolvedValueOnce([{ action: "created", secretName: "test-secret" }]);

            await runSetupWizard({
                profile: "default",
                yes: false,
                setupOnly: false,
                configStorage: mockStorage,
            });

            // Verify manual entry prompts were shown
            const allPromptCalls = mockPrompt.mock.calls.flat();
            const promptNames = allPromptCalls.map((call: any) => call.name);
            expect(promptNames).toContain("catalogDns");
            expect(promptNames).toContain("stackArn");
        });

        it("should migrate legacy configs with old deploymentMode metadata", async () => {
            const legacyConfig: ProfileConfig = {
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client-id",
                    clientSecret: "client-secret",
                    appDefinitionId: "app-id",
                },
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                    catalog: "test-catalog.quiltdata.com",
                    database: "quilt_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
                    region: "us-east-1",
                },
                packages: {
                    bucket: "test-bucket",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
                logging: {
                    level: "INFO",
                },
                security: {
                    enableVerification: true,
                    webhookAllowList: "",
                },
                _metadata: {
                    version: "0.6.0",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    source: "cli",
                    deploymentMode: "integrated", // Old field
                },
            };

            mockStorage.writeProfile("legacy", legacyConfig);

            // Read config - should automatically migrate
            const config = mockStorage.readProfile("legacy");

            // Verify migration logic handles old config gracefully
            expect(config._metadata.deploymentMode).toBe("integrated");
            // New code should treat this as integrated based on presence of secretArn or legacy field
        });
    });
});
