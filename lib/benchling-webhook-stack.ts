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
    readonly queueArn: string;
    readonly benchlingClientId: string;
    readonly benchlingClientSecret: string;
    readonly benchlingTenant: string;
    readonly quiltCatalog?: string;
    readonly quiltDatabase: string;
    readonly webhookAllowList?: string;
    readonly createEcrRepository?: boolean;
    readonly ecrRepositoryName?: string;
    readonly logLevel?: string;
    readonly imageTag?: string;
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

        const pkgKeyParam = new cdk.CfnParameter(this, "PackageKey", {
            type: "String",
            description: "Metadata key used to link Benchling entries to Quilt packages",
            default: "experiment_id",
        });

        const queueArnParam = new cdk.CfnParameter(this, "QueueArn", {
            type: "String",
            description: "SQS queue ARN for package notifications",
            default: props.queueArn,
        });

        const quiltDatabaseParam = new cdk.CfnParameter(this, "QuiltDatabase", {
            type: "String",
            description: "Quilt database name (Glue Data Catalog database)",
            default: props.quiltDatabase,
        });

        // DEPRECATED: Benchling tenant parameter (kept for backward compatibility)
        const benchlingTenantParam = new cdk.CfnParameter(this, "BenchlingTenant", {
            type: "String",
            description: "[DEPRECATED] Use BenchlingSecrets parameter instead. Benchling tenant name (e.g., 'company' for company.benchling.com)",
            default: props.benchlingTenant,
        });

        const logLevelParam = new cdk.CfnParameter(this, "LogLevel", {
            type: "String",
            description: "Application log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)",
            default: props.logLevel || "INFO",
            allowedValues: ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        });

        const enableWebhookVerificationParam = new cdk.CfnParameter(this, "EnableWebhookVerification", {
            type: "String",
            description: "Enable webhook signature verification (true/false)",
            default: "true",
            allowedValues: ["true", "false"],
        });

        const imageTagParam = new cdk.CfnParameter(this, "ImageTag", {
            type: "String",
            description: "Docker image tag to deploy (e.g., latest, 0.5.3, 0.5.3-20251030T123456Z)",
            default: props.imageTag || "latest",
        });

        // Benchling Secrets - consolidated secret parameter (Phase 3)
        const benchlingSecretsParam = new cdk.CfnParameter(this, "BenchlingSecrets", {
            type: "String",
            description: "JSON string containing Benchling secrets (client_id, client_secret, tenant, app_definition_id)",
            default: "",
            noEcho: true,
        });

        // DEPRECATED: Individual secret parameters (kept for backward compatibility)
        const benchlingClientIdParam = new cdk.CfnParameter(this, "BenchlingClientId", {
            type: "String",
            description: "[DEPRECATED] Use BenchlingSecrets parameter instead. Benchling OAuth client ID.",
            default: "",
            noEcho: true,
        });

        const benchlingClientSecretParam = new cdk.CfnParameter(this, "BenchlingClientSecret", {
            type: "String",
            description: "[DEPRECATED] Use BenchlingSecrets parameter instead. Benchling OAuth client secret.",
            default: "",
            noEcho: true,
        });

        // Use parameter values (which have props as defaults)
        // This allows runtime updates via CloudFormation
        const webhookAllowListValue = webhookAllowListParam.valueAsString;
        const quiltCatalogValue = quiltCatalogParam.valueAsString;
        const bucketNameValue = bucketNameParam.valueAsString;
        const prefixValue = prefixParam.valueAsString;
        const pkgKeyValue = pkgKeyParam.valueAsString;
        const queueArnValue = queueArnParam.valueAsString;
        const quiltDatabaseValue = quiltDatabaseParam.valueAsString;
        const benchlingTenantValue = benchlingTenantParam.valueAsString;
        const logLevelValue = logLevelParam.valueAsString;
        const enableWebhookVerificationValue = enableWebhookVerificationParam.valueAsString;
        const imageTagValue = imageTagParam.valueAsString;
        // Phase 3: New secret parameters (will be used in Episode 4)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const benchlingSecretsValue = benchlingSecretsParam.valueAsString;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const benchlingClientIdValue = benchlingClientIdParam.valueAsString;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const benchlingClientSecretValue = benchlingClientSecretParam.valueAsString;

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
        // Use imageTag for stackVersion if it looks like a timestamped dev version
        // (e.g., "0.5.3-20251031T000139Z"), otherwise use package.json version
        const isDevVersion = imageTagValue.match(/^\d+\.\d+\.\d+-\d{8}T\d{6}Z$/);
        const stackVersion = isDevVersion ? imageTagValue : packageJson.version;

        this.fargateService = new FargateService(this, "FargateService", {
            vpc,
            bucket: this.bucket,
            queueArn: queueArnValue,
            region: this.region,
            account: this.account,
            prefix: prefixValue,
            pkgKey: pkgKeyValue,
            benchlingClientId: props.benchlingClientId,
            benchlingClientSecret: props.benchlingClientSecret,
            benchlingTenant: benchlingTenantValue,
            quiltCatalog: quiltCatalogValue,
            quiltDatabase: quiltDatabaseValue,
            webhookAllowList: webhookAllowListValue,
            ecrRepository: ecrRepo,
            imageTag: imageTagValue,
            stackVersion: stackVersion,
            logLevel: logLevelValue,
            enableWebhookVerification: enableWebhookVerificationValue,
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
