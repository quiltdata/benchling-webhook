# A10: Implementation Plan - Fix A07 Config Validation Break

**Status:** Ready for Implementation
**Date:** 2025-12-18
**Decision:** Pass complete config via environment variables

## Executive Summary

**Problem:** A07 added validation that broke NPM script deployments

**Root Cause:** `deploy.ts` doesn't pass config to `benchling-webhook.ts` via environment variables, so stack receives empty config and validation fails

**Solution:** Pass complete config via environment variables from `deploy.ts` to `benchling-webhook.ts`

**Why This Is Right:**

- Clean architecture: config is always complete
- Preserves A07 validation benefits for library users
- Minimal code change (add ~15 environment variables)
- No magic bypasses or workarounds
- Parameters remain optional overrides

## Background: The Fundamental Issue

### What We Learned

**Question:** Should validation differ by caller (library vs scripts)?

**Answer:** No - the stack should ALWAYS receive valid config, regardless of caller.

**The Real Problem:** We're validating INPUTS (config) but can't validate OUTPUTS (final CloudFormation parameter values after deploy-time `--parameters` overrides)

**CDK Limitation:** CloudFormation parameters are resolved at DEPLOY time, but validation happens at SYNTH time. We cannot check "will this parameter have a value after deploy-time overrides?"

### The Choice We Made

**Option A:** Don't validate inputs

- ❌ Library users can deploy broken stacks
- ✅ NPM scripts work (parameters compensate)

**Option B:** Validate inputs, allow empty config + parameters

- ❌ Validates wrong thing (inputs vs outputs)
- ❌ Two patterns, unclear precedence

**Option C:** Validate inputs, require complete config everywhere ✅ **CHOSEN**

- ✅ Clean architecture - single source of truth
- ✅ Fail fast - errors at synth time
- ✅ Parameters are truly optional overrides
- ✅ No special cases or magic detection

## The Fix: Pass Config Via Environment Variables

### Current Flow (Broken)

```typescript
// 1. deploy.ts reads config from XDG profile
config = xdg.readProfileWithInheritance('default')
// ✅ config.quilt.catalog = "test.com"
// ✅ config.quilt.database = "db"
// ✅ config.quilt.queueUrl = "https://sqs..."

// 2. deploy.ts spawns CDK with LIMITED env vars
env = {
    CDK_DEFAULT_ACCOUNT: "...",
    CDK_DEFAULT_REGION: "...",
    QUILT_STACK_ARN: "...",
    BENCHLING_SECRET: "...",
    // ❌ MISSING: QUILT_CATALOG
    // ❌ MISSING: QUILT_DATABASE
    // ❌ MISSING: QUEUE_URL
}

// 3. benchling-webhook.ts reads env vars
config.quilt.catalog = process.env.QUILT_CATALOG || ""  // → ""
config.quilt.database = process.env.QUILT_DATABASE || ""  // → ""
config.quilt.queueUrl = process.env.QUEUE_URL || ""  // → ""

// 4. Stack validation fails ❌
if (!config.quilt.catalog) {
    throw new Error("Required field missing");
}
```

### Fixed Flow

```typescript
// 1. deploy.ts reads config from XDG profile
config = xdg.readProfileWithInheritance('default')
// ✅ config.quilt.catalog = "test.com"

// 2. deploy.ts spawns CDK with COMPLETE env vars (NEW)
env = {
    CDK_DEFAULT_ACCOUNT: "...",
    CDK_DEFAULT_REGION: "...",
    QUILT_STACK_ARN: "...",
    BENCHLING_SECRET: "...",

    // ✅ NEW: Pass complete config
    QUILT_CATALOG: config.quilt.catalog,
    QUILT_DATABASE: config.quilt.database,
    QUEUE_URL: config.quilt.queueUrl,
    // ... all other config fields
}

// 3. benchling-webhook.ts reads env vars
config.quilt.catalog = process.env.QUILT_CATALOG || ""  // ✅ "test.com"
config.quilt.database = process.env.QUILT_DATABASE || ""  // ✅ "db"
config.quilt.queueUrl = process.env.QUEUE_URL || ""  // ✅ "https://sqs..."

// 4. Stack validation passes ✅
if (!config.quilt.catalog) {  // Has value!
    // Not reached
}

// 5. Parameters still work as overrides
cdk deploy --parameters QuiltWebHost=override.com
// Final value: "override.com" (parameter overrides config default)
```

## Implementation Details

### File: `bin/commands/deploy.ts`

**Location:** Lines 628-665 (environment variable building section)

**Change:** Add environment variables for all config fields

```typescript
// Build environment variables for CDK synthesis
const env: Record<string, string> = {
    ...process.env,
    CDK_DEFAULT_ACCOUNT: deployAccount,
    CDK_DEFAULT_REGION: deployRegion,
    QUILT_STACK_ARN: stackArn,
    BENCHLING_SECRET: benchlingSecret,

    // ✅ NEW: Pass Quilt configuration (required by A07 validation)
    QUILT_CATALOG: config.quilt.catalog,
    QUILT_DATABASE: config.quilt.database,
    QUEUE_URL: config.quilt.queueUrl,

    // ✅ NEW: Pass optional Quilt fields if present
    ...(config.quilt.icebergDatabase && {
        ICEBERG_DATABASE: config.quilt.icebergDatabase,
    }),
    ...(config.quilt.icebergWorkgroup && {
        ICEBERG_WORKGROUP: config.quilt.icebergWorkgroup,
    }),
    ...(config.quilt.athenaUserWorkgroup && {
        ATHENA_USER_WORKGROUP: config.quilt.athenaUserWorkgroup,
    }),
    ...(config.quilt.athenaResultsBucket && {
        ATHENA_RESULTS_BUCKET: config.quilt.athenaResultsBucket,
    }),

    // ✅ NEW: Pass package configuration
    QUILT_USER_BUCKET: config.packages.bucket,
    PKG_PREFIX: config.packages.prefix || "benchling",
    PKG_KEY: config.packages.metadataKey || "experiment_id",

    // ✅ NEW: Pass Benchling configuration
    BENCHLING_TENANT: config.benchling.tenant,
    BENCHLING_CLIENT_ID: config.benchling.clientId || "",
    BENCHLING_APP_DEFINITION_ID: config.benchling.appDefinitionId || "",

    // ✅ NEW: Pass logging configuration
    LOG_LEVEL: config.logging?.level || "INFO",

    // ✅ NEW: Pass image configuration
    IMAGE_TAG: options.imageTag,
    ...(config.deployment.ecrRepository && {
        ECR_REPOSITORY_NAME: config.deployment.ecrRepository,
    }),
};

// VPC configuration already handled below (lines 637-665)
```

### File: `bin/benchling-webhook.ts`

**Location:** Lines 156-210 (environment variable reading)

**Change:** None required - already reads these env vars!

The code already has this structure:

```typescript
const profileConfig: ProfileConfig = {
    quilt: {
        catalog: process.env.QUILT_CATALOG || "",
        database: process.env.QUILT_DATABASE || "",
        queueUrl: process.env.QUEUE_URL || "",
        // ...
    },
    // ...
};
```

We just weren't setting the environment variables. Once we set them in `deploy.ts`, this code will work correctly.

## Testing Strategy

### 1. Verify NPM Script Deployment Works

```bash
# Should succeed without validation errors
npm run deploy:dev -- --yes
```

**Expected:** Deployment succeeds, stack receives complete config from env vars

### 2. Verify Library Usage Still Works

```typescript
// Library user code
new BenchlingWebhookStack(app, 'Stack', {
    config: {
        quilt: {
            catalog: "test.quiltdata.com",
            database: "test_db",
            queueUrl: "https://sqs...",
            region: "us-east-1",
        },
        benchling: {
            tenant: "test",
            clientId: "client123",
            secretArn: "arn:aws:secretsmanager:...",
            appDefinitionId: "app_123",
        },
        packages: {
            bucket: "test-bucket",
            prefix: "benchling",
            metadataKey: "experiment_id",
        },
        deployment: {
            region: "us-east-1",
            account: "123456789012",
            imageTag: "latest",
        },
        logging: { level: "INFO" },
        security: {
            webhookAllowList: "",
            enableVerification: true,
        },
        _metadata: {
            version: "1.0.0",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: "library",
        },
    },
});
```

**Expected:** Stack construction succeeds (doesn't use env vars, uses config directly)

### 3. Verify Parameters Still Override

```bash
cdk deploy --parameters QuiltWebHost=override.example.com
```

**Expected:** Deployed stack uses `override.example.com` instead of config value

### 4. Verify Validation Catches Real Errors

```typescript
// Library user with invalid config
new BenchlingWebhookStack(app, 'Stack', {
    config: {
        quilt: {
            catalog: "",  // ❌ Empty
            database: "",  // ❌ Empty
            queueUrl: "",  // ❌ Empty
            region: "us-east-1",
        },
        // ... rest of config
    },
});
```

**Expected:** Validation fails with clear error message about missing fields

### 5. Add Integration Tests (Future)

```typescript
describe("Deploy Command Integration", () => {
    test("passes config via environment variables to CDK", () => {
        // Mock XDGConfig with complete profile
        // Mock execSync for CDK command
        // Verify env vars include QUILT_CATALOG, QUILT_DATABASE, QUEUE_URL
    });

    test("benchling-webhook.ts receives complete config from env vars", () => {
        // Set env vars as deploy.ts would
        // Import benchling-webhook.ts
        // Verify ProfileConfig is populated from env
    });
});
```

## Rollout Plan

### Phase 1: Implement Fix (v0.9.7 hotfix)

1. **Add environment variables to `bin/commands/deploy.ts`**
   - Add ~15 new environment variables
   - Test locally with `npm run deploy:dev`

2. **Verify all existing tests pass**
   - Unit tests should be unaffected (use mocked config)
   - Integration tests should pass (if any exist)

3. **Manual testing**
   - Test NPM script deployment
   - Test library usage (if possible)
   - Test parameter overrides

4. **Update CHANGELOG**
   - Document the fix
   - Explain the env var approach

5. **Release v0.9.7**

### Phase 2: Add Tests (v1.0.0)

1. **Add integration tests for config passing**
   - Test `deploy.ts` → CDK → `benchling-webhook.ts` flow
   - Test environment variable passing
   - Mock subprocess spawning

2. **Add test helpers for incomplete config**

   ```typescript
   export function createIncompleteConfig(): ProfileConfig {
       return createMockConfig({
           quilt: { catalog: "", database: "", queueUrl: "", region: "us-east-1" }
       });
   }
   ```

3. **Add tests for validation edge cases**
   - Empty strings vs undefined vs null
   - Optional fields present vs absent
   - Validation skip behavior

### Phase 3: Documentation Updates (v1.0.0)

1. **Update CLAUDE.md**
   - Document env var passing
   - Explain config vs parameters relationship
   - Clarify when each is used

2. **Update README (if applicable)**
   - Document library usage requirements
   - Show config must be complete
   - Explain parameter override behavior

3. **Create architecture diagram**
   - Show config flow: XDG → deploy.ts → env vars → benchling-webhook.ts → stack
   - Show parameter flow: CDK CLI → CloudFormation → runtime override

## Why Not The Alternatives?

### Alternative 1: Magic Environment Variable Bypass

```typescript
const skipValidation =
    process.env.SKIP_CONFIG_VALIDATION === "true" ||
    process.env.BENCHLING_WEBHOOK_NPM_DEPLOY === "true";
```

**Why rejected:**

- ❌ Magic detection - unclear when validation applies
- ❌ Library users could bypass validation by setting env var
- ❌ Doesn't fix the root cause (missing env vars)
- ❌ Band-aid on a structural problem

### Alternative 2: Remove Validation Entirely

**Why rejected:**

- ❌ Defeats the purpose of A07 (protect library users)
- ❌ Library users can deploy broken stacks
- ❌ No early error detection
- ❌ Fails late (at deploy time, not synth time)

### Alternative 3: Validate Only `benchling.secretArn`

```typescript
// Only validate fields without parameter overrides
if (!config.benchling.secretArn) {
    throw new Error("Required field missing");
}
// Don't validate quilt.* fields (have parameter overrides)
```

**Why rejected:**

- ❌ Library users can still deploy with empty quilt.* values
- ❌ Inconsistent - some fields validated, others not
- ❌ Doesn't match A07's intent (validate all required fields)
- ❌ Still allows broken library deployments

## Success Criteria

- ✅ NPM script deployments work without validation errors
- ✅ Library usage with complete config works
- ✅ Library usage with incomplete config fails with clear error
- ✅ Parameters still override config defaults
- ✅ All existing tests pass
- ✅ No breaking changes to existing deployments
- ✅ Clean architecture (config always complete)
- ✅ A07 validation benefits preserved

## Risk Assessment

### Low Risk

**Change scope:** Add ~15 environment variables to one function

**No behavioral changes:**

- Stack construction logic unchanged
- Validation logic unchanged (already correct)
- Parameter override logic unchanged
- Library usage unchanged

**Backwards compatible:**

- Existing deployments unaffected
- Library users unaffected
- Only fixes broken NPM scripts

### Mitigation

**If something breaks:**

1. Environment variables are additive (can't break existing env)
2. Can rollback by reverting the env var additions
3. Tests will catch issues before release

## Open Questions

### Q1: Should we also update the setup wizard?

**Current:** Setup wizard writes to XDG profile, which already has these fields

**Decision:** No changes needed - setup wizard already populates complete config

### Q2: Should we validate in deploy.ts before spawning CDK?

**Current:** `deploy.ts` already validates at lines 455-468

**Decision:** No changes needed - existing validation is sufficient

### Q3: Should we add a config health check command?

**Future enhancement:** `npm run deploy:check` could validate:

- Profile exists
- Config is complete
- Secrets are in AWS
- CDK is bootstrapped
- Stack status is deployable

**Decision:** Out of scope for this fix, consider for v1.1.0

## Appendix: Environment Variable Mapping

| Config Field | Environment Variable | Required | Default |
|--------------|---------------------|----------|---------|
| `quilt.catalog` | `QUILT_CATALOG` | Yes | - |
| `quilt.database` | `QUILT_DATABASE` | Yes | - |
| `quilt.queueUrl` | `QUEUE_URL` | Yes | - |
| `quilt.icebergDatabase` | `ICEBERG_DATABASE` | No | "" |
| `quilt.icebergWorkgroup` | `ICEBERG_WORKGROUP` | No | "" |
| `quilt.athenaUserWorkgroup` | `ATHENA_USER_WORKGROUP` | No | "" |
| `quilt.athenaResultsBucket` | `ATHENA_RESULTS_BUCKET` | No | "" |
| `packages.bucket` | `QUILT_USER_BUCKET` | Yes | - |
| `packages.prefix` | `PKG_PREFIX` | No | "benchling" |
| `packages.metadataKey` | `PKG_KEY` | No | "experiment_id" |
| `benchling.tenant` | `BENCHLING_TENANT` | Yes | - |
| `benchling.clientId` | `BENCHLING_CLIENT_ID` | No | "" |
| `benchling.appDefinitionId` | `BENCHLING_APP_DEFINITION_ID` | Yes | - |
| `logging.level` | `LOG_LEVEL` | No | "INFO" |
| `deployment.imageTag` | `IMAGE_TAG` | Yes | options.imageTag |
| `deployment.ecrRepository` | `ECR_REPOSITORY_NAME` | No | undefined |

**Already set:**

- `CDK_DEFAULT_ACCOUNT` ✅
- `CDK_DEFAULT_REGION` ✅
- `QUILT_STACK_ARN` ✅
- `BENCHLING_SECRET` ✅
- VPC configuration ✅ (lines 637-665)

## Conclusion

This fix:

1. **Solves the immediate problem** - NPM scripts work again
2. **Preserves A07 benefits** - Library users protected from broken deploys
3. **Clean architecture** - Config always complete, parameters are optional overrides
4. **Minimal change** - Add env vars, no logic changes
5. **Future-proof** - Sets foundation for proper config management

The root cause was a simple oversight: `deploy.ts` validated config but didn't pass it to the subprocess. Once we pass it via environment variables, both library and script patterns work correctly.
