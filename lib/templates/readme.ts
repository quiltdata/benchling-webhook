import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { FILES } from "../constants";
import { BaseTemplate } from "./base-template";

export class ReadmeTemplate extends BaseTemplate {
    protected template(): string {
        return "# [{}]({})\n\n" +
            "## {}\n\n" +
            "* **Entry ID**: {}\n" +
            "* **Display ID**: {}\n" +
            "* **Folder ID**: {}\n" +
            "* **API URL**: {}\n" +
            "* **Created**: {} by {}\n" +
            "* **Modified**: {}\n\n" +
            "## Authors\n\n{}\n\n" +
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
                        ", $.entry.entryData.name" +  // H1 title (name)
                        ", $.entry.entryData.webURL" + // H1 url
                        ", $.entry.entryData.displayId" + // Blockquote (display ID)
                        ", $.entry.entryData.id" + // Entry ID
                        ", $.entry.entryData.displayId" + // Display ID
                        ", $.entry.entryData.folderId" + // Folder ID
                        ", $.entry.entryData.apiURL" + // API URL
                        ", $.entry.entryData.createdAt" + // Created timestamp
                        ", $.entry.entryData.creator.name" + // Creator name
                        ", $.entry.entryData.modifiedAt" + // Modified timestamp
                        ", States.Format('* {} <{}@{}>', $.entry.entryData.authors[0].name, $.entry.entryData.authors[0].handle, $.entry.entryData.authors[0].id)" + // First author only for simplicity
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
                    "FILES": FILES,
                },
                resultPath: "$.files",
            },
        );
    }

    private formatAuthors(): stepfunctions.Pass {
        // Simple pass - just pass through the authors array
        return new stepfunctions.Pass(this.scope, "FormatAuthors", {
            resultPath: stepfunctions.JsonPath.DISCARD,
        });
    }

    private joinListVariables(): stepfunctions.Pass {
        return new stepfunctions.Pass(this.scope, "JoinFormattedLists", {
            resultPath: stepfunctions.JsonPath.DISCARD,
        });
    }

    public createMarkdown(): stepfunctions.Chain {
        return stepfunctions.Chain
            .start(this.setupFiles())
            .next(this.formatAuthors())
            .next(this.joinListVariables())
            .next(super.createMarkdown());
    }
}
