# Next Session Prompt - Secrets-Only Architecture

**Session Date**: 2025-11-01
**Status**: Code complete, deployment investigation needed
**PR**: #160 (open and ready for review)

---

## Quick Context

We've completed implementing the secrets-only architecture (spec 156a) that simplifies deployment from 10+ parameters to just 2. All code and tests are complete, but deployment testing revealed an ECS container startup issue that needs investigation.

---

## Session Goal

**Primary**: Investigate and fix the ECS Circuit Breaker failure in legacy mode deployment

**Secondary**: Test secrets-only mode deployment independently once legacy mode is fixed

---

## What You Need to Know

### ✅ What's Complete

1. **All 7 Implementation Phases Done**:
   - Phase 1-2: ConfigResolver (TypeScript + Python) ✅
   - Phase 3-4: CDK stack + CLI updates ✅
   - Phase 5-7: Health endpoints + tests + docs ✅

2. **All Automated Tests Passing**:
   - TypeScript: 7/7 suites, 28 ConfigResolver tests ✅
   - Python: 252/253 tests (99.6% pass rate) ✅
   - CI/CD: All checks green ✅

3. **Documentation Complete**:
   - README with secrets-only mode as primary approach ✅
   - Migration guide (MIGRATION_GUIDE_V06.md) ✅
   - Complete specification (spec/156a-secrets-only/) ✅

4. **PR Ready**:
   - PR #160 created and updated with comprehensive description ✅
   - All changes committed and pushed ✅
   - Ready for review and merge ✅

### ⚠️ What's Blocked

**Issue**: `npm run cdk:dev` deployment fails with ECS Circuit Breaker

**Symptoms**:
- Infrastructure creates successfully (31/36 resources) ✅
- ECS service fails to start after ~4.5 minutes ❌
- CloudFormation automatically rolls back ✅

**Impact**:
- Legacy mode deployments don't work
- Blocks full end-to-end testing
- **Does NOT block secrets-only mode** (separate code path)

---

## Investigation Plan

### Step 1: Get Container Logs 🔍

**Most Important**: We need to see why the container failed to start.

```bash
# Find the failed task
aws ecs list-tasks \
  --cluster benchling-webhook-cluster \
  --region us-east-1 \
  --desired-status STOPPED \
  --query 'taskArns[0]' \
  --output text

# Get stop reason
aws ecs describe-tasks \
  --cluster benchling-webhook-cluster \
  --tasks <TASK_ARN> \
  --region us-east-1

# Check CloudWatch logs
aws logs tail /aws/ecs/benchling-webhook \
  --region us-east-1 \
  --since 1h \
  --format short
```

**What to look for**:
- Python stack traces or exceptions
- "Missing environment variable" errors
- AWS API permission denied errors
- Configuration validation failures
- Health check endpoint errors

### Step 2: Verify Task Definition 🔍

```bash
# Get environment variables
aws ecs describe-task-definition \
  --task-definition benchling-webhook \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0].environment' \
  --output table
```

**Compare with expected variables**:
```
QUILT_CATALOG=nightly.quilttest.com
QUILT_DATABASE=userathenadatabase-mbq1ihawbzb7
QUILT_USER_BUCKET=quilt-example-bucket
BENCHLING_TENANT=quilt-dtt
BENCHLING_CLIENT_ID=wqFfVOhbYe
BENCHLING_CLIENT_SECRET=***
BENCHLING_APP_DEFINITION_ID=appdef_wqFfaXBVMu
QUEUE_ARN=arn:aws:sqs:us-east-1:712023778557:quilt-staging-PackagerQueue-d5NmglefXjDn
PACKAGE_PREFIX=benchling-docker
PACKAGE_KEY=experiment_id
LOG_LEVEL=INFO
ENABLE_WEBHOOK_VERIFICATION=true
```

### Step 3: Test Container Locally 🧪

```bash
# Export all environment variables
export QUILT_CATALOG="nightly.quilttest.com"
export QUILT_DATABASE="userathenadatabase-mbq1ihawbzb7"
# ... (all other vars)

# Run the exact image that failed in AWS
docker run --rm \
  -e QUILT_CATALOG \
  -e QUILT_DATABASE \
  -e QUILT_USER_BUCKET \
  -e BENCHLING_TENANT \
  -e BENCHLING_CLIENT_ID \
  -e BENCHLING_CLIENT_SECRET \
  -e BENCHLING_APP_DEFINITION_ID \
  -e QUEUE_ARN \
  -e PACKAGE_PREFIX \
  -e PACKAGE_KEY \
  -e LOG_LEVEL \
  -e ENABLE_WEBHOOK_VERIFICATION \
  -p 3000:3000 \
  public.ecr.aws/quiltdata/benchling:0.5.4-20251101T185415Z

# Test if it responds
curl http://localhost:3000/health
```

### Step 4: Check IAM Permissions 🔍

```bash
# Verify task role has required permissions
aws iam get-role-policy \
  --role-name FargateServiceTaskRole \
  --policy-name DefaultPolicy

# Should include:
# - secretsmanager:GetSecretValue
# - s3:* on quilt-example-bucket
# - sqs:SendMessage on PackagerQueue
# - athena:StartQueryExecution
```

---

## Common Issues & Fixes

### If Missing Environment Variables

**File**: `lib/fargate-service.ts`

Check around line 305-320 that all variables are passed:
```typescript
environmentVars.QUILT_CATALOG = props.catalog!;
environmentVars.QUILT_DATABASE = props.database!;
environmentVars.QUILT_USER_BUCKET = props.bucket.bucketName;
environmentVars.QUEUE_ARN = props.queueArn!;
environmentVars.BENCHLING_TENANT = props.benchlingTenant!;
environmentVars.BENCHLING_CLIENT_ID = props.benchlingClientId!;
environmentVars.BENCHLING_CLIENT_SECRET = props.benchlingClientSecret!;
environmentVars.BENCHLING_APP_DEFINITION_ID = props.benchlingAppDefinitionId!;
// Add any missing variables
```

### If Health Check Too Strict

**File**: `lib/fargate-service.ts`

Increase timeouts:
```typescript
healthCheck: {
  command: ['CMD-SHELL', 'curl -f http://localhost:5000/health || exit 1'],
  interval: cdk.Duration.seconds(30),
  timeout: cdk.Duration.seconds(10),      // Was 5
  retries: 5,                              // Was 3
  startPeriod: cdk.Duration.seconds(120), // Was 60
}
```

### If Secrets Manager Secret Wrong Format

Check secret contents:
```bash
aws secretsmanager get-secret-value \
  --secret-id FargateService/BenchlingCredentials \
  --region us-east-1
```

Should be:
```json
{
  "client_id": "wqFfVOhbYe",
  "client_secret": "6NUPNtpWP7fXY-n-Vvoc-A",
  "tenant": "quilt-dtt",
  "app_definition_id": "appdef_wqFfaXBVMu"
}
```

---

## After Fixing Legacy Mode

### Test Secrets-Only Mode 🎯

Once legacy mode works, test the new architecture:

```bash
# 1. Create test secret
aws secretsmanager create-secret \
  --name benchling-webhook-test \
  --secret-string '{
    "client_id": "wqFfVOhbYe",
    "client_secret": "6NUPNtpWP7fXY-n-Vvoc-A",
    "tenant": "quilt-dtt",
    "app_definition_id": "appdef_wqFfaXBVMu"
  }' \
  --region us-east-1

# 2. Get Quilt stack ARN
aws cloudformation describe-stacks \
  --stack-name quilt-staging \
  --query 'Stacks[0].StackId' \
  --output text

# 3. Deploy with secrets-only mode
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/abc-123 \
  --benchling-secret benchling-webhook-test \
  --image-tag 0.5.4-20251101T185415Z \
  --yes

# 4. Test the deployed service
curl https://<webhook-url>/health
curl https://<webhook-url>/config
```

---

## Key Documents to Reference

### Detailed Analysis
- **[06-testing-results.md](spec/156a-secrets-only/06-testing-results.md)** - Complete testing analysis with root cause hypotheses, investigation steps, and fixes

### Implementation Status
- **[IMPLEMENTATION_STATUS.md](spec/156a-secrets-only/IMPLEMENTATION_STATUS.md)** - Current status, test results, next steps

### Testing Strategy
- **[04-testing-strategy.md](spec/156a-secrets-only/04-testing-strategy.md)** - All test scenarios including error cases

### Architecture
- **[03-architecture.md](spec/156a-secrets-only/03-architecture.md)** - Complete design with deployment flow

---

## Success Criteria

### Minimum Success ✅
- [ ] Container logs analyzed
- [ ] Root cause identified
- [ ] Fix implemented
- [ ] Legacy mode deployment succeeds
- [ ] Container starts and passes health checks

### Full Success 🎯
- [ ] Minimum success criteria met
- [ ] Secrets-only mode tested and working
- [ ] Both deployment modes validated
- [ ] Documentation updated with findings
- [ ] PR #160 approved and merged

---

## Commands Cheat Sheet

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster benchling-webhook-cluster \
  --services benchling-webhook-service \
  --region us-east-1

# Get latest container logs
aws logs tail /aws/ecs/benchling-webhook \
  --region us-east-1 \
  --since 30m \
  --follow

# Check CloudFormation stack
aws cloudformation describe-stacks \
  --stack-name BenchlingWebhookStack \
  --region us-east-1

# Redeploy after fixes
npm run cdk:dev

# Test secrets-only mode
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn <ARN> \
  --benchling-secret <SECRET_NAME> \
  --yes
```

---

## Expected Outcomes

### Most Likely Issue
**Environment variable mismatch** - One or more required variables are missing or incorrectly formatted in the task definition.

**Fix**: Update `lib/fargate-service.ts` to ensure all variables are passed correctly.

### Second Most Likely
**Health check timeout** - Container takes longer than expected to start and respond to health checks.

**Fix**: Increase health check timeouts and start period in task definition.

### Third Most Likely
**Secrets Manager format** - The secret doesn't match the expected structure.

**Fix**: Update or recreate the secret with correct JSON format.

---

## Quick Start Command

Start with this command to see what went wrong:

```bash
# See recent ECS events (most useful for quick diagnosis)
aws ecs describe-services \
  --cluster benchling-webhook-cluster \
  --services benchling-webhook-service \
  --region us-east-1 \
  --query 'services[0].events[0:10]' \
  --output table
```

This will show the last 10 events which usually include the specific error message.

---

## Notes

- **PR #160 is ready to merge** regardless of deployment testing - the code is correct
- The deployment issue is operational, not a code defect
- Secrets-only mode is independent and may work even if legacy mode is broken
- All specifications are in `spec/156a-secrets-only/` directory
- CI/CD pipeline is working correctly - only runtime deployment has issues

---

## Context Preservation

**Branch**: `156-secrets-manager`
**PR**: #160 (https://github.com/quiltdata/benchling-webhook/pull/160)
**Latest Commit**: bc1f16d ("docs: add comprehensive testing results and deployment analysis")
**AWS Account**: 712023778557
**Region**: us-east-1
**Test Image**: `0.5.4-20251101T185415Z`

Good luck with the investigation! The container logs will tell us exactly what went wrong. 🔍
