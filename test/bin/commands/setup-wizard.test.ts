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

Object.keys(chalkMethods).forEach(method => {
    (chalkMethods as any)[method] = Object.assign(mockChalkFn, chalkMethods);
});

jest.mock("chalk", () => ({
    default: chalkMethods,
    ...chalkMethods,
}));

jest.mock("ora", () => jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    info: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
    text: "",
})));

jest.mock("boxen", () => jest.fn((value: string) => value));

jest.mock("enquirer", () => ({
    prompt: jest.fn(),
}));

jest.mock("inquirer", () => ({
    __esModule: true,
    default: {
        prompt: jest.fn(),
    },
}));

jest.mock("../../../lib/wizard/phase1-catalog-discovery", () => ({
    runCatalogDiscovery: jest.fn(),
}));

jest.mock("../../../lib/wizard/phase2-stack-query", () => ({
    runStackQuery: jest.fn(),
}));

jest.mock("../../../lib/wizard/phase3-parameter-collection", () => ({
    runParameterCollection: jest.fn(),
}));

jest.mock("../../../lib/wizard/phase4-validation", () => ({
    runValidation: jest.fn(),
}));

jest.mock("../../../lib/wizard/phase5-unified-flow", () => ({
    runUnifiedFlowDecision: jest.fn(),
}));

jest.mock("../../../lib/wizard/profile-config-builder", () => ({
    buildProfileConfigFromExisting: jest.fn(),
    buildProfileConfigFromParameters: jest.fn(),
}));

jest.mock("../../../lib/wizard/stack-waiter", () => ({
    pollStackStatus: jest.fn(),
    waitForBenchlingSecretArn: jest.fn(),
}));

jest.mock("../../../lib/wizard/profile-warning", () => ({
    maybeWarnAboutProfileConfusion: jest.fn(),
}));

jest.mock("../../../bin/commands/sync-secrets", () => ({
    syncSecretsToAWS: jest.fn(),
}));

jest.mock("../../../lib/utils/stack-parameter-update", () => ({
    updateStackParameter: jest.fn(),
}));

jest.mock("../../../bin/commands/status", () => ({
    statusCommand: jest.fn(),
}));

import { runSetupWizard } from "../../../bin/commands/setup-wizard";
import { XDGTest } from "../../helpers/xdg-test";
import { runCatalogDiscovery } from "../../../lib/wizard/phase1-catalog-discovery";
import { runStackQuery } from "../../../lib/wizard/phase2-stack-query";
import { runParameterCollection } from "../../../lib/wizard/phase3-parameter-collection";
import { runValidation } from "../../../lib/wizard/phase4-validation";
import { runUnifiedFlowDecision } from "../../../lib/wizard/phase5-unified-flow";
import { buildProfileConfigFromParameters } from "../../../lib/wizard/profile-config-builder";
import { pollStackStatus, waitForBenchlingSecretArn } from "../../../lib/wizard/stack-waiter";
import { syncSecretsToAWS } from "../../../bin/commands/sync-secrets";
import { updateStackParameter } from "../../../lib/utils/stack-parameter-update";
import { statusCommand } from "../../../bin/commands/status";

describe("runSetupWizard", () => {
    const mockConsoleLog = jest.spyOn(console, "log").mockImplementation();
    const mockConsoleError = jest.spyOn(console, "error").mockImplementation();

    const baseConfig = {
        benchling: {
            tenant: "tenant",
            clientId: "client-id",
            clientSecret: "client-secret",
            secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling",
            appDefinitionId: "appdef_123",
        },
        quilt: {
            stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt/abc",
            catalog: "catalog.quiltdata.com",
            database: "quilt_db",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
            region: "us-east-1",
        },
        packages: {
            bucket: "bucket",
            prefix: "benchling",
            metadataKey: "experiment_id",
        },
        deployment: {
            region: "us-east-1",
        },
        integratedStack: true,
        _metadata: {
            version: "0.15.0",
            createdAt: "2026-04-10T00:00:00Z",
            updatedAt: "2026-04-10T00:00:00Z",
            source: "wizard" as const,
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();

        (runCatalogDiscovery as jest.Mock).mockResolvedValue({
            catalogDns: "catalog.quiltdata.com",
            wasManuallyEntered: false,
        });

        (runStackQuery as jest.Mock).mockResolvedValue({
            stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt/abc",
            catalog: "catalog.quiltdata.com",
            database: "quilt_db",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
            region: "us-east-1",
            account: "123456789012",
            benchlingIntegrationEnabled: false,
            stackQuerySucceeded: true,
        });

        (runUnifiedFlowDecision as jest.Mock).mockResolvedValue({
            action: "enable-integration",
            flow: "integration-disabled",
            benchlingSecretArn: undefined,
            secretDetails: null,
            hasStandaloneDeployment: false,
        });

        (runParameterCollection as jest.Mock).mockResolvedValue({
            benchling: {
                tenant: "tenant",
                clientId: "client-id",
                clientSecret: "client-secret",
                appDefinitionId: "appdef_123",
            },
            packages: {
                bucket: "bucket",
                prefix: "benchling",
                metadataKey: "experiment_id",
            },
            deployment: {
                region: "us-east-1",
                account: "123456789012",
            },
            logging: {
                level: "INFO",
            },
            security: {
                enableVerification: true,
                webhookAllowList: "",
            },
        });

        (runValidation as jest.Mock).mockResolvedValue({
            success: true,
            errors: [],
            warnings: [],
            shouldExitForManifest: false,
        });

        (updateStackParameter as jest.Mock).mockResolvedValue({ success: true });
        (waitForBenchlingSecretArn as jest.Mock).mockResolvedValue("arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling");
        (buildProfileConfigFromParameters as jest.Mock).mockReturnValue(baseConfig);
        (syncSecretsToAWS as jest.Mock).mockResolvedValue([]);
        (pollStackStatus as jest.Mock).mockResolvedValue(undefined);
        (statusCommand as jest.Mock).mockResolvedValue({ success: true });
    });

    afterAll(() => {
        mockConsoleLog.mockRestore();
        mockConsoleError.mockRestore();
    });

    it("stops with IaC guidance when enable-integration is selected without --force", async () => {
        const storage = new XDGTest();

        await expect(runSetupWizard({
            yes: true,
            configStorage: storage,
        })).rejects.toThrow("Enable it through your infrastructure-as-code workflow first");

        expect(updateStackParameter).not.toHaveBeenCalled();
        expect(syncSecretsToAWS).not.toHaveBeenCalled();
        expect(storage.profileExists("default")).toBe(false);
    });

    it("updates the stack when --force is provided", async () => {
        const storage = new XDGTest();

        const result = await runSetupWizard({
            yes: true,
            force: true,
            configStorage: storage,
        });

        expect(result.success).toBe(true);
        expect(updateStackParameter).toHaveBeenCalledWith(expect.objectContaining({
            parameterKey: "BenchlingWebhook",
            parameterValue: "Enabled",
        }));
        expect(syncSecretsToAWS).toHaveBeenCalled();
        expect(statusCommand).toHaveBeenCalled();
        expect(storage.profileExists("default")).toBe(true);
    });
});
