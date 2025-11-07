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
 * Properties for FargateService construct (v0.7.0+)
 *
 * Uses ProfileConfig for structured configuration access.
 * Runtime-configurable parameters (quiltStackArn, benchlingSecret, logLevel, packageBucket)
 * can be overridden via CloudFormation parameters.
 *
 * **Breaking Change (v1.0.0)**: stackArn is deprecated in favor of explicit service environment variables.
 * Will be removed in Episode 5-6.
 */
export interface FargateServiceProps {
    readonly vpc: ec2.IVpc;
    readonly bucket: s3.IBucket;
    readonly config: ProfileConfig;
    readonly ecrRepository: ecr.IRepository;
    readonly imageTag?: string;
    readonly stackVersion?: string;

    // Runtime-configurable parameters (from CloudFormation)
    readonly stackArn?: string; // Deprecated, will be removed in Episodes 5-6
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
        this.logGroup = new logs.LogGroup(this, "ContainerLogGroup", {
            logGroupName: "/ecs/benchling-webhook",
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

        // Grant CloudFormation read access (to query stack outputs)
        // DEPRECATED: Will be removed in v1.0.0 (Episodes 5-6)
        if (props.stackArn) {
            taskRole.addToPolicy(
                new iam.PolicyStatement({
                    actions: [
                        "cloudformation:DescribeStacks",
                        "cloudformation:DescribeStackResources",
                    ],
                    resources: [props.stackArn],
                }),
            );
        }

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
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "athena:StartQueryExecution",
                    "athena:GetQueryExecution",
                    "athena:GetQueryResults",
                    "athena:StopQueryExecution",
                    "athena:GetWorkGroup",
                ],
                resources: [
                    `arn:aws:athena:${config.deployment.region}:${config.deployment.account || cdk.Aws.ACCOUNT_ID}:workgroup/primary`,
                ],
            }),
        );

        // Grant S3 access for Athena query results
        const athenaResultsBucketArn = `arn:aws:s3:::aws-athena-query-results-${account}-${region}`;
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "s3:GetBucketLocation",
                    "s3:GetObject",
                    "s3:ListBucket",
                    "s3:PutObject",
                ],
                resources: [
                    athenaResultsBucketArn,
                    `${athenaResultsBucketArn}/*`,
                ],
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
        // Container will query CloudFormation and Secrets Manager for runtime config
        const environmentVars: { [key: string]: string } = {
            AWS_REGION: region,
            AWS_DEFAULT_REGION: region,
            FLASK_ENV: "production",
            LOG_LEVEL: props.logLevel || config.logging?.level || "INFO",
            ENABLE_WEBHOOK_VERIFICATION: config.security?.enableVerification !== false ? "true" : "false",
            BENCHLING_WEBHOOK_VERSION: props.stackVersion || props.imageTag || "latest",
            // Runtime-configurable parameters (from CloudFormation)
            BenchlingSecret: props.benchlingSecret,
            // Static config values (for reference)
            BENCHLING_TENANT: config.benchling.tenant,
            BENCHLING_PKG_BUCKET: config.packages.bucket,
            BENCHLING_PKG_PREFIX: config.packages.prefix,
            BENCHLING_PKG_KEY: config.packages.metadataKey,
        };

        // DEPRECATED: QuiltStackARN will be removed in v1.0.0 (Episodes 5-6)
        if (props.stackArn) {
            environmentVars.QuiltStackARN = props.stackArn;
        }

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
