import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

import { StateMachineProps } from "./types";
import { README_TEMPLATE } from "./templates/readme";
import { PackageEntryStateMachine } from "./package-entry-state-machine";

export class WebhookStateMachine extends Construct {
    public readonly stateMachine: stepfunctions.StateMachine;
    private readonly bucket: s3.IBucket;

    constructor(scope: Construct, id: string, props: StateMachineProps) {
        super(scope, id);
        this.bucket = props.bucket;

        // Create the package entry state machine
        const packageEntryStateMachine = new PackageEntryStateMachine(
            this,
            "PackageEntry",
            props,
        );

        const definition = this.createDefinition(
            props,
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
        props: StateMachineProps,
        packageEntryStateMachine: stepfunctions.StateMachine,
    ): stepfunctions.IChainable {
        const startPackageEntryExecution = new tasks
            .StepFunctionsStartExecution(this, "StartPackageEntryExecution", {
            stateMachine: packageEntryStateMachine,
            input: stepfunctions.TaskInput.fromObject({
                entity: stepfunctions.JsonPath.stringAt("$.var.entity"),
                packageName: stepfunctions.JsonPath.stringAt(
                    `States.Format('{}/{}', '${props.prefix}', $.var.entity)`,
                ),
                readme: README_TEMPLATE,
                registry: props.bucket.bucketName,
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

        // Create channel choice state
        const createCanvasTask = this.createCanvasTask(
            props.benchlingConnection,
        );

        // Create the button metadata workflow chain
        const buttonMetadataTask = new stepfunctions.Pass(
            this,
            "SetupButtonMetadata",
            {
                parameters: {
                    "entity.$": "$.message.buttonId",
                    "packageName.$":
                        `States.Format('{}/{}', '${props.prefix}', $.message.buttonId)`,
                    "readme": README_TEMPLATE,
                    "registry": props.bucket.bucketName,
                },
                resultPath: "$.var",
            },
        );

        const buttonWorkflow = buttonMetadataTask
            .next(startPackageEntryExecution);

        // Create the canvas workflow
        const findAppEntryTask = this.createFindAppEntryTask(
            props.benchlingConnection,
        );

        const setupCanvasMetadataTask = new stepfunctions.Pass(
            this,
            "SetupCanvasMetadata",
            {
                parameters: {
                    "entity.$": "$.appEntries.entry.id",
                    "packageName.$":
                        `States.Format('{}/{}', '${props.prefix}', $.appEntries.entry.id)`,
                    "readme": README_TEMPLATE,
                    "registry": props.bucket.bucketName,
                },
                resultPath: "$.var",
            },
        );

        const canvasWorkflow = findAppEntryTask
            .next(setupCanvasMetadataTask)
            .next(createCanvasTask);

        const channelChoice = new stepfunctions.Choice(this, "CheckChannel")
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

        // Main workflow entry point
        return channelChoice;
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
                                "value":
                                    "### This is a markdown text section\n---\nBasic markdown options like **bold**, _italics_, and [links]() are supported",
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
