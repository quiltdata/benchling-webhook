import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { ProfileConfig } from "./types/config";

export interface RestApiGatewayProps {
    readonly vpc: ec2.IVpc;
    readonly networkLoadBalancer: elbv2.INetworkLoadBalancer;
    readonly nlbListener: elbv2.INetworkListener;
    readonly serviceSecurityGroup: ec2.ISecurityGroup;
    readonly config: ProfileConfig;
    readonly stage: string;
}

export class RestApiGateway {
    public readonly api: apigateway.RestApi;
    public readonly vpcLink: apigateway.VpcLink;
    public readonly logGroup: logs.ILogGroup;
    public readonly stage: string;

    constructor(scope: Construct, id: string, props: RestApiGatewayProps) {
        this.stage = props.stage;

        // Access logs for REST API
        this.logGroup = new logs.LogGroup(scope, "ApiGatewayAccessLogs", {
            logGroupName: "/aws/apigateway/benchling-webhook-rest",
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Parse IP allowlist from config
        const webhookAllowList = props.config.security?.webhookAllowList || "";
        const allowedIps = webhookAllowList
            .split(",")
            .map(ip => ip.trim())
            .filter(ip => ip.length > 0);

        // Build resource policy document with IP filtering
        // Resource ARN format: execute-api:/*/<stage>/<method>/<path>
        // When no allowlist: Single statement allowing all IPs
        // When allowlist configured: Two statements (health exempt, webhooks restricted)
        const policyStatements: iam.PolicyStatement[] = [];

        if (allowedIps.length === 0) {
            // No IP filtering - allow all requests from anywhere
            policyStatements.push(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    principals: [new iam.AnyPrincipal()],
                    actions: ["execute-api:Invoke"],
                    resources: ["execute-api:/*"],
                }),
            );
            console.log("Resource Policy IP filtering: DISABLED (no webhookAllowList configured)");
            console.log("All endpoints accessible from any IP");
        } else {
            // IP filtering enabled - create two statements

            // Statement 1: Health endpoints always accessible (no IP restriction)
            policyStatements.push(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    principals: [new iam.AnyPrincipal()],
                    actions: ["execute-api:Invoke"],
                    resources: [
                        // Health check endpoints are always accessible
                        "execute-api:/*/GET/health",
                        "execute-api:/*/GET/health/ready",
                        "execute-api:/*/GET/health/live",
                        // Stage-prefixed health endpoints
                        "execute-api:/*/GET/*/health",
                        "execute-api:/*/GET/*/health/ready",
                        "execute-api:/*/GET/*/health/live",
                    ],
                }),
            );

            // Statement 2: Webhook endpoints with IP restrictions
            policyStatements.push(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    principals: [new iam.AnyPrincipal()],
                    actions: ["execute-api:Invoke"],
                    resources: [
                        // Webhook endpoints
                        "execute-api:/*/POST/event",
                        "execute-api:/*/POST/lifecycle",
                        "execute-api:/*/POST/canvas",
                        // Stage-prefixed webhook endpoints
                        "execute-api:/*/POST/*/event",
                        "execute-api:/*/POST/*/lifecycle",
                        "execute-api:/*/POST/*/canvas",
                    ],
                    conditions: {
                        IpAddress: {
                            "aws:SourceIp": allowedIps,
                        },
                    },
                }),
            );

            console.log("Resource Policy IP filtering: ENABLED");
            console.log(`Allowed IPs: ${allowedIps.join(", ")}`);
            console.log(`Health endpoints exempt from IP filtering (always accessible)`);
            console.log(`Created ${policyStatements.length} resource policy statements`);
            console.log("  - Statement 1: Health endpoints (no IP restriction)");
            console.log("  - Statement 2: Webhook endpoints (IP restricted)");
        }

        const policyDoc = new iam.PolicyDocument({
            statements: policyStatements,
        });

        // Create REST API v1 with resource policy
        this.api = new apigateway.RestApi(scope, "BenchlingWebhookRestAPI", {
            restApiName: "BenchlingWebhookRestAPI",
            description: "REST API v1 for Benchling webhook integration with resource policy IP filtering",
            policy: policyDoc,
            deployOptions: {
                stageName: props.stage,
                accessLogDestination: new apigateway.LogGroupLogDestination(this.logGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
                    ip: true,
                    caller: false,
                    user: false,
                    requestTime: true,
                    httpMethod: true,
                    resourcePath: true,
                    status: true,
                    protocol: true,
                    responseLength: true,
                }),
            },
            endpointConfiguration: {
                types: [apigateway.EndpointType.REGIONAL],
            },
        });

        // VPC Link for private integration with Network Load Balancer
        this.vpcLink = new apigateway.VpcLink(scope, "VpcLink", {
            targets: [props.networkLoadBalancer],
            description: "VPC Link to Network Load Balancer for private ECS integration",
        });

        // HTTP Integration to NLB via VPC Link
        // Set timeout to 29 seconds (maximum for REST API) to handle slow JWKS fetches
        // on cold starts. The Benchling SDK caches JWKS after first fetch.
        //
        // Simple HTTP_PROXY integration that forwards ALL requests with complete paths
        // API Gateway Request: GET https://api-id.execute-api.region.amazonaws.com/prod/health
        // Forwarded to NLB: GET http://nlb:80/prod/health
        //
        // FastAPI implements flexible routes:
        //   - Stage-prefixed: /{stage}/health, /{stage}/event (matches API Gateway requests)
        //   - Direct paths: /health (matches NLB health checks)
        const integration = new apigateway.Integration({
            type: apigateway.IntegrationType.HTTP_PROXY,
            integrationHttpMethod: "ANY",
            uri: `http://${props.networkLoadBalancer.loadBalancerDnsName}:80/{proxy}`,
            options: {
                connectionType: apigateway.ConnectionType.VPC_LINK,
                vpcLink: this.vpcLink,
                timeout: cdk.Duration.seconds(29),
                requestParameters: {
                    "integration.request.path.proxy": "method.request.path.proxy",
                },
            },
        });

        // Greedy proxy that captures the COMPLETE path including stage
        // API Gateway doesn't strip the stage when using root-level {proxy+}
        const proxyResource = this.api.root.addResource("{proxy+}");
        proxyResource.addMethod("ANY", integration, {
            requestParameters: {
                "method.request.path.proxy": true,
            },
        });

        // Webhook verification status
        const verificationEnabled = props.config.security?.enableVerification !== false;
        if (verificationEnabled) {
            console.log("Webhook signature verification: ENABLED (FastAPI application)");
        } else {
            console.warn(
                "WARNING: Webhook signature verification is DISABLED. " +
                "This should only be used for testing. Enable it in production by setting " +
                "config.security.enableVerification = true",
            );
        }
    }
}
