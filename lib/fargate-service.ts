import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface FargateServiceProps {
    readonly vpc: ec2.IVpc;
    readonly bucket: s3.IBucket;
    readonly queueName: string;
    readonly region: string;
    readonly account: string;
    readonly prefix: string;
    readonly benchlingClientId: string;
    readonly benchlingClientSecret: string;
    readonly benchlingTenant: string;
    readonly quiltCatalog: string;
    readonly quiltDatabase: string;
    readonly webhookAllowList: string;
    readonly ecrRepository: ecr.IRepository;
    readonly imageTag?: string;
    readonly logLevel?: string;
}

export class FargateService extends Construct {
    public readonly service: ecs.FargateService;
    public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
    public readonly cluster: ecs.Cluster;
    public readonly logGroup: logs.ILogGroup;

    constructor(scope: Construct, id: string, props: FargateServiceProps) {
        super(scope, id);

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

        // Note: ECR pull permissions will be automatically granted by fromEcrRepository()

        // Create IAM Task Role (for the container to access AWS services)
        const taskRole = new iam.Role(this, "TaskRole", {
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        });

        // Grant S3 bucket access to task role
        props.bucket.grantReadWrite(taskRole);

        // Grant SQS access to task role
        const queueArn = `arn:aws:sqs:${props.region}:${props.account}:${props.queueName}`;
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "sqs:SendMessage",
                    "sqs:GetQueueUrl",
                    "sqs:GetQueueAttributes",
                ],
                resources: [queueArn],
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
                    `arn:aws:athena:${props.region}:${props.account}:workgroup/primary`,
                ],
            }),
        );

        // Grant Glue Data Catalog access (required for Athena queries)
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "glue:GetDatabase",
                    "glue:GetTable",
                    "glue:GetPartitions",
                ],
                resources: [
                    `arn:aws:glue:${props.region}:${props.account}:catalog`,
                    `arn:aws:glue:${props.region}:${props.account}:database/${props.quiltDatabase}`,
                    `arn:aws:glue:${props.region}:${props.account}:table/${props.quiltDatabase}/*`,
                ],
            }),
        );

        // Grant S3 access for Athena query results
        // Athena needs to write query results to an S3 bucket
        const athenaResultsBucketArn = `arn:aws:s3:::aws-athena-query-results-${props.account}-${props.region}`;
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

        // Create or reference Secrets Manager secret for Benchling credentials
        // In production, this should be created separately and referenced
        const benchlingSecret = new secretsmanager.Secret(this, "BenchlingCredentials", {
            secretName: "benchling-webhook/credentials",
            description: "Benchling API credentials for webhook processor",
            secretObjectValue: {
                client_id: cdk.SecretValue.unsafePlainText(props.benchlingClientId),
                client_secret: cdk.SecretValue.unsafePlainText(props.benchlingClientSecret),
            },
        });

        // Grant read access to secrets
        benchlingSecret.grantRead(taskRole);

        // Create Fargate Task Definition
        const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDefinition", {
            memoryLimitMiB: 2048,
            cpu: 1024,
            executionRole: taskExecutionRole,
            taskRole: taskRole,
            family: "benchling-webhook-task",
        });

        // Add container to task definition
        const container = taskDefinition.addContainer("BenchlingWebhookContainer", {
            image: ecs.ContainerImage.fromEcrRepository(
                props.ecrRepository,
                props.imageTag || "latest",
            ),
            logging: ecs.LogDriver.awsLogs({
                streamPrefix: "benchling-webhook",
                logGroup: this.logGroup,
            }),
            environment: {
                QUILT_USER_BUCKET: props.bucket.bucketName,
                SQS_QUEUE_URL: `https://sqs.${props.region}.amazonaws.com/${props.account}/${props.queueName}`,
                PKG_PREFIX: props.prefix,
                BENCHLING_TENANT: props.benchlingTenant,
                QUILT_CATALOG: props.quiltCatalog,
                QUILT_DATABASE: props.quiltDatabase,
                WEBHOOK_ALLOW_LIST: props.webhookAllowList,
                AWS_REGION: props.region,
                AWS_DEFAULT_REGION: props.region,
                FLASK_ENV: "production",
                LOG_LEVEL: props.logLevel || "INFO",
                ENABLE_WEBHOOK_VERIFICATION: "false",
            },
            secrets: {
                BENCHLING_CLIENT_ID: ecs.Secret.fromSecretsManager(
                    benchlingSecret,
                    "client_id",
                ),
                BENCHLING_CLIENT_SECRET: ecs.Secret.fromSecretsManager(
                    benchlingSecret,
                    "client_secret",
                ),
            },
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
            bucketName: `benchling-webhook-alb-logs-${props.account}`,
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
