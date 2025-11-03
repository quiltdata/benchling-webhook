# Phase 3: CDK Secret Handling Refactoring - Implementation Checklist

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Date**: 2025-10-31
**Phase**: Phase 3 - CDK Secret Handling Refactoring

## Overview

This checklist provides granular, trackable tasks for implementing Phase 3. Each task corresponds to atomic changes defined in the episodes document. Use `[x]` to mark completed tasks.

## Reference Documents

- **Design**: spec/156-secrets-manager/11-phase3-design.md
- **Episodes**: spec/156-secrets-manager/12-phase3-episodes.md
- **Phases**: spec/156-secrets-manager/04-phases.md (Phase 3)

---

## Pre-Implementation Setup

### Environment Validation

- [ ] Confirm on correct branch: `156-secrets-manager`
- [ ] Pull latest changes: `git pull origin 156-secrets-manager`
- [ ] Install dependencies: `npm install`
- [ ] Verify tests pass: `make test`
- [ ] Verify lint passes: `make lint`
- [ ] Verify build succeeds: `npm run build`

### Documentation Review

- [ ] Read Phase 3 design document (11-phase3-design.md)
- [ ] Read Phase 3 episodes document (12-phase3-episodes.md)
- [ ] Understand backward compatibility requirements
- [ ] Review current CloudFormation parameter structure
- [ ] Review current Secrets Manager secret creation

---

## Episode 1: Add CloudFormation Parameter Tests (RED)

### Test Implementation

- [ ] Open `test/benchling-webhook-stack.test.ts`
- [ ] Add test: "creates BenchlingSecrets CloudFormation parameter"
  - [ ] Check parameter exists
  - [ ] Verify Type is "String"
  - [ ] Verify NoEcho is true
  - [ ] Verify Description contains "Benchling secrets"
- [ ] Add test: "marks old Benchling parameters as deprecated"
  - [ ] Check BenchlingClientId exists
  - [ ] Check BenchlingClientSecret exists
  - [ ] Check BenchlingTenant exists
  - [ ] Verify all descriptions contain "[DEPRECATED]"
- [ ] Add test: "old secret parameters have NoEcho enabled"
  - [ ] Verify BenchlingClientId has NoEcho true
  - [ ] Verify BenchlingClientSecret has NoEcho true

### Verification

- [ ] Run tests: `npm test -- benchling-webhook-stack.test.ts`
- [ ] Verify 3 new tests fail (RED phase)
- [ ] Verify existing tests still pass
- [ ] Verify no syntax errors

### Commit

- [ ] Stage changes: `git add test/benchling-webhook-stack.test.ts`
- [ ] Commit with message:
  ```
  test: add CloudFormation parameter tests for Phase 3

  Add failing tests for:
  - New BenchlingSecrets parameter with noEcho
  - Old parameters marked as deprecated
  - Security settings on old parameters

  Part of Phase 3 Episode 1 (RED phase)

  Relates to #156
  ```
- [ ] Push to branch: `git push origin 156-secrets-manager`

---

## Episode 2: Implement CloudFormation Parameters (GREEN)

### Stack Parameter Implementation

- [ ] Open `lib/benchling-webhook-stack.ts`
- [ ] Locate existing parameter definitions (around line 49)
- [ ] Add new `BenchlingSecrets` parameter after line 116:
  - [ ] Set type to "String"
  - [ ] Set description with clear explanation
  - [ ] Set default to "" (empty string)
  - [ ] Set noEcho to true
- [ ] Add deprecated `BenchlingClientId` parameter:
  - [ ] Set type to "String"
  - [ ] Set description with "[DEPRECATED]" prefix
  - [ ] Set default to ""
  - [ ] Set noEcho to true
- [ ] Add deprecated `BenchlingClientSecret` parameter:
  - [ ] Set type to "String"
  - [ ] Set description with "[DEPRECATED]" prefix
  - [ ] Set default to ""
  - [ ] Set noEcho to true
- [ ] Add deprecated `BenchlingTenant` parameter:
  - [ ] Set type to "String"
  - [ ] Set description with "[DEPRECATED]" prefix
  - [ ] Set default using props.benchlingTenant fallback
- [ ] Get parameter values as strings:
  - [ ] benchlingSecretsValue
  - [ ] benchlingClientIdValue
  - [ ] benchlingClientSecretValue
  - [ ] benchlingTenantValueNew

### Verification

- [ ] Run tests: `npm test -- benchling-webhook-stack.test.ts`
- [ ] Verify Episode 1 tests now pass (GREEN)
- [ ] Verify all existing tests still pass
- [ ] Run lint: `make lint`
- [ ] Fix any lint errors
- [ ] Verify build: `npm run build`

### Commit

- [ ] Stage changes: `git add lib/benchling-webhook-stack.ts`
- [ ] Commit with message:
  ```
  feat: add BenchlingSecrets CloudFormation parameter

  Add new consolidated parameter for Benchling secrets:
  - BenchlingSecrets parameter with noEcho enabled
  - Mark old parameters as deprecated
  - Maintain backward compatibility

  Part of Phase 3 Episode 2 (GREEN phase)

  Relates to #156
  ```
- [ ] Push to branch: `git push origin 156-secrets-manager`

---

## Episode 3: Add Secrets Manager Secret Creation Tests (RED)

### Test Implementation

- [ ] Open `test/benchling-webhook-stack.test.ts`
- [ ] Add test: "creates Secrets Manager secret without unsafePlainText"
  - [ ] Find AWS::SecretsManager::Secret resources
  - [ ] Verify secret Name is "benchling-webhook/credentials"
  - [ ] Verify SecretString is defined
- [ ] Add test: "task role has Secrets Manager read permissions"
  - [ ] Find AWS::IAM::Policy resources
  - [ ] Iterate through policy statements
  - [ ] Verify secretsmanager:GetSecretValue action exists

### Verification

- [ ] Run tests: `npm test -- benchling-webhook-stack.test.ts`
- [ ] Verify 2 new tests fail appropriately (RED)
- [ ] Verify existing tests still pass
- [ ] Verify no syntax errors

### Commit

- [ ] Stage changes: `git add test/benchling-webhook-stack.test.ts`
- [ ] Commit with message:
  ```
  test: add Secrets Manager creation tests for Phase 3

  Add failing tests for:
  - Secret created without unsafePlainText
  - Task role has secret read permissions

  Part of Phase 3 Episode 3 (RED phase)

  Relates to #156
  ```
- [ ] Push to branch: `git push origin 156-secrets-manager`

---

## Episode 4: Refactor Secrets Manager Secret Creation (GREEN)

### Update FargateService Props

- [ ] Open `lib/fargate-service.ts`
- [ ] Locate props interface (lines 12-31)
- [ ] Add `readonly benchlingSecrets?: string;` to props

### Update Secret Creation Logic

- [ ] Locate secret creation code (around line 148)
- [ ] Add logic to determine which parameter mode to use:
  - [ ] Check if benchlingSecrets is provided and non-empty
  - [ ] Set `useNewParam` boolean
- [ ] Create conditional secret value logic:
  - [ ] If useNewParam: use props.benchlingSecrets
  - [ ] If not: build JSON from individual props
- [ ] Update Secret constructor:
  - [ ] Use secretStringValue with cdk.SecretValue.unsafePlainText
  - [ ] Note: Still uses unsafePlainText but values are from noEcho params

### Update Stack to Pass Parameter

- [ ] Open `lib/benchling-webhook-stack.ts`
- [ ] Locate FargateService instantiation (around line 162)
- [ ] Add `benchlingSecrets: benchlingSecretsValue` to props

### Verification

- [ ] Run tests: `npm test -- benchling-webhook-stack.test.ts`
- [ ] Verify Episode 3 tests now pass (GREEN)
- [ ] Verify all existing tests still pass
- [ ] Run lint: `make lint`
- [ ] Fix any lint errors
- [ ] Verify build: `npm run build`

### Commit

- [ ] Stage changes: `git add lib/fargate-service.ts lib/benchling-webhook-stack.ts`
- [ ] Commit with message:
  ```
  feat: refactor Secrets Manager secret creation

  Update FargateService to accept benchlingSecrets parameter:
  - Add benchlingSecrets to props interface
  - Update secret creation to support both modes
  - Pass new parameter from stack to service

  Part of Phase 3 Episode 4 (GREEN phase)

  Relates to #156
  ```
- [ ] Push to branch: `git push origin 156-secrets-manager`

---

## Episode 5: Add Container Environment Tests (RED)

### Test Implementation

- [ ] Open `test/benchling-webhook-stack.test.ts`
- [ ] Add test: "container receives BENCHLING_SECRETS when new parameter provided"
  - [ ] Create new stack instance with benchlingSecrets
  - [ ] Set old params to empty strings
  - [ ] Generate template from stack
  - [ ] Find TaskDefinition resource
  - [ ] Extract container definition
  - [ ] Find BENCHLING_SECRETS in environment array
  - [ ] Assert it exists and has value
- [ ] Add test: "container receives individual vars when old parameters provided"
  - [ ] Use existing test stack (backward compatibility)
  - [ ] Verify BENCHLING_TENANT in environment
  - [ ] Verify BENCHLING_CLIENT_ID in secrets
  - [ ] Verify BENCHLING_CLIENT_SECRET in secrets

### Verification

- [ ] Run tests: `npm test -- benchling-webhook-stack.test.ts`
- [ ] Verify first test fails (RED)
- [ ] Verify second test passes (existing behavior)
- [ ] Verify no syntax errors

### Commit

- [ ] Stage changes: `git add test/benchling-webhook-stack.test.ts`
- [ ] Commit with message:
  ```
  test: add container environment tests for Phase 3

  Add tests for:
  - Container receives BENCHLING_SECRETS with new parameter
  - Container receives individual vars with old parameters

  Part of Phase 3 Episode 5 (RED phase)

  Relates to #156
  ```
- [ ] Push to branch: `git push origin 156-secrets-manager`

---

## Episode 6: Update Container Environment Configuration (GREEN)

### Update Container Environment Logic

- [ ] Open `lib/fargate-service.ts`
- [ ] Locate container environment section (around line 180)
- [ ] Add parameter mode detection:
  - [ ] Check if benchlingSecrets is non-empty
  - [ ] Set useNewParam boolean
- [ ] Build base environment variables object
- [ ] Add conditional Benchling configuration:
  - [ ] If useNewParam: add BENCHLING_SECRETS env var
  - [ ] If not: add BENCHLING_TENANT env var
- [ ] Build secrets configuration object:
  - [ ] If not useNewParam: add individual secrets from Secrets Manager
  - [ ] If useNewParam: leave secrets empty
- [ ] Update container definition:
  - [ ] Use environmentVars object
  - [ ] Use secretsConfig only if non-empty

### Verification

- [ ] Run tests: `npm test -- benchling-webhook-stack.test.ts`
- [ ] Verify Episode 5 tests now pass (GREEN)
- [ ] Verify all existing tests still pass
- [ ] Run lint: `make lint`
- [ ] Fix any lint errors
- [ ] Verify build: `npm run build`

### Commit

- [ ] Stage changes: `git add lib/fargate-service.ts`
- [ ] Commit with message:
  ```
  feat: update container environment for consolidated secrets

  Update container configuration to use BENCHLING_SECRETS:
  - Add BENCHLING_SECRETS env var when new param provided
  - Keep individual vars when old params used
  - Maintain backward compatibility

  Part of Phase 3 Episode 6 (GREEN phase)

  Relates to #156
  ```
- [ ] Push to branch: `git push origin 156-secrets-manager`

---

## Episode 7: Add Backward Compatibility Tests (RED)

### Test Implementation

- [ ] Open `test/benchling-webhook-stack.test.ts`
- [ ] Add test: "stack works with old parameters (backward compatibility)"
  - [ ] Create stack with only old parameters
  - [ ] Verify ECS Service created
  - [ ] Verify Secrets Manager Secret created
  - [ ] Verify container has BENCHLING_TENANT env var
- [ ] Add test: "new parameter takes precedence when both provided"
  - [ ] Create stack with both old and new parameters
  - [ ] Verify container has BENCHLING_SECRETS env var
  - [ ] Verify container does NOT have BENCHLING_TENANT env var
- [ ] Add test: "empty new parameter falls back to old parameters"
  - [ ] Create stack with empty benchlingSecrets
  - [ ] Provide old parameters
  - [ ] Verify container falls back to old parameter pattern

### Verification

- [ ] Run tests: `npm test -- benchling-webhook-stack.test.ts`
- [ ] Document which tests pass and which fail
- [ ] Verify test logic is correct
- [ ] Verify no syntax errors

### Commit

- [ ] Stage changes: `git add test/benchling-webhook-stack.test.ts`
- [ ] Commit with message:
  ```
  test: add backward compatibility tests for Phase 3

  Add comprehensive tests for:
  - Stack works with old parameters only
  - New parameter takes precedence
  - Empty new parameter falls back to old

  Part of Phase 3 Episode 7 (RED phase)

  Relates to #156
  ```
- [ ] Push to branch: `git push origin 156-secrets-manager`

---

## Episode 8: Implement Backward Compatibility Logic (GREEN)

### Review and Fix

- [ ] Review Episode 7 test results
- [ ] Identify any failing tests
- [ ] Open `lib/fargate-service.ts`
- [ ] Verify parameter precedence logic:
  - [ ] Non-empty benchlingSecrets → new mode
  - [ ] Empty/undefined benchlingSecrets → old mode
- [ ] Verify secret creation handles both modes correctly
- [ ] Verify container environment is correct for both modes
- [ ] Fix any issues found

### Verification

- [ ] Run tests: `npm test -- benchling-webhook-stack.test.ts`
- [ ] Verify ALL Episode 7 tests pass (GREEN)
- [ ] Verify all existing tests still pass
- [ ] Run lint: `make lint`
- [ ] Fix any lint errors
- [ ] Verify build: `npm run build`

### Commit

- [ ] Stage changes: `git add lib/fargate-service.ts`
- [ ] Commit with message:
  ```
  feat: ensure backward compatibility for secret parameters

  Refine parameter precedence logic:
  - New parameter takes precedence when non-empty
  - Empty new parameter falls back to old
  - Both modes create valid configurations

  Part of Phase 3 Episode 8 (GREEN phase)

  Relates to #156
  ```
- [ ] Push to branch: `git push origin 156-secrets-manager`

---

## Episode 9: Update Deploy Command Parameter Passing

### Update Deploy Command

- [ ] Open `bin/commands/deploy.ts`
- [ ] Locate parameter building section (around line 259)
- [ ] Add conditional logic for Benchling parameters:
  - [ ] If config.benchlingSecrets exists: add BenchlingSecrets parameter
  - [ ] Else: add old parameters (BenchlingTenant, BenchlingClientId, BenchlingClientSecret)
- [ ] Ensure proper escaping for CloudFormation parameter values

### Verification

- [ ] Run lint: `make lint`
- [ ] Fix any lint errors
- [ ] Verify build: `npm run build`
- [ ] Review parameter passing logic for correctness

### Commit

- [ ] Stage changes: `git add bin/commands/deploy.ts`
- [ ] Commit with message:
  ```
  feat: update deploy command for new parameter structure

  Update parameter passing logic:
  - Pass BenchlingSecrets when available
  - Fall back to old parameters for compatibility
  - Maintain validation and deprecation warnings

  Part of Phase 3 Episode 9

  Relates to #156
  ```
- [ ] Push to branch: `git push origin 156-secrets-manager`

---

## Episode 10: Final Refactoring and Cleanup (REFACTOR)

### Code Review and Cleanup

- [ ] Review `lib/benchling-webhook-stack.ts`:
  - [ ] Remove unused imports
  - [ ] Add JSDoc comments for new parameters
  - [ ] Ensure consistent formatting
  - [ ] Update props interface documentation
- [ ] Review `lib/fargate-service.ts`:
  - [ ] Remove unused imports
  - [ ] Add JSDoc comments for parameter logic
  - [ ] Ensure consistent formatting
  - [ ] Document parameter precedence
- [ ] Review `bin/commands/deploy.ts`:
  - [ ] Remove unused imports
  - [ ] Add comments for parameter logic
  - [ ] Ensure consistent formatting
- [ ] Review `test/benchling-webhook-stack.test.ts`:
  - [ ] Organize test sections
  - [ ] Add descriptive test group comments
  - [ ] Ensure consistent formatting

### Update Stack Props Interface

- [ ] Open `lib/benchling-webhook-stack.ts`
- [ ] Locate `BenchlingWebhookStackProps` interface
- [ ] Add `readonly benchlingSecrets?: string;` field
- [ ] Add JSDoc comment explaining the parameter

### Test Coverage

- [ ] Run test coverage: `npm run test:coverage`
- [ ] Review coverage report for Phase 3 changes
- [ ] Ensure coverage >85% for modified files
- [ ] Add missing tests if needed

### Final Validation

- [ ] Run full test suite: `make test`
- [ ] Verify all tests pass
- [ ] Run lint: `make lint`
- [ ] Verify no lint errors
- [ ] Run build: `npm run build`
- [ ] Verify build succeeds
- [ ] Check for TypeScript errors

### Commit

- [ ] Stage all changes: `git add lib/ bin/ test/`
- [ ] Commit with message:
  ```
  refactor: cleanup Phase 3 implementation

  Final improvements:
  - Add JSDoc comments
  - Remove unused code
  - Improve parameter documentation
  - Ensure consistent formatting

  Part of Phase 3 Episode 10 (REFACTOR phase)

  Relates to #156
  ```
- [ ] Push to branch: `git push origin 156-secrets-manager`

---

## Post-Implementation Validation

### Quality Gates

- [ ] All unit tests pass: `npm test`
- [ ] All lint checks pass: `make lint`
- [ ] Build succeeds: `npm run build`
- [ ] Test coverage >85%: `npm run test:coverage`
- [ ] No TypeScript errors: `npx tsc --noEmit`

### Functional Validation

- [ ] Stack synthesizes with new parameter: `npx cdk synth`
- [ ] Stack synthesizes with old parameters: verify backward compatibility
- [ ] CloudFormation template includes BenchlingSecrets parameter
- [ ] CloudFormation template includes deprecated parameters
- [ ] Container environment configuration is correct

### Documentation Validation

- [ ] All code has appropriate comments
- [ ] Complex logic is documented
- [ ] Parameter descriptions are clear
- [ ] Deprecation notices are visible

---

## Critical Test Cases

### Test Case 1: New Parameter Only

**Setup**: Deploy with benchlingSecrets JSON, no old parameters

**Expected**:
- [ ] Stack creates successfully
- [ ] Container has BENCHLING_SECRETS env var
- [ ] Container does NOT have individual Benchling env vars
- [ ] Secrets Manager secret contains JSON

**Actual**: _____________

**Status**: [ ] Pass [ ] Fail

---

### Test Case 2: Old Parameters Only

**Setup**: Deploy with old individual parameters, no benchlingSecrets

**Expected**:
- [ ] Stack creates successfully
- [ ] Container has BENCHLING_TENANT env var
- [ ] Container has BENCHLING_CLIENT_ID secret
- [ ] Container has BENCHLING_CLIENT_SECRET secret
- [ ] Secrets Manager secret contains individual fields

**Actual**: _____________

**Status**: [ ] Pass [ ] Fail

---

### Test Case 3: Both Parameters (Precedence)

**Setup**: Deploy with both benchlingSecrets and old parameters

**Expected**:
- [ ] Stack creates successfully
- [ ] benchlingSecrets takes precedence
- [ ] Container has BENCHLING_SECRETS env var
- [ ] Container does NOT have individual Benchling vars

**Actual**: _____________

**Status**: [ ] Pass [ ] Fail

---

### Test Case 4: Empty New Parameter (Fallback)

**Setup**: Deploy with empty benchlingSecrets and old parameters

**Expected**:
- [ ] Stack creates successfully
- [ ] Falls back to old parameters
- [ ] Container has BENCHLING_TENANT env var
- [ ] Container has individual secret references

**Actual**: _____________

**Status**: [ ] Pass [ ] Fail

---

## Troubleshooting Guide

### Issue: Tests fail with "parameter not found"

**Possible Causes**:
- Parameter name typo
- Parameter not added to stack
- Template not regenerated

**Solutions**:
1. Verify parameter name matches exactly
2. Check stack file for parameter definition
3. Rebuild and regenerate template

---

### Issue: "unsafePlainText" still in use warning

**Note**: This is expected in Phase 3. The values are protected by CloudFormation's noEcho feature.

**Verification**:
- [ ] Parameters have noEcho: true
- [ ] Values not visible in CloudFormation console
- [ ] Values come from noEcho parameters

---

### Issue: Container environment not updating

**Possible Causes**:
- Parameter precedence logic incorrect
- Container environment not using parameter values
- Conditional logic error

**Solutions**:
1. Add debug logging for parameter mode selection
2. Verify environment object construction
3. Check conditional branches

---

### Issue: Backward compatibility tests fail

**Possible Causes**:
- Old parameter handling removed
- Parameter precedence incorrect
- Container environment logic changed

**Solutions**:
1. Verify old parameters still in stack
2. Check parameter precedence logic
3. Ensure both modes create valid configurations

---

## Phase 3 Completion Criteria

Phase 3 is complete when ALL of the following are true:

- [ ] All 10 episodes executed in order
- [ ] All commits follow conventional commits format
- [ ] All unit tests pass
- [ ] All lint checks pass
- [ ] Test coverage >85%
- [ ] Build succeeds without errors
- [ ] All 4 critical test cases pass
- [ ] Backward compatibility maintained
- [ ] CloudFormation parameters added
- [ ] Container environment updated
- [ ] Deploy command updated
- [ ] Code reviewed and cleaned up
- [ ] Documentation updated
- [ ] No regression in existing functionality

---

## Next Steps After Phase 3

When Phase 3 is complete:

1. [ ] Update `spec/156-secrets-manager/WORKFLOW-STATUS.md`
2. [ ] Create PR for Phase 3 implementation
3. [ ] Request code review
4. [ ] Address review comments
5. [ ] Merge PR to 156-secrets-manager branch
6. [ ] Begin Phase 4 planning (or proceed to next assigned phase)

---

## Notes and Observations

**Date**: _____________

**Implementer**: _____________

**Issues Encountered**:
-
-
-

**Solutions Applied**:
-
-
-

**Time Spent**: _______ hours

**Additional Comments**:
-
-
-

---

## Checklist Summary

**Total Tasks**: ~120
**Episodes**: 10
**Commits**: 10 minimum
**Test Cases**: 4 critical

**Estimated Time**: 4-6 hours

**Status**: [ ] Not Started [ ] In Progress [ ] Complete

---

## Related Documents

- **Design**: spec/156-secrets-manager/11-phase3-design.md
- **Episodes**: spec/156-secrets-manager/12-phase3-episodes.md
- **Phases**: spec/156-secrets-manager/04-phases.md (Phase 3)
- **Status**: spec/156-secrets-manager/WORKFLOW-STATUS.md
