# Migration Delta: Current → v0.9.1 Architecture

**Date**: 2025-11-26
**Status**: Requirements
**Current Version**: v0.9.0 (commit 07bd4e8)
**Target Version**: v0.9.1

## Executive Summary

**Current State**: REST API Gateway → VPC Link → NLB → ECS Fargate (HMAC inside FastAPI)
**Target State**: REST API Gateway → Lambda Authorizer → VPC Link → NLB → ECS Fargate (HMAC in Lambda)

**Rationale**: Implement defense-in-depth security by isolating authentication logic in a Lambda function with minimal permissions, reducing attack surface from full system compromise to signature validation only.

---

## Components to ADD

### 1. Lambda Authorizer Function

**Purpose**: Perform HMAC signature verification before requests reach ECS

**Specifications**:

- Runtime: Python 3.11
- Memory: 128 MB
- Timeout: 10 seconds
- Handler: `index.handler`
- Dependencies: `benchling-sdk` (for HMAC verification)

**Environment Variables**:

- `BENCHLING_SECRET_ARN` - Secrets Manager ARN for Benchling credentials (secret contains `app_definition_id` field)

**IAM Permissions** (minimal):

- `secretsmanager:GetSecretValue` (single secret ARN only)
- NO access to: S3, SQS, Glue, Athena, database, or business resources

**Identity Sources**:

- `webhook-id` header
- `webhook-signature` header
- `webhook-timestamp` header

**Behavior**:

- Retrieve Benchling app secret from Secrets Manager
- Verify HMAC signature using Benchling SDK
- Return IAM policy document (Allow/Deny)
- No result caching (`resultsCacheTtl: 0`)

**Security Principle**: If Lambda is compromised, attacker gains ONLY signature validation capability, NOT business logic access.

### 2. Lambda IAM Role

**Purpose**: Grant Lambda minimal permissions required for authentication only

**Specifications**:

- Service principal: `lambda.amazonaws.com`
- Managed policy: `AWSLambdaBasicExecutionRole` (CloudWatch Logs)
- Inline policy: `secretsmanager:GetSecretValue` for ONE specific secret ARN

**Explicitly NO Access To**:

- S3 buckets (package storage, Quilt buckets)
- SQS queues (Quilt package creation queue)
- Glue Data Catalog
- Athena workgroups
- IAM role assumption
- Any business logic resources

### 3. Lambda Deployment Package

**Purpose**: Bundle Lambda function code with dependencies

**Contents**:

- Function code: HMAC verification logic using Benchling SDK
- Dependency: `benchling-sdk` Python package
- Deployment method: Lambda layer OR bundled ZIP package

**Build Process**:

- Must support Python 3.11
- Must include Benchling SDK with correct version
- Must be deployable via CDK

---

## Components to MODIFY

### 1. REST API Gateway (`lib/rest-api-gateway.ts`)

**Changes Required**:

- Create Lambda Authorizer construct in CDK
- Refactor API Gateway routing from catch-all proxy to explicit paths:
  - **Current**: `{proxy+}` routes all paths to backend (including health checks)
  - **Target**: Explicit resources for `/event`, `/lifecycle`, `/canvas` (with authorizer) + `/health/*` (no authorizer)
  - This is transparent to Benchling - same endpoint URLs, no caller changes
  - API Gateway automatically invokes Lambda for webhook paths only, then routes to backend if authorized
- Configure REQUEST-type authorizer (not TOKEN-type)
- Configure identity sources (headers Lambda needs to validate):
  - `webhook-id`
  - `webhook-signature`
  - `webhook-timestamp`
- Update stage deployment to include authorizer configuration
- Keep existing IP resource policy (Layer 1 defense - no changes)
- Keep existing CloudWatch access logs (no changes)

**What NOT to Change**:

- VPC Link configuration
- Network Load Balancer configuration
- IP allowlist resource policy logic
- Health check endpoints (remain unauthenticated)

### 2. FastAPI Application (`docker/src/app.py`)

**Changes Required**:

- Remove `Depends(webhook_verification_dependency)` from endpoints:
  - `/event` endpoint (currently line 221)
  - `/lifecycle` endpoint (currently line 286)
  - `/canvas` endpoint (currently line 332)
- Update endpoint documentation to note "Pre-authenticated by Lambda Authorizer"
- Assume all requests reaching application are pre-authenticated

**What NOT to Change**:

- Health check endpoints (`/health`, `/health/ready`, `/health/live`)
- Configuration endpoint (`/config`)
- Business logic implementations
- AWS service integrations (S3, SQS, Secrets Manager, Glue, Athena)
- Benchling API client (still needed for business operations)

### 3. Configuration Schema

**Changes Required**:

- Update documentation: `security.enableVerification` now controls Lambda Authorizer (not FastAPI)
- Clarify that FastAPI no longer performs HMAC verification
- Document Lambda-specific environment variables

**What NOT to Change**:

- Configuration file structure (profile-based, XDG directories)
- User-facing configuration fields
- Secrets Manager format
- Profile inheritance behavior

### 4. Deployment Tracking

**Changes Required**:

- Add Lambda function ARN to deployment metadata (`deployments.json`)
- Add Lambda CloudWatch log group to deployment outputs
- Update deployment health checks to verify Lambda authorizer

**What NOT to Change**:

- Deployment tracking file structure
- Per-profile deployment history
- Active deployment tracking format

---

## Components to REMOVE

### 1. Webhook Verification Module (`docker/src/webhook_verification.py`)

**Status**: Entire file becomes obsolete

**Reason**: HMAC verification logic moves to Lambda Authorizer

**Migration**: Extract core verification logic, port to Lambda function

### 2. FastAPI Verification Dependencies

**Changes Required**:

- Remove `benchling_sdk.apps.helpers.webhook_helpers` import (if only used for verification)
- Remove `webhook_verification_dependency` function
- Remove verification-related configuration validation in FastAPI

**What NOT to Remove**:

- Benchling SDK client (still needed for API calls: fetch entries, update canvas)
- Benchling SDK main import (still needed for business logic)

### 3. ECS Task Permissions

**Status**: No changes to IAM permissions

**Reason**: ECS tasks still need full AWS access for business logic (S3, SQS, Glue, Athena)

**Security Improvement**: Attack surface reduced even though permissions unchanged:

- Compromised Lambda → Signature validation access only
- Compromised ECS → Pre-authenticated requests only (Lambda layer already breached)
- Both layers must be breached for significant impact

---

## Request Flow Changes

### BEFORE (Current v0.9.0)

```
1. Benchling → HTTPS POST to REST API Gateway
2. API Gateway: Check source IP against resource policy
   → If IP not in allowlist → 403 Forbidden
3. API Gateway → VPC Link → NLB → ECS Fargate
4. ECS FastAPI: Perform HMAC verification
   → If invalid signature → 401 Unauthorized
5. FastAPI: Process webhook event (business logic)
6. Return 200 OK to Benchling
```

**Security**: Single authentication layer inside ECS (full AWS permissions)

### AFTER (Target v0.9.1)

```
1. Benchling → HTTPS POST to REST API Gateway (same URL as before)
2. API Gateway: Check source IP against resource policy
   → If IP not in allowlist → 403 Forbidden
3. API Gateway: Automatically invoke Lambda Authorizer (transparent to caller)
4. Lambda Authorizer:
   a. Retrieve Benchling app secret from Secrets Manager
   b. Verify HMAC signature using Benchling SDK
   c. Return IAM policy (Allow/Deny) to API Gateway
   → If invalid signature → API Gateway returns 401 Unauthorized to Benchling
5. API Gateway: Forward to VPC Link (only if Lambda returned Allow)
6. VPC Link → NLB → ECS Fargate
7. FastAPI: Process webhook event (NO authentication needed - pre-authenticated)
8. Return 200 OK through API Gateway to Benchling
```

**Key Point**: From Benchling's perspective, nothing changes - same endpoint URL, same request format. The Lambda Authorizer is an internal API Gateway feature that executes inline before routing.

**Security**: Three-layer defense-in-depth:

- Layer 1: IP filtering (AWS edge)
- Layer 2: HMAC authentication (Lambda - minimal permissions)
- Layer 3: Business logic (ECS - full permissions, but only receives authenticated requests)

---

## Configuration Changes

### User-Facing Configuration (NO BREAKING CHANGES)

**Existing Fields (no changes)**:

- `security.webhookAllowList` - Still controls IP filtering
- `security.enableVerification` - Still exists (now controls Lambda behavior instead of FastAPI)
- `benchling.secretArn` - Still points to Secrets Manager secret
- `benchling.appDefinitionId` - Still identifies Benchling app
- `benchling.tenant` - Still specifies Benchling tenant
- `benchling.clientId` - Still OAuth client ID

**New Fields (internal only)**:

- Lambda function ARN (tracked in `deployments.json`, not user config)
- Lambda log group (tracked in deployment outputs)

### Secrets Manager (NO CHANGES)

**Format remains unchanged**:

```json
{
  "client_id": "...",
  "client_secret": "...",
  "tenant": "example"
}
```

---

## Testing Changes

### New Tests Required

**Lambda Authorizer Unit Tests**:

- Valid HMAC signature → Returns Allow policy
- Invalid HMAC signature → Returns Deny policy
- Missing headers → Returns Deny policy
- Expired timestamp → Returns Deny policy
- Secrets Manager retrieval failure → Returns Deny policy
- IAM permission validation (can only read specified secret)

**Lambda Authorizer Integration Tests**:

- End-to-end auth flow with valid signature → 200 OK from FastAPI
- End-to-end auth flow with invalid signature → 401 Unauthorized from API Gateway
- Verify 401 comes from API Gateway (not FastAPI)
- Verify Lambda CloudWatch logs contain auth attempts

**Security Tests**:

- Lambda cannot access S3 buckets → AccessDenied
- Lambda cannot access SQS queues → AccessDenied
- Lambda cannot access other Secrets Manager secrets → AccessDenied

### Modified Tests

**FastAPI Tests**:

- Remove HMAC verification unit tests (moved to Lambda)
- Remove verification dependency tests
- Update integration tests to expect 401 from API Gateway (not FastAPI)
- Keep business logic tests (no changes)

**Deployment Tests**:

- Verify Lambda function deployed successfully
- Verify Lambda attached to API Gateway methods
- Verify Lambda IAM role has correct permissions
- Verify health checks still work (unauthenticated endpoints)

---

## Deployment Sequence

### Step 1: Deploy Lambda Authorizer Infrastructure

1. Build Lambda deployment package with `benchling-sdk`
2. Deploy Lambda function via CDK
3. Deploy Lambda IAM role with minimal permissions
4. Verify Lambda can retrieve Benchling secret from Secrets Manager
5. Test Lambda function in isolation (invoke directly with test event)

### Step 2: Update REST API Gateway

1. Create Lambda Authorizer construct in CDK
2. Attach authorizer to `/webhook` POST method
3. Configure identity sources (headers)
4. Deploy API Gateway stage with authorizer
5. Verify authorizer appears in API Gateway console

### Step 3: Deploy New ECS Task Definition

1. Build new Docker image with HMAC verification removed
2. Push to ECR with version tag
3. Update ECS task definition to use new image
4. Deploy new task definition to ECS service
5. Wait for tasks to reach healthy state

### Step 4: Verification

1. Check Lambda CloudWatch logs for auth attempts
2. Test valid webhook signature → 200 OK
3. Test invalid webhook signature → 401 Unauthorized
4. Verify 401 response comes from API Gateway (check response headers)
5. Verify ECS logs show only authenticated requests

### Step 5: Monitoring

1. Set up CloudWatch alarms for Lambda errors
2. Set up CloudWatch alarms for Lambda throttling
3. Monitor Lambda duration metrics (should be <1s)
4. Monitor API Gateway 401 error rate

---

## Rollback Plan

### Emergency Rollback (if Lambda authorizer fails)

**Option 1: Detach Authorizer (fastest - 1 minute)**:

1. Remove authorizer attachment from API Gateway methods via console
2. Redeploy API Gateway stage
3. System reverts to allowing all requests through (IP filter only)
4. **Risk**: No HMAC verification until ECS rollback completes

**Option 2: Full Rollback (safest - 5 minutes)**:

1. Detach Lambda Authorizer from API Gateway methods
2. Redeploy previous ECS task definition (with HMAC in FastAPI)
3. Wait for ECS tasks to reach healthy state
4. Verify HMAC verification working in FastAPI logs
5. Delete Lambda function (optional cleanup)

**Rollback Testing**:

- Test rollback procedure in dev environment
- Document rollback time estimates
- Create runbook for on-call engineers

---

## Cost Impact Analysis

### Additional Monthly Costs (us-east-1)

**Lambda Authorizer**:

- Fixed cost: ~$0 (no provisioned concurrency)
- Per-request: ~$0.20 per million invocations
- Example: 1 million webhooks/month → $0.20/month additional

**Total Cost Change**: +$0.20 per million requests

**Comparison to Current**:

- Current: $3.50/million (API Gateway only)
- After: $3.70/million (API Gateway + Lambda)
- **Increase**: 5.7%

**Cost/Benefit Analysis**:

- Cost increase: $0.20 per million requests
- Security benefit: Defense-in-depth, reduced attack surface
- Operational benefit: Isolated authentication logic, easier to audit
- **Verdict**: Security improvement justifies minimal cost increase

---

## Security Impact Analysis

### Attack Surface Comparison

**Without Lambda Authorizer (Current)**:

- API Gateway → ECS (ECS has full AWS permissions)
- Attack vector: Bypass HMAC → Full system compromise
- Single point of failure: FastAPI authentication

**With Lambda Authorizer (Target)**:

- API Gateway → Lambda (minimal permissions) → ECS (full permissions)
- Attack vector 1: Compromise Lambda → Signature validation only
- Attack vector 2: Compromise ECS → Pre-authenticated requests only
- **Both layers must be breached for significant impact**

### Security Improvements

1. **Isolation**: Authentication logic isolated from business logic
2. **Minimal Permissions**: Lambda has NO access to business resources
3. **Defense-in-Depth**: Three security layers (IP, Lambda, ECS)
4. **Reduced Blast Radius**: Compromised Lambda ≠ compromised system
5. **Auditability**: Lambda logs all authentication attempts separately

### Remaining Risks

1. **Lambda Bypass**: If attacker bypasses Lambda (API Gateway misconfiguration) → Reaches ECS directly
   - Mitigation: Validate API Gateway configuration in deployment tests
2. **Secrets Manager Compromise**: If Benchling secret stolen → Can forge valid signatures
   - Mitigation: Secrets Manager rotation policy, CloudTrail monitoring
3. **IP Allowlist Bypass**: If Benchling IPs change → Legitimate traffic blocked OR attacker spoofs IP
   - Mitigation: Monitor Benchling IP changes, document update process

---

## Operational Considerations

### Monitoring

**New CloudWatch Metrics**:

- Lambda invocation count (should match webhook count)
- Lambda duration (should be <1s)
- Lambda errors (should be near zero)
- Lambda throttles (should be zero)

**New CloudWatch Logs**:

- `/aws/lambda/BenchlingWebhookAuthorizer` - Auth attempts, success/failure

**Alerting**:

- Lambda error rate >1% → Page on-call
- Lambda duration >5s → Warning
- Lambda throttles >0 → Increase reserved concurrency

### Scaling

**Lambda Scaling**:

- Automatic (up to account concurrency limit)
- Regional limit: 1000 concurrent executions (default)
- Burst limit: 3000 concurrent executions
- **Action**: Monitor concurrency, request limit increase if needed

**No Changes to ECS Scaling**:

- Still 2-10 tasks based on CPU/request count
- Lambda authorizer does not affect ECS scaling triggers

### Disaster Recovery

**Additional DR Considerations**:

- Lambda function code must be version-controlled
- Lambda deployment package must be reproducible
- Lambda IAM role must be in CDK (infrastructure as code)

**RTO Impact**: No change (still ~5 minutes to deploy to new region)

**RPO Impact**: No change (still 0 - stateless architecture)

---

## Migration Timeline Estimate

**Total Effort**: 3-5 developer days

**Breakdown**:

- Day 1: Implement Lambda authorizer function (4-6 hours)
- Day 1: Write Lambda unit tests (2-3 hours)
- Day 2: Update CDK constructs (3-4 hours)
- Day 2: Update FastAPI application (2-3 hours)
- Day 3: Integration testing (4-6 hours)
- Day 3: Update documentation (2-3 hours)
- Day 4: Deploy to dev environment, test (4-6 hours)
- Day 5: Deploy to prod environment, monitor (2-4 hours)

**Critical Path**: Lambda function implementation → CDK integration → ECS deployment

---

## Success Criteria

### Functional Requirements

- [ ] Lambda authorizer validates valid HMAC signatures → Returns Allow policy
- [ ] Lambda authorizer rejects invalid HMAC signatures → Returns Deny policy
- [ ] API Gateway enforces Lambda authorizer policy → 401 for denied requests
- [ ] Authenticated requests reach FastAPI without re-verification
- [ ] Health check endpoints remain unauthenticated
- [ ] All existing webhook functionality works unchanged

### Security Requirements

- [ ] Lambda IAM role has ONLY `secretsmanager:GetSecretValue` permission (one secret)
- [ ] Lambda cannot access S3, SQS, Glue, Athena, or other business resources
- [ ] Invalid signatures never reach ECS tasks
- [ ] CloudWatch logs show all authentication attempts (success/failure)

### Performance Requirements

- [ ] Lambda authorizer completes in <1 second (p99)
- [ ] No increase in webhook processing latency (p50, p99)
- [ ] API Gateway throttling not triggered by Lambda invocations
- [ ] ECS tasks do not experience increased load

### Operational Requirements

- [ ] Rollback procedure tested and documented
- [ ] CloudWatch alarms configured for Lambda errors/throttles
- [ ] Deployment automation updated (CDK, CI/CD)
- [ ] On-call runbook updated with Lambda troubleshooting

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| **Components Added** | 1 Lambda function + IAM role |
| **CDK Files Modified** | 2 (`rest-api-gateway.ts`, stack config) |
| **Application Files Modified** | 1 (`docker/src/app.py`) |
| **Files Removed** | 1 (`docker/src/webhook_verification.py`) |
| **Configuration Breaking Changes** | 0 (backward compatible) |
| **Cost Impact** | +$0.20/million requests (~6% increase) |
| **Security Impact** | Defense-in-depth, reduced attack surface |
| **Migration Effort** | 3-5 developer days |

---

## References

- Target Architecture: [2025-11-26-arch.md](./2025-11-26-arch.md)
- Current Implementation: `lib/rest-api-gateway.ts`, `docker/src/app.py`
- AWS Lambda Authorizers: <https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-use-lambda-authorizer.html>
- Benchling SDK: <https://github.com/benchling/benchling-sdk>
- Defense-in-Depth: <https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/defense-in-depth.html>
