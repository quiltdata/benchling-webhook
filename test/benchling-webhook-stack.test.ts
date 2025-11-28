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
        template.resourceCountIs("AWS::Logs::LogGroup", 3); // API Gateway, container logs, Lambda authorizer
    });

    test("creates API Gateway with correct configuration", () => {
        // HTTP API v2 (not REST API) for simpler routing
        template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
            Name: "BenchlingWebhookHttpAPI",
            ProtocolType: "HTTP",
        });

        // Should not create REST API (v1)
        template.resourceCountIs("AWS::ApiGateway::RestApi", 0);

        // HTTP API uses AWS::ApiGatewayV2::Route
        // HTTP API v2 creates multiple routes for different paths
        // Check that webhook routes exist (event, lifecycle, canvas)
        const routes = template.findResources("AWS::ApiGatewayV2::Route");
        const eventRoute = Object.values(routes).find((route: any) =>
            route.Properties?.RouteKey === "POST /event"
        );
        expect(eventRoute).toBeDefined();

        // Verify health check routes also exist
        template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
            RouteKey: "GET /health",
        });
    });

    test("creates Lambda authorizer for webhook authentication", () => {
        template.hasResourceProperties("AWS::Lambda::Function", {
            Runtime: "python3.12",
            Handler: "index.handler",
        });

        template.hasOutput("AuthorizerFunctionArn", Match.objectLike({
            Value: {
                "Fn::GetAtt": [
                    Match.stringLikeRegexp("WebhookAuthorizerFunction.*"),
                    "Arn",
                ],
            },
        }));

        template.hasOutput("AuthorizerLogGroup", Match.objectLike({
            Value: {
                Ref: Match.stringLikeRegexp("WebhookAuthorizerLogGroup.*"),
            },
        }));
    });

    test("creates VPC Link and Cloud Map service", () => {
        // HTTP API v2 uses AWS::ApiGatewayV2::VpcLink (not v1)
        template.resourceCountIs("AWS::ApiGatewayV2::VpcLink", 1);
        template.resourceCountIs("AWS::ServiceDiscovery::PrivateDnsNamespace", 1);
        template.resourceCountIs("AWS::ServiceDiscovery::Service", 1);
    });

    test("does not create Network Load Balancer (HTTP API v2 uses Cloud Map)", () => {
        // HTTP API v2 integrates directly with Cloud Map, no NLB needed
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
