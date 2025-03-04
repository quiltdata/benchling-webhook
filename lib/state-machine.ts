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
                    "secretsmanager:GetSecretValue"
                ],
                resources: ["*"],
                effect: iam.Effect.ALLOW,
            })
        );

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
                role: role,
            }
        );
    }

    private createDefinition(props: StateMachineProps): stepfunctions.IChainable {
        const setupVariablesTask = new stepfunctions.Pass(this, "SetupVariables", {
            parameters: {
                "packageName.$": `States.Format('${props.prefix}/{}', $.message.id)`,
                "entity.$": "$.message.id",
                "typeFields.$": "States.StringSplit($.message.type, '.')",
                "baseURL": `https://${props.benchlingTenant}.benchling.com`,
            },
            resultPath: "$.var",
        });

        const writeToS3Task = this.createS3WriteTask(
            props.bucket,
            "event_message.json",
            "$.message"
        );
        const fetchEntryTask = this.createFetchEntryTask(props.benchlingConnection);
        const writeEntryToS3Task = this.createS3WriteTask(
            props.bucket,
            "entry.json",
            "$.entryData"
        );
        const sendToSQSTask = this.createSQSTask(props);

        const errorHandler = new stepfunctions.Pass(this, "HandleError", {
            parameters: {
                "error.$": "$.Error",
                "cause.$": "$.Cause",
            },
        });

        writeToS3Task.addCatch(errorHandler);
        fetchEntryTask.addCatch(errorHandler);
        writeEntryToS3Task.addCatch(errorHandler);
        sendToSQSTask.addCatch(errorHandler);

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
                    "ApiEndpoint.$": "States.Format('{}/api/v2/entries/{}', $.var.baseURL, $.message.resourceId)",
                    Method: "GET",
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
        filename: string,
        bodyPath: string
    ): tasks.CallAwsService {
        // Infer taskId from bodyPath by taking the part after $ and capitalizing
        const taskId = `WriteTo${bodyPath.split('.')[1][0].toUpperCase()}${bodyPath.split('.')[1].slice(1)}S3`;
        // Infer resultPath by replacing body with put and adding Result
        const resultPath = bodyPath.replace('Body', 'put') + 'Result';
        
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
