import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Duration } from "aws-cdk-lib";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { ExportStatus, PackageEntryStateMachineProps } from "./types";
import { EXPORT_STATUS, FILES } from "./constants";
import { README_TEMPLATE } from "./templates/readme";

export class PackagingStateMachine extends Construct {
    public readonly stateMachine: stepfunctions.StateMachine;
    private readonly props: PackageEntryStateMachineProps;

    constructor(
        scope: Construct,
        id: string,
        props: PackageEntryStateMachineProps,
    ) {
        super(scope, id);
        this.props = props;
        const definition = this.createDefinition();

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
            "PackagingStateMachine",
            {
                definitionBody: stepfunctions.DefinitionBody.fromChainable(
                    definition,
                ),
                stateMachineType: stepfunctions.StateMachineType.STANDARD,
                role: role,
            },
        );
    }

    private createDefinition(): stepfunctions.IChainable {
        const fetchEntryTask = this.createFetchEntryTask();
        const setupREADME = this.createSetupReadmeTask();
        const exportWorkflow = this.createExportWorkflow();

        return fetchEntryTask.next(setupREADME).next(exportWorkflow);
    }

    private createSetupReadmeTask(): stepfunctions.Chain {
        const createReadme = new stepfunctions.Pass(
            this,
            "CreateReadme",
            {
                parameters: {
                    "readme.$": "States.Format('" + README_TEMPLATE +
                        "', $.exportStatus.FILES.ENTRY_JSON, $.exportStatus.FILES.INPUT_JSON, $.exportStatus.FILES.README_MD)",
                },
                resultPath: "$.readme",
            },
        );

        return stepfunctions.Chain.start(
            new stepfunctions.Pass(
                this,
                "SetupREADME",
                {
                    parameters: {
                        "FILES": FILES,
                    },
                    resultPath: "$.files",
                },
            ),
        ).next(createReadme);
    }

    private createExportWorkflow(): stepfunctions.IChainable {
        const exportTask = this.createExportTask();
        const pollExportTask = this.createPollExportTask();
        const waitState = this.createWaitState();
        const exportChoice = this.createExportChoice(waitState, pollExportTask);

        return exportTask.next(pollExportTask).next(exportChoice);
    }

    private createExportChoice(
        waitState: stepfunctions.Wait,
        pollExportTask: stepfunctions.CustomState,
    ): stepfunctions.Choice {
        const extractDownloadURL = this.createExtractDownloadURLTask();
        const successChain = this.createSuccessChain(extractDownloadURL);

        return new stepfunctions.Choice(this, "CheckExportStatus")
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
                successChain,
            )
            .otherwise(
                new stepfunctions.Fail(this, "ExportFailed", {
                    cause: "Export task did not succeed",
                    error: "ExportFailure",
                }),
            );
    }

    private createExtractDownloadURLTask(): stepfunctions.Pass {
        return new stepfunctions.Pass(
            this,
            "ExtractDownloadURL",
            {
                parameters: {
                    "status.$":
                        "$.exportStatus.status" as ExportStatus["status"],
                    "downloadURL.$":
                        "$.exportStatus.response.response.downloadURL",
                    "packageName.$": "$.packageName",
                    "registry.$": "$.registry",
                    "FILES": FILES,
                },
                resultPath: "$.exportStatus",
            },
        );
    }

    private createSuccessChain(
        extractDownloadURL: stepfunctions.Pass,
    ): stepfunctions.IChainable {
        const processExportTask = new tasks.LambdaInvoke(
            this,
            "ProcessExport",
            {
                lambdaFunction: this.props.exportProcessor,
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

        const writeEntryToS3Task = this.createS3WriteTask(
            this.props.bucket,
            FILES.ENTRY_JSON,
            "$.entry.entryData",
        );
        const writeReadmeToS3Task = this.createS3WriteTask(
            this.props.bucket,
            FILES.README_MD,
            "$.readme.readme",
        );
        const writeMetadataTask = this.createS3WriteTask(
            this.props.bucket,
            FILES.INPUT_JSON,
            "$.message",
        );
        const sendToSQSTask = this.createSQSTask(this.props);

        return extractDownloadURL
            .next(processExportTask)
            .next(writeEntryToS3Task)
            .next(writeReadmeToS3Task)
            .next(writeMetadataTask)
            .next(sendToSQSTask);
    }

    private createFetchEntryTask(): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "FetchEntry", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$":
                        "States.Format('{}/api/v2/entries/{}', $.baseURL, $.entity)",
                    Method: "GET",
                    Authentication: {
                        ConnectionArn: this.props.benchlingConnection.attrArn,
                    },
                },
                ResultSelector: {
                    "entryData.$": "$.ResponseBody.entry",
                },
                ResultPath: "$.entry",
            },
        });
    }

    private createExportTask(): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "ExportEntry", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$":
                        "States.Format('{}/api/v2/exports', $.baseURL)",
                    Method: "POST",
                    Authentication: {
                        ConnectionArn: this.props.benchlingConnection.attrArn,
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

    private createPollExportTask(): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "PollExportStatus", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$":
                        "States.Format('{}/api/v2/tasks/{}', $.baseURL, $.exportTask.taskId)",
                    Method: "GET",
                    Authentication: {
                        ConnectionArn: this.props.benchlingConnection.attrArn,
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

    private createS3WriteTask(
        bucket: s3.IBucket,
        filename: string,
        bodyPath: string,
    ): tasks.CallAwsService {
        const taskId = `WriteTo${bodyPath.split(".")[1][0].toUpperCase()}${
            bodyPath.split(".")[1].slice(1)
        }S3`;
        const resultPath = bodyPath.replace("Body", "put") + "Result";

        const parameters: Record<string, any> = {
            Bucket: bucket.bucketName,
            "Key.$": `States.Format('{}/{}', $.packageName, '${filename}')`,
            "Body.$": bodyPath,
        };

        return new tasks.CallAwsService(this, taskId, {
            service: "s3",
            action: "putObject",
            parameters,
            iamResources: [bucket.arnForObjects("*")],
            resultPath: resultPath,
        });
    }

    private createSQSTask(
        props: PackageEntryStateMachineProps,
    ): tasks.CallAwsService {
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
                        "States.Format('s3://{}/{}/',$.registry,$.packageName)",
                    "registry.$": "$.registry",
                    "package_name.$": "$.packageName",
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
