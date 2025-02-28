import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class BenchlingWebhookStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // 1. Reference the S3 Bucket (Assuming it already exists)
        const bucket = s3.Bucket.fromBucketName(this, 'TargetBucket', 'quilt-ernest-staging');

        // 2. Step Function Task to Write to S3
        const writeToS3Task = new tasks.CallAwsService(this, 'WriteToS3', {
            service: 's3',
            action: 'putObject',
            parameters: {
                Bucket: bucket.bucketName,
                Key: 'benchling_webhook_payload.json',
                Body: stepfunctions.JsonPath.stringAt('$')
            },
            iamResources: [bucket.arnForObjects('*')],
        });

        // 3. Create Step Function State Machine
        const stateMachine = new stepfunctions.StateMachine(this, 'BenchlingWebhookStateMachine', {
            definition: writeToS3Task,
            stateMachineType: stepfunctions.StateMachineType.STANDARD,
        });

        // 4. IAM Role for API Gateway to invoke Step Function
        const apiRole = new iam.Role(this, 'ApiGatewayStepFunctionsRole', {
            assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        });

        stateMachine.grantStartExecution(apiRole);

        // 5. Create API Gateway
        const api = new apigateway.RestApi(this, 'BenchlingWebhookAPI', {
            restApiName: 'BenchlingWebhookAPI',
            deployOptions: {
                stageName: 'prod',
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: true,
            },
        });

        // 6. Create API Resource and Method
        const sfnIntegration = new apigateway.AwsIntegration({
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

        const resource = api.root.addResource('benchling-webhook');
        resource.addMethod('POST', sfnIntegration, {
            methodResponses: [{ statusCode: '200' }]
        });

        // 7. Output API URL
        new cdk.CfnOutput(this, 'ApiUrl', {
            value: api.url,
        });
    }
}
