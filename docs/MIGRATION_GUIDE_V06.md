# Migration Guide: v0.5.x → v0.6.0

This guide helps you migrate from v0.5.x to v0.6.0 with the new **secrets-only mode**.

## What's New in v0.6.0

### Secrets-Only Mode (Recommended)

Instead of providing 10+ configuration parameters, you now only need **2 parameters**:

```bash
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc123" \
  --benchling-secret "my-benchling-credentials"
```

All other configuration is automatically resolved from AWS:
- ✅ Quilt catalog URL → from CloudFormation outputs
- ✅ S3 bucket → from CloudFormation outputs
- ✅ Athena database → from CloudFormation outputs
- ✅ SQS queue ARN → from CloudFormation outputs
- ✅ Benchling credentials → from AWS Secrets Manager
- ✅ AWS region/account → from stack ARN

### Benefits

- **Simpler deployments**: Reduce configuration from 10+ to 2 parameters
- **Centralized secrets**: Store Benchling credentials in AWS Secrets Manager
- **Automatic sync**: Configuration updates when your infrastructure changes
- **Better security**: No secrets in CI/CD pipelines or command history
- **Easier maintenance**: Update secrets in one place

## Migration Path

### Step 1: Find Your Quilt Stack ARN

Get the ARN of your existing Quilt CloudFormation stack:

```bash
# Option 1: Using AWS CLI
aws cloudformation describe-stacks \
  --query 'Stacks[?contains(StackName, `Quilt`)].StackId' \
  --output text

# Option 2: From AWS Console
# Navigate to CloudFormation → Stacks → Select your Quilt stack → Stack info → ARN
```

The ARN should look like:
```
arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123-def-456
```

### Step 2: Create AWS Secrets Manager Secret

Store your Benchling credentials in AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name benchling-webhook-credentials \
  --description "Benchling OAuth credentials for webhook integration" \
  --secret-string '{
    "client_id": "your-benchling-client-id",
    "client_secret": "your-benchling-client-secret",
    "tenant": "your-tenant-name",
    "app_definition_id": "your-app-definition-id"
  }'
```

**Required fields**:
- `client_id` - Your Benchling OAuth client ID
- `client_secret` - Your Benchling OAuth client secret
- `tenant` - Your Benchling tenant name (e.g., "company" for company.benchling.com)

**Optional fields**:
- `app_definition_id` - Your Benchling app definition ID
- `api_url` - Custom Benchling API URL (defaults to https://{tenant}.benchling.com)

> **Note**: The secret must be in the same AWS region as your Quilt stack.

### Step 3: Deploy with Secrets-Only Mode

Deploy using the new 2-parameter approach:

```bash
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123" \
  --benchling-secret "benchling-webhook-credentials"
```

That's it! The deployment will:
1. Parse the stack ARN to get AWS region and account
2. Query CloudFormation for all Quilt configuration
3. Fetch Benchling credentials from Secrets Manager
4. Deploy the webhook with complete configuration

### Step 4: Verify Deployment

After deployment completes, verify the configuration:

```bash
# Get your webhook URL from stack outputs
aws cloudformation describe-stacks \
  --stack-name BenchlingWebhookStack \
  --query 'Stacks[0].Outputs[?OutputKey==`WebhookEndpoint`].OutputValue' \
  --output text

# Test the /config endpoint (shows resolved configuration with secrets masked)
curl https://your-webhook-url.amazonaws.com/config

# Test the /health endpoint
curl https://your-webhook-url.amazonaws.com/health
```

## Comparison: Before and After

### Before (v0.5.x)

```bash
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets '{"client_id":"xxx","client_secret":"yyy","tenant":"company"}' \
  --catalog my-catalog.quiltdata.com \
  --bucket my-quilt-bucket \
  --queue-arn arn:aws:sqs:us-east-1:123456789012:my-queue \
  --database my-athena-db \
  --region us-east-1 \
  --profile my-aws-profile
  # ... and more parameters
```

### After (v0.6.0)

```bash
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc" \
  --benchling-secret "benchling-webhook-credentials"
```

## Updating Secrets After Migration

With secrets-only mode, updating Benchling credentials is easier:

```bash
# Update the secret in Secrets Manager
aws secretsmanager update-secret \
  --secret-id benchling-webhook-credentials \
  --secret-string '{
    "client_id": "new-client-id",
    "client_secret": "new-client-secret",
    "tenant": "company",
    "app_definition_id": "app-def-123"
  }'

# Force ECS service to restart and pick up new secrets
aws ecs update-service \
  --cluster benchling-webhook-cluster \
  --service benchling-webhook-service \
  --force-new-deployment
```

## CI/CD Pipeline Updates

### Before (v0.5.x)

```yaml
# GitHub Actions / GitLab CI
- name: Deploy Benchling Webhook
  env:
    BENCHLING_CLIENT_ID: ${{ secrets.BENCHLING_CLIENT_ID }}
    BENCHLING_CLIENT_SECRET: ${{ secrets.BENCHLING_CLIENT_SECRET }}
    BENCHLING_TENANT: ${{ secrets.BENCHLING_TENANT }}
  run: |
    npx @quiltdata/benchling-webhook deploy \
      --benchling-secrets "{\"client_id\":\"$BENCHLING_CLIENT_ID\",\"client_secret\":\"$BENCHLING_CLIENT_SECRET\",\"tenant\":\"$BENCHLING_TENANT\"}" \
      --catalog my-catalog.quiltdata.com \
      --bucket my-bucket \
      # ... many more parameters
```

### After (v0.6.0)

```yaml
# GitHub Actions / GitLab CI
- name: Deploy Benchling Webhook
  env:
    QUILT_STACK_ARN: ${{ secrets.QUILT_STACK_ARN }}
    BENCHLING_SECRET: ${{ secrets.BENCHLING_SECRET_NAME }}
  run: |
    npx @quiltdata/benchling-webhook deploy \
      --quilt-stack-arn "$QUILT_STACK_ARN" \
      --benchling-secret "$BENCHLING_SECRET" \
      --yes
```

**Advantages**:
- No sensitive credentials in CI/CD environment
- Only 2 environment variables instead of 10+
- Secrets managed centrally in AWS
- Easier to rotate credentials

## Legacy Mode (Still Supported)

If you're not ready to migrate to secrets-only mode, **legacy mode is still fully supported**:

```bash
# All v0.5.x commands continue to work
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets @secrets.json \
  --catalog my-catalog.quiltdata.com
```

However, legacy mode parameters are **deprecated** and will be removed in v1.0.0.

## Troubleshooting

### Error: "Invalid CloudFormation stack ARN format"

**Cause**: The stack ARN doesn't match the expected format.

**Solution**: Verify your ARN format:
```
arn:aws:cloudformation:region:account:stack/name/id
```

Example:
```
arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123-def-456
```

### Error: "Secret not found"

**Cause**: The Benchling secret doesn't exist in Secrets Manager.

**Solution**: Create the secret in the same region as your Quilt stack:
```bash
aws secretsmanager create-secret \
  --name benchling-webhook-credentials \
  --region us-east-1 \
  --secret-string '{"client_id":"...","client_secret":"...","tenant":"..."}'
```

### Error: "Missing required CloudFormation outputs"

**Cause**: Your Quilt stack doesn't export the required outputs.

**Solution**: Ensure your Quilt stack exports these outputs:
- `UserAthenaDatabaseName` or `DatabaseName`
- `UserBucket` or `BucketName`
- `PackagerQueueArn`
- `Catalog` or `CatalogDomain` or `ApiGatewayEndpoint`

### Error: "Access denied to secret"

**Cause**: ECS task role doesn't have permission to access Secrets Manager.

**Solution**: The CDK stack automatically adds the required permissions. If you see this error:
1. Check that the secret name matches what you provided
2. Verify the ECS task role has `secretsmanager:GetSecretValue` permission
3. Redeploy to ensure IAM permissions are updated

## FAQ

### Do I have to migrate to secrets-only mode?

No, legacy mode is still fully supported in v0.6.0. However, we recommend migrating to benefit from simpler configuration and better security.

### Can I use both modes?

No, each deployment uses either secrets-only mode or legacy mode, not both. Choose based on your needs:
- **Secrets-only**: Recommended for new deployments
- **Legacy**: For existing deployments or specific requirements

### What happens to my existing deployment?

Existing deployments continue to work without changes. You can migrate by redeploying with the new parameters.

### Is there a performance impact?

The container makes 2 AWS API calls at startup (CloudFormation + Secrets Manager). This adds ~1-2 seconds to startup time but doesn't affect runtime performance. Results are cached.

### How do I roll back if something goes wrong?

You can always redeploy using legacy mode:
```bash
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets @secrets.json \
  --catalog my-catalog.quiltdata.com
```

## Support

- 📖 [Secrets Configuration Guide](./SECRETS_CONFIGURATION.md)
- 📖 [Architecture Documentation](../spec/156a-secrets-only/README.md)
- 🐛 [Report Issues](https://github.com/quiltdata/benchling-webhook/issues)
