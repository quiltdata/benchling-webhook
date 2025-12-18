# A08: Postmortem - Script Breakage from A07 Library Config Fix

**Status:** Investigation Complete
**Date:** 2025-12-18
**Incident:** A07 library-friendly config changes broke script deployments
**Severity:** High (blocking deployments)

## Executive Summary

The A07 fix (commit `87532f5`) successfully resolved library usage by adding validation for required Quilt config fields (`catalog`, `database`, `queueUrl`). However, this validation **broke script-based deployments** that were working before because:

1. **Scripts don't have these fields in their config** - The config read from XDG profiles may not have populated these fields
2. **The validation is now mandatory** - A07 added validation that throws an error if these fields are missing
3. **Tests didn't catch it** - All tests use `createMockConfig()` which provides complete, valid config objects

## The Break

### Error Message

```
Error: Configuration validation failed. Required fields:
  - config.quilt.catalog: Quilt catalog domain
  - config.quilt.database: Athena/Glue database name
  - config.quilt.queueUrl: SQS queue URL for package creation
```

### Location

[lib/benchling-webhook-stack.ts:52-60](../../lib/benchling-webhook-stack.ts#L52-L60)

```typescript
// Validate required Quilt configuration
if (!config.quilt.catalog) {
    missingFields.push("config.quilt.catalog: Quilt catalog domain");
}
if (!config.quilt.database) {
    missingFields.push("config.quilt.database: Athena/Glue database name");
}
if (!config.quilt.queueUrl) {
    missingFields.push("config.quilt.queueUrl: SQS queue URL for package creation");
}
```

### What Changed in A07

**Before A07:**

```typescript
// Parameters had empty defaults
default: "",  // Will be resolved at deployment time

// No validation of config.quilt.* fields
// Only validated config.benchling.secretArn
```

**After A07:**

```typescript
// Parameters use config values as defaults
default: config.quilt.queueUrl || "",

// Added validation for 3 required Quilt fields
if (!config.quilt.catalog) { ... }
if (!config.quilt.database) { ... }
if (!config.quilt.queueUrl) { ... }
```

## Root Cause Analysis

### Why Scripts Worked Before A07

1. **Scripts could deploy with incomplete config** - Empty parameter defaults meant CloudFormation would accept empty values
2. **Deployment command passed parameters** - The `--parameters` flags in [bin/commands/deploy.ts:571-589](../../bin/commands/deploy.ts#L571-L589) provided the actual values at deployment time
3. **No config validation** - Stack construction didn't check if `config.quilt.*` fields were populated

Example deployment flow (pre-A07):

```bash
# 1. Config read from profile (may have missing quilt.* fields)
config = xdg.readProfileWithInheritance('default')

# 2. Stack created with incomplete config (no validation)
stack = new BenchlingWebhookStack(app, 'Stack', { config })

# 3. CDK deploy passes parameters (overrides empty defaults)
cdk deploy --parameters PackagerQueueUrl=... --parameters AthenaUserDatabase=...
```

### Why Scripts Break After A07

1. **Validation happens at stack construction** - Before deployment command can pass parameters
2. **Config must be complete** - Stack constructor now requires `quilt.catalog`, `quilt.database`, `quilt.queueUrl`
3. **Scripts may read incomplete config** - XDG profile may not have these fields populated

Example deployment flow (post-A07):

```bash
# 1. Config read from profile (may have missing quilt.* fields)
config = xdg.readProfileWithInheritance('default')

# 2. Stack creation FAILS validation ❌
stack = new BenchlingWebhookStack(app, 'Stack', { config })
# Error: Configuration validation failed. Required fields:
#   - config.quilt.catalog: Quilt catalog domain
#   - config.quilt.database: Athena/Glue database name
#   - config.quilt.queueUrl: SQS queue URL for package creation

# 3. Never reaches deployment (script exits at step 2)
```

## Why Tests Didn't Catch This

### Test Setup

All tests use [test/helpers/test-config.ts](../../test/helpers/test-config.ts#L20-L51):

```typescript
export function createMockConfig(overrides?: Partial<ProfileConfig>): ProfileConfig {
    const defaults: ProfileConfig = {
        quilt: {
            catalog: "quilt.example.com",          // ✅ Always present
            database: "quilt_catalog",              // ✅ Always present
            queueUrl: "https://sqs.us-east-1...",  // ✅ Always present
            region: "us-east-1",
        },
        // ... complete config
    };
    return deepMerge(defaults, overrides || {});
}
```

**Every test gets a complete, valid config by default.**

### What Tests Verified

A07 added comprehensive tests ([test/benchling-webhook-stack.test.ts:246-466](../../test/benchling-webhook-stack.test.ts#L246-L466)):

✅ **Parameter defaults use config values** (lines 246-277)
✅ **Optional fields handled correctly** (lines 279-316)
✅ **Empty string fallback for missing optional fields** (lines 318-349)
✅ **Validation catches missing required fields** (lines 351-399)
✅ **Validation can be skipped** (lines 401-466)

### What Tests Missed

❌ **Real-world config loading from XDG profiles**

- Tests never call `XDGConfig.readProfileWithInheritance()`
- Tests never simulate incomplete or partially-populated profiles
- Tests don't cover the actual deployment command flow

❌ **Integration between config loading and stack creation**

- Tests create mocked config directly
- Tests don't simulate the `bin/commands/deploy.ts` workflow
- Tests don't verify the end-to-end deployment process

❌ **Profile config schema validation**

- No tests verify that XDG profiles contain required fields
- No tests check config health before deployment
- No tests simulate profile migration or corruption

## Gap Analysis: Unit Tests vs Integration Tests

### What Unit Tests Cover (Current)

| Scenario | Coverage |
| ---------- | ---------- |
| Stack creates with valid config | ✅ |
| Parameters use config defaults | ✅ |
| Optional fields fallback to empty string | ✅ |
| Validation catches missing fields | ✅ |
| Validation can be skipped | ✅ |

### What Integration Tests Should Cover (Missing)

| Scenario | Coverage |
| ---------- | ---------- |
| **Config loading from XDG profile** | ❌ |
| **Deployment command end-to-end** | ❌ |
| **Profile with missing quilt.* fields** | ❌ |
| **Profile with incomplete data** | ❌ |
| **Config validation before deployment** | ❌ |
| **Setup wizard creates valid config** | ❌ |
| **Profile migration/upgrade** | ❌ |

## Architectural Issues Revealed

### 1. **Two Sources of Truth for Config**

**Problem:** Config values can come from:

1. Profile config (`config.quilt.*`) - Required by A07 validation
2. CloudFormation parameters (`--parameters`) - Used by deployment scripts

**Conflict:** Validation requires profile config, but deployment actually uses parameters.

**Before A07:**

- Profile config was optional (ignored)
- Parameters were the real source of truth
- Scripts could work with incomplete profiles

**After A07:**

- Profile config is mandatory (validated)
- Parameters still override config defaults
- Scripts break if profile is incomplete

### 2. **Validation Timing Problem**

**Problem:** Validation happens at **stack construction** (before CDK deploy), but actual values are provided at **deployment time** (via `--parameters`).

**Timeline:**

```
1. Read config from profile
   ↓
2. Validate config ← ❌ FAILS HERE if incomplete
   ↓
3. Create stack with config
   ↓
4. CDK deploy with --parameters (never reached)
```

**This means:**

- Validation checks constructor-time config
- Deployment uses runtime parameters
- These two configs can be different!

### 3. **No Config Health Checks**

**Problem:** No pre-deployment validation of profile config health.

**Missing checks:**

- `npm run setup:health` exists but isn't run before deploy
- No automated config validation in CI
- No warning when profile is incomplete but parameters compensate

## Impact Assessment

### What Works

✅ **Library usage** - Fixed by A07 (original goal achieved)
✅ **NPM deployment with valid profile** - Works if profile has all required fields
✅ **Tests** - All passing (but insufficient coverage)

### What Breaks

❌ **NPM deployment with incomplete profile** - Fails validation even if parameters would work
❌ **Script deployments** - Any script using incomplete config fails at stack construction
❌ **Legacy profiles** - Pre-A07 profiles may not have required fields populated

### User Impact

**Severity: High**

- **Blocks all deployments** using incomplete profiles
- **Breaking change** despite A07 claiming backward compatibility
- **No migration path** for existing incomplete profiles
- **Cryptic error** doesn't explain that parameters could work

## Proposed Solutions

### Option 1: Relax Validation When Parameters Are Present (Quick Fix)

**Idea:** Skip config validation if environment suggests parameters will be passed.

```typescript
// In lib/benchling-webhook-stack.ts:42
const skipValidation =
    process.env.SKIP_CONFIG_VALIDATION === "true" ||
    process.env.BENCHLING_WEBHOOK_NPM_DEPLOY === "true";  // ← NEW

if (!skipValidation) {
    // ... validation logic
}
```

**Pros:**

- Minimal code change
- Restores script functionality immediately
- Backward compatible with existing deployments

**Cons:**

- Magic environment variable
- Doesn't solve underlying architectural issue
- Library users could bypass validation

**Recommendation:** ✅ **Implement as immediate hotfix**

### Option 2: Validate Only What Stack Actually Uses (Architectural Fix)

**Idea:** Only validate fields that will actually be used by the stack (not overridden by parameters).

**Problem:** Stack uses **parameter values**, not config values directly:

```typescript
// Stack always uses parameter values
const quiltWebHostValue = quiltWebHostParam.valueAsString;
const athenaUserDatabaseValue = athenaUserDatabaseParam.valueAsString;
const packagerQueueUrlValue = packagerQueueUrlParam.valueAsString;

// Config values are only used as parameter DEFAULTS
default: config.quilt.catalog || "",
```

**Solution:** Validate parameter **defaults** are non-empty, not config fields:

```typescript
// Instead of validating config fields:
if (!config.quilt.catalog) { ... }  // ❌ Wrong level

// Validate parameter defaults:
const packagerQueueUrlParam = new cdk.CfnParameter(this, "PackagerQueueUrl", {
    type: "String",
    description: "SQS queue URL for Quilt package creation jobs",
    default: config.quilt.queueUrl || "",
});

// Then validate that parameter has a value (either default or runtime):
if (!packagerQueueUrlParam.valueAsString && !skipValidation) {
    // Parameter will be empty - this is the real problem
    throw new Error("PackagerQueueUrl parameter is required");
}
```

**Pros:**

- Validates what stack actually uses
- Allows config + parameters hybrid
- More architecturally correct

**Cons:**

- Can't validate parameter values at synth time (CloudFormation resolves them at deploy time)
- More complex validation logic
- May not catch issues until deployment fails

**Recommendation:** ❌ **Not feasible** - Can't validate CloudFormation parameter values at synth time

### Option 3: Require Complete Config, Fix Scripts to Populate It (Strict)

**Idea:** A07 validation is correct - fix scripts to ensure config is always complete.

**Changes needed:**

1. **Update `npm run setup` to populate all required fields**
2. **Add config health check before deployment**
3. **Migrate existing profiles** to include required fields
4. **Make parameters truly optional** (only for overrides)

**Implementation:**

```typescript
// In bin/commands/deploy.ts:165
config = xdg.readProfileWithInheritance(profileName);

// NEW: Validate config health before deployment
const healthCheck = validateProfileConfig(config);
if (!healthCheck.valid) {
    console.error("Profile configuration is incomplete:");
    healthCheck.errors.forEach(err => console.error(`  - ${err}`));
    console.log("\nRun setup to fix:");
    console.log(`  npm run setup -- --profile ${profileName}`);
    process.exit(1);
}
```

**Pros:**

- Clean architecture - one source of truth (config)
- Parameters become optional overrides (as intended)
- Forces config health

**Cons:**

- Requires setup wizard updates
- Requires profile migration tool
- Breaking change for existing deployments
- More work upfront

**Recommendation:** ✅ **Long-term solution** (Phase 2)

### Option 4: Make Config Optional, Parameters Required (Revert A07)

**Idea:** Revert A07 validation, make config optional, require parameters.

**This defeats the purpose of A07** - library usage would break again.

**Recommendation:** ❌ **Rejected**

## Recommended Approach

### Phase 1: Immediate Hotfix (v0.9.7)

1. **Add environment variable bypass** (Option 1)

   ```typescript
   const skipValidation =
       process.env.SKIP_CONFIG_VALIDATION === "true" ||
       process.env.BENCHLING_WEBHOOK_NPM_DEPLOY === "true";
   ```

2. **Set environment variable in deployment script**

   ```typescript
   // In bin/commands/deploy.ts (before CDK synth/deploy)
   process.env.BENCHLING_WEBHOOK_NPM_DEPLOY = "true";
   ```

3. **Add warning when bypassing validation**

   ```typescript
   if (skipValidation && process.env.BENCHLING_WEBHOOK_NPM_DEPLOY === "true") {
       console.warn("⚠️  Config validation skipped (NPM deployment mode)");
       console.warn("   Parameters will provide runtime values");
   }
   ```

**Result:** Scripts work again, library usage still works, A07 benefits preserved.

### Phase 2: Architectural Fix (v1.0.0)

1. **Add config health check to deployment command**
   - Validate profile config before stack construction
   - Suggest `npm run setup` if incomplete
   - Allow bypass with `--force` flag

2. **Update setup wizard**
   - Always populate `quilt.catalog`, `quilt.database`, `quilt.queueUrl`
   - Validate during wizard (not after deployment fails)
   - Offer to infer from Quilt stack

3. **Add profile migration tool**
   - Detect incomplete profiles
   - Auto-populate from Quilt stack discovery
   - Backup old profiles before migration

4. **Add integration tests**
   - Test deployment command end-to-end
   - Test with incomplete profiles
   - Test parameter override behavior

5. **Update documentation**
   - Clarify config vs parameters relationship
   - Document when to use each
   - Migration guide for existing profiles

## Testing Strategy for Future

### Unit Tests (Current - Keep)

✅ Stack construction with valid config
✅ Parameter defaults from config values
✅ Validation logic for missing fields
✅ Validation skip behavior

### Integration Tests (Add)

❌ **Config Loading Tests**

```typescript
describe("XDG Config Integration", () => {
    test("reads profile with all required fields", () => {
        // Test reading from actual profile file
    });

    test("detects incomplete profile before deployment", () => {
        // Test validation catches incomplete profiles
    });

    test("setup wizard creates valid profile", () => {
        // Test setup creates profile with all required fields
    });
});
```

❌ **Deployment Command Tests**

```typescript
describe("Deployment Command Integration", () => {
    test("deploys with complete profile config", () => {
        // Test full deployment flow
    });

    test("fails gracefully with incomplete profile", () => {
        // Test error handling for incomplete config
    });

    test("parameters override config defaults", () => {
        // Test parameter precedence
    });
});
```

❌ **End-to-End Tests**

```typescript
describe("End-to-End Deployment", () => {
    test("npm run deploy:dev works with valid profile", () => {
        // Test actual npm script
    });

    test("library usage works without parameters", () => {
        // Test CDK app imports stack
    });
});
```

## Lessons Learned

### 1. **Mock Data Hides Real Problems**

**Issue:** `createMockConfig()` always provides complete config, tests never encountered incomplete config.

**Fix:** Add test helpers for incomplete/invalid config:

```typescript
export function createIncompleteConfig(): ProfileConfig {
    return createMockConfig({
        quilt: {
            catalog: "",      // Missing
            database: "",     // Missing
            queueUrl: "",     // Missing
            region: "us-east-1",
        },
    });
}
```

### 2. **Unit Tests Aren't Enough**

**Issue:** Unit tests verified isolated components but missed integration issues.

**Fix:** Add integration tests covering:

- Config loading from files
- Full deployment command flow
- Setup wizard → config file → deployment pipeline

### 3. **Validation at Wrong Layer**

**Issue:** Validated config at stack construction, but actual values come from parameters at deployment.

**Fix:** Validate at the layer that actually uses the values:

- Config validation in `npm run setup`
- Config health check in `bin/commands/deploy.ts`
- Stack construction accepts incomplete config + parameters

### 4. **Two Sources of Truth**

**Issue:** Config and parameters can provide same values, unclear which wins.

**Fix:** Clear hierarchy:

1. Config = defaults (validated complete)
2. Parameters = overrides (optional)
3. Document precedence clearly

### 5. **No Pre-Deployment Health Checks**

**Issue:** Config problems discovered at deployment time (too late).

**Fix:** Add `npm run deploy:check` that validates:

- Profile exists
- Config is complete
- Secrets are in AWS
- CDK is bootstrapped
- Stack status is deployable

## Action Items

### Immediate (v0.9.7 hotfix)

- [ ] Add `BENCHLING_WEBHOOK_NPM_DEPLOY` environment variable bypass
- [ ] Set env var in `bin/commands/deploy.ts`
- [ ] Add warning log when validation is skipped
- [ ] Test script deployment works again
- [ ] Verify library usage still works
- [ ] Release hotfix

### Short-term (v1.0.0)

- [ ] Add config health check to deployment command
- [ ] Update setup wizard to populate all required fields
- [ ] Add integration tests for config loading
- [ ] Add integration tests for deployment command
- [ ] Document config vs parameters clearly

### Long-term (v1.1.0+)

- [ ] Create profile migration tool
- [ ] Add `npm run deploy:check` command
- [ ] Add automated config validation in CI
- [ ] Refactor to single source of truth (config only)
- [ ] Remove parameter system (breaking change v2.0)

## Conclusion

**The A07 fix was correct in intent** (library usage should work) **but incomplete in execution** (broke script usage).

**Root cause:** Validation added at wrong layer (stack construction) without ensuring all callers provide complete config.

**Solution:** Two-phase approach:

1. **Immediate:** Environment variable bypass restores script functionality
2. **Long-term:** Ensure config is always complete before reaching stack construction

**Key insight:** **Tests that use mocked data will not catch real-world integration issues.** Always supplement unit tests with integration tests that exercise actual file I/O, command execution, and end-to-end workflows.
