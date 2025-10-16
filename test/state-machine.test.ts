import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import { WebhookStateMachine } from "../lib/webhook-state-machine";

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
            benchlingTenant: "test-tenant",
            webhookAllowList: "203.0.113.10",
        });

        template = Template.fromStack(stack);
    });

    test("creates state machines", () => {
        template.resourceCountIs("AWS::StepFunctions::StateMachine", 2);
    });

    test("creates log group", () => {
        template.hasResourceProperties("AWS::Logs::LogGroup", {
            RetentionInDays: 731,
        });
    });

    test.skip("state machine has correct states", () => {
        template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
            DefinitionString: {
                "Fn::Join": [
                    "",
                    Match.arrayWith([
                        Match.stringLikeRegexp(".*SetupVariables.*"),
                        Match.stringLikeRegexp(".*WriteToMessageS3.*"),
                        Match.stringLikeRegexp(".*FetchEntry.*"),
                        Match.stringLikeRegexp(".*WriteToEntryDataS3.*"),
                        Match.stringLikeRegexp(".*SendToSQS.*"),
                    ]),
                ],
            },
        });
    });

    test("state machine has HTTP task", () => {
        template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
            DefinitionString: {
                "Fn::Join": [
                    "",
                    Match.arrayWith([
                        Match.stringLikeRegexp(".*arn:aws:states:::http:invoke.*"),
                    ]),
                ],
            },
        });
    });
});
