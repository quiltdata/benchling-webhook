import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

export interface AlbApiGatewayProps {
    readonly loadBalancer: elbv2.ApplicationLoadBalancer;
    readonly webhookAllowList?: string;
}

export class AlbApiGateway {
    public readonly api: apigateway.RestApi;
    public readonly logGroup: logs.ILogGroup;

    constructor(
        scope: Construct,
        id: string,
        props: AlbApiGatewayProps,
    ) {
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

        this.api = new apigateway.RestApi(scope, "BenchlingWebhookAPI", {
            restApiName: "BenchlingWebhookAPI",
            policy: policyDocument,
            deployOptions: {
                stageName: "prod",
                accessLogDestination: new apigateway.LogGroupLogDestination(this.logGroup),
                methodOptions: {
                    "/*/*": {
                        loggingLevel: apigateway.MethodLoggingLevel.INFO,
                        dataTraceEnabled: true,
                    },
                },
            },
        });

        this.addWebhookEndpoints(props.loadBalancer);

        // Output API Gateway ID for execution logs
        new cdk.CfnOutput(scope, "ApiGatewayId", {
            value: this.api.restApiId,
            description: "API Gateway REST API ID",
        });

        // Output execution log group name
        new cdk.CfnOutput(scope, "ApiGatewayExecutionLogGroup", {
            value: `API-Gateway-Execution-Logs_${this.api.restApiId}/prod`,
            description: "API Gateway execution log group for detailed request/response logs",
        });

        // Output ALB DNS for direct testing
        new cdk.CfnOutput(scope, "LoadBalancerDNS", {
            value: props.loadBalancer.loadBalancerDnsName,
            description: "Application Load Balancer DNS name for direct testing",
        });
    }

    private createResourcePolicy(
        allowedIps: string[] | undefined,
        rawParameter: string | undefined
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

    private addWebhookEndpoints(
        loadBalancer: elbv2.ApplicationLoadBalancer,
    ): void {
        // Create HTTP integration to ALB
        const albIntegration = new apigateway.HttpIntegration(
            `http://${loadBalancer.loadBalancerDnsName}/{proxy}`,
            {
                httpMethod: "ANY",
                options: {
                    requestParameters: {
                        "integration.request.path.proxy": "method.request.path.proxy",
                    },
                    integrationResponses: [
                        {
                            statusCode: "200",
                        },
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
            `http://${loadBalancer.loadBalancerDnsName}/`,
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
