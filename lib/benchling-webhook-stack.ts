import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";
import { FargateService, FargateEnvironmentConfig } from "./fargate-service";
import { AlbApiGateway, ApiGatewayEnvironment } from "./alb-api-gateway";
import { EcrRepository } from "./ecr-repository";
import { ProfileConfig } from "./types/config";
import packageJson from "../package.json";

/**
 * Stack properties for BenchlingWebhookStack (v0.7.0+)
 *
 * Configuration is provided via ProfileConfig interface, which contains
 * all necessary settings for deployment in a structured format.
 *
 * Supports two deployment modes:
 * 1. Multi-environment mode: When `environments` array is provided, creates
 *    separate ECS services and API Gateway stages per environment.
 * 2. Legacy single-service mode: When `environments` is omitted, creates a
 *    single service with a single API Gateway stage (backward compatible).
 */
export interface BenchlingWebhookStackProps extends cdk.StackProps {
    /**
     * Profile configuration containing all deployment settings
     * This replaces the previous secrets-only mode parameters.
     */
    readonly config: ProfileConfig;

    /**
     * Whether to create a new ECR repository
     * If false, uses existing repository specified in config.deployment.ecrRepository
     * @default false
     */
    readonly createEcrRepository?: boolean;

    /**
     * Multi-environment configuration (optional)
     * When provided, creates separate ECS services and API Gateway stages per environment.
     * When omitted, uses legacy single-service mode (backward compatible).
     * @example
     * ```typescript
     * environments: [
     *   { name: "dev", imageTag: "latest", secretName: "dev-secret", minCapacity: 1, maxCapacity: 3 },
     *   { name: "prod", imageTag: "0.7.0", secretName: "prod-secret", minCapacity: 2, maxCapacity: 10 }
     * ]
     * ```
     */
    readonly environments?: FargateEnvironmentConfig[];
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

        const { config } = props;

        // Validate required configuration fields
        if (!config.quilt.stackArn || !config.benchling.secretArn) {
            throw new Error(
                "Configuration validation failed. Required fields:\n" +
                "  - config.quilt.stackArn: CloudFormation stack ARN\n" +
                "  - config.benchling.secretArn: Secrets Manager secret ARN\n\n" +
                "Run 'npm run setup' to configure your deployment.",
            );
        }

        console.log(`Deploying with profile configuration (v${config._metadata.version})`);
        console.log(`  Quilt Stack: ${config.quilt.stackArn}`);
        console.log(`  Benchling Tenant: ${config.benchling.tenant}`);
        console.log(`  Region: ${config.deployment.region}`);

        // Create CloudFormation parameters for runtime-configurable values
        // These parameters can be updated via CloudFormation stack updates

        const quiltStackArnParam = new cdk.CfnParameter(this, "QuiltStackARN", {
            type: "String",
            description: "ARN of Quilt CloudFormation stack for configuration resolution",
            default: config.quilt.stackArn,
        });

        const benchlingSecretParam = new cdk.CfnParameter(this, "BenchlingSecretARN", {
            type: "String",
            description: "ARN of Secrets Manager secret with Benchling credentials",
            default: config.benchling.secretArn,
        });

        const logLevelParam = new cdk.CfnParameter(this, "LogLevel", {
            type: "String",
            description: "Application log level (DEBUG, INFO, WARNING, ERROR)",
            default: config.logging?.level || "INFO",
            allowedValues: ["DEBUG", "INFO", "WARNING", "ERROR"],
        });

        const imageTagParam = new cdk.CfnParameter(this, "ImageTag", {
            type: "String",
            description: "Docker image tag to deploy (e.g., latest, 0.7.0, 0.7.0-20251104T123456Z)",
            default: config.deployment.imageTag || "latest",
        });

        // Use parameter values (which have config as defaults)
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
        const repoName = config.deployment.ecrRepository || "quiltdata/benchling";

        if (props.createEcrRepository) {
            const newRepo = new EcrRepository(this, "EcrRepository", {
                repositoryName: repoName,
                publicReadAccess: true,
            });
            ecrRepo = newRepo.repository;
            ecrImageUri = `${newRepo.repositoryUri}:${imageTagValue}`;
        } else {
            // Reference existing ECR repository
            ecrRepo = ecr.Repository.fromRepositoryName(this, "ExistingEcrRepository", repoName);
            const account = config.deployment.account || this.account;
            const region = config.deployment.region;
            ecrImageUri = `${account}.dkr.ecr.${region}.amazonaws.com/${repoName}:${imageTagValue}`;
        }

        // Create the Fargate service
        // Use imageTag for stackVersion if it looks like a timestamped dev version
        // (e.g., "0.7.0-20251104T000139Z"), otherwise use package.json version
        const isDevVersion = imageTagValue.match(/^\d+\.\d+\.\d+-\d{8}T\d{6}Z$/);
        const stackVersion = isDevVersion ? imageTagValue : packageJson.version;

        // Determine deployment mode: multi-environment or legacy single-service
        const isMultiEnvironment = props.environments && props.environments.length > 0;

        if (isMultiEnvironment) {
            // Multi-environment mode: Create Fargate service with environments
            this.fargateService = new FargateService(this, "FargateService", {
                vpc,
                bucket: this.bucket,
                config: config,
                ecrRepository: ecrRepo,
                // Runtime-configurable parameters
                quiltStackArn: quiltStackArnValue,
                benchlingSecret: benchlingSecretValue,
                logLevel: logLevelValue,
                // Multi-environment configuration
                environments: props.environments,
            });

            // Map Fargate target groups to API Gateway environments
            const apiGatewayEnvs: ApiGatewayEnvironment[] = props.environments!.map(env => ({
                stageName: env.name,
                targetGroup: this.fargateService.targetGroups.get(env.name)!,
            }));

            // Create API Gateway with multiple stages
            this.api = new AlbApiGateway(this, "ApiGateway", {
                loadBalancer: this.fargateService.loadBalancer,
                config: config,
                environments: apiGatewayEnvs,
            });

            // Store webhook endpoint for the first environment (for backward compatibility)
            // In multi-environment mode, users should access specific stage URLs
            const firstStage = this.api.stages.get(props.environments![0].name)!;
            this.webhookEndpoint = firstStage.urlForPath("/");
        } else {
            // Legacy single-service mode: Maintain backward compatibility
            this.fargateService = new FargateService(this, "FargateService", {
                vpc,
                bucket: this.bucket,
                config: config,
                ecrRepository: ecrRepo,
                imageTag: imageTagValue,
                stackVersion: stackVersion,
                // Runtime-configurable parameters
                quiltStackArn: quiltStackArnValue,
                benchlingSecret: benchlingSecretValue,
                logLevel: logLevelValue,
            });

            // Create single API Gateway stage pointing to single target group
            const defaultTargetGroup = this.fargateService.targetGroups.get("default")!;
            this.api = new AlbApiGateway(this, "ApiGateway", {
                loadBalancer: this.fargateService.loadBalancer,
                config: config,
                environments: [
                    {
                        stageName: "prod",
                        targetGroup: defaultTargetGroup,
                    },
                ],
            });

            // Store webhook endpoint from the single stage
            this.webhookEndpoint = this.api.stages.get("prod")!.urlForPath("/");
        }

        // Export webhook endpoint as a stack output
        // In multi-environment mode, this points to the first environment's stage
        // Users should access environment-specific URLs for production use
        new cdk.CfnOutput(this, "WebhookEndpoint", {
            value: this.webhookEndpoint,
            description: isMultiEnvironment
                ? `Default webhook endpoint (${props.environments![0].name} stage) - see stage-specific outputs for other environments`
                : "Webhook endpoint URL - use this in Benchling app configuration",
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
        if (isMultiEnvironment) {
            // In multi-environment mode, output the first environment's log group as default
            const firstEnv = props.environments![0];
            const firstLogGroup = this.fargateService.logGroups.get(firstEnv.name)!;
            new cdk.CfnOutput(this, "EcsLogGroup", {
                value: firstLogGroup.logGroupName,
                description: `CloudWatch log group for ECS container logs (${firstEnv.name}) - see environment-specific outputs for others`,
            });

            // Output environment-specific log groups
            for (const env of props.environments!) {
                const logGroup = this.fargateService.logGroups.get(env.name)!;
                new cdk.CfnOutput(this, `${env.name}EcsLogGroup`, {
                    value: logGroup.logGroupName,
                    description: `CloudWatch log group for ${env.name} ECS container logs`,
                });
            }
        } else {
            // Legacy single-service mode
            new cdk.CfnOutput(this, "EcsLogGroup", {
                value: this.fargateService.logGroup.logGroupName,
                description: "CloudWatch log group for ECS container logs",
            });
        }

        new cdk.CfnOutput(this, "ApiGatewayLogGroup", {
            value: this.api.logGroup.logGroupName,
            description: "CloudWatch log group for API Gateway access logs",
        });

        // Export configuration metadata
        new cdk.CfnOutput(this, "ConfigVersion", {
            value: config._metadata.version,
            description: "Configuration schema version",
        });

        new cdk.CfnOutput(this, "ConfigSource", {
            value: config._metadata.source,
            description: "Configuration source (wizard, manual, cli)",
        });

        // Export deployment mode
        new cdk.CfnOutput(this, "DeploymentMode", {
            value: isMultiEnvironment ? "multi-environment" : "single-service",
            description: "Deployment mode (multi-environment or single-service)",
        });

        // Export environment count for multi-environment deployments
        if (isMultiEnvironment) {
            new cdk.CfnOutput(this, "EnvironmentCount", {
                value: props.environments!.length.toString(),
                description: "Number of deployed environments",
            });

            new cdk.CfnOutput(this, "Environments", {
                value: props.environments!.map(e => e.name).join(", "),
                description: "Deployed environment names",
            });
        }
    }


}
