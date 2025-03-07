import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface StateMachineProps {
    bucket: s3.IBucket;
    prefix: string;
    queueName: string;
    region: string;
    account: string;
    benchlingConnection: events.CfnConnection;
    benchlingTenant: string;
}

export class WebhookStateMachine extends Construct {
    private static readonly ENTRY_JSON = "entry.json";
    private static readonly RO_CRATE_METADATA_JSON = "ro-crate-metadata.json";
    private static readonly README_MD = "README.md";
    private static readonly README_TEXT = `
# Quilt Package Engine for Benchling Notebooks.

This package contains the data and metadata for a Benchling Notebook entry.

## Files

- ${WebhookStateMachine.ENTRY_JSON}: Entry data
- ${WebhookStateMachine.RO_CRATE_METADATA_JSON}: Webhook event message
- ${WebhookStateMachine.README_MD}: This README file
`;
    public readonly stateMachine: stepfunctions.StateMachine;

    constructor(scope: Construct, id: string, props: StateMachineProps) {
        super(scope, id);
        const definition = this.createDefinition(props);

        const role = new iam.Role(scope, "StateMachineRole", {
            assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
        });

        role.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "states:InvokeHTTPEndpoint",
                    "events:RetrieveConnectionCredentials",
                    "secretsmanager:DescribeSecret",
                    "secretsmanager:GetSecretValue",
                ],
                resources: ["*"],
                effect: iam.Effect.ALLOW,
            }),
        );

        this.stateMachine = new stepfunctions.StateMachine(
            scope,
            "BenchlingWebhookStateMachine",
            {
                definitionBody: stepfunctions.DefinitionBody.fromChainable(
                    definition,
                ),
                stateMachineType: stepfunctions.StateMachineType.STANDARD,
                logs: {
                    destination: new logs.LogGroup(scope, "StateMachineLogs"),
                    level: stepfunctions.LogLevel.ALL,
                    includeExecutionData: true,
                },
                tracingEnabled: true,
                role: role,
            },
        );
    }

    private createDefinition(
        props: StateMachineProps,
    ): stepfunctions.IChainable {
        const setupVariablesTask = new stepfunctions.Pass(
            this,
            "SetupVariables",
            {
                parameters: {
                    "baseURL": `https://${props.benchlingTenant}.benchling.com`,
                    "entity.$": "$.message.resourceId",
                    "packageName.$":
                        `States.Format('${props.prefix}/{}', $.message.resourceId)`,
                    "readme": WebhookStateMachine.README_TEXT,
                    "registry": props.bucket.bucketName,
                    "typeFields.$": "States.StringSplit($.message.type, '.')",
                },
                resultPath: "$.var",
            },
        );

        const fetchEntryTask = this.createFetchEntryTask(
            props.benchlingConnection,
        );
        const writeEntryToS3Task = this.createS3WriteTask(
            props.bucket,
            WebhookStateMachine.ENTRY_JSON,
            "$.entry.entryData",
        );
        const writeReadmeToS3Task = this.createS3WriteTask(
            props.bucket,
            WebhookStateMachine.README_MD,
            "$.var.readme",
        );
        const writeMetadataTask = this.createS3WriteTask(
            props.bucket,
            WebhookStateMachine.RO_CRATE_METADATA_JSON,
            "$.message",
        );
        const sendToSQSTask = this.createSQSTask(props);

        const errorHandler = new stepfunctions.Pass(this, "HandleError", {
            parameters: {
                "error.$": "$.Error",
                "cause.$": "$.Cause",
            },
        });

        fetchEntryTask.addCatch(errorHandler);
        writeEntryToS3Task.addCatch(errorHandler);
        writeReadmeToS3Task.addCatch(errorHandler);
        writeMetadataTask.addCatch(errorHandler);
        sendToSQSTask.addCatch(errorHandler);

        return setupVariablesTask
            .next(fetchEntryTask)
            .next(writeEntryToS3Task)
            .next(writeReadmeToS3Task)
            .next(writeMetadataTask)
            .next(sendToSQSTask);
    }

    private createFetchEntryTask(
        benchlingConnection: events.CfnConnection,
    ): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "FetchEntry", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$":
                        "States.Format('{}/api/v2/entries/{}', $.var.baseURL, $.var.entity)",
                    Method: "GET",
                    Authentication: {
                        ConnectionArn: benchlingConnection.attrArn,
                    },
                },
                ResultSelector: {
                    "entryData.$": "$.ResponseBody.entry",
                },
                ResultPath: "$.entry",
            },
        });
    }

    private createS3WriteTask(
        bucket: s3.IBucket,
        filename: string,
        bodyPath: string,
    ): tasks.CallAwsService {
        // Infer taskId from bodyPath by taking the part after $ and capitalizing
        const taskId = `WriteTo${bodyPath.split(".")[1][0].toUpperCase()}${
            bodyPath.split(".")[1].slice(1)
        }S3`;
        // Infer resultPath by replacing body with put and adding Result
        const resultPath = bodyPath.replace("Body", "put") + "Result";

        return new tasks.CallAwsService(this, taskId, {
            service: "s3",
            action: "putObject",
            parameters: {
                Bucket: bucket.bucketName,
                "Key.$":
                    `States.Format('{}/{}', $.var.packageName, '${filename}')`,
                "Body.$": bodyPath,
            },
            iamResources: [bucket.arnForObjects("*")],
            resultPath: resultPath,
        });
    }

    private createSQSTask(props: StateMachineProps): tasks.CallAwsService {
        const queueArn =
            `arn:aws:sqs:${props.region}:${props.account}:${props.queueName}`;
        const queueUrl =
            `https://sqs.${props.region}.amazonaws.com/${props.account}/${props.queueName}`;
        const timestamp = new Date().toISOString();

        return new tasks.CallAwsService(this, "SendToSQS", {
            service: "sqs",
            action: "sendMessage",
            parameters: {
                QueueUrl: queueUrl,
                MessageBody: {
                    "source_prefix.$":
                        "States.Format('s3://${}/{}/',$.var.registry,$.var.packageName)",
                    "registry.$": "$.var.registry",
                    "package_name.$": "$.var.packageName",
                    "metadata_uri": WebhookStateMachine.ENTRY_JSON,
                    "commit_message":
                        `Benchling webhook payload - ${timestamp}`,
                },
            },
            iamResources: [queueArn],
            resultPath: "$.sqsResult",
        });
    }
}
