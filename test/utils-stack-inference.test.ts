import {
    extractApiGatewayId,
    buildInferredConfig,
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
            apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
            analyticsBucket: "quilt-staging-analyticsbucket-abc123",
            serviceBucket: "quilt-staging-servicebucket-xyz789",
            stackVersion: "1.2.3",
        };

        const mockStackDetails: StackDetails = {
            outputs: [
                { OutputKey: "UserAthenaDatabaseName", OutputValue: "my_catalog_db" },
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
    });
});
