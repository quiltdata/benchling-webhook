import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

import { WebhookStateMachineProps } from "./types";
import { PackagingStateMachine } from "./packaging-state-machine";

export class WebhookStateMachine extends Construct {
    public readonly stateMachine: stepfunctions.StateMachine;
    private readonly props: WebhookStateMachineProps;

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
        const startPackagingExecution = this.createStartPackagingTask(
            packagingStateMachine,
        );
        const canvasWorkflow = this.createCanvasWorkflow(
            startPackagingExecution,
        );
        const buttonWorkflow = this.createButtonWorkflow(
            startPackagingExecution,
        );

        return this.createChannelChoice(
            startPackagingExecution,
            canvasWorkflow,
            buttonWorkflow,
        );
    }

    private createStartPackagingTask(
        packagingStateMachine: stepfunctions.StateMachine,
    ): stepfunctions.IChainable {
        const startPackagingExecution = new tasks
            .StepFunctionsStartExecution(this, "StartPackagingExecution", {
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

        const errorHandler = new stepfunctions.Pass(this, "HandleError", {
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
