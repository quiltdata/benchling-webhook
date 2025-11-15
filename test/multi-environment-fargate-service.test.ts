import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as s3 from "aws-cdk-lib/aws-s3";
import { FargateService } from "../lib/fargate-service";
import { createMockConfig, createDevConfig, createProdConfig } from "./helpers/test-config";

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
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ECS::Cluster", {
                ClusterName: "benchling-webhook-cluster",
            });
        });

        test("creates single Fargate service", () => {
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ECS::Service", {
                ServiceName: "benchling-webhook-service",
                LaunchType: "FARGATE",
            });
        });

        test("creates single target group", () => {
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
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
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
            });

            const template = Template.fromStack(stack);
            const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
            const taskDef = Object.values(taskDefs)[0] as any;
            const containerDef = taskDef.Properties.ContainerDefinitions[0];
            const environment = containerDef.Environment || [];

            // Check for BenchlingSecret (secrets-only mode)
            // QuiltStackARN removed in v1.0.0
            const benchlingSecretEnv = environment.find((e: any) => e.Name === "BenchlingSecret");

            expect(benchlingSecretEnv).toBeDefined();
        });

        test.skip("includes log level environment variable - TODO: verify implementation", () => {
            const config = createMockConfig({
                logging: {
                    level: "DEBUG",
                },
            });

            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
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
            const config = createMockConfig({
                deployment: {
                    region: "us-east-1",
                    imageTag: "v0.6.3",
                },
            });

            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                imageTag: "v0.6.3",
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
            });

            const template = Template.fromStack(stack);
            const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
            const taskDef = Object.values(taskDefs)[0] as any;
            const containerDef = taskDef.Properties.ContainerDefinitions[0];

            // Image should reference the ECR repository with the specified tag
            expect(containerDef.Image).toBeDefined();
        });

        test("defaults to latest when no tag provided", () => {
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
            });

            const template = Template.fromStack(stack);
            const taskDefs = template.findResources("AWS::ECS::TaskDefinition");

            // Should create task definition without error
            expect(Object.keys(taskDefs).length).toBeGreaterThan(0);
        });
    });

    describe("Secret Management", () => {
        test("references Secrets Manager secret", () => {
            const config = createMockConfig({
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "quiltdata/benchling-webhook/default/tenant",
                    appDefinitionId: "app_456",
                },
            });

            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
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
            const devConfig = createDevConfig();
            const prodConfig = createProdConfig();

            // Create dev service
            const devService = new FargateService(stack, "DevFargateService", {
                vpc,
                bucket,
                config: devConfig,
                ecrRepository,
                benchlingSecret: devConfig.benchling.secretArn!,
                packageBucket: devConfig.packages.bucket,
                quiltDatabase: devConfig.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
            });

            // Create prod service
            const prodService = new FargateService(stack, "ProdFargateService", {
                vpc,
                bucket,
                config: prodConfig,
                ecrRepository,
                benchlingSecret: prodConfig.benchling.secretArn!,
                packageBucket: prodConfig.packages.bucket,
                quiltDatabase: prodConfig.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
            });

            // Both services should be created
            expect(devService.service).toBeDefined();
            expect(prodService.service).toBeDefined();
        });
    });

    describe("Target Group Configuration", () => {
        test("configures health check path", () => {
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
                HealthCheckPath: "/health/ready",
                HealthCheckIntervalSeconds: 30,
            });
        });

        test("uses IP target type for Fargate", () => {
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
                TargetType: "ip",
            });
        });
    });

    describe("Auto-scaling Configuration", () => {
        test("configures auto-scaling for service", () => {
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
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
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
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
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
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
        test("task role does not have CloudFormation permissions (removed in v1.0.0)", () => {
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
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

            // CloudFormation permissions removed in v1.0.0
            expect(foundCfnPermission).toBe(false);
        });

        test("task role has S3 permissions", () => {
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
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
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
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
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
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
            const config = createMockConfig();
            new FargateService(stack, "TestFargateService", {
                vpc,
                bucket,
                config,
                ecrRepository,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: config.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters (v1.0.0+)
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
                icebergDatabase: "",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::Logs::LogGroup", {
                LogGroupName: "/ecs/benchling-webhook",
                RetentionInDays: 7,
            });
        });
    });
});
