import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
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
            benchlingTenant: "test-tenant",
        });
        template = Template.fromStack(stack);
    });

    test("creates Benchling connection", () => {
        template.hasResourceProperties("AWS::Events::Connection", {
            AuthorizationType: "OAUTH_CLIENT_CREDENTIALS",
            AuthParameters: {
                OAuthParameters: {
                    AuthorizationEndpoint: "https://test-tenant.benchling.com/api/v2/token",
                    HttpMethod: "POST",
                },
            },
        });
    });

    test("creates state machine", () => {
        template.resourceCountIs("AWS::StepFunctions::StateMachine", 1);
    });

    test("creates API Gateway", () => {
        template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
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
                benchlingTenant: "test-tenant",
            });
        }).toThrow("Prefix should not contain a '/' character.");
    });
});
