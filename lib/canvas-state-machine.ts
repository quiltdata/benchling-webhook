import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as events from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";

interface CanvasStateMachineProps {
    benchlingConnection: events.CfnConnection;
    prefix: string;
    bucketName: string;
    quiltCatalog?: string;
}

export class CanvasStateMachine extends Construct {
    constructor(scope: Construct, id: string, private readonly props: CanvasStateMachineProps) {
        super(scope, id);
    }

    private createFindAppEntryTask(id: string): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, `${id}FindAppEntry`, {
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

    private createQuiltMetadata(id: string): stepfunctions.IChainable {
        const setupCanvasMetadataTask = new stepfunctions.Pass(
            this,
            `${id}SetupCanvasMetadata`,
            {
                parameters: {
                    "entity.$": "$.appEntries.entry.id",
                    "packageName.$":
                        `States.Format('{}/{}', '${this.props.prefix}', $.appEntries.entry.id)`,
                    "registry": this.props.bucketName,
                    "catalog": this.props.quiltCatalog,
                },
                resultPath: "$.var",
            },
        );

        const makeQuiltLinksTask = new stepfunctions.CustomState(
            this,
            `${id}MakeQuiltLinks`,
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
            `${id}MakeMarkdown`,
            {
                stateJson: {
                    Type: "Pass",
                    Parameters: {
                        "links.$": stepfunctions.JsonPath.stringAt(
                            "States.Format('" +
                                "# Quilt Links\n" +
                                "---\n" +
                                "- [Quilt Catalog]({})\n" +
                                "- [Drop Zone]({})\n" +
                                "- Quilt+ URI: {}\n" +
                                "---\n" +
                                "> NOTE: It may take a minute for the package to be created asynchronously.\n"+
                                "', " +
                                "$.links.catalog_url, " +
                                "$.links.revise_url, " +
                                "$.links.sync_uri" +
                                ")",
                        ),
                    },
                    ResultPath: "$.markdown",
                },
            },
        );

        return setupCanvasMetadataTask
            .next(makeQuiltLinksTask)
            .next(makeMarkdownTask);
    }

    private createCanvasTask(id: string): stepfunctions.CustomState {
        return new stepfunctions.CustomState(this, `${id}UpdateCanvas`, {
            stateJson: {
                Type: "Task",
                Resource: "arn:aws:states:::http:invoke",
                Parameters: {
                    "ApiEndpoint.$":
                        "States.Format('{}/api/v2/app-canvases/{}', $.baseURL, $.message.canvasId)",
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
                                "id.$": "$.appEntries.entry.id",
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

    public createWorkflow(startPackagingExecution: stepfunctions.IChainable): stepfunctions.Chain {
        return stepfunctions.Chain
            .start(this.createFindAppEntryTask("Canvas"))
            .next(this.createQuiltMetadata("Canvas"))
            .next(this.createCanvasTask("Canvas"))
            .next(startPackagingExecution);
    }

    public createButtonWorkflow(startPackagingExecution: stepfunctions.IChainable): stepfunctions.Chain {
        return stepfunctions.Chain
            .start(this.createFindAppEntryTask("Button"))
            .next(this.createQuiltMetadata("Button"))
            .next(this.createCanvasTask("Button"))
            .next(startPackagingExecution)
            .next(new stepfunctions.Pass(this, "ButtonSuccess", {
                parameters: {
                    statusCode: 200,
                    body: JSON.stringify({
                        message: "Package creation started",
                        status: "success"
                    })
                }
            }));
    }
}
