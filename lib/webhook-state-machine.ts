import * as cdk from "aws-cdk-lib";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { Construct } from "constructs";

import { WebhookStateMachineProps } from "./types";
import { PackagingStateMachine } from "./packaging-state-machine";

export class WebhookStateMachine extends Construct {
    public readonly stateMachine: stepfunctions.StateMachine;
    private readonly props: WebhookStateMachineProps;
    private readonly verificationFunction: lambda.IFunction;

    constructor(scope: Construct, id: string, props: WebhookStateMachineProps) {
        super(scope, id);
        this.props = props;

        // Create the package entry state machine
        const packagingStateMachine = new PackagingStateMachine(
            this,
            "Packaging",
            {
                bucket: props.bucket,
                prefix: props.prefix,
                benchlingConnection: props.benchlingConnection,
                queueName: props.queueName,
                region: props.region,
                account: props.account,
            },
        );

        // Create verification Lambda for Step Functions
        // IP filtering happens at API Gateway level via Resource Policy
        // Signature verification happens here in Step Functions
        this.verificationFunction = new nodejs.NodejsFunction(
            this,
            "WebhookVerificationFunction",
            {
                entry: path.join(__dirname, "lambda/verify-webhook.ts"),
                handler: "handler",
                runtime: lambda.Runtime.NODEJS_18_X,
                timeout: cdk.Duration.seconds(10),
                memorySize: 256,
                environment: {
                    NODE_OPTIONS: "--enable-source-maps",
                    WEBHOOK_ALLOW_LIST: props.webhookAllowList ?? "",
                },
                architecture: lambda.Architecture.ARM_64,
                bundling: {
                    minify: true,
                    sourceMap: false,
                    externalModules: [],
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

        const definition = this.createDefinition(
            packagingStateMachine.stateMachine,
        );

        const role = new iam.Role(scope, "StateMachineRole", {
            assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
        });

        role.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "states:InvokeHTTPEndpoint",
                    "states:StartExecution",
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
            "WebhookStateMachine",
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
        packagingStateMachine: stepfunctions.StateMachine,
    ): stepfunctions.IChainable {
        // Create separate packaging task invocations for each workflow path
        // to avoid shared state mutation when .next() is called
        const canvasWorkflow = this.createCanvasWorkflow(
            this.createStartPackagingTask(packagingStateMachine, "StartPackagingExecutionCanvas"),
        );
        const buttonWorkflow = this.createButtonWorkflow(
            this.createStartPackagingTask(packagingStateMachine, "StartPackagingExecutionButton"),
        );

        const channelChoice = this.createChannelChoice(
            this.createStartPackagingTask(packagingStateMachine, "StartPackagingExecutionEvent"),
            canvasWorkflow,
            buttonWorkflow,
        );

        return this.createVerificationTask().next(channelChoice);
    }

    private createVerificationTask(): tasks.LambdaInvoke {
        return new tasks.LambdaInvoke(this, "VerifyWebhook", {
            lambdaFunction: this.verificationFunction,
            resultPath: "$",
            payloadResponseOnly: true,
        });
    }

    private createStartPackagingTask(
        packagingStateMachine: stepfunctions.StateMachine,
        id: string = "StartPackagingExecution",
    ): stepfunctions.IChainable {
        const startPackagingExecution = new tasks
            .StepFunctionsStartExecution(this, id, {
                stateMachine: packagingStateMachine,
                input: stepfunctions.TaskInput.fromObject({
                    entity: stepfunctions.JsonPath.stringAt("$.var.entity"),
                    packageName: stepfunctions.JsonPath.stringAt(
                        `States.Format('{}/{}', '${this.props.prefix}', $.var.entity)`,
                    ),
                    registry: this.props.bucket.bucketName,
                    baseURL: stepfunctions.JsonPath.stringAt("$.baseURL"),
                    message: stepfunctions.JsonPath.stringAt("$.message"),
                }),
                integrationPattern:
                    stepfunctions.IntegrationPattern.REQUEST_RESPONSE,
                resultPath: "$.packagingResult",
            });

        const errorHandler = new stepfunctions.Pass(this, `${id}HandleError`, {
            parameters: {
                "error.$": "$.Error",
                "cause.$": "$.Cause",
            },
        });

        startPackagingExecution.addCatch(errorHandler);
        return startPackagingExecution;
    }

    private createButtonWorkflow(
        startPackagingExecution: stepfunctions.IChainable,
    ): stepfunctions.IChainable {
        const buttonMetadataTask = new stepfunctions.Pass(
            this,
            "SetupButtonMetadata",
            {
                parameters: {
                    "entity.$": "$.message.buttonId",
                    "packageName.$":
                        `States.Format('{}/{}', '${this.props.prefix}', $.message.buttonId)`,
                    "registry": this.props.bucket.bucketName,
                    "catalog": this.props.quiltCatalog,
                    "baseURL.$": "$.baseURL",
                    "message.$": "$.message",
                },
                resultPath: "$.var",
            },
        );

        const updateCanvasTask = this.createUpdateCanvasTask();

        return buttonMetadataTask
            .next(this.createQuiltLinksTask("MakeQuiltLinksButton"))
            .next(this.createMarkdownButton())
            .next(startPackagingExecution)
            .next(updateCanvasTask);
    }

    private createMarkdownButton(): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "MakeMarkdownButton", {
            stateJson: {
                Type: "Pass",
                Parameters: {
                    "links.$": "$.links",
                    "var.$": "$.var",
                    "baseURL.$": "$.var.baseURL",
                    "message.$": "$.var.message",
                    "markdown": {
                        "links.$": "States.Format('# Quilt Links\n---\n- [Quilt Catalog]({})\n- [Drop Zone]({})\n- [QuiltSync]({})\n---\n> NOTE: Package update started. It may take a minute to complete.\n', $.links.catalog_url, $.links.revise_url, $.links.sync_uri)",
                    },
                },
            },
        });
    }

    private createCanvasWorkflow(
        startPackagingExecution: stepfunctions.IChainable,
    ): stepfunctions.IChainable {
        return this.createFindAppEntryTask()
            .next(this.createQuiltMetadata())
            .next(this.createCanvasTask())
            .next(startPackagingExecution);
    }

    private createChannelChoice(
        startPackagingExecution: stepfunctions.IChainable,
        canvasWorkflow: stepfunctions.IChainable,
        buttonWorkflow: stepfunctions.IChainable,
    ): stepfunctions.Choice {
        return new stepfunctions.Choice(this, "CheckChannel")
            .when(
                stepfunctions.Condition.stringEquals("$.channel", "events"),
                new stepfunctions.Pass(this, "SetupEventMetadata", {
                    parameters: {
                        "entity.$": "$.message.resourceId",
                        "packageName.$": `States.Format('{}/{}', '${this.props.prefix}', $.message.resourceId)`,
                        "registry": this.props.bucket.bucketName,
                        "baseURL.$": "$.baseURL",
                        "message.$": "$.message",
                    },
                    resultPath: "$.var",
                })
                    .next(startPackagingExecution),
            )
            .when(
                stepfunctions.Condition.or(
                    stepfunctions.Condition.stringEquals(
                        "$.message.type",
                        "v2.app.activateRequested",
                    ),
                    stepfunctions.Condition.stringEquals(
                        "$.message.type",
                        "v2.canvas.created",
                    ),
                    stepfunctions.Condition.stringEquals(
                        "$.message.type",
                        "v2.canvas.initialized",
                    ),
                ),
                canvasWorkflow,
            )
            .when(
                stepfunctions.Condition.stringEquals(
                    "$.message.type",
                    "v2.canvas.userInteracted",
                ),
                buttonWorkflow,
            )
            .otherwise(
                new stepfunctions.Pass(this, "EchoInput", {
                    parameters: {
                        "input.$": "$",
                    },
                }),
            );
    }

    private createFindAppEntryTask(): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "FindAppEntry", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$":
                        "States.Format('{}/api/v2/entries', $.baseURL)",
                    Method: "GET",
                    Authentication: {
                        ConnectionArn: this.props.benchlingConnection.attrArn,
                    },
                    QueryParameters: {
                        "pageSize": "1",
                    },
                },
                ResultSelector: {
                    "entry.$": "$.ResponseBody.entries[0]",
                },
                ResultPath: "$.appEntries",
            },
        });
    }

    private createQuiltMetadata(): stepfunctions.IChainable {
        const setupCanvasMetadataTask = new stepfunctions.Pass(
            this,
            "SetupCanvasMetadata",
            {
                parameters: {
                    "entity.$": "$.appEntries.entry.id",
                    "packageName.$":
                        `States.Format('{}/{}', '${this.props.prefix}', $.appEntries.entry.id)`,
                    "registry": this.props.bucket.bucketName,
                    "catalog": this.props.quiltCatalog,
                    "baseURL.$": "$.baseURL",
                    "message.$": "$.message",
                },
                resultPath: "$.var",
            },
        );

        return setupCanvasMetadataTask
            .next(this.createQuiltLinksTask("MakeQuiltLinks"))
            .next(this.createMarkdownTask("MakeMarkdown", "It may take a minute for the package to be created asynchronously."));
    }

    private createQuiltLinksTask(id: string): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, id, {
            stateJson: {
                Type: "Pass",
                Parameters: {
                    "catalog_url.$":
                        "States.Format('https://{}/b/{}/packages/{}', $.var.catalog, $.var.registry, $.var.packageName)",
                    "revise_url.$":
                        "States.Format('https://{}/b/{}/packages/{}?action=revisePackage', $.var.catalog, $.var.registry, $.var.packageName)",
                    "sync_uri.$":
                        "States.Format('quilt+s3://{}#package={}&catalog={}', $.var.registry, $.var.packageName, $.var.catalog)",
                },
                ResultPath: "$.links",
            },
        });
    }

    private createMarkdownTask(id: string, note: string): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, id, {
            stateJson: {
                Type: "Pass",
                Parameters: {
                    "links.$": stepfunctions.JsonPath.stringAt(
                        "States.Format('" +
                            "# Quilt Links\n" +
                            "---\n" +
                            "- [Quilt Catalog]({})\n" +
                            "- [Drop Zone]({})\n" +
                            "- [QuiltSync]({})\n" +
                            "---\n" +
                            `> NOTE: ${note}\n` +
                            "', " +
                            "$.links.catalog_url, " +
                            "$.links.revise_url, " +
                            "$.links.sync_uri" +
                            ")",
                    ),
                },
                ResultPath: "$.markdown",
            },
        });
    }

    private createCanvasTask(): stepfunctions.CustomState {
        return this.createCanvasPatchTask("CreateCanvas", "$.appEntries.entry.id");
    }

    private createUpdateCanvasTask(): stepfunctions.CustomState {
        return this.createCanvasPatchTask("UpdateCanvas", "$.var.message.buttonId", true);
    }

    private createCanvasPatchTask(
        id: string,
        buttonIdPath: string,
        useVarContext: boolean = false,
    ): stepfunctions.CustomState {
        const baseURLPath = useVarContext ? "$.var.baseURL" : "$.baseURL";
        const canvasIdPath = useVarContext ? "$.var.message.canvasId" : "$.message.canvasId";

        return new stepfunctions.CustomState(this, id, {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$":
                        `States.Format('{}/api/v2/app-canvases/{}', ${baseURLPath}, ${canvasIdPath})`,
                    Method: "PATCH",
                    Authentication: {
                        ConnectionArn: this.props.benchlingConnection.attrArn,
                    },
                    RequestBody: {
                        "blocks": [
                            {
                                "id": "md1",
                                "type": "MARKDOWN",
                                "value.$": "$.markdown.links",
                            },
                            {
                                "id.$": buttonIdPath,
                                "type": "BUTTON",
                                "text": "Update Package",
                                "enabled": true,
                            },
                        ],
                        "enabled": true,
                        "featureId": "quilt_integration",
                    },
                },
                ResultSelector: {
                    "canvasId.$": "$.ResponseBody.id",
                },
                ResultPath: "$.canvas",
            },
        });
    }
}
