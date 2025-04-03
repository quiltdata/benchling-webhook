import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { Construct } from "constructs";
import { WebhookApi } from "./webhook-api";
import { WebhookStateMachine } from "./webhook-state-machine";

interface BenchlingWebhookStackProps extends cdk.StackProps {
    readonly bucketName: string;
    readonly environment: string;
    readonly prefix: string;
    readonly queueName: string;
    readonly benchlingClientId: string;
    readonly benchlingClientSecret: string;
    readonly benchlingTenant: string;
    readonly quiltCatalog?: string;
}

export class BenchlingWebhookStack extends cdk.Stack {
    private readonly bucket: s3.IBucket;
    private readonly stateMachine: WebhookStateMachine;
    private readonly api: WebhookApi;

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

        const benchlingConnection = this.createBenchlingConnection(props);

        // Create the webhook state machine
        this.stateMachine = new WebhookStateMachine(this, "StateMachine", {
            bucket: this.bucket,
            prefix: props.prefix,
            queueName: props.queueName,
            region: this.region,
            account: this.account,
            benchlingConnection,
            benchlingTenant: props.benchlingTenant,
            quiltCatalog: props.quiltCatalog,
        });

        this.api = new WebhookApi(this, "WebhookApi", this.stateMachine.stateMachine);

        this.createOutputs();
    }


    private createBenchlingConnection(
        props: BenchlingWebhookStackProps,
    ): events.CfnConnection {
        const benchlingConnection = new events.CfnConnection(
            this,
            "BenchlingOAuthConnection",
            {
                authorizationType: "OAUTH_CLIENT_CREDENTIALS",
                authParameters: {
                    oAuthParameters: {
                        authorizationEndpoint:
                            `https://${props.benchlingTenant}.benchling.com/api/v2/token`,
                        clientParameters: {
                            clientId: props.benchlingClientId,
                            clientSecret: props.benchlingClientSecret,
                        },
                        httpMethod: "POST",
                        oAuthHttpParameters: {
                            headerParameters: [
                                {
                                    key: "Content-Type",
                                    value: "application/x-www-form-urlencoded",
                                },
                            ],
                            bodyParameters: [
                                {
                                    key: "grant_type",
                                    value: "client_credentials",
                                },
                            ],
                        },
                    },
                },
            },
        );
        return benchlingConnection;
    }

    private createOutputs(): void {
        new cdk.CfnOutput(this, "ApiUrl", {
            value: this.api.api.url,
            description: "API Gateway endpoint URL",
        });
    }
}
