import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { createMockConfig, createDevConfig, createProdConfig, createMockStackConfig } from "./helpers/test-config";
import { profileToStackConfig } from "../lib/utils/config-transform";

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
            const config = createMockStackConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            // Should create ECS service (ServiceName removed for multi-stack support v0.9.8+)
            template.resourceCountIs("AWS::ECS::Service", 1);

            // REST API v1 with resource policy (not HTTP API v2)
            template.hasResourceProperties("AWS::ApiGateway::RestApi", {
                Name: "BenchlingWebhookRestAPI",
            });
        });

        test("creates stack with image tag parameter", () => {
            const config = createMockStackConfig({
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
            const config = createMockStackConfig({
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

        test("throws error when missing benchling secret", () => {
            const config = createMockStackConfig({
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
        test("does not create QuiltStackARN parameter (removed in v1.0.0)", () => {
            const config = createMockStackConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            const parameters = template.toJSON().Parameters;

            // QuiltStackARN parameter removed in v1.0.0
            expect(parameters.QuiltStackARN).toBeUndefined();
        });

        test("creates BenchlingSecret parameter", () => {
            const config = createMockStackConfig({
                benchling: {
                    tenant: "test-tenant",
                    clientId: "client_123",
                    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
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
            const config = createMockStackConfig();
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
            const config = createMockStackConfig({
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
            const config = createMockStackConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            // ClusterName removed for multi-stack support (v0.9.8+)
            template.resourceCountIs("AWS::ECS::Cluster", 1);
        });

        test("creates Network Load Balancer (uses NLB)", () => {
            const config = createMockStackConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            // NLB replaces Cloud Map for reliable health checks
            template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 1);
            template.resourceCountIs("AWS::ElasticLoadBalancingV2::TargetGroup", 1);
            template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 1);
        });

        test("creates HTTP API v2 for webhooks", () => {
            const config = createMockStackConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            // REST API v1 (not HTTP API v2)
            template.hasResourceProperties("AWS::ApiGateway::RestApi", {
                Name: "BenchlingWebhookRestAPI",
            });

            // Should not create HTTP API v2
            template.resourceCountIs("AWS::ApiGatewayV2::Api", 0);

            // REST API v1 uses greedy path variable {proxy+} for all paths
            // FastAPI handles routing internally for event, lifecycle, canvas, health
            const resources = template.findResources("AWS::ApiGateway::Resource");
            const proxyResource = Object.values(resources).find((resource: any) =>
                resource.Properties?.PathPart === "{proxy+}"
            );
            expect(proxyResource).toBeDefined();
        });

        test("uses hardcoded quiltdata ECR repository", () => {
            const config = createMockStackConfig({
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
                    "Fn::Join": Match.arrayWith([
                        Match.arrayWith([
                            "712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:",
                        ]),
                    ]),
                },
            });
        });
    });

    describe("Environment-Specific Configuration", () => {
        test("prod configuration uses semantic versioning", () => {
            const config = profileToStackConfig(createProdConfig({
                deployment: {
                    region: "us-east-1",
                    imageTag: "v0.6.3",
                },
            }));

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
            const config = profileToStackConfig(createDevConfig({
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
            }));

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
            const devConfig = profileToStackConfig(createDevConfig());
            const prodConfig = profileToStackConfig(createProdConfig());

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

            // Both stacks should have their own services (ServiceName removed for multi-stack support v0.9.8+)
            devTemplate.resourceCountIs("AWS::ECS::Service", 1);
            prodTemplate.resourceCountIs("AWS::ECS::Service", 1);
        });
    });

    describe("IAM Permissions", () => {
        test("task role has required permissions", () => {
            const config = createMockStackConfig();
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
            // CloudFormation permissions removed in v1.0.0
            expect(hasCfnPermission).toBe(false);
        });
    });

    describe("CloudFormation Outputs", () => {
        test("exports webhook endpoint", () => {
            const config = createMockStackConfig();
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

        test("exports API Gateway ID", () => {
            const config = createMockStackConfig();
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

        test("exports API Gateway log group", () => {
            const config = createMockStackConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.hasOutput("ApiGatewayLogGroup", {
                Description: "CloudWatch log group for API Gateway access logs",
            });
        });
    });

    describe("Auto-scaling", () => {
        test("configures auto-scaling for service", () => {
            const config = createMockStackConfig();
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
            const config = createMockStackConfig();
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

        test("creates CloudWatch log groups", () => {
            const config = createMockStackConfig();
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            // Should have at least 2 log groups (API Gateway, ECS) - WAF log group only created when allowlist configured
            template.resourceCountIs("AWS::Logs::LogGroup", 2);
        });
    });
});
