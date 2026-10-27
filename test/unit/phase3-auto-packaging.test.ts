jest.mock("inquirer", () => ({
    __esModule: true,
    default: {
        prompt: jest.fn(),
    },
}));

jest.mock("../../bin/commands/manifest", () => ({
    manifestCommand: jest.fn(),
}));

import inquirer from "inquirer";
import { runParameterCollection } from "../../lib/wizard/phase3-parameter-collection";
import { ParameterCollectionInput, StackQueryResult } from "../../lib/wizard/types";
import { ProfileConfig } from "../../lib/types/config";

const stackQuery: StackQueryResult = {
    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
    catalog: "quilt.example.com",
    database: "quilt_db",
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
    region: "us-east-1",
    account: "123456789012",
    stackQuerySucceeded: true,
};

/** Every value but the package settings comes from the CLI, so only the package prompt fires. */
const cliEverythingElse: ParameterCollectionInput = {
    stackQuery,
    benchlingTenant: "test-tenant",
    benchlingAppDefinitionId: "appdef_123",
    benchlingClientId: "client-xyz",
    benchlingClientSecret: "super-secret",
    logLevel: "INFO",
    webhookAllowList: "",
};

const existingConfig = (packages: ProfileConfig["packages"]): ProfileConfig => ({
    benchling: {
        tenant: "test-tenant",
        clientId: "client-xyz",
        clientSecret: "super-secret",
        appDefinitionId: "appdef_123",
    },
    quilt: {
        stackArn: stackQuery.stackArn,
        catalog: stackQuery.catalog,
        database: stackQuery.database,
        queueUrl: stackQuery.queueUrl,
        region: stackQuery.region,
    },
    packages,
    deployment: { region: "us-east-1" },
    logging: { level: "INFO" },
    security: { enableVerification: true, webhookAllowList: "" },
    _metadata: {
        version: "0.0.0-test",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        source: "cli",
    },
});

describe("runParameterCollection: automatic packaging", () => {
    const mockPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPrompt.mockReset();
        logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        logSpy.mockRestore();
    });

    test("asks whether to package automatically and records No as autoPackaging: false", async () => {
        mockPrompt.mockResolvedValueOnce({
            bucket: "packages-bucket",
            prefix: "benchling",
            metadataKey: "experiment_id",
            workflow: "",
            autoPackaging: false,
        } as never);

        const result = await runParameterCollection(cliEverythingElse);

        expect(mockPrompt).toHaveBeenCalledTimes(1);
        const questions = mockPrompt.mock.calls[0][0] as unknown as Array<{ name: string; type: string; default: unknown }>;
        const question = questions.find((q) => q.name === "autoPackaging");
        expect(question).toMatchObject({ type: "confirm", default: true });
        expect(result.packages.autoPackaging).toBe(false);
    });

    test("leaves autoPackaging unset when the answer is Yes", async () => {
        mockPrompt.mockResolvedValueOnce({
            bucket: "packages-bucket",
            prefix: "benchling",
            metadataKey: "experiment_id",
            workflow: "",
            autoPackaging: true,
        } as never);

        const result = await runParameterCollection(cliEverythingElse);

        expect(result.packages).not.toHaveProperty("autoPackaging");
    });

    test("defaults the prompt to No when the existing profile turned automatic packaging off", async () => {
        // An existing app definition makes the wizard ask whether to reuse it first.
        mockPrompt.mockResolvedValueOnce({ reuseApp: true } as never);
        mockPrompt.mockResolvedValueOnce({
            bucket: "packages-bucket",
            prefix: "benchling",
            metadataKey: "experiment_id",
            workflow: "",
            autoPackaging: false,
        } as never);

        await runParameterCollection({
            ...cliEverythingElse,
            existingConfig: existingConfig({
                bucket: "packages-bucket",
                prefix: "benchling",
                metadataKey: "experiment_id",
                autoPackaging: false,
            }),
        });

        const questions = mockPrompt.mock.calls[1][0] as unknown as Array<{ name: string; default: unknown }>;
        expect(questions.find((q) => q.name === "autoPackaging")?.default).toBe(false);
    });

    test("non-interactive mode keeps the existing profile's autoPackaging without prompting", async () => {
        const result = await runParameterCollection({
            stackQuery,
            yes: true,
            existingConfig: existingConfig({
                bucket: "packages-bucket",
                prefix: "benchling",
                metadataKey: "experiment_id",
                autoPackaging: false,
            }),
        });

        expect(mockPrompt).not.toHaveBeenCalled();
        expect(result.packages.autoPackaging).toBe(false);
    });

    test("a CLI value wins over the existing profile", async () => {
        const result = await runParameterCollection({
            stackQuery,
            yes: true,
            autoPackaging: true,
            existingConfig: existingConfig({
                bucket: "packages-bucket",
                prefix: "benchling",
                metadataKey: "experiment_id",
                autoPackaging: false,
            }),
        });

        expect(result.packages).not.toHaveProperty("autoPackaging");
    });
});
