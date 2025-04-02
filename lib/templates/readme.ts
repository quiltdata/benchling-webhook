import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { FILES } from "../constants";
import { BaseTemplate } from "./base-template";

export class ReadmeTemplate extends BaseTemplate {
    protected template(): string {
        return "# Package With Quilt\n\n" +
               "## Benchling Webhook Example\n\n" +
               "This auto-generated package uses Amazon Step Functions " + 
               "to collect data and metadata" +
               "for the Benchling Notebook entry: {} ({}).\n\n" +
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
                        ", $.entry.entryData.name" +
                        ", $.entry.entryData.id" +
                        ", $.files.FILES.ENTRY_JSON,  $.files.FILES.ENTRY_JSON" +
                        ", $.files.FILES.INPUT_JSON,  $.files.FILES.INPUT_JSON" +
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

    public createMarkdown(): stepfunctions.Chain {
        return stepfunctions.Chain
            .start(this.setupFiles())
            .next(super.createMarkdown());
    }
}
