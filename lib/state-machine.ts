import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Duration } from "aws-cdk-lib";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

import { ExportStatus, StateMachineProps } from "./types";
import { EXPORT_STATUS, FILES } from "./constants";
import { README_TEMPLATE } from "./templates/readme";

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
                    "readme": README_TEMPLATE,
                    "registry": props.bucket.bucketName,
                    "typeFields.$": "States.StringSplit($.message.type, '.')",
                },
                resultPath: "$.var",
            },
        );

        const fetchEntryTask = this.createFetchEntryTask(
            props.benchlingConnection,
        );
        const extractFileIdsTask = this.createExtractFileIdsTask();
        const fetchExternalFilesTask = this.createFetchExternalFilesTask(
            props.benchlingConnection,
        );
        const writeEntryToS3Task = this.createS3WriteTask(
            props.bucket,
            FILES.ENTRY_JSON,
            "$.entry.entryData",
        );
        const writeReadmeToS3Task = this.createS3WriteTask(
            props.bucket,
            FILES.README_MD,
            "$.var.readme",
        );
        const writeMetadataTask = this.createS3WriteTask(
            props.bucket,
            FILES.INPUT_JSON,
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

        // Create export polling loop
        const exportTask = this.createExportTask(props.benchlingConnection);
        const pollExportTask = this.createPollExportTask(
            props.benchlingConnection,
        );
        const waitState = this.createWaitState();

        exportTask.addCatch(errorHandler);
        pollExportTask.addCatch(errorHandler);

        // Create export polling loop with proper state transitions
        const extractDownloadURL = new stepfunctions.Pass(
            this,
            "ExtractDownloadURL",
            {
                parameters: {
                    "status.$":
                        "$.exportStatus.status" as ExportStatus["status"],
                    "downloadURL.$":
                        "$.exportStatus.response.response.downloadURL",
                    "packageName.$": "$.var.packageName",
                    "registry.$": "$.var.registry",
                },
                resultPath: "$.exportStatus",
            },
        );

        const processExportTask = new tasks.LambdaInvoke(
            this,
            "ProcessExport",
            {
                lambdaFunction: props.exportProcessor,
                payload: stepfunctions.TaskInput.fromObject({
                    downloadURL: stepfunctions.JsonPath.stringAt(
                        "$.exportStatus.downloadURL",
                    ),
                    packageName: stepfunctions.JsonPath.stringAt(
                        "$.exportStatus.packageName",
                    ),
                    registry: stepfunctions.JsonPath.stringAt(
                        "$.exportStatus.registry",
                    ),
                }),
                resultPath: "$.processResult",
            },
        );

        const exportChoice = new stepfunctions.Choice(this, "CheckExportStatus")
            .when(
                stepfunctions.Condition.stringEquals(
                    "$.exportStatus.status",
                    EXPORT_STATUS.RUNNING,
                ),
                waitState.next(pollExportTask),
            )
            .when(
                stepfunctions.Condition.stringEquals(
                    "$.exportStatus.status",
                    EXPORT_STATUS.SUCCEEDED,
                ),
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

        // Main workflow
        const processExternalFilesTask = new tasks.LambdaInvoke(
            this,
            "ProcessExternalFiles",
            {
                lambdaFunction: props.exportProcessor,
                payload: stepfunctions.TaskInput.fromObject({
                    "downloadURLs.$": "$.externalFiles[*].downloadURL",
                    "packageName.$": "$.var.packageName",
                    "registry.$": "$.var.registry",
                }),
                resultPath: "$.processExternalFilesResult",
            },
        );

        return setupVariablesTask
            .next(fetchEntryTask)
            .next(extractFileIdsTask)
            .next(fetchExternalFilesTask)
            .next(processExternalFilesTask)
            .next(exportTask)
            .next(pollExportTask)
            .next(exportChoice);
    }

    private createExportTask(
        benchlingConnection: events.CfnConnection,
    ): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "ExportEntry", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$":
                        "States.Format('{}/api/v2/exports', $.var.baseURL)",
                    Method: "POST",
                    Authentication: {
                        ConnectionArn: benchlingConnection.attrArn,
                    },
                    "RequestBody": {
                        "id.$": "$.var.entity",
                    },
                },
                ResultSelector: {
                    "taskId.$": "$.ResponseBody.taskId",
                },
                ResultPath: "$.exportTask",
            },
        });
    }

    private createPollExportTask(
        benchlingConnection: events.CfnConnection,
    ): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "PollExportStatus", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$":
                        "States.Format('{}/api/v2/tasks/{}', $.var.baseURL, $.exportTask.taskId)",
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

    private createExtractFileIdsTask(): stepfunctions.Pass {
        return new stepfunctions.Pass(this, "ExtractFileIds", {
            parameters: {
                "fileIds.$":
                    "States.ArrayUnique($.entry.entryData.days[*].notes[?(@.type=='external_file')].externalFileId)",
            },
            resultPath: "$.fileIds",
        });
    }

    private createFetchExternalFilesTask(
        benchlingConnection: events.CfnConnection,
    ): stepfunctions.Map {
        return new stepfunctions.Map(this, "FetchExternalFiles", {
            itemsPath: "$.fileIds.fileIds",
            inputPath: "$",
            itemSelector: {
                "fileId.$": "$$.Map.Item.Value",
                "entryId.$": "$.var.entity",
                "baseURL.$": "$.var.baseURL",
            },
            resultPath: "$.externalFiles",
            maxConcurrency: 1,
        }).itemProcessor(
            new stepfunctions.CustomState(this, "FetchExternalFile", {
                stateJson: {
                    Type: "Task",
                    Resource: "arn:aws:states:::http:invoke",
                    Parameters: {
                        "ApiEndpoint.$":
                            "States.Format('{}/api/v2/entries/{}/external-files/{}', $.baseURL, $.entryId, $.fileId)",
                        Method: "GET",
                        Authentication: {
                            ConnectionArn: benchlingConnection.attrArn,
                        },
                    },
                    ResultSelector: {
                        "fileId.$": "$.ResponseBody.externalFile.id",
                        "downloadURL.$":
                            "$.ResponseBody.externalFile.downloadURL",
                        "size.$": "$.ResponseBody.externalFile.size",
                        "expiresAt.$": "$.ResponseBody.externalFile.expiresAt",
                    },
                },
            }),
        );
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
                        "States.Format('s3://{}/{}/',$.var.registry,$.var.packageName)",
                    "registry.$": "$.var.registry",
                    "package_name.$": "$.var.packageName",
                    "metadata_uri": FILES.ENTRY_JSON,
                    "commit_message":
                        `Benchling webhook payload - ${timestamp}`,
                },
            },
            iamResources: [queueArn],
            resultPath: "$.sqsResult",
        });
    }
}
