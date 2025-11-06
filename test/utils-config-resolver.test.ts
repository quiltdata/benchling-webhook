/**
 * Tests for ConfigResolver (Secrets-Only Architecture)
 */

import { mockClient } from "aws-sdk-client-mock";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  ConfigResolver,
  ConfigResolverError,
  parseStackArn,
  extractStackOutputs,
  resolveAndFetchSecret,
} from "../lib/utils/config-resolver";

describe("parseStackArn", () => {
  it("should parse valid CloudFormation stack ARN", () => {
    const arn =
      "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123-def-456";

    const result = parseStackArn(arn);

    expect(result.region).toBe("us-east-1");
    expect(result.account).toBe("123456789012");
    expect(result.stackName).toBe("QuiltStack");
    expect(result.stackId).toBe("abc-123-def-456");
  });

  it("should parse ARN with different region", () => {
    const arn =
      "arn:aws:cloudformation:eu-west-1:999888777666:stack/MyStack/xyz";

    const result = parseStackArn(arn);

    expect(result.region).toBe("eu-west-1");
    expect(result.account).toBe("999888777666");
    expect(result.stackName).toBe("MyStack");
  });

  it("should throw on invalid ARN format", () => {
    expect(() => parseStackArn("not-an-arn")).toThrow(ConfigResolverError);
    expect(() => parseStackArn("not-an-arn")).toThrow(/Invalid CloudFormation stack ARN/);
  });

  it("should throw on wrong AWS service", () => {
    const s3Arn = "arn:aws:s3:us-east-1:123456789012:bucket/mybucket";
    expect(() => parseStackArn(s3Arn)).toThrow(ConfigResolverError);
  });

  it("should throw on missing region", () => {
    const badArn = "arn:aws:cloudformation::123456789012:stack/Stack/id";
    expect(() => parseStackArn(badArn)).toThrow(ConfigResolverError);
  });

  it("should throw on invalid account ID", () => {
    const badArn = "arn:aws:cloudformation:us-east-1:123:stack/Stack/id";
    expect(() => parseStackArn(badArn)).toThrow(ConfigResolverError);
  });

  it("should provide helpful error message", () => {
    try {
      parseStackArn("invalid");
      fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigResolverError);
      const formatted = (error as ConfigResolverError).format();
      expect(formatted).toContain("💡");
      expect(formatted).toContain("ℹ️");
    }
  });
});

describe("extractStackOutputs", () => {
  const cfnMock = mockClient(CloudFormationClient);

  beforeEach(() => {
    cfnMock.reset();
  });

  it("should extract outputs from stack", async () => {
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: "TestStack",
          CreationTime: new Date(),
          StackStatus: "CREATE_COMPLETE",
          Outputs: [
            { OutputKey: "UserAthenaDatabaseName", OutputValue: "test_db" },
            { OutputKey: "PackagerQueueArn", OutputValue: "arn:aws:sqs:us-east-1:123456789012:test-queue" },
            { OutputKey: "UserBucket", OutputValue: "test-bucket" },
            { OutputKey: "Catalog", OutputValue: "test.catalog.com" },
          ],
        },
      ],
    });

    const outputs = await extractStackOutputs(cfnMock as any, "TestStack");

    expect(outputs.UserAthenaDatabaseName).toBe("test_db");
    expect(outputs.PackagerQueueArn).toBe("arn:aws:sqs:us-east-1:123456789012:test-queue");
    expect(outputs.UserBucket).toBe("test-bucket");
    expect(outputs.Catalog).toBe("test.catalog.com");
  });

  it("should handle empty outputs", async () => {
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [{
        StackName: "EmptyStack",
        CreationTime: new Date(),
        StackStatus: "CREATE_COMPLETE",
        Outputs: []
      }],
    });

    const outputs = await extractStackOutputs(cfnMock as any, "EmptyStack");

    expect(outputs).toEqual({});
  });

  it("should throw if stack not found", async () => {
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [],
    });

    await expect(
      extractStackOutputs(cfnMock as any, "MissingStack"),
    ).rejects.toThrow(ConfigResolverError);

    await expect(
      extractStackOutputs(cfnMock as any, "MissingStack"),
    ).rejects.toThrow(/Stack not found/);
  });

  it("should throw on validation error", async () => {
    cfnMock.on(DescribeStacksCommand).rejects({
      name: "ValidationError",
      message: "Invalid stack name",
    });

    await expect(
      extractStackOutputs(cfnMock as any, "BadName"),
    ).rejects.toThrow(/Invalid stack name/);
  });

  it("should throw on generic AWS error", async () => {
    cfnMock.on(DescribeStacksCommand).rejects({
      name: "ServiceError",
      message: "AWS is down",
    });

    await expect(
      extractStackOutputs(cfnMock as any, "Stack"),
    ).rejects.toThrow(/Failed to describe stack/);
  });
});

describe("resolveAndFetchSecret", () => {
  const smMock = mockClient(SecretsManagerClient);

  beforeEach(() => {
    smMock.reset();
  });

  it("should fetch and validate secret", async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        client_id: "test-client-id",
        client_secret: "test-client-secret",
        tenant: "test-tenant",
        app_definition_id: "test-app-id",
      }),
    });

    const secret = await resolveAndFetchSecret(
      smMock as any,
      "us-east-1",
      "test-secret",
    );

    expect(secret.client_id).toBe("test-client-id");
    expect(secret.client_secret).toBe("test-client-secret");
    expect(secret.tenant).toBe("test-tenant");
    expect(secret.app_definition_id).toBe("test-app-id");
  });

  it("should work with minimal secret (no app_definition_id)", async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        client_id: "id",
        client_secret: "secret",
        tenant: "tenant",
      }),
    });

    const secret = await resolveAndFetchSecret(smMock as any, "us-east-1", "secret");

    expect(secret.client_id).toBe("id");
    expect(secret.app_definition_id).toBeUndefined();
  });

  it("should throw if secret not found", async () => {
    smMock.on(GetSecretValueCommand).rejects({
      name: "ResourceNotFoundException",
      message: "Secret not found",
    });

    await expect(
      resolveAndFetchSecret(smMock as any, "us-east-1", "missing-secret"),
    ).rejects.toThrow(/Secret not found/);
  });

  it("should throw if access denied", async () => {
    smMock.on(GetSecretValueCommand).rejects({
      name: "AccessDeniedException",
      message: "Access denied",
    });

    await expect(
      resolveAndFetchSecret(smMock as any, "us-east-1", "forbidden-secret"),
    ).rejects.toThrow(/Access denied/);
  });

  it("should throw if secret is not string", async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretBinary: Buffer.from("binary"),
    });

    await expect(
      resolveAndFetchSecret(smMock as any, "us-east-1", "binary-secret"),
    ).rejects.toThrow(/does not contain string data/);
  });

  it("should throw if secret contains invalid JSON", async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: "not-json",
    });

    await expect(
      resolveAndFetchSecret(smMock as any, "us-east-1", "bad-json"),
    ).rejects.toThrow(/invalid JSON/);
  });

  it("should throw if secret missing required fields", async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        client_id: "id",
        // missing client_secret and tenant
      }),
    });

    await expect(
      resolveAndFetchSecret(smMock as any, "us-east-1", "incomplete"),
    ).rejects.toThrow(/Invalid secret structure/);
  });

  it("should throw on generic AWS error", async () => {
    smMock.on(GetSecretValueCommand).rejects({
      name: "ServiceError",
      message: "Service error",
    });

    await expect(
      resolveAndFetchSecret(smMock as any, "us-east-1", "secret"),
    ).rejects.toThrow(/Failed to fetch secret/);
  });
});

describe("ConfigResolver", () => {
  const cfnMock = mockClient(CloudFormationClient);
  const smMock = mockClient(SecretsManagerClient);

  beforeEach(() => {
    cfnMock.reset();
    smMock.reset();
  });

  const setupSuccessfulMocks = () => {
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: "QuiltStack",
          CreationTime: new Date(),
          StackStatus: "CREATE_COMPLETE",
          Outputs: [
            { OutputKey: "UserAthenaDatabaseName", OutputValue: "quilt_test_db" },
            { OutputKey: "PackagerQueueArn", OutputValue: "arn:aws:sqs:us-east-1:123456789012:test-queue" },
            { OutputKey: "UserBucket", OutputValue: "test-user-bucket" },
            { OutputKey: "Catalog", OutputValue: "test.quilt.com" },
          ],
        },
      ],
    });

    smMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        client_id: "benchling-client-id",
        client_secret: "benchling-client-secret",
        tenant: "benchling-tenant",
        app_definition_id: "app-123",
      }),
    });
  };

  it("should resolve complete configuration", async () => {
    setupSuccessfulMocks();

    const resolver = new ConfigResolver();
    const config = await resolver.resolve({
      quiltStackArn:
        "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123",
      benchlingSecret: "my-benchling-secret",
      mockCloudFormation: cfnMock as any,
      mockSecretsManager: smMock as any,
    });

    // AWS
    expect(config.awsRegion).toBe("us-east-1");
    expect(config.awsAccount).toBe("123456789012");

    // Quilt
    expect(config.quiltCatalog).toBe("test.quilt.com");
    expect(config.quiltDatabase).toBe("quilt_test_db");
    expect(config.quiltUserBucket).toBe("test-user-bucket");
    expect(config.queueUrl).toBe("https://sqs.us-east-1.amazonaws.com/123456789012/test-queue");

    // Benchling
    expect(config.benchlingTenant).toBe("benchling-tenant");
    expect(config.benchlingClientId).toBe("benchling-client-id");
    expect(config.benchlingClientSecret).toBe("benchling-client-secret");
    expect(config.benchlingAppDefinitionId).toBe("app-123");

    // Defaults
    expect(config.pkgPrefix).toBe("benchling");
    expect(config.pkgKey).toBe("experiment_id");
    expect(config.logLevel).toBe("INFO");
    expect(config.enableWebhookVerification).toBe(true);
  });

  it("should cache configuration", async () => {
    setupSuccessfulMocks();

    const resolver = new ConfigResolver();

    // First call
    const config1 = await resolver.resolve({
      quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/Stack/abc",
      benchlingSecret: "secret",
      mockCloudFormation: cfnMock as any,
      mockSecretsManager: smMock as any,
    });

    // Second call should return cached config
    const config2 = await resolver.resolve({
      quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/Stack/abc",
      benchlingSecret: "secret",
      mockCloudFormation: cfnMock as any,
      mockSecretsManager: smMock as any,
    });

    expect(config1).toBe(config2); // Same object reference
  });

  it("should clear cache", async () => {
    setupSuccessfulMocks();

    const resolver = new ConfigResolver();

    // First resolve
    await resolver.resolve({
      quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/Stack/abc",
      benchlingSecret: "secret",
      mockCloudFormation: cfnMock as any,
      mockSecretsManager: smMock as any,
    });

    // Clear cache
    resolver.clearCache();

    // Next resolve should call AWS again
    cfnMock.reset();
    smMock.reset();
    setupSuccessfulMocks();

    await resolver.resolve({
      quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/Stack/abc",
      benchlingSecret: "secret",
      mockCloudFormation: cfnMock as any,
      mockSecretsManager: smMock as any,
    });

    // Should have been called again
    expect(cfnMock.calls().length).toBeGreaterThan(0);
  });

  it("should throw if missing required outputs", async () => {
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: "Stack",
          CreationTime: new Date(),
          StackStatus: "CREATE_COMPLETE",
          Outputs: [
            { OutputKey: "SomeOtherOutput", OutputValue: "value" },
          ],
        },
      ],
    });

    smMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        client_id: "id",
        client_secret: "secret",
        tenant: "tenant",
      }),
    });

    const resolver = new ConfigResolver();

    await expect(
      resolver.resolve({
        quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/Stack/abc",
        benchlingSecret: "secret",
        mockCloudFormation: cfnMock as any,
        mockSecretsManager: smMock as any,
      }),
    ).rejects.toThrow(/Missing required CloudFormation outputs/);
  });

  it("should accept BucketName instead of UserBucket", async () => {
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: "Stack",
          CreationTime: new Date(),
          StackStatus: "CREATE_COMPLETE",
          Outputs: [
            { OutputKey: "UserAthenaDatabaseName", OutputValue: "db" },
            { OutputKey: "PackagerQueueArn", OutputValue: "arn:aws:sqs:us-east-1:123456789012:test-queue" },
            { OutputKey: "BucketName", OutputValue: "my-bucket" }, // Using BucketName
            { OutputKey: "Catalog", OutputValue: "catalog.com" },
          ],
        },
      ],
    });

    smMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        client_id: "id",
        client_secret: "secret",
        tenant: "tenant",
      }),
    });

    const resolver = new ConfigResolver();
    const config = await resolver.resolve({
      quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/Stack/abc",
      benchlingSecret: "secret",
      mockCloudFormation: cfnMock as any,
      mockSecretsManager: smMock as any,
    });

    expect(config.quiltUserBucket).toBe("my-bucket");
  });

  it("should resolve catalog from CatalogDomain", async () => {
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: "Stack",
          CreationTime: new Date(),
          StackStatus: "CREATE_COMPLETE",
          Outputs: [
            { OutputKey: "UserAthenaDatabaseName", OutputValue: "db" },
            { OutputKey: "PackagerQueueArn", OutputValue: "arn:aws:sqs:us-east-1:123456789012:test-queue" },
            { OutputKey: "UserBucket", OutputValue: "bucket" },
            { OutputKey: "CatalogDomain", OutputValue: "https://my.catalog.com/" },
          ],
        },
      ],
    });

    smMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        client_id: "id",
        client_secret: "secret",
        tenant: "tenant",
      }),
    });

    const resolver = new ConfigResolver();
    const config = await resolver.resolve({
      quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/Stack/abc",
      benchlingSecret: "secret",
      mockCloudFormation: cfnMock as any,
      mockSecretsManager: smMock as any,
    });

    expect(config.quiltCatalog).toBe("my.catalog.com");
  });

  it("should resolve catalog from ApiGatewayEndpoint", async () => {
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: "Stack",
          CreationTime: new Date(),
          StackStatus: "CREATE_COMPLETE",
          Outputs: [
            { OutputKey: "UserAthenaDatabaseName", OutputValue: "db" },
            { OutputKey: "PackagerQueueArn", OutputValue: "arn:aws:sqs:us-east-1:123456789012:test-queue" },
            { OutputKey: "UserBucket", OutputValue: "bucket" },
            {
              OutputKey: "ApiGatewayEndpoint",
              OutputValue: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
            },
          ],
        },
      ],
    });

    smMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        client_id: "id",
        client_secret: "secret",
        tenant: "tenant",
      }),
    });

    const resolver = new ConfigResolver();
    const config = await resolver.resolve({
      quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/Stack/abc",
      benchlingSecret: "secret",
      mockCloudFormation: cfnMock as any,
      mockSecretsManager: smMock as any,
    });

    expect(config.quiltCatalog).toBe("abc123.execute-api.us-east-1.amazonaws.com");
  });

  it("should throw if cannot determine catalog URL", async () => {
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: "Stack",
          CreationTime: new Date(),
          StackStatus: "CREATE_COMPLETE",
          Outputs: [
            { OutputKey: "UserAthenaDatabaseName", OutputValue: "db" },
            { OutputKey: "PackagerQueueArn", OutputValue: "arn:aws:sqs:us-east-1:123456789012:test-queue" },
            { OutputKey: "UserBucket", OutputValue: "bucket" },
            // No Catalog, CatalogDomain, or ApiGatewayEndpoint
          ],
        },
      ],
    });

    smMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        client_id: "id",
        client_secret: "secret",
        tenant: "tenant",
      }),
    });

    const resolver = new ConfigResolver();

    await expect(
      resolver.resolve({
        quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/Stack/abc",
        benchlingSecret: "secret",
        mockCloudFormation: cfnMock as any,
        mockSecretsManager: smMock as any,
      }),
    ).rejects.toThrow(/Cannot determine catalog URL/);
  });
});
