import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

import { WebhookStateMachineProps } from "./types";
import { README_TEMPLATE } from "./templates/readme";
import { PackageEntryStateMachine } from "./package-entry-state-machine";

export class WebhookStateMachine extends Construct {
    public readonly stateMachine: stepfunctions.StateMachine;
    private readonly props: WebhookStateMachineProps;

    constructor(scope: Construct, id: string, props: WebhookStateMachineProps) {
        super(scope, id);
        this.props = props;

        // Create the package entry state machine
        const packageEntryStateMachine = new PackageEntryStateMachine(
            this,
            "PackageEntry",
            props,
        );

        const definition = this.createDefinition(
            packageEntryStateMachine.stateMachine,
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
        packageEntryStateMachine: stepfunctions.StateMachine,
    ): stepfunctions.IChainable {
        const startPackageEntryExecution = this.createStartPackageEntryTask(
            packageEntryStateMachine,
        );
        const canvasWorkflow = this.createCanvasWorkflow();
        const buttonWorkflow = this.createButtonWorkflow(
            startPackageEntryExecution,
        );

        return this.createChannelChoice(
            startPackageEntryExecution,
            canvasWorkflow,
            buttonWorkflow,
        );
    }

    private createStartPackageEntryTask(
        packageEntryStateMachine: stepfunctions.StateMachine,
    ): stepfunctions.IChainable {
        const startPackageEntryExecution = new tasks
            .StepFunctionsStartExecution(this, "StartPackageEntryExecution", {
            stateMachine: packageEntryStateMachine,
            input: stepfunctions.TaskInput.fromObject({
                entity: stepfunctions.JsonPath.stringAt("$.var.entity"),
                packageName: stepfunctions.JsonPath.stringAt(
                    `States.Format('{}/{}', '${this.props.prefix}', $.var.entity)`,
                ),
                readme: README_TEMPLATE,
                registry: this.props.bucket.bucketName,
                baseURL: stepfunctions.JsonPath.stringAt("$.baseURL"),
                message: stepfunctions.JsonPath.stringAt("$.message"),
            }),
            integrationPattern:
                stepfunctions.IntegrationPattern.REQUEST_RESPONSE,
        });

        const errorHandler = new stepfunctions.Pass(this, "HandleError", {
            parameters: {
                "error.$": "$.Error",
                "cause.$": "$.Cause",
            },
        });

        startPackageEntryExecution.addCatch(errorHandler);
        return startPackageEntryExecution;
    }

    private createButtonWorkflow(
        startPackageEntryExecution: stepfunctions.IChainable,
    ): stepfunctions.IChainable {
        const buttonMetadataTask = new stepfunctions.Pass(
            this,
            "SetupButtonMetadata",
            {
                parameters: {
                    "entity.$": "$.message.buttonId",
                    "packageName.$":
                        `States.Format('{}/{}', '${this.props.prefix}', $.message.buttonId)`,
                    "readme": README_TEMPLATE,
                    "registry": this.props.bucket.bucketName,
                },
                resultPath: "$.var",
            },
        );

        return buttonMetadataTask.next(startPackageEntryExecution);
    }

    private createCanvasWorkflow(): stepfunctions.IChainable {
        const findAppEntryTask = this.createFindAppEntryTask(
            this.props.benchlingConnection,
        );
        const createCanvasTask = this.createCanvasTask(
            this.props.benchlingConnection,
        );

        const setupCanvasMetadataTask = new stepfunctions.Pass(
            this,
            "SetupCanvasMetadata",
            {
                parameters: {
                    "entity.$": "$.appEntries.entry.id",
                    "packageName.$":
                        `States.Format('{}/{}', '${this.props.prefix}', $.appEntries.entry.id)`,
                    "readme": README_TEMPLATE,
                    "registry": this.props.bucket.bucketName,
                    "catalog": this.props.quiltCatalog,
                },
                resultPath: "$.var",
            },
        );

        const makeQuiltLinksTask = new stepfunctions.CustomState(
            this,
            "MakeQuiltLinks",
            {
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
            },
        );

        const makeMarkdownTask = new stepfunctions.CustomState(
            this,
            "MakeMarkdown",
            {
                stateJson: {
                    Type: "Pass",
                    Parameters: {
                        "links.$":
                            "States.Format('# Quilt Links\n---\n- [Quilt Catalog]({})\n- [Drop Zone]({})\n- Quilt+ URI: {}',$.links.catalog_url, $.links.revise_url, $.links.sync_uri)",
                    },
                    ResultPath: "$.markdown",
                },
            },
        );

        return findAppEntryTask
            .next(setupCanvasMetadataTask)
            .next(makeQuiltLinksTask)
            .next(makeMarkdownTask)
            .next(createCanvasTask);
    }

    private createChannelChoice(
        startPackageEntryExecution: stepfunctions.IChainable,
        canvasWorkflow: stepfunctions.IChainable,
        buttonWorkflow: stepfunctions.IChainable,
    ): stepfunctions.Choice {
        return new stepfunctions.Choice(this, "CheckChannel")
            .when(
                stepfunctions.Condition.stringEquals("$.channel", "events"),
                startPackageEntryExecution,
            )
            .when(
                stepfunctions.Condition.or(
                    stepfunctions.Condition.stringEquals(
                        "$.message.type",
                        "v2.app.activateRequested",
                    ),
                    stepfunctions.Condition.stringEquals(
                        "$.message.type",
                        "v2-beta.canvas.created",
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

    private createFindAppEntryTask(
        benchlingConnection: events.CfnConnection,
    ): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "FindAppEntry", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$":
                        "States.Format('{}/api/v2/entries', $.baseURL)",
                    Method: "GET",
                    Authentication: {
                        ConnectionArn: benchlingConnection.attrArn,
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

    private createCanvasTask(
        benchlingConnection: events.CfnConnection,
    ): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, "CreateCanvas", {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$":
                        "States.Format('{}/api/v2/app-canvases/{}', $.baseURL, $.message.canvasId)",
                    Method: "PATCH",
                    Authentication: {
                        ConnectionArn: benchlingConnection.attrArn,
                    },
                    RequestBody: {
                        "blocks": [
                            {
                                "id.$": "$.appEntries.entry.id",
                                "type": "BUTTON",
                                "text": "Sync",
                                "enabled": true,
                            },
                            {
                                "id": "md1",
                                "type": "MARKDOWN",
                                "value.$": "$.markdown.links",
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
