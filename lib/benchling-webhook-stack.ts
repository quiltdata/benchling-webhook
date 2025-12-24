import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";
import { FargateService } from "./fargate-service";
import { RestApiGateway } from "./rest-api-gateway";
import { NetworkLoadBalancer } from "./network-load-balancer";
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
    private readonly nlb: NetworkLoadBalancer;
    private readonly api: RestApiGateway;
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
        if (!skipValidation) {
            const missingFields: string[] = [];

            // Validate Benchling configuration
            if (!config.benchling.secretArn) {
                missingFields.push("config.benchling.secretArn: Secrets Manager secret ARN");
            }

            // Validate required Quilt configuration
            if (!config.quilt.catalog) {
                missingFields.push("config.quilt.catalog: Quilt catalog domain");
            }
            if (!config.quilt.database) {
                missingFields.push("config.quilt.database: Athena/Glue database name");
            }
            if (!config.quilt.queueUrl) {
                missingFields.push("config.quilt.queueUrl: SQS queue URL for package creation");
            }

            if (missingFields.length > 0) {
                throw new Error(
                    "Configuration validation failed. Required fields:\n" +
                    missingFields.map(f => `  - ${f}`).join("\n") + "\n\n" +
                    "Run 'npm run setup' to configure your deployment.",
                );
            }
        }

        console.log(`Deploying with profile configuration (v${packageJson.version})`);
        console.log(`  Benchling Tenant: ${config.benchling.tenant}`);
        console.log(`  Region: ${config.deployment.region}`);

        // Create CloudFormation parameters for runtime-configurable values
        // These parameters can be updated via CloudFormation stack updates

        // Explicit service parameters
        // These replace runtime resolution from QuiltStackARN
        const packagerQueueUrlParam = new cdk.CfnParameter(this, "PackagerQueueUrl", {
            type: "String",
            description: "SQS queue URL for Quilt package creation jobs",
            default: config.quilt.queueUrl || "",  // Use config value as default
        });

        const athenaUserDatabaseParam = new cdk.CfnParameter(this, "AthenaUserDatabase", {
            type: "String",
            description: "Athena/Glue database name for Quilt catalog metadata",
            default: config.quilt.database || "",  // Use config value as default
        });

        const quiltWebHostParam = new cdk.CfnParameter(this, "QuiltWebHost", {
            type: "String",
            description: "Quilt catalog domain (without protocol or trailing slash)",
            default: config.quilt.catalog || "",  // Use config value as default
        });

        const athenaUserWorkgroupParam = new cdk.CfnParameter(this, "AthenaUserWorkgroup", {
            type: "String",
            description: "Athena workgroup for user queries (optional, from Quilt stack discovery)",
            default: config.quilt.athenaUserWorkgroup || "",  // Use config value as default
        });

        const athenaResultsBucketParam = new cdk.CfnParameter(this, "AthenaResultsBucket", {
            type: "String",
            description: "S3 bucket for Athena query results (optional, from Quilt stack discovery)",
            default: config.quilt.athenaResultsBucket || "",  // Use config value as default
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
        const athenaUserWorkgroupValue = athenaUserWorkgroupParam.valueAsString;
        const athenaResultsBucketValue = athenaResultsBucketParam.valueAsString;
        const benchlingSecretValue = benchlingSecretParam.valueAsString;
        const logLevelValue = logLevelParam.valueAsString;
        const imageTagValue = imageTagParam.valueAsString;
        const packageBucketValue = packageBucketParam.valueAsString;
        const quiltDatabaseValue = quiltDatabaseParam.valueAsString;

        // Bucket name will be resolved at runtime from CloudFormation outputs
        // For CDK purposes, we use a placeholder for IAM permissions

        // VPC Configuration
        // Architecture mirrors ~/GitHub/deployment/t4/template/network.py (network_version=2.0)
        // - Option 1: Use existing VPC (if vpcId specified in config)
        // - Option 2: Create new VPC with private subnets and NAT Gateway (production HA setup)

        // Validate VPC configuration if using existing VPC
        if (config.deployment.vpc?.vpcId) {
            // Using explicit VPC config - validate we have subnet IDs
            const privateSubnetIds = config.deployment.vpc.privateSubnetIds || [];
            const azs = config.deployment.vpc.availabilityZones || [];

            if (privateSubnetIds.length < 2) {
                throw new Error(
                    `VPC (${config.deployment.vpc.vpcId}) configuration is invalid.\n` +
                    `Found ${privateSubnetIds.length} private subnet(s), need ≥2.\n\n` +
                    "This usually means:\n" +
                    "  1. VPC discovery failed during setup wizard\n" +
                    "  2. Configuration was manually edited and is incomplete\n" +
                    "  3. You're using an old config format (pre-v1.0)\n\n" +
                    "Solution: Re-run setup wizard to re-discover VPC resources:\n" +
                    "  npm run setup\n\n" +
                    "Or create a new VPC by removing vpc.vpcId from config.",
                );
            }

            if (azs.length < 2) {
                throw new Error(
                    `VPC (${config.deployment.vpc.vpcId}) subnets must span ≥2 availability zones.\n` +
                    `Found ${azs.length} AZ(s).\n\n` +
                    "Solution: Re-run setup wizard or create a new VPC.",
                );
            }

            console.log(`Using existing VPC: ${config.deployment.vpc.vpcId}`);
            console.log(`  Private subnets: ${privateSubnetIds.join(", ")}`);
            console.log(`  Availability zones: ${azs.join(", ")}`);
        } else {
            console.log("Creating new VPC with private subnets and NAT Gateway");
        }

        const vpc = config.deployment.vpc?.vpcId
            ? ec2.Vpc.fromVpcAttributes(this, "ExistingVPC", {
                vpcId: config.deployment.vpc.vpcId,
                availabilityZones: config.deployment.vpc.availabilityZones || [],
                privateSubnetIds: config.deployment.vpc.privateSubnetIds || [],
                publicSubnetIds: config.deployment.vpc.publicSubnetIds || [],
                vpcCidrBlock: config.deployment.vpc.vpcCidrBlock,
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

        // Double-check after VPC construction (should never fail)
        if (vpc.privateSubnets.length === 0) {
            throw new Error(
                "Internal error: VPC has no private subnets. " +
                "This should never happen - please report as a bug.",
            );
        }

        // HARDCODED: Always use the quiltdata AWS account for ECR images
        const account = "712023778557";
        const region = "us-east-1";
        const repoName = config.deployment.ecrRepository || "quiltdata/benchling";
        const ecrArn = `arn:aws:ecr:${region}:${account}:repository/${repoName}`;
        const ecrRepo = ecr.Repository.fromRepositoryArn(this, "ExistingEcrRepository", ecrArn);
        const ecrImageUri = `${account}.dkr.ecr.${region}.amazonaws.com/${repoName}:${imageTagValue}`;

        // Create Network Load Balancer for ECS service
        // NLB provides reliable health checks for ECS tasks
        this.nlb = new NetworkLoadBalancer(this, "NetworkLoadBalancer", {
            vpc,
        });

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
            targetGroup: this.nlb.targetGroup,  // NLB target group for ECS tasks
            imageTag: imageTagValue,
            stackVersion: stackVersion,
            // Runtime-configurable parameters
            // New explicit service parameters
            packagerQueueUrl: packagerQueueUrlValue,
            athenaUserDatabase: athenaUserDatabaseValue,
            quiltWebHost: quiltWebHostValue,
            // NEW: Optional Athena resources (from Quilt stack discovery)
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

        // Get stage from environment or default to prod
        const stage = process.env.STAGE || "prod";

        // Create REST API v1 that routes through VPC Link to the NLB
        // v1.0.0: REST API with resource policy replaces HTTP API v2 + WAF
        this.api = new RestApiGateway(this, "RestApiGateway", {
            vpc: vpc,
            networkLoadBalancer: this.nlb.loadBalancer,
            nlbListener: this.nlb.listener,
            serviceSecurityGroup: this.fargateService.securityGroup,
            config: config,
            stage: stage,
        });

        // Store webhook endpoint for easy access (REST API v1 with stage)
        // REST API URL already includes the stage in the path (e.g., https://xxx.execute-api.region.amazonaws.com/stage/)
        this.webhookEndpoint = this.api.api.url;
        if (!this.api.api.url) {
            throw new Error("REST API URL was not generated. This should not happen.");
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

        new cdk.CfnOutput(this, "ApiType", {
            value: "REST API v1",
            description: "API Gateway type",
        });

        new cdk.CfnOutput(this, "ApiStage", {
            value: stage,
            description: "API Gateway deployment stage",
        });

        // Export NLB information
        new cdk.CfnOutput(this, "NetworkLoadBalancerDns", {
            value: this.nlb.loadBalancer.loadBalancerDnsName,
            description: "Network Load Balancer DNS name (internal)",
        });

        new cdk.CfnOutput(this, "TargetGroupArn", {
            value: this.nlb.targetGroup.targetGroupArn,
            description: "NLB Target Group ARN for ECS tasks",
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
    }


}
