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
        const configWithIpFilter = createMockConfig({
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

        // Verify resource policy is created with IP conditions
        ipFilterTemplate.hasResourceProperties("AWS::ApiGateway::RestApi", {
            Policy: Match.objectLike({
                Statement: Match.arrayWith([
                    // All endpoints allowed with IP filtering
                    // Using greedy path variable {proxy+}, FastAPI handles routing
                    Match.objectLike({
                        Effect: "Allow",
                        Action: "execute-api:Invoke",
                        Resource: "execute-api:/*",
                    }),
                ]),
            }),
        });

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
});
