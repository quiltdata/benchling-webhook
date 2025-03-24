import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";

describe("BenchlingWebhookStack", () => {
    let template: Template;

    beforeEach(() => {
        const app = new cdk.App();
        const stack = new BenchlingWebhookStack(app, "TestStack", {
            bucketName: "test-bucket",
            environment: "test",
            prefix: "test-prefix",
            queueName: "test-queue",
            benchlingClientId: "test-client-id",
            benchlingClientSecret: "test-client-secret",
        });
        template = Template.fromStack(stack);
    });

    test("creates Benchling connection", () => {
        template.hasResourceProperties("AWS::Events::Connection", {
            AuthorizationType: "OAUTH_CLIENT_CREDENTIALS",
            AuthParameters: {
                OAuthParameters: {
                    AuthorizationEndpoint: "https://test.benchling.com/api/v2/token",
                    HttpMethod: "POST",
                },
            },
        });
    });

    test("creates state machine", () => {
        template.resourceCountIs("AWS::StepFunctions::StateMachine", 1);
    });

    test("creates CloudWatch log groups", () => {
        template.resourceCountIs("AWS::Logs::LogGroup", 2); // One for API Gateway, one for Step Functions

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

        template.hasResourceProperties("AWS::ApiGateway::Method", {
            HttpMethod: "POST",
            AuthorizationType: "NONE",
            Integration: {
                IntegrationHttpMethod: "POST",
                Type: "AWS",
                Uri: {
                    "Fn::Join": [
                        "",
                        [
                            "arn:",
                            { "Ref": "AWS::Partition" },
                            ":apigateway:",
                            { "Ref": "AWS::Region" },
                            ":states:action/StartExecution",
                        ],
                    ],
                },
                RequestTemplates: {
                    "application/json": {
                        "Fn::Join": [
                            "",
                            [
                                Match.stringLikeRegexp(".*\"stateMachineArn\".*"),
                                { "Ref": "BenchlingWebhookStateMachine177934B3" },
                                Match.stringLikeRegexp(".*\"input\".*\\$input\\.json\\('\\$'\\).*"),
                            ],
                        ],
                    },
                },
            },
        });
    });

    test("throws error for invalid prefix", () => {
        const app = new cdk.App();
        expect(() => {
            new BenchlingWebhookStack(app, "TestStack", {
                bucketName: "test-bucket",
                environment: "test",
                prefix: "invalid/prefix",
                queueName: "test-queue",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-client-secret",
            });
        }).toThrow("Prefix should not contain a '/' character.");
    });

    test("creates IAM role with correct permissions", () => {
        template.hasResourceProperties("AWS::IAM::Role", {
            AssumeRolePolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: "sts:AssumeRole",
                        Effect: "Allow",
                        Principal: {
                            Service: "apigateway.amazonaws.com",
                        },
                    }),
                ]),
            }),
        });

        template.hasResourceProperties("AWS::IAM::Policy", {
            PolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: "states:StartExecution",
                        Effect: "Allow",
                    }),
                ]),
            }),
        });
    });
});
