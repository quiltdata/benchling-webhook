import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as logs from 'aws-cdk-lib/aws-logs';

export class BenchlingWebhookStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // 1. Reference the S3 Bucket (Assuming it already exists)
        const bucket: s3.IBucket = s3.Bucket.fromBucketName(this, 'TargetBucket', 'quilt-ernest-staging');

        // 2. Step Function Task to Write to S3
        const writeToS3Task: tasks.CallAwsService = new tasks.CallAwsService(this, 'WriteToS3', {
            service: 's3',
            action: 'putObject',
            parameters: {
                Bucket: bucket.bucketName,
                Key: 'test/benchling-webhook/api_payload.json',
            },
            iamResources: [bucket.arnForObjects('*')],
        });

        // 3. Create Step Function State Machine
        const stateMachine: stepfunctions.StateMachine = new stepfunctions.StateMachine(this, 'BenchlingWebhookStateMachine', {
            definitionBody: stepfunctions.DefinitionBody.fromChainable(writeToS3Task),
            stateMachineType: stepfunctions.StateMachineType.STANDARD,
        });

        // 4. IAM Role for API Gateway to invoke Step Function
        const logGroup: logs.LogGroup = new logs.LogGroup(this, 'ApiGatewayAccessLogs');

        const logRole: iam.Role = new iam.Role(this, 'ApiGatewayLogsRole', {
            assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs')
            ]
        });

        const apiRole: iam.Role = new iam.Role(this, 'ApiGatewayStepFunctionsRole', {
            assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaRole')
            ]
        });

        stateMachine.grantStartExecution(apiRole);

        // 5. Create API Gateway
        const api: apigateway.RestApi = new apigateway.RestApi(this, 'BenchlingWebhookAPI', {
            restApiName: 'BenchlingWebhookAPI',
            deployOptions: {
                stageName: 'prod',
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: true,
            },
        });

        // 6. Create API Resource and Method
        const sfnIntegration: apigateway.AwsIntegration = new apigateway.AwsIntegration({
            service: 'states',
            action: 'StartExecution',
            integrationHttpMethod: 'POST',
            options: {
                credentialsRole: apiRole,
                requestTemplates: {
                    'application/json': `{
                        "stateMachineArn": "${stateMachine.stateMachineArn}",
                        "input": "$util.escapeJavaScript($input.body)"
                    }`
                },
                integrationResponses: [{ statusCode: '200' }]
            }
        });

        const resource: apigateway.Resource = api.root.addResource('benchling-webhook');
        resource.addMethod('POST', sfnIntegration, {
            methodResponses: [{ statusCode: '200' }]
        });

        // 7. Output API URL
        new cdk.CfnOutput(this, 'ApiUrl', {
            value: api.url,
        });
    }
}
