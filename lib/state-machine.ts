import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";

export interface StateMachineProps {
    bucket: s3.IBucket;
    prefix: string;
    queueName: string;
    region: string;
    account: string;
    benchlingConnection: events.CfnConnection;
}

export class WebhookStateMachine extends Construct {
    public readonly stateMachine: stepfunctions.StateMachine;

    constructor(scope: Construct, id: string, props: StateMachineProps) {
        super(scope, id);
        const definition = this.createDefinition(props);

        this.stateMachine = new stepfunctions.StateMachine(
            scope,
            "BenchlingWebhookStateMachine",
            {
                definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
                stateMachineType: stepfunctions.StateMachineType.STANDARD,
                logs: {
                    destination: new logs.LogGroup(scope, "StateMachineLogs"),
                    level: stepfunctions.LogLevel.ALL,
                },
            }
        );
    }

    private createDefinition(props: StateMachineProps): stepfunctions.IChainable {
        const setupVariablesTask = new stepfunctions.Pass(this, "SetupVariables", {
            parameters: {
                "packageName.$": `States.Format('${props.prefix}/{}', $.message.id)`,
                "entity.$": "$.message.id",
                "typeFields.$": "States.StringSplit($.message.type, '.')",
            },
            resultPath: "$.var",
        });

        const writeToS3Task = this.createS3WriteTask(
            props.bucket,
            "WriteToS3",
            "event_message.json",
            "$.message",
            "$.putResult"
        );
        const fetchEntryTask = this.createFetchEntryTask(props.benchlingConnection);
        const writeEntryToS3Task = this.createS3WriteTask(
            props.bucket,
            "WriteEntryToS3",
            "entry.json",
            "$.entryData",
            "$.putEntryResult"
        );
        const sendToSQSTask = this.createSQSTask(props);

        writeToS3Task.addCatch(
            new stepfunctions.Fail(this, "FailState", {
                cause: "Task Failed",
                error: "TaskError",
            })
        );

        return setupVariablesTask
            .next(writeToS3Task)
            .next(fetchEntryTask)
            .next(writeEntryToS3Task)
            .next(sendToSQSTask);
    }

    private createFetchEntryTask(
        benchlingConnection: events.CfnConnection
    ): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "FetchEntry", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$": "$.baseURL",
                    Method: "GET",
                    "Path.$": "States.Format('/api/v2/entries/{}', $.message.resourceId)",
                    Authentication: {
                        ConnectionArn: benchlingConnection.attrArn,
                    },
                },
                ResultSelector: {
                    "entryData.$": "$.Body",
                },
                ResultPath: "$.entryData",
            },
        });
    }

    private createS3WriteTask(
        bucket: s3.IBucket,
        taskId: string,
        filename: string,
        bodyPath: string,
        resultPath: string
    ): tasks.CallAwsService {
        return new tasks.CallAwsService(this, taskId, {
            service: "s3",
            action: "putObject",
            parameters: {
                Bucket: bucket.bucketName,
                "Key.$": `States.Format('{}/{}', $.var.packageName, '${filename}')`,
                "Body.$": bodyPath,
            },
            iamResources: [bucket.arnForObjects("*")],
            resultPath: resultPath,
        });
    }

    private createSQSTask(props: StateMachineProps): tasks.CallAwsService {
        const queueArn = `arn:aws:sqs:${props.region}:${props.account}:${props.queueName}`;
        const queueUrl = `https://sqs.${props.region}.amazonaws.com/${props.account}/${props.queueName}`;
        const timestamp = new Date().toISOString();

        return new tasks.CallAwsService(this, "SendToSQS", {
            service: "sqs",
            action: "sendMessage",
            parameters: {
                QueueUrl: queueUrl,
                MessageBody: {
                    "source_prefix.$": `States.Format('s3://${props.bucket.bucketName}/{}/',$.var.packageName)`,
                    registry: props.bucket.bucketName,
                    "package_name.$": "$.var.packageName",
                    commit_message: `Benchling webhook payload - ${timestamp}`,
                },
            },
            iamResources: [queueArn],
            resultPath: "$.sqsResult",
        });
    }
}
