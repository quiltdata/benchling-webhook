/**
 * Test that IAM managed policy ARNs are properly propagated through the stack
 *
 * v0.10.0: Changed from role assumption to direct managed policy attachment
 */

import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { ProfileConfig } from "../lib/types/config";
import { profileToStackConfig } from "../lib/utils/config-transform";

describe("IAM Managed Policy ARN Propagation", () => {
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
                // Test managed policy ARNs (attached directly to task role, no assumption)
                bucketWritePolicyArn: "arn:aws:iam::123456789012:policy/quilt-stack-BucketWritePolicy-XYZ789",
                athenaUserPolicyArn: "arn:aws:iam::123456789012:policy/quilt-stack-UserAthenaNonManagedRolePolicy-ABC123",
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
                version: "0.10.0",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: "cli",
            },
        };
    });

    test("Managed policies are attached to task role when policy ARNs are provided", () => {
        const stack = new BenchlingWebhookStack(app, "TestStack", {
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
            config: profileToStackConfig(config),
        });

        const template = Template.fromStack(stack);

        // Check that managed policies are attached to the task role
        template.hasResourceProperties("AWS::IAM::Role", {
            ManagedPolicyArns: Match.arrayWith([
                "arn:aws:iam::123456789012:policy/quilt-stack-BucketWritePolicy-XYZ789",
                "arn:aws:iam::123456789012:policy/quilt-stack-UserAthenaNonManagedRolePolicy-ABC123",
            ]),
        });
    });

    test("Task role does NOT have sts:AssumeRole permission (no role assumption in v0.10.0+)", () => {
        const stack = new BenchlingWebhookStack(app, "TestStack", {
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
            config: profileToStackConfig(config),
        });

        const template = Template.fromStack(stack);

        // Check that NO policy has sts:AssumeRole for write role
        // (we attach managed policies directly, no assumption needed)
        const policies = template.findResources("AWS::IAM::Policy");
        for (const [, policy] of Object.entries(policies)) {
            const statements = (policy as any).Properties?.PolicyDocument?.Statement || [];
            for (const statement of statements) {
                if (statement.Action === "sts:AssumeRole") {
                    // If sts:AssumeRole exists, it should NOT be for Quilt write roles
                    expect(statement.Resource).not.toMatch(/T4BucketWriteRole/);
                }
            }
        }
    });

    test("Managed policies are NOT attached when policy ARNs are not provided", () => {
        // Remove policy ARNs from config
        delete config.quilt.bucketWritePolicyArn;
        delete config.quilt.athenaUserPolicyArn;

        const stack = new BenchlingWebhookStack(app, "TestStack", {
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
            config: profileToStackConfig(config),
        });

        const template = Template.fromStack(stack);

        // Find the task role
        const roles = template.findResources("AWS::IAM::Role", {
            AssumeRolePolicyDocument: {
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Principal: {
                            Service: "ecs-tasks.amazonaws.com",
                        },
                    }),
                ]),
            },
        });

        // Check that managed policies array doesn't contain Quilt policy ARNs
        for (const [, role] of Object.entries(roles)) {
            const managedPolicies = (role as any).Properties?.ManagedPolicyArns || [];
            for (const arn of managedPolicies) {
                // ARN can be a string or CloudFormation intrinsic function (object)
                const arnString = typeof arn === "string" ? arn : JSON.stringify(arn);
                expect(arnString).not.toMatch(/BucketWritePolicy/);
                expect(arnString).not.toMatch(/UserAthenaNonManagedRolePolicy/);
            }
        }
    });

    test("Only S3 bucket write policy is attached when Athena policy ARN is not provided", () => {
        // Remove only Athena policy ARN
        delete config.quilt.athenaUserPolicyArn;

        const stack = new BenchlingWebhookStack(app, "TestStack", {
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
            config: profileToStackConfig(config),
        });

        const template = Template.fromStack(stack);

        // Check that only S3 write policy is attached
        template.hasResourceProperties("AWS::IAM::Role", {
            ManagedPolicyArns: Match.arrayWith([
                "arn:aws:iam::123456789012:policy/quilt-stack-BucketWritePolicy-XYZ789",
            ]),
        });

        // Check that Athena policy is NOT attached
        const roles = template.findResources("AWS::IAM::Role");
        for (const [, role] of Object.entries(roles)) {
            const managedPolicies = (role as any).Properties?.ManagedPolicyArns || [];
            for (const arn of managedPolicies) {
                // ARN can be a string or CloudFormation intrinsic function (object)
                const arnString = typeof arn === "string" ? arn : JSON.stringify(arn);
                expect(arnString).not.toMatch(/UserAthenaNonManagedRolePolicy/);
            }
        }
    });
});
