import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { FargateService } from "./fargate-service";
import { AlbApiGateway } from "./alb-api-gateway";

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
    private readonly fargateService: FargateService;
    private readonly api: AlbApiGateway;

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

        // Use parameter values (which have props as defaults)
        // This allows runtime updates via CloudFormation
        const webhookAllowListValue = webhookAllowListParam.valueAsString;
        const quiltCatalogValue = quiltCatalogParam.valueAsString;
        const bucketNameValue = bucketNameParam.valueAsString;
        const prefixValue = prefixParam.valueAsString;
        const queueNameValue = queueNameParam.valueAsString;

        this.bucket = s3.Bucket.fromBucketName(this, "BWBucket", bucketNameValue);

        // Get the default VPC or create a new one
        const vpc = ec2.Vpc.fromLookup(this, "DefaultVPC", {
            isDefault: true,
        });

        // ECR image URI for the Benchling webhook Docker container
        const ecrImageUri = "712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:latest";

        // Create the Fargate service
        this.fargateService = new FargateService(this, "FargateService", {
            vpc,
            bucket: this.bucket,
            queueName: queueNameValue,
            region: this.region,
            account: this.account,
            prefix: prefixValue,
            benchlingClientId: props.benchlingClientId,
            benchlingClientSecret: props.benchlingClientSecret,
            benchlingTenant: props.benchlingTenant,
            quiltCatalog: quiltCatalogValue,
            webhookAllowList: webhookAllowListValue,
            ecrImageUri,
        });

        // Create API Gateway that routes to the ALB
        this.api = new AlbApiGateway(this, "ApiGateway", {
            loadBalancer: this.fargateService.loadBalancer,
            webhookAllowList: webhookAllowListValue,
        });
    }


}
