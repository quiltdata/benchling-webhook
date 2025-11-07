import { syncSecretsToAWS } from "../bin/commands/sync-secrets";
import {
    SecretsManagerClient,
    DescribeSecretCommand,
    GetSecretValueCommand,
    UpdateSecretCommand,
    CreateSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import type { UpdateSecretCommandInput } from "@aws-sdk/client-secrets-manager";
import { IConfigStorage } from "../lib/interfaces/config-storage";
import { MockConfigStorage } from "./mocks/mock-config-storage";
import type { ProfileConfig } from "../lib/types/config";

// Mock the XDGConfig module to return our mock storage
jest.mock("../lib/xdg-config", () => {
    const { MockConfigStorage } = require("./mocks/mock-config-storage");
    return {
        XDGConfig: jest.fn().mockImplementation(() => new MockConfigStorage()),
    };
});

describe("sync-secrets CLI", () => {
    let mockStorage: MockConfigStorage;
    let sendMock: jest.SpyInstance;

    beforeEach(() => {
        // Create a fresh mock storage for each test
        mockStorage = new MockConfigStorage();

        // Update the mock to return our storage instance
        const { XDGConfig } = require("../lib/xdg-config");
        XDGConfig.mockImplementation(() => mockStorage);

        sendMock = jest.spyOn(SecretsManagerClient.prototype, "send");
    });

    afterEach(() => {
        sendMock.mockRestore();
        mockStorage.clear();
        jest.clearAllMocks();
    });

    test("updates secret with actual client_secret value instead of secret name placeholder", async () => {
        const profileName = "default";
        const tenant = "test-tenant";
        const generatedSecretName = `quiltdata/benchling-webhook/${profileName}/${tenant}`;
        const existingSecretArn =
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:existing-secret-abc123";

        const timestamp = new Date().toISOString();
        const profileConfig: ProfileConfig = {
            benchling: {
                tenant,
                clientId: "client-xyz",
                clientSecret: generatedSecretName,
                secretArn: existingSecretArn,
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
                bucket: "packages-bucket",
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
                version: "0.7.0-test",
                createdAt: timestamp,
                updatedAt: timestamp,
                source: "cli",
            },
        };

        // Write to mock storage instead of filesystem
        mockStorage.writeProfile(profileName, profileConfig);

        const existingSecretValue = {
            tenant,
            client_id: "client-xyz",
            client_secret: "super-secret-value",
            app_definition_id: "app_123",
            user_bucket: "packages-bucket",
            pkg_prefix: "benchling",
            pkg_key: "experiment_id",
            log_level: "INFO",
            webhook_allow_list: "",
            enable_webhook_verification: "true",
        };

        const updateCalls: UpdateSecretCommandInput[] = [];

        sendMock.mockImplementation(async (command) => {
            if (command instanceof DescribeSecretCommand) {
                return { ARN: existingSecretArn };
            }
            if (command instanceof GetSecretValueCommand) {
                return { SecretString: JSON.stringify(existingSecretValue) };
            }
            if (command instanceof UpdateSecretCommand) {
                updateCalls.push(command.input);
                return { ARN: existingSecretArn };
            }
            if (command instanceof CreateSecretCommand) {
                throw new Error("Did not expect CreateSecretCommand in this scenario");
            }
            throw new Error(`Unexpected command: ${command.constructor.name}`);
        });

        const results = await syncSecretsToAWS({ profile: profileName, region: "us-east-1", force: true });

        expect(results).toHaveLength(1);
        expect(results[0].action).toBe("updated");

        expect(updateCalls).toHaveLength(1);
        const secretString = updateCalls[0].SecretString;
        expect(typeof secretString).toBe("string");
        const secretPayload = JSON.parse(secretString as string);

        expect(secretPayload.client_secret).toBe("super-secret-value");
        expect(secretPayload.client_secret).not.toBe(generatedSecretName);
        expect(secretPayload.client_id).toBe("client-xyz");
        expect(secretPayload.tenant).toBe(tenant);
    });
});
