import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";
import { FargateService } from "./fargate-service";
import { AlbApiGateway } from "./alb-api-gateway";
import { EcrRepository } from "./ecr-repository";
import packageJson from "../package.json";

export interface BenchlingWebhookStackProps extends cdk.StackProps {
    readonly bucketName: string;
    readonly environment: string;
    readonly prefix: string;
    readonly queueName: string;
    readonly benchlingClientId: string;
    readonly benchlingClientSecret: string;
    readonly benchlingTenant: string;
    readonly quiltCatalog?: string;
    readonly quiltDatabase: string;
    readonly webhookAllowList?: string;
    readonly createEcrRepository?: boolean;
    readonly ecrRepositoryName?: string;
}

export class BenchlingWebhookStack extends cdk.Stack {
    private readonly bucket: s3.IBucket;
    private readonly fargateService: FargateService;
    private readonly api: AlbApiGateway;
    public readonly webhookEndpoint: string;

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

        // Get or create ECR repository
        let ecrRepo: ecr.IRepository;
        let ecrImageUri: string;
        if (props.createEcrRepository) {
            const newRepo = new EcrRepository(this, "EcrRepository", {
                repositoryName: props.ecrRepositoryName || "quiltdata/benchling",
                publicReadAccess: true,
            });
            ecrRepo = newRepo.repository;
            ecrImageUri = `${newRepo.repositoryUri}:latest`;
        } else {
            // Reference existing ECR repository
            const repoName = props.ecrRepositoryName || "quiltdata/benchling";
            ecrRepo = ecr.Repository.fromRepositoryName(this, "ExistingEcrRepository", repoName);
            ecrImageUri = `${this.account}.dkr.ecr.${this.region}.amazonaws.com/${repoName}:latest`;
        }

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
            quiltDatabase: props.quiltDatabase,
            webhookAllowList: webhookAllowListValue,
            ecrRepository: ecrRepo,
            imageTag: "latest",
        });

        // Create API Gateway that routes to the ALB
        this.api = new AlbApiGateway(this, "ApiGateway", {
            loadBalancer: this.fargateService.loadBalancer,
            webhookAllowList: webhookAllowListValue,
        });

        // Store webhook endpoint for easy access
        this.webhookEndpoint = this.api.api.url;

        // Export webhook endpoint as a stack output
        new cdk.CfnOutput(this, "WebhookEndpoint", {
            value: this.webhookEndpoint,
            description: "Webhook endpoint URL - use this in Benchling app configuration",
        });

        // Export Docker image information
        new cdk.CfnOutput(this, "DockerImageUri", {
            value: ecrImageUri,
            description: "Docker image URI used for deployment",
        });

        // Export version information
        new cdk.CfnOutput(this, "StackVersion", {
            value: this.node.tryGetContext("version") || packageJson.version,
            description: "Stack version",
        });

        // Export CloudWatch log groups
        new cdk.CfnOutput(this, "EcsLogGroup", {
            value: this.fargateService.logGroup.logGroupName,
            description: "CloudWatch log group for ECS container logs",
        });

        new cdk.CfnOutput(this, "ApiGatewayLogGroup", {
            value: this.api.logGroup.logGroupName,
            description: "CloudWatch log group for API Gateway access logs",
        });
    }


}
