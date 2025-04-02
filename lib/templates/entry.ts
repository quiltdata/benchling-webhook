import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";

export class EntryTemplate {
    private readonly scope: Construct;
    private static readonly TEMPLATE = 
`# [\${$.entry.entryData.name}](\${$.entry.entryData.webURL})

* id: \${$.entry.entryData.id}
* displayId: \${$.entry.entryData.displayId}
* folderId: \${$.entry.entryData.folderId}
* createdAt: \${$.entry.entryData.createdAt}
* modifiedAt: \${$.entry.entryData.modifiedAt}

## Authors
\${States.Array($.entry.entryData.authors[*], 
'* ' + $.name + '\\n  * id: ' + $.id + '\\n  * handle: ' + $.handle)}

## Schema

* id: \${$.entry.entryData.schema.id}
* name: \${$.entry.entryData.schema.name}

## Fields
\${States.Array(States.StringToJson(States.JsonToString($.entry.entryData.fields))[*], 
'* ' + States.JsonToString(@.key) + ': ' + @.value.displayValue)}

## Custom fields
\${States.Array(States.StringToJson(States.JsonToString($.entry.entryData.customFields))[*],
'* ' + States.JsonToString(@.key) + ': ' + @.value.value)}`;

    constructor(scope: Construct) {
        this.scope = scope;
    }

    public createEntryMarkdown(): stepfunctions.Pass {
        return new stepfunctions.Pass(
            this.scope,
            "CreateEntryMarkdown",
            {
                parameters: {
                    "markdown.$": EntryTemplate.TEMPLATE,
                },
                resultPath: "$.entryMarkdown",
            }
        );
    }
}
