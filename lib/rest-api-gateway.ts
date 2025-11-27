import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { ProfileConfig } from "./types/config";

export interface RestApiGatewayProps {
    readonly vpc: ec2.IVpc;
    readonly cloudMapService: servicediscovery.IService;
    readonly serviceSecurityGroup: ec2.ISecurityGroup;
    readonly config: ProfileConfig;
    readonly ecsService: elbv2.IApplicationLoadBalancerTarget | elbv2.INetworkLoadBalancerTarget;
}

export class RestApiGateway {
    public readonly api: apigateway.RestApi;
    public readonly vpcLink: apigateway.VpcLink;
    public readonly nlb: elbv2.NetworkLoadBalancer;
    public readonly logGroup: logs.ILogGroup;

    constructor(scope: Construct, id: string, props: RestApiGatewayProps) {
        // Access logs for REST API
        this.logGroup = new logs.LogGroup(scope, "ApiGatewayAccessLogs", {
            logGroupName: "/aws/apigateway/benchling-webhook-rest",
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Create Network Load Balancer for VPC Link integration
        // REST API Gateway requires NLB (not ALB) for private integration
        this.nlb = new elbv2.NetworkLoadBalancer(scope, "NetworkLoadBalancer", {
            vpc: props.vpc,
            internetFacing: false,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
        });

        // Create target group for ECS service
        const targetGroup = new elbv2.NetworkTargetGroup(scope, "TargetGroup", {
            vpc: props.vpc,
            port: 8080,
            protocol: elbv2.Protocol.TCP,
            targetType: elbv2.TargetType.IP,
            healthCheck: {
                enabled: true,
                protocol: elbv2.Protocol.HTTP,
                path: "/health",
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(10),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 3,
            },
            deregistrationDelay: cdk.Duration.seconds(30),
        });

        // Add listener to NLB
        const listener = this.nlb.addListener("Listener", {
            port: 80,
            protocol: elbv2.Protocol.TCP,
            defaultTargetGroups: [targetGroup],
        });

        // Register ECS service with target group
        if ("attachToNetworkTargetGroup" in props.ecsService) {
            props.ecsService.attachToNetworkTargetGroup(targetGroup);
        }

        // Create VPC Link with NLB as target
        this.vpcLink = new apigateway.VpcLink(scope, "VpcLink", {
            targets: [this.nlb],
            vpcLinkName: "benchling-webhook-vpclink",
            description: "VPC Link for Benchling Webhook REST API",
        });

        // Parse IP allowlist from config
        const ipAllowList = props.config.security?.webhookAllowList
            ?.split(",")
            .map((ip) => ip.trim())
            .filter((ip) => ip.length > 0) || [];

        // Build resource policy for IP whitelisting
        const resourcePolicy = this.buildResourcePolicy(ipAllowList);

        // Create REST API
        this.api = new apigateway.RestApi(scope, "BenchlingWebhookRestAPI", {
            restApiName: "BenchlingWebhookRestAPI",
            description: "REST API for Benchling webhook integration with IP whitelisting (v1.0.0+)",
            policy: resourcePolicy,
            deployOptions: {
                stageName: "prod",
                accessLogDestination: new apigateway.LogGroupLogDestination(this.logGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
                    caller: true,
                    httpMethod: true,
                    ip: true,
                    protocol: true,
                    requestTime: true,
                    resourcePath: true,
                    responseLength: true,
                    status: true,
                    user: true,
                }),
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: true,
            },
            endpointConfiguration: {
                types: [apigateway.EndpointType.REGIONAL],
            },
        });

        // Create integration with NLB via VPC Link
        // Use the NLB DNS name for the integration URI
        const integration = new apigateway.Integration({
            type: apigateway.IntegrationType.HTTP_PROXY,
            integrationHttpMethod: "ANY",
            uri: `http://${this.nlb.loadBalancerDnsName}:80/{proxy}`,
            options: {
                connectionType: apigateway.ConnectionType.VPC_LINK,
                vpcLink: this.vpcLink,
                requestParameters: {
                    "integration.request.path.proxy": "method.request.path.proxy",
                },
            },
        });

        // Add catch-all proxy resource for all paths
        const proxyResource = this.api.root.addResource("{proxy+}");
        proxyResource.addMethod("ANY", integration, {
            requestParameters: {
                "method.request.path.proxy": true,
            },
        });

        // Add root path handler
        this.api.root.addMethod("ANY", integration);

        // Output IP filtering status
        if (ipAllowList.length > 0) {
            console.log(`IP Whitelisting enabled: ${ipAllowList.length} CIDR blocks`);
            ipAllowList.forEach((ip) => console.log(`  - ${ip}`));
        } else {
            console.log("IP Whitelisting disabled: all IPs allowed");
        }
    }

    /**
     * Build IAM resource policy for IP whitelisting
     *
     * If ipAllowList is empty, allow all IPs.
     * Otherwise, only allow requests from specified IP addresses/CIDR blocks.
     */
    private buildResourcePolicy(ipAllowList: string[]): iam.PolicyDocument | undefined {
        if (ipAllowList.length === 0) {
            // No IP filtering - allow all
            return undefined;
        }

        return new iam.PolicyDocument({
            statements: [
                // Allow requests from whitelisted IPs
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    principals: [new iam.AnyPrincipal()],
                    actions: ["execute-api:Invoke"],
                    resources: ["execute-api:/*"],
                    conditions: {
                        IpAddress: {
                            "aws:SourceIp": ipAllowList,
                        },
                    },
                }),
                // Explicitly deny requests from non-whitelisted IPs
                new iam.PolicyStatement({
                    effect: iam.Effect.DENY,
                    principals: [new iam.AnyPrincipal()],
                    actions: ["execute-api:Invoke"],
                    resources: ["execute-api:/*"],
                    conditions: {
                        NotIpAddress: {
                            "aws:SourceIp": ipAllowList,
                        },
                    },
                }),
            ],
        });
    }
}
