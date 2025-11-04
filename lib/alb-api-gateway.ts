import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

export interface AlbApiGatewayProps {
    readonly loadBalancer: elbv2.ApplicationLoadBalancer;
    readonly webhookAllowList?: string;
    readonly environments: Array<{
        stageName: string;           // "dev" or "prod"
        targetGroup: elbv2.ApplicationTargetGroup;
    }>;
}

export class AlbApiGateway {
    public readonly api: apigateway.RestApi;
    public readonly logGroup: logs.ILogGroup;
    public readonly stages: Map<string, apigateway.Stage>;
    private readonly loadBalancer: elbv2.ApplicationLoadBalancer;

    constructor(
        scope: Construct,
        id: string,
        props: AlbApiGatewayProps,
    ) {
        this.loadBalancer = props.loadBalancer;

        this.logGroup = new logs.LogGroup(scope, "ApiGatewayAccessLogs", {
            logGroupName: "/aws/apigateway/benchling-webhook",
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        this.createCloudWatchRole(scope);

        // Parse IP allowlist for resource policy
        let allowedIps: string[] | undefined = undefined;
        if (props.webhookAllowList) {
            if (cdk.Token.isUnresolved(props.webhookAllowList)) {
                // For CDK tokens (parameters), we can't evaluate at synth time
                // Split and let CloudFormation handle it
                allowedIps = cdk.Fn.split(",", props.webhookAllowList) as unknown as string[];
            } else if (props.webhookAllowList.trim() !== "") {
                // For concrete values, parse and filter
                const parsed = props.webhookAllowList
                    .split(",")
                    .map(ip => ip.trim())
                    .filter(ip => ip.length > 0);
                if (parsed.length > 0) {
                    allowedIps = parsed;
                }
            }
        }

        // Create resource policy for IP filtering at the edge
        // Only create policy if we have IPs and they're not from an empty parameter
        const policyDocument = this.createResourcePolicy(allowedIps, props.webhookAllowList);

        // Create API Gateway without default deployment
        // We'll create explicit stages below to route to different target groups
        this.api = new apigateway.RestApi(scope, "BenchlingWebhookAPI", {
            restApiName: "BenchlingWebhookAPI",
            policy: policyDocument,
            deploy: false,  // Manual stage deployment for multi-environment support
        });

        // Create webhook endpoints with HTTP integrations
        // Each stage will route to the ALB (all stages share the same integration for now)
        this.addWebhookEndpoints();

        // Create stages for each environment
        // Each stage has its own deployment and routes to the appropriate target group
        // In Phase 1a, all stages route to the same backend for demonstration purposes
        // In Phase 1b, ALB listener rules will route to different target groups per stage
        this.stages = new Map();
        for (const env of props.environments) {
            const deployment = new apigateway.Deployment(scope, `${env.stageName}Deployment`, {
                api: this.api,
                // Add description to force new deployment on changes
                description: `Deployment for ${env.stageName} environment`,
            });

            const stage = new apigateway.Stage(scope, `${env.stageName}Stage`, {
                deployment,
                stageName: env.stageName,
                accessLogDestination: new apigateway.LogGroupLogDestination(this.logGroup),
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: true,
            });

            this.stages.set(env.stageName, stage);

            // Output stage-specific endpoint URL
            new cdk.CfnOutput(scope, `${env.stageName}WebhookEndpoint`, {
                value: stage.urlForPath("/"),
                description: `Webhook endpoint URL for ${env.stageName} environment`,
            });

            // Output stage-specific execution log group
            new cdk.CfnOutput(scope, `${env.stageName}ExecutionLogGroup`, {
                value: `API-Gateway-Execution-Logs_${this.api.restApiId}/${env.stageName}`,
                description: `API Gateway execution log group for ${env.stageName} environment`,
            });
        }

        // Output API Gateway ID for reference
        new cdk.CfnOutput(scope, "ApiGatewayId", {
            value: this.api.restApiId,
            description: "API Gateway REST API ID",
        });

        // Output ALB DNS for direct testing
        new cdk.CfnOutput(scope, "LoadBalancerDNS", {
            value: props.loadBalancer.loadBalancerDnsName,
            description: "Application Load Balancer DNS name for direct testing",
        });
    }

    private createResourcePolicy(
        allowedIps: string[] | undefined,
        rawParameter: string | undefined,
    ): iam.PolicyDocument | undefined {
        // Don't create policy if no IPs provided
        if (!allowedIps) {
            return undefined;
        }

        // Don't create policy for empty arrays
        if (Array.isArray(allowedIps) && allowedIps.length === 0) {
            return undefined;
        }

        // For CDK tokens (CloudFormation parameters), we can't evaluate at synth time
        // Don't create policy for parameters since we can't conditionally apply them
        // API Gateway doesn't support conditional policies, so we skip the policy entirely
        // when using parameters. This means WebhookAllowList parameter won't work for
        // runtime IP filtering - IPs must be set at deployment time.
        if (rawParameter && cdk.Token.isUnresolved(rawParameter)) {
            return undefined;
        }

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

    private createCloudWatchRole(scope: Construct): iam.Role {
        const cloudWatchRole = new iam.Role(scope, "ApiGatewayCloudWatchRole", {
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    "service-role/AmazonAPIGatewayPushToCloudWatchLogs",
                ),
            ],
        });

        new apigateway.CfnAccount(scope, "ApiGatewayAccount", {
            cloudWatchRoleArn: cloudWatchRole.roleArn,
        });

        return cloudWatchRole;
    }

    private addWebhookEndpoints(): void {
        // Create HTTP integration for proxy path
        // This routes all requests directly to the ALB via public DNS
        // For Phase 1a, all stages route to the same ALB backend
        // In Phase 1b, ALB listener rules will differentiate based on stage headers
        const albIntegration = new apigateway.HttpIntegration(
            `http://${this.loadBalancer.loadBalancerDnsName}/{proxy}`,
            {
                httpMethod: "ANY",
                options: {
                    requestParameters: {
                        "integration.request.path.proxy": "method.request.path.proxy",
                    },
                    integrationResponses: [
                        { statusCode: "200" },
                        {
                            statusCode: "400",
                            selectionPattern: "4\\d{2}",
                        },
                        {
                            statusCode: "500",
                            selectionPattern: "5\\d{2}",
                        },
                    ],
                },
            },
        );

        // Create proxy resource to forward all requests to ALB
        const proxyResource = this.api.root.addResource("{proxy+}");
        proxyResource.addMethod("ANY", albIntegration, {
            requestParameters: {
                "method.request.path.proxy": true,
            },
            methodResponses: [
                { statusCode: "200" },
                { statusCode: "400" },
                { statusCode: "500" },
            ],
        });

        // Also handle root path
        this.api.root.addMethod("ANY", new apigateway.HttpIntegration(
            `http://${this.loadBalancer.loadBalancerDnsName}/`,
            {
                httpMethod: "ANY",
                options: {
                    integrationResponses: [
                        { statusCode: "200" },
                        {
                            statusCode: "400",
                            selectionPattern: "4\\d{2}",
                        },
                        {
                            statusCode: "500",
                            selectionPattern: "5\\d{2}",
                        },
                    ],
                },
            },
        ), {
            methodResponses: [
                { statusCode: "200" },
                { statusCode: "400" },
                { statusCode: "500" },
            ],
        });
    }
}
