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

        // Build resource policy document
        const policyStatements: iam.PolicyStatement[] = [
            // Allow health checks from anywhere (exempt from IP filtering)
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [new iam.AnyPrincipal()],
                actions: ["execute-api:Invoke"],
                resources: [
                    `execute-api:/*/${props.stage}/GET/health`,
                    `execute-api:/*/${props.stage}/GET/health/ready`,
                    `execute-api:/*/${props.stage}/GET/health/live`,
                ],
            }),
            // Allow root path from anywhere (informational endpoint)
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [new iam.AnyPrincipal()],
                actions: ["execute-api:Invoke"],
                resources: [`execute-api:/*/${props.stage}/GET/`],
            }),
        ];

        // Add IP filtering for webhook endpoints if allowlist configured
        if (allowedIps.length > 0) {
            console.log("Resource Policy IP filtering: ENABLED");
            console.log(`Allowed IPs: ${allowedIps.join(", ")}`);

            // Allow webhook requests only from allowlist
            policyStatements.push(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    principals: [new iam.AnyPrincipal()],
                    actions: ["execute-api:Invoke"],
                    resources: [
                        `execute-api:/*/${props.stage}/POST/event`,
                        `execute-api:/*/${props.stage}/POST/lifecycle`,
                        `execute-api:/*/${props.stage}/POST/canvas`,
                    ],
                    conditions: {
                        IpAddress: {
                            "aws:SourceIp": allowedIps,
                        },
                    },
                }),
            );
        } else {
            console.log("Resource Policy IP filtering: DISABLED (no webhookAllowList configured)");

            // No IP filtering - allow all webhook requests
            policyStatements.push(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    principals: [new iam.AnyPrincipal()],
                    actions: ["execute-api:Invoke"],
                    resources: [
                        `execute-api:/*/${props.stage}/POST/event`,
                        `execute-api:/*/${props.stage}/POST/lifecycle`,
                        `execute-api:/*/${props.stage}/POST/canvas`,
                    ],
                }),
            );
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

        // Define routes with proxy+ pattern to capture all paths
        // This allows the FastAPI application to handle routing

        // Event webhook
        const eventResource = this.api.root.addResource("event");
        eventResource.addMethod("POST", integration, {
            requestParameters: {
                "method.request.path.proxy": true,
            },
        });

        // Lifecycle webhook
        const lifecycleResource = this.api.root.addResource("lifecycle");
        lifecycleResource.addMethod("POST", integration, {
            requestParameters: {
                "method.request.path.proxy": true,
            },
        });

        // Canvas webhook
        const canvasResource = this.api.root.addResource("canvas");
        canvasResource.addMethod("POST", integration, {
            requestParameters: {
                "method.request.path.proxy": true,
            },
        });

        // Health check endpoints
        const healthResource = this.api.root.addResource("health");
        healthResource.addMethod("GET", integration, {
            requestParameters: {
                "method.request.path.proxy": true,
            },
        });

        const readyResource = healthResource.addResource("ready");
        readyResource.addMethod("GET", integration, {
            requestParameters: {
                "method.request.path.proxy": true,
            },
        });

        const liveResource = healthResource.addResource("live");
        liveResource.addMethod("GET", integration, {
            requestParameters: {
                "method.request.path.proxy": true,
            },
        });

        // Root path - informational endpoint
        this.api.root.addMethod("GET", integration, {
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
