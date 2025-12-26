import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { StackConfig } from "./types/stack-config";

/**
 * Properties for FargateService construct
 *
 * Uses StackConfig for minimal structured configuration access.
 * Runtime-configurable parameters can be overridden via CloudFormation parameters.
 *
 * **Breaking Change (v0.9.0)**: Removed stackArn in favor of explicit service environment variables.
 * The explicit service parameters (packagerQueueUrl, athenaUserDatabase, quiltWebHost)
 * are resolved at deployment time and passed directly to the container, eliminating runtime CloudFormation calls.
 */
export interface FargateServiceProps {
    readonly vpc: ec2.IVpc;
    readonly config: StackConfig;
    readonly ecrRepository: ecr.IRepository;
    readonly targetGroup: elbv2.INetworkTargetGroup;  // NEW: NLB target group for v0.9.0
    readonly imageTag?: string;
    readonly stackVersion?: string;

    // Explicit service parameters
    // These replace runtime resolution from stackArn
    readonly packagerQueueUrl: string;
    readonly athenaUserDatabase: string;
    readonly quiltWebHost: string;

    // NEW: Optional Athena workgroup (from Quilt stack discovery)
    // Query results are managed automatically by the workgroup's AWS-managed configuration
    readonly athenaUserWorkgroup?: string;

    // NEW: Optional IAM managed policy ARNs (from Quilt stack discovery)
    readonly bucketWritePolicyArn?: string;
    readonly athenaUserPolicyArn?: string;

    // Runtime-configurable parameters (from CloudFormation)
    readonly benchlingSecret: string;
    readonly packageBucket: string;
    readonly quiltDatabase: string;
    readonly logLevel?: string;
}

export class FargateService extends Construct {
    public readonly service: ecs.FargateService;
    public readonly cluster: ecs.Cluster;
    public readonly logGroup: logs.ILogGroup;
    public readonly securityGroup: ec2.ISecurityGroup;

    /**
     * Extract secret name from Secrets Manager ARN
     *
     * AWS Secrets Manager automatically appends a 6-character random suffix to secret names
     * in ARNs (e.g., "my-secret-Ab12Cd"). This function extracts the base secret name by
     * removing the suffix.
     *
     * @param arn - Secrets Manager ARN
     * @returns Secret name without the random suffix
     */
    private extractSecretName(arn: string): string {
        if (!arn) {
            return "";
        }
        // ARN format: arn:aws:secretsmanager:region:account:secret:name-XXXXXX
        // where XXXXXX is a 6-character random suffix added by AWS
        const match = arn.match(/secret:([^:]+)/);
        if (!match) {
            return arn;
        }

        const fullName = match[1];

        // Remove the AWS-generated 6-character suffix (format: -XXXXXX)
        // The suffix is always a hyphen followed by 6 alphanumeric characters
        const withoutSuffix = fullName.replace(/-[A-Za-z0-9]{6}$/, "");

        return withoutSuffix;
    }

    constructor(scope: Construct, id: string, props: FargateServiceProps) {
        super(scope, id);

        const { config } = props;

        // Create ECS Cluster
        // Note: clusterName removed to allow multiple stacks per account
        this.cluster = new ecs.Cluster(this, "BenchlingWebhookCluster", {
            vpc: props.vpc,
            enableFargateCapacityProviders: true,
        });

        // Enable Container Insights for monitoring
        const cfnCluster = this.cluster.node.defaultChild as ecs.CfnCluster;
        cfnCluster.clusterSettings = [
            {
                name: "containerInsights",
                value: "enabled",
            },
        ];

        // Create CloudWatch Log Group for container logs
        // Use stack name for consistency between integrated and standalone modes
        const stackName = cdk.Stack.of(this).stackName;
        this.logGroup = new logs.LogGroup(this, "ContainerLogGroup", {
            logGroupName: stackName,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Create IAM Task Execution Role (for ECS to pull images and write logs)
        const taskExecutionRole = new iam.Role(this, "TaskExecutionRole", {
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    "service-role/AmazonECSTaskExecutionRolePolicy",
                ),
            ],
        });

        // Create IAM Task Role (for the container to access AWS services)
        const taskRole = new iam.Role(this, "TaskRole", {
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        });

        // Grant Secrets Manager read access (to fetch Benchling credentials)
        // Use both config.benchling.secretArn and runtime parameter
        const secretArn = config.benchling.secretArn || props.benchlingSecret;
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:DescribeSecret",
                ],
                resources: [
                    secretArn,
                    `${secretArn}*`, // Include version suffixes
                ],
            }),
        );

        // Grant S3 access for the specific package bucket
        // Full Quilt-required permissions for versioned S3 objects
        const packageBucketArn = `arn:aws:s3:::${props.packageBucket}`;
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "s3:GetObject",
                    "s3:GetObjectAttributes",
                    "s3:GetObjectTagging",
                    "s3:GetObjectVersion",
                    "s3:GetObjectVersionAttributes",
                    "s3:GetObjectVersionTagging",
                    "s3:ListBucket",
                    "s3:ListBucketVersions",
                    "s3:DeleteObject",
                    "s3:DeleteObjectVersion",
                    "s3:PutObject",
                    "s3:PutObjectTagging",
                    "s3:GetBucketNotification",
                    "s3:PutBucketNotification",
                ],
                resources: [
                    packageBucketArn,
                    `${packageBucketArn}/*`,
                ],
            }),
        );

        // Attach Quilt managed policies directly to task role
        // This eliminates the need for role assumption and trust policy coordination

        // Attach BucketWritePolicy for S3 access to all Quilt buckets
        if (props.bucketWritePolicyArn) {
            taskRole.addManagedPolicy(
                iam.ManagedPolicy.fromManagedPolicyArn(
                    this,
                    "BucketWritePolicy",
                    props.bucketWritePolicyArn,
                ),
            );
        }

        // Attach UserAthenaNonManagedRolePolicy for Athena query access
        if (props.athenaUserPolicyArn) {
            taskRole.addManagedPolicy(
                iam.ManagedPolicy.fromManagedPolicyArn(
                    this,
                    "AthenaUserPolicy",
                    props.athenaUserPolicyArn,
                ),
            );
        }

        // Grant wildcard SQS access (queue ARN will be resolved at runtime)
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "sqs:SendMessage",
                    "sqs:GetQueueUrl",
                    "sqs:GetQueueAttributes",
                ],
                resources: [
                    `arn:aws:sqs:${config.deployment.region}:*:*`,
                ],
            }),
        );

        // Grant Glue access for the specific Quilt database
        const region = config.deployment.region;
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "glue:GetDatabase",
                    "glue:GetTable",
                    "glue:GetPartitions",
                ],
                resources: [
                    `arn:aws:glue:${region}:*:catalog`,
                    `arn:aws:glue:${region}:*:database/${props.quiltDatabase}`,
                    `arn:aws:glue:${region}:*:table/${props.quiltDatabase}/*`,
                ],
            }),
        );

        // Grant Athena access to task role for package querying
        // Support both discovered workgroup (from Quilt stack) and fallback to primary
        const athenaWorkgroups = props.athenaUserWorkgroup
            ? [
                // Discovered workgroup from Quilt stack
                `arn:aws:athena:${config.deployment.region}:*:workgroup/${props.athenaUserWorkgroup}`,
                // Fallback to primary workgroup
                `arn:aws:athena:${config.deployment.region}:*:workgroup/primary`,
            ]
            : [
                // Only primary workgroup if no discovered workgroup
                `arn:aws:athena:${config.deployment.region}:*:workgroup/primary`,
            ];

        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "athena:StartQueryExecution",
                    "athena:GetQueryExecution",
                    "athena:GetQueryResults",
                    "athena:StopQueryExecution",
                    "athena:GetWorkGroup",
                ],
                resources: athenaWorkgroups,
            }),
        );

        // Note: Athena query results are handled by AWS-managed workgroup configuration
        // The athena:GetQueryResults API returns data directly without requiring S3 access
        // S3 permissions for results bucket are NOT needed for get_query_results()

        // Create Fargate Task Definition
        const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDefinition", {
            memoryLimitMiB: 2048,
            cpu: 1024,
            executionRole: taskExecutionRole,
            taskRole: taskRole,
            family: "benchling-webhook-task",
        });

        // Build environment variables using new config structure
        // v1.0.0+: Explicit service parameters eliminate runtime CloudFormation calls
        // CRITICAL: These must match bin/xdg-launch.ts:buildEnvVars() exactly (lines 182-229)
        // Package configuration comes from AWS Secrets Manager, NOT environment variables
        const environmentVars: { [key: string]: string } = {
            // AWS Configuration
            AWS_REGION: region,
            AWS_DEFAULT_REGION: region,
            PORT: "8080",

            // Quilt Services (v0.8.0+ service-specific - NO MORE STACK ARN!)
            QUILT_WEB_HOST: props.quiltWebHost,
            ATHENA_USER_DATABASE: props.athenaUserDatabase,
            ATHENA_USER_WORKGROUP: props.athenaUserWorkgroup || "primary",
            // Query results managed automatically by workgroup's AWS-managed configuration
            PACKAGER_SQS_URL: props.packagerQueueUrl,

            // NOTE: IAM policies are now attached directly to task role
            // No need to pass role ARN to container for assumption

            // Benchling Configuration (credentials from Secrets Manager, NOT environment)
            BenchlingSecret: this.extractSecretName(props.benchlingSecret),

            // Security Configuration (verification enabled by default)
            ENABLE_WEBHOOK_VERIFICATION: "true",  // StackConfig doesn't include security settings - default to enabled

            // Application Configuration
            APP_ENV: "production",
            LOG_LEVEL: props.logLevel || "INFO",  // StackConfig doesn't include logging level - use parameter default
        };

        // Add container with configured environment
        const container = taskDefinition.addContainer("BenchlingWebhookContainer", {
            image: ecs.ContainerImage.fromEcrRepository(
                props.ecrRepository,
                props.imageTag || "latest",
            ),
            logging: ecs.LogDriver.awsLogs({
                streamPrefix: "benchling-webhook",
                logGroup: this.logGroup,
            }),
            environment: environmentVars,
            healthCheck: {
                command: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(10),
                retries: 3,
                startPeriod: cdk.Duration.seconds(60),
            },
        });

        // Map container port
        container.addPortMappings({
            containerPort: 8080,
            protocol: ecs.Protocol.TCP,
        });

        // Create Security Group for Fargate tasks
        this.securityGroup = new ec2.SecurityGroup(this, "FargateSecurityGroup", {
            vpc: props.vpc,
            description: "Security group for Benchling webhook Fargate tasks",
            allowAllOutbound: true,
        });

        // Allow traffic from NLB to reach the service on 8080
        this.securityGroup.addIngressRule(
            ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
            ec2.Port.tcp(8080),
            "Allow VPC traffic to service",
        );

        // Create Fargate Service with NLB target group integration
        // Replaced Cloud Map with NLB for reliable health checks
        // Note: serviceName removed to allow multiple stacks per account
        this.service = new ecs.FargateService(this, "Service", {
            cluster: this.cluster,
            taskDefinition: taskDefinition,
            desiredCount: 2,
            assignPublicIp: false,
            securityGroups: [this.securityGroup],
            healthCheckGracePeriod: cdk.Duration.seconds(60),
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            circuitBreaker: {
                rollback: true,
            },
        });

        // Register ECS service with NLB target group
        // The NLB will perform HTTP health checks on /health endpoint
        this.service.attachToNetworkTargetGroup(props.targetGroup);

        // Configure auto-scaling
        const scaling = this.service.autoScaleTaskCount({
            minCapacity: 2,
            maxCapacity: 10,
        });

        // Scale based on CPU utilization
        scaling.scaleOnCpuUtilization("CpuScaling", {
            targetUtilizationPercent: 70,
            scaleInCooldown: cdk.Duration.seconds(300),
            scaleOutCooldown: cdk.Duration.seconds(60),
        });

        // Scale based on memory utilization
        scaling.scaleOnMemoryUtilization("MemoryScaling", {
            targetUtilizationPercent: 80,
            scaleInCooldown: cdk.Duration.seconds(300),
            scaleOutCooldown: cdk.Duration.seconds(60),
        });

        // Outputs - use stack name to make exports profile-aware
        new cdk.CfnOutput(this, "ServiceName", {
            value: this.service.serviceName,
            description: "ECS Service Name",
            exportName: `${stackName}-ServiceName`,
        });

        new cdk.CfnOutput(this, "ClusterName", {
            value: this.cluster.clusterName,
            description: "ECS Cluster Name",
            exportName: `${stackName}-ClusterName`,
        });
    }
}
