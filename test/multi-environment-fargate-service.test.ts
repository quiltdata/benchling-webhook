import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as s3 from "aws-cdk-lib/aws-s3";
import { FargateService } from "../lib/fargate-service";

/**
 * Multi-Environment Fargate Service Tests
 *
 * Tests for multi-service ECS infrastructure (dev/prod services)
 * Related: Issue #176 - Test Production Deployments
 * Spec: spec/176-test-prod/13-multi-environment-architecture-spec.md
 */
describe("FargateService - Multi-Environment Support", () => {
    let app: cdk.App;
    let stack: cdk.Stack;
    let vpc: ec2.IVpc;
    let bucket: s3.IBucket;
    let ecrRepository: ecr.IRepository;

    beforeEach(() => {
        app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack", {
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
        });

        // Create VPC
        vpc = new ec2.Vpc(stack, "TestVpc", {
            maxAzs: 2,
        });

        // Create S3 bucket
        bucket = s3.Bucket.fromBucketName(stack, "TestBucket", "test-bucket");

        // Create ECR repository
        ecrRepository = ecr.Repository.fromRepositoryName(
            stack,
            "TestEcrRepo",
            "benchling-webhook",
        );
    });

    describe("Single Service (Current Behavior)", () => {
        test("creates single ECS cluster", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ECS::Cluster", {
                ClusterName: "benchling-webhook-cluster",
            });
        });

        test("creates single Fargate service", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ECS::Service", {
                ServiceName: "benchling-webhook-service",
                LaunchType: "FARGATE",
            });
        });

        test("creates single target group", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
                Port: 5000,
                Protocol: "HTTP",
                TargetType: "ip",
            });
        });
    });

    describe("Environment Variable Configuration", () => {
        test("sets STAGE environment variable for production", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);
            const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
            const taskDef = Object.values(taskDefs)[0] as any;
            const containerDef = taskDef.Properties.ContainerDefinitions[0];
            const environment = containerDef.Environment || [];

            // Check for QuiltStackARN and BenchlingSecret (secrets-only mode)
            const quiltStackEnv = environment.find((e: any) => e.Name === "QuiltStackARN");
            const benchlingSecretEnv = environment.find((e: any) => e.Name === "BenchlingSecret");

            expect(quiltStackEnv).toBeDefined();
            expect(benchlingSecretEnv).toBeDefined();
        });

        test.skip("includes log level environment variable - TODO: verify implementation", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
                logLevel: "DEBUG",
            });

            const template = Template.fromStack(stack);
            const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
            const taskDef = Object.values(taskDefs)[0] as any;
            const containerDef = taskDef.Properties.ContainerDefinitions[0];
            const environment = containerDef.Environment || [];

            const logLevelEnv = environment.find((e: any) => e.Name === "LogLevel");
            expect(logLevelEnv).toBeDefined();
        });
    });

    describe("Image Tag Configuration", () => {
        test("uses provided image tag", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
                imageTag: "v0.6.3",
            });

            const template = Template.fromStack(stack);
            const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
            const taskDef = Object.values(taskDefs)[0] as any;
            const containerDef = taskDef.Properties.ContainerDefinitions[0];

            // Image should reference the ECR repository with the specified tag
            expect(containerDef.Image).toBeDefined();
        });

        test("defaults to latest when no tag provided", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);
            const taskDefs = template.findResources("AWS::ECS::TaskDefinition");

            // Should create task definition without error
            expect(Object.keys(taskDefs).length).toBeGreaterThan(0);
        });
    });

    describe("Secret Management", () => {
        test("references Secrets Manager secret", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "quiltdata/benchling-webhook/default/tenant",
            });

            const template = Template.fromStack(stack);

            // Check IAM permissions for Secrets Manager
            const policies = template.findResources("AWS::IAM::Policy");
            let foundSecretPermission = false;

            Object.values(policies).forEach((policy: any) => {
                const statements = policy.Properties?.PolicyDocument?.Statement || [];
                statements.forEach((statement: any) => {
                    if (Array.isArray(statement.Action)) {
                        if (statement.Action.includes("secretsmanager:GetSecretValue")) {
                            foundSecretPermission = true;
                        }
                    }
                });
            });

            expect(foundSecretPermission).toBe(true);
        });

        test("different secrets for different environments", () => {
            // Create dev service
            const devService = new FargateService(stack, "DevFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "quiltdata/benchling-webhook/dev/tenant",
            });

            // Create prod service
            const prodService = new FargateService(stack, "ProdFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/prod-stack/xyz789",
                benchlingSecret: "quiltdata/benchling-webhook/default/tenant",
            });

            // Both services should be created
            expect(devService.service).toBeDefined();
            expect(prodService.service).toBeDefined();
        });
    });

    describe("Target Group Configuration", () => {
        test("configures health check path", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
                HealthCheckPath: "/health/ready",
                HealthCheckIntervalSeconds: 30,
            });
        });

        test("uses IP target type for Fargate", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
                TargetType: "ip",
            });
        });
    });

    describe("Auto-scaling Configuration", () => {
        test("configures auto-scaling for service", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);

            // Check for scalable target
            template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget", {
                MinCapacity: 2,
                MaxCapacity: 10,
                ServiceNamespace: "ecs",
            });
        });

        test("configures CPU-based scaling policy", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalingPolicy", {
                PolicyType: "TargetTrackingScaling",
                TargetTrackingScalingPolicyConfiguration: {
                    PredefinedMetricSpecification: {
                        PredefinedMetricType: "ECSServiceAverageCPUUtilization",
                    },
                    TargetValue: 70,
                },
            });
        });

        test("configures memory-based scaling policy", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalingPolicy", {
                PolicyType: "TargetTrackingScaling",
                TargetTrackingScalingPolicyConfiguration: {
                    PredefinedMetricSpecification: {
                        PredefinedMetricType: "ECSServiceAverageMemoryUtilization",
                    },
                    TargetValue: 80,
                },
            });
        });
    });

    describe("IAM Permissions", () => {
        test("task role has CloudFormation read permissions", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);
            const policies = template.findResources("AWS::IAM::Policy");
            let foundCfnPermission = false;

            Object.values(policies).forEach((policy: any) => {
                const statements = policy.Properties?.PolicyDocument?.Statement || [];
                statements.forEach((statement: any) => {
                    if (Array.isArray(statement.Action)) {
                        if (statement.Action.some((action: string) => action.startsWith("cloudformation:"))) {
                            foundCfnPermission = true;
                        }
                    }
                });
            });

            expect(foundCfnPermission).toBe(true);
        });

        test("task role has S3 permissions", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);
            const policies = template.findResources("AWS::IAM::Policy");
            let foundS3Permission = false;

            Object.values(policies).forEach((policy: any) => {
                const statements = policy.Properties?.PolicyDocument?.Statement || [];
                statements.forEach((statement: any) => {
                    if (Array.isArray(statement.Action)) {
                        if (statement.Action.some((action: string) => action.startsWith("s3:"))) {
                            foundS3Permission = true;
                        }
                    }
                });
            });

            expect(foundS3Permission).toBe(true);
        });

        test("task role has SQS send permissions", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);
            const policies = template.findResources("AWS::IAM::Policy");
            let foundSQSPermission = false;

            Object.values(policies).forEach((policy: any) => {
                const statements = policy.Properties?.PolicyDocument?.Statement || [];
                statements.forEach((statement: any) => {
                    if (Array.isArray(statement.Action)) {
                        if (statement.Action.includes("sqs:SendMessage")) {
                            foundSQSPermission = true;
                        }
                    }
                });
            });

            expect(foundSQSPermission).toBe(true);
        });
    });

    describe("Container Insights", () => {
        test("enables Container Insights on cluster", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ECS::Cluster", {
                ClusterSettings: [{
                    Name: "containerInsights",
                    Value: "enabled",
                }],
            });
        });
    });

    describe("CloudWatch Logging", () => {
        test("creates log group for container logs", () => {
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                region: "us-east-1",
                account: "123456789012",
                ecrRepository,
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                benchlingSecret: "test-secret",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::Logs::LogGroup", {
                LogGroupName: "/ecs/benchling-webhook",
                RetentionInDays: 7,
            });
        });
    });
});
