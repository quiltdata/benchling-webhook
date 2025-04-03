import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as events from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";

export interface CanvasWorkflowProps {
    benchlingConnection: events.CfnConnection;
    prefix: string;
    bucketName: string;
    quiltCatalog?: string;
}

export function createWorkflow(
    scope: Construct,
    props: CanvasWorkflowProps,
    startPackagingExecution: stepfunctions.IChainable,
): stepfunctions.Chain {
    return stepfunctions.Chain
        .start(createFindAppEntryTask(scope, "Canvas", props))
        .next(createQuiltMetadata(scope, "Canvas", props))
        .next(createCanvasTask(scope, "Canvas", props))
        .next(startPackagingExecution);
}

export function createButtonWorkflow(
    scope: Construct,
    props: CanvasWorkflowProps, 
    startPackagingExecution: stepfunctions.IChainable,
): stepfunctions.Chain {
    return stepfunctions.Chain
        .start(createFindAppEntryTask(scope, "Button", props))
        .next(createQuiltMetadata(scope, "Button", props))
        .next(createCanvasTask(scope, "Button", props))
        .next(startPackagingExecution)
        .next(new stepfunctions.Pass(scope, "ButtonSuccess", {
            parameters: {
                statusCode: 200,
                body: JSON.stringify({
                    message: "Package creation started",
                    status: "success"
                })
            }
        }));
}

function createFindAppEntryTask(
    scope: Construct,
    id: string,
    props: CanvasWorkflowProps,
): stepfunctions.CustomState {
    return new stepfunctions.CustomState(scope, `${id}FindAppEntry`, {
        stateJson: {
            Type: "Task",
            Resource: "arn:aws:states:::http:invoke",
            Parameters: {
                "ApiEndpoint.$": "States.Format('{}/api/v2/entries', $.baseURL)",
                Method: "GET",
                Authentication: {
                    ConnectionArn: props.benchlingConnection.attrArn,
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

function createQuiltMetadata(
    scope: Construct,
    id: string,
    props: CanvasWorkflowProps,
): stepfunctions.IChainable {
    const setupCanvasMetadataTask = new stepfunctions.Pass(
        scope,
        `${id}SetupCanvasMetadata`,
        {
            parameters: {
                "entity.$": "$.appEntries.entry.id",
                "packageName.$": `States.Format('{}/{}', '${props.prefix}', $.appEntries.entry.id)`,
                "registry": props.bucketName,
                "catalog": props.quiltCatalog,
            },
            resultPath: "$.var",
        },
    );

    const makeQuiltLinksTask = new stepfunctions.CustomState(
        scope,
        `${id}MakeQuiltLinks`,
        {
            stateJson: {
                Type: "Pass",
                Parameters: {
                    "catalog_url.$": "States.Format('https://{}/b/{}/packages/{}', $.var.catalog, $.var.registry, $.var.packageName)",
                    "revise_url.$": "States.Format('https://{}/b/{}/packages/{}?action=revisePackage', $.var.catalog, $.var.registry, $.var.packageName)",
                    "sync_uri.$": "States.Format('quilt+s3://{}#package={}&catalog={}', $.var.registry, $.var.packageName, $.var.catalog)",
                },
                ResultPath: "$.links",
            },
        },
    );

    const makeMarkdownTask = new stepfunctions.CustomState(
        scope,
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

function createCanvasTask(
    scope: Construct,
    id: string,
    props: CanvasWorkflowProps,
): stepfunctions.CustomState {
    return new stepfunctions.CustomState(scope, `${id}UpdateCanvas`, {
        stateJson: {
            Type: "Task",
            Resource: "arn:aws:states:::http:invoke",
            Parameters: {
                "ApiEndpoint.$": "States.Format('{}/api/v2/app-canvases/{}', $.baseURL, $.message.canvasId)",
                Method: "PATCH",
                Authentication: {
                    ConnectionArn: props.benchlingConnection.attrArn,
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
