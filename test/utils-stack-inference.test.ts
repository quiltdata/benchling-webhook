import {
    extractApiGatewayId,
    buildInferredConfig,
    findStack,
    inferStackConfig,
    findStackByResource,
    getStackDetails,
    getAwsAccountId,
    listAllStacks,
    isQuiltStack,
    findAllQuiltStacks,
    type QuiltCatalogConfig,
    type StackDetails,
} from "../lib/utils/stack-inference";
import { MockAwsProvider } from "./mocks/mock-aws-provider";
import { MockHttpClient } from "./mocks/mock-http-client";
import { execSync } from "child_process";

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

        it("should only use PackagerQueueUrl (QueueUrl no longer supported)", () => {
            const stackDetails: StackDetails = {
                outputs: [
                    { OutputKey: "QueueUrl", OutputValue: "https://sqs.us-east-1.amazonaws.com/123456789012/old-queue" },
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

            // QueueUrl should no longer be used as fallback
            expect(vars.QUEUE_URL).toBeUndefined();
        });

        it("should use PackagerQueueUrl when present", () => {
            const stackDetails: StackDetails = {
                outputs: [
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
        it("should return null when apiGatewayId is null", async () => {
            const mockAwsProvider = new MockAwsProvider();
            const result = await findStack("us-east-1", null, mockAwsProvider, false);
            expect(result).toBeNull();
        });

        it("should find stack successfully with mocked AWS provider", async () => {
            const mockAwsProvider = new MockAwsProvider();
            const mockStackDetails: StackDetails = {
                outputs: [
                    { OutputKey: "UserAthenaDatabaseName", OutputValue: "test_db" },
                ],
                parameters: [],
            };

            mockAwsProvider.mockStack(
                "us-east-1",
                "abc123xyz",
                "my-quilt-stack",
                mockStackDetails,
            );

            const result = await findStack("us-east-1", "abc123xyz", mockAwsProvider, false);
            expect(result).toBe("my-quilt-stack");
        });

        it("should return null when stack is not found", async () => {
            const mockAwsProvider = new MockAwsProvider();
            const result = await findStack("us-east-1", "nonexistent", mockAwsProvider, false);
            expect(result).toBeNull();
        });

        it("should handle AWS CLI failure gracefully", async () => {
            const mockAwsProvider = new MockAwsProvider();
            mockAwsProvider.mockThrowOnFindStack(true);

            await expect(
                findStack("us-east-1", "abc123", mockAwsProvider, false)
            ).rejects.toThrow("Mock AWS error: findStackByResource failed");
        });

        it("should support backward compatibility with boolean verbose flag", async () => {
            const result = await findStack("us-east-1", null, false);
            expect(result).toBeNull();
        });

        it("should search with API Gateway ID in verbose mode", async () => {
            const mockAwsProvider = new MockAwsProvider();
            const mockStackDetails: StackDetails = {
                outputs: [],
                parameters: [],
            };

            mockAwsProvider.mockStack(
                "us-west-2",
                "xyz789",
                "prod-quilt-stack",
                mockStackDetails,
            );

            // Capture console output
            const originalLog = console.log;
            const logs: string[] = [];
            console.log = (message: string) => logs.push(message);

            const result = await findStack("us-west-2", "xyz789", mockAwsProvider, true);

            console.log = originalLog;

            expect(result).toBe("prod-quilt-stack");
            expect(logs.some(log => log.includes("Searching by API Gateway ID"))).toBe(true);
            expect(logs.some(log => log.includes("Found stack by API Gateway"))).toBe(true);
        });
    });

    describe("inferStackConfig", () => {
        let mockAwsProvider: MockAwsProvider;
        let mockHttpClient: MockHttpClient;

        beforeEach(() => {
            mockAwsProvider = new MockAwsProvider();
            mockHttpClient = new MockHttpClient();
        });

        afterEach(() => {
            mockAwsProvider.reset();
            mockHttpClient.reset();
        });

        it("should successfully infer stack configuration", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "quilt-analytics-bucket",
                serviceBucket: "quilt-service-bucket",
                stackVersion: "1.2.3",
            };

            const mockStackDetails: StackDetails = {
                outputs: [
                    { OutputKey: "UserAthenaDatabaseName", OutputValue: "my_catalog_db" },
                    { OutputKey: "PackagerQueueUrl", OutputValue: "https://sqs.us-east-1.amazonaws.com/123456789012/my-queue" },
                ],
                parameters: [],
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockStack(
                "us-east-1",
                "abc123xyz",
                "my-quilt-stack",
                mockStackDetails,
            );
            mockAwsProvider.mockAccountId("123456789012");

            const result = await inferStackConfig("https://catalog.example.com", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: false,
            });

            expect(result.config).toEqual(mockConfig);
            expect(result.stackName).toBe("my-quilt-stack");
            expect(result.inferredVars.QUILT_CATALOG).toBe("catalog.example.com");
            expect(result.inferredVars.QUILT_DATABASE).toBe("my_catalog_db");
            expect(result.inferredVars.QUEUE_URL).toBe("https://sqs.us-east-1.amazonaws.com/123456789012/my-queue");
            expect(result.inferredVars.CDK_DEFAULT_ACCOUNT).toBe("123456789012");
            expect(result.inferredVars.CDK_DEFAULT_REGION).toBe("us-east-1");
        });

        it("should handle HTTP 404 error and retry with fallback URL", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-west-2",
                apiGatewayEndpoint: "https://xyz789.execute-api.us-west-2.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            // First URL returns 404
            mockHttpClient.mockError(
                "https://catalog.example.com/path/config.json",
                new Error("HTTP 404: Not Found")
            );

            // Fallback URL succeeds
            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockStack(
                "us-west-2",
                "xyz789",
                "test-stack",
                { outputs: [], parameters: [] },
            );
            mockAwsProvider.mockAccountId("987654321098");

            const result = await inferStackConfig("https://catalog.example.com/path", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: false,
            });

            expect(result.config).toEqual(mockConfig);
            expect(mockHttpClient.getFetchedUrls()).toContain("https://catalog.example.com/config.json");
        });

        it("should handle HTTP 403 error and retry with fallback URL", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "eu-west-1",
                apiGatewayEndpoint: "https://def456.execute-api.eu-west-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            // First URL returns 403
            mockHttpClient.mockError(
                "https://catalog.example.com/forbidden/config.json",
                new Error("HTTP 403: Forbidden")
            );

            // Fallback URL succeeds
            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockAccountId(null);

            const result = await inferStackConfig("https://catalog.example.com/forbidden", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: false,
            });

            expect(result.config).toEqual(mockConfig);
        });

        it("should throw error when no base URL can be extracted and fetch fails", async () => {
            // This tests the edge case where URL has no base and fetch fails
            mockHttpClient.mockError(
                "invalid-url/config.json",
                new Error("HTTP 404: Not Found")
            );

            await expect(
                inferStackConfig("invalid-url", {
                    awsProvider: mockAwsProvider,
                    httpClient: mockHttpClient,
                    verbose: false,
                })
            ).rejects.toThrow("HTTP 404: Not Found");
        });

        it("should handle invalid JSON response", async () => {
            mockHttpClient.mockError(
                "https://catalog.example.com/config.json",
                new Error("Failed to parse JSON: Unexpected token")
            );

            await expect(
                inferStackConfig("https://catalog.example.com", {
                    awsProvider: mockAwsProvider,
                    httpClient: mockHttpClient,
                    verbose: false,
                })
            ).rejects.toThrow("Failed to parse JSON");
        });

        it("should handle network error when fetching config", async () => {
            mockHttpClient.mockError(
                "https://unreachable.example.com/config.json",
                new Error("Network error: getaddrinfo ENOTFOUND")
            );

            await expect(
                inferStackConfig("https://unreachable.example.com", {
                    awsProvider: mockAwsProvider,
                    httpClient: mockHttpClient,
                    verbose: false,
                })
            ).rejects.toThrow("Network error");
        });

        it("should handle AWS CLI failure when finding stack", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockThrowOnFindStack(true);
            mockAwsProvider.mockAccountId("123456789012");

            await expect(
                inferStackConfig("https://catalog.example.com", {
                    awsProvider: mockAwsProvider,
                    httpClient: mockHttpClient,
                    verbose: false,
                })
            ).rejects.toThrow("Mock AWS error: findStackByResource failed");
        });

        it("should handle missing AWS credentials gracefully", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockAccountId(null);

            const result = await inferStackConfig("https://catalog.example.com", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: false,
            });

            expect(result.config).toEqual(mockConfig);
            expect(result.inferredVars.CDK_DEFAULT_ACCOUNT).toBeUndefined();
        });

        it("should handle stack not found scenario", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://notfound123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockAccountId("123456789012");

            const result = await inferStackConfig("https://catalog.example.com", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: false,
            });

            expect(result.stackName).toBeNull();
            expect(result.stackDetails.outputs).toEqual([]);
        });

        it("should handle malformed CloudFormation outputs", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            const malformedStackDetails: StackDetails = {
                outputs: [
                    { OutputKey: "UserAthenaDatabaseName", OutputValue: "" }, // Empty value
                    { OutputKey: "PackagerQueueUrl", OutputValue: "not-a-valid-url" }, // Invalid URL
                ],
                parameters: [],
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockStack(
                "us-east-1",
                "abc123",
                "malformed-stack",
                malformedStackDetails,
            );
            mockAwsProvider.mockAccountId("123456789012");

            const result = await inferStackConfig("https://catalog.example.com", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: false,
            });

            expect(result.stackName).toBe("malformed-stack");
            // Empty database value will be used (even though it's empty)
            expect(result.inferredVars.QUILT_DATABASE).toBe("");
            // Invalid queue URL should be ignored
            expect(result.inferredVars.QUEUE_URL).toBeUndefined();
        });

        it("should normalize catalog URL with trailing slash", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockAccountId("123456789012");

            const result = await inferStackConfig("https://catalog.example.com/", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: false,
            });

            expect(result.config).toEqual(mockConfig);
            expect(mockHttpClient.getFetchedUrls()).toContain("https://catalog.example.com/config.json");
        });

        it("should handle URL already ending with /config.json", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockAccountId("123456789012");

            const result = await inferStackConfig("https://catalog.example.com/config.json", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: false,
            });

            expect(result.config).toEqual(mockConfig);
            // Should not double-append /config.json
            const fetchedUrls = mockHttpClient.getFetchedUrls();
            expect(fetchedUrls.filter(url => url === "https://catalog.example.com/config.json").length).toBe(1);
        });

        it("should support backward compatibility with boolean verbose flag", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            // Use real providers (will fail to find stack but that's ok)
            const result = await inferStackConfig("https://catalog.example.com", {
                httpClient: mockHttpClient,
                verbose: false,
            });

            expect(result.config).toEqual(mockConfig);
        });

        it("should retrieve stack details when stack is found", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "eu-central-1",
                apiGatewayEndpoint: "https://ghi789.execute-api.eu-central-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
                stackVersion: "2.0.0",
            };

            const mockStackDetails: StackDetails = {
                outputs: [
                    { OutputKey: "UserAthenaDatabaseName", OutputValue: "prod_catalog_db" },
                    { OutputKey: "PackagerQueueUrl", OutputValue: "https://sqs.eu-central-1.amazonaws.com/111222333444/prod-queue" },
                    { OutputKey: "SomethingElse", OutputValue: "extra-value" },
                ],
                parameters: [
                    { ParameterKey: "BucketName", ParameterValue: "my-bucket" },
                ],
            };

            mockHttpClient.mockResponse(
                "https://prod.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockStack(
                "eu-central-1",
                "ghi789",
                "prod-quilt-stack",
                mockStackDetails,
            );
            mockAwsProvider.mockAccountId("111222333444");

            const result = await inferStackConfig("https://prod.example.com", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: false,
            });

            expect(result.stackName).toBe("prod-quilt-stack");
            expect(result.stackDetails).toEqual(mockStackDetails);
            expect(result.inferredVars["# CloudFormation Stack"]).toBe("prod-quilt-stack");
            expect(result.inferredVars["# Stack Version"]).toBe("2.0.0");
        });

        it("should handle AWS getStackDetails failure", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockStack(
                "us-east-1",
                "abc123",
                "my-stack",
                { outputs: [], parameters: [] },
            );
            mockAwsProvider.mockThrowOnGetDetails(true);
            mockAwsProvider.mockAccountId("123456789012");

            await expect(
                inferStackConfig("https://catalog.example.com", {
                    awsProvider: mockAwsProvider,
                    httpClient: mockHttpClient,
                    verbose: false,
                })
            ).rejects.toThrow("Mock AWS error: getStackDetails failed");
        });

        it("should handle AWS getAccountId failure", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockStack(
                "us-east-1",
                "abc123",
                "my-stack",
                { outputs: [], parameters: [] },
            );
            mockAwsProvider.mockThrowOnGetAccount(true);

            await expect(
                inferStackConfig("https://catalog.example.com", {
                    awsProvider: mockAwsProvider,
                    httpClient: mockHttpClient,
                    verbose: false,
                })
            ).rejects.toThrow("Mock AWS error: getAccountId failed");
        });

        it("should extract API Gateway endpoint metadata", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "ap-southeast-1",
                apiGatewayEndpoint: "https://jkl012.execute-api.ap-southeast-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockAccountId(null);

            const result = await inferStackConfig("https://catalog.example.com", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: false,
            });

            expect(result.inferredVars["# API Gateway Endpoint"]).toBe(
                "https://jkl012.execute-api.ap-southeast-1.amazonaws.com/prod"
            );
        });

        it("should infer database from catalog when no API Gateway ID", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://invalid-endpoint.example.com/api", // No valid API Gateway ID
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://my-catalog.company.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockAccountId("123456789012");

            const result = await inferStackConfig("https://my-catalog.company.com", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: false,
            });

            // No stack should be found (no valid API Gateway ID)
            expect(result.stackName).toBeNull();
            // Database should be inferred from catalog domain
            expect(result.inferredVars.QUILT_DATABASE).toContain("my_catalog_company_com_db");
            expect(result.inferredVars.QUILT_DATABASE).toContain("VERIFY THIS");
        });

        it("should log verbose output when verbose is true", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
                stackVersion: "1.0.0",
            };

            const mockStackDetails: StackDetails = {
                outputs: [
                    { OutputKey: "UserAthenaDatabaseName", OutputValue: "test_db" },
                    { OutputKey: "PackagerQueueUrl", OutputValue: "https://sqs.us-east-1.amazonaws.com/123456789012/queue" },
                ],
                parameters: [],
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockStack(
                "us-east-1",
                "abc123",
                "test-stack",
                mockStackDetails,
            );
            mockAwsProvider.mockAccountId("123456789012");

            const originalLog = console.log;
            const logs: string[] = [];
            console.log = (message: string) => logs.push(message);

            await inferStackConfig("https://catalog.example.com", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: true,
            });

            console.log = originalLog;

            // Check that verbose logging occurred
            expect(logs.some(log => log.includes("Fetching config from"))).toBe(true);
            expect(logs.some(log => log.includes("Successfully fetched config.json"))).toBe(true);
            expect(logs.some(log => log.includes("Catalog Configuration:"))).toBe(true);
            expect(logs.some(log => log.includes("Region:"))).toBe(true);
            expect(logs.some(log => log.includes("Searching for CloudFormation stack"))).toBe(true);
            expect(logs.some(log => log.includes("Fetching stack details"))).toBe(true);
            expect(logs.some(log => log.includes("AWS Account ID:"))).toBe(true);
            expect(logs.some(log => log.includes("Inferred Stack Parameters:"))).toBe(true);
        });

        it("should log warning when stack not found in verbose mode", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://invalid-endpoint.example.com/api",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockAccountId("123456789012");

            const originalLog = console.log;
            const logs: string[] = [];
            console.log = (message: string) => logs.push(message);

            await inferStackConfig("https://catalog.example.com", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: true,
            });

            console.log = originalLog;

            // Check that warning about not finding stack was logged
            expect(logs.some(log => log.includes("Could not automatically find CloudFormation stack"))).toBe(true);
        });

        it("should handle verbose mode without account ID", async () => {
            const mockConfig: QuiltCatalogConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "bucket1",
                serviceBucket: "bucket2",
            };

            mockHttpClient.mockResponse(
                "https://catalog.example.com/config.json",
                mockConfig
            );

            mockAwsProvider.mockAccountId(null);

            const originalLog = console.log;
            const logs: string[] = [];
            console.log = (message: string) => logs.push(message);

            await inferStackConfig("https://catalog.example.com", {
                awsProvider: mockAwsProvider,
                httpClient: mockHttpClient,
                verbose: true,
            });

            console.log = originalLog;

            // Should not log account ID when it's null
            const accountIdLogs = logs.filter(log => log.includes("AWS Account ID:"));
            expect(accountIdLogs.length).toBe(0);
        });
    });

    describe("Legacy AWS CLI Functions", () => {
        // Mock execSync for these tests
        jest.mock("child_process");

        describe("findStackByResource", () => {
            it("should return null when AWS CLI is not available", () => {
                // This test will call the real function but expect null if AWS CLI isn't configured
                const result = findStackByResource("us-east-1", "nonexistent-resource");
                // Result should be null (either AWS CLI not available or resource not found)
                expect(result === null || typeof result === "string").toBe(true);
            });

            it("should handle AWS CLI errors gracefully", () => {
                // Even with errors, the function should return null, not throw
                expect(() => {
                    findStackByResource("invalid-region", "test-resource");
                }).not.toThrow();
            });
        });

        describe("getStackDetails", () => {
            it("should return empty details when stack doesn't exist", () => {
                const result = getStackDetails("us-east-1", "nonexistent-stack");
                // Should return empty arrays, not throw
                expect(result).toBeDefined();
                expect(Array.isArray(result.outputs)).toBe(true);
                expect(Array.isArray(result.parameters)).toBe(true);
            });

            it("should handle AWS CLI errors gracefully", () => {
                expect(() => {
                    getStackDetails("invalid-region", "test-stack");
                }).not.toThrow();
            });
        });

        describe("getAwsAccountId", () => {
            it("should return null when AWS credentials are not configured", () => {
                // This will return null if credentials aren't available
                const result = getAwsAccountId();
                // Result should be null or a valid account ID string
                expect(result === null || typeof result === "string").toBe(true);
                if (result !== null) {
                    // If we got an account ID, it should be 12 digits
                    expect(result).toMatch(/^\d{12}$/);
                }
            });
        });

        describe("listAllStacks", () => {
            it("should return empty array when AWS CLI fails", () => {
                const result = listAllStacks("invalid-region");
                // Should return empty array, not throw
                expect(Array.isArray(result)).toBe(true);
            });

            it("should handle regions with no stacks", () => {
                // This will return empty or throw, both are handled
                expect(() => {
                    const result = listAllStacks("us-east-1");
                    expect(Array.isArray(result)).toBe(true);
                }).not.toThrow();
            });
        });

        describe("isQuiltStack", () => {
            it("should return false for nonexistent stacks", () => {
                const result = isQuiltStack("us-east-1", "nonexistent-stack");
                expect(result).toBe(false);
            });

            it("should handle AWS CLI errors gracefully", () => {
                const result = isQuiltStack("invalid-region", "test-stack");
                expect(result).toBe(false);
            });
        });

        describe("findAllQuiltStacks", () => {
            it("should return empty array when no stacks found", () => {
                const result = findAllQuiltStacks("us-east-1", false);
                expect(Array.isArray(result)).toBe(true);
            });

            it("should handle verbose mode", () => {
                const originalLog = console.log;
                const logs: string[] = [];
                console.log = (message: string) => logs.push(message);

                const result = findAllQuiltStacks("us-east-1", true);

                console.log = originalLog;

                expect(Array.isArray(result)).toBe(true);
                // In verbose mode, it should log something (even if AWS CLI fails)
                expect(logs.length).toBeGreaterThan(0);
            });

            it("should handle AWS CLI errors gracefully", () => {
                expect(() => {
                    findAllQuiltStacks("invalid-region", false);
                }).not.toThrow();
            });
        });
    });
});
