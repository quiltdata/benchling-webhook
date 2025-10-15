import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";

export interface WebhookApiProps {
    stateMachine: stepfunctions.StateMachine;
    webhookAllowList?: string;
}

export class WebhookApi {
    public readonly api: apigateway.RestApi;

    constructor(
        scope: Construct,
        id: string,
        props: WebhookApiProps,
    ) {
        const logGroup = new logs.LogGroup(scope, "ApiGatewayAccessLogs");
        const apiRole = this.createApiRole(scope, props.stateMachine);
        this.createCloudWatchRole(scope);

        // Parse IP allowlist for resource policy
        const allowedIps = props.webhookAllowList
            ? props.webhookAllowList.split(",").map((ip) => ip.trim())
            : [];

        // Create resource policy for IP filtering at the edge
        // This blocks requests from non-allowlisted IPs before any AWS service is invoked
        const policyDocument = this.createResourcePolicy(allowedIps);

        this.api = new apigateway.RestApi(scope, "BenchlingWebhookAPI", {
            restApiName: "BenchlingWebhookAPI",
            policy: policyDocument,
            deployOptions: {
                stageName: "prod",
                accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
                methodOptions: {
                    "/*/*": {
                        loggingLevel: apigateway.MethodLoggingLevel.INFO,
                        dataTraceEnabled: true,
                    },
                },
            },
        });

        this.addWebhookEndpoints(props.stateMachine, apiRole);
    }

    private createResourcePolicy(allowedIps: string[]): iam.PolicyDocument | undefined {
        if (allowedIps.length === 0) {
            return undefined;
        }

        return new iam.PolicyDocument({
            statements: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    principals: [new iam.AnyPrincipal()],
                    actions: ["execute-api:Invoke"],
                    resources: ["execute-api:/*"],
                    conditions: {
                        IpAddress: {
                            "aws:SourceIp": allowedIps,
                        },
                    },
                }),
            ],
        });
    }

    private createCloudWatchRole(scope: Construct): iam.Role {
        const cloudWatchRole = new iam.Role(scope, "ApiGatewayCloudWatchRole", {
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    "service-role/AmazonAPIGatewayPushToCloudWatchLogs",
                ),
            ],
        });

        new apigateway.CfnAccount(scope, "ApiGatewayAccount", {
            cloudWatchRoleArn: cloudWatchRole.roleArn,
        });

        return cloudWatchRole;
    }

    private createApiRole(
        scope: Construct,
        stateMachine: stepfunctions.StateMachine,
    ): iam.Role {
        const role = new iam.Role(scope, "ApiGatewayStepFunctionsRole", {
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        });

        role.addToPolicy(
            new iam.PolicyStatement({
                actions: ["states:StartExecution"],
                resources: [stateMachine.stateMachineArn],
            }),
        );

        return role;
    }

    private addWebhookEndpoints(
        stateMachine: stepfunctions.StateMachine,
        apiRole: iam.Role,
    ): void {
        const sfnIntegration = new apigateway.AwsIntegration({
            service: "states",
            action: "StartExecution",
            integrationHttpMethod: "POST",
            options: {
                credentialsRole: apiRole,
                requestTemplates: {
                    "application/json": `{
                        "stateMachineArn": "${stateMachine.stateMachineArn}",
                        "input": "{\\"bodyBase64\\":\\"$util.base64Encode($input.body)\\",\\"headers\\":{\\"webhook-id\\":\\"$util.escapeJavaScript($input.params('webhook-id'))\\",\\"webhook-timestamp\\":\\"$util.escapeJavaScript($input.params('webhook-timestamp'))\\",\\"webhook-signature\\":\\"$util.escapeJavaScript($input.params('webhook-signature'))\\"},\\"sourceIp\\":\\"$context.identity.sourceIp\\"}",
                        "name": "$context.requestId"
                    }`,
                },
                integrationResponses: [
                    {
                        statusCode: "202",
                        responseTemplates: {
                            "application/json": `{
    "status": "accepted",
    "message": "Webhook received and processing started",
    "executionArn": "$util.escapeJavaScript($input.path('$.executionArn'))"
}`,
                        },
                    },
                    {
                        selectionPattern: "4\\d{2}",
                        statusCode: "400",
                        responseTemplates: {
                            "application/json": JSON.stringify({
                                error: "Bad request",
                                message: "Invalid webhook payload"
                            }),
                        },
                    },
                    {
                        selectionPattern: "5\\d{2}",
                        statusCode: "500",
                        responseTemplates: {
                            "application/json": JSON.stringify({
                                error: "Internal server error",
                                message: "Failed to start webhook processing"
                            }),
                        },
                    },
                ],
            },
        });

        const endpoints = ["event", "canvas", "lifecycle", "health"];
        endpoints.forEach((endpoint) => {
            const resource = this.api.root.addResource(endpoint);
            resource.addMethod("POST", sfnIntegration, {
                methodResponses: [
                    { statusCode: "202" },
                    { statusCode: "400" },
                    { statusCode: "500" },
                ],
            });
        });
    }
}
