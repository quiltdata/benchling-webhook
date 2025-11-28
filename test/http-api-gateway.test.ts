import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import { HttpApiGateway } from "../lib/http-api-gateway";
import { ProfileConfig } from "../lib/types/config";

describe("HttpApiGateway", () => {
    let stack: cdk.Stack;
    let vpc: ec2.IVpc;
    let serviceSecurityGroup: ec2.ISecurityGroup;
    let cloudMapService: servicediscovery.Service;
    let mockConfig: ProfileConfig;

    beforeEach(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");

        vpc = new ec2.Vpc(stack, "TestVpc", { maxAzs: 2 });
        serviceSecurityGroup = new ec2.SecurityGroup(stack, "ServiceSG", {
            vpc,
        });

        const namespace = new servicediscovery.PrivateDnsNamespace(stack, "Namespace", {
            name: "benchling.local",
            vpc,
        });

        cloudMapService = namespace.createService("Service", {
            dnsRecordType: servicediscovery.DnsRecordType.A,
        });

        mockConfig = {
            quilt: {
                stackArn: "arn:aws:cloudformation:us-west-2:987654321098:stack/quilt/def456",
                catalog: "https://catalog.example.org",
                database: "test_db",
                queueUrl: "https://sqs.us-west-2.amazonaws.com/987654321098/test-queue",
                region: "us-west-2",
            },
            benchling: {
                tenant: "test-tenant",
                clientId: "client_test",
                clientSecret: "secret_test",
                appDefinitionId: "app_test",
                secretArn: "arn:aws:secretsmanager:us-west-2:987654321098:secret:benchling",
            },
            packages: {
                bucket: "test-packages",
                prefix: "test",
                metadataKey: "test_id",
            },
            deployment: {
                region: "us-west-2",
            },
            _metadata: {
                version: "0.7.0",
                createdAt: "2025-11-04T12:00:00Z",
                updatedAt: "2025-11-04T12:00:00Z",
                source: "cli",
            },
        };
    });

    test("creates HTTP API with VPC link and service discovery integration", () => {
        new HttpApiGateway(stack, "TestApiGateway", {
            vpc,
            cloudMapService,
            serviceSecurityGroup,
            config: mockConfig,
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
            Name: "BenchlingWebhookHttpAPI",
            ProtocolType: "HTTP",
        });

        template.hasResourceProperties("AWS::ApiGatewayV2::VpcLink", {
            Name: "benchling-webhook-vpclink",
        });

        template.hasResourceProperties("AWS::ApiGatewayV2::Integration", {
            IntegrationType: "HTTP_PROXY",
            ConnectionType: "VPC_LINK",
        });
    });

    test("configures routes for webhook and health endpoints", () => {
        new HttpApiGateway(stack, "TestApiGateway", {
            vpc,
            cloudMapService,
            serviceSecurityGroup,
            config: mockConfig,
        });

        const template = Template.fromStack(stack);

        // Check for root path (GET /)
        template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
            RouteKey: "GET /",
        });

        // Check for health check routes
        template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
            RouteKey: "GET /health",
        });

        // Check for webhook routes (event, lifecycle, canvas)
        template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
            RouteKey: "POST /event",
        });
    });

    test("enables access logs for default stage", () => {
        new HttpApiGateway(stack, "TestApiGateway", {
            vpc,
            cloudMapService,
            serviceSecurityGroup,
            config: mockConfig,
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::Logs::LogGroup", {
            LogGroupName: "/aws/apigateway/benchling-webhook-http",
            RetentionInDays: 7,
        });

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
});
