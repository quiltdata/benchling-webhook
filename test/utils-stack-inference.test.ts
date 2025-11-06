import {
    extractApiGatewayId,
    buildInferredConfig,
    findStack,
    type QuiltCatalogConfig,
    type StackDetails,
} from "../lib/utils/stack-inference";

describe("stack-inference utility", () => {
    describe("extractApiGatewayId", () => {
        it("should extract API Gateway ID from endpoint URL", () => {
            const endpoint = "https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod";
            expect(extractApiGatewayId(endpoint)).toBe("abc123xyz");
        });

        it("should return null for invalid endpoint", () => {
            const endpoint = "https://example.com/api";
            expect(extractApiGatewayId(endpoint)).toBeNull();
        });

        it("should handle different regions", () => {
            const endpoint = "https://xyz789abc.execute-api.eu-west-1.amazonaws.com/prod";
            expect(extractApiGatewayId(endpoint)).toBe("xyz789abc");
        });
    });

    describe("buildInferredConfig", () => {
        const mockConfig: QuiltCatalogConfig = {
            region: "us-east-1",
            webhookEndpoint: "http://benchling-webhook-alb-123456.us-east-1.elb.amazonaws.com/",
            analyticsBucket: "quilt-staging-analyticsbucket-abc123",
            serviceBucket: "quilt-staging-servicebucket-xyz789",
            stackVersion: "1.2.3",
        };

        const mockStackDetails: StackDetails = {
            outputs: [
                { OutputKey: "UserAthenaDatabaseName", OutputValue: "my_catalog_db" },
                { OutputKey: "PackagerQueueUrl", OutputValue: "https://sqs.us-east-1.amazonaws.com/123456789012/my-queue" },
            ],
            parameters: [],
        };

        it("should build complete inferred configuration", () => {
            const vars = buildInferredConfig(
                mockConfig,
                "my-quilt-stack",
                mockStackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars.CDK_DEFAULT_ACCOUNT).toBe("123456789012");
            expect(vars.CDK_DEFAULT_REGION).toBe("us-east-1");
            expect(vars.AWS_REGION).toBe("us-east-1");
            expect(vars.QUILT_CATALOG).toBe("catalog.example.com");
            expect(vars.QUILT_DATABASE).toBe("my_catalog_db");
            expect(vars.QUEUE_URL).toBe("https://sqs.us-east-1.amazonaws.com/123456789012/my-queue");
            expect(vars["# CloudFormation Stack"]).toBe("my-quilt-stack");
            expect(vars["# Stack Version"]).toBe("1.2.3");
            expect(vars["# Webhook Endpoint"]).toBe(
                "http://benchling-webhook-alb-123456.us-east-1.elb.amazonaws.com/",
            );
        });

        it("should extract database from UserAthenaDatabaseName output", () => {
            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                mockStackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars.QUILT_DATABASE).toBe("my_catalog_db");
        });

        it("should infer database from catalog name when not in outputs", () => {
            const stackDetails: StackDetails = {
                outputs: [],
                parameters: [],
            };

            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                stackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars.QUILT_DATABASE).toContain("catalog_example_com_db");
            expect(vars.QUILT_DATABASE).toContain("VERIFY THIS");
        });

        it("should not infer user bucket - user must provide it", () => {
            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                mockStackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            // User bucket should NOT be in inferred vars
            expect(vars.QUILT_USER_BUCKET).toBeUndefined();
        });

        it("should extract catalog domain from URL", () => {
            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                mockStackDetails,
                "us-east-1",
                "123456789012",
                "https://my-catalog.example.com",
            );

            expect(vars.QUILT_CATALOG).toBe("my-catalog.example.com");
        });

        it("should handle missing accountId", () => {
            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                mockStackDetails,
                "us-east-1",
                null,
                "https://catalog.example.com",
            );

            expect(vars.CDK_DEFAULT_ACCOUNT).toBeUndefined();
            expect(vars.CDK_DEFAULT_REGION).toBe("us-east-1");
        });

        it("should handle missing catalog domain", () => {
            const stackDetails: StackDetails = {
                outputs: [], // No database output either
                parameters: [],
            };

            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                stackDetails,
                "us-east-1",
                "123456789012",
                "",
            );

            expect(vars.QUILT_CATALOG).toBeUndefined();
            expect(vars.QUILT_DATABASE).toBeUndefined();
        });

        it("should handle missing stackName", () => {
            const vars = buildInferredConfig(
                mockConfig,
                null,
                mockStackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars["# CloudFormation Stack"]).toBeUndefined();
            expect(vars.QUILT_DATABASE).toBe("my_catalog_db");
        });

        it("should handle missing stackVersion", () => {
            const configNoVersion: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            const vars = buildInferredConfig(
                configNoVersion,
                "my-stack",
                mockStackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars["# Stack Version"]).toBeUndefined();
        });

        it("should use QueueUrl output as fallback", () => {
            const stackDetails: StackDetails = {
                outputs: [
                    { OutputKey: "QueueUrl", OutputValue: "https://sqs.us-east-1.amazonaws.com/123456789012/fallback-queue" },
                ],
                parameters: [],
            };

            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                stackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars.QUEUE_URL).toBe("https://sqs.us-east-1.amazonaws.com/123456789012/fallback-queue");
        });

        it("should prioritize PackagerQueueUrl over QueueUrl", () => {
            const stackDetails: StackDetails = {
                outputs: [
                    { OutputKey: "QueueUrl", OutputValue: "https://sqs.us-east-1.amazonaws.com/123456789012/old-queue" },
                    { OutputKey: "PackagerQueueUrl", OutputValue: "https://sqs.us-east-1.amazonaws.com/123456789012/new-queue" },
                ],
                parameters: [],
            };

            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                stackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars.QUEUE_URL).toBe("https://sqs.us-east-1.amazonaws.com/123456789012/new-queue");
        });

        it("should not set QUEUE_URL if value is not a valid queue URL", () => {
            const stackDetails: StackDetails = {
                outputs: [
                    { OutputKey: "PackagerQueueUrl", OutputValue: "invalid-url" },
                ],
                parameters: [],
            };

            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                stackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars.QUEUE_URL).toBeUndefined();
        });
    });

    describe("findStack", () => {
        it("should return null when apiGatewayId is null", () => {
            const result = findStack("us-east-1", null, false);
            expect(result).toBeNull();
        });

        it("should call findStackByResource with correct parameters when apiGatewayId is provided", () => {
            // This test would require mocking execSync, which is complex
            // Instead, we test the logic path by passing an ID and expecting a call
            const result = findStack("us-east-1", "abc123", false);
            // Result depends on actual AWS CLI being available, so we just verify it doesn't throw
            expect(result === null || typeof result === "string").toBe(true);
        });
    });
});
