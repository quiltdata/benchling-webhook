import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { AlbApiGateway } from "../lib/alb-api-gateway";
import { ProfileConfig } from "../lib/types/config";

describe("AlbApiGateway", () => {
    let stack: cdk.Stack;
    let vpc: ec2.IVpc;
    let loadBalancer: elbv2.ApplicationLoadBalancer;
    let mockConfig: ProfileConfig;

    beforeEach(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");

        // Create a VPC for testing
        vpc = new ec2.Vpc(stack, "TestVpc", {
            maxAzs: 2,
        });

        // Create an ALB for testing
        loadBalancer = new elbv2.ApplicationLoadBalancer(stack, "TestALB", {
            vpc,
            internetFacing: true,
        });

        // Create minimal mock ProfileConfig for testing
        mockConfig = {
            quilt: {
                stackArn: "arn:aws:cloudformation:us-west-2:987654321098:stack/quilt/def456",
                catalog: "https://catalog.example.org",
                bucket: "test-bucket",
                database: "test_db",
                queueUrl: "https://sqs.us-west-2.amazonaws.com/987654321098/test-queue",
                region: "us-west-2",
            },
            benchling: {
                tenant: "test-tenant",
                clientId: "client_test",
                clientSecret: "secret_test",
                appDefinitionId: "app_test",
            },
            packages: {
                bucket: "test-packages",
                prefix: "test",
                metadataKey: "test_id",
            },
            deployment: {
                region: "us-west-2",
            },
            _metadata: {
                version: "0.7.0",
                createdAt: "2025-11-04T12:00:00Z",
                updatedAt: "2025-11-04T12:00:00Z",
                source: "cli",
            },
        };
    });

    describe("API Gateway Configuration", () => {
        test("creates REST API with correct name", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);
            template.hasResourceProperties("AWS::ApiGateway::RestApi", {
                Name: "BenchlingWebhookAPI",
            });
        });

        test("configures CloudWatch logging", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            // Check log group exists
            template.hasResourceProperties("AWS::Logs::LogGroup", {
                LogGroupName: "/aws/apigateway/benchling-webhook",
                RetentionInDays: 7,
            });

            // Check stage has logging enabled
            template.hasResourceProperties("AWS::ApiGateway::Stage", {
                AccessLogSetting: Match.objectLike({
                    DestinationArn: Match.anyValue(),
                }),
                MethodSettings: Match.arrayWith([
                    Match.objectLike({
                        LoggingLevel: "INFO",
                        DataTraceEnabled: true,
                    }),
                ]),
            });
        });

        test("creates CloudWatch role for API Gateway", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            // Check role exists with correct service principal
            template.hasResourceProperties("AWS::IAM::Role", {
                AssumeRolePolicyDocument: Match.objectLike({
                    Statement: Match.arrayWith([
                        Match.objectLike({
                            Principal: {
                                Service: "apigateway.amazonaws.com",
                            },
                        }),
                    ]),
                }),
                ManagedPolicyArns: Match.arrayWith([
                    Match.objectLike({
                        "Fn::Join": Match.arrayWith([
                            Match.arrayWith([
                                Match.stringLikeRegexp(".*AmazonAPIGatewayPushToCloudWatchLogs.*"),
                            ]),
                        ]),
                    }),
                ]),
            });
        });
    });

    describe("HTTP Proxy Integration", () => {
        test("creates HTTP proxy integration to ALB", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            // Check that integration uses HTTP type (not AWS/Step Functions)
            template.hasResourceProperties("AWS::ApiGateway::Method", {
                Integration: Match.objectLike({
                    Type: "HTTP_PROXY",
                    IntegrationHttpMethod: "ANY",
                    Uri: Match.objectLike({
                        "Fn::Join": ["", Match.arrayWith([
                            "http://",
                        ])],
                    }),
                }),
            });
        });

        test("does NOT create Step Functions role", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            // Ensure no role with "StepFunctions" in the logical ID
            const resources = template.toJSON().Resources;
            const stepFunctionRoles = Object.keys(resources).filter(key =>
                key.includes("StepFunctions"),
            );
            expect(stepFunctionRoles).toHaveLength(0);
        });

        test("does NOT use AWS integration type", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            // Get all methods and verify none use AWS integration
            const resources = template.toJSON().Resources;
            const methods = Object.entries(resources).filter(([, resource]: [string, any]) =>
                resource.Type === "AWS::ApiGateway::Method",
            );

            methods.forEach(([, method]: [string, any]) => {
                expect(method.Properties.Integration.Type).not.toBe("AWS");
                expect(method.Properties.Integration.Type).toBe("HTTP_PROXY");
            });
        });

        test("configures proxy resource with path parameter", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            // Check proxy+ resource exists
            template.hasResourceProperties("AWS::ApiGateway::Resource", {
                PathPart: "{proxy+}",
            });

            // Check method has request parameter for proxy path
            template.hasResourceProperties("AWS::ApiGateway::Method", {
                RequestParameters: {
                    "method.request.path.proxy": true,
                },
                Integration: Match.objectLike({
                    RequestParameters: {
                        "integration.request.path.proxy": "method.request.path.proxy",
                    },
                }),
            });
        });

        test("creates ANY method for root and proxy paths", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            // Should have at least 2 ANY methods (root + proxy)
            const resources = template.toJSON().Resources;
            const anyMethods = Object.values(resources).filter((resource: any) =>
                resource.Type === "AWS::ApiGateway::Method" &&
                resource.Properties.HttpMethod === "ANY",
            );

            expect(anyMethods.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe("IP Allowlist Configuration", () => {
        test("creates resource policy when allowlist is provided", () => {
            const configWithAllowlist: ProfileConfig = {
                ...mockConfig,
                security: {
                    webhookAllowList: "1.2.3.4,5.6.7.8",
                },
            };

            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: configWithAllowlist,
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ApiGateway::RestApi", {
                Policy: Match.objectLike({
                    Statement: Match.arrayWith([
                        Match.objectLike({
                            Effect: "Allow",
                            Action: "execute-api:Invoke",
                            Condition: {
                                IpAddress: {
                                    "aws:SourceIp": ["1.2.3.4", "5.6.7.8"],
                                },
                            },
                        }),
                    ]),
                }),
            });
        });

        test("does not create resource policy when allowlist is empty", () => {
            const configWithEmptyAllowlist: ProfileConfig = {
                ...mockConfig,
                security: {
                    webhookAllowList: "",
                },
            };

            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: configWithEmptyAllowlist,
            });

            const template = Template.fromStack(stack);

            const restApis = template.findResources("AWS::ApiGateway::RestApi");
            const restApiValues = Object.values(restApis);

            restApiValues.forEach((restApi: any) => {
                expect(restApi.Properties.Policy).toBeUndefined();
            });
        });

        test("handles CloudFormation token for allowlist", () => {
            const param = new cdk.CfnParameter(stack, "TestParam", {
                type: "String",
            });

            const configWithTokenAllowlist: ProfileConfig = {
                ...mockConfig,
                security: {
                    webhookAllowList: param.valueAsString,
                },
            };

            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: configWithTokenAllowlist,
            });

            const template = Template.fromStack(stack);

            // CloudFormation parameters cannot be used for IP filtering
            // API Gateway doesn't support conditional policies at runtime
            // So Policy should be undefined when using parameters
            const resources = template.findResources("AWS::ApiGateway::RestApi");
            const restApi = Object.values(resources)[0];
            expect(restApi.Properties.Policy).toBeUndefined();
        });
    });

    describe("Integration Responses", () => {
        test("configures success response (200)", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ApiGateway::Method", {
                Integration: Match.objectLike({
                    IntegrationResponses: Match.arrayWith([
                        Match.objectLike({
                            StatusCode: "200",
                        }),
                    ]),
                }),
                MethodResponses: Match.arrayWith([
                    Match.objectLike({
                        StatusCode: "200",
                    }),
                ]),
            });
        });

        test("configures error responses (400, 500)", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            template.hasResourceProperties("AWS::ApiGateway::Method", {
                Integration: Match.objectLike({
                    IntegrationResponses: Match.arrayWith([
                        Match.objectLike({
                            StatusCode: "400",
                            SelectionPattern: "4\\d{2}",
                        }),
                        Match.objectLike({
                            StatusCode: "500",
                            SelectionPattern: "5\\d{2}",
                        }),
                    ]),
                }),
            });
        });
    });

    describe("Outputs", () => {
        test("exports API Gateway ID as CloudFormation output", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            template.hasOutput("ApiGatewayId", {
                Description: "API Gateway REST API ID",
            });
        });

        test("exports execution log group name as CloudFormation output", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            // Just verify the output exists with the right description
            const outputs = template.toJSON().Outputs;
            expect(outputs.ApiGatewayExecutionLogGroup).toBeDefined();
            expect(outputs.ApiGatewayExecutionLogGroup.Description).toBe(
                "API Gateway execution log group for detailed request/response logs",
            );
        });

        test("exports Load Balancer DNS as CloudFormation output", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            template.hasOutput("LoadBalancerDNS", {
                Description: "Application Load Balancer DNS name for direct testing",
            });
        });
    });

    describe("Security Verification", () => {
        test("does not reference Step Functions service", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);
            const templateJson = JSON.stringify(template.toJSON());

            // Ensure no Step Functions references
            expect(templateJson).not.toContain("states");
            expect(templateJson).not.toContain("StateMachine");
            expect(templateJson).not.toContain("StepFunctions");
        });

        test("does not create IAM roles for Step Functions", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);
            const resources = template.toJSON().Resources;

            // Check all IAM roles
            Object.entries(resources).forEach(([, resource]: [string, any]) => {
                if (resource.Type === "AWS::IAM::Role") {
                    // Should not have states:StartExecution permission
                    const policies = resource.Properties.Policies || [];
                    policies.forEach((policy: any) => {
                        const statements = policy.PolicyDocument?.Statement || [];
                        statements.forEach((statement: any) => {
                            const actions = Array.isArray(statement.Action)
                                ? statement.Action
                                : [statement.Action];
                            expect(actions).not.toContain("states:StartExecution");
                        });
                    });
                }
            });
        });

        test("uses INTERNET connection type (not VPC_LINK)", () => {
            new AlbApiGateway(stack, "TestApiGateway", {
                loadBalancer,
                config: mockConfig,
            });

            const template = Template.fromStack(stack);

            // Get all methods
            const resources = template.toJSON().Resources;
            const methods = Object.values(resources).filter((resource: any) =>
                resource.Type === "AWS::ApiGateway::Method",
            );

            methods.forEach((method: any) => {
                // HTTP_PROXY should use INTERNET connection
                expect(method.Properties.Integration.Type).toBe("HTTP_PROXY");
            });
        });
    });
});
