import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Duration } from "aws-cdk-lib";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { ExportStatus, StateMachineProps } from "./types";
import { EXPORT_STATUS, FILES } from "./constants";

export class PackageEntryStateMachine extends Construct {
    public readonly stateMachine: stepfunctions.StateMachine;

    constructor(scope: Construct, id: string, props: StateMachineProps) {
        super(scope, id);
        const definition = this.createDefinition(props);

        const role = new iam.Role(scope, "PackageEntryStateMachineRole", {
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
            "PackageEntryStateMachine",
            {
                definitionBody: stepfunctions.DefinitionBody.fromChainable(
                    definition,
                ),
                stateMachineType: stepfunctions.StateMachineType.STANDARD,
                role: role,
            },
        );
    }

    private createDefinition(props: StateMachineProps): stepfunctions.IChainable {
        const fetchEntryTask = this.createFetchEntryTask(props.benchlingConnection);
        const exportTask = this.createExportTask(props.benchlingConnection);
        const pollExportTask = this.createPollExportTask(props.benchlingConnection);
        const waitState = this.createWaitState();

        const extractDownloadURL = new stepfunctions.Pass(this, "ExtractDownloadURL", {
            parameters: {
                "status.$": "$.exportStatus.status" as ExportStatus["status"],
                "downloadURL.$": "$.exportStatus.response.response.downloadURL",
                "packageName.$": "$.packageName",
                "registry.$": "$.registry",
            },
            resultPath: "$.exportStatus",
        });

        const processExportTask = new tasks.LambdaInvoke(this, "ProcessExport", {
            lambdaFunction: props.exportProcessor,
            payload: stepfunctions.TaskInput.fromObject({
                downloadURL: stepfunctions.JsonPath.stringAt("$.exportStatus.downloadURL"),
                packageName: stepfunctions.JsonPath.stringAt("$.exportStatus.packageName"),
                registry: stepfunctions.JsonPath.stringAt("$.exportStatus.registry"),
            }),
            resultPath: "$.processResult",
        });

        const writeEntryToS3Task = this.createS3WriteTask(props.bucket, FILES.ENTRY_JSON, "$.entry.entryData");
        const writeReadmeToS3Task = this.createS3WriteTask(props.bucket, FILES.README_MD, "$.readme");
        const writeMetadataTask = this.createS3WriteTask(props.bucket, FILES.INPUT_JSON, "$.message");
        const sendToSQSTask = this.createSQSTask(props);

        const exportChoice = new stepfunctions.Choice(this, "CheckExportStatus")
            .when(
                stepfunctions.Condition.stringEquals("$.exportStatus.status", EXPORT_STATUS.RUNNING),
                waitState.next(pollExportTask),
            )
            .when(
                stepfunctions.Condition.stringEquals("$.exportStatus.status", EXPORT_STATUS.SUCCEEDED),
                extractDownloadURL
                    .next(processExportTask)
                    .next(writeEntryToS3Task)
                    .next(writeReadmeToS3Task)
                    .next(writeMetadataTask)
                    .next(sendToSQSTask),
            )
            .otherwise(
                new stepfunctions.Fail(this, "ExportFailed", {
                    cause: "Export task did not succeed",
                    error: "ExportFailure",
                }),
            );

        const exportWorkflow = exportTask
            .next(pollExportTask)
            .next(exportChoice);

        return fetchEntryTask.next(exportWorkflow);
    }

    private createFetchEntryTask(benchlingConnection: events.CfnConnection): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "FetchEntry", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$": "States.Format('{}/api/v2/entries/{}', $.baseURL, $.entity)",
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

    private createExportTask(benchlingConnection: events.CfnConnection): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "ExportEntry", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$": "States.Format('{}/api/v2/exports', $.baseURL)",
                    Method: "POST",
                    Authentication: {
                        ConnectionArn: benchlingConnection.attrArn,
                    },
                    RequestBody: {
                        "id.$": "$.entity",
                    },
                },
                ResultSelector: {
                    "taskId.$": "$.ResponseBody.taskId",
                },
                ResultPath: "$.exportTask",
            },
        });
    }

    private createPollExportTask(benchlingConnection: events.CfnConnection): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "PollExportStatus", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$": "States.Format('{}/api/v2/tasks/{}', $.baseURL, $.exportTask.taskId)",
                    Method: "GET",
                    Authentication: {
                        ConnectionArn: benchlingConnection.attrArn,
                    },
                },
                ResultSelector: {
                    "status.$": "$.ResponseBody.status",
                    "response.$": "$.ResponseBody",
                },
                ResultPath: "$.exportStatus",
            },
        });
    }

    private createWaitState(): stepfunctions.Wait {
        return new stepfunctions.Wait(this, "WaitForExport", {
            time: stepfunctions.WaitTime.duration(Duration.seconds(30)),
            comment: "Wait for the export to complete",
        });
    }

    private createS3WriteTask(bucket: s3.IBucket, filename: string, bodyPath: string): tasks.CallAwsService {
        const taskId = `WriteTo${bodyPath.split(".")[1][0].toUpperCase()}${bodyPath.split(".")[1].slice(1)}S3`;
        const resultPath = bodyPath.replace("Body", "put") + "Result";

        return new tasks.CallAwsService(this, taskId, {
            service: "s3",
            action: "putObject",
            parameters: {
                Bucket: bucket.bucketName,
                "Key.$": `States.Format('{}/{}', $.packageName, '${filename}')`,
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
                    "source_prefix.$": "States.Format('s3://{}/{}/',$.registry,$.packageName)",
                    "registry.$": "$.registry",
                    "package_name.$": "$.packageName",
                    "metadata_uri": FILES.ENTRY_JSON,
                    "commit_message": `Benchling webhook payload - ${timestamp}`,
                },
            },
            iamResources: [queueArn],
            resultPath: "$.sqsResult",
        });
    }
}
