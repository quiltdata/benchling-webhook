/**
 * Tests for Service Resolver (Episode 2)
 *
 * Tests deployment-time service resolution from CloudFormation stack outputs.
 */

import {
    CloudFormationClient,
    DescribeStacksCommand,
    type Stack,
} from "@aws-sdk/client-cloudformation";
import { mockClient } from "aws-sdk-client-mock";
import {
    resolveQuiltServices,
    parseStackArn,
    normalizeCatalogUrl,
    validateQueueUrl,
    ServiceResolverError,
} from "../../lib/utils/service-resolver";

const cfnMock = mockClient(CloudFormationClient);

// Helper function to create mock stack responses
function mockStack(
    outputs: Array<{ OutputKey: string; OutputValue: string }>,
): Stack {
    return {
        StackName: "QuiltStack",
        CreationTime: new Date(),
        StackStatus: "CREATE_COMPLETE",
        Outputs: outputs,
    };
}

describe("parseStackArn", () => {
    test("parses valid stack ARN", () => {
        const arn =
            "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123-def-456";
        const parsed = parseStackArn(arn);

        expect(parsed.region).toBe("us-east-1");
        expect(parsed.account).toBe("123456789012");
        expect(parsed.stackName).toBe("QuiltStack");
        expect(parsed.stackId).toBe("abc-123-def-456");
    });

    test("throws error for invalid ARN format", () => {
        expect(() => parseStackArn("invalid-arn")).toThrow(
            ServiceResolverError,
        );
        expect(() => parseStackArn("invalid-arn")).toThrow(
            /Invalid CloudFormation stack ARN format/,
        );
    });

    test("throws error for non-CloudFormation ARN", () => {
        const s3Arn = "arn:aws:s3:::my-bucket";
        expect(() => parseStackArn(s3Arn)).toThrow(ServiceResolverError);
    });
});

describe("normalizeCatalogUrl", () => {
    test("removes https:// protocol", () => {
        expect(normalizeCatalogUrl("https://quilt.example.com")).toBe(
            "quilt.example.com",
        );
    });

    test("removes http:// protocol", () => {
        expect(normalizeCatalogUrl("http://quilt.example.com")).toBe(
            "quilt.example.com",
        );
    });

    test("removes trailing slash", () => {
        expect(normalizeCatalogUrl("quilt.example.com/")).toBe(
            "quilt.example.com",
        );
    });

    test("removes protocol and trailing slash", () => {
        expect(normalizeCatalogUrl("https://quilt.example.com/")).toBe(
            "quilt.example.com",
        );
    });

    test("handles plain hostname", () => {
        expect(normalizeCatalogUrl("quilt.example.com")).toBe(
            "quilt.example.com",
        );
    });
});

describe("validateQueueUrl", () => {
    test("validates correct SQS queue URL", () => {
        const url =
            "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-packager-queue";
        expect(validateQueueUrl(url)).toBe(true);
    });

    test("validates queue URL with hyphens in name", () => {
        const url =
            "https://sqs.us-west-2.amazonaws.com/987654321012/my-test-queue-123";
        expect(validateQueueUrl(url)).toBe(true);
    });

    test("throws error for invalid queue URL", () => {
        expect(() => validateQueueUrl("invalid-url")).toThrow(
            ServiceResolverError,
        );
        expect(() => validateQueueUrl("invalid-url")).toThrow(
            /Invalid SQS queue URL format/,
        );
    });

    test("throws error for http (not https)", () => {
        const url = "http://sqs.us-east-1.amazonaws.com/123456789012/queue";
        expect(() => validateQueueUrl(url)).toThrow(ServiceResolverError);
    });

    test("throws error for missing account ID", () => {
        const url = "https://sqs.us-east-1.amazonaws.com/queue";
        expect(() => validateQueueUrl(url)).toThrow(ServiceResolverError);
    });
});

describe("resolveQuiltServices", () => {
    beforeEach(() => {
        cfnMock.reset();
    });

    test("resolves all required services from stack outputs", async () => {
        cfnMock.on(DescribeStacksCommand).resolves({
            Stacks: [
                mockStack([
                    {
                        OutputKey: "PackagerQueueUrl",
                        OutputValue:
                            "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-queue",
                    },
                    {
                        OutputKey: "UserAthenaDatabaseName",
                        OutputValue: "quilt_catalog",
                    },
                    {
                        OutputKey: "QuiltWebHost",
                        OutputValue: "quilt.example.com",
                    },
                ]),
            ],
        });

        const services = await resolveQuiltServices({
            stackArn:
                "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/id",
            mockCloudFormation: cfnMock as unknown as CloudFormationClient,
        });

        expect(services).toEqual({
            packagerQueueUrl:
                "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-queue",
            athenaUserDatabase: "quilt_catalog",
            quiltWebHost: "quilt.example.com",
        });
    });

    test("normalizes catalog URL from QuiltWebHost output", async () => {
        cfnMock.on(DescribeStacksCommand).resolves({
            Stacks: [
                mockStack([
                    {
                        OutputKey: "PackagerQueueUrl",
                        OutputValue:
                            "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
                    },
                    {
                        OutputKey: "UserAthenaDatabaseName",
                        OutputValue: "quilt_db",
                    },
                    {
                        OutputKey: "QuiltWebHost",
                        OutputValue: "https://quilt.example.com/",
                    },
                ]),
            ],
        });

        const services = await resolveQuiltServices({
            stackArn:
                "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/id",
            mockCloudFormation: cfnMock as unknown as CloudFormationClient,
        });

        expect(services.quiltWebHost).toBe("quilt.example.com");
    });

    test("includes optional Athena metadata when available", async () => {
        cfnMock.on(DescribeStacksCommand).resolves({
            Stacks: [
                mockStack([
                    {
                        OutputKey: "PackagerQueueUrl",
                        OutputValue:
                            "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
                    },
                    {
                        OutputKey: "UserAthenaDatabaseName",
                        OutputValue: "quilt_catalog",
                    },
                    {
                        OutputKey: "QuiltWebHost",
                        OutputValue: "quilt.example.com",
                    },
                    {
                        OutputKey: "UserAthenaWorkgroupName",
                        OutputValue: "user-wg",
                    },
                    {
                        OutputKey: "AthenaResultsBucketName",
                        OutputValue: "athena-results-bucket",
                    },
                ]),
            ],
        });

        const services = await resolveQuiltServices({
            stackArn:
                "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/id",
            mockCloudFormation: cfnMock as unknown as CloudFormationClient,
        });

        expect(services.athenaUserWorkgroup).toBe("user-wg");
        expect(services.athenaResultsBucket).toBe("athena-results-bucket");
    });

    test("omits optional Athena metadata when not available", async () => {
        cfnMock.on(DescribeStacksCommand).resolves({
            Stacks: [
                mockStack([
                    {
                        OutputKey: "PackagerQueueUrl",
                        OutputValue:
                            "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
                    },
                    {
                        OutputKey: "UserAthenaDatabaseName",
                        OutputValue: "quilt_catalog",
                    },
                    {
                        OutputKey: "QuiltWebHost",
                        OutputValue: "quilt.example.com",
                    },
                ]),
            ],
        });

        const services = await resolveQuiltServices({
            stackArn:
                "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/id",
            mockCloudFormation: cfnMock as unknown as CloudFormationClient,
        });

        expect(services.athenaUserWorkgroup).toBeUndefined();
        expect(services.athenaResultsBucket).toBeUndefined();
    });

    test("throws error for missing PackagerQueueUrl output", async () => {
        cfnMock.on(DescribeStacksCommand).resolves({
            Stacks: [
                mockStack([
                    {
                        OutputKey: "UserAthenaDatabaseName",
                        OutputValue: "quilt_db",
                    },
                    {
                        OutputKey: "QuiltWebHost",
                        OutputValue: "quilt.example.com",
                    },
                ]),
            ],
        });

        await expect(
            resolveQuiltServices({
                stackArn:
                    "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/id",
                mockCloudFormation: cfnMock as unknown as CloudFormationClient,
            }),
        ).rejects.toThrow(ServiceResolverError);

        await expect(
            resolveQuiltServices({
                stackArn:
                    "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/id",
                mockCloudFormation: cfnMock as unknown as CloudFormationClient,
            }),
        ).rejects.toThrow(/PackagerQueueUrl/);
    });

    test("throws error for missing UserAthenaDatabaseName output", async () => {
        cfnMock.on(DescribeStacksCommand).resolves({
            Stacks: [
                mockStack([
                    {
                        OutputKey: "PackagerQueueUrl",
                        OutputValue:
                            "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
                    },
                    {
                        OutputKey: "QuiltWebHost",
                        OutputValue: "quilt.example.com",
                    },
                ]),
            ],
        });

        await expect(
            resolveQuiltServices({
                stackArn:
                    "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/id",
                mockCloudFormation: cfnMock as unknown as CloudFormationClient,
            }),
        ).rejects.toThrow(/UserAthenaDatabaseName/);
    });

    test("throws error for missing QuiltWebHost output", async () => {
        cfnMock.on(DescribeStacksCommand).resolves({
            Stacks: [
                mockStack([
                    {
                        OutputKey: "PackagerQueueUrl",
                        OutputValue:
                            "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
                    },
                    {
                        OutputKey: "UserAthenaDatabaseName",
                        OutputValue: "quilt_db",
                    },
                ]),
            ],
        });

        await expect(
            resolveQuiltServices({
                stackArn:
                    "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/id",
                mockCloudFormation: cfnMock as unknown as CloudFormationClient,
            }),
        ).rejects.toThrow(/No QuiltWebHost output found/);
    });

    test("throws error for invalid queue URL format", async () => {
        cfnMock.on(DescribeStacksCommand).resolves({
            Stacks: [
                mockStack([
                    {
                        OutputKey: "PackagerQueueUrl",
                        OutputValue: "invalid-queue-url",
                    },
                    {
                        OutputKey: "UserAthenaDatabaseName",
                        OutputValue: "quilt_db",
                    },
                    {
                        OutputKey: "QuiltWebHost",
                        OutputValue: "quilt.example.com",
                    },
                ]),
            ],
        });

        await expect(
            resolveQuiltServices({
                stackArn:
                    "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/id",
                mockCloudFormation: cfnMock as unknown as CloudFormationClient,
            }),
        ).rejects.toThrow(/Invalid SQS queue URL format/);
    });

    test("throws error when stack not found", async () => {
        cfnMock.on(DescribeStacksCommand).resolves({
            Stacks: [],
        });

        await expect(
            resolveQuiltServices({
                stackArn:
                    "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/id",
                mockCloudFormation: cfnMock as unknown as CloudFormationClient,
            }),
        ).rejects.toThrow(/CloudFormation stack not found/);
    });

    test("throws error when CloudFormation API call fails", async () => {
        cfnMock.on(DescribeStacksCommand).rejects(new Error("Access denied"));

        await expect(
            resolveQuiltServices({
                stackArn:
                    "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/id",
                mockCloudFormation: cfnMock as unknown as CloudFormationClient,
            }),
        ).rejects.toThrow(/Failed to describe CloudFormation stack/);
    });
});
