import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import { Template } from "aws-cdk-lib/assertions";
import { WebhookStateMachine } from "../lib/webhook-state-machine";

describe("WebhookStateMachine", () => {
    let stack: cdk.Stack;
    let bucket: s3.Bucket;
    let benchlingConnection: events.CfnConnection;

    beforeEach(() => {
        stack = new cdk.Stack();
        bucket = new s3.Bucket(stack, "TestBucket");
        benchlingConnection = new events.CfnConnection(stack, "TestConnection", {
            authorizationType: "OAUTH_CLIENT_CREDENTIALS",
            authParameters: {
                oAuthParameters: {
                    clientParameters: {
                        clientId: "test-id",
                        clientSecret: "test-secret"
                    }
                }
            }
        });
    });

    test("handles entry updates", () => {
        const stateMachine = new WebhookStateMachine(stack, "TestStateMachine", {
            bucket,
            prefix: "test",
            benchlingConnection,
            queueName: "test-queue",
            region: "us-west-2",
            account: "123456789012",
            benchlingTenant: "test-tenant"
        });

        const template = Template.fromStack(stack);
        
        template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
            DefinitionString: {
                "Fn::Join": [
                    "",
                    expect.arrayContaining([
                        expect.stringContaining("CheckChannel"),
                        expect.stringContaining("events"),
                        expect.stringContaining("SetupEventMetadata")
                    ])
                ]
            }
        });
    });

    test("handles canvas creation", () => {
        const stateMachine = new WebhookStateMachine(stack, "TestStateMachine", {
            bucket,
            prefix: "test", 
            benchlingConnection,
            queueName: "test-queue",
            region: "us-west-2",
            account: "123456789012",
            benchlingTenant: "test-tenant"
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
            DefinitionString: {
                "Fn::Join": [
                    "",
                    expect.arrayContaining([
                        expect.stringContaining("v2-beta.canvas.created"),
                        expect.stringContaining("v2.canvas.initialized")
                    ])
                ]
            }
        });
    });
});
