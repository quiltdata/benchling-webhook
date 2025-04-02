import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";

export class EntryTemplate {
    private readonly scope: Construct;
    private static readonly TEMPLATE = 
        "# [{}]({})\n\n" +
        "* id: {}\n" +
        "* displayId: {}\n" +
        "* folderId: {}\n" +
        "* createdAt: {}\n" +
        "* modifiedAt: {}\n\n" +
        "## Authors\n" +
        "{}\n\n" +
        "## Schema\n\n" +
        "* id: {}\n" +
        "* name: {}\n\n" +
        "## Fields\n" +
        "{}\n\n" +
        "## Custom fields\n" +
        "{}";

    constructor(scope: Construct) {
        this.scope = scope;
    }

    private createEntryContent(): stepfunctions.Pass {
        return new stepfunctions.Pass(
            this.scope,
            "CreateEntryContent",
            {
                parameters: {
                    "content.$": "States.Format('" + EntryTemplate.TEMPLATE + "', " +
                        "$.entry.entryData.name, " +
                        "$.entry.entryData.webURL, " +
                        "$.entry.entryData.id, " +
                        "$.entry.entryData.displayId, " +
                        "$.entry.entryData.folderId, " +
                        "$.entry.entryData.createdAt, " +
                        "$.entry.entryData.modifiedAt, " +
                        "States.Array($.entry.entryData.authors[*], " +
                            "'* ' + $.name + '\\n  * id: ' + $.id + '\\n  * handle: ' + $.handle), " +
                        "$.entry.entryData.schema.id, " +
                        "$.entry.entryData.schema.name, " +
                        "States.Array(States.StringToJson(States.JsonToString($.entry.entryData.fields))[*], " +
                            "'* ' + States.JsonToString(@.key) + ': ' + @.value.displayValue), " +
                        "States.Array(States.StringToJson(States.JsonToString($.entry.entryData.customFields))[*], " +
                            "'* ' + States.JsonToString(@.key) + ': ' + @.value.value)" +
                        ")",
                },
                resultPath: "$.entryContent",
            }
        );
    }

    public createEntryMarkdown(): stepfunctions.Chain {
        return stepfunctions.Chain
            .start(this.createEntryContent())
            .next(new stepfunctions.Pass(
                this.scope,
                "CreateEntryMarkdown",
                {
                    parameters: {
                        "markdown.$": "$.entryContent.content"
                    },
                    resultPath: "$.entryMarkdown",
                }
            ));
    }
}
