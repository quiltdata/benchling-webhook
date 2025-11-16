# Testing Strategy - Secrets-Only Architecture

**Spec**: 156a-secrets-only
**Date**: 2025-10-31

## Overview

This document defines the testing strategy for the secrets-only architecture, covering both local mock testing (unchanged) and local Docker testing (new approach).

## Testing Modes

### Mode 1: Local Mock Testing (Unchanged)

**Purpose**: Fast unit and integration tests without AWS dependencies

**Approach**: Continue using existing test infrastructure with mocked AWS services

**Environment**: Jest test runner with mocked dependencies

**No Changes Required**: The test suite continues to work as-is by:
- Mocking AWS SDK clients (CloudFormation, Secrets Manager)
- Directly setting configuration values in test code
- Using `loadConfigForTesting()` helper for tests that need config

**Example Test**:
```typescript
import { ConfigResolver } from '../lib/utils/config-resolver';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CloudFormationClient,
  DescribeStacksCommand
} from '@aws-sdk/client-cloudformation';
import {
  SecretsManagerClient,
  GetSecretValueCommand
} from '@aws-sdk/client-secrets-manager';

describe('ConfigResolver', () => {
  const cfnMock = mockClient(CloudFormationClient);
  const smMock = mockClient(SecretsManagerClient);

  beforeEach(() => {
    cfnMock.reset();
    smMock.reset();
  });

  it('should resolve config from AWS', async () => {
    // Mock CloudFormation response
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [{
        Outputs: [
          { OutputKey: 'UserAthenaDatabaseName', OutputValue: 'test_db' },
          { OutputKey: 'PackagerQueueArn', OutputValue: 'J3456789012:queue' },
          { OutputKey: 'UserBucket', OutputValue: 'test-bucket' },
          { OutputKey: 'Catalog', OutputValue: 'test.catalog.com' }
        ]
      }]
    });

    // Mock Secrets Manager response
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        client_id: 'test-id',
        client_secret: 'test-secret',
        tenant: 'test-tenant',
        app_definition_id: 'test-app-id'
      })
    });

    // Test
    const resolver = new ConfigResolver();
    const config = await resolver.resolve({
      quiltStackArn: 'arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc',
      benchlingSecret: 'test-secret',
      mockCloudFormation: cfnMock as any,
      mockSecretsManager: smMock as any
    });

    expect(config.quiltDatabase).toBe('test_db');
    expect(config.benchlingClientId).toBe('test-id');
  });
});
```

### Mode 2: Local Docker Testing (New Approach)

**Purpose**: Test the actual container with real AWS services

**Approach**: Manually configure AWS resources, then run Docker container

**Prerequisites**:
1. AWS CLI configured with credentials
2. Docker installed
3. Access to create Secrets Manager secrets
4. Access to a Quilt CloudFormation stack (or create a test one)

## Local Docker Testing Setup

### Step 1: Create Test Secret in AWS Secrets Manager

Create a secret with your Benchling credentials:

```bash
aws secretsmanager create-secret \
  --name benchling-webhook-test \
  --description "Test secret for local Docker testing" \
  --secret-string '{
    "client_id": "your-benchling-client-id",
    "client_secret": "your-benchling-client-secret",
    "tenant": "your-tenant",
    "app_definition_id": "your-app-id"
  }' \
  --region us-east-1
```

**Output**:
```json
{
  "ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-webhook-test-AbCdEf",
  "Name": "benchling-webhook-test"
}
```

### Step 2: Identify Your Quilt Stack ARN

Find your Quilt CloudFormation stack:

```bash
# List stacks containing "Quilt" in name
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[?contains(StackName, `Quilt`)].{Name:StackName, ARN:StackId}' \
  --output table
```

**Example Output**:
```
--------------------------------------------------------------------------------------------------------
|                                              ListStacks                                              |
+-------------------------------------------+----------------------------------------------------------+
|                    Name                   |                           ARN                            |
+-------------------------------------------+----------------------------------------------------------+
|  QuiltStack                               |  arn:aws:cloudformation:us-east-1:123456789012:stack/... |
+-------------------------------------------+----------------------------------------------------------+
```

Copy the full Stack ARN from the output.

### Step 3: Verify Stack Outputs

Verify your Quilt stack has the required outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name QuiltStack \
  --query 'Stacks[0].Outputs[].{Key:OutputKey, Value:OutputValue}' \
  --output table
```

**Required Outputs**:
- `UserAthenaDatabaseName`
- `PackagerQueueArn`
- `UserBucket` (or `BucketName`)

**Optional Outputs**:
- `Catalog` (or `CatalogDomain`)
- `ApiGatewayEndpoint`

If any required outputs are missing, you'll need to update your Quilt stack or create a test stack.

### Step 4: Build Docker Image

Build the Docker image locally:

```bash
cd /path/to/benchling-webhook
docker build -t benchling-webhook:test .
```

### Step 5: Run Container with AWS Credentials

Run the container with the two required environment variables plus AWS credentials:

```bash
docker run --rm \
  -e QuiltStackARN='arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123' \
  -e BenchlingSecret='benchling-webhook-test' \
  -e AWS_REGION='us-east-1' \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -p 3000:3000 \
  benchling-webhook:test
```

**Expected Output**:
```
Resolving configuration from AWS...
✓ Configuration resolved successfully
  Region: us-east-1
  Catalog: my-catalog.company.com
  Database: quilt_my_catalog_db
  Queue: arn:aws:sqs:us-east-1:123456789012:QuiltStack-PackagerQueue
✓ Initialized Benchling client (tenant: mycompany)
✓ Initialized Quilt client (catalog: my-catalog.company.com)
✓ Connected to SQS queue
✓ Webhook server listening on port 3000
```

### Step 6: Test the Container

Test the health check endpoint:

```bash
curl http://localhost:3000/health
```

**Expected Response**:
```json
{
  "status": "healthy",
  "config": {
    "aws": {
      "region": "us-east-1",
      "account": "***9012"
    },
    "quilt": {
      "catalog": "my-catalog.company.com",
      "database": "quilt_my_catalog_db",
      "bucket": "my-user-bucket",
      "queueArn": "arn:aws:sqs:us-east-1:***:queue"
    },
    "benchling": {
      "tenant": "mycompany",
      "clientId": "***id",
      "hasClientSecret": true,
      "hasAppDefinitionId": true
    }
  }
}
```

### Step 7: Test Configuration Endpoint

Check the resolved configuration:

```bash
curl http://localhost:3000/config
```

This endpoint shows the full resolved configuration with secrets masked.

### Step 8: Cleanup

When done testing, delete the test secret:

```bash
aws secretsmanager delete-secret \
  --secret-id benchling-webhook-test \
  --force-delete-without-recovery
```

## Docker Testing Helpers

### Create Test Stack (Optional)

If you don't have a Quilt stack, create a minimal test stack for Docker testing:

**File**: `test/docker/test-stack.yaml`
```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: Minimal Quilt stack for testing benchling-webhook

Resources:
  TestQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: benchling-webhook-test-queue

  TestBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub 'benchling-webhook-test-${AWS::AccountId}'

Outputs:
  PackagerQueueArn:
    Description: SQS queue ARN for packager
    Value: !GetAtt TestQueue.Arn

  UserBucket:
    Description: S3 bucket for user data
    Value: !Ref TestBucket

  UserAthenaDatabaseName:
    Description: Athena database name
    Value: benchling_webhook_test_db

  Catalog:
    Description: Catalog domain
    Value: test.catalog.localhost
```

**Deploy Test Stack**:
```bash
aws cloudformation create-stack \
  --stack-name BenchlingWebhookTestStack \
  --template-body file://test/docker/test-stack.yaml \
  --region us-east-1
```

**Get Stack ARN**:
```bash
aws cloudformation describe-stacks \
  --stack-name BenchlingWebhookTestStack \
  --query 'Stacks[0].StackId' \
  --output text
```

### Docker Compose for Local Testing

**File**: `test/docker/docker-compose.yml`
```yaml
version: '3.8'

services:
  benchling-webhook:
    build:
      context: ../..
      dockerfile: Dockerfile
    environment:
      # Required
      QuiltStackARN: ${QUILT_STACK_ARN}
      BenchlingSecret: ${BENCHLING_SECRET}

      # AWS credentials (from host)
      AWS_REGION: ${AWS_REGION:-us-east-1}
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
      AWS_SESSION_TOKEN: ${AWS_SESSION_TOKEN:-}

    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
```

**Usage**:
```bash
# Set environment variables
export QUILT_STACK_ARN='arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/abc'
export BENCHLING_SECRET='benchling-webhook-test'

# Run with docker-compose
cd test/docker
docker-compose up
```

## Testing Checklist

### Pre-Implementation Testing

Before implementing the new architecture, verify:

- [ ] Current mock tests pass
- [ ] Current integration tests pass
- [ ] Test coverage is documented

### During Implementation Testing

As you implement, verify:

- [ ] Unit tests for `parseStackArn()` function
- [ ] Unit tests for `extractStackOutputs()` function
- [ ] Unit tests for `resolveAndFetchSecret()` function
- [ ] Unit tests for `ConfigResolver.resolve()` with mocked AWS clients
- [ ] Unit tests for error cases (invalid ARN, missing outputs, secret not found)

### Post-Implementation Testing

After implementation, verify:

- [ ] All mock tests still pass
- [ ] New ConfigResolver tests pass
- [ ] Test secret created in AWS Secrets Manager
- [ ] Test stack ARN identified
- [ ] Docker image builds successfully
- [ ] Docker container starts with 2 env vars
- [ ] Container resolves config from AWS
- [ ] `/health` endpoint returns success
- [ ] `/config` endpoint shows resolved config
- [ ] Container handles invalid QuiltStackARN gracefully
- [ ] Container handles invalid BenchlingSecret gracefully
- [ ] Container handles missing stack outputs gracefully

## Error Testing Scenarios

### Scenario 1: Invalid QuiltStackARN

```bash
docker run --rm \
  -e QuiltStackARN='invalid-arn' \
  -e BenchlingSecret='test-secret' \
  benchling-webhook:test
```

**Expected**:
```
❌ Configuration Error: Invalid CloudFormation stack ARN format
   💡 ARN must match: arn:aws:cloudformation:region:account:stack/name/id
   ℹ️  Received: invalid-arn
```

### Scenario 2: Stack Not Found

```bash
docker run --rm \
  -e QuiltStackARN='arn:aws:cloudformation:us-east-1:123456789012:stack/NonExistent/abc' \
  -e BenchlingSecret='test-secret' \
  benchling-webhook:test
```

**Expected**:
```
❌ Configuration Error: Stack not found: NonExistent
   💡 Ensure the CloudFormation stack exists and is accessible
```

### Scenario 3: Missing Stack Outputs

Test with a stack that's missing required outputs.

**Expected**:
```
❌ Configuration Error: Missing required CloudFormation outputs: UserAthenaDatabaseName, PackagerQueueArn
   💡 Ensure your Quilt stack exports these outputs
   ℹ️  Available outputs: SomeOtherOutput, AnotherOutput
```

### Scenario 4: Secret Not Found

```bash
docker run --rm \
  -e QuiltStackARN='arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/abc' \
  -e BenchlingSecret='non-existent-secret' \
  benchling-webhook:test
```

**Expected**:
```
❌ Configuration Error: Secret not found: non-existent-secret
   💡 Ensure the secret exists in AWS Secrets Manager and is accessible
   ℹ️  Region: us-east-1
```

### Scenario 5: Invalid Secret Structure

Create a secret with invalid structure and test:

```bash
aws secretsmanager create-secret \
  --name invalid-secret \
  --secret-string '{"incomplete": "data"}'
```

**Expected**:
```
❌ Configuration Error: Invalid secret structure
   💡 client_id: Missing required field; client_secret: Missing required field; tenant: Missing required field
```

## Test Coverage Goals

- **Unit Tests**: 90%+ coverage for config-resolver.ts
- **Integration Tests**: All AWS interaction paths tested with mocks
- **Error Tests**: All error scenarios covered
- **Docker Tests**: Manual smoke tests documented

## Documentation for Users

Create user-facing documentation:

**File**: `docs/local-docker-testing.md`
- Step-by-step setup guide
- Screenshots of expected output
- Troubleshooting common issues
- FAQ section

## Summary

The testing strategy ensures:

✅ **Mock tests unchanged**: Existing test suite continues to work
✅ **Docker tests simplified**: Only 2 env vars + AWS credentials
✅ **Error handling tested**: All failure scenarios covered
✅ **Documentation provided**: Clear setup instructions
✅ **Reproducible**: Test stack template provided

Next: Create implementation plan → `05-implementation-plan.md`
