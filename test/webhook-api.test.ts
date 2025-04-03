import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { WebhookApi } from "../lib/webhook-api";

describe("WebhookApi", () => {
    let stack: cdk.Stack;
    let template: Template;

    beforeEach(() => {
        stack = new cdk.Stack();
        const stateMachine = new stepfunctions.StateMachine(stack, "TestStateMachine", {
            definitionBody: stepfunctions.DefinitionBody.fromChainable(
                new stepfunctions.Pass(stack, "TestPass"),
            ),
        });
        new WebhookApi(stack, "TestApi", stateMachine);
        template = Template.fromStack(stack);
    });

    test("creates REST API", () => {
        template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
    });

    test("creates CloudWatch role", () => {
        template.hasResourceProperties("AWS::IAM::Role", {
            AssumeRolePolicyDocument: {
                Statement: [
                    {
                        Action: "sts:AssumeRole",
                        Effect: "Allow",
                        Principal: {
                            Service: "apigateway.amazonaws.com",
                        },
                    },
                ],
            },
            ManagedPolicyArns: [
                {
                    "Fn::Join": [
                        "",
                        [
                            "arn:",
                            { Ref: "AWS::Partition" },
                            ":iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs",
                        ],
                    ],
                },
            ],
        });
    });

    test.skip("creates webhook endpoints", () => {
        const endpoints = ["event", "canvas", "lifecycle", "health"];
        endpoints.forEach(endpoint => {
            template.hasResourceProperties("AWS::ApiGateway::Resource", {
                PathPart: endpoint,
            });
            template.hasResourceProperties("AWS::ApiGateway::Method", {
                HttpMethod: "POST",
                ResourceId: {
                    Ref: expect.stringMatching(new RegExp(`${endpoint}.*Resource`)),
                },
            });
        });
    });
});
