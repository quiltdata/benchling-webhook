import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { FILES } from "../constants";
import { BaseTemplate } from "./base-template";

export class ReadmeTemplate extends BaseTemplate {
    protected template(): string {
        return "# {} ({})\n\n" +
            "* id: {}\n" +
            "* displayId: {}\n" +
            "* folderId: {}\n" +
            "* createdAt: {}\n" +
            "* modifiedAt: {}\n\n" +
            "## Authors: {}\n" +
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
                        ", States.Join('\\n', $.authorsFormatted.authorsFormatted)" + // Join authors with newlines
                        ", $.entry.entryData.schema.id" +
                        ", $.entry.entryData.schema.name" +
                        ", States.Join('\\n', $.fieldsFormatted.fieldsFormatted)" + // Join fields with newlines
                        ", States.Join('\\n', $.customFieldsFormatted.customFieldsFormatted)" + // Join custom fields with newlines
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

    private formatAuthors(): stepfunctions.Pass {
        return new stepfunctions.Pass(this.scope, 'FormatAuthors', {
            parameters: {
                "authorsFormatted.$": "States.Array(States.Format('* {}', States.StringToJson(States.JsonToString($.entry.entryData.authors))))"
            },
            resultPath: "$.authorsFormatted"
        });
    }

    public createMarkdown(): stepfunctions.Chain {
        return stepfunctions.Chain
            .start(this.setupFiles())
            .next(this.formatFields())
            .next(this.formatCustomFields())
            .next(this.formatAuthors())
            .next(super.createMarkdown());
    }
}
