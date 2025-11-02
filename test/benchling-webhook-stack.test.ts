import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import * as fs from "fs";
import * as path from "path";

describe("BenchlingWebhookStack", () => {
    let template: Template;

    beforeEach(() => {
        const app = new cdk.App();
        const stack = new BenchlingWebhookStack(app, "TestStack", {
            bucketName: "test-bucket",
            environment: "test",
            prefix: "test-prefix",
            queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
            benchlingClientId: "test-client-id",
            benchlingClientSecret: "test-client-secret",
            benchlingTenant: "test-tenant",
            quiltCatalog: "https://quilt-example.com",
            quiltDatabase: "test-database",
            webhookAllowList: "203.0.113.10,198.51.100.5",
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

    test("throws error for invalid prefix", () => {
        const app = new cdk.App();
        expect(() => {
            new BenchlingWebhookStack(app, "TestStack", {
                bucketName: "test-bucket",
                environment: "test",
                prefix: "invalid/prefix",
                queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-client-secret",
                benchlingTenant: "test-tenant",
                quiltCatalog: "https://quilt-example.com",
                quiltDatabase: "test-database",
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });
        }).toThrow("Prefix should not contain a '/' character.");
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

    test("creates Secrets Manager secret for Benchling credentials", () => {
        template.hasResourceProperties("AWS::SecretsManager::Secret", {
            Name: "benchling-webhook/credentials",
            Description: "Benchling API credentials for webhook processor",
        });
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

    test.skip("environment variables match Flask config expectations (LEGACY TEST - secrets-only mode uses ConfigResolver)", () => {
        // SKIP: This test is for legacy mode with individual environment variables
        // In secrets-only mode, we only use 2 env vars: QuiltStackARN and BenchlingSecret
        // All runtime parameters come from the Benchling secret via ConfigResolver

        // Read the Python config files to extract expected environment variable names
        const configPath = path.join(__dirname, "../docker/src/config.py");
        const secretsResolverPath = path.join(__dirname, "../docker/src/secrets_resolver.py");
        const configContent = fs.readFileSync(configPath, "utf-8");
        const secretsResolverContent = fs.readFileSync(secretsResolverPath, "utf-8");

        // Extract environment variable names from both files using regex
        // Pattern: os.getenv("VAR_NAME", ...)
        const envVarPattern = /os\.getenv\("([^"]+)"/g;
        const expectedEnvVars = new Set<string>();
        let match;

        // Extract from config.py
        while ((match = envVarPattern.exec(configContent)) !== null) {
            expectedEnvVars.add(match[1]);
        }

        // Extract from secrets_resolver.py
        envVarPattern.lastIndex = 0; // Reset regex
        while ((match = envVarPattern.exec(secretsResolverContent)) !== null) {
            expectedEnvVars.add(match[1]);
        }

        // Get the container definition from the synthesized template
        const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
        const taskDefKeys = Object.keys(taskDefs);
        expect(taskDefKeys.length).toBeGreaterThan(0);

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

        // Critical environment variables that must match between CDK and Flask
        const criticalMappings: Record<string, string> = {
            QUEUE_ARN: "queue_arn",
            QUILT_USER_BUCKET: "s3_bucket_name",
            PKG_PREFIX: "s3_prefix",
            PKG_KEY: "package_key",
            QUILT_CATALOG: "quilt_catalog",
            QUILT_DATABASE: "quilt_database",
            BENCHLING_TENANT: "benchling_tenant",
            BENCHLING_CLIENT_ID: "benchling_client_id",
            BENCHLING_CLIENT_SECRET: "benchling_client_secret",
            LOG_LEVEL: "log_level",
            AWS_REGION: "aws_region",
            ENABLE_WEBHOOK_VERIFICATION: "enable_webhook_verification",
        };

        // Verify all critical environment variables are present in CDK stack
        Object.keys(criticalMappings).forEach((envVar) => {
            expect(actualEnvVars.has(envVar)).toBe(true);
        });

        // Verify the Flask config expects these exact variable names
        Object.keys(criticalMappings).forEach((envVar) => {
            expect(expectedEnvVars.has(envVar)).toBe(true);
        });
    });

    // ===================================================================
    // Phase 3 Episode 1: CloudFormation Parameter Tests (RED)
    // ===================================================================

    test("creates BenchlingSecrets CloudFormation parameter", () => {
        const parameters = template.toJSON().Parameters;
        expect(parameters).toHaveProperty("BenchlingSecrets");

        const param = parameters.BenchlingSecrets;
        expect(param.Type).toBe("String");
        expect(param.NoEcho).toBe(true);
        expect(param.Description).toContain("Benchling secrets");
    });

    test("marks old Benchling parameters as deprecated", () => {
        const parameters = template.toJSON().Parameters;

        // Check that old parameters exist for backward compatibility
        expect(parameters).toHaveProperty("BenchlingClientId");
        expect(parameters).toHaveProperty("BenchlingClientSecret");
        expect(parameters).toHaveProperty("BenchlingTenant");

        // Check that they're marked as deprecated
        expect(parameters.BenchlingClientId.Description).toContain("[DEPRECATED]");
        expect(parameters.BenchlingClientSecret.Description).toContain("[DEPRECATED]");
        expect(parameters.BenchlingTenant.Description).toContain("[DEPRECATED]");
    });

    test("old secret parameters have NoEcho enabled", () => {
        const parameters = template.toJSON().Parameters;

        expect(parameters.BenchlingClientId.NoEcho).toBe(true);
        expect(parameters.BenchlingClientSecret.NoEcho).toBe(true);
    });

    // ===================================================================
    // Phase 3 Episode 3: Secrets Manager Secret Creation Tests (RED)
    // ===================================================================

    test("creates Secrets Manager secret without unsafePlainText", () => {
        const secrets = template.findResources("AWS::SecretsManager::Secret");
        const secretKeys = Object.keys(secrets);
        expect(secretKeys.length).toBeGreaterThan(0);

        const secret = secrets[secretKeys[0]];
        expect(secret.Properties.Name).toBe("benchling-webhook/credentials");

        // Verify secret structure supports both new and old parameters
        // The actual implementation will use CloudFormation conditions
        expect(secret.Properties.SecretString).toBeDefined();
    });

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

    // ===================================================================
    // Phase 3 Episode 5: Container Environment Tests (RED)
    // ===================================================================

    test("container receives BENCHLING_SECRETS when new parameter provided", () => {
        // Create a new stack with benchlingSecrets provided
        const app = new cdk.App();
        const stackWithSecrets = new BenchlingWebhookStack(app, "TestStackWithSecrets", {
            bucketName: "test-bucket",
            environment: "test",
            prefix: "test-prefix",
            queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
            benchlingClientId: "",  // Empty to simulate new param usage
            benchlingClientSecret: "",
            benchlingTenant: "",
            benchlingSecrets: JSON.stringify({
                client_id: "test-id",
                client_secret: "test-secret",
                tenant: "test-tenant",
            }),
            quiltDatabase: "test-database",
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
        });

        const templateWithSecrets = Template.fromStack(stackWithSecrets);
        const taskDefs = templateWithSecrets.findResources("AWS::ECS::TaskDefinition");
        const taskDefKeys = Object.keys(taskDefs);
        const taskDef = taskDefs[taskDefKeys[0]];
        const containerDef = taskDef.Properties.ContainerDefinitions[0];
        const environment = containerDef.Environment || [];

        const benchlingSecretsEnv = environment.find((e: any) => e.Name === "BENCHLING_SECRETS");
        expect(benchlingSecretsEnv).toBeDefined();
    });

    test("container receives individual vars when old parameters provided", () => {
        // This is the existing test stack setup (backward compatibility)
        const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
        const taskDefKeys = Object.keys(taskDefs);
        const taskDef = taskDefs[taskDefKeys[0]];
        const containerDef = taskDef.Properties.ContainerDefinitions[0];
        const environment = containerDef.Environment || [];
        const secrets = containerDef.Secrets || [];

        // Should have BENCHLING_TENANT as environment variable
        const tenantEnv = environment.find((e: any) => e.Name === "BENCHLING_TENANT");
        expect(tenantEnv).toBeDefined();

        // Should have CLIENT_ID and CLIENT_SECRET as secrets
        const clientIdSecret = secrets.find((s: any) => s.Name === "BENCHLING_CLIENT_ID");
        const clientSecretSecret = secrets.find((s: any) => s.Name === "BENCHLING_CLIENT_SECRET");
        expect(clientIdSecret).toBeDefined();
        expect(clientSecretSecret).toBeDefined();
    });

    // ===================================================================
    // Phase 3 Episode 7: Backward Compatibility Tests (RED)
    // ===================================================================

    test("stack works with old parameters (backward compatibility)", () => {
        const app = new cdk.App();
        const legacyStack = new BenchlingWebhookStack(app, "LegacyStack", {
            bucketName: "test-bucket",
            environment: "test",
            prefix: "test-prefix",
            queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
            benchlingClientId: "legacy-client-id",
            benchlingClientSecret: "legacy-client-secret",
            benchlingTenant: "legacy-tenant",
            quiltDatabase: "test-database",
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
        });

        const legacyTemplate = Template.fromStack(legacyStack);

        // Verify stack creates successfully
        legacyTemplate.resourceCountIs("AWS::ECS::Service", 1);
        legacyTemplate.resourceCountIs("AWS::SecretsManager::Secret", 1);

        // Verify container uses old environment variable pattern
        const taskDefs = legacyTemplate.findResources("AWS::ECS::TaskDefinition");
        const taskDef = taskDefs[Object.keys(taskDefs)[0]];
        const containerDef = taskDef.Properties.ContainerDefinitions[0];
        const environment = containerDef.Environment || [];

        const tenantEnv = environment.find((e: any) => e.Name === "BENCHLING_TENANT");
        expect(tenantEnv).toBeDefined();
        expect(tenantEnv.Value).toBeDefined();
    });

    test("new parameter takes precedence when both provided", () => {
        const app = new cdk.App();
        const mixedStack = new BenchlingWebhookStack(app, "MixedStack", {
            bucketName: "test-bucket",
            environment: "test",
            prefix: "test-prefix",
            queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
            benchlingClientId: "old-client-id",
            benchlingClientSecret: "old-client-secret",
            benchlingTenant: "old-tenant",
            benchlingSecrets: JSON.stringify({
                client_id: "new-client-id",
                client_secret: "new-client-secret",
                tenant: "new-tenant",
            }),
            quiltDatabase: "test-database",
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
        });

        const mixedTemplate = Template.fromStack(mixedStack);
        const taskDefs = mixedTemplate.findResources("AWS::ECS::TaskDefinition");
        const taskDef = taskDefs[Object.keys(taskDefs)[0]];
        const containerDef = taskDef.Properties.ContainerDefinitions[0];
        const environment = containerDef.Environment || [];

        // Should use new parameter (BENCHLING_SECRETS)
        const secretsEnv = environment.find((e: any) => e.Name === "BENCHLING_SECRETS");
        expect(secretsEnv).toBeDefined();

        // Should NOT have old individual vars
        const tenantEnv = environment.find((e: any) => e.Name === "BENCHLING_TENANT");
        expect(tenantEnv).toBeUndefined();
    });

    test("empty new parameter falls back to old parameters", () => {
        const app = new cdk.App();
        const fallbackStack = new BenchlingWebhookStack(app, "FallbackStack", {
            bucketName: "test-bucket",
            environment: "test",
            prefix: "test-prefix",
            queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
            benchlingClientId: "fallback-client-id",
            benchlingClientSecret: "fallback-client-secret",
            benchlingTenant: "fallback-tenant",
            benchlingSecrets: "",  // Empty string
            quiltDatabase: "test-database",
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
        });

        const fallbackTemplate = Template.fromStack(fallbackStack);
        const taskDefs = fallbackTemplate.findResources("AWS::ECS::TaskDefinition");
        const taskDef = taskDefs[Object.keys(taskDefs)[0]];
        const containerDef = taskDef.Properties.ContainerDefinitions[0];
        const environment = containerDef.Environment || [];

        // Should fall back to old parameter pattern
        const tenantEnv = environment.find((e: any) => e.Name === "BENCHLING_TENANT");
        expect(tenantEnv).toBeDefined();
    });
});
