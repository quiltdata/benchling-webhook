# IP Whitelisting Implementation Tasks

**Date:** 2025-12-02
**Status:** Implementation Required
**Priority:** High

## Current State Analysis

### What Works ✅
1. Profile configuration storage (`security.webhookAllowList` in `~/.config/benchling-webhook/{profile}/config.json`)
2. Configuration loading in deploy command (`bin/commands/deploy.ts`)
3. Environment variable passing to CDK subprocess (`WEBHOOK_ALLOW_LIST`)
4. CDK app reads environment variable (`bin/benchling-webhook.ts:207`)
5. Config propagates to REST API Gateway construct (`lib/rest-api-gateway.ts:36`)
6. IP parsing logic extracts allowlist into array (`lib/rest-api-gateway.ts:37-40`)
7. Detection and logging of enabled state (`lib/rest-api-gateway.ts:56-59`)

### What Does NOT Work ❌
1. **Resource policy statements** - Currently ALLOW all IPs regardless of allowlist
2. **Health endpoint exemption** - No separate policy statement for health checks
3. **Deployment verification** - No automated test that IP filtering actually blocks requests
4. **Access log analysis** - No documentation on how to verify IP filtering in logs
5. **Integration tests** - Existing tests do NOT verify IP filtering behavior
6. **Unit tests** - Do NOT validate resource policy IP conditions are created

---

## Implementation Tasks

### Task 1: Implement Resource Policy IP Filtering

**File:** `lib/rest-api-gateway.ts`

**Current Behavior:**
- Lines 45-53 create a SINGLE policy statement that allows ALL principals
- When `allowedIps.length > 0`, logs show "ENABLED" but policy still allows everyone
- Resource policy is built but has no IP conditions

**Required Behavior:**
- When `allowedIps.length === 0`: Allow all IPs (current behavior, no changes)
- When `allowedIps.length > 0`: Build resource policy with IP conditions

**Policy Structure Required:**
1. **Statement 1: Health Endpoints** (always accessible from any IP)
   - Effect: ALLOW
   - Principal: *
   - Action: execute-api:Invoke
   - Resource: Specific ARN patterns for health endpoints
   - Paths: `*/GET/health`, `*/GET/health/ready`, `*/GET/health/live`
   - NO IP conditions

2. **Statement 2: Webhook Endpoints** (IP restricted when allowlist configured)
   - Effect: ALLOW
   - Principal: *
   - Action: execute-api:Invoke
   - Resource: Specific ARN patterns for webhook endpoints
   - Paths: `*/POST/event`, `*/POST/lifecycle`, `*/POST/canvas`
   - Condition: IpAddress with aws:SourceIp matching allowedIps array

**What to Build:**
- Replace single "allow all" statement with conditional logic
- When allowlist empty: keep current single statement
- When allowlist configured: build two statements (health exempt, webhooks restricted)
- Use CDK IAM constructs to create condition objects
- Match resource ARN format: `execute-api:/*/{stage}/{method}/{path}`

**Reference:**
- See spec 11-arch-30.md lines 142-162 for policy structure example
- API Gateway resource ARN format: `arn:aws:execute-api:region:account:api-id/stage-name/HTTP-VERB/resource-path`

---

### Task 2: Update Unit Tests to Validate IP Filtering

**File:** `test/rest-api-gateway.test.ts`

**Current Behavior:**
- Test at line 195 "creates resource policy with IP filtering when webhookAllowList is configured"
- Test passes even though IP filtering is NOT actually implemented
- Test only checks that a policy exists with ANY allow statement
- Test does NOT verify IP conditions are present

**Required Tests:**

#### Test 2.1: Verify No IP Filtering When Allowlist Empty
- Create RestApiGateway with config.security.webhookAllowList = "" or undefined
- Assert resource policy has single statement allowing all IPs
- Assert NO IpAddress conditions exist
- Assert all endpoints accessible

#### Test 2.2: Verify IP Filtering When Allowlist Configured
- Create RestApiGateway with config.security.webhookAllowList = "192.168.1.0/24,10.0.0.0/8"
- Assert resource policy has TWO statements:
  - Statement 1: Health endpoints with NO IP conditions
  - Statement 2: Webhook endpoints WITH IpAddress condition
- Assert IpAddress condition contains correct CIDR blocks
- Assert condition uses "aws:SourceIp" key

#### Test 2.3: Verify Health Endpoints Always Accessible
- Create RestApiGateway with IP allowlist
- Assert resource policy statement for health endpoints
- Assert NO IpAddress condition on health statement
- Assert health endpoint resources match: `*/GET/health*`

#### Test 2.4: Verify Webhook Endpoints Are Restricted
- Create RestApiGateway with IP allowlist
- Assert resource policy statement for webhook endpoints
- Assert IpAddress condition exists
- Assert webhook endpoint resources match: `*/POST/event`, `*/POST/lifecycle`, `*/POST/canvas`

**What to Test:**
- Extract policy statements from CloudFormation template
- Validate statement count (1 vs 2 depending on allowlist)
- Validate condition structure using CDK assertions
- Validate IP CIDR blocks match config input

---

### Task 3: Add Integration Test for IP Filtering

**File:** `test/integration/ip-filtering.test.ts` (new file)

**What to Test:**

#### Test 3.1: Deploy Stack with IP Allowlist
- Deploy stack with webhookAllowList configured to test IP (e.g., GitHub Actions runner IP)
- Verify stack deployment succeeds
- Verify API Gateway resource policy is created

#### Test 3.2: Verify Blocked IP Returns 403
- Deploy stack with webhookAllowList = "192.0.2.0/24" (TEST-NET-1, definitely not our IP)
- Send webhook request from test environment (different IP)
- Assert response is 403 Forbidden
- Assert response comes from API Gateway (not FastAPI)
- Assert CloudWatch access logs show 403 from resource policy

#### Test 3.3: Verify Allowed IP Returns 200 or 401
- Deploy stack with webhookAllowList including test environment IP
- Send webhook request with INVALID HMAC signature
- Assert response is NOT 403 from IP filtering
- Assert response is 403 from FastAPI HMAC verification (different layer)
- This proves IP filtering passed, HMAC verification failed

#### Test 3.4: Verify Health Endpoint Always Accessible
- Deploy stack with restrictive IP allowlist
- Send GET /health from IP NOT in allowlist
- Assert response is 200 OK
- This proves health endpoints exempt from IP filtering

**How to Get Test IP:**
- In GitHub Actions: Use `curl -s https://api.ipify.org` to get runner IP
- In local test: Use `curl -s https://api.ipify.org` to get local IP
- Pass as environment variable to test

**Required Setup:**
- Test must deploy real stack (not mocked)
- Test must have AWS credentials
- Test must clean up stack after completion
- Test should be in CI/CD pipeline (GitHub Actions)

---

### Task 4: Add Logging and Observability

**File:** `lib/rest-api-gateway.ts`

**Current Logging:**
- Line 57: Logs "Resource Policy IP filtering: ENABLED"
- Line 58: Logs allowed IPs
- Line 59: WARNING message (should be removed when implemented)

**Required Logging:**

#### During CDK Synthesis (console.log)
- When allowlist empty: "Resource Policy IP filtering: DISABLED (all IPs allowed)"
- When allowlist configured:
  - "Resource Policy IP filtering: ENABLED"
  - "Allowed IPs: [list]"
  - "Health endpoints exempt from IP filtering (always accessible)"
  - Number of policy statements created
- Remove WARNING about "not yet fully working"

#### CloudWatch Access Logs
- Access logs already configured at line 75-86
- Verify logs include:
  - Source IP (`$context.identity.sourceIp`)
  - HTTP method (`$context.httpMethod`)
  - Resource path (`$context.resourcePath`)
  - Status code (`$context.status`)
  - Integration status (`$context.integrationStatus`)

**What to Add:**
- Enhanced synthesis logging showing exact policy structure
- Documentation on how to query CloudWatch Logs for 403 responses
- Documentation on distinguishing API Gateway 403 (IP blocked) vs FastAPI 403 (HMAC failed)

---

### Task 5: Add Documentation for IP Filtering

**Files:**
- `CLAUDE.md` - Update security model section
- `README.md` - Add IP filtering configuration example
- `spec/2025-11-26-architecture/11-arch-30.md` - Update with implementation status

**Required Documentation:**

#### Configuration Guide
- How to set webhookAllowList in profile config
- Format: comma-separated CIDR blocks
- Example: `"192.168.1.0/24,10.0.0.0/8"`
- Single IP format: `"203.0.113.5/32"`

#### Troubleshooting Guide
- How to verify IP filtering is active (check CDK synthesis logs)
- How to test from allowed IP
- How to check CloudWatch access logs for 403s
- How to distinguish API Gateway 403 vs FastAPI 403
- Common issues:
  - Benchling IP not in allowlist
  - CIDR notation errors
  - Testing from wrong IP

#### Operational Guide
- How to add new IP to allowlist (update profile, redeploy)
- How to remove IP filtering (clear allowlist, redeploy)
- How to audit blocked requests (CloudWatch Logs Insights queries)
- How to verify health endpoints remain accessible

---

### Task 6: Add Deployment Verification

**File:** `bin/commands/deploy.ts`

**Current Behavior:**
- Lines 643-700 verify deployment succeeded and retrieve endpoint
- No verification of resource policy configuration
- No verification of IP filtering behavior

**Required Verification:**

#### Post-Deployment Checks
1. **Retrieve Deployed Resource Policy**
   - Query API Gateway resource policy via AWS SDK
   - Parse policy JSON
   - Verify structure matches expected (1 or 2 statements)

2. **Verify IP Conditions Present**
   - When webhookAllowList configured:
     - Assert resource policy contains IpAddress condition
     - Assert condition values match config
   - When webhookAllowList empty:
     - Assert no IP conditions

3. **Test Endpoint Accessibility**
   - Test health endpoint from any IP (should succeed)
   - If webhookAllowList configured:
     - Warn user to verify webhook endpoint from allowed IP
     - Provide curl command to test

**What to Add:**
- Post-deployment validation function
- API Gateway API calls to retrieve resource policy
- Policy structure verification
- User-friendly output showing IP filtering status

---

### Task 7: Add GitHub Actions CI Test

**File:** `.github/workflows/test-ip-filtering.yml` (new file)

**What to Test in CI:**

#### Workflow Steps
1. **Setup**
   - Check out code
   - Configure AWS credentials
   - Install dependencies

2. **Get Runner IP**
   - Run: `curl -s https://api.ipify.org`
   - Store in environment variable: `RUNNER_IP`

3. **Deploy with IP Filtering**
   - Create profile config with webhookAllowList = "$RUNNER_IP/32"
   - Run: `npm run deploy:dev -- --profile ci-test`
   - Verify deployment succeeds

4. **Test Health Endpoint (No IP Restriction)**
   - GET https://{endpoint}/dev/health
   - Assert 200 OK
   - Verify accessible from any IP

5. **Test Webhook Endpoint (Invalid HMAC)**
   - POST https://{endpoint}/dev/event with invalid signature
   - Assert response is 403 from FastAPI (not API Gateway)
   - This proves IP filtering passed

6. **Cleanup**
   - Destroy stack
   - Delete profile config

**Required:**
- Use GitHub Actions secrets for AWS credentials
- Use temporary profile (not default)
- Clean up resources on failure
- Run on PR and main branch

---

## Acceptance Criteria

### Criterion 1: Resource Policy Implementation ✓
- [ ] When `webhookAllowList` is empty: Single policy statement allows all IPs
- [ ] When `webhookAllowList` is configured: Two policy statements created
- [ ] Health endpoints (GET /health*) always accessible from any IP
- [ ] Webhook endpoints (POST /event, /lifecycle, /canvas) restricted to allowlist IPs
- [ ] Resource policy uses correct IpAddress condition with aws:SourceIp

### Criterion 2: Unit Test Coverage ✓
- [ ] Test validates policy has NO IP conditions when allowlist empty
- [ ] Test validates policy has IP conditions when allowlist configured
- [ ] Test validates health endpoints exempt from IP filtering
- [ ] Test validates webhook endpoints have IP restrictions
- [ ] Test validates correct CIDR blocks in condition

### Criterion 3: Integration Test Coverage ✓
- [ ] Test deploys stack with IP allowlist
- [ ] Test verifies blocked IP returns 403 from API Gateway
- [ ] Test verifies allowed IP can reach FastAPI layer
- [ ] Test verifies health endpoint accessible from any IP
- [ ] Test runs in CI/CD pipeline

### Criterion 4: Logging and Observability ✓
- [ ] CDK synthesis logs show clear IP filtering status
- [ ] CloudWatch access logs capture source IP and status codes
- [ ] Documentation explains how to query logs for 403s
- [ ] Documentation explains difference between API Gateway 403 vs FastAPI 403

### Criterion 5: Documentation ✓
- [ ] Configuration guide with examples
- [ ] Troubleshooting guide for common issues
- [ ] Operational guide for managing allowlist
- [ ] Security model updated with implementation details

### Criterion 6: Deployment Verification ✓
- [ ] Post-deployment script retrieves and validates resource policy
- [ ] Verification confirms IP conditions match config
- [ ] User receives clear feedback on IP filtering status

### Criterion 7: CI/CD Testing ✓
- [ ] GitHub Actions workflow tests IP filtering
- [ ] Workflow verifies blocked IPs return 403
- [ ] Workflow verifies allowed IPs can access endpoints
- [ ] Workflow verifies health endpoints always accessible

---

## Dependencies

### AWS Resources Required
- API Gateway REST API (already exists)
- CloudWatch Logs (already exists)
- AWS SDK API calls:
  - `apigateway:GetRestApi`
  - `apigateway:GetResources`
  - `apigateway:GetIntegration`
  - `logs:FilterLogEvents`

### External Services Required
- https://api.ipify.org (for getting test IP in CI)
- GitHub Actions runners (for CI testing)

### Existing Code to Review
- `lib/rest-api-gateway.ts` - Resource policy implementation
- `lib/types/config.ts` - SecurityConfig interface
- `test/rest-api-gateway.test.ts` - Existing unit tests
- `spec/2025-11-26-architecture/11-arch-30.md` - Architecture spec

---

## Risk Assessment

### High Risk
- **Breaking existing deployments**: If resource policy implementation is wrong, could block all traffic
  - Mitigation: Test thoroughly with allowlist empty first
  - Mitigation: Deploy to dev environment first
  - Mitigation: Keep health endpoints always accessible

### Medium Risk
- **CIDR notation errors**: Users might misconfigure allowlist
  - Mitigation: Add validation in setup wizard
  - Mitigation: Document common formats
  - Mitigation: Show examples in error messages

### Low Risk
- **CloudFormation update issues**: Resource policy change might require replacement
  - Mitigation: Test policy updates on existing stacks
  - Mitigation: Document update process

---

## Testing Strategy

### Phase 1: Local Development
1. Implement resource policy logic
2. Run unit tests locally
3. Deploy to personal dev stack
4. Manually test with curl from different IPs

### Phase 2: Integration Testing
1. Write integration tests
2. Run against dev stack
3. Verify blocked IPs return 403
4. Verify health endpoints accessible

### Phase 3: CI/CD
1. Add GitHub Actions workflow
2. Run on PR
3. Verify automated testing works
4. Merge to main

### Phase 4: Production Validation
1. Deploy to prod with IP allowlist
2. Monitor CloudWatch logs
3. Verify Benchling webhooks succeed
4. Verify unknown IPs blocked

---

## Rollback Plan

If IP filtering implementation causes issues:

1. **Immediate**: Set `webhookAllowList = ""` in profile config and redeploy
   - This reverts to "allow all IPs" behavior
   - FastAPI HMAC verification still active

2. **Code Rollback**: Revert commits implementing resource policy IP conditions
   - Keep environment variable passing (already working)
   - Revert to previous "allow all" policy

3. **Emergency**: Remove resource policy entirely
   - Modify REST API to have no policy
   - Still have HMAC verification as security layer

---

## Success Metrics

1. **Functionality**: IP filtering blocks requests from non-allowlisted IPs
2. **Performance**: No latency increase (policy evaluated at edge)
3. **Cost**: No additional cost (resource policies are free)
4. **Security**: HMAC verification still works as primary auth layer
5. **Observability**: Can identify blocked requests in CloudWatch logs
6. **Reliability**: Health endpoints remain accessible for monitoring

---

## Related Specifications

- [11-arch-30.md](./11-arch-30.md) - REST API v1 + Resource Policy architecture
- [15-webhook-allowlist-investigation.md](./15-webhook-allowlist-investigation.md) - Configuration flow investigation
- [16-webhook-allowlist-fix.md](./16-webhook-allowlist-fix.md) - Environment variable passing fix
