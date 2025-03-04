import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";

import { Construct } from "constructs";
import * as logs from "aws-cdk-lib/aws-logs";

interface BenchlingWebhookStackProps extends cdk.StackProps {
    readonly bucketName: string;
    readonly environment: string;
    readonly prefix: string;
    readonly queueName: string;
    readonly benchlingClientId: string;
    readonly benchlingClientSecret: string;
    readonly benchlingTenant: string;
}

export class BenchlingWebhookStack extends cdk.Stack {
    private readonly bucket: s3.IBucket;
    private readonly stateMachine: stepfunctions.StateMachine;
    private readonly api: apigateway.RestApi;
    private readonly prefix: string;
    private readonly queueName: string;
    private readonly benchlingConnection: events.CfnConnection;

    constructor(
        scope: Construct,
        id: string,
        props: BenchlingWebhookStackProps,
    ) {
        super(scope, id, props);
        this.prefix = props.prefix;
        this.queueName = props.queueName;
        if (this.prefix.includes("/")) {
            throw new Error("Prefix should not contain a '/' character.");
        }

        this.bucket = this.createS3Bucket(props.bucketName);
        this.benchlingConnection = this.createBenchlingConnection(props);
        this.stateMachine = this.createStateMachine();
        this.api = this.createApiGateway();
        this.createOutputs();
    }

    private createS3Bucket(bucketName: string): s3.IBucket {
        return s3.Bucket.fromBucketName(this, "BWBucket", bucketName);
    }

    private createStateMachine(): stepfunctions.StateMachine {
        const setupVariablesTask = new stepfunctions.Pass(
            this,
            "SetupVariables",
            {
                parameters: {
                    "packageName.$":
                        `States.Format('${this.prefix}/{}', $.message.id)`,
                    "entity.$": "$.message.id",
                    "typeFields.$": "States.StringSplit($.message.type, '.')",
                },
                resultPath: "$.var",
            },
        );

        const writeToS3Task = this.createS3WriteTask();
        const sendToSQSTask = this.createSQSSendTask();

        writeToS3Task.addCatch(
            new stepfunctions.Fail(this, "FailState", {
                cause: "Task Failed",
                error: "TaskError",
            }),
        );

        const definition = setupVariablesTask
            .next(writeToS3Task)
            .next(sendToSQSTask);

        return new stepfunctions.StateMachine(
            this,
            "BenchlingWebhookStateMachine",
            {
                definitionBody: stepfunctions.DefinitionBody.fromChainable(
                    definition,
                ),
                stateMachineType: stepfunctions.StateMachineType.STANDARD,
                logs: {
                    destination: new logs.LogGroup(this, "StateMachineLogs"),
                    level: stepfunctions.LogLevel.ALL,
                },
            },
        );
    }

    private createS3WriteTask(): tasks.CallAwsService {
        return new tasks.CallAwsService(this, "WriteToS3", {
            service: "s3",
            action: "putObject",
            parameters: {
                Bucket: this.bucket.bucketName,
                "Key.$":
                    `States.Format('{}/event_message.json', $.var.packageName)`,
                "Body.$": "$.message",
            },
            iamResources: [this.bucket.arnForObjects("*")],
            resultPath: "$.putResult",
        });
    }

    private createSQSSendTask(): tasks.CallAwsService {
        const queueArn =
            `arn:aws:sqs:${this.region}:${this.account}:${this.queueName}`;
        const queueUrl =
            `https://sqs.${this.region}.amazonaws.com/${this.account}/${this.queueName}`;
        const timestamp = new Date().toISOString();

        return new tasks.CallAwsService(this, "SendToSQS", {
            service: "sqs",
            action: "sendMessage",
            parameters: {
                QueueUrl: queueUrl,
                MessageBody: {
                    "source_prefix.$":
                        `States.Format('s3://${this.bucket.bucketName}/{}/',$.var.packageName)`,
                    "registry": this.bucket.bucketName,
                    "package_name.$": "$.var.packageName",
                    "commit_message":
                        `Benchling webhook payload - ${timestamp}`,
                },
            },
            iamResources: [queueArn],
            resultPath: "$.sqsResult",
        });
    }

    private createCloudWatchRole(): iam.Role {
        const cloudWatchRole = new iam.Role(this, "ApiGatewayCloudWatchRole", {
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    "service-role/AmazonAPIGatewayPushToCloudWatchLogs",
                ),
            ],
        });

        new apigateway.CfnAccount(this, "ApiGatewayAccount", {
            cloudWatchRoleArn: cloudWatchRole.roleArn,
        });

        return cloudWatchRole;
    }

    private createApiGateway(): apigateway.RestApi {
        const logGroup = new logs.LogGroup(this, "ApiGatewayAccessLogs");
        const apiRole = this.createApiRole();
        const cloudWatchRole = this.createCloudWatchRole();

        const api = new apigateway.RestApi(this, "BenchlingWebhookAPI", {
            restApiName: "BenchlingWebhookAPI",
            deployOptions: {
                stageName: "prod",
                accessLogDestination: new apigateway.LogGroupLogDestination(
                    logGroup,
                ),
                methodOptions: {
                    "/*/*": {
                        loggingLevel: apigateway.MethodLoggingLevel.INFO,
                        dataTraceEnabled: true,
                    },
                },
            },
        });

        this.addWebhookEndpoint(api, apiRole);
        return api;
    }

    private createApiRole(): iam.Role {
        const role = new iam.Role(this, "ApiGatewayStepFunctionsRole", {
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        });

        role.addToPolicy(
            new iam.PolicyStatement({
                actions: ["states:StartExecution"],
                resources: [this.stateMachine.stateMachineArn],
            }),
        );

        return role;
    }

    private addWebhookEndpoint(
        api: apigateway.RestApi,
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
                        "stateMachineArn": "${this.stateMachine.stateMachineArn}",
                        "input": "$util.escapeJavaScript($input.json('$'))"
                    }`,
                },
                integrationResponses: [
                    {
                        statusCode: "200",
                        responseTemplates: {
                            "application/json": JSON.stringify({
                                status: "success",
                            }),
                        },
                    },
                    {
                        selectionPattern: "4\\d{2}",
                        statusCode: "400",
                        responseTemplates: {
                            "application/json": JSON.stringify({
                                error: "Bad request",
                            }),
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
            const resource = api.root.addResource(endpoint);
            resource.addMethod("POST", sfnIntegration, {
                methodResponses: [
                    { statusCode: "200" },
                    { statusCode: "400" },
                    { statusCode: "500" },
                ],
            });
        });
    }

    private createBenchlingConnection(
        props: BenchlingWebhookStackProps,
    ): events.CfnConnection {
        const benchlingConnection = new events.CfnConnection(
            this,
            "BenchlingOAuthConnection",
            {
                authorizationType: "OAUTH_CLIENT_CREDENTIALS",
                authParameters: {
                    oAuthParameters: {
                        authorizationEndpoint:
                            `https://${props.benchlingTenant}.benchling.com/api/v2/token`,
                        clientParameters: {
                            clientId: props.benchlingClientId,
                            clientSecret: props.benchlingClientSecret,
                        },
                        httpMethod: "POST",
                    },
                },
            },
        );
        return benchlingConnection;
    }

    private createOutputs(): void {
        new cdk.CfnOutput(this, "ApiUrl", {
            value: this.api.url,
            description: "API Gateway endpoint URL",
        });
        new cdk.CfnOutput(this, "ConnectionArn", {
            value: this.benchlingConnection.attrArn,
        });
    }
}
