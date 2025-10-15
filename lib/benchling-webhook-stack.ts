import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";
import { WebhookApi } from "./api-gateway";
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
    readonly webhookAllowList?: string;
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

        // Create CloudFormation parameters for runtime-configurable values
        // Note: Use actual values from props during initial deployment to avoid empty string issues
        // Parameters can be updated later via CloudFormation stack updates

        // Security and configuration parameters
        const webhookAllowListParam = new cdk.CfnParameter(this, "WebhookAllowList", {
            type: "String",
            description: "Comma-separated list of IP addresses allowed to send webhooks (leave empty to allow all IPs)",
            default: props.webhookAllowList || "",
        });

        const quiltCatalogParam = new cdk.CfnParameter(this, "QuiltCatalog", {
            type: "String",
            description: "Quilt catalog URL for package links",
            default: props.quiltCatalog || "open.quiltdata.com",
        });

        // Infrastructure parameters - these can be updated without redeploying
        const bucketNameParam = new cdk.CfnParameter(this, "BucketName", {
            type: "String",
            description: "S3 bucket name for storing packages",
            default: props.bucketName,
        });

        const prefixParam = new cdk.CfnParameter(this, "PackagePrefix", {
            type: "String",
            description: "Prefix for package names (no slashes)",
            default: props.prefix,
        });

        const queueNameParam = new cdk.CfnParameter(this, "QueueName", {
            type: "String",
            description: "SQS queue name for package notifications",
            default: props.queueName,
        });

        // Use props values on first deploy, then use parameters for updates
        // This ensures we don't have empty parameter issues during initial deployment
        const webhookAllowListValue = props.webhookAllowList || webhookAllowListParam.valueAsString;
        const quiltCatalogValue = props.quiltCatalog || quiltCatalogParam.valueAsString;
        const bucketNameValue = props.bucketName || bucketNameParam.valueAsString;
        const prefixValue = props.prefix || prefixParam.valueAsString;
        const queueNameValue = props.queueName || queueNameParam.valueAsString;

        this.bucket = s3.Bucket.fromBucketName(this, "BWBucket", bucketNameValue);

        const benchlingConnection = this.createBenchlingConnection(props);

        // Create the webhook state machine
        this.stateMachine = new WebhookStateMachine(this, "StateMachine", {
            bucket: this.bucket,
            prefix: prefixValue,
            queueName: queueNameValue,
            region: this.region,
            account: this.account,
            benchlingConnection,
            benchlingTenant: props.benchlingTenant,
            quiltCatalog: quiltCatalogValue,
            webhookAllowList: webhookAllowListValue,
        });

        this.api = new WebhookApi(this, "WebhookApi", {
            stateMachine: this.stateMachine.stateMachine,
            webhookAllowList: webhookAllowListValue,
        });

        // this.createOutputs();
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
