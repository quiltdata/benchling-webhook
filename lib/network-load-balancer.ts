import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

export interface NetworkLoadBalancerProps {
    readonly vpc: ec2.IVpc;
}

/**
 * Network Load Balancer for ECS Fargate service
 *
 * Provides reliable health checks and routing for ECS tasks.
 * Replaces Cloud Map service discovery which has issues with custom health checks.
 *
 * Architecture:
 * - Internal NLB (not internet-facing)
 * - TCP listener on port 80
 * - Target Group with IP targets for ECS Fargate tasks
 * - HTTP health checks on /health endpoint
 *
 * @since v0.9.0
 */
export class NetworkLoadBalancer extends Construct {
    public readonly loadBalancer: elbv2.NetworkLoadBalancer;
    public readonly targetGroup: elbv2.NetworkTargetGroup;
    public readonly listener: elbv2.NetworkListener;

    constructor(scope: Construct, id: string, props: NetworkLoadBalancerProps) {
        super(scope, id);

        // Create internal Network Load Balancer
        // Internal = only accessible within VPC (not from internet)
        this.loadBalancer = new elbv2.NetworkLoadBalancer(this, "LoadBalancer", {
            vpc: props.vpc,
            internetFacing: false,
            vpcSubnets: {
                subnets: props.vpc.privateSubnets,
            },
            crossZoneEnabled: true, // Distribute traffic evenly across AZs
        });

        // Create Target Group for ECS tasks
        // IP target type is required for Fargate tasks
        this.targetGroup = new elbv2.NetworkTargetGroup(this, "TargetGroup", {
            vpc: props.vpc,
            port: 8080,
            protocol: elbv2.Protocol.TCP,
            targetType: elbv2.TargetType.IP, // Required for Fargate
            deregistrationDelay: cdk.Duration.seconds(30), // Quick deregistration

            // HTTP health checks for application health
            // NLB supports HTTP health checks even with TCP listener
            healthCheck: {
                enabled: true,
                protocol: elbv2.Protocol.HTTP,
                path: "/health",
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(10),
                healthyThresholdCount: 2,  // 2 successful checks = healthy
                unhealthyThresholdCount: 3, // 3 failed checks = unhealthy
                healthyHttpCodes: "200",
            },
        });

        // Create TCP listener on port 80
        // API Gateway will connect to this via VPC Link
        this.listener = this.loadBalancer.addListener("Listener", {
            port: 80,
            protocol: elbv2.Protocol.TCP,
            defaultTargetGroups: [this.targetGroup],
        });

        // Outputs for debugging - use stack name to make exports profile-aware
        const stackName = cdk.Stack.of(this).stackName;
        new cdk.CfnOutput(this, "LoadBalancerDnsName", {
            value: this.loadBalancer.loadBalancerDnsName,
            description: "Network Load Balancer DNS name",
            exportName: `${stackName}-NLBDnsName`,
        });

        new cdk.CfnOutput(this, "TargetGroupArn", {
            value: this.targetGroup.targetGroupArn,
            description: "Target Group ARN for ECS tasks",
            exportName: `${stackName}-TargetGroupArn`,
        });
    }
}