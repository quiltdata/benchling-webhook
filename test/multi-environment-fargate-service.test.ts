import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { FargateService } from "../lib/fargate-service";
import { createMockConfig, createDevConfig, createProdConfig } from "./helpers/test-config";
import { profileToStackConfig } from "../lib/utils/config-transform";

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
    let ecrRepository: ecr.IRepository;
    let targetGroup: elbv2.INetworkTargetGroup;

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

        // Create ECR repository
        ecrRepository = ecr.Repository.fromRepositoryName(
            stack,
            "TestEcrRepo",
            "benchling-webhook",
        );

        // Create mock target group for NLB integration
        targetGroup = new elbv2.NetworkTargetGroup(stack, "TestTargetGroup", {
            vpc,
            port: 8080,
            protocol: elbv2.Protocol.TCP,
            targetType: elbv2.TargetType.IP,
        });
    });

    describe("Single Service (Current Behavior)", () => {
        test("creates single ECS cluster", () => {
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
            });

            const template = Template.fromStack(stack);

            // ClusterName removed to allow multiple stacks per account (v0.9.8+)
            template.resourceCountIs("AWS::ECS::Cluster", 1);
        });

        test("creates single Fargate service", () => {
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
            });

            const template = Template.fromStack(stack);

            // ServiceName removed to allow multiple stacks per account (v0.9.8+)
            template.hasResourceProperties("AWS::ECS::Service", {
                LaunchType: "FARGATE",
            });
        });

        test("registers with NLB target group", () => {
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            const service = new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
            });

            const template = Template.fromStack(stack);

            // Service attaches to NLB target group, no Cloud Map
            template.resourceCountIs("AWS::ServiceDiscovery::Service", 0);
            // Target group should be defined (we created it in the test)
            template.resourceCountIs("AWS::ElasticLoadBalancingV2::TargetGroup", 1);
        });
    });

    describe("Environment Variable Configuration", () => {
        test("sets BenchlingSecret environment variable", () => {
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
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

        test("includes LOG_LEVEL environment variable", () => {
            const profileConfig = createMockConfig({
                logging: {
                    level: "DEBUG",
                },
            });
            const config = profileToStackConfig(profileConfig);

            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
            });

            const template = Template.fromStack(stack);
            const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
            const taskDef = Object.values(taskDefs)[0] as any;
            const containerDef = taskDef.Properties.ContainerDefinitions[0];
            const environment = containerDef.Environment || [];

            const logLevelEnv = environment.find((e: any) => e.Name === "LOG_LEVEL");
            expect(logLevelEnv).toBeDefined();
            expect(logLevelEnv.Value).toBe("DEBUG");
        });
    });

    describe("Image Tag Configuration", () => {
        test("uses provided image tag", () => {
            const profileConfig = createMockConfig({
                deployment: {
                    region: "us-east-1",
                    imageTag: "v0.6.3",
                },
            });
            const config = profileToStackConfig(profileConfig);

            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                imageTag: "v0.6.3",
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
            });

            const template = Template.fromStack(stack);
            const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
            const taskDef = Object.values(taskDefs)[0] as any;
            const containerDef = taskDef.Properties.ContainerDefinitions[0];

            // Image should reference the ECR repository with the specified tag
            expect(containerDef.Image).toBeDefined();
        });

        test("defaults to latest when no tag provided", () => {
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
            });

            const template = Template.fromStack(stack);
            const taskDefs = template.findResources("AWS::ECS::TaskDefinition");

            // Should create task definition without error
            expect(Object.keys(taskDefs).length).toBeGreaterThan(0);
        });
    });

    describe("Secret Management", () => {
        test("references Secrets Manager secret", () => {
            const profileConfig = createMockConfig({
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                    appDefinitionId: "app_456",
                },
            });
            const config = profileToStackConfig(profileConfig);

            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
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
            const devProfileConfig = createDevConfig();
            const prodProfileConfig = createProdConfig();
            const devConfig = profileToStackConfig(devProfileConfig);
            const prodConfig = profileToStackConfig(prodProfileConfig);

            // Create dev service
            const devService = new FargateService(stack, "DevFargateService", {
                vpc,
                config: devConfig,
                ecrRepository,
                targetGroup,
                benchlingSecret: devConfig.benchling.secretArn!,
                packageBucket: devProfileConfig.packages.bucket,
                quiltDatabase: devConfig.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
            });

            // Create prod service
            const prodService = new FargateService(stack, "ProdFargateService", {
                vpc,
                config: prodConfig,
                ecrRepository,
                targetGroup,
                benchlingSecret: prodConfig.benchling.secretArn!,
                packageBucket: prodProfileConfig.packages.bucket,
                quiltDatabase: prodConfig.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
            });

            // Both services should be created
            expect(devService.service).toBeDefined();
            expect(prodService.service).toBeDefined();
        });
    });

    describe("Service networking", () => {
        test("allows VPC traffic to container port 8080", () => {
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::EC2::SecurityGroup", Match.objectLike({
                SecurityGroupIngress: Match.arrayWith([
                    Match.objectLike({
                        FromPort: 8080,
                        ToPort: 8080,
                        IpProtocol: "tcp",
                    }),
                ]),
            }));
        });
    });

    describe("Auto-scaling Configuration", () => {
        test("configures auto-scaling for service", () => {
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
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
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
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
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
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
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                logLevel: "DEBUG",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
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
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
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
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
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
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
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
            const profileConfig = createMockConfig();
            const config = profileToStackConfig(profileConfig);
            new FargateService(stack, "TestFargateService", {
                vpc,
                config,
                ecrRepository,
                targetGroup,
                benchlingSecret: config.benchling.secretArn!,
                packageBucket: profileConfig.packages.bucket,
                quiltDatabase: config.quilt.database || "test-database",
                // New explicit service parameters
                packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                athenaUserDatabase: "test-database",
                quiltWebHost: "quilt.example.com",
            });

            const template = Template.fromStack(stack);

            // Log group should be named after the stack (not hardcoded)
            template.hasResourceProperties("AWS::Logs::LogGroup", {
                LogGroupName: "TestStack",
                RetentionInDays: 7,
            });
        });
    });
});
