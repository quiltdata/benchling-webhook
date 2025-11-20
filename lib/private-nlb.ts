import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

/**
 * Properties for PrivateNLB construct
 *
 * Creates an internal (non-internet-facing) Network Load Balancer for
 * connecting API Gateway to Fargate via VPC Link.
 */
export interface PrivateNLBProps {
    /**
     * VPC to deploy the NLB in
     */
    readonly vpc: ec2.IVpc;

    /**
     * Port for the NLB listener (default: 80)
     */
    readonly port?: number;

    /**
     * Target port for the Fargate service (default: 5000)
     */
    readonly targetPort?: number;

    /**
     * Health check path (default: "/health")
     */
    readonly healthCheckPath?: string;

    /**
     * Optional existing NLB ARN for sharing across stacks
     * If provided, imports the existing NLB instead of creating a new one
     */
    readonly existingNlbArn?: string;

    /**
     * Optional array of allowed IP CIDR blocks for security group
     * If provided, restricts ingress to these IPs only (defense in depth)
     */
    readonly allowedIpRanges?: string[];
}

/**
 * Private Network Load Balancer
 *
 * Creates an internal NLB for API Gateway VPC Link integration.
 * The NLB is not internet-facing and can only be accessed via VPC Link.
 *
 * Key features:
 * - Internal (not internet-facing)
 * - CloudWatch logging enabled
 * - Configurable health checks
 * - Optional IP allowlist via security group
 * - Supports sharing across multiple stacks
 *
 * @example
 * ```typescript
 * const nlb = new PrivateNLB(this, "NLB", {
 *   vpc: vpc,
 *   allowedIpRanges: ["52.203.123.45/32", "54.210.98.76/32"]
 * });
 * ```
 */
export class PrivateNLB extends Construct {
    public readonly loadBalancer: elbv2.INetworkLoadBalancer;
    public readonly targetGroup: elbv2.NetworkTargetGroup;
    public readonly listener: elbv2.NetworkListener;
    public readonly securityGroup: ec2.SecurityGroup;

    constructor(scope: Construct, id: string, props: PrivateNLBProps) {
        super(scope, id);

        const port = props.port || 80;
        const targetPort = props.targetPort || 5000;
        const healthCheckPath = props.healthCheckPath || "/health";

        // Import existing NLB or create new one
        if (props.existingNlbArn) {
            this.loadBalancer = elbv2.NetworkLoadBalancer.fromNetworkLoadBalancerAttributes(
                this,
                "ImportedNLB",
                {
                    loadBalancerArn: props.existingNlbArn,
                    vpc: props.vpc,
                },
            );
        } else {
            // Create internal (private) Network Load Balancer
            const nlb = new elbv2.NetworkLoadBalancer(this, "NLB", {
                vpc: props.vpc,
                internetFacing: false, // CRITICAL: Must be internal (not public)
                loadBalancerName: "benchling-webhook-nlb",
                crossZoneEnabled: true,
            });

            // Enable NLB access logs
            const nlbLogsBucket = new s3.Bucket(this, "NlbLogsBucket", {
                bucketName: `benchling-webhook-nlb-logs-${cdk.Aws.ACCOUNT_ID}`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                autoDeleteObjects: true,
                lifecycleRules: [
                    {
                        expiration: cdk.Duration.days(7),
                    },
                ],
            });

            nlb.logAccessLogs(nlbLogsBucket, "nlb-access-logs");
            this.loadBalancer = nlb;
        }

        // Create security group for NLB targets
        // This provides defense-in-depth IP filtering in addition to API Gateway Resource Policy
        this.securityGroup = new ec2.SecurityGroup(this, "NLBTargetSecurityGroup", {
            vpc: props.vpc,
            description: "Security group for NLB targets (Fargate tasks)",
            allowAllOutbound: true,
        });

        // Add ingress rules based on IP allowlist
        if (props.allowedIpRanges && props.allowedIpRanges.length > 0) {
            // Restrict to allowed IPs only (defense in depth)
            props.allowedIpRanges.forEach((cidr, index) => {
                this.securityGroup.addIngressRule(
                    ec2.Peer.ipv4(cidr),
                    ec2.Port.tcp(targetPort),
                    `Allow traffic from Benchling IP ${index + 1}`,
                );
            });
        } else {
            // No IP filtering - allow all VPC traffic
            // Primary filtering is done at API Gateway Resource Policy
            this.securityGroup.addIngressRule(
                ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
                ec2.Port.tcp(targetPort),
                "Allow traffic from VPC",
            );
        }

        // Create target group for Fargate service
        this.targetGroup = new elbv2.NetworkTargetGroup(this, "TargetGroup", {
            vpc: props.vpc,
            port: targetPort,
            protocol: elbv2.Protocol.TCP,
            targetType: elbv2.TargetType.IP,
            healthCheck: {
                enabled: true,
                protocol: elbv2.Protocol.HTTP,
                path: healthCheckPath,
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(10),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 3,
            },
            deregistrationDelay: cdk.Duration.seconds(30),
        });

        // Create listener
        this.listener = this.loadBalancer.addListener("Listener", {
            port: port,
            protocol: elbv2.Protocol.TCP,
            defaultAction: elbv2.NetworkListenerAction.forward([this.targetGroup]),
        });

        // Output NLB information
        new cdk.CfnOutput(this, "NLBArn", {
            value: this.loadBalancer.loadBalancerArn,
            description: "Private NLB ARN (for VPC Link)",
            exportName: "BenchlingWebhookNLBArn",
        });

        new cdk.CfnOutput(this, "NLBDnsName", {
            value: this.loadBalancer.loadBalancerDnsName,
            description: "Private NLB DNS name (for debugging only, not publicly accessible)",
            exportName: "BenchlingWebhookNLBDns",
        });

        new cdk.CfnOutput(this, "TargetGroupArn", {
            value: this.targetGroup.targetGroupArn,
            description: "NLB target group ARN",
            exportName: "BenchlingWebhookTargetGroupArn",
        });
    }
}
