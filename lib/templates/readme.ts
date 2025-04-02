import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";
import { FILES } from "../constants";

export class ReadmeTemplate {
    private readonly scope: Construct;
    private static readonly TEMPLATE = 
    "# Package With Quilt\n\n" +
    "## Benchling Webhook Example\n\n" +
    "This auto-generated package uses Amazon Step Functions " + 
    "to collect data and metadata" +
    "for the Benchling Notebook entry: {} ({}).\n\n" +
    "## Files\n\n" +
    "- [{}](./{}): Entry data\n" +
    "- [{}](./{}): Webhook event message\n";

    constructor(scope: Construct) {
        this.scope = scope;
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

    private createReadmeContent(): stepfunctions.Pass {
        return new stepfunctions.Pass(
            this.scope,
            "CreateReadme",
            {
                parameters: {
                    "readme.$": "States.Format('" + ReadmeTemplate.TEMPLATE + "'" +
                        ", $.entry.entryData.name" +
                        ", $.entry.entryData.id" +
                        ", $.files.FILES.ENTRY_JSON,  $.files.FILES.ENTRY_JSON" +
                        ", $.files.FILES.INPUT_JSON,  $.files.FILES.INPUT_JSON" +
                        ")",
                },
                resultPath: "$.readme",
            },
        );
    }

    public createReadmeChain(): stepfunctions.Chain {
        return stepfunctions.Chain
            .start(this.setupFiles())
            .next(this.createReadmeContent());
    }
}
