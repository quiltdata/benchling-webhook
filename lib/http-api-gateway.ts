import * as cdk from "aws-cdk-lib";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as logs from "aws-cdk-lib/aws-logs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { ProfileConfig } from "./types/config";

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
    public readonly authorizer?: lambda.Function;
    public readonly authorizerLogGroup?: logs.ILogGroup;

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

        // Lambda authorizer for webhook verification (HTTP API v2 SIMPLE response)
        const verificationEnabled = props.config.security?.enableVerification !== false;
        const benchlingSecretArn = props.config.benchling.secretArn;

        if (!benchlingSecretArn) {
            throw new Error("Benchling secret ARN is required to configure the Lambda authorizer");
        }

        // Create authorizer Lambda if verification is enabled
        let httpAuthorizer: apigatewayv2.IHttpRouteAuthorizer | undefined;

        if (verificationEnabled) {
            this.authorizerLogGroup = new logs.LogGroup(scope, "WebhookAuthorizerLogGroup", {
                retention: logs.RetentionDays.ONE_WEEK,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            });

            // Lambda bundling: Install dependencies at build time
            // NOTE: For local development, pre-build with: make lambda-bundle
            // This reduces CDK build time by using cached wheels
            const bundlingCommands = [
                "set -euo pipefail",
                "export PIP_NO_BUILD_ISOLATION=1 PIP_ONLY_BINARY=:all: PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_CACHE_DIR=/tmp/pipcache",
                "pip install -q --platform manylinux2014_x86_64 --implementation cp --python-version 3.12 --abi cp312 --only-binary=:all: -t /asset-output -r /asset-input/lambda/authorizer/requirements.txt -c /asset-input/lambda/authorizer/constraints.txt",
                "cp /asset-input/docker/src/lambda_authorizer.py /asset-output/index.py",
            ].join(" && ");

            const authorizerCode = process.env.NODE_ENV === "test"
                ? lambda.Code.fromInline("def handler(event, context):\n    return {'isAuthorized': True}")
                : lambda.Code.fromAsset(".", {
                    bundling: {
                        image: lambda.Runtime.PYTHON_3_12.bundlingImage,
                        command: ["bash", "-c", bundlingCommands],
                    },
                });

            this.authorizer = new lambda.Function(scope, "WebhookAuthorizerFunction", {
                runtime: lambda.Runtime.PYTHON_3_12,
                handler: "index.handler",
                memorySize: 128,
                timeout: cdk.Duration.seconds(10),
                architecture: lambda.Architecture.X86_64,
                description: "Benchling webhook signature verification (HTTP API v2)",
                environment: {
                    BENCHLING_SECRET_ARN: benchlingSecretArn,
                    LOG_LEVEL: props.config.logging?.level || "INFO",
                },
                code: authorizerCode,
                logGroup: this.authorizerLogGroup,
            });

            // Grant Secrets Manager access
            this.authorizer.addToRolePolicy(
                new iam.PolicyStatement({
                    actions: ["secretsmanager:GetSecretValue"],
                    resources: [benchlingSecretArn],
                }),
            );

            // Create HTTP Lambda Authorizer with SIMPLE response format
            // Note: HTTP API v2 uses a simpler response format than REST API (REQUEST authorizer)
            httpAuthorizer = new apigatewayv2Authorizers.HttpLambdaAuthorizer(
                "WebhookAuthorizer",
                this.authorizer,
                {
                    authorizerName: "WebhookAuthorizer",
                    identitySource: [
                        "$request.header.webhook-signature",
                        "$request.header.webhook-id",
                        "$request.header.webhook-timestamp",
                    ],
                    responseTypes: [apigatewayv2Authorizers.HttpLambdaResponseType.SIMPLE],
                    resultsCacheTtl: cdk.Duration.seconds(0), // No caching for HMAC signatures
                },
            );
        }

        // Create HTTP API v2
        this.api = new apigatewayv2.HttpApi(scope, "BenchlingWebhookHttpAPI", {
            apiName: "BenchlingWebhookHttpAPI",
            description: "HTTP API for Benchling webhook integration (v0.9.0+)",
        });

        // Service Discovery integration via VPC Link
        const integration = new apigatewayv2Integrations.HttpServiceDiscoveryIntegration(
            "CloudMapIntegration",
            props.cloudMapService,
            { vpcLink: this.vpcLink },
        );

        // Webhook routes - protected by Lambda authorizer
        if (httpAuthorizer) {
            // Event webhooks (protected)
            this.api.addRoutes({
                path: "/event",
                methods: [apigatewayv2.HttpMethod.POST],
                integration,
                authorizer: httpAuthorizer,
            });

            // Lifecycle webhooks (protected)
            this.api.addRoutes({
                path: "/lifecycle",
                methods: [apigatewayv2.HttpMethod.POST],
                integration,
                authorizer: httpAuthorizer,
            });

            // Canvas webhooks (protected)
            this.api.addRoutes({
                path: "/canvas",
                methods: [apigatewayv2.HttpMethod.POST],
                integration,
                authorizer: httpAuthorizer,
            });
        } else {
            // No authorizer - allow all webhook routes (for testing only)
            this.api.addRoutes({
                path: "/event",
                methods: [apigatewayv2.HttpMethod.POST],
                integration,
            });

            this.api.addRoutes({
                path: "/lifecycle",
                methods: [apigatewayv2.HttpMethod.POST],
                integration,
            });

            this.api.addRoutes({
                path: "/canvas",
                methods: [apigatewayv2.HttpMethod.POST],
                integration,
            });

            console.warn(
                "WARNING: Webhook signature verification is DISABLED. " +
                "This should only be used for testing. Enable it in production by setting " +
                "config.security.enableVerification = true",
            );
        }

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
                    authorizerError: "$context.authorizer.error",
                }),
            };
        }

        // Output verification status
        if (verificationEnabled) {
            console.log("Webhook signature verification: ENABLED (Lambda authorizer)");
        } else {
            console.log("Webhook signature verification: DISABLED (testing mode)");
        }
    }
}
