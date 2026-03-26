import { maybeWarnAboutProfileConfusion } from "../../lib/wizard/profile-warning";
import { XDGTest } from "../helpers/xdg-test";
import type { ProfileConfig } from "../../lib/types/config";

function makeConfig(): ProfileConfig {
    const timestamp = new Date().toISOString();

    return {
        benchling: {
            tenant: "test-tenant",
            clientId: "client-id",
            clientSecret: "client-secret",
            appDefinitionId: "appdef_123",
        },
        quilt: {
            stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
            catalog: "catalog.quiltdata.com",
            database: "quilt",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test",
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
        _metadata: {
            version: "test",
            createdAt: timestamp,
            updatedAt: timestamp,
            source: "cli",
        },
    };
}

describe("maybeWarnAboutProfileConfusion", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const awsProfileEnv = process.env.AWS_PROFILE;

    afterEach(() => {
        warnSpy.mockClear();
        if (awsProfileEnv === undefined) {
            delete process.env.AWS_PROFILE;
        } else {
            process.env.AWS_PROFILE = awsProfileEnv;
        }
    });

    afterAll(() => {
        warnSpy.mockRestore();
    });

    test("warns when a new config profile is explicitly selected without aws profile", () => {
        process.env.AWS_PROFILE = "shared-dev";
        const storage = new XDGTest();

        maybeWarnAboutProfileConfusion({
            profile: "sales",
            explicitProfile: true,
            configStorage: storage,
        });

        expect(warnSpy).toHaveBeenCalled();
        const output = warnSpy.mock.calls.flat().join("\n");
        expect(output).toContain("--profile 'sales' selects a benchling-webhook config profile");
        expect(output).toContain("--aws-profile <name> or AWS_PROFILE");
        expect(output).toContain("AWS_PROFILE=shared-dev");
    });

    test("does not warn for an existing config profile", () => {
        const storage = new XDGTest();
        storage.writeProfile("sales", makeConfig());

        maybeWarnAboutProfileConfusion({
            profile: "sales",
            explicitProfile: true,
            configStorage: storage,
        });

        expect(warnSpy).not.toHaveBeenCalled();
    });

    test("does not warn when aws profile is explicit", () => {
        const storage = new XDGTest();

        maybeWarnAboutProfileConfusion({
            profile: "sales",
            explicitProfile: true,
            awsProfile: "myaws",
            configStorage: storage,
        });

        expect(warnSpy).not.toHaveBeenCalled();
    });
});
