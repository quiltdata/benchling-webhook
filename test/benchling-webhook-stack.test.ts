import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { createMockConfig } from "./helpers/mock-config";

describe("BenchlingWebhookStack", () => {
    let template: Template;

    beforeEach(() => {
        const app = new cdk.App();
        const config = createMockConfig();
        const stack = new BenchlingWebhookStack(app, "TestStack", {
            config,
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
        });
        template = Template.fromStack(stack);
    });

    test("creates ECS cluster", () => {
        template.hasResourceProperties("AWS::ECS::Cluster", {
            ClusterName: "benchling-webhook-cluster",
            ClusterSettings: [{
                Name: "containerInsights",
                Value: "enabled",
            }],
        });
    });

    test("creates Fargate service", () => {
        template.hasResourceProperties("AWS::ECS::Service", {
            ServiceName: "benchling-webhook-service",
            LaunchType: "FARGATE",
            DesiredCount: 2,
        });
    });

    test("does not create Step Functions", () => {
        // Ensure Step Functions are removed (Lambda for S3 auto-delete is OK)
        template.resourceCountIs("AWS::StepFunctions::StateMachine", 0);
        template.resourceCountIs("AWS::Events::Connection", 0);
    });

    test("creates CloudWatch log groups", () => {
        template.resourceCountIs("AWS::Logs::LogGroup", 2); // One for API Gateway, one for container logs

        template.hasResourceProperties("AWS::ApiGateway::Stage", {
            AccessLogSetting: {
                DestinationArn: {
                    "Fn::GetAtt": [
                        Match.stringLikeRegexp("ApiGatewayAccessLogs.*"),
                        "Arn",
                    ],
                },
            },
        });
    });

    test("creates API Gateway with correct configuration", () => {
        template.hasResourceProperties("AWS::ApiGateway::RestApi", {
            Name: "BenchlingWebhookAPI",
        });

        template.hasResourceProperties("AWS::ApiGateway::Stage", {
            StageName: "prod",
            MethodSettings: [{
                LoggingLevel: "INFO",
                DataTraceEnabled: true,
                HttpMethod: "*",
                ResourcePath: "/*",
            }],
        });

        // Check that API Gateway has HTTP_PROXY integration to ALB (not Step Functions)
        template.hasResourceProperties("AWS::ApiGateway::Method", {
            HttpMethod: "ANY",
            AuthorizationType: "NONE",
            Integration: {
                Type: "HTTP_PROXY",
            },
        });
    });

    test("creates Application Load Balancer", () => {
        template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
            Name: "benchling-webhook-alb",
            Scheme: "internet-facing",
            Type: "application",
        });
    });

    test("creates ALB target group with health checks", () => {
        template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
            Port: 5000,
            Protocol: "HTTP",
            TargetType: "ip",
            HealthCheckPath: "/health/ready",
            HealthCheckIntervalSeconds: 30,
        });
    });

    test("throws error when missing required parameters", () => {
        const app = new cdk.App();
        const config = createMockConfig({
            quilt: {
                stackArn: "",
                catalog: "https://quilt.example.com",
                bucket: "test-bucket",
                database: "test_db",
                queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
                region: "us-east-1",
            },
        });

        expect(() => {
            new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });
        }).toThrow("Configuration validation failed");
    });

    test("creates IAM role with correct permissions", () => {
        // Check for ECS Task Execution Role
        template.hasResourceProperties("AWS::IAM::Role", {
            AssumeRolePolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: "sts:AssumeRole",
                        Effect: "Allow",
                        Principal: {
                            Service: "ecs-tasks.amazonaws.com",
                        },
                    }),
                ]),
            }),
        });

        // Check for S3 permissions in task role policy
        const policies = template.findResources("AWS::IAM::Policy");
        let foundS3Policy = false;
        let foundSQSPolicy = false;

        Object.values(policies).forEach((policy: any) => {
            const statements = policy.Properties?.PolicyDocument?.Statement || [];
            statements.forEach((statement: any) => {
                if (Array.isArray(statement.Action)) {
                    if (statement.Action.some((action: string) => action.startsWith("s3:"))) {
                        foundS3Policy = true;
                    }
                    if (statement.Action.includes("sqs:SendMessage")) {
                        foundSQSPolicy = true;
                    }
                }
            });
        });

        expect(foundS3Policy).toBe(true);
        expect(foundSQSPolicy).toBe(true);
    });

    test("does not create Secrets Manager secret (uses external secret)", () => {
        // In secrets-only mode, we reference an existing Secrets Manager secret
        // We don't create one in the stack - it's managed externally
        template.resourceCountIs("AWS::SecretsManager::Secret", 0);
    });

    test("creates task definition with correct container configuration", () => {
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
            Family: "benchling-webhook-task",
            Cpu: "1024",
            Memory: "2048",
            NetworkMode: "awsvpc",
            RequiresCompatibilities: ["FARGATE"],
        });
    });

    test("configures auto-scaling for Fargate service", () => {
        template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget", {
            MinCapacity: 2,
            MaxCapacity: 10,
            ServiceNamespace: "ecs",
        });

        // Check for CPU-based scaling policy
        template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalingPolicy", {
            PolicyType: "TargetTrackingScaling",
            TargetTrackingScalingPolicyConfiguration: {
                PredefinedMetricSpecification: {
                    PredefinedMetricType: "ECSServiceAverageCPUUtilization",
                },
                TargetValue: 70,
            },
        });

        // Check for memory-based scaling policy
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

    test("container receives v0.7.0 environment variables", () => {
        // v0.7.0 uses structured config with static values as env vars
        // and runtime parameters (QuiltStackARN, BenchlingSecret) from CloudFormation
        const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
        const taskDefKeys = Object.keys(taskDefs);
        const taskDef = taskDefs[taskDefKeys[0]];
        const containerDef = taskDef.Properties.ContainerDefinitions[0];
        const environment = containerDef.Environment || [];
        const secrets = containerDef.Secrets || [];

        // Build a set of environment variable names from the CDK stack
        const actualEnvVars = new Set<string>();
        environment.forEach((env: any) => {
            actualEnvVars.add(env.Name);
        });
        secrets.forEach((secret: any) => {
            actualEnvVars.add(secret.Name);
        });

        // v0.7.0 static config values (from ProfileConfig)
        const expectedStaticVars = [
            "BENCHLING_TENANT",
            "BENCHLING_PKG_BUCKET",
            "BENCHLING_PKG_PREFIX",
            "BENCHLING_PKG_KEY",
        ];

        // Runtime parameters (from CloudFormation)
        const expectedRuntimeVars = [
            "QuiltStackARN",
            "BenchlingSecret",
        ];

        // Common/system variables
        const expectedCommonVars = [
            "LOG_LEVEL",
            "AWS_REGION",
            "AWS_DEFAULT_REGION",
            "ENABLE_WEBHOOK_VERIFICATION",
            "FLASK_ENV",
            "BENCHLING_WEBHOOK_VERSION",
        ];

        // Verify static config values are present
        expectedStaticVars.forEach((varName) => {
            expect(actualEnvVars.has(varName)).toBe(true);
        });

        // Verify runtime parameters are present
        expectedRuntimeVars.forEach((varName) => {
            expect(actualEnvVars.has(varName)).toBe(true);
        });

        // Verify common variables are present
        expectedCommonVars.forEach((varName) => {
            expect(actualEnvVars.has(varName)).toBe(true);
        });

        // Verify sensitive secrets are NOT in environment (retrieved at runtime from Secrets Manager)
        const prohibitedVars = [
            "BENCHLING_CLIENT_ID",
            "BENCHLING_CLIENT_SECRET",
            "BENCHLING_APP_DEFINITION_ID",
        ];

        prohibitedVars.forEach((varName) => {
            expect(actualEnvVars.has(varName)).toBe(false);
        });

        // Verify old queue/catalog variables are NOT present (now resolved at runtime via CloudFormation)
        const removedVars = [
            "QUEUE_ARN",
            "QUILT_USER_BUCKET",
            "QUILT_CATALOG",
            "QUILT_DATABASE",
        ];

        removedVars.forEach((varName) => {
            expect(actualEnvVars.has(varName)).toBe(false);
        });
    });

    // ===================================================================
    // Secrets-Only Mode: CloudFormation Parameter Tests
    // ===================================================================

    test("creates QuiltStackARN CloudFormation parameter", () => {
        const parameters = template.toJSON().Parameters;
        expect(parameters).toHaveProperty("QuiltStackARN");

        const param = parameters.QuiltStackARN;
        expect(param.Type).toBe("String");
        expect(param.Description).toContain("Quilt CloudFormation stack");
    });

    test("creates BenchlingSecret CloudFormation parameter", () => {
        const parameters = template.toJSON().Parameters;
        expect(parameters).toHaveProperty("BenchlingSecretARN");

        const param = parameters.BenchlingSecretARN;
        expect(param.Type).toBe("String");
        expect(param.Description).toContain("Secrets Manager secret");
    });

    test("creates LogLevel CloudFormation parameter", () => {
        const parameters = template.toJSON().Parameters;
        expect(parameters).toHaveProperty("LogLevel");

        const param = parameters.LogLevel;
        expect(param.Type).toBe("String");
        expect(param.AllowedValues).toContain("INFO");
        expect(param.AllowedValues).toContain("DEBUG");
    });

    // ===================================================================
    // Secrets-Only Mode: IAM and Container Environment Tests
    // ===================================================================

    test("task role has Secrets Manager read permissions", () => {
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

    test("task role has CloudFormation read permissions", () => {
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

    test("container receives QuiltStackARN environment variable", () => {
        const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
        const taskDefKeys = Object.keys(taskDefs);
        const taskDef = taskDefs[taskDefKeys[0]];
        const containerDef = taskDef.Properties.ContainerDefinitions[0];
        const environment = containerDef.Environment || [];

        const stackArnEnv = environment.find((e: any) => e.Name === "QuiltStackARN");
        expect(stackArnEnv).toBeDefined();
    });

    test("container receives BenchlingSecret environment variable", () => {
        const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
        const taskDefKeys = Object.keys(taskDefs);
        const taskDef = taskDefs[taskDefKeys[0]];
        const containerDef = taskDef.Properties.ContainerDefinitions[0];
        const environment = containerDef.Environment || [];

        const secretEnv = environment.find((e: any) => e.Name === "BenchlingSecret");
        expect(secretEnv).toBeDefined();
    });
});
