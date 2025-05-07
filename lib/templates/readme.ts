import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { FILES } from "../constants";
import { BaseTemplate } from "./base-template";

export class ReadmeTemplate extends BaseTemplate {
    protected template(): string {
        return "# {}({})\\n\\n" +
            "* id: {}\\n" +
            "* displayId: {}\\n" +
            "* folderId: {}\\n" +
            "* createdAt: {}\\n" +
            "* modifiedAt: {}\\n\\n" +
            "## Authors: {}\\n" +
            "## Schema\\n\\n" +
            "* id: {}\\n" +
            "* name: {}\\n\\n" +
            "## Fields\\n" +
            "{}\\n\\n" +
            "## Custom fields\\n" +
            "{}";
    }

    protected createContent(): stepfunctions.Pass {
        return new stepfunctions.Pass(
            this.scope,
            "CreateReadmeContent",
            {
                parameters: {
                    "content.$": "States.Format('" + this.template() + "'" +
                        ", $.entry.name" +
                        ", $.entry.webURL" +
                        ", $.entry.id" +
                        ", $.entry.displayId" +
                        ", $.entry.folderId" +
                        ", $.entry.createdAt" +
                        ", $.entry.modifiedAt" +
                        ", $.entry.authors" +
                        ", $.entry.schema.id" +
                        ", $.entry.schema.name" +
                        ", $.entry.fieldsFormatted" +
                        ", $.entry.customFieldsFormatted" +
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

    private formatFields(): stepfunctions.Map {
        const appendFormattedField = new stepfunctions.Pass(this.scope, 'AppendFormattedField', {
            parameters: {
                "formattedField.$": "States.Format('* {}: {}', $.name, $.displayValue)"
            },
            resultPath: "$.formattedField"
        });

        return new stepfunctions.Map(this.scope, 'FormatFields', {
            itemsPath: '$.entry.fields',
            resultPath: '$.fieldsFormatted',
        }).itemProcessor(appendFormattedField);
    }

    private formatCustomFields(): stepfunctions.Map {
        const appendFormattedCustomField = new stepfunctions.Pass(this.scope, 'AppendFormattedCustomField', {
            parameters: {
                "formattedCustomField.$": "States.Format('* {}: {}', $.name, $.value)"
            },
            resultPath: "$.formattedCustomField"
        });

        return new stepfunctions.Map(this.scope, 'FormatCustomFields', {
            itemsPath: '$.entry.customFields',
            resultPath: '$.customFieldsFormatted',
        }).itemProcessor(appendFormattedCustomField);
    }

    public createMarkdown(): stepfunctions.Chain {
        return stepfunctions.Chain
            .start(this.setupFiles())
            .next(this.formatFields())
            .next(this.formatCustomFields())
            .next(super.createMarkdown());
    }
}
