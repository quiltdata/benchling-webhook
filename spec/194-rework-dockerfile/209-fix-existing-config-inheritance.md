# Fix: Existing Configuration Inheritance

**Date**: 2025-11-14
**Status**: ✅ FIXED
**Issue**: Phase 3 wasn't loading or using existing profile configuration

---

## Problem

When re-running setup on an existing profile (e.g., `--profile bench`), the wizard would:
1. Not load the existing configuration
2. Prompt for ALL parameters again (tenant, client ID, secret, bucket, etc.)
3. Force user to re-enter everything manually

This made it impossible to update just the catalog DNS without re-entering all credentials.

---

## Root Cause

The refactored wizard (phase-based architecture) didn't include code to:
1. Load existing configuration from the profile
2. Pass it to Phase 3 as defaults
3. Use existing values when CLI args not provided

---

## Solution

### 1. Load Existing Configuration

**File**: `bin/commands/setup-wizard.ts`

Added code to load existing config at the start:

```typescript
// Load existing configuration if it exists
let existingConfig: ProfileConfig | null = null;
try {
    existingConfig = xdg.readProfile(profile);
    console.log(chalk.dim(`\nLoading existing configuration for profile: ${profile}\n`));
} catch (error) {
    // No existing config - first time setup
    console.log(chalk.dim(`\nCreating new configuration for profile: ${profile}\n`));
}
```

### 2. Pass to Phase 3

**File**: `bin/commands/setup-wizard.ts`

Updated Phase 3 call to include existing config:

```typescript
const parameters = await runParameterCollection({
    stackQuery,
    existingConfig,  // NEW: Pass existing config
    yes,
    // ... CLI overrides
});
```

### 3. Update Phase 3 Types

**File**: `lib/wizard/types.ts`

Added `existingConfig` to Phase 3 input interface:

```typescript
export interface ParameterCollectionInput {
    stackQuery: StackQueryResult;
    existingConfig?: ProfileConfig | null; // NEW: Use as defaults
    yes?: boolean;
    // ... CLI overrides
}
```

### 4. Use Existing Config in Phase 3

**File**: `lib/wizard/phase3-parameter-collection.ts`

Updated ALL parameter collection to check existing config:

**Priority order for each parameter:**
1. CLI argument (highest priority)
2. Existing config value
3. Prompt user (if interactive)
4. Error (if --yes mode and no value)

**Examples:**

```typescript
// Benchling Tenant
if (input.benchlingTenant) {
    tenant = input.benchlingTenant;
    console.log(`  Tenant: ${tenant} (from CLI)`);
} else if (existingConfig?.benchling?.tenant) {
    tenant = existingConfig.benchling.tenant;
    console.log(`  Tenant: ${tenant} (from existing config)`);
} else if (yes) {
    throw new Error("--benchling-tenant is required");
} else {
    // Prompt user
}

// App Definition ID
if (input.benchlingAppDefinitionId) {
    appDefinitionId = input.benchlingAppDefinitionId;
    console.log(`  App Definition ID: ${appDefinitionId} (from CLI)`);
} else if (existingConfig?.benchling?.appDefinitionId) {
    appDefinitionId = existingConfig.benchling.appDefinitionId;
    console.log(`  App Definition ID: ${appDefinitionId} (from existing config)`);
} else {
    // Prompt user
}

// Client credentials
if (input.benchlingClientId && input.benchlingClientSecret) {
    clientId = input.benchlingClientId;
    clientSecret = input.benchlingClientSecret;
} else if (existingConfig?.benchling?.clientId && existingConfig?.benchling?.clientSecret) {
    clientId = existingConfig.benchling.clientId;
    clientSecret = existingConfig.benchling.clientSecret;
    console.log(`  Client ID: ${clientId.substring(0, 8)}... (from existing config)`);
    console.log("  Client Secret: ******** (from existing config)");
} else {
    // Prompt user
}

// Package configuration
if (existingConfig?.packages?.bucket) {
    bucket = input.userBucket || existingConfig.packages.bucket;
    prefix = input.pkgPrefix || existingConfig.packages.prefix;
    metadataKey = input.pkgKey || existingConfig.packages.metadataKey;
    console.log(`  Bucket: ${bucket} (from existing config)`);
    console.log(`  Prefix: ${prefix} (from existing config)`);
    console.log(`  Metadata Key: ${metadataKey} (from existing config)`);
}

// Log level and security
if (existingConfig?.logging?.level) {
    logLevel = input.logLevel || existingConfig.logging.level;
    webhookAllowList = input.webhookAllowList ?? existingConfig.security?.webhookAllowList ?? "";
    console.log(`  Log Level: ${logLevel} (from existing config)`);
    console.log(`  Webhook Allow List: ${webhookAllowList || "(none)"} (from existing config)`);
}
```

---

## Result

### Before Fix

```bash
npm run setup -- --profile bench

Step 3: Configuration Parameters

Benchling Configuration:
? Benchling Tenant: _                    ← ❌ Forces re-entry
```

User would have to cancel and give up.

### After Fix

```bash
npm run setup -- --profile bench

Loading existing configuration for profile: bench

Step 1: Catalog Discovery
✔ Is nightly.quilttest.com the correct catalog? No
✔ Enter catalog DNS name: bench.dev.quilttest.com

Step 2: Stack Query
Using provided catalog: bench.dev.quilttest.com
...

Step 3: Configuration Parameters

Benchling Configuration:
  Tenant: quilt-dtt (from existing config)         ← ✅ Inherited
  App Definition ID: appdef_wqFfaXBVMu (from existing config)  ← ✅ Inherited
  Client ID: wqFfVOhb... (from existing config)   ← ✅ Inherited
  Client Secret: ******** (from existing config)  ← ✅ Inherited

Package Configuration:
  Bucket: quilt-ernest-staging (from existing config)  ← ✅ Inherited
  Prefix: benchling (from existing config)        ← ✅ Inherited
  Metadata Key: experiment_id (from existing config)  ← ✅ Inherited

Optional Configuration:
  Log Level: DEBUG (from existing config)         ← ✅ Inherited
  Webhook Allow List: (none) (from existing config)  ← ✅ Inherited
```

Now the wizard only prompts for what's actually missing or needs to be changed!

---

## Files Changed

1. **bin/commands/setup-wizard.ts**
   - Added code to load existing config
   - Pass `existingConfig` to Phase 3

2. **lib/wizard/types.ts**
   - Added `existingConfig?: ProfileConfig | null` to `ParameterCollectionInput`

3. **lib/wizard/phase3-parameter-collection.ts**
   - Updated ALL parameter collection to check existing config
   - Applied to: tenant, app ID, client ID/secret, test entry, bucket, prefix, metadata key, log level, webhook allow list

---

## Testing

### Manual Test

```bash
# Create initial config
npm run setup -- --profile test1

# Re-run setup to change catalog
npm run setup -- --profile test1

# Expected: All Benchling and package parameters inherited from existing config
# Only need to confirm/change catalog DNS
```

### Build Status

✅ TypeScript compilation successful

---

## Success Criteria

✅ Existing configuration is loaded when profile exists
✅ All parameters use existing config as defaults
✅ User only needs to enter new/changed values
✅ Can update catalog DNS without re-entering credentials
✅ TypeScript builds successfully
✅ Priority order correct: CLI args → existing config → prompt

---

## Related Issues

This fix completes the user experience improvements for:
- Updating catalog DNS for existing profile
- Re-running setup without losing credentials
- Making iterative setup changes easier
