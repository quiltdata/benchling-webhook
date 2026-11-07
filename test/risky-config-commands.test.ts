/**
 * Where the commands show the bucketless / verification-off warnings:
 * validate always (not only with --verbose), sync-secrets once unless its caller prints them,
 * and deploy from the secret it will actually run with.
 */
jest.mock("chalk", () => {
    // Callable and chainable (chalk.green.bold("x")), returning the text unchanged.
    const make = (): unknown =>
        new Proxy((text: unknown) => String(text), { get: (_target, prop) => (prop === "default" ? chalk : make()) });
    const chalk = make();
    return { __esModule: true, default: chalk };
});
jest.mock("boxen", () => ({
    __esModule: true,
    default: (text: string) => text,
}));
jest.mock("ora", () => ({
    __esModule: true,
    default: (): Record<string, unknown> => {
        const spinner: Record<string, unknown> = {};
        for (const method of ["start", "succeed", "fail", "stop", "warn", "info"]) {
            spinner[method] = (): Record<string, unknown> => spinner;
        }
        return spinner;
    },
}));
jest.mock("../lib/wizard/phase4-validation", () => ({
    runValidation: jest.fn().mockResolvedValue({ success: true, errors: [], warnings: [] }),
}));
jest.mock("../bin/benchling-webhook", () => ({
    checkCdkBootstrap: jest.fn().mockResolvedValue({ bootstrapped: true, status: "CREATE_COMPLETE" }),
}));
jest.mock("child_process", () => ({
    ...jest.requireActual("child_process"),
    execSync: jest.fn().mockReturnValue("123456789012\n"),
}));

import { validateCommand } from "../bin/commands/validate";
import { syncSecretsToAWS } from "../bin/commands/sync-secrets";
import { deployedRiskySettings } from "../bin/commands/deploy";
import { BUCKETLESS_WARNING, VERIFICATION_OFF_WARNING } from "../lib/utils/risky-config-warnings";
import { XDGTest } from "./helpers/xdg-test";
import type { ProfileConfig } from "../lib/types/config";

function profile(overrides: { bucket?: string; enableVerification?: boolean } = {}): ProfileConfig {
    const now = new Date().toISOString();
    return {
        benchling: {
            tenant: "test-tenant",
            clientId: "client-xyz",
            clientSecret: "literal-secret-value",
            appDefinitionId: "app_123",
        },
        quilt: {
            stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
            catalog: "quilt.example.com",
            database: "quilt_db",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue/test",
            region: "us-east-1",
        },
        packages: {
            bucket: overrides.bucket as string,
            prefix: "benchling",
            metadataKey: "experiment_id",
        },
        deployment: { region: "us-east-1", account: "123456789012", imageTag: "latest" },
        logging: { level: "INFO" },
        security: { enableVerification: overrides.enableVerification ?? true, webhookAllowList: "" },
        _metadata: { version: "0.22.3-test", createdAt: now, updatedAt: now, source: "cli" },
    } as ProfileConfig;
}

function headlinesIn(calls: unknown[][]): string[] {
    const text = calls.map((args) => args.map(String).join(" ")).join("\n");
    return [BUCKETLESS_WARNING[0], VERIFICATION_OFF_WARNING[0]].filter((headline) => text.includes(headline));
}

function countIn(calls: unknown[][], headline: string): number {
    return calls.map((args) => args.map(String).join(" ")).filter((line) => line.includes(headline)).length;
}

describe("risky configuration warnings in commands", () => {
    let warnSpy: jest.SpyInstance;
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
        warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        warnSpy.mockRestore();
        logSpy.mockRestore();
    });

    describe("validate", () => {
        it("warns without --verbose", async () => {
            await validateCommand({ config: profile({ bucket: "", enableVerification: false }), profile: "p" });
            expect(headlinesIn(warnSpy.mock.calls)).toEqual([BUCKETLESS_WARNING[0], VERIFICATION_OFF_WARNING[0]]);
        });

        it("warns once with --verbose", async () => {
            await validateCommand({ config: profile({ bucket: "" }), profile: "p", verbose: true });
            expect(countIn(warnSpy.mock.calls, BUCKETLESS_WARNING[0])).toBe(1);
        });

        it("is quiet for a bucket with verification on", async () => {
            await validateCommand({ config: profile({ bucket: "b" }), profile: "p" });
            expect(headlinesIn(warnSpy.mock.calls)).toEqual([]);
        });
    });

    describe("sync-secrets", () => {
        let storage: XDGTest;

        beforeEach(() => {
            storage = new XDGTest();
            // No bucket at all (bucketless mode); an empty string is rejected by the profile schema.
            const config = profile({ enableVerification: false });
            delete (config.packages as { bucket?: string }).bucket;
            storage.writeProfile("default", config);
        });

        afterEach(() => storage.clear());

        it("prints the warnings by default", async () => {
            await syncSecretsToAWS({ region: "us-east-1", dryRun: true, configStorage: storage });
            expect(headlinesIn(warnSpy.mock.calls)).toEqual([BUCKETLESS_WARNING[0], VERIFICATION_OFF_WARNING[0]]);
        });

        it("leaves them to a caller that prints them itself", async () => {
            await syncSecretsToAWS({ region: "us-east-1", dryRun: true, configStorage: storage, printWarnings: false });
            expect(headlinesIn(warnSpy.mock.calls)).toEqual([]);
        });
    });

    describe("deploy", () => {
        it("judges the deployed secret, not the local profile", () => {
            const local = profile({ bucket: "local-bucket", enableVerification: true });
            expect(deployedRiskySettings(local, { userBucket: undefined, enableVerification: false })).toEqual({
                bucket: undefined,
                enableVerification: false,
            });
            expect(deployedRiskySettings(local, { userBucket: "deployed", enableVerification: true })).toEqual({
                bucket: "deployed",
                enableVerification: true,
            });
        });

        it("falls back to the local profile when the secret can't be read", () => {
            const local = profile({ bucket: "", enableVerification: false });
            expect(deployedRiskySettings(local, null)).toEqual({ bucket: "", enableVerification: false });
        });
    });
});
