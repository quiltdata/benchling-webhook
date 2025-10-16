import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export abstract class BaseTemplate {
    protected readonly scope: Construct;
    protected readonly name: string;

    constructor(scope: Construct) {
        this.scope = scope;
        this.name = this.constructor.name;
    }

    protected abstract template(): string;
    protected abstract createContent(): stepfunctions.Pass;

    public createMarkdown(): stepfunctions.Chain {
        return stepfunctions.Chain
            .start(this.createContent())
            .next(new stepfunctions.Pass(
                this.scope,
                `Create${this.name}Markdown`,
                {
                    parameters: {
                        "markdown.$": "$.content.content",
                    },
                    resultPath: "$.markdown",
                },
            ));
    }

    public write(stringProcessor: lambda.IFunction, bucket: s3.IBucket, key: string): stepfunctions.Chain {
        return this.createMarkdown()
            .next(new tasks.LambdaInvoke(
                this.scope,
                `Write${this.name}`,
                {
                    lambdaFunction: stringProcessor,
                    payload: stepfunctions.TaskInput.fromObject({
                        bucket: bucket.bucketName,
                        key: stepfunctions.JsonPath.stringAt(
                            `States.Format('{}/{}', $.packageName, '${key}')`,
                        ),
                        body: stepfunctions.JsonPath.stringAt("$.markdown.markdown"),
                    }),
                    resultPath: "$.writeResult",
                },
            ));
    }
}
