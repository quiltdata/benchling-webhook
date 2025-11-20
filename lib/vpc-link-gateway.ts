import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { ProfileConfig } from "./types/config";

/**
 * Properties for VPCLinkGateway construct
 *
 * Replaces AlbApiGateway with VPC Link integration to private NLB.
 */
export interface VPCLinkGatewayProps {
    /**
     * Private Network Load Balancer to connect to
     */
    readonly networkLoadBalancer: elbv2.INetworkLoadBalancer;

    /**
     * Profile configuration (for IP allowlist and other settings)
     */
    readonly config: ProfileConfig;

    /**
     * Optional VPC Link name (for sharing across stacks)
     */
    readonly vpcLinkName?: string;

    /**
     * Optional existing VPC Link ID (for sharing)
     * If provided, uses existing VPC Link instead of creating new one
     */
    readonly existingVpcLinkId?: string;
}

/**
 * API Gateway with VPC Link Integration
 *
 * Creates API Gateway REST API that connects to a private NLB via VPC Link.
 * Replaces the previous ALB-based architecture with a fully private backend.
 *
 * Key features:
 * - HTTPS endpoint (AWS-managed domain)
 * - VPC Link to private NLB
 * - IP filtering via Resource Policy
 * - CloudWatch logging
 * - VPC Link sharing support
 *
 * Architecture:
 * ```
 * Benchling → API Gateway (HTTPS, IP filtered) → VPC Link → NLB (private) → Fargate
 * ```
 *
 * @example
 * ```typescript
 * const gateway = new VPCLinkGateway(this, "ApiGateway", {
 *   networkLoadBalancer: nlb.loadBalancer,
 *   config: profileConfig
 * });
 * ```
 */
export class VPCLinkGateway extends Construct {
    public readonly api: apigateway.RestApi;
    public readonly vpcLink: apigateway.IVpcLink;
    public readonly logGroup: logs.ILogGroup;

    constructor(scope: Construct, id: string, props: VPCLinkGatewayProps) {
        super(scope, id);

        const { config } = props;

        // Create CloudWatch log group for API Gateway access logs
        this.logGroup = new logs.LogGroup(this, "ApiGatewayAccessLogs", {
            logGroupName: "/aws/apigateway/benchling-webhook",
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Create CloudWatch role for API Gateway
        this.createCloudWatchRole();

        // Create or import VPC Link
        if (props.existingVpcLinkId) {
            // Import existing VPC Link
            this.vpcLink = apigateway.VpcLink.fromVpcLinkId(
                this,
                "ImportedVpcLink",
                props.existingVpcLinkId,
            );
        } else {
            // Create new VPC Link
            // Note: VPC Link creation can take 10+ minutes
            this.vpcLink = new apigateway.VpcLink(this, "VpcLink", {
                vpcLinkName: props.vpcLinkName || "benchling-webhook-vpc-link",
                description: "VPC Link for Benchling webhook to private NLB",
                targets: [props.networkLoadBalancer],
            });
        }

        // Get Benchling IP allowlist from config
        const benchlingIpAllowList = config.security?.benchlingIpAllowList || [];

        // Create resource policy for IP filtering at the edge
        const policyDocument = this.createResourcePolicy(benchlingIpAllowList);

        // Create REST API with VPC Link integration
        this.api = new apigateway.RestApi(this, "BenchlingWebhookAPI", {
            restApiName: "BenchlingWebhookAPI",
            description: "Benchling webhook API with VPC Link to private NLB",
            policy: policyDocument,
            deployOptions: {
                stageName: "prod",
                accessLogDestination: new apigateway.LogGroupLogDestination(this.logGroup),
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: true,
                metricsEnabled: true,
            },
            endpointConfiguration: {
                types: [apigateway.EndpointType.REGIONAL],
            },
        });

        // Add webhook endpoints with VPC Link integration
        this.addWebhookEndpoints(props.networkLoadBalancer);

        // Outputs
        new cdk.CfnOutput(this, "ApiGatewayId", {
            value: this.api.restApiId,
            description: "API Gateway REST API ID",
            exportName: "BenchlingWebhookApiId",
        });

        new cdk.CfnOutput(this, "ApiGatewayExecutionLogGroup", {
            value: `API-Gateway-Execution-Logs_${this.api.restApiId}/prod`,
            description: "API Gateway execution log group for detailed request/response logs",
        });

        new cdk.CfnOutput(this, "VpcLinkId", {
            value: this.vpcLink.vpcLinkId,
            description: "VPC Link ID (can be shared across stacks)",
            exportName: "BenchlingWebhookVpcLinkId",
        });
    }

    /**
     * Create API Gateway Resource Policy for IP filtering
     *
     * Primary security control: only allow requests from Benchling IPs.
     * If no IPs are configured, allows all traffic (no policy restriction).
     *
     * @param allowedIps - Array of CIDR blocks for Benchling IPs
     * @returns PolicyDocument or undefined if no IPs configured
     */
    private createResourcePolicy(
        allowedIps: string[],
    ): iam.PolicyDocument | undefined {
        // Don't create policy if no IPs configured
        if (!allowedIps || allowedIps.length === 0) {
            return undefined;
        }

        // Create ALLOW policy for specified IPs
        return new iam.PolicyDocument({
            statements: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    principals: [new iam.AnyPrincipal()],
                    actions: ["execute-api:Invoke"],
                    resources: ["execute-api:/*"],
                    conditions: {
                        IpAddress: {
                            "aws:SourceIp": allowedIps,
                        },
                    },
                }),
            ],
        });
    }

    /**
     * Create CloudWatch role for API Gateway logging
     */
    private createCloudWatchRole(): iam.Role {
        const cloudWatchRole = new iam.Role(this, "ApiGatewayCloudWatchRole", {
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    "service-role/AmazonAPIGatewayPushToCloudWatchLogs",
                ),
            ],
        });

        new apigateway.CfnAccount(this, "ApiGatewayAccount", {
            cloudWatchRoleArn: cloudWatchRole.roleArn,
        });

        return cloudWatchRole;
    }

    /**
     * Add webhook endpoints with VPC Link integration
     *
     * Creates proxy resource that forwards all requests to the private NLB via VPC Link.
     */
    private addWebhookEndpoints(nlb: elbv2.INetworkLoadBalancer): void {
        // Integration URI points to the NLB DNS name
        const nlbUri = `http://${nlb.loadBalancerDnsName}`;

        // Create VPC Link integration for proxy requests
        const vpcLinkIntegration = new apigateway.Integration({
            type: apigateway.IntegrationType.HTTP_PROXY,
            integrationHttpMethod: "ANY",
            uri: `${nlbUri}/{proxy}`,
            options: {
                connectionType: apigateway.ConnectionType.VPC_LINK,
                vpcLink: this.vpcLink,
                requestParameters: {
                    "integration.request.path.proxy": "method.request.path.proxy",
                },
            },
        });

        // Create proxy resource to forward all requests
        const proxyResource = this.api.root.addResource("{proxy+}");
        proxyResource.addMethod("ANY", vpcLinkIntegration, {
            requestParameters: {
                "method.request.path.proxy": true,
            },
        });

        // Also handle root path
        const rootIntegration = new apigateway.Integration({
            type: apigateway.IntegrationType.HTTP_PROXY,
            integrationHttpMethod: "ANY",
            uri: nlbUri,
            options: {
                connectionType: apigateway.ConnectionType.VPC_LINK,
                vpcLink: this.vpcLink,
            },
        });

        this.api.root.addMethod("ANY", rootIntegration);
    }
}
