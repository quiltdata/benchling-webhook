import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as BenchlingWebhook from '../lib/benchling-webhook-stack';

describe('BenchlingWebhookStack', () => {
  let app: cdk.App;
  let stack: BenchlingWebhook.BenchlingWebhookStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new BenchlingWebhook.BenchlingWebhookStack(app, 'TestStack', {
      bucketName: 'test-bucket',
      environment: 'test',
      prefix: 'test/benchling-webhook',
      queueName: 'test-queue'
    });
    template = Template.fromStack(stack);
  });

  test('creates API Gateway with correct configuration', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'BenchlingWebhookAPI'
    });

    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: 'prod',
      MethodSettings: [{
        LoggingLevel: 'INFO',
        DataTraceEnabled: true,
        HttpMethod: '*',
        ResourcePath: '/*'
      }]
    });

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
      AuthorizationType: 'NONE',
      Integration: {
        IntegrationHttpMethod: 'POST',
        Type: 'AWS',
        Uri: {
          'Fn::Join': [
            '',
            [
              'arn:',
              { 'Ref': 'AWS::Partition' },
              ':apigateway:',
              { 'Ref': 'AWS::Region' },
              ':states:action/StartExecution'
            ]
          ]
        },
        RequestTemplates: {
          'application/json': {
            'Fn::Join': [
              '',
              [
                Match.stringLikeRegexp('.*"stateMachineArn".*'),
                { 'Ref': 'BenchlingWebhookStateMachine177934B3' },
                Match.stringLikeRegexp('.*"input".*\\$input\\.json\\(\'\\$\'\\).*')
              ]
            ]
          }
        }
      }
    });
  });

  test('creates Step Function with correct configuration', () => {
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineType: 'STANDARD',
      LoggingConfiguration: Match.objectLike({
        Level: 'ALL'
      })
    });
  });

  test('creates IAM role with correct permissions', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: 'apigateway.amazonaws.com'
            }
          })
        ])
      })
    });

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'states:StartExecution',
            Effect: 'Allow'
          })
        ])
      })
    });
  });

  test('creates CloudWatch log groups', () => {
    template.resourceCountIs('AWS::Logs::LogGroup', 2); // One for API Gateway, one for Step Functions
  });

  test('creates output for API URL', () => {
    template.hasOutput('ApiUrl', {});
  });
});
