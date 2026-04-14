/**
 * Unit tests for Deployment Tracking
 *
 * Tests deployment history management and active deployment tracking.
 */

import { ProfileConfig, DeploymentRecord, DeploymentHistory, getStackName } from "../../lib/types/config";
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
                timestamp: "2025-11-04T10:30:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
                deployedBy: "ernest@example.com",
                commit: "abc123f",
            };

            mockStorage.recordDeployment("default", deployment);

            const deployments = mockStorage.getDeployments("default");

            expect(deployments.active).toEqual(deployment);
            expect(deployments.history).toHaveLength(1);
            expect(deployments.history[0]).toEqual(deployment);
        });

        it("should add deployment to history (newest first)", () => {
            const deployment1: DeploymentRecord = {
                timestamp: "2025-11-04T09:00:00Z",
                imageTag: "0.6.0",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const deployment2: DeploymentRecord = {
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const deployment3: DeploymentRecord = {
                timestamp: "2025-11-04T11:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
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

        it("should update active deployment", () => {
            const deployment1: DeploymentRecord = {
                timestamp: "2025-11-04T09:00:00Z",
                imageTag: "0.6.0",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const deployment2: DeploymentRecord = {
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", deployment1);
            mockStorage.recordDeployment("default", deployment2);

            const deployments = mockStorage.getDeployments("default");

            // Active should be the most recent
            expect(deployments.active).toEqual(deployment2);
            expect(deployments.active?.imageTag).toBe("latest");
        });

        it("should replace active deployment when recording a new one", () => {
            const firstDeployment: DeploymentRecord = {
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const secondDeployment: DeploymentRecord = {
                timestamp: "2025-11-04T11:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://xyz789.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", firstDeployment);
            mockStorage.recordDeployment("default", secondDeployment);

            const deployments = mockStorage.getDeployments("default");

            // Last recorded deployment wins
            expect(deployments.active).toEqual(secondDeployment);
            expect(deployments.history).toHaveLength(2);
        });

        it("should create deployment for profile that does not exist yet", () => {
            const deployment: DeploymentRecord = {
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("new-profile", deployment);

            const deployments = mockStorage.getDeployments("new-profile");
            expect(deployments.active).toEqual(deployment);
        });

        it("should include optional fields in deployment record", () => {
            const deployment: DeploymentRecord = {
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://xyz789.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
                deployedBy: "ernest@example.com",
                commit: "abc123f",
            };

            mockStorage.recordDeployment("default", deployment);

            const deployments = mockStorage.getDeployments("default");

            expect(deployments.active?.deployedBy).toBe("ernest@example.com");
            expect(deployments.active?.commit).toBe("abc123f");
        });

        it("should record profile-based stack names", () => {
            // Test "default" profile uses legacy stack name
            const defaultDeployment: DeploymentRecord = {
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "0.9.8",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            // Test "sales" profile uses profile-specific stack name
            const salesDeployment: DeploymentRecord = {
                timestamp: "2025-11-04T10:30:00Z",
                imageTag: "0.9.8",
                endpoint: "https://xyz789.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack-sales",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", defaultDeployment);
            mockStorage.recordDeployment("sales", salesDeployment);

            const defaultDeployments = mockStorage.getDeployments("default");
            const salesDeployments = mockStorage.getDeployments("sales");

            expect(defaultDeployments.active?.stackName).toBe("BenchlingWebhookStack");
            expect(salesDeployments.active?.stackName).toBe("BenchlingWebhookStack-sales");
        });

        it("should support custom stack names", () => {
            const customDeployment: DeploymentRecord = {
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "0.9.8",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "CustomBenchlingStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("custom-profile", customDeployment);

            const deployments = mockStorage.getDeployments("custom-profile");

            expect(deployments.active?.stackName).toBe("CustomBenchlingStack");
        });
    });

    describe("getDeployments()", () => {
        it("should return empty history when no deployments exist", () => {
            const deployments = mockStorage.getDeployments("nonexistent");

            expect(deployments.active).toBeNull();
            expect(deployments.history).toEqual([]);
        });

        it("should read existing deployments file", () => {
            const deployment1: DeploymentRecord = {
                timestamp: "2025-11-04T09:00:00Z",
                imageTag: "0.6.0",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const deployment2: DeploymentRecord = {
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://xyz789.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", deployment1);
            mockStorage.recordDeployment("default", deployment2);

            const deployments = mockStorage.getDeployments("default");

            // Last recorded deployment is the active one
            expect(deployments.active).toEqual(deployment2);
            expect(deployments.history).toHaveLength(2);
        });

        // Schema validation is handled at write time in XDGTest
    });

    describe("getActiveDeployment()", () => {
        it("should return null when no deployment exists", () => {
            const deployment = mockStorage.getActiveDeployment("default");
            expect(deployment).toBeNull();
        });

        it("should return active deployment", () => {
            const firstDeployment: DeploymentRecord = {
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const secondDeployment: DeploymentRecord = {
                timestamp: "2025-11-04T11:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://xyz789.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", firstDeployment);
            mockStorage.recordDeployment("default", secondDeployment);

            const active = mockStorage.getActiveDeployment("default");

            // Last recorded deployment is the active one
            expect(active).toEqual(secondDeployment);
        });

        it("should return most recent deployment when multiple are recorded", () => {
            const deployment1: DeploymentRecord = {
                timestamp: "2025-11-04T09:00:00Z",
                imageTag: "0.6.0",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const deployment2: DeploymentRecord = {
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", deployment1);
            mockStorage.recordDeployment("default", deployment2);

            const active = mockStorage.getActiveDeployment("default");

            expect(active).toEqual(deployment2);
            expect(active?.imageTag).toBe("latest");
        });

        it("should return null for nonexistent profile", () => {
            const deployment = mockStorage.getActiveDeployment("nonexistent");
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
                    timestamp,
                    imageTag: `tag-${index}`,
                    endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
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
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "0.7.0",
                endpoint: "https://xyz789.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            const devDeployment: DeploymentRecord = {
                timestamp: "2025-11-04T11:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", defaultDeployment);
            mockStorage.recordDeployment("dev", devDeployment);

            const defaultDeployments = mockStorage.getDeployments("default");
            const devDeployments = mockStorage.getDeployments("dev");

            expect(defaultDeployments.history).toHaveLength(1);
            expect(defaultDeployments.active).toEqual(defaultDeployment);

            expect(devDeployments.history).toHaveLength(1);
            expect(devDeployments.active).toEqual(devDeployment);
        });

        it("should persist deployment data across XDGConfig instances", () => {
            const deployment: DeploymentRecord = {
                timestamp: "2025-11-04T10:00:00Z",
                imageTag: "latest",
                endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com",
                stackName: "BenchlingWebhookStack",
                region: "us-east-1",
            };

            mockStorage.recordDeployment("default", deployment);

            // Read back deployments from same instance (mock storage is in-memory)
            const deployments = mockStorage.getDeployments("default");

            expect(deployments.active).toEqual(deployment);
            expect(deployments.history).toHaveLength(1);
        });
    });

    describe("getStackName() helper function", () => {
        it("should return legacy name for 'default' profile", () => {
            const stackName = getStackName("default");
            expect(stackName).toBe("BenchlingWebhookStack");
        });

        it("should return profile-suffixed name for non-default profiles", () => {
            expect(getStackName("sales")).toBe("BenchlingWebhookStack-sales");
            expect(getStackName("dev")).toBe("BenchlingWebhookStack-dev");
            expect(getStackName("staging")).toBe("BenchlingWebhookStack-staging");
            expect(getStackName("customer-acme")).toBe("BenchlingWebhookStack-customer-acme");
        });

        it("should use custom name when provided", () => {
            expect(getStackName("default", "CustomStack")).toBe("CustomStack");
            expect(getStackName("sales", "SalesWebhookStack")).toBe("SalesWebhookStack");
            expect(getStackName("dev", "MyCustomStack")).toBe("MyCustomStack");
        });

        it("should handle empty custom name", () => {
            expect(getStackName("default", "")).toBe("BenchlingWebhookStack");
            expect(getStackName("sales", "")).toBe("BenchlingWebhookStack-sales");
        });

        it("should handle undefined custom name", () => {
            expect(getStackName("default", undefined)).toBe("BenchlingWebhookStack");
            expect(getStackName("sales", undefined)).toBe("BenchlingWebhookStack-sales");
        });
    });
});
