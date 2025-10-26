import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";

describe("BenchlingWebhookStack", () => {
    let template: Template;

    beforeEach(() => {
        const app = new cdk.App();
        const stack = new BenchlingWebhookStack(app, "TestStack", {
            bucketName: "test-bucket",
            environment: "test",
            prefix: "test-prefix",
            queueName: "test-queue",
            benchlingClientId: "test-client-id",
            benchlingClientSecret: "test-client-secret",
            benchlingTenant: "test-tenant",
            quiltCatalog: "https://quilt-example.com",
            webhookAllowList: "203.0.113.10,198.51.100.5",
            env: {
                account: "123456789012",
                region: "us-east-1",
            },
        });
        template = Template.fromStack(stack);
    });

    test("creates ECS cluster", () => {
        template.hasResourceProperties("AWS::ECS::Cluster", {
            ClusterName: "benchling-webhook-cluster",
            ClusterSettings: [{
                Name: "containerInsights",
                Value: "enabled",
            }],
        });
    });

    test("creates Fargate service", () => {
        template.hasResourceProperties("AWS::ECS::Service", {
            ServiceName: "benchling-webhook-service",
            LaunchType: "FARGATE",
            DesiredCount: 2,
        });
    });

    test("does not create Lambda functions or Step Functions", () => {
        // Ensure Lambda and Step Functions are removed
        template.resourceCountIs("AWS::Lambda::Function", 0);
        template.resourceCountIs("AWS::StepFunctions::StateMachine", 0);
        template.resourceCountIs("AWS::Events::Connection", 0);
    });

    test("creates CloudWatch log groups", () => {
        template.resourceCountIs("AWS::Logs::LogGroup", 2); // One for API Gateway, one for container logs

        template.hasResourceProperties("AWS::ApiGateway::Stage", {
            AccessLogSetting: {
                DestinationArn: {
                    "Fn::GetAtt": [
                        Match.stringLikeRegexp("ApiGatewayAccessLogs.*"),
                        "Arn",
                    ],
                },
            },
        });
    });

    test("creates API Gateway with correct configuration", () => {
        template.hasResourceProperties("AWS::ApiGateway::RestApi", {
            Name: "BenchlingWebhookAPI",
        });

        template.hasResourceProperties("AWS::ApiGateway::Stage", {
            StageName: "prod",
            MethodSettings: [{
                LoggingLevel: "INFO",
                DataTraceEnabled: true,
                HttpMethod: "*",
                ResourcePath: "/*",
            }],
        });

        // Check that API Gateway has HTTP_PROXY integration to ALB (not Step Functions)
        template.hasResourceProperties("AWS::ApiGateway::Method", {
            HttpMethod: "ANY",
            AuthorizationType: "NONE",
            Integration: {
                Type: "HTTP_PROXY",
            },
        });
    });

    test("creates Application Load Balancer", () => {
        template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
            Name: "benchling-webhook-alb",
            Scheme: "internet-facing",
            Type: "application",
        });
    });

    test("creates ALB target group with health checks", () => {
        template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
            Port: 5000,
            Protocol: "HTTP",
            TargetType: "ip",
            HealthCheckPath: "/health/ready",
            HealthCheckIntervalSeconds: 30,
        });
    });

    test("throws error for invalid prefix", () => {
        const app = new cdk.App();
        expect(() => {
            new BenchlingWebhookStack(app, "TestStack", {
                bucketName: "test-bucket",
                environment: "test",
                prefix: "invalid/prefix",
                queueName: "test-queue",
                benchlingClientId: "test-client-id",
                benchlingClientSecret: "test-client-secret",
                benchlingTenant: "test-tenant",
                quiltCatalog: "https://quilt-example.com",
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });
        }).toThrow("Prefix should not contain a '/' character.");
    });

    test("creates IAM role with correct permissions", () => {
        // Check for ECS Task Execution Role
        template.hasResourceProperties("AWS::IAM::Role", {
            AssumeRolePolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: "sts:AssumeRole",
                        Effect: "Allow",
                        Principal: {
                            Service: "ecs-tasks.amazonaws.com",
                        },
                    }),
                ]),
            }),
        });

        // Check for S3 permissions in task role policy
        const policies = template.findResources("AWS::IAM::Policy");
        let foundS3Policy = false;
        let foundSQSPolicy = false;

        Object.values(policies).forEach((policy: any) => {
            const statements = policy.Properties?.PolicyDocument?.Statement || [];
            statements.forEach((statement: any) => {
                if (Array.isArray(statement.Action)) {
                    if (statement.Action.some((action: string) => action.startsWith("s3:"))) {
                        foundS3Policy = true;
                    }
                    if (statement.Action.includes("sqs:SendMessage")) {
                        foundSQSPolicy = true;
                    }
                }
            });
        });

        expect(foundS3Policy).toBe(true);
        expect(foundSQSPolicy).toBe(true);
    });

    test("creates Secrets Manager secret for Benchling credentials", () => {
        template.hasResourceProperties("AWS::SecretsManager::Secret", {
            Name: "benchling-webhook/credentials",
            Description: "Benchling API credentials for webhook processor",
        });
    });

    test("creates task definition with correct container configuration", () => {
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
            Family: "benchling-webhook-task",
            Cpu: "1024",
            Memory: "2048",
            NetworkMode: "awsvpc",
            RequiresCompatibilities: ["FARGATE"],
        });
    });

    test("configures auto-scaling for Fargate service", () => {
        template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget", {
            MinCapacity: 2,
            MaxCapacity: 10,
            ServiceNamespace: "ecs",
        });

        // Check for CPU-based scaling policy
        template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalingPolicy", {
            PolicyType: "TargetTrackingScaling",
            TargetTrackingScalingPolicyConfiguration: {
                PredefinedMetricSpecification: {
                    PredefinedMetricType: "ECSServiceAverageCPUUtilization",
                },
                TargetValue: 70,
            },
        });

        // Check for memory-based scaling policy
        template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalingPolicy", {
            PolicyType: "TargetTrackingScaling",
            TargetTrackingScalingPolicyConfiguration: {
                PredefinedMetricSpecification: {
                    PredefinedMetricType: "ECSServiceAverageMemoryUtilization",
                },
                TargetValue: 80,
            },
        });
    });
});
