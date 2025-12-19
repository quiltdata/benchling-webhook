# Production Incident Audit - Secrets Manager Issue #156

**Date**: 2025-10-31
**Incident**: CDK Deployment Hung for 40+ Minutes
**Branch**: 156-secrets-manager
**Severity**: HIGH - Deployment failure in production environment

---

## Executive Summary

During a development deployment using `npm run cdk:dev`, the CloudFormation stack deployment hung for over 40 minutes on an ECS Service update. Investigation revealed a **critical bug** in the secrets management implementation: **the `app_definition_id` field is not being included when using the legacy (old) parameter path**, causing ECS tasks to fail to start repeatedly.

### Impact

- **Deployment Time**: 40+ minutes of hung deployment (expected: 5-10 minutes)
- **Resource State**: CloudFormation stack stuck in UPDATE_IN_PROGRESS
- **Service Availability**: New tasks failing to start, 1 old task running, 1 task perpetually failing
- **Root Cause**: Missing `app_definition_id` in Secrets Manager secret when using legacy CLI parameters

---

## Timeline of Events

| Time | Event |
| ------ | ------- |
| 23:47:57 | CloudFormation UPDATE_IN_PROGRESS initiated |
| 23:48:02 | Secrets Manager secret updated (INCOMPLETE DATA) |
| 23:48:08 | ECS Task Definition created successfully |
| 23:48:10 | ECS Service update started |
| 23:48:10 - 00:29:00 | **ECS Service stuck** - tasks repeatedly failing with "app_definition_id" missing error |
| 00:29:00 | Investigation began - identified ECS service stuck |
| 00:30:00 | Root cause identified - missing `app_definition_id` in secret |
| 00:31:30 | Manual fix applied - added `app_definition_id` to secret |
| 00:32:14 | Secret overwritten again by CloudFormation (bug confirmed) |
| 00:32:29 | New task started (but will fail due to incomplete secret) |

---

## Root Cause Analysis

### The Bug

**Location**: `lib/fargate-service.ts`, lines 166-171

```typescript
// Old approach: Build JSON from individual parameters
secretValue = JSON.stringify({
    client_id: props.benchlingClientId,
    client_secret: props.benchlingClientSecret,
    tenant: props.benchlingTenant,
});
```

**Problem**: When the legacy parameter path is used (not using `--benchling-secrets`), the code only creates a secret with 3 fields:
1. `client_id`
2. `client_secret`
3. `tenant`

**Missing**: `app_definition_id` - which is REQUIRED by the ECS task runtime

### Why It Happened

1. **Legacy Code Path**: The CLI deployment (`npm run cdk:dev` → `bin/dev-deploy.ts` → `bin/cli.ts`) does NOT use the new `--benchling-secrets` parameter
2. **Fallback to Old Parameters**: It falls back to individual parameters (`BENCHLING_TENANT`, `BENCHLING_CLIENT_ID`, `BENCHLING_CLIENT_SECRET`)
3. **Incomplete Secret Creation**: The `fargate-service.ts` code builds the secret JSON with only 3 fields when using the old path
4. **CloudFormation Overwrites**: Every deployment updates the secret, overwriting any manual fixes

### ECS Task Failure Loop

```
ECS attempts to start task
  → Tries to fetch secret from Secrets Manager
  → Secret validation fails: "app_definition_id" key not found
  → Task fails with ResourceInitializationError
  → ECS retries after delay
  → [REPEAT INDEFINITELY]
```

**Result**: CloudFormation waits for ECS service to stabilize, but it never does because tasks keep failing.

---

## Evidence

### 1. ECS Service Events (from AWS CLI)

```
(service benchling-webhook-service) was unable to place a task.
Reason: ResourceInitializationError: unable to pull secrets or registry auth:
execution resource retrieval failed: unable to retrieve secret from asm:
service call has been retried 1 time(s): retrieved secret from Secrets Manager
did not contain json key app_definition_id.
```

**Occurred**: Every ~5 minutes from 23:48:10 to 00:30:00+ (40+ minutes)

### 2. Secret Contents (Incomplete)

**After CloudFormation deployment**:
```json
{
  "client_id": "wqFfVOhbYe",
  "client_secret": "6NUPNtpWP7fXY-n-Vvoc-A"
}
```

**Expected** (based on deployment plan and container requirements):
```json
{
  "client_id": "wqFfVOhbYe",
  "client_secret": "6NUPNtpWP7fXY-n-Vvoc-A",
  "tenant": "quilt-dtt",
  "app_definition_id": "appdef_wqFfaXBVMu"
}
```

**Note**: Even `tenant` was missing in the final secret, suggesting the JSON serialization may have additional issues.

### 3. Code Evidence

**File**: `lib/fargate-service.ts:166-171`

The bug is clearly visible in the code - the legacy path only includes 3 fields when building the secret JSON.

### 4. Secret Version History

```
Version ID                           Created                           Status
fa5df70c-41c8-acc2-90ee-0e81c0c9c058 2025-10-31T17:32:14 (after manual fix) AWSCURRENT
76e9e453-e9f1-4c3c-99b2-251748a259b9 2025-10-31T17:31:30 (manual fix attempt) AWSPREVIOUS
```

The manual fix at 17:31:30 was immediately overwritten at 17:32:14 by the CloudFormation deployment, confirming the bug.

---

## Impact Assessment

### Immediate Impact

1. **Deployment Failure**: Development deployment hung for 40+ minutes
2. **Developer Productivity**: Development workflow blocked
3. **Resource Costs**: AWS resources running in failed state for extended period
4. **CloudFormation State**: Stack stuck requiring manual intervention or timeout

### Potential Production Impact

**CRITICAL**: If this code were deployed to production:

1. **Service Outage**: New deployments would fail, preventing updates and rollbacks
2. **Stuck Deployments**: CloudFormation stacks would hang indefinitely
3. **Data Loss Risk**: Failed rollbacks could leave systems in inconsistent states
4. **Extended Downtime**: 40+ minute deployment failures would significantly impact SLAs

---

## Why This Wasn't Caught

### 1. Incomplete Testing Coverage

**Review of**: `spec/156-secrets-manager/TESTING_SUMMARY.md`

The testing summary claims:
- ✅ "All tests passing"
- ✅ "Production ready"
- ✅ "Comprehensive documentation"

**However**: No integration test validated that the secret created by CloudFormation actually contains ALL required fields when using the legacy parameter path.

### 2. Missing Integration Test Scenario

**Gap**: No test for "Deploy using legacy parameters and verify secret completeness"

**Recommended Test** (not implemented):
```typescript
describe('CDK Deployment with Legacy Parameters', () => {
  it('should include app_definition_id in secret when using old parameters', async () => {
    const stack = new BenchlingWebhookStack(app, 'TestStack', {
      // Use OLD parameters (not benchlingSecrets)
      benchlingClientId: 'test-id',
      benchlingClientSecret: 'test-secret',
      benchlingTenant: 'test-tenant',
      benchlingAppDefinitionId: 'appdef_test',
      // ... other params
    });

    const template = Template.fromStack(stack);
    const secretValue = extractSecretValueFromTemplate(template);
    const parsedSecret = JSON.parse(secretValue);

    expect(parsedSecret).toHaveProperty('client_id');
    expect(parsedSecret).toHaveProperty('client_secret');
    expect(parsedSecret).toHaveProperty('tenant');
    expect(parsedSecret).toHaveProperty('app_definition_id'); // ❌ WOULD FAIL
  });
});
```

### 3. Documentation Gap

**File**: `lib/fargate-service.ts:12-37`

The `FargateServiceProps` interface includes:
- `benchlingClientId`: ✅ Present
- `benchlingClientSecret`: ✅ Present
- `benchlingTenant`: ✅ Present
- `benchlingAppDefinitionId`: **❌ MISSING**

**Issue**: There's no prop for `benchlingAppDefinitionId` in the legacy path, so it can't be included in the secret even if we wanted to.

### 4. Workflow Disconnect

**Review of**: `spec/156-secrets-manager/FINAL_INTEGRATION_SUMMARY.md`

The document states:
- Phase 3: "CDK Secret Handling Refactoring ✅ COMPLETE"
- "Test Coverage: 80%+"
- "Backward compatibility maintained"

**Reality**: Backward compatibility is NOT maintained - the legacy path is broken.

---

## Findings and Recommendations

### Finding #1: Critical Bug in Legacy Parameter Path

**Severity**: CRITICAL
**Status**: Not fixed
**Location**: `lib/fargate-service.ts:166-171`

**Issue**: Secret creation in legacy path is incomplete

**Recommendation**:
1. Add `benchlingAppDefinitionId?: string` to `FargateServiceProps` interface
2. Update secret JSON creation to include `app_definition_id` when prop is provided
3. Update `benchling-webhook-stack.ts` to pass `benchlingAppDefinitionId` parameter to Fargate service

**Code Fix**:
```typescript
// lib/fargate-service.ts:167-171
secretValue = JSON.stringify({
    client_id: props.benchlingClientId,
    client_secret: props.benchlingClientSecret,
    tenant: props.benchlingTenant,
    ...(props.benchlingAppDefinitionId && {
        app_definition_id: props.benchlingAppDefinitionId
    }),
});
```

### Finding #2: Missing Integration Test

**Severity**: HIGH
**Status**: Not implemented
**Gap**: No end-to-end validation of secret completeness

**Recommendation**: Add integration test that:
1. Deploys stack using legacy parameters
2. Reads the created Secrets Manager secret
3. Validates ALL required fields are present
4. Validates ECS task can start successfully

**Test Location**: `test/integration/legacy-parameters.test.ts` (to be created)

### Finding #3: False Confidence from Testing Summary

**Severity**: MEDIUM
**Status**: Documentation misleading
**Issue**: Testing summary claims "production ready" without sufficient validation

**Recommendation**:
1. Update `TESTING_SUMMARY.md` with findings from this audit
2. Add "Known Issues" section documenting this bug
3. Change status from "Production Ready" to "Requires Integration Testing"
4. Add checklist item: "Validate secret completeness in all parameter paths"

### Finding #4: Missing Property in Interface

**Severity**: HIGH
**Status**: Design flaw
**Issue**: `FargateServiceProps` doesn't include `benchlingAppDefinitionId`

**Recommendation**:
1. Add `readonly benchlingAppDefinitionId?: string` to `FargateServiceProps`
2. Update `benchling-webhook-stack.ts` to read and pass the parameter
3. Update documentation to reflect this requirement

### Finding #5: Development Workflow Uses Legacy Path

**Severity**: MEDIUM
**Status**: Workflow issue
**Issue**: `npm run cdk:dev` doesn't use new `--benchling-secrets` parameter

**Recommendation**:
1. Update `bin/dev-deploy.ts` to construct and use `--benchling-secrets` parameter
2. Alternative: Add integration test that specifically tests the legacy path
3. Document which paths are tested and which are not

### Finding #6: Secret Validation Not Runtime-Enforced

**Severity**: MEDIUM
**Status**: Missing validation
**Issue**: Container doesn't validate secret completeness at startup

**Recommendation**:
1. Add container startup validation that checks for required fields
2. Fail fast with clear error message if fields are missing
3. Log which fields are present vs. required for debugging

---

## Immediate Action Items

### Priority 1: Fix the Bug

- [ ] Add `benchlingAppDefinitionId` prop to `FargateServiceProps` interface
- [ ] Update secret JSON creation in legacy path to include `app_definition_id`
- [ ] Pass `benchlingAppDefinitionId` from stack to Fargate service construct
- [ ] Verify fix with unit test

### Priority 2: Add Integration Test

- [ ] Create integration test for legacy parameter path
- [ ] Test validates secret completeness after CloudFormation deployment
- [ ] Test validates ECS task can start with the secret
- [ ] Add to CI/CD pipeline

### Priority 3: Update Documentation

- [ ] Add "Production Incident" section to testing summary
- [ ] Document the bug and fix in CHANGELOG
- [ ] Update FINAL_INTEGRATION_SUMMARY with audit findings
- [ ] Add warning about legacy parameter path to README

### Priority 4: Verify Runtime

- [ ] Add container startup validation for required secret fields
- [ ] Add health check that validates secret configuration
- [ ] Log secret source and validation status at startup

---

## Long-Term Recommendations

### 1. Deprecate Legacy Path Faster

**Current Timeline**: v1.0.0 (6-12 months)
**Recommended**: v0.7.0 (1-2 months)

**Rationale**: The legacy path is buggy and hard to maintain. Accelerate deprecation to reduce technical debt.

### 2. Add Contract Tests

Implement contract testing between:
- CLI parameter → CloudFormation parameters
- CloudFormation parameters → Secrets Manager secret
- Secrets Manager secret → Container environment variables
- Container environment → Application configuration

### 3. Implement Chaos Engineering

Test scenarios like:
- Incomplete secrets
- Missing secret fields
- Wrong secret format
- Secret rotation during deployment
- CloudFormation rollback scenarios

### 4. Add Deployment Validation Gate

Before allowing CloudFormation deployment:
1. Validate stack synthesis
2. Validate secret format in synthesized template
3. Validate all required parameters are present
4. Run smoke tests against synthesized resources

### 5. Improve Monitoring

- Add CloudWatch alarm for ECS task launch failures
- Add custom metric for secret validation failures
- Alert on CloudFormation deployments exceeding expected duration
- Dashboard showing secret health across environments

---

## Lessons Learned

### What Went Wrong

1. **Insufficient Integration Testing**: Unit tests passed, but end-to-end scenario was not validated
2. **False Confidence**: Documentation claimed "production ready" without complete validation
3. **Legacy Path Neglected**: Focus on new parameter path left legacy path broken
4. **No Runtime Validation**: Container doesn't validate secret completeness at startup
5. **Missing Health Checks**: No monitoring for secret configuration issues

### What Went Right

1. **Problem Detection**: Issue was caught in development before production impact
2. **Debugging Tools**: AWS CLI commands helped identify root cause quickly
3. **Documentation**: Spec documents helped understand intended behavior
4. **Rollback Safety**: Issue occurred in development, no production impact

### Process Improvements

1. **Definition of Done**: Add "integration tested" to DoD checklist
2. **Testing Strategy**: Require end-to-end validation of all code paths
3. **Review Process**: Require reviewer to validate testing coverage
4. **Deployment Gates**: Add automated validation before deployments
5. **Monitoring**: Implement proactive monitoring for secret issues

---

## Conclusion

This incident revealed a **critical bug** in the secrets management implementation that would have caused **production outages** if deployed. The bug is in the legacy parameter path which creates incomplete secrets missing the required `app_definition_id` field.

**Status**: 🔴 **BLOCKED FOR PRODUCTION**

**Required Before Merge**:
1. ✅ Bug identified and root cause documented (this audit)
2. ❌ Bug fixed and verified with tests
3. ❌ Integration test added
4. ❌ Documentation updated
5. ❌ Runtime validation added

**Estimated Time to Fix**: 2-4 hours
**Risk Level**: HIGH if deployed without fix

---

**Audit Performed By**: AI Code Assistant
**Date**: 2025-10-31
**Next Review**: After bug fix implementation
**Sign-off Required**: Technical Lead, QA Lead

