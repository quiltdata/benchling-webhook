import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { createMockStackConfig } from "./helpers/test-config";

describe("BenchlingWebhookStack", () => {
    let template: Template;

    beforeEach(() => {
        const app = new cdk.App();
        const config = createMockStackConfig();
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
        // ClusterName removed to allow multiple stacks per account (v0.9.8+)
        template.hasResourceProperties("AWS::ECS::Cluster", {
            ClusterSettings: [{
                Name: "containerInsights",
                Value: "enabled",
            }],
        });
    });

    test("creates Fargate service", () => {
        // ServiceName removed to allow multiple stacks per account (v0.9.8+)
        template.hasResourceProperties("AWS::ECS::Service", {
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
        template.resourceCountIs("AWS::Logs::LogGroup", 2); // API Gateway, container logs (no WAF log group without allowlist)
    });

    test("creates API Gateway with correct configuration", () => {
        // REST API v1 (not HTTP API v2) for resource policy support
        template.hasResourceProperties("AWS::ApiGateway::RestApi", {
            Name: "BenchlingWebhookRestAPI",
        });

        // Should not create HTTP API v2
        template.resourceCountIs("AWS::ApiGatewayV2::Api", 0);

        // REST API uses AWS::ApiGateway::Resource and AWS::ApiGateway::Method
        // Check that greedy path variable proxy+ exists (handles all paths in FastAPI)
        template.hasResourceProperties("AWS::ApiGateway::Resource", {
            PathPart: "{proxy+}",
        });

        // Verify REST API has resource policy
        template.hasResourceProperties("AWS::ApiGateway::RestApi", {
            Policy: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Effect: "Allow",
                        Action: "execute-api:Invoke",
                    }),
                ]),
            }),
        });
    });

    test("does NOT create WAF (v1.0.0 uses resource policy instead)", () => {
        // v1.0.0: WAF replaced by resource policy for cost savings
        template.resourceCountIs("AWS::WAFv2::WebACL", 0);
        template.resourceCountIs("AWS::WAFv2::IPSet", 0);
        template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 0);
    });

    test("uses resource policy for IP filtering when webhookAllowList is configured", () => {
        const app = new cdk.App();
        const configWithIpFilter = createMockStackConfig({
            security: {
                webhookAllowList: "192.168.1.0/24,10.0.0.0/8",
                enableVerification: true,
            },
        });
        const stack = new BenchlingWebhookStack(app, "TestStackWithIpFilter", {
            config: configWithIpFilter,
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
        });
        const ipFilterTemplate = Template.fromStack(stack);

        // Verify resource policy is created with SINGLE statement
        // Single statement applies IP filtering to ALL endpoints
        const restApiTemplate = ipFilterTemplate.findResources("AWS::ApiGateway::RestApi");
        const restApi = Object.values(restApiTemplate)[0];
        const statements = restApi.Properties.Policy.Statement;

        expect(statements).toHaveLength(1);

        // Verify single statement has IP conditions and applies to all endpoints
        const statement = statements[0];
        expect(statement).toBeDefined();
        expect(statement.Resource).toBe("execute-api:/*");
        expect(statement.Condition).toBeDefined();
        expect(statement.Condition.IpAddress["aws:SourceIp"]).toEqual([
            "192.168.1.0/24",
            "10.0.0.0/8",
        ]);

        // Verify NO WAF resources are created (replaced by resource policy)
        ipFilterTemplate.resourceCountIs("AWS::WAFv2::WebACL", 0);
        ipFilterTemplate.resourceCountIs("AWS::WAFv2::IPSet", 0);
        ipFilterTemplate.resourceCountIs("AWS::WAFv2::WebACLAssociation", 0);
    });

    test("creates VPC Link and Network Load Balancer", () => {
        // REST API v1 uses AWS::ApiGateway::VpcLink (not v2)
        template.resourceCountIs("AWS::ApiGateway::VpcLink", 1);
        // Should not have HTTP API v2 VpcLink
        template.resourceCountIs("AWS::ApiGatewayV2::VpcLink", 0);
        // NLB replaces Cloud Map for reliable health checks
        template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 1);
        template.resourceCountIs("AWS::ElasticLoadBalancingV2::TargetGroup", 1);
        template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 1);
    });

    test("does not create Cloud Map service (uses NLB)", () => {
        // NLB replaces Cloud Map for ECS service discovery
        template.resourceCountIs("AWS::ServiceDiscovery::PrivateDnsNamespace", 0);
        template.resourceCountIs("AWS::ServiceDiscovery::Service", 0);
    });

    test("throws error when missing required parameters", () => {
        const app = new cdk.App();
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

    test("creates task definition with correct configuration", () => {
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
            Cpu: "1024",
            Memory: "2048",
            NetworkMode: "awsvpc",
            RequiresCompatibilities: ["FARGATE"],
        });
    });

    test("configures auto-scaling", () => {
        template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget", {
            MinCapacity: 2,
            MaxCapacity: 10,
        });
    });

    test("creates outputs for webhook endpoint", () => {
        const outputs = template.toJSON().Outputs;
        expect(outputs.WebhookEndpoint).toBeDefined();
        expect(outputs.WebhookEndpoint.Description).toContain("Webhook endpoint URL");
    });

    test("creates VPC with private subnets", () => {
        template.hasResourceProperties("AWS::EC2::VPC", {
            CidrBlock: "10.0.0.0/16",
        });

        // Check for NAT Gateways (required for private subnets)
        template.resourceCountIs("AWS::EC2::NatGateway", 2);
    });

    describe("CloudFormation Parameter Defaults (Option A)", () => {
        test("uses config values as parameter defaults for required Quilt fields", () => {
            const app = new cdk.App();
            const config = createMockStackConfig({
                quilt: {
                    catalog: "test-catalog.quiltdata.com",
                    database: "test_database",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
            });
            const stack = new BenchlingWebhookStack(app, "TestStack", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const testTemplate = Template.fromStack(stack);

            // Verify parameters have correct defaults from config
            testTemplate.hasParameter("QuiltWebHost", {
                Default: "test-catalog.quiltdata.com",
            });
            testTemplate.hasParameter("AthenaUserDatabase", {
                Default: "test_database",
            });
            testTemplate.hasParameter("PackagerQueueUrl", {
                Default: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
            });
        });

        test("optional Quilt fields always default to empty string (not part of StackConfig)", () => {
            const app = new cdk.App();
            // Note: athenaUserWorkgroup and athenaResultsBucket are NOT part of StackConfig
            // They were removed during config streamlining. The stack creates parameters
            // with empty string defaults, which can be overridden at deployment time.
            const config = createMockStackConfig({
                quilt: {
                    catalog: "test.quiltdata.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
                    region: "us-east-1",
                },
            });
            const stack = new BenchlingWebhookStack(app, "TestStackOptional", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const testTemplate = Template.fromStack(stack);

            // Optional Quilt parameters always default to empty string
            // since they're not part of minimal StackConfig interface
            testTemplate.hasParameter("AthenaUserWorkgroup", {
                Default: "",
            });
        });

        test("uses empty string as default when optional config fields are missing", () => {
            const app = new cdk.App();
            const config = createMockStackConfig({
                quilt: {
                    catalog: "test.quiltdata.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
                    region: "us-east-1",
                    // Optional fields intentionally omitted
                },
            });
            const stack = new BenchlingWebhookStack(app, "TestStackNoOptional", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const testTemplate = Template.fromStack(stack);

            // Verify optional parameters default to empty string when not configured
            testTemplate.hasParameter("AthenaUserWorkgroup", {
                Default: "",
            });
        });

        test("creates fallback Athena workgroup only when no Quilt workgroup is provided", () => {
            const app = new cdk.App();
            const config = createMockStackConfig({
                quilt: {
                    catalog: "test.quiltdata.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
                    region: "us-east-1",
                },
            });
            const stack = new BenchlingWebhookStack(app, "TestStackWorkgroupCondition", {
                config,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const testTemplate = Template.fromStack(stack);

            testTemplate.hasCondition("CreateAthenaWorkgroup", {
                "Fn::Equals": [
                    { Ref: "AthenaUserWorkgroup" },
                    "",
                ],
            });

            testTemplate.hasResourceProperties("AWS::Athena::WorkGroup", {
                Name: { "Fn::Sub": "${AWS::StackName}-athena-workgroup" },
                WorkGroupConfiguration: {
                    EnforceWorkGroupConfiguration: true,
                    PublishCloudWatchMetricsEnabled: true,
                },
                State: "ENABLED",
            });

            const resources = testTemplate.findResources("AWS::Athena::WorkGroup");
            const resource = Object.values(resources)[0] as { Condition?: string };
            expect(resource?.Condition).toBe("CreateAthenaWorkgroup");
        });

        test("validates required Quilt config fields are present", () => {
            const app = new cdk.App();
            const config = createMockStackConfig({
                quilt: {
                    catalog: "",  // Missing required field
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
                    region: "us-east-1",
                },
            });

            expect(() => {
                new BenchlingWebhookStack(app, "TestStackValidation", {
                    config,
                    env: {
                        account: "123456789012",
                        region: "us-east-1",
                    },
                });
            }).toThrow("Configuration validation failed");

            // Check the error message contains the missing field
            try {
                const app2 = new cdk.App();
                new BenchlingWebhookStack(app2, "TestStackValidation2", {
                    config,
                    env: {
                        account: "123456789012",
                        region: "us-east-1",
                    },
                });
            } catch (error: any) {
                expect(error.message).toContain("config.quilt.catalog");
            }
        });

        test("validates all required Quilt fields and shows all missing fields", () => {
            const app = new cdk.App();
            const config = createMockStackConfig({
                benchling: {
                    secretArn: "",  // Missing required Benchling field
                    tenant: "test",
                    clientId: "client_123",
                    appDefinitionId: "app_123",
                },
                quilt: {
                    catalog: "",  // Missing
                    database: "",  // Missing
                    queueUrl: "",  // Missing
                    region: "us-east-1",
                },
            });

            expect(() => {
                new BenchlingWebhookStack(app, "TestStackAllValidation", {
                    config,
                    env: {
                        account: "123456789012",
                        region: "us-east-1",
                    },
                });
            }).toThrow("Configuration validation failed");

            try {
                const app2 = new cdk.App();
                new BenchlingWebhookStack(app2, "TestStackAllValidation2", {
                    config,
                    env: {
                        account: "123456789012",
                        region: "us-east-1",
                    },
                });
            } catch (error: any) {
                // Verify all missing fields are listed
                expect(error.message).toContain("config.benchling.secretArn");
                expect(error.message).toContain("config.quilt.catalog");
                expect(error.message).toContain("config.quilt.database");
                expect(error.message).toContain("config.quilt.queueUrl");
            }
        });

        test("allows validation skip with SKIP_CONFIG_VALIDATION=true", () => {
            process.env.SKIP_CONFIG_VALIDATION = "true";

            const app = new cdk.App();
            const config = createMockStackConfig({
                benchling: {
                    secretArn: "",  // Would normally fail
                    tenant: "test",
                    clientId: "client_123",
                    appDefinitionId: "app_123",
                },
                quilt: {
                    catalog: "",
                    database: "",
                    queueUrl: "",
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
            }).not.toThrow();

            delete process.env.SKIP_CONFIG_VALIDATION;
        });
    });
});
