/**
 * Test that IAM role ARNs are properly propagated through the stack
 */

import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { ProfileConfig } from "../lib/types/config";

describe("IAM Role ARN Propagation", () => {
    let app: cdk.App;
    let config: ProfileConfig;

    beforeEach(() => {
        app = new cdk.App();
        config = {
            quilt: {
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-stack/abc-123",
                catalog: "quilt.example.com",
                database: "quilt_catalog",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-queue",
                region: "us-east-1",
                // Test role ARNs
                readRoleArn: "arn:aws:iam::123456789012:role/quilt-stack-T4BucketReadRole-ABC123",
                writeRoleArn: "arn:aws:iam::123456789012:role/quilt-stack-T4BucketWriteRole-XYZ789",
            },
            benchling: {
                tenant: "test-tenant",
                clientId: "client_123",
                secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                appDefinitionId: "app_456",
            },
            packages: {
                bucket: "benchling-packages",
                prefix: "benchling",
                metadataKey: "experiment_id",
            },
            deployment: {
                region: "us-east-1",
                account: "123456789012",
                imageTag: "latest",
            },
            _metadata: {
                version: "0.8.0",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: "cli",
            },
        };
    });

    test("IAM role ARNs are added to container environment variables", () => {
        const stack = new BenchlingWebhookStack(app, "TestStack", {
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
            config,
        });

        const template = Template.fromStack(stack);

        // Check that environment variables are set in the container definition
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
            ContainerDefinitions: [
                Match.objectLike({
                    Environment: Match.arrayWith([
                        Match.objectLike({
                            Name: "QUILT_READ_ROLE_ARN",
                            Value: "arn:aws:iam::123456789012:role/quilt-stack-T4BucketReadRole-ABC123",
                        }),
                        Match.objectLike({
                            Name: "QUILT_WRITE_ROLE_ARN",
                            Value: "arn:aws:iam::123456789012:role/quilt-stack-T4BucketWriteRole-XYZ789",
                        }),
                    ]),
                }),
            ],
        });
    });

    test("Task role has sts:AssumeRole permission for Quilt roles", () => {
        const stack = new BenchlingWebhookStack(app, "TestStack", {
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
            config,
        });

        const template = Template.fromStack(stack);

        // Check that the task role has the correct IAM policy for assuming roles
        template.hasResourceProperties("AWS::IAM::Policy", {
            PolicyDocument: {
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: "sts:AssumeRole",
                        Effect: "Allow",
                        Resource: [
                            "arn:aws:iam::*:role/*-T4BucketReadRole-*",
                            "arn:aws:iam::*:role/*-T4BucketWriteRole-*",
                        ],
                    }),
                ]),
            },
        });
    });

    test("Environment variables are not added when role ARNs are not provided", () => {
        // Remove role ARNs from config
        delete config.quilt.readRoleArn;
        delete config.quilt.writeRoleArn;

        const stack = new BenchlingWebhookStack(app, "TestStack", {
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
            config,
        });

        const template = Template.fromStack(stack);

        // Check that environment variables are NOT set when role ARNs are missing
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
            ContainerDefinitions: [
                Match.objectLike({
                    Environment: Match.not(
                        Match.arrayWith([
                            Match.objectLike({
                                Name: "QUILT_READ_ROLE_ARN",
                            }),
                        ])
                    ),
                }),
            ],
        });
    });

    test("IAM policy is not added when role ARNs are not provided", () => {
        // Remove role ARNs from config
        delete config.quilt.readRoleArn;
        delete config.quilt.writeRoleArn;

        const stack = new BenchlingWebhookStack(app, "TestStack", {
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
            config,
        });

        const template = Template.fromStack(stack);

        // Check that the sts:AssumeRole policy is NOT added when role ARNs are missing
        template.hasResourceProperties("AWS::IAM::Policy", {
            PolicyDocument: {
                Statement: Match.not(
                    Match.arrayWith([
                        Match.objectLike({
                            Action: "sts:AssumeRole",
                            Resource: [
                                "arn:aws:iam::*:role/*-T4BucketReadRole-*",
                                "arn:aws:iam::*:role/*-T4BucketWriteRole-*",
                            ],
                        }),
                    ])
                ),
            },
        });
    });
});