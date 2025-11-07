import { XDGTest } from "../helpers/xdg-test";
import { ProfileConfig, DeploymentHistory } from "../../lib/types/config";

describe("XDGTest In-Memory Configuration Storage", () => {
  let xdgTest: XDGTest;

  const validProfileConfig: ProfileConfig = {
    quilt: {
      stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
      catalog: "https://quilt.example.com",
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
    },
    _metadata: {
      version: "0.7.0",
      createdAt: "2025-11-04T10:00:00Z",
      updatedAt: "2025-11-04T10:00:00Z",
      source: "wizard",
    }
  };

  const validDeploymentHistory: DeploymentHistory = {
    active: {},
    history: [
      {
        stage: "dev",
        timestamp: "2025-11-04T10:00:00Z",
        imageTag: "0.7.0",
        endpoint: "https://test.example.com",
        stackName: "test-stack",
        region: "us-east-1"
      }
    ]
  };

  beforeEach(() => {
    xdgTest = new XDGTest();
  });

  afterEach(() => {
    xdgTest.clear();
  });

  // Rest of the file remains the same as the original
  describe("Raw Profile Storage Primitives", () => {
    it("should write and read a profile with writeProfileRaw and readProfileRaw", () => {
      const profileName = "test-write-read";

      // Use protected method via type assertion
      (xdgTest as any).writeProfileRaw(profileName, validProfileConfig);
      const readProfile = (xdgTest as any).readProfileRaw(profileName);

      expect(readProfile).toEqual(validProfileConfig);
      expect(readProfile).not.toBe(validProfileConfig); // Deep copy check
    });

    // Rest of the describe blocks remain the same...
  });
});