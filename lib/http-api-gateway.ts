import * as cdk from "aws-cdk-lib";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as logs from "aws-cdk-lib/aws-logs";
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

    constructor(scope: Construct, id: string, props: HttpApiGatewayProps) {
        // Access logs for HTTP API
        this.logGroup = new logs.LogGroup(scope, "ApiGatewayAccessLogs", {
            logGroupName: "/aws/apigateway/benchling-webhook-http",
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        this.vpcLink = new apigatewayv2.VpcLink(scope, "VpcLink", {
            vpc: props.vpc,
            securityGroups: [props.serviceSecurityGroup],
            vpcLinkName: "benchling-webhook-vpclink",
        });

        this.api = new apigatewayv2.HttpApi(scope, "BenchlingWebhookHttpAPI", {
            apiName: "BenchlingWebhookHttpAPI",
            description: "HTTP API for Benchling webhook integration (v0.9.0+)",
        });

        const integration = new apigatewayv2Integrations.HttpServiceDiscoveryIntegration(
            "CloudMapIntegration",
            props.cloudMapService,
            { vpcLink: this.vpcLink },
        );

        this.api.addRoutes({
            path: "/{proxy+}",
            methods: [apigatewayv2.HttpMethod.ANY],
            integration,
        });

        this.api.addRoutes({
            path: "/",
            methods: [apigatewayv2.HttpMethod.ANY],
            integration,
        });

        const stage = this.api.defaultStage?.node.defaultChild as apigatewayv2.CfnStage | undefined;
        if (stage) {
            stage.accessLogSettings = {
                destinationArn: this.logGroup.logGroupArn,
                format: "$context.requestId $context.routeKey $context.status",
            };
        }
    }
}
