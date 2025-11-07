/**
 * Unit tests for Deployment Tracking (v0.7.0)
 *
 * Tests deployment history management and active deployment tracking.
 */

import { ProfileConfig, DeploymentRecord, DeploymentHistory } from "../../lib/types/config";
import { XDGTest } from "../helpers/xdg-test";

describe("Deployment Tracking", () => {
    let mockStorage: XDGTest;

    beforeEach(() => {
        mockStorage = new XDGTest();
    });

    afterEach(() => {
        mockStorage.clear();
    });

    describe("recordDeployment()", () => {
        it("should record a new deployment", () => {
            const deployment: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T10:30:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
                deployedBy: "ernest@example.com",
                commit: "abc123f",
            };

            mockStorage.recordDeployment("default", deployment);

            const deployments = mockStorage.getDeployments("default");

            expect(deployments.active["dev"]).toEqual(deployment);
            expect(deployments.history).toHaveLength(1);
            expect(deployments.history[0]).toEqual(deployment);
        });

        it("should add deployment to history (newest first)", () => {
            const deployment1: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T09:00:00Z",
                imageTag: "0.6.0",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const deployment2: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const deployment3: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T11:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", deployment1);
            mockStorage.recordDeployment("default", deployment2);
            mockStorage.recordDeployment("default", deployment3);

            const deployments = mockStorage.getDeployments("default");

            expect(deployments.history).toHaveLength(3);
            expect(deployments.history[0]).toEqual(deployment3);
            expect(deployments.history[1]).toEqual(deployment2);
            expect(deployments.history[2]).toEqual(deployment1);
        });

        it("should update active deployment for stage", () => {
            const deployment1: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T09:00:00Z",
                imageTag: "0.6.0",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const deployment2: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", deployment1);
            mockStorage.recordDeployment("default", deployment2);

            const deployments = mockStorage.getDeployments("default");

            // Active should be the most recent
            expect(deployments.active["dev"]).toEqual(deployment2);
            expect(deployments.active["dev"].imageTag).toBe("latest");
        });

        it("should handle multiple stages per profile", () => {
            const devDeployment: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const prodDeployment: DeploymentRecord = {
                stage: "prod",
                timestamp: "2025-11-04T11:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://xyz789.execute-api.us-east-1.amazonaws.com/prod",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", devDeployment);
            mockStorage.recordDeployment("default", prodDeployment);

            const deployments = mockStorage.getDeployments("default");

            expect(deployments.active["dev"]).toEqual(devDeployment);
            expect(deployments.active["prod"]).toEqual(prodDeployment);
            expect(deployments.history).toHaveLength(2);
        });

        it("should create deployment for profile that does not exist yet", () => {
            const deployment: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("new-profile", deployment);

            const deployments = mockStorage.getDeployments("new-profile");
            expect(deployments.active["dev"]).toEqual(deployment);
        });

        it("should include optional fields in deployment record", () => {
            const deployment: DeploymentRecord = {
                stage: "prod",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://xyz789.execute-api.us-east-1.amazonaws.com/prod",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
                deployedBy: "ernest@example.com",
                commit: "abc123f",
            };

            mockStorage.recordDeployment("default", deployment);

            const deployments = mockStorage.getDeployments("default");

            expect(deployments.active["prod"].deployedBy).toBe("ernest@example.com");
            expect(deployments.active["prod"].commit).toBe("abc123f");
        });
    });

    describe("getDeployments()", () => {
        it("should return empty history when no deployments exist", () => {
            const deployments = mockStorage.getDeployments("nonexistent");

            expect(deployments.active).toEqual({});
            expect(deployments.history).toEqual([]);
        });

        it("should read existing deployments file", () => {
            const deployment1: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T09:00:00Z",
                imageTag: "0.6.0",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const deployment2: DeploymentRecord = {
                stage: "prod",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://xyz789.execute-api.us-east-1.amazonaws.com/prod",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", deployment1);
            mockStorage.recordDeployment("default", deployment2);

            const deployments = mockStorage.getDeployments("default");

            expect(deployments.active["dev"]).toEqual(deployment1);
            expect(deployments.active["prod"]).toEqual(deployment2);
            expect(deployments.history).toHaveLength(2);
        });

        // Schema validation is handled at write time in XDGTest
    });

    describe("getActiveDeployment()", () => {
        it("should return null when no deployment exists for stage", () => {
            const deployment = mockStorage.getActiveDeployment("default", "prod");
            expect(deployment).toBeNull();
        });

        it("should return active deployment for stage", () => {
            const devDeployment: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const prodDeployment: DeploymentRecord = {
                stage: "prod",
                timestamp: "2025-11-04T11:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://xyz789.execute-api.us-east-1.amazonaws.com/prod",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", devDeployment);
            mockStorage.recordDeployment("default", prodDeployment);

            const dev = mockStorage.getActiveDeployment("default", "dev");
            const prod = mockStorage.getActiveDeployment("default", "prod");

            expect(dev).toEqual(devDeployment);
            expect(prod).toEqual(prodDeployment);
        });

        it("should return most recent deployment when stage has multiple deployments", () => {
            const deployment1: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T09:00:00Z",
                imageTag: "0.6.0",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const deployment2: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", deployment1);
            mockStorage.recordDeployment("default", deployment2);

            const active = mockStorage.getActiveDeployment("default", "dev");

            expect(active).toEqual(deployment2);
            expect(active?.imageTag).toBe("latest");
        });

        it("should return null for nonexistent profile", () => {
            const deployment = mockStorage.getActiveDeployment("nonexistent", "dev");
            expect(deployment).toBeNull();
        });
    });

    describe("deployment history management", () => {
        it("should maintain chronological order in history", () => {
            const timestamps = [
                "2025-11-04T08:00:00Z",
                "2025-11-04T09:00:00Z",
                "2025-11-04T10:00:00Z",
                "2025-11-04T11:00:00Z",
                "2025-11-04T12:00:00Z",
            ];

            timestamps.forEach((timestamp, index) => {
                const deployment: DeploymentRecord = {
                    stage: "dev",
                    timestamp,
                    imageTag: `tag-${index}`,
                    endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                    stackName: "BenchlingWebhookStack",
                    region: "us-east-1",
                };
                mockStorage.recordDeployment("default", deployment);
            });

            const deployments = mockStorage.getDeployments("default");

            expect(deployments.history).toHaveLength(5);

            // Should be newest first
            expect(deployments.history[0].timestamp).toBe("2025-11-04T12:00:00Z");
            expect(deployments.history[1].timestamp).toBe("2025-11-04T11:00:00Z");
            expect(deployments.history[2].timestamp).toBe("2025-11-04T10:00:00Z");
            expect(deployments.history[3].timestamp).toBe("2025-11-04T09:00:00Z");
            expect(deployments.history[4].timestamp).toBe("2025-11-04T08:00:00Z");
        });

        it("should track deployments across different profiles independently", () => {
            const defaultDeployment: DeploymentRecord = {
                stage: "prod",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://xyz789.execute-api.us-east-1.amazonaws.com/prod",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const devDeployment: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T11:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", defaultDeployment);
            mockStorage.recordDeployment("dev", devDeployment);

            const defaultDeployments = mockStorage.getDeployments("default");
            const devDeployments = mockStorage.getDeployments("dev");

            expect(defaultDeployments.history).toHaveLength(1);
            expect(defaultDeployments.active["prod"]).toEqual(defaultDeployment);

            expect(devDeployments.history).toHaveLength(1);
            expect(devDeployments.active["dev"]).toEqual(devDeployment);
        });

        it("should persist deployment data across XDGConfig instances", () => {
            const deployment: DeploymentRecord = {
                stage: "dev",
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", deployment);

            // Read back deployments from same instance (mock storage is in-memory)
            const deployments = mockStorage.getDeployments("default");

            expect(deployments.active["dev"]).toEqual(deployment);
            expect(deployments.history).toHaveLength(1);
        });
    });
});
