import { jest } from "@jest/globals";
import { execSync } from "child_process";
import { CloudFormationClient, DescribeStacksCommand, ListStacksCommand } from "@aws-sdk/client-cloudformation";
import { mockClient } from "aws-sdk-client-mock";
import { inferQuiltConfig, inferenceResultToDerivedConfig } from "../scripts/infer-quilt-config";

// Mock child_process
jest.mock("child_process");
const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

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
    });

    describe("inferQuiltConfig - quilt3 CLI detection", () => {
        it("should detect catalog from quilt3 config command", async () => {
            mockedExecSync.mockReturnValue("https://nightly.quilttest.com\n" as any);

            cfMock.on(ListStacksCommand).resolves({ StackSummaries: [] });

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            expect(result.catalogUrl).toBe("https://nightly.quilttest.com");
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

            expect(result.catalogUrl).toBeUndefined();
            expect(result.source).toBe("none");
        });

        it("should handle invalid quilt3 output", async () => {
            mockedExecSync.mockReturnValue("not-a-url\n" as any);

            cfMock.on(ListStacksCommand).resolves({ StackSummaries: [] });

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            expect(result.catalogUrl).toBeUndefined();
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
                            { OutputKey: "PackagerQueueArn", OutputValue: "arn:aws:sqs:us-east-1:123456789012:my-queue" },
                            { OutputKey: "QuiltWebHost", OutputValue: "https://catalog.example.com" },
                        ],
                    },
                ],
            });

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            expect(result.quiltStackArn).toBe("arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-staging/abc-123");
            expect(result.quiltUserBucket).toBe("my-bucket");
            expect(result.queueArn).toBe("arn:aws:sqs:us-east-1:123456789012:my-queue");
            expect(result.catalogUrl).toBe("https://catalog.example.com");
            expect(result.quiltRegion).toBe("us-east-1");
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

            cfMock.on(DescribeStacksCommand).resolves({
                Stacks: [
                    {
                        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-production/xyz-789",
                        StackName: "quilt-production",
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

            expect(result.quiltStackArn).toBeDefined();
            expect(result.source).toBe("cloudformation");
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
                interactive: true, // Interactive mode but should auto-select
            });

            // Should auto-select quilt-production because it matches quilt3 catalog
            expect(result.catalogUrl).toBe("https://nightly.quilttest.com");
            expect(result.quiltUserBucket).toBe("production-bucket");
            expect(result.quiltStackArn).toContain("quilt-production");
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
            expect(result.quiltStackArn).toBeDefined();
            expect(result.source).toBe("quilt3-cli+cloudformation");
        });

        it("should handle single stack with quilt3 catalog URL", async () => {
            mockedExecSync.mockReturnValue("https://nightly.quilttest.com\n" as any);

            cfMock.on(ListStacksCommand).resolves({
                StackSummaries: [{ StackName: "quilt-staging", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() }],
            });

            cfMock.on(DescribeStacksCommand).resolves({
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

            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            // Should use the single stack even though catalog URLs don't match
            expect(result.catalogUrl).toBe("https://nightly.quilttest.com"); // Prefers quilt3 CLI
            expect(result.quiltUserBucket).toBe("staging-bucket");
            expect(result.source).toBe("quilt3-cli+cloudformation");
        });
    });

    describe("inferQuiltConfig - non-interactive mode", () => {
        it("should select first stack in non-interactive mode", async () => {
            mockedExecSync.mockImplementation(() => {
                throw new Error("No quilt3");
            });

            cfMock.on(ListStacksCommand).resolves({
                StackSummaries: [
                    { StackName: "quilt-stack-1", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                    { StackName: "quilt-stack-2", StackStatus: "CREATE_COMPLETE", CreationTime: new Date() },
                ],
            });

            cfMock.on(DescribeStacksCommand).resolves({
                Stacks: [
                    {
                        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-stack-1/abc-123",
                        StackName: "quilt-stack-1",
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

            expect(result.quiltStackArn).toContain("quilt-stack-1");
        });
    });

    describe("inferenceResultToDerivedConfig", () => {
        it("should convert inference result to DerivedConfig", () => {
            const inferenceResult = {
                catalogUrl: "https://catalog.example.com",
                quiltUserBucket: "my-bucket",
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/abc-123",
                quiltRegion: "us-east-1",
                queueArn: "arn:aws:sqs:us-east-1:123456789012:my-queue",
                source: "quilt3-cli+cloudformation",
            };

            const config = inferenceResultToDerivedConfig(inferenceResult);

            expect(config.catalogUrl).toBe("https://catalog.example.com");
            expect(config.quiltCatalog).toBe("https://catalog.example.com");
            expect(config.quiltUserBucket).toBe("my-bucket");
            expect(config.quiltStackArn).toBe("arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/abc-123");
            expect(config.quiltRegion).toBe("us-east-1");
            expect(config.queueArn).toBe("arn:aws:sqs:us-east-1:123456789012:my-queue");
            expect(config._metadata?.inferredFrom).toBe("quilt3-cli+cloudformation");
            expect(config._metadata?.source).toBe("infer-quilt-config");
            expect(config._metadata?.version).toBe("0.6.0");
        });

        it("should handle minimal inference result", () => {
            const inferenceResult = {
                source: "none",
            };

            const config = inferenceResultToDerivedConfig(inferenceResult);

            expect(config.catalogUrl).toBeUndefined();
            expect(config.quiltUserBucket).toBeUndefined();
            expect(config._metadata?.inferredFrom).toBe("none");
        });
    });
});
