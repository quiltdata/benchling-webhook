import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as logs from "aws-cdk-lib/aws-logs";
import * as lambda from "aws-cdk-lib/aws-lambda";
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
    public readonly authorizer?: lambda.Function;
    public readonly authorizerLogGroup?: logs.ILogGroup;

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
        this.nlb.addListener("Listener", {
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

        const verificationEnabled = props.config.security?.enableVerification !== false;
        const benchlingSecretArn = props.config.benchling.secretArn;
        if (!benchlingSecretArn) {
            throw new Error("Benchling secret ARN is required to configure the Lambda authorizer");
        }

        // Build resource policy for IP whitelisting
        const resourcePolicy = this.buildResourcePolicy(ipAllowList);

        // Lambda authorizer for webhook verification
        this.authorizerLogGroup = new logs.LogGroup(scope, "WebhookAuthorizerLogGroup", {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        const bundlingCommands = [
            "set -euo pipefail",
            "export PIP_NO_BUILD_ISOLATION=1 PIP_ONLY_BINARY=:all: PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_CACHE_DIR=/tmp/pipcache",
            "pip install -q --platform manylinux2014_x86_64 --implementation cp --python-version 3.11 --abi cp311 --only-binary=:all: -t /asset-output -r /asset-input/lambda/authorizer/requirements.txt -c /asset-input/lambda/authorizer/constraints.txt",
            "cp /asset-input/docker/src/lambda_authorizer.py /asset-output/index.py",
        ].join(" && ");

        const authorizerCode = process.env.NODE_ENV === "test"
            ? lambda.Code.fromInline("def handler(event, context):\n    return {}")
            : lambda.Code.fromAsset(".", {
                bundling: {
                    image: lambda.Runtime.PYTHON_3_11.bundlingImage,
                    command: ["bash", "-c", bundlingCommands],
                },
            });

        this.authorizer = new lambda.Function(scope, "WebhookAuthorizerFunction", {
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: "index.handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(10),
            architecture: lambda.Architecture.X86_64,
            description: "Benchling webhook signature verification (defense-in-depth)",
            environment: {
                BENCHLING_SECRET_ARN: benchlingSecretArn,
            },
            code: authorizerCode,
            logGroup: this.authorizerLogGroup,
        });

        this.authorizer.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["secretsmanager:GetSecretValue"],
                resources: [benchlingSecretArn],
            }),
        );

        // Create REST API first (needed for proper authorizer permissions)
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

        // Create authorizer AFTER API is created (for proper source ARN permissions)
        const requestAuthorizer = verificationEnabled
            ? new apigateway.RequestAuthorizer(scope, "WebhookRequestAuthorizer", {
                handler: this.authorizer,
                identitySources: [
                    apigateway.IdentitySource.header("webhook-id"),
                    apigateway.IdentitySource.header("webhook-signature"),
                    apigateway.IdentitySource.header("webhook-timestamp"),
                ],
                resultsCacheTtl: cdk.Duration.seconds(0),
            })
            : undefined;

        // Grant API Gateway permission to invoke Lambda authorizer from any method
        // The CDK RequestAuthorizer grants permission only for /authorizers/{id},
        // but API Gateway invokes from /{stage}/{method}/{path}, so we add explicit permission
        if (verificationEnabled && this.authorizer) {
            this.authorizer.addPermission("ApiGatewayInvokePermission", {
                principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
                action: "lambda:InvokeFunction",
                sourceArn: this.api.arnForExecuteApi("*", "/*", "*"),
            });
        }

        const createIntegration = (path: string): apigateway.Integration =>
            new apigateway.Integration({
                type: apigateway.IntegrationType.HTTP_PROXY,
                integrationHttpMethod: "ANY",
                uri: `http://${this.nlb.loadBalancerDnsName}:80${path}`,
                options: {
                    connectionType: apigateway.ConnectionType.VPC_LINK,
                    vpcLink: this.vpcLink,
                },
            });

        const webhookMethodOptions = requestAuthorizer
            ? {
                authorizer: requestAuthorizer,
                authorizationType: apigateway.AuthorizationType.CUSTOM,
            }
            : undefined;

        const addWebhookRoute = (resource: apigateway.IResource, path: string): void => {
            resource.addMethod("POST", createIntegration(path), webhookMethodOptions);
            resource.addMethod("OPTIONS", new apigateway.MockIntegration({
                integrationResponses: [
                    {
                        statusCode: "204",
                        responseParameters: {
                            "method.response.header.Access-Control-Allow-Origin": "'*'",
                            "method.response.header.Access-Control-Allow-Headers": "'*'",
                            "method.response.header.Access-Control-Allow-Methods": "'POST,OPTIONS'",
                        },
                    },
                ],
                passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
                requestTemplates: {
                    "application/json": "{\"statusCode\": 204}",
                },
            }), {
                authorizationType: apigateway.AuthorizationType.NONE,
                methodResponses: [
                    {
                        statusCode: "204",
                        responseParameters: {
                            "method.response.header.Access-Control-Allow-Origin": true,
                            "method.response.header.Access-Control-Allow-Headers": true,
                            "method.response.header.Access-Control-Allow-Methods": true,
                        },
                    },
                ],
            });
        };

        // Webhook endpoints secured by Lambda authorizer (POST only; OPTIONS is unauthenticated)
        const eventResource = this.api.root.addResource("event");
        addWebhookRoute(eventResource, "/event");

        const lifecycleResource = this.api.root.addResource("lifecycle");
        addWebhookRoute(lifecycleResource, "/lifecycle");

        const canvasResource = this.api.root.addResource("canvas");
        addWebhookRoute(canvasResource, "/canvas");

        // Health endpoints remain unauthenticated
        const healthResource = this.api.root.addResource("health");
        healthResource.addMethod("GET", createIntegration("/health"));
        healthResource.addResource("ready").addMethod("GET", createIntegration("/health/ready"));
        healthResource.addResource("live").addMethod("GET", createIntegration("/health/live"));

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
