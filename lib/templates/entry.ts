import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";
import { BaseTemplate } from "./base-template";

export class EntryTemplate extends BaseTemplate {
    protected template(): string {
        return "# [{}]({})\n\n" +
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
    }

    protected createContent(): stepfunctions.Pass {
        return new stepfunctions.Pass(
            this.scope,
            "CreateEntryContent",
            {
                parameters: {
                    "content.$": "States.Format('" + this.template() + "', " +
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
                resultPath: "$.content",
            }
        );
    }
}
