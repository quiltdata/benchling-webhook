import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";
import { BaseTemplate } from "./base-template";

export class EntryTemplate extends BaseTemplate {
    protected createContent(): stepfunctions.Pass {
        return new stepfunctions.Pass(
            this.scope,
            "CreateEntryContent",
            {
                parameters: {
                    "content": {
                        "title.$": "$.entry.entryData.name",
                        "url.$": "$.entry.entryData.webURL",
                        "id.$": "$.entry.entryData.id",
                        "displayId.$": "$.entry.entryData.displayId",
                        "folderId.$": "$.entry.entryData.folderId",
                        "createdAt.$": "$.entry.entryData.createdAt",
                        "modifiedAt.$": "$.entry.entryData.modifiedAt",
                        "authors": {
                            "$": "States.Array($.entry.entryData.authors[*], States.Format('* {}\\n  * id: {}\\n  * handle: {}', $.name, $.id, $.handle))"
                        },
                        "schemaId.$": "$.entry.entryData.schema.id",
                        "schemaName.$": "$.entry.entryData.schema.name",
                        "fields": {
                            "$": "States.Array(States.StringToJson(States.JsonToString($.entry.entryData.fields))[*], States.Format('* {}: {}', States.JsonToString(@.key), @.value.displayValue))"
                        },
                        "customFields": {
                            "$": "States.Array(States.StringToJson(States.JsonToString($.entry.entryData.customFields))[*], States.Format('* {}: {}', States.JsonToString(@.key), @.value.value))"
                        }
                    }
                },
                resultPath: "$.content",
            }
        );
    }

    protected template(): string {
        return "# [{title}]({url})\n\n" +
               "* id: {id}\n" +
               "* displayId: {displayId}\n" +
               "* folderId: {folderId}\n" +
               "* createdAt: {createdAt}\n" +
               "* modifiedAt: {modifiedAt}\n\n" +
               "## Authors\n" +
               "{authors}\n\n" +
               "## Schema\n\n" +
               "* id: {schemaId}\n" +
               "* name: {schemaName}\n\n" +
               "## Fields\n" +
               "{fields}\n\n" +
               "## Custom fields\n" +
               "{customFields}";
    }
}
