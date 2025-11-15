# Fix: Prompt Defaults and UX

**Date**: 2025-11-14
**Priority**: 🔴 CRITICAL
**Status**: 🔴 Not Fixed

---

## Problem

The current Phase 3 implementation has flawed UX:

### Issue 1: Silently Uses Existing Config (No Prompts)
```
Benchling Configuration:
  Tenant: quilt-dtt (from existing config)        ← Just printed, no prompt!
  Client ID: wqFfVOhb... (from existing config)  ← Just printed, no prompt!
```

**Problem**: User can't review or change values. They're just silently used.

### Issue 2: Doesn't Handle Profile Inheritance
If creating a new profile (e.g., `--profile sales`), should offer to copy from `default`:
```
? Profile 'sales' doesn't exist. Copy from 'default'? (Y/n)
```

### Issue 3: Doesn't Ask About New App
If catalog changes, we might need a different Benchling app. Should ask:
```
? Catalog changed to bench.dev.quilttest.com. Use existing app or create new?
  › Use existing (appdef_wqFfaXBVMu)
    Create new app
```

### Issue 4: Missing Test Entry ID
The old config had `testEntryId` but Phase 3 didn't load it.

---

## Correct UX (From Old Wizard)

### With Existing Config

```bash
$ npm run setup -- --profile bench

Loading existing configuration for profile: bench

Step 3: Benchling Configuration

? Benchling Tenant: (quilt-dtt) _               ← Shows default, can change
? Do you have a Benchling App Definition ID? (Y/n) y
? Benchling App Definition ID: (appdef_wqFfaXBVMu) _  ← Shows default
? OAuth Client ID: (wqFfVOhbYe) _              ← Shows default
? OAuth Client Secret: [hidden] (********) _   ← Can press Enter to keep
? Test Entry ID (optional): (etr_EK1AQMQiQn) _ ← Shows default

Step 4: Package Configuration

? S3 Bucket: (quilt-ernest-staging) _          ← Shows default
? S3 Prefix: (benchling) _                     ← Shows default
? Metadata Key: (experiment_id) _              ← Shows default
```

**Key Point**: User sees every value and can press Enter to keep or type to change.

### Without Existing Config (New Profile)

```bash
$ npm run setup -- --profile sales

Profile 'sales' doesn't exist.
? Copy configuration from profile 'default'? (Y/n) y

Copying from profile: default

Step 3: Benchling Configuration

? Benchling Tenant: (quilt-dtt) _              ← Copied from default
? Catalog changed. Use same Benchling app or create new?
  › Use existing (appdef_wqFfaXBVMu)
    Create new app
```

---

## Required Changes

### Change 1: Always Show Prompts with Defaults

**File**: `lib/wizard/phase3-parameter-collection.ts`

**Current (WRONG)**:
```typescript
if (existingConfig?.benchling?.tenant) {
    tenant = existingConfig.benchling.tenant;
    console.log(`  Tenant: ${tenant} (from existing config)`);
    // NO PROMPT - user can't change it!
}
```

**Correct**:
```typescript
const tenantAnswer = await inquirer.prompt([
    {
        type: "input",
        name: "tenant",
        message: "Benchling Tenant:",
        default: existingConfig?.benchling?.tenant || "",  // Show as default
        validate: (value: string) =>
            value.trim().length > 0 || "Tenant is required",
    },
]);
tenant = tenantAnswer.tenant;
```

### Change 2: Handle Profile Inheritance

**File**: `bin/commands/setup-wizard.ts`

**Add before Phase 1**:
```typescript
// Check if profile exists
let existingConfig: ProfileConfig | null = null;
let inheritFrom: string | null = null;

try {
    existingConfig = xdg.readProfile(profile);
    console.log(chalk.dim(`\nLoading existing configuration for profile: ${profile}\n`));
} catch (error) {
    // Profile doesn't exist - offer to copy from default
    if (profile !== "default") {
        try {
            const defaultConfig = xdg.readProfile("default");

            const copyAnswer = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "copy",
                    message: `Profile '${profile}' doesn't exist. Copy from 'default'?`,
                    default: true,
                },
            ]);

            if (copyAnswer.copy) {
                existingConfig = defaultConfig;
                inheritFrom = "default";
                console.log(chalk.dim(`\nCopying configuration from profile: default\n`));
            }
        } catch {
            // No default profile either - fresh setup
            console.log(chalk.dim(`\nCreating new configuration for profile: ${profile}\n`));
        }
    } else {
        console.log(chalk.dim(`\nCreating new configuration for profile: ${profile}\n`));
    }
}
```

### Change 3: Ask About New App if Catalog Changed

**File**: `lib/wizard/phase3-parameter-collection.ts`

**Add after tenant prompt**:
```typescript
// Check if catalog changed and we have existing app
if (existingConfig?.benchling?.appDefinitionId &&
    existingConfig?.quilt?.catalog !== stackQuery.catalog) {

    console.log(chalk.yellow(
        `\nCatalog changed from ${existingConfig.quilt.catalog} to ${stackQuery.catalog}`
    ));

    const appChoice = await inquirer.prompt([
        {
            type: "list",
            name: "choice",
            message: "Benchling app configuration:",
            choices: [
                {
                    name: `Use existing app (${existingConfig.benchling.appDefinitionId})`,
                    value: "existing",
                },
                {
                    name: "Create new app for this catalog",
                    value: "new",
                },
            ],
        },
    ]);

    if (appChoice.choice === "new") {
        // Clear existing app info - will prompt for new
        existingConfig.benchling.appDefinitionId = undefined;
        existingConfig.benchling.clientId = undefined;
        existingConfig.benchling.clientSecret = undefined;
    }
}
```

### Change 4: Load Test Entry ID

**File**: `lib/wizard/phase3-parameter-collection.ts`

**Current**:
```typescript
let testEntryId: string | undefined;
if (input.benchlingTestEntryId) {
    testEntryId = input.benchlingTestEntryId;
}
```

**Correct**:
```typescript
const testEntryAnswer = await inquirer.prompt([
    {
        type: "input",
        name: "testEntryId",
        message: "Benchling Test Entry ID (optional):",
        default: existingConfig?.benchling?.testEntryId || "",  // Load from config
    },
]);
testEntryId = testEntryAnswer.testEntryId || undefined;
```

---

## Priority Order for Each Parameter

1. **CLI argument** (highest - explicit user intent)
2. **Show prompt with default from existing config** (let user review/change)
3. **Show prompt with no default** (if no existing value)

**Never** silently use existing config without showing the user!

---

## Implementation Plan

### Step 1: Fix Phase 3 Prompts
- Remove all `console.log("from existing config")` branches
- Always show inquirer prompts
- Use `default:` parameter to show existing values
- Apply to: tenant, app ID, client ID/secret, test entry, bucket, prefix, metadata key, log level

### Step 2: Add Profile Inheritance
- Check if profile exists
- If not, offer to copy from "default"
- Pass `inheritFrom` to Phase 3 for metadata

### Step 3: Add Catalog Change Detection
- Compare `existingConfig.quilt.catalog` with `stackQuery.catalog`
- If different, ask about using existing app vs creating new
- Clear app credentials if user chooses new app

### Step 4: Test All Scenarios
- Existing profile, same catalog (update mode)
- Existing profile, different catalog (migration mode)
- New profile, default exists (inheritance mode)
- New profile, no default (fresh setup mode)

---

## Example Flows

### Scenario 1: Update Existing Profile

```bash
$ npm run setup -- --profile bench

Loading existing configuration for profile: bench

Step 1: Catalog Discovery
Detected catalog: nightly.quilttest.com
? Is nightly.quilttest.com the correct catalog? No
? Enter catalog DNS: bench.dev.quilttest.com

Step 2: Stack Query
Using provided catalog: bench.dev.quilttest.com
✓ Found BenchlingSecret

Step 3: Benchling Configuration

Catalog changed from nightly.quilttest.com to bench.dev.quilttest.com
? Benchling app configuration:
  › Use existing app (appdef_wqFfaXBVMu)
    Create new app for this catalog

? Benchling Tenant: (quilt-dtt) _
? Do you have app ID? (Y/n) y
? App Definition ID: (appdef_wqFfaXBVMu) _
? OAuth Client ID: (wqFfVOhbYe) _
? OAuth Client Secret: [hidden] (********) _    ← Press Enter to keep
? Test Entry ID: (etr_EK1AQMQiQn) _

Step 4: Package Configuration
? S3 Bucket: (quilt-ernest-staging) _
? S3 Prefix: (benchling) _
? Metadata Key: (experiment_id) _

Step 5: Optional
? Log Level: (DEBUG) INFO                       ← Can change with arrow keys
? Webhook Allow List: () _
```

### Scenario 2: New Profile Inheriting from Default

```bash
$ npm run setup -- --profile sales

Profile 'sales' doesn't exist.
? Copy from 'default'? (Y/n) y

Copying configuration from: default

Step 3: Benchling Configuration
? Benchling Tenant: (quilt-dtt) sales-demo      ← User types new value
? App Definition ID: (appdef_wqFfaXBVMu) _      ← Presses Enter to keep
...
```

---

## Success Criteria

✅ All prompts show existing values as defaults
✅ User can press Enter to keep or type to change any value
✅ New profiles can inherit from "default"
✅ Catalog changes trigger app reuse question
✅ Test Entry ID is loaded and shown
✅ No values are silently used without user seeing them
✅ UX matches old wizard (prompts with defaults)

---

## Files to Modify

1. **bin/commands/setup-wizard.ts**
   - Add profile inheritance logic
   - Pass `inheritFrom` to save

2. **lib/wizard/phase3-parameter-collection.ts**
   - Replace all silent uses with prompts
   - Add `default:` to all inquirer prompts
   - Add catalog change detection
   - Add test entry ID loading

3. **lib/wizard/types.ts**
   - Add `inheritFrom?: string` to Phase 3 input

---

## Notes

- The refactored wizard tried to be "smart" by skipping prompts
- But this removes user control and visibility
- The old wizard's UX was better: **show everything, let user confirm**
- Principle: **Prompts with defaults > Silent assumptions**
