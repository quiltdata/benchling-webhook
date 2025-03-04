import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import { WebhookStateMachine } from "../lib/state-machine";

describe("WebhookStateMachine", () => {
    let stack: cdk.Stack;
    let template: Template;

    beforeEach(() => {
        stack = new cdk.Stack();
        const bucket = s3.Bucket.fromBucketName(stack, "TestBucket", "test-bucket");
        const benchlingConnection = new events.CfnConnection(stack, "TestConnection", {
            authorizationType: "OAUTH_CLIENT_CREDENTIALS",
            authParameters: {
                oAuthParameters: {
                    clientParameters: {
                        clientId: "test-id",
                        clientSecret: "test-secret",
                    },
                    authorizationEndpoint: "https://test.benchling.com/api/v2/token",
                    httpMethod: "POST",
                },
            },
        });

        new WebhookStateMachine(stack, "TestStateMachine", {
            bucket,
            prefix: "test",
            queueName: "test-queue",
            region: "us-west-2",
            account: "123456789012",
            benchlingConnection,
        });

        template = Template.fromStack(stack);
    });

    test("creates state machine", () => {
        template.resourceCountIs("AWS::StepFunctions::StateMachine", 1);
    });

    test("creates log group", () => {
        template.hasResourceProperties("AWS::Logs::LogGroup", {
            RetentionInDays: expect.any(Number),
        });
    });

    test("state machine has correct states", () => {
        template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
            DefinitionString: {
                "Fn::Join": expect.arrayContaining([
                    expect.arrayContaining([
                        expect.stringContaining("SetupVariables"),
                        expect.stringContaining("WriteToMessageS3"),
                        expect.stringContaining("FetchEntry"),
                        expect.stringContaining("WriteToEntryDataS3"),
                        expect.stringContaining("SendToSQS"),
                    ]),
                ]),
            },
        });
    });

    test("state machine has HTTP task", () => {
        template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
            DefinitionString: {
                "Fn::Join": expect.arrayContaining([
                    expect.arrayContaining([
                        expect.stringContaining("arn:aws:states:::http:invoke"),
                    ]),
                ]),
            },
        });
    });
});
