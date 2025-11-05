import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";

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
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
                logLevel: "INFO",
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

            // Should create API Gateway with prod stage
            template.hasResourceProperties("AWS::ApiGateway::Stage", {
                StageName: "prod",
            });
        });

        test("creates stack with image tag parameter", () => {
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
                imageTag: "v0.6.3",
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
            expect(() => {
                new BenchlingWebhookStack(app, "TestStack", {
                    quiltStackArn: "",
                    benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                    env: {
                        account: "123456789012",
                        region: "us-east-1",
                    },
                });
            }).toThrow("Secrets-only mode");
        });

        test("throws error when missing benchling secret", () => {
            expect(() => {
                new BenchlingWebhookStack(app, "TestStack", {
                    quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123",
                    benchlingSecret: "",
                    env: {
                        account: "123456789012",
                        region: "us-east-1",
                    },
                });
            }).toThrow("Secrets-only mode");
        });
    });

    describe("CloudFormation Parameters", () => {
        test("creates QuiltStackARN parameter", () => {
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
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
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "quiltdata/benchling-webhook/default/tenant",
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            const parameters = template.toJSON().Parameters;

            expect(parameters.BenchlingSecret).toBeDefined();
            expect(parameters.BenchlingSecret.Type).toBe("String");
            expect(parameters.BenchlingSecret.Description).toContain("Secrets Manager secret");
        });

        test("creates LogLevel parameter with allowed values", () => {
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
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
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
                imageTag: "latest",
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
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
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
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
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

        test("creates API Gateway REST API", () => {
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ApiGateway::RestApi", {
                Name: "BenchlingWebhookAPI",
            });
        });

        test("creates ECR repository when requested", () => {
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
                createEcrRepository: true,
                ecrRepositoryName: "test-repo",
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ECR::Repository", {
                RepositoryName: "test-repo",
            });
        });
    });

    describe("Environment-Specific Configuration", () => {
        test("prod configuration uses semantic versioning", () => {
            const stack = new BenchlingWebhookStack(app, "ProdStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/prod-quilt-stack/abc123",
                benchlingSecret: "quiltdata/benchling-webhook/default/prod-tenant",
                imageTag: "v0.6.3",
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
            const stack = new BenchlingWebhookStack(app, "DevStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/dev-quilt-stack/xyz789",
                benchlingSecret: "quiltdata/benchling-webhook/dev/dev-tenant",
                imageTag: "latest",
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
            // Create dev stack
            const devStack = new BenchlingWebhookStack(app, "DevStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/dev-quilt-stack/xyz789",
                benchlingSecret: "quiltdata/benchling-webhook/dev/tenant",
                imageTag: "latest",
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            // Create prod stack
            const prodStack = new BenchlingWebhookStack(app, "ProdStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/prod-quilt-stack/abc123",
                benchlingSecret: "quiltdata/benchling-webhook/default/tenant",
                imageTag: "v0.6.3",
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
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
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
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
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
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.hasOutput("ApiGatewayId", {
                Description: "API Gateway REST API ID",
            });
        });

        test("exports Load Balancer DNS", () => {
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            template.hasOutput("LoadBalancerDNS", {
                Description: "Application Load Balancer DNS name for direct testing",
            });
        });
    });

    describe("Auto-scaling", () => {
        test("configures auto-scaling for service", () => {
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
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
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
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
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-quilt-stack/abc123",
                benchlingSecret: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-benchling-secret",
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);

            // Should have at least 2 log groups (API Gateway + ECS)
            template.resourceCountIs("AWS::Logs::LogGroup", 2);
        });
    });
});
