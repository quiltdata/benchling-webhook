import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";
import { FargateService } from "./fargate-service";
import { HttpApiGateway } from "./http-api-gateway";
import { ProfileConfig } from "./types/config";
import packageJson from "../package.json";

/**
 * Stack properties for BenchlingWebhookStack (v0.7.0+)
 *
 * Configuration is provided via ProfileConfig interface, which contains
 * all necessary settings for deployment in a structured format.
 */
export interface BenchlingWebhookStackProps extends cdk.StackProps {
    /**
     * Profile configuration containing all deployment settings
     * This replaces the previous secrets-only mode parameters.
     */
    readonly config: ProfileConfig;
}

export class BenchlingWebhookStack extends cdk.Stack {
    private readonly fargateService: FargateService;
    private readonly api: HttpApiGateway;
    public readonly webhookEndpoint: string;

    constructor(
        scope: Construct,
        id: string,
        props: BenchlingWebhookStackProps,
    ) {
        super(scope, id, props);

        const { config } = props;

        // Validate required configuration fields
        // Skip validation if SKIP_CONFIG_VALIDATION is set (for destroy operations)
        const skipValidation = process.env.SKIP_CONFIG_VALIDATION === "true";
        if (!skipValidation && !config.benchling.secretArn) {
            throw new Error(
                "Configuration validation failed. Required fields:\n" +
                "  - config.benchling.secretArn: Secrets Manager secret ARN\n\n" +
                "Run 'npm run setup' to configure your deployment.",
            );
        }

        console.log(`Deploying with profile configuration (v${config._metadata.version})`);
        console.log(`  Benchling Tenant: ${config.benchling.tenant}`);
        console.log(`  Region: ${config.deployment.region}`);

        // Create CloudFormation parameters for runtime-configurable values
        // These parameters can be updated via CloudFormation stack updates

        // Explicit service parameters (v1.0.0+)
        // These replace runtime resolution from QuiltStackARN
        const packagerQueueUrlParam = new cdk.CfnParameter(this, "PackagerQueueUrl", {
            type: "String",
            description: "SQS queue URL for Quilt package creation jobs",
            default: "",  // Will be resolved at deployment time
        });

        const athenaUserDatabaseParam = new cdk.CfnParameter(this, "AthenaUserDatabase", {
            type: "String",
            description: "Athena/Glue database name for Quilt catalog metadata",
            default: "",  // Will be resolved at deployment time
        });

        const quiltWebHostParam = new cdk.CfnParameter(this, "QuiltWebHost", {
            type: "String",
            description: "Quilt catalog domain (without protocol or trailing slash)",
            default: "",  // Will be resolved at deployment time
        });

        const icebergDatabaseParam = new cdk.CfnParameter(this, "IcebergDatabase", {
            type: "String",
            description: "Iceberg database name (optional, leave empty if not used)",
            default: "",
        });

        // NEW: Optional Athena resources (from Quilt stack discovery)
        const icebergWorkgroupParam = new cdk.CfnParameter(this, "IcebergWorkgroup", {
            type: "String",
            description: "Iceberg workgroup name (optional, from Quilt stack discovery)",
            default: "",
        });

        const athenaUserWorkgroupParam = new cdk.CfnParameter(this, "AthenaUserWorkgroup", {
            type: "String",
            description: "Athena workgroup for user queries (optional, from Quilt stack discovery)",
            default: "",
        });

        const athenaResultsBucketParam = new cdk.CfnParameter(this, "AthenaResultsBucket", {
            type: "String",
            description: "S3 bucket for Athena query results (optional, from Quilt stack discovery)",
            default: "",
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

        const packageBucketParam = new cdk.CfnParameter(this, "PackageBucket", {
            type: "String",
            description: "S3 bucket name for Quilt packages (resolved from Quilt stack outputs at runtime)",
            default: config.packages.bucket,
        });

        const quiltDatabaseParam = new cdk.CfnParameter(this, "QuiltDatabase", {
            type: "String",
            description: "Glue database name for Quilt packages (resolved from Quilt stack outputs at runtime)",
            default: config.quilt.database || "",
        });

        // Use parameter values (which have config as defaults)
        // This allows runtime updates via CloudFormation
        const packagerQueueUrlValue = packagerQueueUrlParam.valueAsString;
        const athenaUserDatabaseValue = athenaUserDatabaseParam.valueAsString;
        const quiltWebHostValue = quiltWebHostParam.valueAsString;
        const icebergDatabaseValue = icebergDatabaseParam.valueAsString;
        const icebergWorkgroupValue = icebergWorkgroupParam.valueAsString;
        const athenaUserWorkgroupValue = athenaUserWorkgroupParam.valueAsString;
        const athenaResultsBucketValue = athenaResultsBucketParam.valueAsString;
        const benchlingSecretValue = benchlingSecretParam.valueAsString;
        const logLevelValue = logLevelParam.valueAsString;
        const imageTagValue = imageTagParam.valueAsString;
        const packageBucketValue = packageBucketParam.valueAsString;
        const quiltDatabaseValue = quiltDatabaseParam.valueAsString;

        // Bucket name will be resolved at runtime from CloudFormation outputs
        // For CDK purposes, we use a placeholder for IAM permissions

        // VPC Configuration (v0.9.0+)
        // Architecture mirrors ~/GitHub/deployment/t4/template/network.py (network_version=2.0)
        // - Option 1: Use existing VPC (if vpcId specified in config)
        // - Option 2: Create new VPC with private subnets and NAT Gateway (production HA setup)
        const vpc = config.deployment.vpc?.vpcId
            ? ec2.Vpc.fromLookup(this, "ExistingVPC", {
                vpcId: config.deployment.vpc.vpcId,
            })
            : new ec2.Vpc(this, "BenchlingWebhookVPC", {
                maxAzs: 2,
                natGateways: 2, // Mirror production: 1 NAT Gateway per AZ for high availability
                subnetConfiguration: [
                    {
                        name: "Public",
                        subnetType: ec2.SubnetType.PUBLIC,
                        cidrMask: 24,
                    },
                    {
                        name: "Private",
                        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // Private + NAT Gateway
                        cidrMask: 24,
                    },
                ],
            });

        // Validate VPC has private subnets (required for VPC Link and ECS with assignPublicIp: false)
        if (vpc.privateSubnets.length === 0) {
            const vpcIdentifier = config.deployment.vpc?.vpcId || "created";
            throw new Error(
                `VPC (${vpcIdentifier}) does not have private subnets. ` +
                    "The v0.9.0 architecture requires private subnets with NAT Gateway for:\n" +
                    "  - VPC Link to connect API Gateway to ECS tasks\n" +
                    "  - ECS Fargate tasks with assignPublicIp: false\n\n" +
                    "If using an existing VPC, ensure it has:\n" +
                    "  - Private subnets in at least 2 availability zones\n" +
                    "  - NAT Gateway(s) for outbound internet access\n" +
                    "  - Proper route tables configured\n\n" +
                    "Or omit vpc.vpcId from config to auto-create a VPC with the correct configuration.",
            );
        }

        console.log(
            `Using VPC: ${config.deployment.vpc?.vpcId || "auto-created"} (${vpc.privateSubnets.length} private subnets)`,
        );

        // HARDCODED: Always use the quiltdata AWS account for ECR images
        const account = "712023778557";
        const region = "us-east-1";
        const repoName = config.deployment.ecrRepository || "quiltdata/benchling";
        const ecrArn = `arn:aws:ecr:${region}:${account}:repository/${repoName}`;
        const ecrRepo = ecr.Repository.fromRepositoryArn(this, "ExistingEcrRepository", ecrArn);
        const ecrImageUri = `${account}.dkr.ecr.${region}.amazonaws.com/${repoName}:${imageTagValue}`;

        // Create the Fargate service
        // Use imageTag for stackVersion if it looks like a timestamped dev version
        // (e.g., "0.7.0-20251104T000139Z"), otherwise use package.json version
        const isDevVersion = imageTagValue.match(/^\d+\.\d+\.\d+-\d{8}T\d{6}Z$/);
        const stackVersion = isDevVersion ? imageTagValue : packageJson.version;

        // Build Fargate Service props using new config structure
        this.fargateService = new FargateService(this, "FargateService", {
            vpc,
            config: config,
            ecrRepository: ecrRepo,
            imageTag: imageTagValue,
            stackVersion: stackVersion,
            // Runtime-configurable parameters
            // New explicit service parameters (v1.0.0+)
            packagerQueueUrl: packagerQueueUrlValue,
            athenaUserDatabase: athenaUserDatabaseValue,
            quiltWebHost: quiltWebHostValue,
            icebergDatabase: icebergDatabaseValue,
            // NEW: Optional Athena resources (from Quilt stack discovery)
            icebergWorkgroup: icebergWorkgroupValue,
            athenaUserWorkgroup: athenaUserWorkgroupValue,
            athenaResultsBucket: athenaResultsBucketValue,
            // IAM role ARN for cross-account S3 access (write role used for all operations)
            writeRoleArn: config.quilt.writeRoleArn,
            // Legacy parameters
            benchlingSecret: benchlingSecretValue,
            packageBucket: packageBucketValue,
            quiltDatabase: quiltDatabaseValue,
            logLevel: logLevelValue,
        });

        // Create HTTP API v2 that routes through VPC Link to the service
        this.api = new HttpApiGateway(this, "HttpApiGateway", {
            vpc: vpc,
            cloudMapService: this.fargateService.cloudMapService,
            serviceSecurityGroup: this.fargateService.service.connections.securityGroups[0],
            config: config,
        });

        // Store webhook endpoint for easy access (HTTP API v2 default stage)
        // HTTP API v2 URL is optional, but should always be defined after API creation
        this.webhookEndpoint = this.api.api.url || "";
        if (!this.webhookEndpoint) {
            throw new Error("HTTP API URL was not generated. This should not happen.");
        }

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

        if (this.api.authorizer) {
            new cdk.CfnOutput(this, "AuthorizerFunctionArn", {
                value: this.api.authorizer.functionArn,
                description: "Lambda authorizer function ARN for webhook authentication",
            });
        }

        if (this.api.authorizerLogGroup) {
            new cdk.CfnOutput(this, "AuthorizerLogGroup", {
                value: this.api.authorizerLogGroup.logGroupName,
                description: "CloudWatch log group for Lambda authorizer logs",
            });
        }

        // Export configuration metadata
        new cdk.CfnOutput(this, "ConfigVersion", {
            value: config._metadata.version,
            description: "Configuration schema version",
        });

        new cdk.CfnOutput(this, "ConfigSource", {
            value: config._metadata.source,
            description: "Configuration source (wizard, manual, cli)",
        });
    }


}
