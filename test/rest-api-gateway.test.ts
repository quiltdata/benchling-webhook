import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { RestApiGateway } from "../lib/rest-api-gateway";
import { ProfileConfig } from "../lib/types/config";

describe("RestApiGateway", () => {
    let stack: cdk.Stack;
    let vpc: ec2.IVpc;
    let serviceSecurityGroup: ec2.ISecurityGroup;
    let networkLoadBalancer: elbv2.INetworkLoadBalancer;
    let nlbListener: elbv2.INetworkListener;
    let mockConfig: ProfileConfig;

    beforeEach(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");

        vpc = new ec2.Vpc(stack, "TestVpc", { maxAzs: 2 });
        serviceSecurityGroup = new ec2.SecurityGroup(stack, "ServiceSG", {
            vpc,
        });

        // Create mock NLB and listener for testing
        const nlb = new elbv2.NetworkLoadBalancer(stack, "TestNLB", {
            vpc,
            internetFacing: false,
        });
        networkLoadBalancer = nlb;

        const targetGroup = new elbv2.NetworkTargetGroup(stack, "TestTargetGroup", {
            vpc,
            port: 8080,
            protocol: elbv2.Protocol.TCP,
            targetType: elbv2.TargetType.IP,
        });

        nlbListener = nlb.addListener("TestListener", {
            port: 80,
            protocol: elbv2.Protocol.TCP,
            defaultTargetGroups: [targetGroup],
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

    test("creates REST API v1 with VPC link and NLB integration", () => {
        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            networkLoadBalancer,
            nlbListener,
            serviceSecurityGroup,
            config: mockConfig,
            stage: "prod",
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::ApiGateway::RestApi", {
            Name: "BenchlingWebhookRestAPI",
        });

        // VPC Link for REST API v1
        template.hasResourceProperties("AWS::ApiGateway::VpcLink", {
            Name: Match.stringLikeRegexp(".*VpcLink.*"),
        });
    });

    test("configures routes for webhook and health endpoints", () => {
        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            networkLoadBalancer,
            nlbListener,
            serviceSecurityGroup,
            config: mockConfig,
            stage: "prod",
        });

        const template = Template.fromStack(stack);

        // Check for webhook resource paths
        template.hasResourceProperties("AWS::ApiGateway::Resource", {
            PathPart: "event",
        });

        template.hasResourceProperties("AWS::ApiGateway::Resource", {
            PathPart: "lifecycle",
        });

        template.hasResourceProperties("AWS::ApiGateway::Resource", {
            PathPart: "canvas",
        });

        template.hasResourceProperties("AWS::ApiGateway::Resource", {
            PathPart: "health",
        });

        // Check for methods
        template.hasResourceProperties("AWS::ApiGateway::Method", {
            HttpMethod: "POST",
        });

        template.hasResourceProperties("AWS::ApiGateway::Method", {
            HttpMethod: "GET",
        });
    });

    test("enables access logs for stage", () => {
        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            networkLoadBalancer,
            nlbListener,
            serviceSecurityGroup,
            config: mockConfig,
            stage: "prod",
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::Logs::LogGroup", {
            LogGroupName: "/aws/apigateway/benchling-webhook-rest",
            RetentionInDays: 7,
        });

        template.hasResourceProperties("AWS::ApiGateway::Stage", {
            StageName: "prod",
            AccessLogSetting: Match.objectLike({
                DestinationArn: {
                    "Fn::GetAtt": [
                        Match.stringLikeRegexp("ApiGatewayAccessLogs.*"),
                        "Arn",
                    ],
                },
            }),
        });
    });

    test("creates resource policy with health endpoint exemption when no IP allowlist", () => {
        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            networkLoadBalancer,
            nlbListener,
            serviceSecurityGroup,
            config: mockConfig,
            stage: "prod",
        });

        const template = Template.fromStack(stack);

        // REST API should have a policy
        template.hasResourceProperties("AWS::ApiGateway::RestApi", {
            Policy: Match.objectLike({
                Statement: Match.arrayWith([
                    // Health endpoints allowed from anywhere
                    Match.objectLike({
                        Effect: "Allow",
                        Action: "execute-api:Invoke",
                        Resource: Match.arrayWith([
                            Match.stringLikeRegexp(".*GET/health.*"),
                        ]),
                    }),
                    // All endpoints allowed when no IP filtering
                    Match.objectLike({
                        Effect: "Allow",
                        Action: "execute-api:Invoke",
                        Resource: Match.arrayWith([
                            Match.stringLikeRegexp(".*POST/event.*"),
                        ]),
                    }),
                ]),
            }),
        });

        // Should NOT have IP address conditions when allowlist is empty
        const restApiTemplate = template.findResources("AWS::ApiGateway::RestApi");
        const restApi = Object.values(restApiTemplate)[0];
        const statements = restApi.Properties.Policy.Statement;

        // Find webhook statement (not health)
        const webhookStatement = statements.find((stmt: any) =>
            stmt.Resource &&
            stmt.Resource.some &&
            stmt.Resource.some((r: string) => r.includes("POST/event"))
        );

        // Should not have IpAddress condition
        expect(webhookStatement?.Condition?.IpAddress).toBeUndefined();
    });

    test("creates resource policy with IP filtering when webhookAllowList is configured", () => {
        const configWithIpFilter = {
            ...mockConfig,
            security: {
                webhookAllowList: "192.168.1.0/24,10.0.0.0/8",
                enableVerification: true,
            },
        };

        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            networkLoadBalancer,
            nlbListener,
            serviceSecurityGroup,
            config: configWithIpFilter,
            stage: "prod",
        });

        const template = Template.fromStack(stack);

        // REST API should have a policy with IP conditions
        template.hasResourceProperties("AWS::ApiGateway::RestApi", {
            Policy: Match.objectLike({
                Statement: Match.arrayWith([
                    // Health endpoints still allowed from anywhere
                    Match.objectLike({
                        Effect: "Allow",
                        Action: "execute-api:Invoke",
                        Resource: Match.arrayWith([
                            Match.stringLikeRegexp(".*GET/health.*"),
                        ]),
                    }),
                    // Webhook endpoints restricted by IP
                    Match.objectLike({
                        Effect: "Allow",
                        Action: "execute-api:Invoke",
                        Resource: Match.arrayWith([
                            Match.stringLikeRegexp(".*POST/event.*"),
                        ]),
                        Condition: {
                            IpAddress: {
                                "aws:SourceIp": ["192.168.1.0/24", "10.0.0.0/8"],
                            },
                        },
                    }),
                ]),
            }),
        });
    });

    test("does NOT create WAF resources (replaced by resource policy)", () => {
        const configWithIpFilter = {
            ...mockConfig,
            security: {
                webhookAllowList: "192.168.1.0/24",
                enableVerification: true,
            },
        };

        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            networkLoadBalancer,
            nlbListener,
            serviceSecurityGroup,
            config: configWithIpFilter,
            stage: "prod",
        });

        const template = Template.fromStack(stack);

        // WAF resources should NOT exist (v1.0.0 uses resource policy instead)
        template.resourceCountIs("AWS::WAFv2::WebACL", 0);
        template.resourceCountIs("AWS::WAFv2::IPSet", 0);
        template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 0);
    });

    test("uses specified stage in deployment", () => {
        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            networkLoadBalancer,
            nlbListener,
            serviceSecurityGroup,
            config: mockConfig,
            stage: "dev",
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::ApiGateway::Stage", {
            StageName: "dev",
        });
    });

    test("configures HTTP_PROXY integration to NLB", () => {
        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            networkLoadBalancer,
            nlbListener,
            serviceSecurityGroup,
            config: mockConfig,
            stage: "prod",
        });

        const template = Template.fromStack(stack);

        // Check integration configuration
        template.hasResourceProperties("AWS::ApiGateway::Method", {
            Integration: Match.objectLike({
                Type: "HTTP_PROXY",
                ConnectionType: "VPC_LINK",
                IntegrationHttpMethod: "ANY",
            }),
        });
    });
});
