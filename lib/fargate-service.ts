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
 * Environment-specific configuration for multi-environment deployments
 *
 * Each environment (dev, prod, staging, etc.) gets its own:
 * - ECS service with dedicated task definition
 * - ALB target group for traffic routing
 * - CloudWatch log group for isolation
 * - Secrets Manager secret reference
 * - Auto-scaling configuration
 */
export interface FargateEnvironmentConfig {
    /**
     * Environment name (used for resource naming and STAGE env var)
     * @example "dev", "prod", "staging"
     */
    readonly name: string;

    /**
     * Docker image tag for this environment
     * @example "latest" for dev, "0.7.0" for prod
     */
    readonly imageTag: string;

    /**
     * AWS Secrets Manager secret name or ARN for Benchling credentials
     * @example "quiltdata/benchling-webhook/dev/tenant"
     */
    readonly secretName: string;

    /**
     * Minimum number of tasks (auto-scaling)
     * @default 1 for dev, 2 for prod
     */
    readonly minCapacity?: number;

    /**
     * Maximum number of tasks (auto-scaling)
     * @default 3 for dev, 10 for prod
     */
    readonly maxCapacity?: number;

    /**
     * Environment-specific profile config (optional override)
     * If not provided, uses the main config from FargateServiceProps
     */
    readonly config?: ProfileConfig;
}

/**
 * Properties for FargateService construct (v0.7.0+)
 *
 * Supports both single-environment (backward compatible) and multi-environment deployments.
 * When `environments` array is provided, creates separate ECS services per environment.
 * When `environments` is omitted, creates a single service (legacy behavior).
 */
export interface FargateServiceProps {
    readonly vpc: ec2.IVpc;
    readonly bucket: s3.IBucket;
    readonly config: ProfileConfig;
    readonly ecrRepository: ecr.IRepository;

    // Runtime-configurable parameters (from CloudFormation)
    readonly quiltStackArn: string;
    readonly benchlingSecret: string;
    readonly logLevel?: string;

    // Legacy single-environment mode (backward compatible)
    readonly imageTag?: string;
    readonly stackVersion?: string;

    // Multi-environment mode (v0.7.0+)
    readonly environments?: FargateEnvironmentConfig[];
}

export class FargateService extends Construct {
    // Legacy single-service properties (backward compatible)
    // Note: Not readonly to allow assignment in multi-environment mode
    public service!: ecs.FargateService;
    public logGroup!: logs.ILogGroup;

    // Shared infrastructure
    public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
    public readonly cluster: ecs.Cluster;

    // Multi-environment properties (v0.7.0+)
    public readonly services: Map<string, ecs.FargateService>;
    public readonly targetGroups: Map<string, elbv2.ApplicationTargetGroup>;
    public readonly logGroups: Map<string, logs.ILogGroup>;

    constructor(scope: Construct, id: string, props: FargateServiceProps) {
        super(scope, id);

        const { config } = props;

        // Initialize multi-environment maps
        this.services = new Map();
        this.targetGroups = new Map();
        this.logGroups = new Map();

        // Create shared ECS Cluster
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

        // Create S3 bucket for ALB access logs
        const account = config.deployment.account || cdk.Aws.ACCOUNT_ID;
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

        // Create shared Application Load Balancer
        this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, "ALB", {
            vpc: props.vpc,
            internetFacing: true,
            loadBalancerName: "benchling-webhook-alb",
        });

        // Enable ALB access logs
        this.loadBalancer.logAccessLogs(albLogsBucket, "alb-access-logs");

        // Determine deployment mode: multi-environment or legacy single-service
        const isMultiEnvironment = props.environments && props.environments.length > 0;

        if (isMultiEnvironment) {
            // Multi-environment mode: Create service per environment
            this.createMultiEnvironmentServices(props);

            // Set legacy service property to first environment for backward compatibility
            const firstEnv = props.environments![0];
            this.service = this.services.get(firstEnv.name)!;
            this.logGroup = this.logGroups.get(firstEnv.name)!;
        } else {
            // Legacy single-service mode: Maintain backward compatibility
            this.createLegacySingleService(props);

            // Populate multi-environment maps for consistency
            this.services.set("default", this.service);
            this.logGroups.set("default", this.logGroup);
        }

        // CloudFormation Outputs
        this.createOutputs(props);
    }

    /**
     * Create multiple ECS services, one per environment
     * Each environment gets isolated resources: service, target group, log group, IAM roles
     */
    private createMultiEnvironmentServices(props: FargateServiceProps): void {
        const environments = props.environments!;

        // Create Security Group for Fargate tasks (shared across environments)
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

        // Create ALB listener (shared, routes to different target groups)
        const listener = this.loadBalancer.addListener("HttpListener", {
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            // Default action will be set to first environment's target group
        });

        // Create resources for each environment
        for (let i = 0; i < environments.length; i++) {
            const env = environments[i];
            const envConfig = env.config || props.config;
            const isDefault = i === 0;

            // Create environment-specific CloudWatch Log Group
            const logGroup = new logs.LogGroup(this, `${env.name}LogGroup`, {
                logGroupName: `/ecs/benchling-webhook-${env.name}`,
                retention: logs.RetentionDays.ONE_WEEK,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            });
            this.logGroups.set(env.name, logGroup);

            // Create environment-specific IAM roles
            const taskExecutionRole = this.createTaskExecutionRole(env.name);
            const taskRole = this.createTaskRole(env.name, envConfig, props.quiltStackArn, env.secretName);

            // Create environment-specific Task Definition
            const taskDefinition = new ecs.FargateTaskDefinition(this, `${env.name}TaskDefinition`, {
                memoryLimitMiB: 2048,
                cpu: 1024,
                executionRole: taskExecutionRole,
                taskRole: taskRole,
                family: `benchling-webhook-${env.name}`,
            });

            // Build environment variables for this environment
            const environmentVars = this.buildEnvironmentVariables(
                envConfig,
                props,
                env.name,
                env.imageTag,
            );

            // Add container to task definition
            const container = taskDefinition.addContainer(`${env.name}Container`, {
                image: ecs.ContainerImage.fromEcrRepository(
                    props.ecrRepository,
                    env.imageTag,
                ),
                logging: ecs.LogDriver.awsLogs({
                    streamPrefix: `benchling-webhook-${env.name}`,
                    logGroup: logGroup,
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

            // Create environment-specific ALB Target Group
            const targetGroup = new elbv2.ApplicationTargetGroup(this, `${env.name}TargetGroup`, {
                vpc: props.vpc,
                port: 5000,
                protocol: elbv2.ApplicationProtocol.HTTP,
                targetType: elbv2.TargetType.IP,
                targetGroupName: `bw-${env.name}`,
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
            this.targetGroups.set(env.name, targetGroup);

            // Set default action for listener to first environment
            if (isDefault) {
                listener.addAction("DefaultAction", {
                    action: elbv2.ListenerAction.forward([targetGroup]),
                });
            }

            // Create environment-specific Fargate Service
            const service = new ecs.FargateService(this, `${env.name}Service`, {
                cluster: this.cluster,
                taskDefinition: taskDefinition,
                desiredCount: env.minCapacity || (env.name === "prod" ? 2 : 1),
                serviceName: `benchling-webhook-${env.name}`,
                assignPublicIp: true,
                securityGroups: [fargateSecurityGroup],
                healthCheckGracePeriod: cdk.Duration.seconds(60),
                minHealthyPercent: 50,
                maxHealthyPercent: 200,
                circuitBreaker: {
                    rollback: true,
                },
            });

            // Attach service to target group
            service.attachToApplicationTargetGroup(targetGroup);

            // Configure auto-scaling
            const minCapacity = env.minCapacity || (env.name === "prod" ? 2 : 1);
            const maxCapacity = env.maxCapacity || (env.name === "prod" ? 10 : 3);

            const scaling = service.autoScaleTaskCount({
                minCapacity: minCapacity,
                maxCapacity: maxCapacity,
            });

            // Scale based on CPU utilization
            scaling.scaleOnCpuUtilization(`${env.name}CpuScaling`, {
                targetUtilizationPercent: 70,
                scaleInCooldown: cdk.Duration.seconds(300),
                scaleOutCooldown: cdk.Duration.seconds(60),
            });

            // Scale based on memory utilization
            scaling.scaleOnMemoryUtilization(`${env.name}MemoryScaling`, {
                targetUtilizationPercent: 80,
                scaleInCooldown: cdk.Duration.seconds(300),
                scaleOutCooldown: cdk.Duration.seconds(60),
            });

            // Store service reference
            this.services.set(env.name, service);
        }
    }

    /**
     * Create single ECS service (legacy mode for backward compatibility)
     * Maintains the original behavior when environments array is not provided
     */
    private createLegacySingleService(props: FargateServiceProps): void {
        const { config } = props;

        // Create CloudWatch Log Group for container logs
        this.logGroup = new logs.LogGroup(this, "ContainerLogGroup", {
            logGroupName: "/ecs/benchling-webhook",
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Create IAM Task Execution Role (for ECS to pull images and write logs)
        const taskExecutionRole = this.createTaskExecutionRole("default");

        // Create IAM Task Role (for the container to access AWS services)
        const taskRole = this.createTaskRole("default", config, props.quiltStackArn, props.benchlingSecret);

        // Create Fargate Task Definition
        const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDefinition", {
            memoryLimitMiB: 2048,
            cpu: 1024,
            executionRole: taskExecutionRole,
            taskRole: taskRole,
            family: "benchling-webhook-task",
        });

        // Build environment variables
        const environmentVars = this.buildEnvironmentVariables(
            config,
            props,
            "prod",
            props.imageTag || "latest",
        );

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
        this.targetGroups.set("default", targetGroup);

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
    }

    /**
     * Create IAM Task Execution Role
     * Allows ECS to pull images from ECR and write logs to CloudWatch
     */
    private createTaskExecutionRole(envName: string): iam.Role {
        return new iam.Role(this, `${envName}TaskExecutionRole`, {
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    "service-role/AmazonECSTaskExecutionRolePolicy",
                ),
            ],
        });
    }

    /**
     * Create IAM Task Role
     * Allows container to access AWS services (S3, SQS, Secrets Manager, CloudFormation, Glue, Athena)
     */
    private createTaskRole(
        envName: string,
        config: ProfileConfig,
        quiltStackArn: string,
        secretName: string,
    ): iam.Role {
        const taskRole = new iam.Role(this, `${envName}TaskRole`, {
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        });

        const region = config.deployment.region;
        const account = config.deployment.account || cdk.Aws.ACCOUNT_ID;

        // Grant CloudFormation read access (to query stack outputs)
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "cloudformation:DescribeStacks",
                    "cloudformation:DescribeStackResources",
                ],
                resources: [quiltStackArn],
            }),
        );

        // Grant Secrets Manager read access (to fetch Benchling credentials)
        const secretArn = secretName.startsWith("arn:")
            ? secretName
            : `arn:aws:secretsmanager:${region}:${account}:secret:${secretName}`;

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

        // Grant wildcard S3 access (bucket name will be resolved at runtime)
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "s3:GetObject",
                    "s3:PutObject",
                    "s3:ListBucket",
                ],
                resources: [
                    "arn:aws:s3:::*",
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
                    `arn:aws:sqs:${region}:${account}:*`,
                ],
            }),
        );

        // Grant wildcard Glue access (database name will be resolved at runtime)
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "glue:GetDatabase",
                    "glue:GetTable",
                    "glue:GetPartitions",
                ],
                resources: [
                    `arn:aws:glue:${region}:${account}:catalog`,
                    `arn:aws:glue:${region}:${account}:database/*`,
                    `arn:aws:glue:${region}:${account}:table/*`,
                ],
            }),
        );

        // Grant Athena access for package querying
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
                    `arn:aws:athena:${region}:${account}:workgroup/primary`,
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

        return taskRole;
    }

    /**
     * Build environment variables for container
     */
    private buildEnvironmentVariables(
        config: ProfileConfig,
        props: FargateServiceProps,
        stageName: string,
        imageTag: string,
    ): { [key: string]: string } {
        const region = config.deployment.region;

        return {
            AWS_REGION: region,
            AWS_DEFAULT_REGION: region,
            FLASK_ENV: "production",
            LOG_LEVEL: props.logLevel || config.logging?.level || "INFO",
            ENABLE_WEBHOOK_VERIFICATION: config.security?.enableVerification !== false ? "true" : "false",
            BENCHLING_WEBHOOK_VERSION: props.stackVersion || imageTag,
            STAGE: stageName, // Environment name (dev, prod, etc.)
            // Runtime-configurable parameters (from CloudFormation)
            QuiltStackARN: props.quiltStackArn,
            BenchlingSecret: props.benchlingSecret,
            // Static config values (for reference)
            BENCHLING_TENANT: config.benchling.tenant,
            BENCHLING_PKG_BUCKET: config.packages.bucket,
            BENCHLING_PKG_PREFIX: config.packages.prefix,
            BENCHLING_PKG_KEY: config.packages.metadataKey,
        };
    }

    /**
     * Create CloudFormation outputs
     */
    private createOutputs(props: FargateServiceProps): void {
        // ALB DNS output (shared across environments)
        new cdk.CfnOutput(this, "LoadBalancerDNS", {
            value: this.loadBalancer.loadBalancerDnsName,
            description: "Load Balancer DNS Name",
            exportName: "BenchlingWebhookALBDNS",
        });

        // Cluster name output (shared across environments)
        new cdk.CfnOutput(this, "ClusterName", {
            value: this.cluster.clusterName,
            description: "ECS Cluster Name",
            exportName: "BenchlingWebhookClusterName",
        });

        // Environment-specific outputs
        if (props.environments && props.environments.length > 0) {
            for (const env of props.environments) {
                const service = this.services.get(env.name)!;
                const targetGroup = this.targetGroups.get(env.name)!;

                new cdk.CfnOutput(this, `${env.name}ServiceName`, {
                    value: service.serviceName,
                    description: `${env.name} ECS Service Name`,
                    exportName: `BenchlingWebhook${env.name}ServiceName`,
                });

                new cdk.CfnOutput(this, `${env.name}TargetGroupArn`, {
                    value: targetGroup.targetGroupArn,
                    description: `${env.name} Target Group ARN`,
                    exportName: `BenchlingWebhook${env.name}TargetGroupArn`,
                });
            }
        } else {
            // Legacy single-service outputs
            new cdk.CfnOutput(this, "ServiceName", {
                value: this.service.serviceName,
                description: "ECS Service Name",
                exportName: "BenchlingWebhookServiceName",
            });
        }
    }
}
