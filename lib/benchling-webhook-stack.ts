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
    // ===== Secrets-Only Mode (v0.6.0+) =====
    /**
     * ARN of the Quilt CloudFormation stack.
     * All configuration is resolved from AWS (CloudFormation outputs + Secrets Manager).
     * Format: arn:aws:cloudformation:{region}:{account}:stack/{name}/{id}
     * REQUIRED.
     */
    readonly quiltStackArn: string;
    /**
     * Name or ARN of the AWS Secrets Manager secret containing Benchling credentials.
     * Secret must contain: client_id, client_secret, tenant, app_definition_id (optional)
     * REQUIRED.
     */
    readonly benchlingSecret: string;

    // ===== Common Options =====
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

        // Validate required secrets-only mode parameters
        if (!props.quiltStackArn || !props.benchlingSecret) {
            throw new Error(
                "Secrets-only mode (v0.6.0+) requires both:\n" +
                "  - quiltStackArn: CloudFormation stack ARN\n" +
                "  - benchlingSecret: Secrets Manager secret name\n\n" +
                "See: https://github.com/quiltdata/benchling-webhook/issues/156",
            );
        }
        console.log("✓ Using secrets-only mode (v0.6.0+)");

        // Create CloudFormation parameters for runtime-configurable values
        // Parameters can be updated via CloudFormation stack updates

        // ===== Secrets-Only Mode Parameters (v0.6.0+) =====
        const quiltStackArnParam = new cdk.CfnParameter(this, "QuiltStackARN", {
            type: "String",
            description: "ARN of Quilt CloudFormation stack for configuration resolution",
            default: props.quiltStackArn,
        });

        const benchlingSecretParam = new cdk.CfnParameter(this, "BenchlingSecret", {
            type: "String",
            description: "Name/ARN of Secrets Manager secret with Benchling credentials",
            default: props.benchlingSecret,
        });

        const logLevelParam = new cdk.CfnParameter(this, "LogLevel", {
            type: "String",
            description: "Application log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)",
            default: props.logLevel || "INFO",
            allowedValues: ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        });

        const imageTagParam = new cdk.CfnParameter(this, "ImageTag", {
            type: "String",
            description: "Docker image tag to deploy (e.g., latest, 0.5.3, 0.5.3-20251030T123456Z)",
            default: props.imageTag || "latest",
        });

        // Use parameter values (which have props as defaults)
        // This allows runtime updates via CloudFormation
        const quiltStackArnValue = quiltStackArnParam.valueAsString;
        const benchlingSecretValue = benchlingSecretParam.valueAsString;
        const logLevelValue = logLevelParam.valueAsString;
        const imageTagValue = imageTagParam.valueAsString;

        // Bucket name will be resolved at runtime from CloudFormation outputs
        // For CDK purposes, we use a placeholder for IAM permissions
        this.bucket = s3.Bucket.fromBucketName(this, "BWBucket", "placeholder-bucket-resolved-at-runtime");

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

        // Build Fargate Service props - secrets-only mode
        this.fargateService = new FargateService(this, "FargateService", {
            vpc,
            bucket: this.bucket,
            region: this.region,
            account: this.account,
            ecrRepository: ecrRepo,
            imageTag: imageTagValue,
            stackVersion: stackVersion,
            logLevel: logLevelValue,
            // Secrets-only mode: Only 2 required parameters
            quiltStackArn: quiltStackArnValue,
            benchlingSecret: benchlingSecretValue,
        });

        // Create API Gateway that routes to the ALB
        // For Phase 1a, we create a single "prod" environment
        // In Phase 1b, we'll add "dev" environment when multiple services are implemented
        this.api = new AlbApiGateway(this, "ApiGateway", {
            loadBalancer: this.fargateService.loadBalancer,
            webhookAllowList: "", // Empty allow list = allow all IPs
            environments: [
                {
                    stageName: "prod",
                    targetGroup: this.fargateService.targetGroup,
                },
            ],
        });

        // Store webhook endpoint for easy access
        // Use the prod stage URL
        const prodStage = this.api.stages.get("prod");
        if (!prodStage) {
            throw new Error("Expected prod stage to exist in API Gateway");
        }
        this.webhookEndpoint = prodStage.urlForPath("/");

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
