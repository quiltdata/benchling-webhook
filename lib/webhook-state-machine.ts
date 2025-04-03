import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

import { WebhookStateMachineProps } from "./types";
import { PackagingStateMachine } from "./packaging-state-machine";
import { createWorkflow, createButtonWorkflow } from "./canvas-workflow";

export class WebhookStateMachine extends Construct {
    public readonly stateMachine: stepfunctions.StateMachine;
    private readonly props: WebhookStateMachineProps;

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

    private createButtonWorkflow(
        startPackagingExecution: stepfunctions.IChainable,
    ): stepfunctions.IChainable {
        return createButtonWorkflow(this, {
            benchlingConnection: this.props.benchlingConnection,
            prefix: this.props.prefix,
            bucketName: this.props.bucket.bucketName,
            quiltCatalog: this.props.quiltCatalog,
        }, startPackagingExecution);
    }

    private createCanvasWorkflow(
        startPackagingExecution: stepfunctions.IChainable,
    ): stepfunctions.IChainable {
        return createWorkflow(this, {
            benchlingConnection: this.props.benchlingConnection,
            prefix: this.props.prefix,
            bucketName: this.props.bucket.bucketName,
            quiltCatalog: this.props.quiltCatalog,
        }, startPackagingExecution);
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

}
