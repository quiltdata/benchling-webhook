import { jest } from "@jest/globals";
import { execSync } from "child_process";
import { CloudFormationClient, DescribeStacksCommand, ListStacksCommand, ListStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import { mockClient } from "aws-sdk-client-mock";
import { inferQuiltConfig } from "../bin/commands/infer-quilt-config";
import * as stackInference from "../lib/utils/stack-inference";

// Mock child_process
jest.mock("child_process");
const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

// Mock fetchJson from stack-inference
jest.mock("../lib/utils/stack-inference", () => {
    const actual = jest.requireActual("../lib/utils/stack-inference") as typeof stackInference;
    return {
        ...actual,
        fetchJson: jest.fn(),
    };
});
const mockedFetchJson = stackInference.fetchJson as jest.MockedFunction<typeof stackInference.fetchJson>;

// Mock readline
jest.mock("readline", () => ({
    createInterface: jest.fn(() => ({
        question: jest.fn((prompt: string, callback: (answer: string) => void) => {
            callback("1"); // Always select first option in tests
        }),
        close: jest.fn(),
    })),
}));

const cfMock = mockClient(CloudFormationClient);

describe("infer-quilt-config", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cfMock.reset();
        mockedFetchJson.mockReset();

        // Default mock for ListStackResourcesCommand - returns empty resources
        cfMock.on(ListStackResourcesCommand).resolves({ StackResourceSummaries: [] });
    });

    describe("inferQuiltConfig - quilt3 CLI detection", () => {
        it("should detect catalog from quilt3 config command", async () => {
            mockedExecSync.mockReturnValue("https://nightly.quilttest.com\n" as any);

            cfMock.on(ListStacksCommand).resolves({ StackSummaries: [] });

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            expect(result.catalog).toBe("https://nightly.quilttest.com");
            expect(result.source).toBe("quilt3-cli");
        });

        it("should handle quilt3 command not available", async () => {
            mockedExecSync.mockImplementation(() => {
                throw new Error("Command not found");
            });

            cfMock.on(ListStacksCommand).resolves({ StackSummaries: [] });

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            expect(result.catalog).toBeUndefined();
            expect(result.source).toBe("none");
        });

        it("should handle invalid quilt3 output", async () => {
            mockedExecSync.mockReturnValue("not-a-url\n" as any);

            cfMock.on(ListStacksCommand).resolves({ StackSummaries: [] });

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            expect(result.catalog).toBeUndefined();
            expect(result.source).toBe("none");
        });
    });

    describe("inferQuiltConfig - CloudFormation stack detection", () => {
        it("should find and use single stack", async () => {
            mockedExecSync.mockImplementation(() => {
                throw new Error("No quilt3");
            });

            cfMock.on(ListStacksCommand).resolves({
                StackSummaries: [
                    {
                        StackName: "quilt-staging",
                        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-staging/abc-123",
                        StackStatus: "CREATE_COMPLETE",
                        CreationTime: new Date(),
                    },
                ],
            });

            cfMock.on(DescribeStacksCommand).resolves({
                Stacks: [
                    {
                        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-staging/abc-123",
                        StackName: "quilt-staging",
                        StackStatus: "CREATE_COMPLETE",
                        CreationTime: new Date(),
                        Outputs: [
                            { OutputKey: "UserBucket", OutputValue: "my-bucket" },
                            { OutputKey: "PackagerQueueUrl", OutputValue: "https://sqs.us-east-1.amazonaws.com/123456789012/my-queue" },
                            { OutputKey: "QuiltWebHost", OutputValue: "https://catalog.example.com" },
                        ],
                    },
                ],
            });

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            expect(result.stackArn).toBe("arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-staging/abc-123");
            expect(result.account).toBe("123456789012");
            expect(result.queueUrl).toBe("https://sqs.us-east-1.amazonaws.com/123456789012/my-queue");
            expect(result.catalog).toBe("https://catalog.example.com");
            expect(result.region).toBe("us-east-1");
            expect(result.source).toBe("cloudformation");
        });

        it("should filter for Quilt stacks only", async () => {
            mockedExecSync.mockImplementation(() => {
                throw new Error("No quilt3");
            });

            cfMock.on(ListStacksCommand).resolves({
                StackSummaries: [
                    { StackName: "random-stack", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                    { StackName: "quilt-production", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                    { StackName: "another-stack", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                ],
            });

            // Mock random-stack - NOT a Quilt stack (no QuiltWebHost output)
            cfMock.on(DescribeStacksCommand, { StackName: "random-stack" }).resolves({
                Stacks: [
                    {
                        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/random-stack/abc-123",
                        StackName: "random-stack",
                        StackStatus: "CREATE_COMPLETE",
                        CreationTime: new Date(),
                        Outputs: [
                            { OutputKey: "SomeOtherOutput", OutputValue: "value" },
                        ],
                    },
                ],
            });

            // Mock quilt-production - IS a Quilt stack (has QuiltWebHost output)
            cfMock.on(DescribeStacksCommand, { StackName: "quilt-production" }).resolves({
                Stacks: [
                    {
                        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-production/xyz-789",
                        StackName: "quilt-production",
                        StackStatus: "CREATE_COMPLETE",
                        CreationTime: new Date(),
                        Outputs: [
                            { OutputKey: "QuiltWebHost", OutputValue: "https://production.example.com" },
                        ],
                    },
                ],
            });

            // Mock another-stack - NOT a Quilt stack (no QuiltWebHost output)
            cfMock.on(DescribeStacksCommand, { StackName: "another-stack" }).resolves({
                Stacks: [
                    {
                        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/another-stack/def-456",
                        StackName: "another-stack",
                        StackStatus: "CREATE_COMPLETE",
                        CreationTime: new Date(),
                        Outputs: [
                            { OutputKey: "AnotherOutput", OutputValue: "value" },
                        ],
                    },
                ],
            });

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            // Should only find 1 Quilt stack (quilt-production), so no error in non-interactive mode
            expect(result.stackArn).toBeDefined();
            expect(result.account).toBe("123456789012");
            expect(result.source).toBe("cloudformation");
        });

        it("should find Quilt stacks without 'quilt' in the name", async () => {
            mockedExecSync.mockImplementation(() => {
                throw new Error("No quilt3");
            });

            cfMock.on(ListStacksCommand).resolves({
                StackSummaries: [
                    { StackName: "random-stack", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                    { StackName: "sales-prod", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                    { StackName: "another-stack", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                ],
            });

            // Mock random-stack (no QuiltWebHost)
            cfMock
                .on(DescribeStacksCommand, { StackName: "random-stack" })
                .resolves({
                    Stacks: [
                        {
                            StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/random-stack/abc-123",
                            StackName: "random-stack",
                            StackStatus: "CREATE_COMPLETE",
                            CreationTime: new Date(),
                            Outputs: [{ OutputKey: "SomeOtherOutput", OutputValue: "value" }],
                        },
                    ],
                });

            // Mock sales-prod (has QuiltWebHost)
            cfMock
                .on(DescribeStacksCommand, { StackName: "sales-prod" })
                .resolves({
                    Stacks: [
                        {
                            StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/sales-prod/xyz-789",
                            StackName: "sales-prod",
                            StackStatus: "CREATE_COMPLETE",
                            CreationTime: new Date(),
                            Outputs: [
                                { OutputKey: "QuiltWebHost", OutputValue: "https://sales.example.com" },
                                { OutputKey: "UserAthenaDatabaseName", OutputValue: "sales_db" },
                            ],
                        },
                    ],
                });

            // Mock another-stack (no QuiltWebHost)
            cfMock
                .on(DescribeStacksCommand, { StackName: "another-stack" })
                .resolves({
                    Stacks: [
                        {
                            StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/another-stack/def-456",
                            StackName: "another-stack",
                            StackStatus: "CREATE_COMPLETE",
                            CreationTime: new Date(),
                            Outputs: [],
                        },
                    ],
                });

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            expect(result.stackArn).toContain("sales-prod");
            expect(result.catalog).toBe("https://sales.example.com");
            expect(result.database).toBe("sales_db");
            expect(result.account).toBe("123456789012");
            expect(result.source).toBe("cloudformation");
        });

        it("should extract AWS account ID from stack ARN", async () => {
            mockedExecSync.mockImplementation(() => {
                throw new Error("No quilt3");
            });

            cfMock.on(ListStacksCommand).resolves({
                StackSummaries: [
                    {
                        StackName: "quilt-test",
                        StackId: "arn:aws:cloudformation:us-west-2:999888777666:stack/quilt-test/abc-123",
                        StackStatus: "CREATE_COMPLETE",
                        CreationTime: new Date(),
                    },
                ],
            });

            cfMock.on(DescribeStacksCommand).resolves({
                Stacks: [
                    {
                        StackId: "arn:aws:cloudformation:us-west-2:999888777666:stack/quilt-test/abc-123",
                        StackName: "quilt-test",
                        StackStatus: "CREATE_COMPLETE",
                        CreationTime: new Date(),
                        Outputs: [
                            { OutputKey: "QuiltWebHost", OutputValue: "https://test.quiltdata.com" },
                        ],
                    },
                ],
            });

            const result = await inferQuiltConfig({
                region: "us-west-2",
                interactive: false,
            });

            expect(result.account).toBe("999888777666");
            expect(result.region).toBe("us-west-2");
            expect(result.stackArn).toBe("arn:aws:cloudformation:us-west-2:999888777666:stack/quilt-test/abc-123");
        });
    });

    describe("inferQuiltConfig - auto-matching catalog to stack", () => {
        it("should auto-select stack matching quilt3 catalog URL", async () => {
            mockedExecSync.mockReturnValue("https://nightly.quilttest.com\n" as any);

            cfMock.on(ListStacksCommand).resolves({
                StackSummaries: [
                    { StackName: "quilt-staging", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                    { StackName: "quilt-production", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                ],
            });

            // First describe call for quilt-staging
            cfMock
                .on(DescribeStacksCommand, { StackName: "quilt-staging" })
                .resolves({
                    Stacks: [
                        {
                            StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-staging/abc-123",
                            StackName: "quilt-staging",
                            StackStatus: "CREATE_COMPLETE",
                            CreationTime: new Date(),
                            Outputs: [
                                { OutputKey: "QuiltWebHost", OutputValue: "https://staging.example.com" },
                                { OutputKey: "UserBucket", OutputValue: "staging-bucket" },
                            ],
                        },
                    ],
                });

            // Second describe call for quilt-production
            cfMock
                .on(DescribeStacksCommand, { StackName: "quilt-production" })
                .resolves({
                    Stacks: [
                        {
                            StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-production/xyz-789",
                            StackName: "quilt-production",
                            StackStatus: "CREATE_COMPLETE",
                            CreationTime: new Date(),
                            Outputs: [
                                { OutputKey: "QuiltWebHost", OutputValue: "https://nightly.quilttest.com" },
                                { OutputKey: "UserBucket", OutputValue: "production-bucket" },
                            ],
                        },
                    ],
                });

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: true,
                yes: true, // Skip confirmation prompt for auto-selected stack
            });

            // Should auto-select quilt-production because it matches quilt3 catalog
            expect(result.catalog).toBe("https://nightly.quilttest.com");
            expect(result.stackArn).toContain("quilt-production");
            expect(result.source).toBe("quilt3-cli+cloudformation");
        });

        it("should prompt user if no stack matches quilt3 catalog", async () => {
            mockedExecSync.mockReturnValue("https://unknown-catalog.com\n" as any);

            cfMock.on(ListStacksCommand).resolves({
                StackSummaries: [
                    { StackName: "quilt-staging", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                    { StackName: "quilt-production", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                ],
            });

            cfMock.on(DescribeStacksCommand).resolves({
                Stacks: [
                    {
                        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-staging/abc-123",
                        StackName: "quilt-staging",
                        StackStatus: "CREATE_COMPLETE",
                        CreationTime: new Date(),
                        Outputs: [{ OutputKey: "QuiltWebHost", OutputValue: "https://staging.example.com" }],
                    },
                ],
            });

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: true,
            });

            // Should have selected first option (mocked to always select 1)
            expect(result.stackArn).toBeDefined();
            expect(result.source).toBe("quilt3-cli+cloudformation");
        });
    });

    describe("inferQuiltConfig - non-interactive mode", () => {
        it("should fail when multiple stacks exist in non-interactive mode", async () => {
            mockedExecSync.mockImplementation(() => {
                throw new Error("No quilt3");
            });

            cfMock.on(ListStacksCommand).resolves({
                StackSummaries: [
                    { StackName: "quilt-stack-1", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                    { StackName: "quilt-stack-2", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                ],
            });

            // Mock DescribeStacksCommand to return stacks with QuiltWebHost (so they're detected as Quilt stacks)
            cfMock.on(DescribeStacksCommand).resolves({
                Stacks: [
                    {
                        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-stack-1/abc-123",
                        StackName: "quilt-stack-1",
                        StackStatus: "CREATE_COMPLETE",
                        CreationTime: new Date(),
                        Outputs: [{ OutputKey: "QuiltWebHost", OutputValue: "https://quilt1.example.com" }],
                    },
                ],
            });

            // Should fail because there are multiple stacks but no way to determine which to use
            await expect(
                inferQuiltConfig({
                    region: "us-east-1",
                    interactive: false,
                })
            ).rejects.toThrow(/multiple.*stack|cannot determine|ambiguous/i);
        });
    });

    describe("inferQuiltConfig - config.json region detection (THE CRITICAL FIX)", () => {
        it("should fetch config.json and use region from catalog when catalog provided", async () => {
            // Step 1: quilt3 returns catalog URL
            mockedExecSync.mockReturnValue("https://bench.dev.quilttest.com\n" as any);

            // Step 2: config.json returns region us-east-2
            mockedFetchJson.mockResolvedValue({
                region: "us-east-2",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-2.amazonaws.com/prod",
                analyticsBucket: "bench-analytics",
                serviceBucket: "bench-service",
            });

            // Step 3: CloudFormation search happens in us-east-2 (not us-east-1!)
            cfMock.on(ListStacksCommand).resolves({
                StackSummaries: [
                    {
                        StackName: "quilt-bench",
                        StackId: "arn:aws:cloudformation:us-east-2:712023778557:stack/quilt-bench/xyz-789",
                        StackStatus: "CREATE_COMPLETE",
                        CreationTime: new Date(),
                    },
                ],
            });

            cfMock.on(DescribeStacksCommand).resolves({
                Stacks: [
                    {
                        StackId: "arn:aws:cloudformation:us-east-2:712023778557:stack/quilt-bench/xyz-789",
                        StackName: "quilt-bench",
                        StackStatus: "CREATE_COMPLETE",
                        CreationTime: new Date(),
                        Outputs: [
                            { OutputKey: "QuiltWebHost", OutputValue: "https://bench.dev.quilttest.com" },
                            { OutputKey: "PackagerQueueUrl", OutputValue: "https://sqs.us-east-2.amazonaws.com/712023778557/bench-queue" },
                        ],
                    },
                ],
            });

            const result = await inferQuiltConfig({
                // NO region specified - should fetch from config.json
                interactive: false,
            });

            // Verify config.json was fetched
            expect(mockedFetchJson).toHaveBeenCalledWith("https://bench.dev.quilttest.com/config.json");

            // Verify region from config.json was used
            expect(result.region).toBe("us-east-2");
            expect(result.stackArn).toContain("us-east-2");
            expect(result.stackArn).toContain("quilt-bench");
            expect(result.account).toBe("712023778557");
            expect(result.catalog).toBe("https://bench.dev.quilttest.com");
        });

        it("should fail when config.json lacks region field", async () => {
            mockedExecSync.mockReturnValue("https://old-catalog.com\n" as any);

            // config.json exists but has no region field (old catalog - should fail)
            mockedFetchJson.mockResolvedValue({
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                // No region field!
            });

            // Should throw error before attempting CloudFormation calls
            await expect(
                inferQuiltConfig({
                    interactive: false,
                })
            ).rejects.toThrow(/config\.json.*region|region.*config\.json/i);

            // Should have fetched config.json
            expect(mockedFetchJson).toHaveBeenCalled();
        });

        it("should match stack to catalog URL after fetching config.json", async () => {
            // The complete flow: quilt3 -> config.json -> find stack in correct region
            mockedExecSync.mockReturnValue("https://stable.quilttest.com\n" as any);

            mockedFetchJson.mockResolvedValue({
                region: "us-east-2",
                apiGatewayEndpoint: "https://xyz789.execute-api.us-east-2.amazonaws.com/prod",
            });

            cfMock.on(ListStacksCommand).resolves({
                StackSummaries: [
                    { StackName: "tf-stable", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                    { StackName: "tf-dev-bench", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                ],
            });

            // tf-stable has matching catalog URL
            cfMock
                .on(DescribeStacksCommand, { StackName: "tf-stable" })
                .resolves({
                    Stacks: [
                        {
                            StackId: "arn:aws:cloudformation:us-east-2:712023778557:stack/tf-stable/stable-123",
                            StackName: "tf-stable",
                            StackStatus: "CREATE_COMPLETE",
                            CreationTime: new Date(),
                            Outputs: [
                                { OutputKey: "QuiltWebHost", OutputValue: "https://stable.quilttest.com" },
                                { OutputKey: "UserAthenaDatabaseName", OutputValue: "stable_db" },
                            ],
                        },
                    ],
                });

            // tf-dev-bench has different catalog URL
            cfMock
                .on(DescribeStacksCommand, { StackName: "tf-dev-bench" })
                .resolves({
                    Stacks: [
                        {
                            StackId: "arn:aws:cloudformation:us-east-2:712023778557:stack/tf-dev-bench/bench-456",
                            StackName: "tf-dev-bench",
                            StackStatus: "CREATE_COMPLETE",
                            CreationTime: new Date(),
                            Outputs: [
                                { OutputKey: "QuiltWebHost", OutputValue: "https://bench.dev.quilttest.com" },
                            ],
                        },
                    ],
                });

            const result = await inferQuiltConfig({
                interactive: true, // Would normally prompt, but should auto-match
            });

            // Should auto-select tf-stable because it matches the catalog URL
            expect(result.catalog).toBe("https://stable.quilttest.com");
            expect(result.stackArn).toContain("tf-stable");
            expect(result.region).toBe("us-east-2");
            expect(result.database).toBe("stable_db");
        });
    });

});
