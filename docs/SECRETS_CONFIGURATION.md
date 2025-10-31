# Secrets Configuration Guide

**Version**: 0.6.0+
**Last Updated**: 2025-10-31

---

## Overview

The Benchling Webhook integration requires Benchling API credentials to authenticate with the Benchling API. Starting with version 0.6.0, we provide a unified secrets management approach that supports multiple deployment scenarios while maintaining security best practices.

### Key Features

- **Single Parameter**: Configure all secrets via one `--benchling-secrets` parameter
- **Multiple Formats**: Support ARN references and inline JSON
- **Secrets Manager Integration**: Automatic storage in AWS Secrets Manager
- **Security**: No plaintext secrets in CloudFormation or logs
- **Flexibility**: Works with standalone stacks and Quilt integration

---

## Quick Start

### Option 1: Inline JSON (Recommended for First Deployment)

```bash
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets '{
    "client_id": "your-client-id",
    "client_secret": "your-client-secret",
    "tenant": "your-tenant"
  }'
```

### Option 2: JSON File

Create `benchling-secrets.json`:
```json
{
  "client_id": "your-client-id",
  "client_secret": "your-client-secret",
  "tenant": "your-tenant",
  "app_definition_id": "your-app-id"
}
```

Deploy:
```bash
npx @quiltdata/benchling-webhook deploy --benchling-secrets @benchling-secrets.json
```

### Option 3: Existing Secret ARN

```bash
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-benchling-creds"
```

---

## Secret Format

### Required Fields

| Field | Description | Example |
|-------|-------------|---------|
| `client_id` | Benchling OAuth client ID | `abc123xyz` |
| `client_secret` | Benchling OAuth client secret | `secret_key_here` |
| `tenant` | Benchling tenant name | `mycompany` (for mycompany.benchling.com) |

### Optional Fields

| Field | Description | Default |
|-------|-------------|---------|
| `app_definition_id` | Benchling app definition ID | None |
| `api_url` | Custom Benchling API URL | `https://{tenant}.benchling.com` |

### Complete Example

```json
{
  "client_id": "abc123xyz",
  "client_secret": "secret_key_here",
  "tenant": "mycompany",
  "app_definition_id": "app_def_123",
  "api_url": "https://mycompany.benchling.com"
}
```

---

## Deployment Scenarios

### Scenario 1: Standalone Stack (First Time)

**Use Case**: Deploying Benchling webhook as a standalone service

**Steps**:
1. Create secrets configuration file
2. Deploy with `--benchling-secrets` parameter
3. Secret is automatically created in AWS Secrets Manager
4. ECS tasks retrieve secrets at runtime

**Commands**:
```bash
# Create secrets file
cat > benchling-secrets.json << EOF
{
  "client_id": "$BENCHLING_CLIENT_ID",
  "client_secret": "$BENCHLING_CLIENT_SECRET",
  "tenant": "$BENCHLING_TENANT"
}
EOF

# Deploy
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets @benchling-secrets.json \
  --catalog your-catalog.quiltdata.com

# Clean up secrets file (security)
rm benchling-secrets.json
```

**What Happens**:
- CLI validates secret structure
- CloudFormation creates/updates secret named `benchling-webhook/credentials`
- ECS tasks configured with IAM permissions to read secret
- Secret values injected as environment variables at runtime

---

### Scenario 2: Using Existing Secret ARN

**Use Case**: You already have Benchling secrets in AWS Secrets Manager

**Prerequisites**:
- Existing secret in AWS Secrets Manager
- Secret follows the required JSON format
- IAM permissions to read the secret

**Steps**:
1. Identify your secret ARN
2. Deploy with ARN reference
3. Stack references existing secret (does not create new one)

**Commands**:
```bash
# Get your secret ARN
aws secretsmanager describe-secret \
  --secret-id my-benchling-secret \
  --query 'ARN' \
  --output text

# Deploy with ARN
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-benchling-secret" \
  --catalog your-catalog.quiltdata.com
```

**Benefits**:
- Reuse existing secrets across multiple stacks
- Secret lifecycle managed independently of webhook stack
- Support secret rotation policies
- Centralized secret management

---

### Scenario 3: Environment Variable

**Use Case**: CI/CD pipelines, local development

**Steps**:
1. Set `BENCHLING_SECRETS` environment variable
2. Deploy without `--benchling-secrets` flag
3. CLI automatically uses environment variable

**Commands**:
```bash
# Set environment variable
export BENCHLING_SECRETS='{
  "client_id": "xxx",
  "client_secret": "yyy",
  "tenant": "mycompany"
}'

# Deploy
npx @quiltdata/benchling-webhook deploy
```

**Security Note**: Be careful with environment variables in shared environments. Use secret management tools (e.g., GitHub Secrets, AWS Systems Manager Parameter Store) for CI/CD.

---

### Scenario 4: Quilt Integration (Future)

**Status**: Planned for future release

**Use Case**: Webhook deployed alongside Quilt, automatically discovers Quilt's Benchling secrets

**How It Will Work**:
1. Deploy without `--benchling-secrets` parameter
2. CLI queries CloudFormation exports from Quilt stack
3. Discovers Benchling secret ARN from Quilt
4. References Quilt's secret (no duplication)

**Current Workaround**:
Manually specify Quilt's secret ARN:
```bash
# Get Quilt's secret ARN from CloudFormation exports
QUILT_SECRET_ARN=$(aws cloudformation list-exports \
  --query "Exports[?Name=='QuiltStack:BenchlingSecretArn'].Value" \
  --output text)

# Deploy with Quilt's secret
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets "$QUILT_SECRET_ARN"
```

---

## Configuration Priority

When multiple configuration sources are provided, the following priority order applies:

1. **Highest**: `--benchling-secrets` CLI flag
2. **Medium**: `BENCHLING_SECRETS` environment variable
3. **Lower**: `.env` file `BENCHLING_SECRETS=...`
4. **Lowest**: Individual legacy parameters (deprecated)

Example:
```bash
# This deployment uses CLI flag (highest priority)
export BENCHLING_SECRETS='{"client_id":"env","client_secret":"env","tenant":"env"}'

npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets '{"client_id":"cli","client_secret":"cli","tenant":"cli"}'
# Uses: {"client_id":"cli",...} from CLI flag
```

---

## Updating Secrets

### Method 1: Update Secret Value Directly (Recommended)

Update the secret in AWS Secrets Manager, then restart ECS tasks:

```bash
# Update secret value
aws secretsmanager update-secret \
  --secret-id benchling-webhook/credentials \
  --secret-string '{
    "client_id": "new_client_id",
    "client_secret": "new_client_secret",
    "tenant": "mycompany"
  }'

# Restart ECS service to pick up new values
aws ecs update-service \
  --cluster benchling-webhook-cluster \
  --service benchling-webhook-service \
  --force-new-deployment
```

**Advantages**:
- No CloudFormation stack update required
- Faster (only ECS restart, ~2-3 minutes)
- Lower risk (no infrastructure changes)
- Preserves secret versioning

### Method 2: Redeploy Stack

Redeploy with updated secrets parameter:

```bash
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets '{
    "client_id": "new_client_id",
    "client_secret": "new_client_secret",
    "tenant": "mycompany"
  }'
```

**When to Use**:
- Changing secret ARN reference
- First-time secret configuration
- Major configuration changes

---

## Security Best Practices

### 1. Never Commit Secrets to Version Control

❌ **Bad**:
```bash
# .env file committed to git
BENCHLING_SECRETS='{"client_id":"xxx","client_secret":"yyy","tenant":"zzz"}'
```

✅ **Good**:
```bash
# .env.template file (committed to git)
BENCHLING_SECRETS={"client_id":"your-client-id-here","client_secret":"your-client-secret-here","tenant":"your-tenant-here"}

# .env file (in .gitignore)
BENCHLING_SECRETS='{"client_id":"actual-id","client_secret":"actual-secret","tenant":"company"}'
```

### 2. Use AWS Secrets Manager for Production

✅ **Recommended**:
- Create secret in AWS Secrets Manager
- Reference by ARN in deployment
- Enable secret rotation
- Use IAM policies to control access

❌ **Avoid**:
- Hardcoding secrets in scripts
- Storing secrets in plaintext files long-term
- Sharing secrets via email or chat

### 3. Limit IAM Permissions

Grant ECS tasks minimal required permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:region:account:secret:benchling-webhook/credentials"
    }
  ]
}
```

### 4. Mask Secrets in Logs

The CLI automatically masks secret values in output:

```bash
$ npx @quiltdata/benchling-webhook deploy --benchling-secrets @secrets.json

✓ Validating Benchling secrets...
  Using Benchling secrets from JSON configuration
  Benchling Client Secret:  ***et123
```

Secret values are NEVER displayed in:
- CLI output
- CloudFormation templates (protected by `noEcho: true`)
- CloudWatch logs
- Stack outputs

### 5. Rotate Secrets Regularly

Enable AWS Secrets Manager rotation:

```bash
# Enable automatic rotation (requires Lambda function)
aws secretsmanager rotate-secret \
  --secret-id benchling-webhook/credentials \
  --rotation-lambda-arn arn:aws:lambda:region:account:function:rotation-function \
  --rotation-rules AutomaticallyAfterDays=30
```

**Note**: Secret rotation for Benchling credentials requires coordination with Benchling to generate new OAuth credentials. Current version does not include automatic rotation Lambda.

### 6. Audit Secret Access

Monitor secret access using CloudTrail:

```bash
# Query secret access events
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=benchling-webhook/credentials \
  --max-results 50
```

---

## Troubleshooting

### Error: "Invalid secret ARN format"

**Problem**: ARN validation failed

**Solution**:
- Verify ARN format: `arn:aws:secretsmanager:region:account:secret:name`
- Check region and account ID are correct
- Ensure secret name is correct

```bash
# Get correct ARN
aws secretsmanager describe-secret \
  --secret-id your-secret-name \
  --query 'ARN' \
  --output text
```

### Error: "Missing required field: client_id"

**Problem**: Secret JSON is missing required fields

**Solution**:
- Verify secret structure includes all required fields
- Check field names are exactly: `client_id`, `client_secret`, `tenant`
- Ensure JSON is valid (no syntax errors)

```bash
# Validate JSON locally
echo '{"client_id":"xxx","client_secret":"yyy","tenant":"zzz"}' | jq .
```

### Error: "Secret not found in AWS Secrets Manager"

**Problem**: Referenced secret ARN does not exist or not accessible

**Solution**:
1. Verify secret exists:
```bash
aws secretsmanager describe-secret --secret-id benchling-webhook/credentials
```

2. Check IAM permissions:
```bash
aws secretsmanager get-secret-value --secret-id benchling-webhook/credentials
```

3. Verify region matches stack region

### Error: "ResourceNotFoundException: Secrets Manager can't find the specified secret"

**Problem**: ECS task cannot access secret at runtime

**Solution**:
1. Check IAM task execution role has permissions
2. Verify secret ARN is correct in task definition
3. Check secret exists in the same region as ECS cluster

```bash
# Get task execution role
aws ecs describe-task-definition \
  --task-definition benchling-webhook-task \
  --query 'taskDefinition.executionRoleArn'

# Check role permissions
aws iam list-attached-role-policies --role-name ecsTaskExecutionRole
```

### Warning: "Individual secret parameters are deprecated"

**Problem**: Using old `--tenant`, `--client-id`, `--client-secret` parameters

**Solution**:
Migrate to `--benchling-secrets`:
```bash
# Old way (deprecated)
npx @quiltdata/benchling-webhook deploy \
  --tenant mycompany \
  --client-id xxx \
  --client-secret yyy

# New way (recommended)
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets '{"client_id":"xxx","client_secret":"yyy","tenant":"mycompany"}'
```

See [Migration Guide](#migration-guide) for detailed steps.

---

## Migration Guide

### Migrating from Individual Parameters

If you're currently using individual parameters (`--tenant`, `--client-id`, `--client-secret`), follow these steps to migrate:

#### Step 1: Extract Current Secrets

If secrets are in environment variables:
```bash
# Create JSON from env vars
cat > benchling-secrets.json << EOF
{
  "client_id": "$BENCHLING_CLIENT_ID",
  "client_secret": "$BENCHLING_CLIENT_SECRET",
  "tenant": "$BENCHLING_TENANT"
}
EOF
```

If secrets are in AWS Secrets Manager:
```bash
# Get existing secret value
aws secretsmanager get-secret-value \
  --secret-id benchling-webhook/credentials \
  --query 'SecretString' \
  --output text > benchling-secrets.json
```

#### Step 2: Validate Secret Format

```bash
# Validate JSON structure
npx @quiltdata/benchling-webhook validate --benchling-secrets @benchling-secrets.json
```

#### Step 3: Update Deployment

```bash
# Deploy with new parameter
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets @benchling-secrets.json
  # Remove old parameters: --tenant, --client-id, --client-secret
```

#### Step 4: Verify Deployment

```bash
# Check stack outputs
aws cloudformation describe-stacks \
  --stack-name BenchlingWebhookStack \
  --query 'Stacks[0].Outputs'

# Test webhook endpoint
curl https://your-webhook-url/health
```

#### Step 5: Clean Up

```bash
# Remove secrets file (security)
rm benchling-secrets.json

# Update documentation/scripts to use new parameter
```

### Migration Timeline

- **v0.6.x** (Current): Both old and new parameters supported, deprecation warnings shown
- **v0.7.x - v0.9.x**: Continued deprecation warnings, encourage migration
- **v1.0.x** (Future): Old parameters removed, only `--benchling-secrets` supported

**Action Required**: Migrate before v1.0.0 release

---

## API Reference

### CLI Parameter

```
--benchling-secrets <value>

Configure Benchling API credentials.

Accepts:
  - ARN: arn:aws:secretsmanager:region:account:secret:name
  - JSON: {"client_id":"...","client_secret":"...","tenant":"..."}
  - File: @path/to/secrets.json

Environment Variable:
  BENCHLING_SECRETS

Priority:
  CLI flag > Environment variable > .env file > Legacy parameters
```

### Environment Variables (Runtime)

ECS containers receive the following environment variables:

#### New Approach (v0.6.0+)
```bash
BENCHLING_SECRETS='{"client_id":"...","client_secret":"...","tenant":"..."}'
```

**OR** (when using Secrets Manager injection)
```bash
BENCHLING_CLIENT_ID=xxx        # Injected from Secrets Manager
BENCHLING_CLIENT_SECRET=yyy    # Injected from Secrets Manager
BENCHLING_TENANT=zzz            # From CloudFormation parameter
BENCHLING_APP_DEFINITION_ID=id # Injected from Secrets Manager (optional)
```

#### Legacy Approach (Deprecated)
```bash
BENCHLING_TENANT=company
BENCHLING_CLIENT_ID=xxx
BENCHLING_CLIENT_SECRET=yyy
BENCHLING_APP_DEFINITION_ID=id
```

---

## Advanced Topics

### Secret Rotation

**Current Status**: Manual rotation supported

**Process**:
1. Generate new Benchling OAuth credentials in Benchling admin console
2. Update secret in AWS Secrets Manager
3. Restart ECS service
4. Invalidate old credentials in Benchling

**Future Enhancement**: Automated rotation with Lambda function

### Multi-Environment Secrets

**Pattern**: Use separate secrets for dev/staging/prod

```bash
# Development
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-dev"

# Production
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-prod"
```

### Secret Sharing Across Stacks

Use the same secret ARN in multiple stacks:

```bash
# Create shared secret once
aws secretsmanager create-secret \
  --name benchling-shared-credentials \
  --secret-string '{...}'

# Reference in multiple deployments
npx @quiltdata/benchling-webhook deploy \
  --stack-name webhook-1 \
  --benchling-secrets "arn:aws:secretsmanager:...:benchling-shared-credentials"

npx @quiltdata/benchling-webhook deploy \
  --stack-name webhook-2 \
  --benchling-secrets "arn:aws:secretsmanager:...:benchling-shared-credentials"
```

### Cross-Region Secrets

AWS Secrets Manager secrets are region-specific. For cross-region deployments:

**Option 1**: Replicate secrets using AWS Secrets Manager replica
```bash
aws secretsmanager replicate-secret-to-regions \
  --secret-id benchling-webhook/credentials \
  --add-replica-regions Region=eu-west-1
```

**Option 2**: Create separate secrets per region
```bash
# US East
aws secretsmanager create-secret --region us-east-1 --name benchling-webhook/credentials --secret-string '{...}'

# EU West
aws secretsmanager create-secret --region eu-west-1 --name benchling-webhook/credentials --secret-string '{...}'
```

---

## FAQ

### Q: Can I use environment variables instead of Secrets Manager?

**A**: Yes, for local development. For production, AWS Secrets Manager is strongly recommended for security and audit compliance.

### Q: What happens if I provide both old and new parameters?

**A**: The new `--benchling-secrets` parameter takes precedence. A deprecation warning is displayed.

### Q: Can I change the secret name?

**A**: The secret name `benchling-webhook/credentials` is currently hardcoded. Custom secret names may be supported in future versions.

### Q: Does the secret need to be in the same AWS account?

**A**: Yes, currently the secret must be in the same AWS account and region as the ECS cluster.

### Q: How do I backup my secrets?

**A**: Use AWS Backup or export secrets to a secure backup location:
```bash
aws secretsmanager get-secret-value \
  --secret-id benchling-webhook/credentials \
  --query 'SecretString' \
  --output text > backup.json.gpg
```

### Q: Can I use AWS Systems Manager Parameter Store instead?

**A**: Not currently supported. AWS Secrets Manager is required for automatic encryption and rotation features.

---

## Support

### Documentation
- [Main README](../README.md)
- [Architecture Documentation](./ARCHITECTURE.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)

### Issues
- [GitHub Issues](https://github.com/quiltdata/benchling-webhook/issues)
- [Issue #156 - Secrets Manager Integration](https://github.com/quiltdata/benchling-webhook/issues/156)

### Security
- Report security vulnerabilities: security@quiltdata.com
- Do NOT include actual secrets in issue reports

---

**Document Version**: 1.0.0
**Software Version**: 0.6.0+
**Last Updated**: 2025-10-31
