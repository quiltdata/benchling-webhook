import * as cdk from "aws-cdk-lib";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { ProfileConfig } from "./types/config";
import { WafWebAcl } from "./waf-web-acl";

export interface HttpApiGatewayProps {
    readonly vpc: ec2.IVpc;
    readonly cloudMapService: servicediscovery.IService;
    readonly serviceSecurityGroup: ec2.ISecurityGroup;
    readonly config: ProfileConfig;
}

export class HttpApiGateway {
    public readonly api: apigatewayv2.HttpApi;
    public readonly vpcLink: apigatewayv2.VpcLink;
    public readonly logGroup: logs.ILogGroup;
    public readonly wafWebAcl: WafWebAcl;

    constructor(scope: Construct, id: string, props: HttpApiGatewayProps) {
        // Access logs for HTTP API
        this.logGroup = new logs.LogGroup(scope, "ApiGatewayAccessLogs", {
            logGroupName: "/aws/apigateway/benchling-webhook-http",
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // VPC Link for private integration with Cloud Map service
        this.vpcLink = new apigatewayv2.VpcLink(scope, "VpcLink", {
            vpc: props.vpc,
            securityGroups: [props.serviceSecurityGroup],
            vpcLinkName: "benchling-webhook-vpclink",
        });

        // Create HTTP API v2
        this.api = new apigatewayv2.HttpApi(scope, "BenchlingWebhookHttpAPI", {
            apiName: "BenchlingWebhookHttpAPI",
            description: "HTTP API for Benchling webhook integration (v0.9.0+ with WAF)",
        });

        // Service Discovery integration via VPC Link
        const integration = new apigatewayv2Integrations.HttpServiceDiscoveryIntegration(
            "CloudMapIntegration",
            props.cloudMapService,
            { vpcLink: this.vpcLink },
        );

        // Webhook routes - HMAC verification handled by FastAPI application
        // Event webhooks
        this.api.addRoutes({
            path: "/event",
            methods: [apigatewayv2.HttpMethod.POST],
            integration,
        });

        // Lifecycle webhooks
        this.api.addRoutes({
            path: "/lifecycle",
            methods: [apigatewayv2.HttpMethod.POST],
            integration,
        });

        // Canvas webhooks
        this.api.addRoutes({
            path: "/canvas",
            methods: [apigatewayv2.HttpMethod.POST],
            integration,
        });

        // Health check routes - always unauthenticated
        this.api.addRoutes({
            path: "/health",
            methods: [apigatewayv2.HttpMethod.GET],
            integration,
        });

        this.api.addRoutes({
            path: "/health/ready",
            methods: [apigatewayv2.HttpMethod.GET],
            integration,
        });

        this.api.addRoutes({
            path: "/health/live",
            methods: [apigatewayv2.HttpMethod.GET],
            integration,
        });

        // Root path - unauthenticated (informational endpoint)
        this.api.addRoutes({
            path: "/",
            methods: [apigatewayv2.HttpMethod.GET],
            integration,
        });

        // Create WAF Web ACL for IP filtering
        this.wafWebAcl = new WafWebAcl(scope, "WafWebAcl", {
            ipAllowList: props.config.security?.webhookAllowList || "",
        });

        // Construct HTTP API ARN for WAF association
        // Format: arn:aws:apigateway:{region}::/apis/{api-id}/stages/{stage-name}
        const apiArn = cdk.Stack.of(scope).formatArn({
            service: "apigateway",
            resource: `/apis/${this.api.apiId}/stages/${this.api.defaultStage?.stageName || "$default"}`,
            arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
        });

        // Associate WAF with HTTP API
        new wafv2.CfnWebACLAssociation(scope, "WafAssociation", {
            resourceArn: apiArn,
            webAclArn: this.wafWebAcl.webAcl.attrArn,
        });

        // Configure access logging on the default stage
        const stage = this.api.defaultStage?.node.defaultChild as apigatewayv2.CfnStage | undefined;
        if (stage) {
            stage.accessLogSettings = {
                destinationArn: this.logGroup.logGroupArn,
                format: JSON.stringify({
                    requestId: "$context.requestId",
                    ip: "$context.identity.sourceIp",
                    requestTime: "$context.requestTime",
                    httpMethod: "$context.httpMethod",
                    routeKey: "$context.routeKey",
                    status: "$context.status",
                    protocol: "$context.protocol",
                    responseLength: "$context.responseLength",
                    errorMessage: "$context.error.message",
                    errorType: "$context.error.messageString",
                }),
            };
        }

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
