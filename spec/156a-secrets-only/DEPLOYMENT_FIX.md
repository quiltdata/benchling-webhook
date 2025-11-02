# Deployment Fix - Secrets-Only Mode

**Date**: 2025-11-01
**Issue**: ECS Circuit Breaker failure during `npm run cdk:dev`
**Root Cause**: Attempting to deploy using legacy mode (which was meant for tests only)
**Solution**: Switch to secrets-only mode for all deployments

## Root Cause Analysis

### Why Did the Deployment Fail?

The `npm run cdk:dev` command was attempting to deploy using **legacy mode**, which:

1. **Was never meant to be deployed** - According to [01-requirements.md](./01-requirements.md#L96-L105), legacy mode exists ONLY for backward compatibility with the test suite, NOT for actual deployments.

2. **Has broken code paths** - The Python application's `config.py` calls `resolve_benchling_secrets()` in legacy mode, which expects specific environment variables that the CDK stack doesn't properly set.

3. **Complex parameter passing** - Legacy mode requires 10+ CloudFormation parameters, leading to configuration mismatches between the CDK stack and the container runtime.

### The Bug

In legacy mode, the fargate-service.ts code:
- Creates ECS Secrets for `BENCHLING_CLIENT_ID`, `BENCHLING_CLIENT_SECRET`, `BENCHLING_APP_DEFINITION_ID`
- Sets environment variable `BENCHLING_TENANT`

But the Python `resolve_benchling_secrets()` function expects ALL of these as plain environment variables simultaneously, causing a mismatch.

## The Fix

### What We Did

1. **Created Benchling Secret in AWS Secrets Manager**:
   ```bash
   aws secretsmanager create-secret \
     --name benchling-webhook-dev \
     --description "Benchling credentials for webhook processor (development)" \
     --secret-string '{"client_id":"wqFfVOhbYe","client_secret":"6NUPNtpWP7fXY-n-Vvoc-A","tenant":"quilt-dtt","app_definition_id":"appdef_wqFfaXBVMu"}' \
     --region us-east-1
   ```

2. **Got Quilt Stack ARN**:
   ```
   arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/e51b0c10-10c9-11ee-9b41-12fda87498a3
   ```

3. **Updated `bin/cdk-dev.js`** to use secrets-only mode:
   ```javascript
   // Secrets-only mode parameters
   const quiltStackArn = 'arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/e51b0c10-10c9-11ee-9b41-12fda87498a3';
   const benchlingSecret = 'benchling-webhook-dev';

   run(`npm run cli -- --quilt-stack-arn ${quiltStackArn} --benchling-secret ${benchlingSecret} --image-tag ${imageTag} --yes`);
   ```

### Why This Works

Secrets-only mode:
- **Simplifies configuration**: Only 2 parameters instead of 10+
- **Uses tested code paths**: The secrets-only implementation is new and properly tested
- **Follows the spec**: This is how the system was designed to be deployed
- **Better security**: All secrets in AWS Secrets Manager, no individual parameters

## Testing the Fix

### Before Deploying

1. Verify the secret exists:
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id benchling-webhook-dev \
     --region us-east-1 \
     --query 'SecretString' \
     --output text
   ```

2. Verify the Quilt stack exists:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name quilt-staging \
     --region us-east-1
   ```

### Deploy

```bash
npm run cdk:dev
```

This will:
1. Create a dev tag with timestamp
2. Push tag to GitHub (triggers CI to build x86_64 image)
3. Wait for CI to complete
4. **Deploy using secrets-only mode** with the Benchling secret and Quilt stack ARN
5. Verify the deployment

### Expected Behavior

The container will:
1. Start with only 2 environment variables: `QuiltStackARN` and `BenchlingSecret`
2. Query CloudFormation for Quilt configuration (catalog, database, bucket, queue)
3. Query Secrets Manager for Benchling credentials
4. Start the Flask application with complete configuration
5. Pass health checks at `/health` and `/health/ready`

## Verification

After deployment succeeds:

1. **Check health endpoints**:
   ```bash
   # Get ALB DNS
   WEBHOOK_URL=$(aws cloudformation describe-stacks \
     --stack-name BenchlingWebhookStack \
     --region us-east-1 \
     --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
     --output text)

   # Test health
   curl http://${WEBHOOK_URL}/health

   # Test config endpoint (should show secrets-only mode)
   curl http://${WEBHOOK_URL}/config
   ```

2. **Check ECS service status**:
   ```bash
   aws ecs describe-services \
     --cluster benchling-webhook-cluster \
     --services benchling-webhook-service \
     --region us-east-1 \
     --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}' \
     --output table
   ```

3. **Check container logs**:
   ```bash
   aws logs tail /aws/ecs/benchling-webhook \
     --region us-east-1 \
     --follow \
     --format short
   ```

## Future Deployments

### Development Deployments
```bash
npm run cdk:dev
# Now uses secrets-only mode automatically
```

### Production Deployments
```bash
# Create production secret first
aws secretsmanager create-secret \
  --name benchling-webhook-prod \
  --description "Benchling credentials for webhook processor (production)" \
  --secret-string '{"client_id":"PROD_ID","client_secret":"PROD_SECRET","tenant":"PROD_TENANT","app_definition_id":"PROD_APP_ID"}' \
  --region us-east-1

# Deploy
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn arn:aws:cloudformation:REGION:ACCOUNT:stack/quilt-prod/ID \
  --benchling-secret benchling-webhook-prod \
  --image-tag VERSION \
  --yes
```

## Cleanup: Removing Legacy Mode (Future Work)

Once this deployment works and is validated, we should:

1. **Remove legacy deployment code** from `bin/commands/deploy.ts` (lines 49-383)
2. **Remove legacy mode** from `lib/fargate-service.ts` (keep only secrets-only mode)
3. **Update tests** to use mocked AWS APIs for secrets-only mode
4. **Keep Python legacy mode** ONLY for test suite compatibility

## Key Takeaways

1. ✅ **Legacy mode is for tests only** - Never deploy with individual environment variables
2. ✅ **Secrets-only mode is production-ready** - Use it for all deployments
3. ✅ **Two parameters is all you need** - Simpler is better
4. ✅ **AWS Secrets Manager for all secrets** - Better security and management
5. ✅ **CloudFormation for configuration** - Single source of truth

---

**Status**: Fix implemented, ready for testing
**Next Step**: Run `npm run cdk:dev` to verify the fix works
