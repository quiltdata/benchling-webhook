# A09: The Right Fix - Environment Variable Gap

**Status:** Root Cause Identified
**Date:** 2025-12-18

## The Real Problem

**A07 didn't break because validation was wrong. A07 broke because `deploy.ts` doesn't pass required config to `benchling-webhook.ts` via environment variables.**

## The Flow

### What deploy.ts Does

1. **Reads config from XDG profile** ([deploy.ts:167](../../bin/commands/deploy.ts#L167))

   ```typescript
   config = xdg.readProfileWithInheritance(profileName);
   ```

2. **Validates config has required fields** ([deploy.ts:455-468](../../bin/commands/deploy.ts#L455-L468))

   ```typescript
   if (!config.quilt.queueUrl) missingFields.push("queueUrl");
   if (!config.quilt.database) missingFields.push("database");
   if (!config.quilt.catalog) missingFields.push("catalog");
   ```

   ✅ Config is complete and validated

3. **Spawns CDK with environment variables** ([deploy.ts:628-634](../../bin/commands/deploy.ts#L628-L634))

   ```typescript
   const env: Record<string, string> = {
       ...process.env,
       CDK_DEFAULT_ACCOUNT: deployAccount,
       CDK_DEFAULT_REGION: deployRegion,
       QUILT_STACK_ARN: stackArn,
       BENCHLING_SECRET: benchlingSecret,
       // ❌ MISSING: QUILT_CATALOG
       // ❌ MISSING: QUILT_DATABASE
       // ❌ MISSING: QUEUE_URL
   };
   ```

4. **Passes parameters to CDK deploy** ([deploy.ts:573-575](../../bin/commands/deploy.ts#L573-L575))

   ```typescript
   PackagerQueueUrl=${services.packagerQueueUrl}
   AthenaUserDatabase=${services.athenaUserDatabase}
   QuiltWebHost=${services.quiltWebHost}
   ```

### What benchling-webhook.ts Does

When CDK spawns `benchling-webhook.ts`, it reads config from **environment variables**:

[benchling-webhook.ts:162-164](../../bin/benchling-webhook.ts#L162-L164)

```typescript
const profileConfig: ProfileConfig = {
    quilt: {
        catalog: process.env.QUILT_CATALOG || "",     // ❌ Not set → ""
        database: process.env.QUILT_DATABASE || "",   // ❌ Not set → ""
        queueUrl: process.env.QUEUE_URL || "",        // ❌ Not set → ""
    },
    // ...
};

const stack = new BenchlingWebhookStack(app, 'Stack', { config: profileConfig });
```

### What BenchlingWebhookStack Does

[lib/benchling-webhook-stack.ts:52-60](../../lib/benchling-webhook-stack.ts#L52-L60)

```typescript
// Validate required Quilt configuration
if (!config.quilt.catalog) {
    missingFields.push("config.quilt.catalog: Quilt catalog domain");  // ❌ FAILS
}
if (!config.quilt.database) {
    missingFields.push("config.quilt.database: Athena/Glue database name");  // ❌ FAILS
}
if (!config.quilt.queueUrl) {
    missingFields.push("config.quilt.queueUrl: SQS queue URL for package creation");  // ❌ FAILS
}
```

## Why Pre-A07 Worked

Before A07, there was **no validation**, so empty strings were accepted:

```typescript
// Pre-A07: No validation
const packagerQueueUrlParam = new cdk.CfnParameter(this, "PackagerQueueUrl", {
    default: "",  // Empty string accepted
});

// Parameters later override the empty default
--parameters PackagerQueueUrl=https://sqs...
```

## Why Post-A07 Breaks

After A07, **validation rejects empty strings** before parameters can override them:

```typescript
// Post-A07: Validation fails at construction
if (!config.quilt.catalog) {
    throw new Error("Required field missing");  // ❌ Dies here
}

// Never reaches parameter override
--parameters QuiltWebHost=... (never used)
```

## The Right Fix

**Option 1: Pass Config via Environment Variables (CORRECT)**

Update [deploy.ts:628-639](../../bin/commands/deploy.ts#L628-L639) to pass all required config:

```typescript
const env: Record<string, string> = {
    ...process.env,
    CDK_DEFAULT_ACCOUNT: deployAccount,
    CDK_DEFAULT_REGION: deployRegion,
    QUILT_STACK_ARN: stackArn,
    BENCHLING_SECRET: benchlingSecret,

    // ADD THESE: Pass Quilt config via env vars
    QUILT_CATALOG: config.quilt.catalog,
    QUILT_DATABASE: config.quilt.database,
    QUEUE_URL: config.quilt.queueUrl,

    // Optional fields
    QUILT_USER_BUCKET: config.packages.bucket,
    PKG_PREFIX: config.packages.prefix || "benchling",
    PKG_KEY: config.packages.metadataKey || "experiment_id",
    BENCHLING_TENANT: config.benchling.tenant,
    BENCHLING_CLIENT_ID: config.benchling.clientId || "",
    BENCHLING_APP_DEFINITION_ID: config.benchling.appDefinitionId || "",
};
```

**Why this is correct:**

- ✅ Closes the gap between deploy.ts and benchling-webhook.ts
- ✅ Stack receives complete config, validation passes
- ✅ Parameters still work (override config defaults as designed)
- ✅ No magic environment variables
- ✅ No skipping validation
- ✅ Library usage still works (doesn't use env vars)
- ✅ Minimal code change

## The Wrong Fixes

### ❌ Option A: Skip Validation with Environment Variable

```typescript
const skipValidation =
    process.env.SKIP_CONFIG_VALIDATION === "true" ||
    process.env.BENCHLING_WEBHOOK_NPM_DEPLOY === "true";  // ❌ Magic bypass
```

**Why wrong:**

- Hides the real problem (env var gap)
- Creates a validation bypass that library users could abuse
- Doesn't fix the architectural issue
- Band-aid on a structural problem

### ❌ Option B: Remove Validation

**Why wrong:**

- Defeats the purpose of A07 (library usage needs validation)
- Allows broken configs through
- No early error detection

### ❌ Option C: Make Parameters Override Config Before Validation

**Why wrong:**

- Can't access CloudFormation parameter values at synth time
- Parameters are resolved at deploy time, not construction time
- Architecturally impossible with CDK

## Implementation Plan

### Change Required

**File:** [bin/commands/deploy.ts](../../bin/commands/deploy.ts#L628-L639)

**Add these environment variables:**

```typescript
// Build environment variables for CDK synthesis
const env: Record<string, string> = {
    ...process.env,
    CDK_DEFAULT_ACCOUNT: deployAccount,
    CDK_DEFAULT_REGION: deployRegion,
    QUILT_STACK_ARN: stackArn,
    BENCHLING_SECRET: benchlingSecret,

    // FIX: Pass Quilt configuration (required by A07 validation)
    QUILT_CATALOG: config.quilt.catalog,
    QUILT_DATABASE: config.quilt.database,
    QUEUE_URL: config.quilt.queueUrl,

    // Pass optional Quilt fields if present
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

    // Pass package configuration
    QUILT_USER_BUCKET: config.packages.bucket,
    PKG_PREFIX: config.packages.prefix || "benchling",
    PKG_KEY: config.packages.metadataKey || "experiment_id",

    // Pass Benchling configuration
    BENCHLING_TENANT: config.benchling.tenant,
    BENCHLING_CLIENT_ID: config.benchling.clientId || "",
    BENCHLING_APP_DEFINITION_ID: config.benchling.appDefinitionId || "",

    // Pass logging configuration
    LOG_LEVEL: config.logging?.level || "INFO",

    // Pass image configuration
    IMAGE_TAG: options.imageTag,
    ...(config.deployment.ecrRepository && {
        ECR_REPOSITORY_NAME: config.deployment.ecrRepository,
    }),
};

// VPC configuration already handled below (lines 637-665)
```

**File:** [bin/benchling-webhook.ts](../../bin/benchling-webhook.ts#L156-L210)

**Already correct!** The code already reads these env vars, we just weren't setting them.

### Test Plan

1. **Verify script deployment works:**

   ```bash
   npm run deploy:dev -- --yes
   ```

   Should succeed without validation errors.

2. **Verify library usage still works:**

   ```typescript
   new BenchlingWebhookStack(app, 'Stack', {
       config: {
           quilt: {
               catalog: "test.quiltdata.com",
               database: "test_db",
               queueUrl: "https://sqs...",
               // ...
           },
           // ...
       },
   });
   ```

   Should succeed (doesn't use env vars).

3. **Verify parameters still override:**

   ```bash
   cdk deploy --parameters QuiltWebHost=override.example.com
   ```

   Should use `override.example.com` instead of config value.

4. **Verify validation catches real errors:**

   ```typescript
   new BenchlingWebhookStack(app, 'Stack', {
       config: {
           quilt: {
               catalog: "",  // ❌ Empty
               database: "",  // ❌ Empty
               queueUrl: "",  // ❌ Empty
           },
       },
   });
   ```

   Should fail validation (as intended).

### Rollout

1. **v0.9.7 Hotfix:**
   - Add environment variables to deploy.ts
   - Test deployment scripts
   - Test library usage
   - Update CHANGELOG
   - Release

2. **v1.0.0 Follow-up:**
   - Add integration tests for env var passing
   - Add tests for deploy.ts → benchling-webhook.ts flow
   - Document environment variable contract

## Why This Wasn't Caught in Tests

**Tests never exercise the deploy.ts → CDK → benchling-webhook.ts flow:**

1. Unit tests create stacks directly with `new BenchlingWebhookStack()`
2. Unit tests use `createMockConfig()` with complete data
3. No integration tests for the deployment command
4. No tests verify environment variable passing

**Needed tests:**

```typescript
describe("Deploy Command Integration", () => {
    test("passes config via environment variables to CDK", () => {
        // Mock XDGConfig with complete profile
        // Mock execSync for CDK command
        // Verify env vars are passed correctly
    });

    test("spawned benchling-webhook.ts receives complete config", () => {
        // Set env vars as deploy.ts would
        // Import benchling-webhook.ts
        // Verify config is populated from env
    });
});
```

## Summary

**The problem:** Environment variable gap between `deploy.ts` and `benchling-webhook.ts`

**The fix:** Pass all required config via environment variables

**Why it's right:**

- Fixes the actual gap in the code
- Preserves A07's validation benefits
- No magic bypasses or workarounds
- Clean architectural solution
- 3-line code change

**Next time:**

- Add integration tests that exercise full deployment flow
- Test environment variable passing
- Test CDK subprocess spawning
- Don't rely solely on unit tests with mocked data
