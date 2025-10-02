import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Duration } from "aws-cdk-lib";
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { ExportStatus, PackagingStateMachineProps } from "./types";
import { EXPORT_STATUS, FILES } from "./constants";
import { ReadmeTemplate } from "./templates/readme";

export class PackagingStateMachine extends Construct {
    public readonly stateMachine: stepfunctions.StateMachine;
    private readonly props: PackagingStateMachineProps;

    private readonly exportProcessor: lambda.IFunction;
    private readonly stringProcessor: lambda.IFunction;

    constructor(
        scope: Construct,
        id: string,
        props: PackagingStateMachineProps,
    ) {
        super(scope, id);
        this.props = props;

        // Create the export processor Lambda
        this.exportProcessor = new nodejs.NodejsFunction(
            this,
            "ExportProcessor",
            {
                entry: path.join(__dirname, "lambda/process-export.ts"),
                handler: "handler",
                runtime: lambda.Runtime.NODEJS_18_X,
                timeout: cdk.Duration.minutes(5),
                memorySize: 1024,
                environment: {
                    NODE_OPTIONS: "--enable-source-maps",
                },
                architecture: lambda.Architecture.ARM_64,
                bundling: {
                    minify: true,
                    sourceMap: false,
                    externalModules: [
                        "@aws-sdk/client-s3",
                    ],
                    forceDockerBundling: false,
                    target: "node18",
                    define: {
                        "process.env.NODE_ENV": JSON.stringify(
                            process.env.NODE_ENV || "production",
                        ),
                    },
                },
            },
        );

        // Create the string processor Lambda
        this.stringProcessor = new nodejs.NodejsFunction(
            this,
            "StringProcessor",
            {
                entry: path.join(__dirname, "lambda/process-string.ts"),
                handler: "handler",
                runtime: lambda.Runtime.NODEJS_18_X,
                timeout: cdk.Duration.minutes(1),
                memorySize: 128,
                environment: {
                    NODE_OPTIONS: "--enable-source-maps",
                },
                architecture: lambda.Architecture.ARM_64,
                bundling: {
                    minify: true,
                    sourceMap: false,
                    externalModules: [
                        "@aws-sdk/client-s3",
                    ],
                    forceDockerBundling: false,
                    target: "node18",
                    define: {
                        "process.env.NODE_ENV": JSON.stringify(
                            process.env.NODE_ENV || "production",
                        ),
                    },
                },
            },
        );

        // Grant both Lambda functions access to the S3 bucket
        props.bucket.grantReadWrite(this.exportProcessor);
        props.bucket.grantReadWrite(this.stringProcessor);

        const definition = this.createDefinition();

        const role = new iam.Role(scope, "PackagingStateMachineRole", {
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

    private writeTemplates(): stepfunctions.Chain {
        const readmeTemplate = new ReadmeTemplate(this);
        // const entryTemplate = new EntryTemplate(this);

        return readmeTemplate.write(this.stringProcessor, this.props.bucket, FILES.README_MD);
        //.next(entryTemplate.write(this.stringProcessor, this.props.bucket, FILES.ENTRY_MD));
    }

    private createDefinition(): stepfunctions.IChainable {
        const fetchEntryTask = this.createFetchEntryTask();
        const templates = this.writeTemplates();
        const exportWorkflow = this.createExportWorkflow();

        return fetchEntryTask.next(templates).next(exportWorkflow);
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
                lambdaFunction: this.exportProcessor,
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
        const writeMetadataTask = this.createS3WriteTask(
            this.props.bucket,
            FILES.INPUT_JSON,
            "$.message",
        );
        const sendToSQSTask = this.createSQSTask(this.props);

        return extractDownloadURL
            .next(processExportTask)
            .next(writeEntryToS3Task)
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

        const parameters: Record<string, string> = {
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
        props: PackagingStateMachineProps,
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
