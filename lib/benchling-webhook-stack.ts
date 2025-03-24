import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { Construct } from "constructs";
import { WebhookApi } from "./api-gateway";
import { WebhookStateMachine } from "./state-machine";

interface BenchlingWebhookStackProps extends cdk.StackProps {
    readonly bucketName: string;
    readonly environment: string;
    readonly prefix: string;
    readonly queueName: string;
    readonly benchlingClientId: string;
    readonly benchlingClientSecret: string;
}

export class BenchlingWebhookStack extends cdk.Stack {
    private readonly bucket: s3.IBucket;
    private readonly stateMachine: WebhookStateMachine;
    private readonly api: WebhookApi;
    private readonly exportProcessor: lambda.IFunction;

    constructor(
        scope: Construct,
        id: string,
        props: BenchlingWebhookStackProps,
    ) {
        super(scope, id, props);
        if (props.prefix.includes("/")) {
            throw new Error("Prefix should not contain a '/' character.");
        }

        this.bucket = s3.Bucket.fromBucketName(this, "BWBucket", props.bucketName);

        // Create the export processor Lambda
        this.exportProcessor = new nodejs.NodejsFunction(this, "ExportProcessor", {
            entry: path.join(__dirname, "lambda/process-export.ts"),
            handler: "handler",
            runtime: lambda.Runtime.NODEJS_18_X,
            timeout: cdk.Duration.minutes(5),
            memorySize: 1024,
            environment: {
                NODE_OPTIONS: "--enable-source-maps",
            },
            architecture: lambda.Architecture.ARM_64,
            bundling: {
                minify: true,
                sourceMap: false,
                externalModules: [
                    "@aws-sdk/client-s3",
                ],
                forceDockerBundling: false,
                target: "node18",
                define: {
                    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production"),
                },
            },
        });

        // Grant the Lambda function access to the S3 bucket
        this.bucket.grantReadWrite(this.exportProcessor);

        this.stateMachine = new WebhookStateMachine(this, "StateMachine", {
            bucket: this.bucket,
            prefix: props.prefix,
            queueName: props.queueName,
            region: this.region,
            account: this.account,
            benchlingClientId: props.benchlingClientId,
            benchlingClientSecret: props.benchlingClientSecret,
            exportProcessor: this.exportProcessor,
        });

        this.api = new WebhookApi(this, "WebhookApi", this.stateMachine.stateMachine);

        this.createOutputs();
    }



    private createOutputs(): void {
        new cdk.CfnOutput(this, "ApiUrl", {
            value: this.api.api.url,
            description: "API Gateway endpoint URL",
        });
    }
}
