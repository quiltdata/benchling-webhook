import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";

export class WebhookApi {
    public readonly api: apigateway.RestApi;

    constructor(
        scope: Construct,
        id: string,
        stateMachine: stepfunctions.StateMachine
    ) {
        const logGroup = new logs.LogGroup(scope, "ApiGatewayAccessLogs");
        const apiRole = this.createApiRole(scope, stateMachine);
        const cloudWatchRole = this.createCloudWatchRole(scope);

        this.api = new apigateway.RestApi(scope, "BenchlingWebhookAPI", {
            restApiName: "BenchlingWebhookAPI",
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

        this.addWebhookEndpoints(stateMachine, apiRole);
    }

    private createCloudWatchRole(scope: Construct): iam.Role {
        const cloudWatchRole = new iam.Role(scope, "ApiGatewayCloudWatchRole", {
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    "service-role/AmazonAPIGatewayPushToCloudWatchLogs"
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
        stateMachine: stepfunctions.StateMachine
    ): iam.Role {
        const role = new iam.Role(scope, "ApiGatewayStepFunctionsRole", {
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        });

        role.addToPolicy(
            new iam.PolicyStatement({
                actions: ["states:StartExecution"],
                resources: [stateMachine.stateMachineArn],
            })
        );

        return role;
    }

    private addWebhookEndpoints(
        stateMachine: stepfunctions.StateMachine,
        apiRole: iam.Role
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
                        "input": "$util.escapeJavaScript($input.json('$'))",
                        "name": "$context.requestId"
                    }`,
                },
                integrationResponses: [
                    {
                        statusCode: "200",
                        responseTemplates: {
                            "application/json": `
                            #set($execution = $input.json('$'))
                            #if($execution.status == "RUNNING")
                                {"status": "success", "executionArn": "$execution.executionArn"}
                            #else
                                #set($context.responseOverride.status = 500)
                                {"error": "State machine execution failed", "cause": "Check CloudWatch logs for details"}
                            #end
                            `
                        },
                    },
                    {
                        selectionPattern: "4\\d{2}",
                        statusCode: "400",
                        responseTemplates: {
                            "application/json": JSON.stringify({ error: "Bad request" }),
                        },
                    },
                    {
                        selectionPattern: "5\\d{2}",
                        statusCode: "500",
                        responseTemplates: {
                            "application/json": JSON.stringify({
                                error: "Internal server error",
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
                    { statusCode: "200" },
                    { statusCode: "400" },
                    { statusCode: "500" },
                ],
            });
        });
    }
}
