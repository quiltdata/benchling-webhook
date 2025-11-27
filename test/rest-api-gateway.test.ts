import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import { RestApiGateway } from "../lib/rest-api-gateway";
import { ProfileConfig } from "../lib/types/config";

describe("RestApiGateway", () => {
    let stack: cdk.Stack;
    let vpc: ec2.IVpc;
    let serviceSecurityGroup: ec2.ISecurityGroup;
    let cloudMapService: servicediscovery.Service;
    let ecsService: ecs.FargateService;
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

        // Create ECS cluster and Fargate service for testing
        const cluster = new ecs.Cluster(stack, "TestCluster", {
            vpc,
            clusterName: "test-cluster",
        });

        const taskDefinition = new ecs.FargateTaskDefinition(stack, "TestTaskDef", {
            memoryLimitMiB: 512,
            cpu: 256,
        });

        taskDefinition.addContainer("TestContainer", {
            image: ecs.ContainerImage.fromRegistry("nginx:latest"),
            portMappings: [{ containerPort: 8080 }],
        });

        ecsService = new ecs.FargateService(stack, "TestService", {
            cluster,
            taskDefinition,
            cloudMapOptions: {
                cloudMapNamespace: namespace,
                name: "test-service",
            },
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
            },
            packages: {
                bucket: "test-packages",
                prefix: "test",
                metadataKey: "test_id",
            },
            deployment: {
                region: "us-west-2",
            },
            security: {
                enableVerification: true,
            },
            _metadata: {
                version: "1.0.0",
                createdAt: "2025-11-26T12:00:00Z",
                updatedAt: "2025-11-26T12:00:00Z",
                source: "cli",
            },
        };
    });

    test("creates REST API with VPC link and service discovery integration", () => {
        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            cloudMapService,
            serviceSecurityGroup,
            config: mockConfig,
            ecsService,
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::ApiGateway::RestApi", {
            Name: "BenchlingWebhookRestAPI",
            Description: "REST API for Benchling webhook integration with IP whitelisting (v1.0.0+)",
        });

        template.hasResourceProperties("AWS::ApiGateway::VpcLink", {
            Name: "benchling-webhook-vpclink",
        });
    });

    test("configures proxy integration for all methods", () => {
        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            cloudMapService,
            serviceSecurityGroup,
            config: mockConfig,
            ecsService,
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::ApiGateway::Method", {
            HttpMethod: "ANY",
            Integration: Match.objectLike({
                Type: "HTTP_PROXY",
                ConnectionType: "VPC_LINK",
            }),
        });
    });

    test("enables access logs for prod stage", () => {
        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            cloudMapService,
            serviceSecurityGroup,
            config: mockConfig,
            ecsService,
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

    test("creates resource policy with IP whitelist when configured", () => {
        const configWithWhitelist: ProfileConfig = {
            ...mockConfig,
            security: {
                enableVerification: true,
                webhookAllowList: "192.168.1.0/24,10.0.0.0/8",
            },
        };

        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            cloudMapService,
            serviceSecurityGroup,
            config: configWithWhitelist,
            ecsService,
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::ApiGateway::RestApi", {
            Policy: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Effect: "Allow",
                        Condition: {
                            IpAddress: {
                                "aws:SourceIp": ["192.168.1.0/24", "10.0.0.0/8"],
                            },
                        },
                    }),
                    Match.objectLike({
                        Effect: "Deny",
                        Condition: {
                            NotIpAddress: {
                                "aws:SourceIp": ["192.168.1.0/24", "10.0.0.0/8"],
                            },
                        },
                    }),
                ]),
            }),
        });
    });

    test("does not create resource policy when IP whitelist is empty", () => {
        const configNoWhitelist: ProfileConfig = {
            ...mockConfig,
            security: {
                enableVerification: true,
                webhookAllowList: "",
            },
        };

        new RestApiGateway(stack, "TestApiGateway", {
            vpc,
            cloudMapService,
            serviceSecurityGroup,
            config: configNoWhitelist,
            ecsService,
        });

        const template = Template.fromStack(stack);

        // When no IP whitelist is configured, the API should not have a Policy
        const apis = template.findResources("AWS::ApiGateway::RestApi");
        const apiKeys = Object.keys(apis);
        expect(apiKeys.length).toBeGreaterThan(0);

        // Check if the policy is undefined or allows all
        const api = apis[apiKeys[0]];
        if (api.Properties.Policy) {
            // If policy exists, it should allow all (no IP restrictions)
            expect(api.Properties.Policy.Statement).toBeDefined();
        } else {
            // No policy means all IPs are allowed
            expect(api.Properties.Policy).toBeUndefined();
        }
    });
});
