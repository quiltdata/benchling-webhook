import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { FILES } from "../constants";
import { BaseTemplate } from "./base-template";

export class ReadmeTemplate extends BaseTemplate {
    protected template(): string {
        return "# [{}]({})\n\n" +
            "* **id**: {}\n" +
            "* **displayId**: {}\n" +
            "* **folderId**: {}\n" +
            "* **createdAt**: {}\n" +
            "* **modifiedAt**: {}\n\n" +
            "## Authors:\n" +
            "{}\n" +
            "## Schema\n\n" +
            "* **id**: {}\n" +
            "* **name**: {}\n\n" +
            "## Fields\n" +
            "{}\n\n" +
            "## Custom fields\n" +
            "{}";
    }

    protected createContent(): stepfunctions.Pass {
        return new stepfunctions.Pass(
            this.scope,
            "CreateReadmeContent",
            {
                parameters: {
                    "content.$": "States.Format('" + this.template() + "'" +
                        ", $.entry.entryData.name" +  // {title}
                        ", $.entry.entryData.webURL" + // {url}
                        ", $.entry.entryData.id" +
                        ", $.entry.entryData.displayId" +
                        ", $.entry.entryData.folderId" +
                        ", $.entry.entryData.createdAt" +
                        ", $.entry.entryData.modifiedAt" +
                        ", $.authorsFormatted.authorsFormatted" + // Authors
                        ", $.entry.entryData.schema.id" +
                        ", $.entry.entryData.schema.name" +
                        ", $.fieldsFormatted.fieldsFormatted" + // Fields
                        ", $.customFieldsFormatted.customFieldsFormatted" + // Custom fields
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
                    "FILES": FILES,
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
            resultPath: '$.authorsFormatted',
        }).itemProcessor(appendFormattedAuthor);
    }

    private joinListVariables(): stepfunctions.Pass {
        // Use States.JsonToString to serialize arrays to strings, which can be post-processed in Lambda if needed.
        return new stepfunctions.Pass(this.scope, 'JoinFormattedLists', {
            parameters: {
                "fieldsFormatted.$": "States.JsonToString($.fieldsFormatted.fieldsFormatted)",
                "customFieldsFormatted.$": "States.JsonToString($.customFieldsFormatted.customFieldsFormatted)",
                "authorsFormatted.$": "States.JsonToString($.authorsFormatted.authorsFormatted)"
            },
            resultPath: "$"
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
