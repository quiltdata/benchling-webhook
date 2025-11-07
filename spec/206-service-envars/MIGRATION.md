# Migration Guide: v0.8.0 → v1.0.0

## Overview

Version 1.0.0 introduces a breaking change in how Quilt service configuration is handled. This guide will help you migrate from v0.8.x to v1.0.0.

## What Changed

### Before (v0.8.x)
- Container received `QuiltStackARN` environment variable
- Container made runtime CloudFormation API calls to resolve services
- Task role required `cloudformation:DescribeStacks` permissions
- Services were resolved dynamically at container startup

### After (v1.0.0)
- Container receives explicit service environment variables:
  - `PACKAGER_SQS_URL`
  - `ATHENA_USER_DATABASE`
  - `QUILT_WEB_HOST`
  - `ICEBERG_DATABASE`
- Services resolved once at deployment time (no runtime CloudFormation calls)
- Task role has no CloudFormation permissions
- Container starts faster with pre-resolved configuration

## Breaking Changes

1. **Removed CloudFormation Parameter**: `QuiltStackARN`
2. **Removed Environment Variable**: `QuiltStackARN`
3. **Removed IAM Permissions**: `cloudformation:DescribeStacks`, `cloudformation:DescribeStackResources`
4. **Removed Interface Property**: `FargateServiceProps.stackArn`

## Migration Steps

### Step 1: Update Your Configuration

Your `~/.config/benchling-webhook/<profile>.json` configuration **does not need changes**. The `quilt.stackArn` field is still used at deployment time to resolve services.

Example configuration (no changes needed):
```json
{
  "quilt": {
    "stackArn": "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-stack/...",
    "catalog": "quilt.example.com",
    "database": "quilt_catalog",
    "queueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-queue",
    "region": "us-east-1"
  }
}
```

### Step 2: Update to v1.0.0

```bash
# Pull latest changes
git pull origin main

# Install dependencies
npm install
```

### Step 3: Deploy

The deploy command works the same way. Services are automatically resolved from your Quilt stack:

```bash
npm run deploy
```

What happens during deployment:
1. Deploy command queries your Quilt CloudFormation stack using `stackArn`
2. Services are resolved from stack outputs
3. Resolved values are passed as CDK parameters
4. Container receives explicit environment variables

### Step 4: Verify Deployment

After deployment, verify the container has the new environment variables:

```bash
# Get ECS task ARN
aws ecs list-tasks --cluster benchling-webhook-cluster --query 'taskArns[0]' --output text

# Check environment variables
aws ecs describe-tasks --cluster benchling-webhook-cluster --tasks <task-arn> \
  | jq '.tasks[0].overrides.containerOverrides[0].environment'
```

Expected variables:
- ✅ `PACKAGER_SQS_URL`
- ✅ `ATHENA_USER_DATABASE`
- ✅ `QUILT_WEB_HOST`
- ✅ `ICEBERG_DATABASE`
- ❌ `QuiltStackARN` (removed)

## Common Issues

### Issue: Deploy fails with "Parameter QuiltStackARN does not exist"

**Cause**: Trying to update an existing v0.8.x stack with v1.0.0 code.

**Solution**: This is expected. CloudFormation will handle the parameter removal automatically during the update. The deploy will succeed.

### Issue: Container logs show "QuiltStackARN not found"

**Cause**: Application code still expects the old `QuiltStackARN` environment variable.

**Solution**: Ensure you're running the v1.0.0 container image. The application has been updated to use the new explicit environment variables.

### Issue: Task role permissions error

**Cause**: Old IAM policies may still reference CloudFormation permissions.

**Solution**: Redeploy the stack. CDK will update the IAM role to remove CloudFormation permissions.

## Rollback Procedure

If you need to rollback to v0.8.x:

```bash
# Check out previous version
git checkout v0.8.0

# Reinstall dependencies
npm install

# Redeploy
npm run deploy
```

Note: The CloudFormation stack will be updated to add back the `QuiltStackARN` parameter and CloudFormation permissions.

## Benefits of v1.0.0

1. **Faster Container Startup**: No runtime CloudFormation API calls
2. **Reduced IAM Permissions**: Task role no longer needs CloudFormation access
3. **Better Security**: Principle of least privilege
4. **Explicit Configuration**: All services visible in environment variables
5. **Easier Debugging**: Environment variables can be inspected without API calls

## Testing

After migration, test your deployment:

1. **Health Check**: Verify the webhook endpoint responds
   ```bash
   curl https://your-api-gateway-url/health
   ```

2. **Webhook Processing**: Send a test webhook from Benchling
   - Verify package creation in S3
   - Check CloudWatch logs for any errors

3. **Performance**: Monitor container startup time (should be faster)

## Support

If you encounter issues during migration:

1. Check the [CHANGELOG.md](/CHANGELOG.md) for detailed changes
2. Review [Issue #206](https://github.com/quiltdata/benchling-webhook/issues/206)
3. Check CloudWatch logs: `/ecs/benchling-webhook`
4. Open a GitHub issue with error details

## Configuration Reference

### Deployment-Time (Used by deploy command)
- `quilt.stackArn` - Queries CloudFormation for service endpoints

### Runtime (Passed to container)
- `PACKAGER_SQS_URL` - SQS queue for package creation
- `ATHENA_USER_DATABASE` - Athena/Glue database name
- `QUILT_WEB_HOST` - Quilt catalog domain
- `ICEBERG_DATABASE` - Iceberg database (optional)
- `BENCHLING_SECRET_ARN` - Secrets Manager ARN
- `BENCHLING_TENANT` - Benchling tenant ID
- `LOG_LEVEL` - Application log level

## Next Steps

After successful migration:

1. Monitor application logs for 24-48 hours
2. Verify webhook processing continues to work
3. Review IAM permissions (CloudFormation access should be removed)
4. Update any internal documentation
5. Consider enabling Container Insights for enhanced monitoring

## Questions?

For questions about this migration, contact the Quilt team or open a GitHub issue.
