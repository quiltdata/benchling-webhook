import {
    extractBucketName,
    extractApiGatewayId,
    inferStackPrefix,
    buildInferredConfig,
    type QuiltCatalogConfig,
    type StackDetails,
} from "../lib/utils/stack-inference";

describe("stack-inference utility", () => {
    describe("extractBucketName", () => {
        it("should extract bucket name from ARN", () => {
            const arn = "arn:aws:s3:::my-bucket-name";
            expect(extractBucketName(arn)).toBe("my-bucket-name");
        });

        it("should extract bucket name from ARN with path", () => {
            const arn = "arn:aws:s3:::my-bucket-name/path/to/object";
            expect(extractBucketName(arn)).toBe("my-bucket-name");
        });

        it("should return bucket name as-is if not an ARN", () => {
            const bucketName = "my-bucket-name";
            expect(extractBucketName(bucketName)).toBe("my-bucket-name");
        });

        it("should handle bucket name with path", () => {
            const bucketWithPath = "my-bucket-name/prefix/key";
            expect(extractBucketName(bucketWithPath)).toBe("my-bucket-name");
        });
    });

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

    describe("inferStackPrefix", () => {
        it("should infer prefix from analytics bucket", () => {
            const analyticsBucket = "quilt-staging-analyticsbucket-10ort3e91tnoa";
            const prefix = inferStackPrefix(analyticsBucket);
            expect(prefix).toBe("quilt-staging");
        });

        it("should infer prefix from service bucket", () => {
            const serviceBucket = "prod-app-servicebucket-abc123";
            const prefix = inferStackPrefix(undefined, serviceBucket);
            expect(prefix).toBe("prod-app");
        });

        it("should prefer analytics bucket over service bucket", () => {
            const analyticsBucket = "analytics-prod-bucket-123";
            const serviceBucket = "service-prod-bucket-456";
            const prefix = inferStackPrefix(analyticsBucket, serviceBucket);
            expect(prefix).toBe("analytics-prod");
        });

        it("should handle bucket with less than 3 parts", () => {
            const bucket = "mybucket";
            const prefix = inferStackPrefix(bucket);
            expect(prefix).toBe("mybucket");
        });

        it("should return default when no buckets provided", () => {
            const prefix = inferStackPrefix();
            expect(prefix).toBe("quilt");
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
                { OutputKey: "UserAthenaDatabase", OutputValue: "my_catalog_db" },
                { OutputKey: "PackagerQueue", OutputValue: "my-stack-PackagerQueue-ABC123" },
                { OutputKey: "DataBucket", OutputValue: "my-data-bucket" },
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
            expect(vars.QUEUE_NAME).toBe("my-stack-PackagerQueue-ABC123");
            expect(vars["# CloudFormation Stack"]).toBe("my-quilt-stack");
            expect(vars["# Stack Version"]).toBe("1.2.3");
        });

        it("should extract database from UserAthenaDatabase output", () => {
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

        it("should extract database from AthenaDatabase output", () => {
            const stackDetails: StackDetails = {
                outputs: [{ OutputKey: "AthenaDatabase", OutputValue: "athena_db" }],
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

            expect(vars.QUILT_DATABASE).toBe("athena_db");
        });

        it("should extract database from Database output", () => {
            const stackDetails: StackDetails = {
                outputs: [{ OutputKey: "Database", OutputValue: "simple_db" }],
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

            expect(vars.QUILT_DATABASE).toBe("simple_db");
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

        it("should build SQS queue URL from queue name", () => {
            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                mockStackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars.SQS_QUEUE_URL).toBe(
                "https://sqs.us-east-1.amazonaws.com/123456789012/my-stack-PackagerQueue-ABC123",
            );
        });

        it("should extract queue name from ARN format", () => {
            const stackDetails: StackDetails = {
                outputs: [
                    {
                        OutputKey: "PackagerQueue",
                        OutputValue: "arn:aws:sqs:us-east-1:123456789012:my-queue",
                    },
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

            expect(vars.QUEUE_NAME).toBe("my-queue");
        });

        it("should extract queue name from URL format", () => {
            const stackDetails: StackDetails = {
                outputs: [
                    {
                        OutputKey: "PackagerQueue",
                        OutputValue:
                            "https://sqs.us-east-1.amazonaws.com/123456789012/my-queue-name",
                    },
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

            expect(vars.QUEUE_NAME).toBe("my-queue-name");
        });

        it("should use data bucket from stack outputs", () => {
            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                mockStackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars.QUILT_USER_BUCKET).toContain("my-data-bucket");
        });

        it("should fall back to service bucket when DataBucket not in outputs", () => {
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

            expect(vars.QUILT_USER_BUCKET).toContain("quilt-staging-servicebucket-xyz789");
        });

        it("should handle missing account ID", () => {
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

        it("should handle missing stack name", () => {
            const vars = buildInferredConfig(
                mockConfig,
                null,
                { outputs: [], parameters: [] },
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars["# CloudFormation Stack"]).toBeUndefined();
            expect(vars.CDK_DEFAULT_ACCOUNT).toBe("123456789012");
        });

        it("should include API Gateway endpoint in metadata", () => {
            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                mockStackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com",
            );

            expect(vars["# API Gateway Endpoint"]).toBe(
                "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
            );
        });

        it("should extract catalog domain without protocol", () => {
            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                mockStackDetails,
                "us-east-1",
                "123456789012",
                "https://catalog.example.com/path",
            );

            expect(vars.QUILT_CATALOG).toBe("catalog.example.com");
        });

        it("should handle http protocol", () => {
            const vars = buildInferredConfig(
                mockConfig,
                "my-stack",
                mockStackDetails,
                "us-east-1",
                "123456789012",
                "http://catalog.example.com",
            );

            expect(vars.QUILT_CATALOG).toBe("catalog.example.com");
        });
    });
});
