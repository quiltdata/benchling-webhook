import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { createMockConfig, createDevConfig, createProdConfig } from "./helpers/mock-config";

/**
 * Multi-Environment Stack Tests
 *
 * Tests for multi-environment stack configuration (dev/prod profiles)
 * Related: Issue #176 - Test Production Deployments
 * Spec: spec/176-test-prod/13-multi-environment-architecture-spec.md
 */
describe("BenchlingWebhookStack - Multi-Environment Support", () => {
    let app: cdk.App;

    beforeEach(() => {
        app = new cdk.App();
    });

    describe("Profile Handling", () => {
        test("creates stack with prod profile only", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            // Should create ECS service
            template.hasResourceProperties("AWS::ECS::Service", {
                ServiceName: "benchling-webhook-service",
            });

            // API Gateway should no longer be present
            template.resourceCountIs("AWS::ApiGateway::Stage", 0);
        });

        test("creates stack with image tag parameter", () => {
            const config = createMockConfig({
                deployment: {
                    region: "us-east-1",
                    imageTag: "v0.6.3",
                },
            });

            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            // Verify ImageTag parameter exists
            const parameters = template.toJSON().Parameters;
            expect(parameters.ImageTag).toBeDefined();
            expect(parameters.ImageTag.Default).toBe("v0.6.3");
        });

        test("throws error when missing required parameters", () => {
            const config = createMockConfig({
                quilt: {
                    stackArn: "",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
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

        test("throws error when missing benchling secret", () => {
            const config = createMockConfig({
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "",
                    appDefinitionId: "app_456",
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
    });

    describe("CloudFormation Parameters", () => {
        test("creates QuiltStackARN parameter", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            const parameters = template.toJSON().Parameters;

            expect(parameters.QuiltStackARN).toBeDefined();
            expect(parameters.QuiltStackARN.Type).toBe("String");
            expect(parameters.QuiltStackARN.Description).toContain("Quilt CloudFormation stack");
        });

        test("creates BenchlingSecret parameter", () => {
            const config = createMockConfig({
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "quiltdata/benchling-webhook/default/tenant",
                    appDefinitionId: "app_456",
                },
            });

            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            const parameters = template.toJSON().Parameters;

            expect(parameters.BenchlingSecretARN).toBeDefined();
            expect(parameters.BenchlingSecretARN.Type).toBe("String");
            expect(parameters.BenchlingSecretARN.Description).toContain("Secrets Manager secret");
        });

        test("creates LogLevel parameter with allowed values", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            const parameters = template.toJSON().Parameters;

            expect(parameters.LogLevel).toBeDefined();
            expect(parameters.LogLevel.Type).toBe("String");
            expect(parameters.LogLevel.AllowedValues).toContain("INFO");
            expect(parameters.LogLevel.AllowedValues).toContain("DEBUG");
            expect(parameters.LogLevel.Default).toBe("INFO");
        });

        test("creates ImageTag parameter", () => {
            const config = createMockConfig({
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
            });

            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            const parameters = template.toJSON().Parameters;

            expect(parameters.ImageTag).toBeDefined();
            expect(parameters.ImageTag.Type).toBe("String");
            expect(parameters.ImageTag.Default).toBe("latest");
        });
    });

    describe("Infrastructure Components", () => {
        test("creates single ECS cluster", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ECS::Cluster", {
                ClusterName: "benchling-webhook-cluster",
            });
        });

        test("creates Application Load Balancer", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
                Name: "benchling-webhook-alb",
                Scheme: "internet-facing",
            });
        });

        test("does not create API Gateway", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.resourceCountIs("AWS::ApiGateway::RestApi", 0);
        });

        test("uses hardcoded quiltdata ECR repository", () => {
            const config = createMockConfig({
                deployment: {
                    region: "us-east-1",
                    ecrRepository: "quiltdata/benchling",
                    imageTag: "0.7.3",
                },
            });

            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            // Verify the stack does NOT create an ECR repository
            expect(() => {
                template.hasResourceProperties("AWS::ECR::Repository", {});
            }).toThrow();

            // Verify the DockerImageUri output contains the hardcoded ECR repository
            template.hasOutput("DockerImageUri", {
                Value: {
                    "Fn::Join": [
                        "",
                        Match.arrayWith([
                            Match.stringLikeRegexp("712023778557\\.dkr\\.ecr\\.us-east-1\\.amazonaws\\.com/quiltdata/benchling:.*"),
                        ]),
                    ],
                },
            });
        });
    });

    describe("Environment-Specific Configuration", () => {
        test("prod configuration uses semantic versioning", () => {
            const config = createProdConfig({
                deployment: {
                    region: "us-east-1",
                    imageTag: "v0.6.3",
                },
            });

            const stack = new BenchlingWebhookStack(app, "ProdStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            const parameters = template.toJSON().Parameters;

            expect(parameters.ImageTag.Default).toBe("v0.6.3");
        });

        test("dev configuration can use latest tag", () => {
            const config = createDevConfig({
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
            });

            const stack = new BenchlingWebhookStack(app, "DevStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            const parameters = template.toJSON().Parameters;

            expect(parameters.ImageTag.Default).toBe("latest");
        });
    });

    describe("Service Isolation", () => {
        test("separate stacks can coexist", () => {
            const devConfig = createDevConfig();
            const prodConfig = createProdConfig();

            // Create dev stack
            const devStack = new BenchlingWebhookStack(app, "DevStack", {
                config: devConfig,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            // Create prod stack
            const prodStack = new BenchlingWebhookStack(app, "ProdStack", {
                config: prodConfig,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const devTemplate = Template.fromStack(devStack);
            const prodTemplate = Template.fromStack(prodStack);

            // Both stacks should have their own services
            devTemplate.hasResourceProperties("AWS::ECS::Service", {
                ServiceName: "benchling-webhook-service",
            });

            prodTemplate.hasResourceProperties("AWS::ECS::Service", {
                ServiceName: "benchling-webhook-service",
            });
        });
    });

    describe("IAM Permissions", () => {
        test("task role has required permissions", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            const policies = template.findResources("AWS::IAM::Policy");

            let hasS3Permission = false;
            let hasSQSPermission = false;
            let hasSecretsPermission = false;
            let hasCfnPermission = false;

            Object.values(policies).forEach((policy: any) => {
                const statements = policy.Properties?.PolicyDocument?.Statement || [];
                statements.forEach((statement: any) => {
                    if (Array.isArray(statement.Action)) {
                        if (statement.Action.some((action: string) => action.startsWith("s3:"))) {
                            hasS3Permission = true;
                        }
                        if (statement.Action.includes("sqs:SendMessage")) {
                            hasSQSPermission = true;
                        }
                        if (statement.Action.includes("secretsmanager:GetSecretValue")) {
                            hasSecretsPermission = true;
                        }
                        if (statement.Action.some((action: string) => action.startsWith("cloudformation:"))) {
                            hasCfnPermission = true;
                        }
                    }
                });
            });

            expect(hasS3Permission).toBe(true);
            expect(hasSQSPermission).toBe(true);
            expect(hasSecretsPermission).toBe(true);
            expect(hasCfnPermission).toBe(true);
        });
    });

    describe("CloudFormation Outputs", () => {
        test("exports webhook endpoint", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            const outputs = template.toJSON().Outputs;

            expect(outputs.WebhookEndpoint).toBeDefined();
        });

        test("exports Webhook Endpoint", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.hasOutput("WebhookEndpoint", {
                Description: "Webhook endpoint URL - use this in Benchling app configuration",
            });
        });
    });

    describe("Auto-scaling", () => {
        test("configures auto-scaling for service", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget", {
                MinCapacity: 2,
                MaxCapacity: 10,
            });
        });
    });

    describe("Monitoring", () => {
        test("enables Container Insights", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ECS::Cluster", {
                ClusterSettings: [{
                    Name: "containerInsights",
                    Value: "enabled",
                }],
            });
        });

        test("creates container log group", () => {
            const config = createMockConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.resourceCountIs("AWS::Logs::LogGroup", 1);
            template.hasResourceProperties("AWS::Logs::LogGroup", {
                LogGroupName: "/ecs/benchling-webhook",
            });
        });
    });
});
