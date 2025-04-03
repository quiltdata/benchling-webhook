import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import { Template } from "aws-cdk-lib/assertions";
import { PackagingStateMachine } from "../lib/packaging-state-machine";

describe("PackagingStateMachine", () => {
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

    test("creates export workflow", () => {
        const stateMachine = new PackagingStateMachine(stack, "TestPackaging", {
            bucket,
            prefix: "test",
            benchlingConnection,
            queueName: "test-queue",
            region: "us-west-2",
            account: "123456789012"
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
            DefinitionString: {
                "Fn::Join": [
                    "",
                    expect.arrayContaining([
                        expect.stringContaining("FetchEntry"),
                        expect.stringContaining("ExportEntry"),
                        expect.stringContaining("PollExportStatus")
                    ])
                ]
            }
        });
    });

    test("creates lambda functions", () => {
        new PackagingStateMachine(stack, "TestPackaging", {
            bucket,
            prefix: "test",
            benchlingConnection,
            queueName: "test-queue", 
            region: "us-west-2",
            account: "123456789012"
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::Lambda::Function", {
            Handler: "index.handler",
            Runtime: "nodejs18.x",
            Architecture: "arm64"
        });
    });
});
