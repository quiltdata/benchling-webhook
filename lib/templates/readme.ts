import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { FILES } from "../constants";
import { BaseTemplate } from "./base-template";

export class ReadmeTemplate extends BaseTemplate {
    protected template(): string {
        return "# [{}]({})\n\n" +
            "## {}\n\n" +
            "* **folderId**: {}\n" +
            "* **createdAt**: {}\n" +
            "* **modifiedAt**: {}\n\n" +
            "## Authors\n\n" +
            "{}\n\n" +
            "## Fields\n\n" +
            "{}\n\n" +
            "## Custom fields\n\n" +
            "{}\n\n" +
            "## Schema\n\n" +
            "* **id**: {}\n" +
            "* **name**: {}\n\n" +
            "## Files\n\n" +
            "- [{}](./{}): Entry data\n" +
            "- [{}](./{}): Webhook event message\n";
    }

    protected createContent(): stepfunctions.Pass {
        return new stepfunctions.Pass(
            this.scope,
            "CreateReadmeContent",
            {
                parameters: {
                    "content.$": "States.Format('" + this.template() + "'" +
                        ", $.entry.entryData.displayId" +  // H1 title
                        ", $.entry.entryData.webURL" + // H1 url
                        ", $.entry.entryData.id" + // H2 subtitle (entry ID)
                        ", $.entry.entryData.folderId" +
                        ", $.entry.entryData.createdAt" +
                        ", $.entry.entryData.modifiedAt" +
                        ", $.formattedLists.formattedLists.authorsFormatted" + // Authors
                        ", $.formattedLists.formattedLists.fieldsFormatted" + // Fields
                        ", $.formattedLists.formattedLists.customFieldsFormatted" + // Custom fields
                        ", $.entry.entryData.schema.id" + // Schema (moved to bottom)
                        ", $.entry.entryData.schema.name" +
                        ", $.files.FILES.ENTRY_JSON, $.files.FILES.ENTRY_JSON" + // Files section - entry.json
                        ", $.files.FILES.INPUT_JSON, $.files.FILES.INPUT_JSON" + // Files section - input.json
                        ")",
                },
                resultPath: "$.content",
            },
        );
    }

    private setupFiles(): stepfunctions.Pass {
        return new stepfunctions.Pass(
            this.scope,
            "SetupREADME",
            {
                parameters: {
                    "FILES": FILES
                },
                resultPath: "$.files",
            },
        );
    }

    private formatFields(): stepfunctions.Pass {
        return new stepfunctions.Pass(this.scope, 'FormatFields', {
            parameters: {
                "fieldsFormatted.$": "States.Array(States.Format('* Project: {}', $.entry.entryData.fields.Project.displayValue), States.Format('* Study: {}', $.entry.entryData.fields.Study.displayValue))"
            },
            resultPath: "$.fieldsFormatted"
        });
    }

    private formatCustomFields(): stepfunctions.Pass {
        return new stepfunctions.Pass(this.scope, 'FormatCustomFields', {
            parameters: {
                "customFieldsFormatted.$": "States.Array('* No custom fields defined')"
            },
            resultPath: "$.customFieldsFormatted"
        });
    }

    private formatAuthors(): stepfunctions.Map {
        const appendFormattedAuthor = new stepfunctions.Pass(this.scope, 'AppendFormattedAuthor', {
            parameters: {
                "formattedAuthor.$": "States.Format('* {} <{}@{}>', $.name, $.handle, $.id)"
            },
            resultPath: "$.formattedAuthor"
        });

        return new stepfunctions.Map(this.scope, 'FormatAuthors', {
            itemsPath: '$.entry.entryData.authors',
            resultPath: "$.authorsFormatted"
        }).itemProcessor(appendFormattedAuthor);
    }

    private joinListVariables(): stepfunctions.Pass {
        return new stepfunctions.Pass(this.scope, 'JoinFormattedLists', {
            parameters: {
                "formattedLists": {
                    "fieldsFormatted.$": "States.JsonToString($.fieldsFormatted)",
                    "customFieldsFormatted.$": "States.JsonToString($.customFieldsFormatted)",
                    "authorsFormatted.$": "States.JsonToString($.authorsFormatted[*].formattedAuthor)"
                }
            },
            resultPath: "$.formattedLists"
        });
    }

    public createMarkdown(): stepfunctions.Chain {
        return stepfunctions.Chain
            .start(this.setupFiles())
            .next(this.formatFields())
            .next(this.formatCustomFields())
            .next(this.formatAuthors())
            .next(this.joinListVariables())
            .next(super.createMarkdown());
    }
}
