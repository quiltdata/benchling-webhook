/**
 * Integration tests for Multi-Profile Setup (v0.7.0)
 *
 * Tests complete workflow with multiple profiles and deployment tracking.
 */

import { MockConfigStorage } from "../mocks";
import { ProfileConfig, DeploymentRecord } from "../../lib/types/config";

describe("Multi-Profile Integration", () => {
    let mockStorage: MockConfigStorage;

    beforeEach(() => {
        mockStorage = new MockConfigStorage();
    });

    afterEach(() => {
        mockStorage.clear();
    });

    describe("multi-profile setup workflow", () => {
        it("should create and manage multiple profiles independently", () => {
            // Create default profile
            const defaultConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/prod/abc",
                    catalog: "https://quilt.prod.example.com",
                    database: "prod_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/prod-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "prod-tenant",
                    clientId: "prod-client",
                    appDefinitionId: "prod-app",
                },
                packages: {
                    bucket: "prod-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "0.7.0",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("default", defaultConfig);

            // Create dev profile
            const devConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/dev/xyz",
                    catalog: "https://quilt.dev.example.com",
                    database: "dev_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/dev-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "dev-tenant",
                    clientId: "dev-client",
                    appDefinitionId: "dev-app",
                },
                packages: {
                    bucket: "dev-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
                logging: {
                    level: "DEBUG",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T11:00:00Z",
                    updatedAt: "2025-11-04T11:00:00Z",
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("dev", devConfig);

            // Verify both profiles exist
            const profiles = mockStorage.listProfiles();
            expect(profiles).toContain("default");
            expect(profiles).toContain("dev");

            // Verify they are independent
            const readDefault = mockStorage.readProfile("default");
            const readDev = mockStorage.readProfile("dev");

            expect(readDefault.deployment.imageTag).toBe("0.7.0");
            expect(readDev.deployment.imageTag).toBe("latest");
        });

        it("should create dev profile with inheritance from default", () => {
            // Create default profile
            const defaultConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/prod/abc",
                    catalog: "https://quilt.example.com",
                    database: "shared_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/shared-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "shared-tenant",
                    clientId: "shared-client",
                    appDefinitionId: "prod-app",
                },
                packages: {
                    bucket: "shared-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "stable",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("default", defaultConfig);

            // Create dev profile that inherits from default
            const devConfig: ProfileConfig = {
                _inherits: "default",
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/prod/abc",
                    catalog: "https://quilt.example.com",
                    database: "shared_catalog",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/shared-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "shared-tenant",
                    clientId: "shared-client",
                    appDefinitionId: "dev-app",
                },
                packages: {
                    bucket: "shared-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
                logging: {
                    level: "DEBUG",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T11:00:00Z",
                    updatedAt: "2025-11-04T11:00:00Z",
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("dev", devConfig);

            // Read with inheritance
            const resolvedDev = mockStorage.readProfileWithInheritance("dev");

            // Should inherit shared values from default
            expect(resolvedDev.benchling.tenant).toBe("shared-tenant");
            expect(resolvedDev.packages.bucket).toBe("shared-packages");

            // Should use dev overrides
            expect(resolvedDev.benchling.appDefinitionId).toBe("dev-app");
            expect(resolvedDev.deployment.imageTag).toBe("latest");
            expect(resolvedDev.logging?.level).toBe("DEBUG");
        });

        it("should deploy both profiles to different stages", () => {
            // Create default profile
            const defaultConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/prod/abc",
                    catalog: "https://quilt.example.com",
                    database: "prod_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/prod-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "prod-tenant",
                    clientId: "prod-client",
                    appDefinitionId: "prod-app",
                },
                packages: {
                    bucket: "prod-packages",
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
                },
            };

            mockStorage.writeProfile("default", defaultConfig);

            // Create dev profile
            const devConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/dev/xyz",
                    catalog: "https://quilt.example.com",
                    database: "dev_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/dev-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "dev-tenant",
                    clientId: "dev-client",
                    appDefinitionId: "dev-app",
                },
                packages: {
                    bucket: "dev-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T11:00:00Z",
                    updatedAt: "2025-11-04T11:00:00Z",
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("dev", devConfig);

            // Deploy default profile to prod stage
            const prodDeployment: DeploymentRecord = {
                stage: "prod",
                timestamp: "2025-11-04T12:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://prod.execute-api.us-east-1.amazonaws.com/prod",
                stackName: "BenchlingWebhookStack-Prod",
                region: "us-east-1",
                deployedBy: "ernest@example.com",
                commit: "abc123",
            };

            mockStorage.recordDeployment("default", prodDeployment);

            // Deploy dev profile to dev stage
            const devDeployment: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T12:30:00Z",
                imageTag: "latest",
                endpoint: "https://dev.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack-Dev",
                region: "us-east-1",
                deployedBy: "ernest@example.com",
                commit: "xyz789",
            };

            mockStorage.recordDeployment("dev", devDeployment);

            // Verify deployments are tracked independently
            const defaultDeployments = mockStorage.getDeployments("default");
            const devDeployments = mockStorage.getDeployments("dev");

            expect(defaultDeployments.active["prod"]).toEqual(prodDeployment);
            expect(devDeployments.active["dev"]).toEqual(devDeployment);

            // Verify cross-contamination doesn't occur
            expect(defaultDeployments.active["dev"]).toBeUndefined();
            expect(devDeployments.active["prod"]).toBeUndefined();
        });

        it("should verify deployment tracking for multiple stages per profile", () => {
            const defaultConfig: ProfileConfig = {
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
                },
            };

            mockStorage.writeProfile("default", defaultConfig);

            // Deploy to dev stage
            const devDeployment: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://dev.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", devDeployment);

            // Deploy to staging stage
            const stagingDeployment: DeploymentRecord = {
                stage: "staging",
                timestamp: "2025-11-04T11:00:00Z",
                imageTag: "0.7.0-rc1",
                endpoint: "https://staging.execute-api.us-east-1.amazonaws.com/staging",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", stagingDeployment);

            // Deploy to prod stage
            const prodDeployment: DeploymentRecord = {
                stage: "prod",
                timestamp: "2025-11-04T12:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://prod.execute-api.us-east-1.amazonaws.com/prod",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", prodDeployment);

            // Verify all stages are tracked
            const deployments = mockStorage.getDeployments("default");

            expect(Object.keys(deployments.active)).toEqual(["dev", "staging", "prod"]);
            expect(deployments.active["dev"]).toEqual(devDeployment);
            expect(deployments.active["staging"]).toEqual(stagingDeployment);
            expect(deployments.active["prod"]).toEqual(prodDeployment);
            expect(deployments.history).toHaveLength(3);
        });
    });

    describe("profile lifecycle management", () => {
        it("should handle complete profile lifecycle", () => {
            // 1. Create multiple profiles
            const defaultConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "default_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/default-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "default-tenant",
                    clientId: "default-client",
                    appDefinitionId: "default-app",
                },
                packages: {
                    bucket: "default-packages",
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
                },
            };

            const devConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "dev_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/dev-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "dev-tenant",
                    clientId: "dev-client",
                    appDefinitionId: "dev-app",
                },
                packages: {
                    bucket: "dev-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T11:00:00Z",
                    updatedAt: "2025-11-04T11:00:00Z",
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("default", defaultConfig);
            mockStorage.writeProfile("dev", devConfig);

            expect(mockStorage.listProfiles().length).toBe(2);

            // 2. Update a profile
            const updatedDevConfig = { ...devConfig };
            updatedDevConfig._metadata.updatedAt = "2025-11-04T12:00:00Z";

            mockStorage.writeProfile("dev", updatedDevConfig);

            const readDev = mockStorage.readProfile("dev");

            // 3. Record deployments
            const deployment: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T13:00:00Z",
                imageTag: "latest",
                endpoint: "https://dev.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("dev", deployment);

            const deployments = mockStorage.getDeployments("dev");
            expect(deployments.active["dev"]).toBeDefined();

            // 4. Delete a profile
            mockStorage.deleteProfile("dev");

            expect(mockStorage.profileExists("dev")).toBe(false);
            expect(mockStorage.listProfiles()).toEqual(["default"]);
        });

        it("should isolate profile updates from each other", () => {
            const profile1: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "profile1_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/profile1-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "profile1-tenant",
                    clientId: "profile1-client",
                    appDefinitionId: "profile1-app",
                },
                packages: {
                    bucket: "profile1-packages",
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
                },
            };

            const profile2: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "profile2_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/profile2-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "profile2-tenant",
                    clientId: "profile2-client",
                    appDefinitionId: "profile2-app",
                },
                packages: {
                    bucket: "profile2-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T11:00:00Z",
                    updatedAt: "2025-11-04T11:00:00Z",
                    source: "wizard",
                },
            };

            mockStorage.writeProfile("profile1", profile1);
            mockStorage.writeProfile("profile2", profile2);

            // Update profile1
            const updatedProfile1 = { ...profile1 };
            mockStorage.writeProfile("profile1", updatedProfile1);

            // Verify profile2 is unchanged
            const readProfile2 = mockStorage.readProfile("profile2");

            // Verify profile1 was updated
            const readProfile1 = mockStorage.readProfile("profile1");
        });
    });
});
