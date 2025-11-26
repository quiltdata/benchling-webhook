import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { createMockConfig } from "./helpers/test-config";

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

        template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
            StageName: "$default",
            AccessLogSettings: Match.objectLike({
                DestinationArn: {
                    "Fn::GetAtt": [
                        Match.stringLikeRegexp("ApiGatewayAccessLogs.*"),
                        "Arn",
                    ],
                },
            }),
        });
    });

    test("creates API Gateway with correct configuration", () => {
        template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
            Name: "BenchlingWebhookHttpAPI",
            ProtocolType: "HTTP",
        });

        template.resourceCountIs("AWS::ApiGateway::RestApi", 0);

        template.hasResourceProperties("AWS::ApiGatewayV2::Integration", {
            IntegrationType: "HTTP_PROXY",
            ConnectionType: "VPC_LINK",
        });
    });

    test("creates VPC Link and Cloud Map service", () => {
        template.resourceCountIs("AWS::ApiGatewayV2::VpcLink", 1);
        template.resourceCountIs("AWS::ServiceDiscovery::PrivateDnsNamespace", 1);
        template.resourceCountIs("AWS::ServiceDiscovery::Service", 1);
    });

    test("does not create Application Load Balancer", () => {
        template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
    });

    test("throws error when missing required parameters", () => {
        const app = new cdk.App();
        const config = createMockConfig({
            benchling: {
                secretArn: "",
                tenant: "test-tenant",
                clientId: "client_test123",
                appDefinitionId: "test-app-id",
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

    test("configures container for port 8080 with updated health check", () => {
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
            ContainerDefinitions: Match.arrayWith([
                Match.objectLike({
                    PortMappings: Match.arrayWith([
                        Match.objectLike({
                            ContainerPort: 8080,
                        }),
                    ]),
                    HealthCheck: Match.objectLike({
                        Command: Match.arrayWith([
                            Match.stringLikeRegexp("8080"),
                        ]),
                    }),
                }),
            ]),
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

    test("container receives v1.0.0 environment variables", () => {
        // v1.0.0 uses explicit service parameters resolved at deployment time
        // Eliminates runtime CloudFormation API calls
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

        // v1.0.0 explicit service parameters (resolved at deployment time)
        const expectedServiceVars = [
            "PACKAGER_SQS_URL",
            "ATHENA_USER_DATABASE",
            "QUILT_WEB_HOST",
        ];

        // Optional service parameters (may be empty string)
        const optionalServiceVars = [
            "ATHENA_USER_WORKGROUP",
            "ATHENA_RESULTS_BUCKET",
            "ICEBERG_DATABASE",
            "ICEBERG_WORKGROUP",
        ];

        // Benchling configuration - only BenchlingSecret name is passed
        // All other Benchling config comes from Secrets Manager at runtime
        const expectedBenchlingVars = [
            "BenchlingSecret",  // Secret name (NOT ARN) - used to fetch credentials at runtime
        ];

        // Common/system variables
        const expectedCommonVars = [
            "LOG_LEVEL",
            "AWS_REGION",
            "AWS_DEFAULT_REGION",
            "ENABLE_WEBHOOK_VERIFICATION",
            "APP_ENV",
            "PORT",
        ];

        // Verify explicit service variables are present
        expectedServiceVars.forEach((varName) => {
            expect(actualEnvVars.has(varName)).toBe(true);
        });

        // Optional service variables (may or may not be present, no assertion needed)
        // optionalServiceVars - just acknowledged, not asserted

        // Verify Benchling config values are present
        expectedBenchlingVars.forEach((varName) => {
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
            "BENCHLING_SECRET_ARN",  // We pass BenchlingSecret (name), not ARN
            "BENCHLING_TENANT",  // Comes from Secrets Manager
            "BENCHLING_PKG_BUCKET",  // Comes from Secrets Manager
            "BENCHLING_PKG_PREFIX",  // Comes from Secrets Manager
            "BENCHLING_PKG_KEY",  // Comes from Secrets Manager
        ];

        prohibitedVars.forEach((varName) => {
            expect(actualEnvVars.has(varName)).toBe(false);
        });

        // Verify old variable names are NOT present (replaced by explicit parameters)
        const removedVars = [
            "QUEUE_URL",
            "QUILT_USER_BUCKET",
            "QUILT_CATALOG",
            "QUILT_DATABASE",
            "PACKAGE_BUCKET",  // Package config comes from Secrets Manager
            "PACKAGE_PREFIX",  // Package config comes from Secrets Manager
            "PACKAGE_METADATA_KEY",  // Package config comes from Secrets Manager
            "WEBHOOK_ALLOW_LIST",  // Security config comes from Secrets Manager
        ];

        removedVars.forEach((varName) => {
            expect(actualEnvVars.has(varName)).toBe(false);
        });
    });

    // ===================================================================
    // Secrets-Only Mode: CloudFormation Parameter Tests
    // ===================================================================

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

    test("creates PackagerQueueUrl CloudFormation parameter", () => {
        const parameters = template.toJSON().Parameters;
        expect(parameters).toHaveProperty("PackagerQueueUrl");

        const param = parameters.PackagerQueueUrl;
        expect(param.Type).toBe("String");
        expect(param.Description).toContain("SQS queue URL");
    });

    test("creates AthenaUserDatabase CloudFormation parameter", () => {
        const parameters = template.toJSON().Parameters;
        expect(parameters).toHaveProperty("AthenaUserDatabase");

        const param = parameters.AthenaUserDatabase;
        expect(param.Type).toBe("String");
        expect(param.Description).toContain("Athena");
    });

    test("creates QuiltWebHost CloudFormation parameter", () => {
        const parameters = template.toJSON().Parameters;
        expect(parameters).toHaveProperty("QuiltWebHost");

        const param = parameters.QuiltWebHost;
        expect(param.Type).toBe("String");
        expect(param.Description).toContain("catalog domain");
    });

    test("creates IcebergDatabase CloudFormation parameter", () => {
        const parameters = template.toJSON().Parameters;
        expect(parameters).toHaveProperty("IcebergDatabase");

        const param = parameters.IcebergDatabase;
        expect(param.Type).toBe("String");
        expect(param.Description).toContain("Iceberg");
        expect(param.Default).toBe("");
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

    test("task role does not have CloudFormation permissions (removed in v1.0.0)", () => {
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

        expect(foundCfnPermission).toBe(false);
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

    // ===================================================================
    // VPC Configuration Tests (v0.9.0)
    // ===================================================================

    test("creates VPC with private subnets when not specified", () => {
        const app = new cdk.App();
        const config = createMockConfig();
        // Don't specify vpc in config - should auto-create

        const stack = new BenchlingWebhookStack(app, "TestVPCStack", {
            config,
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
        });

        const template = Template.fromStack(stack);

        // Should create VPC
        template.resourceCountIs("AWS::EC2::VPC", 1);

        // Should create 2 NAT Gateways (one per AZ for HA)
        template.resourceCountIs("AWS::EC2::NatGateway", 2);

        // Should create both public and private subnets
        const subnets = template.findResources("AWS::EC2::Subnet");
        const subnetKeys = Object.keys(subnets);

        // Should have at least 4 subnets (2 public + 2 private across 2 AZs)
        expect(subnetKeys.length).toBeGreaterThanOrEqual(4);

        // Verify we have both public and private subnets
        const publicSubnets = subnetKeys.filter(
            (key) => subnets[key].Properties?.MapPublicIpOnLaunch === true,
        );
        const privateSubnets = subnetKeys.filter(
            (key) => subnets[key].Properties?.MapPublicIpOnLaunch === false,
        );

        expect(publicSubnets.length).toBeGreaterThanOrEqual(2);
        expect(privateSubnets.length).toBeGreaterThanOrEqual(2);
    });

    test("uses existing VPC when vpcId is specified", () => {
        const app = new cdk.App();
        const config = createMockConfig({
            deployment: {
                region: "us-east-1",
                imageTag: "latest",
                vpc: { vpcId: "vpc-0123456789abcdef0" },
            },
        });

        const stack = new BenchlingWebhookStack(app, "TestExistingVPCStack", {
            config,
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
        });

        const template = Template.fromStack(stack);

        // Should NOT create VPC (using existing)
        template.resourceCountIs("AWS::EC2::VPC", 0);

        // Should NOT create NAT Gateway (existing VPC)
        template.resourceCountIs("AWS::EC2::NatGateway", 0);
    });
});
