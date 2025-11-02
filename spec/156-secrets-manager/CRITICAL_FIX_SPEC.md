# Critical Fix Spec - Complete Secrets Manager Migration

**Date**: 2025-10-31
**Issue**: #156 - Secrets Manager Implementation Incomplete
**Severity**: CRITICAL - Blocks production deployment
**Status**: DRAFT - Awaiting Approval

---

## Problem Statement

### Current Flawed Design

The current implementation has a **fundamental architectural flaw**:

1. **Incomplete Secret Storage**: Only stores `client_id`, `client_secret`, and (sometimes) `tenant` in Secrets Manager
2. **Environment Variable Dependency**: Production deployments still rely on CloudFormation parameters passed as environment variables
3. **No Dynamic Updates**: Cannot update configuration without redeploying the CloudFormation stack
4. **Inconsistent Behavior**: Different code paths store different subsets of configuration

### What Was Promised

From `spec/156-secrets-manager/01-requirements.md`:
> "All Benchling credentials and configuration should be stored in AWS Secrets Manager"

### What Was Delivered

- ❌ Only 2-3 fields stored in Secrets Manager
- ❌ Most configuration still in environment variables
- ❌ No dynamic update capability
- ❌ Different behavior between new and legacy paths

---

## Root Cause Analysis

### Architecture Problem #1: Split Configuration

**Current State**:
```
Secrets Manager Secret:
  - client_id
  - client_secret
  - (maybe) tenant

Environment Variables (from CloudFormation):
  - BENCHLING_TENANT
  - QUILT_CATALOG
  - QUILT_DATABASE
  - QUEUE_ARN
  - PACKAGE_PREFIX
  - PACKAGE_KEY
  - LOG_LEVEL
  - ... 10+ more
```

**Problem**: Configuration is split between Secrets Manager and environment variables, defeating the purpose of Secrets Manager.

### Architecture Problem #2: Container Expects Environment Variables

**File**: `app/config.py` (Python application)

The container application reads configuration from environment variables:
- `BENCHLING_TENANT`
- `BENCHLING_CLIENT_ID`
- `BENCHLING_CLIENT_SECRET`
- `BENCHLING_APP_DEFINITION_ID`
- `QUILT_CATALOG`
- etc.

**Problem**: Even if we store everything in Secrets Manager, the container needs environment variables, so we have to extract and set them.

### Architecture Problem #3: CloudFormation Parameter Approach

**Current Design**:
```
CLI → CloudFormation Parameters → CDK → Secrets Manager Secret + Environment Variables
```

**Problem**: CloudFormation parameters are immutable after deployment, so we pass everything as parameters and then split them.

---

## Desired Architecture

### Goal: Single Source of Truth

```
┌─────────────────────────────────────────────────────────────┐
│                   AWS Secrets Manager                       │
│                                                             │
│  Secret: benchling-webhook/credentials                     │
│  {                                                          │
│    "client_id": "...",                                      │
│    "client_secret": "...",                                  │
│    "tenant": "...",                                         │
│    "app_definition_id": "...",                             │
│    "api_url": "https://...",                               │
│  }                                                          │
│                                                             │
│  Secret: benchling-webhook/config                          │
│  {                                                          │
│    "quilt_catalog": "...",                                  │
│    "quilt_database": "...",                                 │
│    "quilt_user_bucket": "...",                             │
│    "queue_arn": "...",                                      │
│    "package_prefix": "...",                                 │
│    "package_key": "...",                                    │
│    "log_level": "INFO",                                     │
│    "webhook_allow_list": "",                                │
│    "enable_webhook_verification": true                      │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                          ↓
                  ┌──────────────┐
                  │ ECS Task     │
                  │ (Container)  │
                  └──────────────┘
                          ↓
            Read secrets at runtime
            Parse and set environment variables
            Application runs with full config
```

### Benefits

1. **Dynamic Updates**: Update secrets in AWS, restart container, no CloudFormation redeployment
2. **Single Source of Truth**: All configuration in Secrets Manager
3. **Centralized Management**: Use AWS Secrets Manager console/CLI to manage all config
4. **Secret Rotation**: Support automatic rotation for sensitive values
5. **Audit Trail**: CloudTrail logs all secret access and modifications
6. **Separation of Concerns**: Deployment (infrastructure) separate from configuration (secrets)

---

## Proposed Solution

### Phase 1: Separate Secrets into Two Categories

#### Secret 1: Benchling Credentials (Sensitive)
**Name**: `benchling-webhook/credentials`
**Purpose**: Authentication credentials
**Rotation**: Supported
**Contents**:
```json
{
  "client_id": "wqFfVOhbYe",
  "client_secret": "6NUPNtpWP7fXY-n-Vvoc-A",
  "tenant": "quilt-dtt",
  "app_definition_id": "appdef_wqFfaXBVMu",
  "api_url": "https://quilt-dtt.benchling.com"
}
```

#### Secret 2: Application Configuration (Non-sensitive but dynamic)
**Name**: `benchling-webhook/config`
**Purpose**: Runtime configuration
**Rotation**: Not needed (non-sensitive)
**Contents**:
```json
{
  "quilt_catalog": "nightly.quilttest.com",
  "quilt_database": "userathenadatabase-mbq1ihawbzb7",
  "quilt_user_bucket": "quilt-example-bucket",
  "queue_arn": "arn:aws:sqs:us-east-1:712023778557:quilt-staging-PackagerQueue-d5NmglefXjDn",
  "package_prefix": "benchling-docker",
  "package_key": "experiment_id",
  "log_level": "INFO",
  "webhook_allow_list": "",
  "enable_webhook_verification": "true"
}
```

### Phase 2: Container Startup Process

**New Container Entrypoint**:
```python
#!/usr/bin/env python3
# app/entrypoint.py

import os
import sys
import json
import boto3
from botocore.exceptions import ClientError

def load_secrets():
    """Load all configuration from Secrets Manager"""
    secrets_client = boto3.client('secretsmanager', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

    # 1. Load Benchling credentials
    credentials_secret_name = os.environ.get('BENCHLING_CREDENTIALS_SECRET', 'benchling-webhook/credentials')
    try:
        response = secrets_client.get_secret_value(SecretId=credentials_secret_name)
        credentials = json.loads(response['SecretString'])
    except ClientError as e:
        print(f"ERROR: Failed to load credentials from {credentials_secret_name}: {e}", file=sys.stderr)
        sys.exit(1)

    # 2. Load application configuration
    config_secret_name = os.environ.get('APP_CONFIG_SECRET', 'benchling-webhook/config')
    try:
        response = secrets_client.get_secret_value(SecretId=config_secret_name)
        config = json.loads(response['SecretString'])
    except ClientError as e:
        print(f"ERROR: Failed to load config from {config_secret_name}: {e}", file=sys.stderr)
        sys.exit(1)

    # 3. Merge and validate
    all_config = {**credentials, **config}

    # 4. Validate required fields
    required_fields = [
        'client_id', 'client_secret', 'tenant',
        'quilt_catalog', 'quilt_database', 'quilt_user_bucket', 'queue_arn'
    ]
    missing = [f for f in required_fields if f not in all_config]
    if missing:
        print(f"ERROR: Missing required configuration fields: {missing}", file=sys.stderr)
        sys.exit(1)

    # 5. Set environment variables for application
    env_mapping = {
        'client_id': 'BENCHLING_CLIENT_ID',
        'client_secret': 'BENCHLING_CLIENT_SECRET',
        'tenant': 'BENCHLING_TENANT',
        'app_definition_id': 'BENCHLING_APP_DEFINITION_ID',
        'api_url': 'BENCHLING_API_URL',
        'quilt_catalog': 'QUILT_CATALOG',
        'quilt_database': 'QUILT_DATABASE',
        'quilt_user_bucket': 'QUILT_USER_BUCKET',
        'queue_arn': 'QUEUE_ARN',
        'package_prefix': 'PACKAGE_PREFIX',
        'package_key': 'PACKAGE_KEY',
        'log_level': 'LOG_LEVEL',
        'webhook_allow_list': 'WEBHOOK_ALLOW_LIST',
        'enable_webhook_verification': 'ENABLE_WEBHOOK_VERIFICATION',
    }

    for secret_key, env_var in env_mapping.items():
        if secret_key in all_config:
            os.environ[env_var] = str(all_config[secret_key])

    print("✓ Configuration loaded from Secrets Manager", file=sys.stderr)
    return all_config

if __name__ == '__main__':
    # Load secrets and set environment variables
    config = load_secrets()

    # Import and start the Flask application
    from app import create_app
    app = create_app()

    # Run with gunicorn or Flask dev server
    import gunicorn.app.base

    class StandaloneApplication(gunicorn.app.base.BaseApplication):
        def __init__(self, app, options=None):
            self.options = options or {}
            self.application = app
            super().__init__()

        def load_config(self):
            for key, value in self.options.items():
                self.cfg.set(key.lower(), value)

        def load(self):
            return self.application

    options = {
        'bind': '0.0.0.0:5000',
        'workers': 2,
        'worker_class': 'sync',
        'timeout': 120,
        'loglevel': config.get('log_level', 'info').lower(),
    }

    StandaloneApplication(app, options).run()
```

### Phase 3: ECS Task Definition Changes

**Remove**: Individual secret mappings for each field
**Add**: Only two environment variables:
- `BENCHLING_CREDENTIALS_SECRET=benchling-webhook/credentials`
- `APP_CONFIG_SECRET=benchling-webhook/config`
- `AWS_REGION=us-east-1`

**IAM Permissions**: Grant access to both secrets
```json
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue"
  ],
  "Resource": [
    "arn:aws:secretsmanager:us-east-1:*:secret:benchling-webhook/credentials-*",
    "arn:aws:secretsmanager:us-east-1:*:secret:benchling-webhook/config-*"
  ]
}
```

### Phase 4: CDK Stack Simplification

**Key Change**: Stack creates secrets but doesn't need to inject individual fields

```typescript
// lib/fargate-service.ts

// Create credentials secret
const credentialsSecret = new secretsmanager.Secret(this, "BenchlingCredentials", {
    secretName: "benchling-webhook/credentials",
    description: "Benchling API credentials",
    secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({
            client_id: props.benchlingClientId,
            client_secret: props.benchlingClientSecret,
            tenant: props.benchlingTenant,
            ...(props.benchlingAppDefinitionId && {
                app_definition_id: props.benchlingAppDefinitionId
            }),
            ...(props.benchlingApiUrl && {
                api_url: props.benchlingApiUrl
            }),
        })
    ),
});

// Create config secret
const configSecret = new secretsmanager.Secret(this, "AppConfig", {
    secretName: "benchling-webhook/config",
    description: "Application runtime configuration",
    secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({
            quilt_catalog: props.quiltCatalog,
            quilt_database: props.quiltDatabase,
            quilt_user_bucket: props.bucket.bucketName,
            queue_arn: props.queueArn,
            package_prefix: props.prefix,
            package_key: props.pkgKey,
            log_level: props.logLevel || "INFO",
            webhook_allow_list: props.webhookAllowList || "",
            enable_webhook_verification: props.enableWebhookVerification || "true",
        })
    ),
});

// Grant read access
credentialsSecret.grantRead(taskRole);
configSecret.grantRead(taskRole);

// Container definition - ONLY pass secret names
const container = taskDefinition.addContainer("WebhookContainer", {
    image: ecs.ContainerImage.fromEcrRepository(props.ecrRepository, props.imageTag),
    logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "benchling-webhook",
        logGroup: this.logGroup,
    }),
    environment: {
        // ONLY these three environment variables
        BENCHLING_CREDENTIALS_SECRET: "benchling-webhook/credentials",
        APP_CONFIG_SECRET: "benchling-webhook/config",
        AWS_REGION: props.region,
    },
    // NO secrets mapping - container loads them directly
});
```

---

## Implementation Plan

### Step 1: Create Container Entrypoint Script

**Priority**: P0 - Critical
**File**: `app/entrypoint.py`
**Effort**: 2-3 hours

Tasks:
- [ ] Create `app/entrypoint.py` with secrets loading logic
- [ ] Add boto3 to Python dependencies if not present
- [ ] Add validation for required fields
- [ ] Add error handling and logging
- [ ] Test locally with mock secrets

### Step 2: Update Dockerfile

**Priority**: P0 - Critical
**File**: `Dockerfile`
**Effort**: 30 minutes

Tasks:
- [ ] Update `CMD` to use `python app/entrypoint.py` instead of direct Flask
- [ ] Or update `ENTRYPOINT` if using gunicorn wrapper
- [ ] Ensure boto3 is installed
- [ ] Test Docker build

### Step 3: Update CDK Stack

**Priority**: P0 - Critical
**Files**:
- `lib/fargate-service.ts`
- `lib/benchling-webhook-stack.ts`
**Effort**: 2-3 hours

Tasks:
- [ ] Create two secrets instead of one
- [ ] Add `benchlingAppDefinitionId` prop to `FargateServiceProps`
- [ ] Build complete credentials JSON
- [ ] Build complete config JSON
- [ ] Simplify container environment variables (only 3)
- [ ] Remove individual secret mappings from ECS
- [ ] Update IAM permissions for both secrets
- [ ] Test CDK synthesis

### Step 4: Update CLI

**Priority**: P0 - Critical
**Files**: `bin/commands/deploy.ts`
**Effort**: 1 hour

Tasks:
- [ ] Ensure all parameters are collected (including app_definition_id)
- [ ] Pass all parameters to CDK stack
- [ ] Update deployment plan display
- [ ] Test with both new and legacy parameters

### Step 5: Add Validation

**Priority**: P1 - High
**File**: `app/config.py`
**Effort**: 1-2 hours

Tasks:
- [ ] Add startup validation that secrets were loaded
- [ ] Add health check endpoint that validates config completeness
- [ ] Log which secrets were loaded at startup
- [ ] Add metrics for secret loading failures

### Step 6: Testing

**Priority**: P0 - Critical
**Effort**: 3-4 hours

Tasks:
- [ ] Unit test for entrypoint.py
- [ ] Integration test for secret loading
- [ ] End-to-end deployment test
- [ ] Test secret updates without redeployment
- [ ] Test with missing secrets (should fail gracefully)
- [ ] Test with incomplete secrets (should fail with clear error)

### Step 7: Documentation

**Priority**: P1 - High
**Effort**: 2-3 hours

Tasks:
- [ ] Update `docs/SECRETS_CONFIGURATION.md` with new architecture
- [ ] Document two-secret approach
- [ ] Add example of updating secrets dynamically
- [ ] Update troubleshooting guide
- [ ] Add section on secret structure validation
- [ ] Update migration guide

### Step 8: Migration Strategy

**Priority**: P1 - High
**Effort**: 1-2 hours

Tasks:
- [ ] Document migration for existing deployments
- [ ] Provide script to migrate from old format to new format
- [ ] Test migration on existing stack
- [ ] Document rollback procedure

---

## Benefits of This Approach

### 1. True Dynamic Configuration
```bash
# Update configuration without redeployment
aws secretsmanager update-secret \
  --secret-id benchling-webhook/config \
  --secret-string '{"quilt_catalog":"new-catalog.com","log_level":"DEBUG",...}'

# Restart ECS tasks to pick up new config
aws ecs update-service \
  --cluster benchling-webhook-cluster \
  --service benchling-webhook-service \
  --force-new-deployment
```

### 2. Simplified Deployment
```bash
# Only need to specify secrets, not every parameter
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets arn:aws:secretsmanager:us-east-1:123:secret:benchling-webhook/credentials \
  --app-config arn:aws:secretsmanager:us-east-1:123:secret:benchling-webhook/config
```

### 3. Secret Rotation Support
```python
# Enable automatic rotation for credentials
aws secretsmanager rotate-secret \
  --secret-id benchling-webhook/credentials \
  --rotation-lambda-arn arn:aws:lambda:us-east-1:123:function:rotate-benchling-creds
```

### 4. Centralized Management
- All configuration in one place (Secrets Manager)
- Use AWS Console or CLI to manage
- CloudTrail audit trail for all changes
- IAM-based access control

### 5. Environment Parity
- Dev, staging, prod use same code
- Only difference is secret ARNs
- No environment-specific parameters in CloudFormation

---

## Migration Path for Existing Deployments

### Option 1: In-Place Migration (Recommended)

1. **Create new `config` secret**:
```bash
aws secretsmanager create-secret \
  --name benchling-webhook/config \
  --secret-string "$(aws cloudformation describe-stacks \
    --stack-name BenchlingWebhookStack \
    --query 'Stacks[0].Parameters' | jq -r 'to_entries | map({(.key): .value}) | add | @json')"
```

2. **Update existing `credentials` secret** to include all fields:
```bash
aws secretsmanager update-secret \
  --secret-id benchling-webhook/credentials \
  --secret-string '{
    "client_id": "...",
    "client_secret": "...",
    "tenant": "...",
    "app_definition_id": "..."
  }'
```

3. **Deploy updated stack** with new container image
4. **Verify** secrets are loaded correctly
5. **Clean up** old CloudFormation parameters in next deployment

### Option 2: Blue-Green Deployment

1. Create new stack with new approach
2. Test thoroughly
3. Switch traffic
4. Delete old stack

---

## Testing Strategy

### Unit Tests

```python
# test/test_entrypoint.py
import pytest
from unittest.mock import Mock, patch
from app.entrypoint import load_secrets

def test_load_secrets_success():
    """Test successful secret loading"""
    mock_client = Mock()
    mock_client.get_secret_value.side_effect = [
        {'SecretString': '{"client_id":"test","client_secret":"secret","tenant":"t"}'},
        {'SecretString': '{"quilt_catalog":"cat","quilt_database":"db","queue_arn":"arn"}'},
    ]

    with patch('boto3.client', return_value=mock_client):
        config = load_secrets()
        assert config['client_id'] == 'test'
        assert config['quilt_catalog'] == 'cat'

def test_load_secrets_missing_credentials():
    """Test failure when credentials secret is missing"""
    mock_client = Mock()
    mock_client.get_secret_value.side_effect = ClientError(
        {'Error': {'Code': 'ResourceNotFoundException'}}, 'GetSecretValue'
    )

    with patch('boto3.client', return_value=mock_client):
        with pytest.raises(SystemExit):
            load_secrets()

def test_load_secrets_missing_required_field():
    """Test failure when required field is missing"""
    mock_client = Mock()
    mock_client.get_secret_value.side_effect = [
        {'SecretString': '{"client_id":"test","client_secret":"secret"}'},  # missing tenant
        {'SecretString': '{"quilt_catalog":"cat"}'},
    ]

    with patch('boto3.client', return_value=mock_client):
        with pytest.raises(SystemExit):
            load_secrets()
```

### Integration Tests

```typescript
// test/integration/secrets-loading.test.ts
describe('Secrets Loading Integration', () => {
  it('should load all configuration from Secrets Manager', async () => {
    // 1. Deploy stack
    // 2. Verify secrets exist
    // 3. Start container
    // 4. Check container logs for successful loading
    // 5. Hit health endpoint
    // 6. Verify all config is present
  });

  it('should fail gracefully with incomplete secrets', async () => {
    // 1. Create incomplete secret
    // 2. Start container
    // 3. Verify container exits with error
    // 4. Check error message is clear
  });

  it('should support dynamic config updates', async () => {
    // 1. Deploy with initial config
    // 2. Update config secret
    // 3. Restart container
    // 4. Verify new config is loaded
  });
});
```

---

## Rollback Plan

### If New Approach Fails

1. **Revert Docker Image**: Deploy previous image version
2. **Revert CDK Stack**: `cdk deploy` with previous version
3. **Keep Secrets**: New secrets don't break old code
4. **Time to Rollback**: ~5-10 minutes

### Rollback Testing

- [ ] Test rollback procedure in development
- [ ] Document rollback steps
- [ ] Verify old stack works with new secrets present

---

## Success Criteria

### Functional Requirements

- [ ] All configuration loaded from Secrets Manager at runtime
- [ ] No CloudFormation parameters except secret ARNs
- [ ] Support dynamic config updates without redeployment
- [ ] Graceful failure with clear error messages
- [ ] Health check validates configuration completeness

### Non-Functional Requirements

- [ ] Container startup time increase <500ms
- [ ] No impact on request latency
- [ ] Secrets retrieved securely (IAM + encryption)
- [ ] All tests passing (unit + integration)
- [ ] Documentation complete

### Security Requirements

- [ ] No secrets in CloudFormation templates
- [ ] No secrets in container environment variables
- [ ] Secrets retrieved via IAM role
- [ ] CloudTrail audit trail
- [ ] No secrets in logs

---

## Estimated Effort

| Task | Effort | Priority |
|------|--------|----------|
| Container entrypoint | 2-3 hours | P0 |
| Update Dockerfile | 30 min | P0 |
| Update CDK stack | 2-3 hours | P0 |
| Update CLI | 1 hour | P0 |
| Add validation | 1-2 hours | P1 |
| Testing | 3-4 hours | P0 |
| Documentation | 2-3 hours | P1 |
| Migration guide | 1-2 hours | P1 |
| **Total** | **13-19 hours** | |

**Estimated Timeline**: 2-3 days (with testing)

---

## Risks and Mitigations

### Risk 1: Breaking Existing Deployments

**Likelihood**: High
**Impact**: High
**Mitigation**:
- Maintain backward compatibility in first release
- Provide migration script
- Test migration thoroughly
- Document rollback procedure

### Risk 2: Container Startup Failures

**Likelihood**: Medium
**Impact**: High
**Mitigation**:
- Add retry logic for secret retrieval
- Implement health checks
- Add detailed error logging
- Test with various failure scenarios

### Risk 3: Performance Impact

**Likelihood**: Low
**Impact**: Medium
**Mitigation**:
- Cache secrets in memory after loading
- Optimize boto3 calls
- Measure startup time impact
- Set reasonable timeouts

---

## Approval Required

**This spec requires approval before implementation due to:**

1. **Architecture Change**: Fundamental shift in configuration management
2. **Breaking Change**: Requires container image update
3. **Migration Required**: Existing deployments need migration
4. **Resource Impact**: New secret, IAM permissions changes
5. **Timeline Impact**: 2-3 days of development

**Approvers**:
- [ ] Technical Lead
- [ ] Product Owner
- [ ] Security Team
- [ ] DevOps Team

---

## Next Steps

1. **Review and Approve Spec**: Team review and sign-off
2. **Implement in Branch**: Create feature branch for implementation
3. **Test Thoroughly**: Unit, integration, and end-to-end testing
4. **Update Documentation**: Complete user and developer docs
5. **Migration Testing**: Test migration on existing deployments
6. **Deploy to Dev**: Deploy and validate in development environment
7. **Deploy to Staging**: Deploy and validate in staging environment
8. **Production Deployment**: Coordinate production deployment

---

**Status**: 📋 **AWAITING APPROVAL**
**Author**: AI Code Assistant
**Date**: 2025-10-31
**Review By**: 2025-11-01

