import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { ProfileConfig } from "./types/config";

/**
 * Properties for FargateService construct (v1.0.0+)
 *
 * Uses ProfileConfig for structured configuration access.
 * Runtime-configurable parameters can be overridden via CloudFormation parameters.
 *
 * **Breaking Change (v1.0.0)**: Removed stackArn in favor of explicit service environment variables.
 * The explicit service parameters (packagerQueueUrl, athenaUserDatabase, quiltWebHost, icebergDatabase)
 * are resolved at deployment time and passed directly to the container, eliminating runtime CloudFormation calls.
 */
export interface FargateServiceProps {
    readonly vpc: ec2.IVpc;
    readonly bucket: s3.IBucket;
    readonly config: ProfileConfig;
    readonly ecrRepository: ecr.IRepository;
    readonly imageTag?: string;
    readonly stackVersion?: string;

    // Explicit service parameters (v1.0.0+)
    // These replace runtime resolution from stackArn
    readonly packagerQueueUrl: string;
    readonly athenaUserDatabase: string;
    readonly quiltWebHost: string;
    readonly icebergDatabase: string;

    // NEW: Optional Athena resources (from Quilt stack discovery)
    readonly icebergWorkgroup?: string;
    readonly athenaUserWorkgroup?: string;
    readonly athenaResultsBucket?: string;

    // Runtime-configurable parameters (from CloudFormation)
    readonly benchlingSecret: string;
    readonly packageBucket: string;
    readonly quiltDatabase: string;
    readonly logLevel?: string;
}

export class FargateService extends Construct {
    public readonly service: ecs.FargateService;
    public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
    public readonly cluster: ecs.Cluster;
    public readonly logGroup: logs.ILogGroup;

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
        this.cluster = new ecs.Cluster(this, "BenchlingWebhookCluster", {
            vpc: props.vpc,
            clusterName: "benchling-webhook-cluster",
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

        // Grant wildcard SQS access (queue ARN will be resolved at runtime)
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "sqs:SendMessage",
                    "sqs:GetQueueUrl",
                    "sqs:GetQueueAttributes",
                ],
                resources: [
                    `arn:aws:sqs:${config.deployment.region}:${config.deployment.account || cdk.Aws.ACCOUNT_ID}:*`,
                ],
            }),
        );

        // Grant Glue access for the specific Quilt database
        const account = config.deployment.account || cdk.Aws.ACCOUNT_ID;
        const region = config.deployment.region;
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "glue:GetDatabase",
                    "glue:GetTable",
                    "glue:GetPartitions",
                ],
                resources: [
                    `arn:aws:glue:${region}:${account}:catalog`,
                    `arn:aws:glue:${region}:${account}:database/${props.quiltDatabase}`,
                    `arn:aws:glue:${region}:${account}:table/${props.quiltDatabase}/*`,
                ],
            }),
        );

        // Grant Athena access to task role for package querying
        // Support both discovered workgroup (from Quilt stack) and fallback to primary
        const athenaWorkgroups = props.athenaUserWorkgroup
            ? [
                // Discovered workgroup from Quilt stack
                `arn:aws:athena:${config.deployment.region}:${config.deployment.account || cdk.Aws.ACCOUNT_ID}:workgroup/${props.athenaUserWorkgroup}`,
                // Fallback to primary workgroup
                `arn:aws:athena:${config.deployment.region}:${config.deployment.account || cdk.Aws.ACCOUNT_ID}:workgroup/primary`,
            ]
            : [
                // Only primary workgroup if no discovered workgroup
                `arn:aws:athena:${config.deployment.region}:${config.deployment.account || cdk.Aws.ACCOUNT_ID}:workgroup/primary`,
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

        // Grant S3 access for Athena query results
        // Support both discovered results bucket (from Quilt stack) and fallback to default
        const athenaResultsBuckets = props.athenaResultsBucket
            ? [
                // Discovered results bucket from Quilt stack
                `arn:aws:s3:::${props.athenaResultsBucket}`,
                `arn:aws:s3:::${props.athenaResultsBucket}/*`,
                // Fallback to default bucket
                `arn:aws:s3:::aws-athena-query-results-${account}-${region}`,
                `arn:aws:s3:::aws-athena-query-results-${account}-${region}/*`,
            ]
            : [
                // Only default bucket if no discovered bucket
                `arn:aws:s3:::aws-athena-query-results-${account}-${region}`,
                `arn:aws:s3:::aws-athena-query-results-${account}-${region}/*`,
            ];

        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "s3:GetBucketLocation",
                    "s3:GetObject",
                    "s3:ListBucket",
                    "s3:ListBucketVersions",
                    "s3:PutObject",
                    "s3:PutBucketPublicAccessBlock",
                    "s3:CreateBucket",
                ],
                resources: athenaResultsBuckets,
            }),
        );

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

            // Quilt Services (v0.8.0+ service-specific - NO MORE STACK ARN!)
            QUILT_WEB_HOST: props.quiltWebHost,
            ATHENA_USER_DATABASE: props.athenaUserDatabase,
            ATHENA_USER_WORKGROUP: props.athenaUserWorkgroup || "primary",
            // Only set optional variables if they have values (don't pass empty strings)
            ...(props.athenaResultsBucket ? { ATHENA_RESULTS_BUCKET: props.athenaResultsBucket } : {}),
            ...(props.icebergDatabase ? { ICEBERG_DATABASE: props.icebergDatabase } : {}),
            ...(props.icebergWorkgroup ? { ICEBERG_WORKGROUP: props.icebergWorkgroup } : {}),
            PACKAGER_SQS_URL: props.packagerQueueUrl,

            // Benchling Configuration (credentials from Secrets Manager, NOT environment)
            BenchlingSecret: this.extractSecretName(props.benchlingSecret),

            // Security Configuration (verification can be disabled for dev/test)
            ENABLE_WEBHOOK_VERIFICATION: String(config.security?.enableVerification !== false),

            // Application Configuration
            FLASK_ENV: "production",
            LOG_LEVEL: props.logLevel || config.logging?.level || "INFO",
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
                command: ["CMD-SHELL", "curl -f http://localhost:5000/health || exit 1"],
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(10),
                retries: 3,
                startPeriod: cdk.Duration.seconds(60),
            },
        });

        // Map container port
        container.addPortMappings({
            containerPort: 5000,
            protocol: ecs.Protocol.TCP,
        });

        // Create S3 bucket for ALB access logs
        const albLogsBucket = new s3.Bucket(this, "AlbLogsBucket", {
            bucketName: `benchling-webhook-alb-logs-${account}`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            lifecycleRules: [
                {
                    expiration: cdk.Duration.days(7),
                },
            ],
        });

        // Create Application Load Balancer
        this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, "ALB", {
            vpc: props.vpc,
            internetFacing: true,
            loadBalancerName: "benchling-webhook-alb",
        });

        // Enable ALB access logs
        this.loadBalancer.logAccessLogs(albLogsBucket, "alb-access-logs");

        // Create ALB Target Group
        const targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
            vpc: props.vpc,
            port: 5000,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            healthCheck: {
                path: "/health/ready",
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(10),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 3,
                healthyHttpCodes: "200",
            },
            deregistrationDelay: cdk.Duration.seconds(30),
        });

        // Add HTTP listener
        this.loadBalancer.addListener("HttpListener", {
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            defaultAction: elbv2.ListenerAction.forward([targetGroup]),
        });

        // Create Security Group for Fargate tasks
        const fargateSecurityGroup = new ec2.SecurityGroup(this, "FargateSecurityGroup", {
            vpc: props.vpc,
            description: "Security group for Benchling webhook Fargate tasks",
            allowAllOutbound: true,
        });

        // Allow ALB to communicate with Fargate tasks
        fargateSecurityGroup.addIngressRule(
            ec2.Peer.securityGroupId(this.loadBalancer.connections.securityGroups[0].securityGroupId),
            ec2.Port.tcp(5000),
            "Allow traffic from ALB",
        );

        // Create Fargate Service
        this.service = new ecs.FargateService(this, "Service", {
            cluster: this.cluster,
            taskDefinition: taskDefinition,
            desiredCount: 2,
            serviceName: "benchling-webhook-service",
            assignPublicIp: true,
            securityGroups: [fargateSecurityGroup],
            healthCheckGracePeriod: cdk.Duration.seconds(60),
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            circuitBreaker: {
                rollback: true,
            },
        });

        // Attach the service to the target group
        this.service.attachToApplicationTargetGroup(targetGroup);

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

        // Outputs
        new cdk.CfnOutput(this, "LoadBalancerDNS", {
            value: this.loadBalancer.loadBalancerDnsName,
            description: "Load Balancer DNS Name",
            exportName: "BenchlingWebhookALBDNS",
        });

        new cdk.CfnOutput(this, "ServiceName", {
            value: this.service.serviceName,
            description: "ECS Service Name",
            exportName: "BenchlingWebhookServiceName",
        });

        new cdk.CfnOutput(this, "ClusterName", {
            value: this.cluster.clusterName,
            description: "ECS Cluster Name",
            exportName: "BenchlingWebhookClusterName",
        });
    }
}
