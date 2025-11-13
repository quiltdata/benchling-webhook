# Non-Interactive and --yes Flag Behavior Analysis

**Issue**: `npm run setup -- --yes` still prompts user for input, contradicting expected non-interactive behavior.

**Date**: 2025-11-13
**Status**: 🔴 BROKEN - Inconsistent behavior across commands

---

## Table of Contents

1. [Current Status](#1-current-status)
2. [Challenges & Inconsistencies](#2-challenges--inconsistencies)
3. [Proposed Solutions](#3-proposed-solutions)
4. [Implementation Plan](#4-implementation-plan)

---

## 1. Current Status

### 1.1 Commands with Prompt Behavior

| Command | Flag | Prompts? | Library | Location | Notes |
|---------|------|----------|---------|----------|-------|
| `install` | `--yes` | ✅ YES (broken) | inquirer | `bin/commands/install.ts:137-146` | Prompts for deployment confirmation |
| `setup-wizard` | `nonInteractive` | ✅ YES (broken) | inquirer | `bin/commands/setup-wizard.ts:332+` | Prompts for all config fields |
| `deploy` | `--yes` | ❌ NO | enquirer | `bin/commands/deploy.ts:321-331` | Correctly skips prompt |
| `setup-profile` | none | ✅ ALWAYS | inquirer | `bin/commands/setup-profile.ts:58-70, 101-142` | Multiple prompts, no skip option |
| `init` | none | ✅ ALWAYS | inquirer | Via `setup-wizard` | Redirects to setup-wizard |

### 1.2 Flag Naming Conventions

**Two different patterns exist:**

1. **User-facing CLI flag**: `--yes` (used in CLI args)
   - Used in: `install.ts`, `deploy.ts`, `cli.ts`
   - Meaning: "Skip all prompts and proceed automatically"

2. **Internal option**: `nonInteractive` (used in function options)
   - Used in: `setup-wizard.ts`, `install.ts`, `init.ts`
   - Meaning: "Run in non-interactive mode (requires complete config)"

### 1.3 How Flags Flow Through Commands

```
User runs: npm run setup -- --yes
           ↓
       bin/cli.ts parses args
           ↓
       cli.ts line 226: if (args[i] === "--yes" || args[i] === "-y")
           ↓
       options.yes = true
           ↓
       installCommand(options) called
           ↓
       install.ts line 96: nonInteractive: nonInteractive || yes  ← FIX APPLIED
           ↓
       setupWizardCommand({ nonInteractive: true, ... })
           ↓
       setup-wizard.ts line 305: if (nonInteractive) { validate & return early }
           ↓
       ❌ PROBLEM: Only checks benchling fields, still prompts for Quilt config
```

### 1.4 Current Implementation Details

#### `bin/cli.ts` (lines 209-250)
```typescript
// Parses --yes flag when no command is provided
if ((!args.length || (args.length > 0 && args[0].startsWith("--") && !isHelpOrVersion))) {
    const options: { yes?: boolean; setupOnly?: boolean; ... } = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--yes" || args[i] === "-y") {
            options.yes = true;  // ← User-facing flag
        }
        // ... other flags
    }

    installCommand(options);  // Calls install with yes: true
}
```

#### `bin/commands/install.ts` (lines 70-103)
```typescript
export async function installCommand(options: InstallCommandOptions = {}): Promise<void> {
    const {
        yes = false,              // ← User-facing flag from CLI
        nonInteractive = false,   // ← Internal flag (rarely set directly)
        // ...
    } = options;

    // FIXED (line 96): Now passes yes as nonInteractive
    setupResult = await setupWizardCommand({
        nonInteractive: nonInteractive || yes,  // ✅ FIX: Map yes → nonInteractive
        isPartOfInstall: true,
    });

    // Lines 131-147: Prompts for deployment (skipped if --yes)
    if (!yes && !nonInteractive) {
        const answers = await inquirer.prompt([
            {
                type: "confirm",
                name: "shouldDeploy",
                message: "Deploy to AWS now?",
                default: true,
            },
        ]);
        shouldDeploy = answers.shouldDeploy;
    }
}
```

#### `bin/commands/setup-wizard.ts` (lines 290-327)
```typescript
async function runConfigWizard(options: WizardOptions = {}): Promise<ProfileConfig> {
    const { existingConfig = {}, nonInteractive = false, inheritFrom } = options;

    // Lines 305-327: Early return for nonInteractive mode
    if (nonInteractive) {
        // ❌ PROBLEM: Only validates Benchling fields!
        if (!config.benchling?.tenant || !config.benchling?.clientId || !config.benchling?.clientSecret) {
            throw new Error(
                "Non-interactive mode requires benchlingTenant, benchlingClientId, and benchlingClientSecret to be already configured",
            );
        }

        // Returns early with existing config
        return finalConfig;  // ✅ This works IF config is complete
    }

    // Lines 329-600: Always prompts if nonInteractive is false
    // ❌ PROBLEM: This code path is ALWAYS hit when nonInteractive=false

    // Step 1: Quilt Configuration
    const quiltAnswers = await inquirer.prompt([...]);  // Line 332

    // Step 2: Benchling Configuration
    const tenantAnswer = await inquirer.prompt([...]);  // Line 397
    const hasAppDefId = await inquirer.prompt([...]);   // Line 409
    const appDefAnswer = await inquirer.prompt([...]);  // Line 422 or 446
    const credentialAnswers = await inquirer.prompt([...]); // Line 459

    // Step 3: Package Configuration
    const packageAnswers = await inquirer.prompt([...]);  // Line 513

    // Step 4: Deployment Configuration
    const deploymentAnswers = await inquirer.prompt([...]); // Line 545

    // Step 5: Optional Configuration
    const optionalAnswers = await inquirer.prompt([...]);  // Line 578
}
```

#### `bin/commands/deploy.ts` (lines 320-331)
```typescript
// ✅ CORRECT BEHAVIOR: Skips prompt when --yes is provided
if (!options.yes) {
    const response: { proceed: boolean } = await prompt({
        type: "confirm",
        name: "proceed",
        message: "Proceed with deployment?",
        initial: true,
    });

    if (!response.proceed) {
        console.log(chalk.yellow("Deployment cancelled"));
        process.exit(0);
    }
}
```

#### `bin/commands/setup-profile.ts` (lines 58-142)
```typescript
// ❌ NO FLAG SUPPORT: Always prompts, even if config exists
if (xdg.profileExists(profileName) && !options?.force) {
    const { overwrite } = await inquirer.prompt([...]); // Line 58
}

const answers = await inquirer.prompt<{...}>([...]);  // Line 101

// Multiple conditional prompts
if (answers.customizeQuiltStack) {
    const stackAnswer = await inquirer.prompt<{ stackArn: string }>({...}); // Line 147
}

if (answers.customizeSecretArn) {
    const secretAnswer = await inquirer.prompt<{ secretArn: string }>({...}); // Line 161
}
```

---

## 2. Challenges & Inconsistencies

### 2.1 Flag Naming Inconsistency

**Problem**: Two different names for the same concept

- CLI uses `--yes` (user-facing)
- Internal code uses `nonInteractive` (developer-facing)
- Mapping between them is manual and error-prone

**Impact**:
- Developers must remember to map `yes` → `nonInteractive`
- Easy to miss this mapping in new commands
- Confusing when reading code (which flag controls what?)

### 2.2 Incomplete Non-Interactive Implementation

**Problem**: `setup-wizard.ts` validation is incomplete (line 306)

```typescript
// Only checks 3 fields, but config has 15+ required fields!
if (!config.benchling?.tenant || !config.benchling?.clientId || !config.benchling?.clientSecret) {
    throw new Error("Non-interactive mode requires...");
}
```

**Missing validations**:
- `config.quilt?.stackArn` (required)
- `config.quilt?.catalog` (required)
- `config.quilt?.database` (required)
- `config.quilt?.queueUrl` (required)
- `config.packages?.bucket` (required)
- `config.deployment?.region` (required)
- `config.deployment?.account` (required)

**Impact**:
- Passes validation with incomplete config
- May fail during deployment with cryptic errors

### 2.3 No Prompt Bypass in setup-wizard

**Problem**: When `nonInteractive=false`, wizard ALWAYS prompts (lines 329-600)

Even when:
- Config file exists with all values
- User just wants to re-use existing config
- User passes `--yes` expecting to skip prompts

**Impact**:
- Cannot do truly automated deployments
- CI/CD pipelines cannot use the CLI without hacks
- Poor user experience for repeat deployments

### 2.4 Inconsistent Behavior Across Commands

| Command | With `--yes` | Expected | Actual | Status |
|---------|--------------|----------|--------|--------|
| `deploy` | `npx ... deploy --yes` | Skip prompt | ✅ Skips | ✅ WORKS |
| `install` | `npx ... --yes` | Skip all prompts | ❌ Prompts for config | 🔴 BROKEN |
| `setup` | Via `npm run setup -- --yes` | Skip prompts | ❌ Prompts for config | 🔴 BROKEN |

### 2.5 Missing Flag Support in Commands

**Commands without any non-interactive support**:
- `setup-profile`: Always prompts (58, 101, 147, 161)
- No way to create profiles programmatically

### 2.6 Library Inconsistency

**Two different prompt libraries**:
- `inquirer` - Used in: setup-wizard, setup-profile, install
- `enquirer` - Used in: deploy

**Why this matters**:
- Different APIs for skipping prompts
- Different error handling
- Maintenance burden

---

## 3. Proposed Solutions

### 3.1 Option A: Smart Non-Interactive Mode (RECOMMENDED)

**Concept**: When `--yes` is provided, use existing config values as defaults and skip ALL prompts.

**Implementation**:

```typescript
// bin/commands/setup-wizard.ts
async function runConfigWizard(options: WizardOptions = {}): Promise<ProfileConfig> {
    const { existingConfig = {}, nonInteractive = false, inheritFrom } = options;

    if (nonInteractive) {
        // Validate ALL required fields (not just Benchling)
        const validation = validateConfigCompleteness(existingConfig);

        if (!validation.isComplete) {
            throw new Error(
                `Non-interactive mode requires complete configuration.\n` +
                `Missing fields: ${validation.missing.join(", ")}\n` +
                `Please run 'npm run setup' without --yes to configure these fields.`
            );
        }

        // Return existing config with updated metadata
        return updateConfigMetadata(existingConfig as ProfileConfig);
    }

    // Continue with interactive prompts...
}

function validateConfigCompleteness(config: Partial<ProfileConfig>): {
    isComplete: boolean;
    missing: string[];
} {
    const required = [
        ['quilt.stackArn', config.quilt?.stackArn],
        ['quilt.catalog', config.quilt?.catalog],
        ['quilt.database', config.quilt?.database],
        ['quilt.queueUrl', config.quilt?.queueUrl],
        ['benchling.tenant', config.benchling?.tenant],
        ['benchling.clientId', config.benchling?.clientId],
        ['benchling.clientSecret', config.benchling?.clientSecret],
        ['benchling.appDefinitionId', config.benchling?.appDefinitionId],
        ['packages.bucket', config.packages?.bucket],
        ['deployment.region', config.deployment?.region],
        ['deployment.account', config.deployment?.account],
    ];

    const missing = required
        .filter(([_, value]) => !value)
        .map(([key]) => key as string);

    return {
        isComplete: missing.length === 0,
        missing,
    };
}
```

**Pros**:
- ✅ Clear error messages about what's missing
- ✅ Works with existing config files
- ✅ Safe (validates before proceeding)
- ✅ Minimal code changes

**Cons**:
- ⚠️ Requires complete config for `--yes` to work
- ⚠️ First-time setup still needs interactive mode

### 3.2 Option B: Add --skip-prompts Flag

**Concept**: Add explicit `--skip-prompts` flag that uses existing values without validation.

```typescript
// bin/cli.ts
if (args[i] === "--skip-prompts") {
    options.skipPrompts = true;
}

// bin/commands/setup-wizard.ts
if (skipPrompts) {
    // Use existing config as-is, fill missing with defaults
    return fillConfigDefaults(existingConfig);
}
```

**Pros**:
- ✅ Works even with incomplete config
- ✅ Explicit intent (separate from --yes)

**Cons**:
- ❌ Another flag to maintain
- ❌ May proceed with invalid config
- ❌ Confusing: --yes vs --skip-prompts?

### 3.3 Option C: Unify on Single Flag

**Concept**: Remove `nonInteractive` entirely, use only `--yes` everywhere.

```typescript
// All commands
export async function someCommand(options: { yes?: boolean; ... }) {
    if (!options.yes) {
        // Prompt user
    }
    // Proceed
}
```

**Pros**:
- ✅ Simpler mental model
- ✅ Consistent across all commands
- ✅ Less code to maintain

**Cons**:
- ❌ Large refactor required
- ❌ Breaks existing internal APIs
- ❌ Risk of regression bugs

### 3.4 Option D: Configuration Validation Command

**Concept**: Add `validate` command to check config completeness before using `--yes`.

```typescript
// bin/commands/validate.ts (enhance existing)
export async function validateCommand(options: {
    profile?: string;
    fix?: boolean;  // NEW: Prompt to fix missing fields
}): Promise<void> {
    const config = xdg.readProfile(options.profile || "default");
    const validation = validateConfigCompleteness(config);

    if (validation.isComplete) {
        console.log(chalk.green("✓ Configuration is complete"));
        return;
    }

    console.log(chalk.yellow("⚠ Configuration is incomplete:"));
    validation.missing.forEach(field => {
        console.log(chalk.yellow(`  - ${field}`));
    });

    if (options.fix) {
        // Run wizard to fix only missing fields
        await fixMissingFields(config, validation.missing);
    }
}
```

**Pros**:
- ✅ Provides clear feedback
- ✅ Optional fix mode
- ✅ Works with any solution above

**Cons**:
- ⚠️ Adds extra step for users
- ⚠️ Doesn't solve core problem

---

## 4. Implementation Plan

### Phase 1: Fix Critical Path (IMMEDIATE)

**Goal**: Make `npm run setup -- --yes` work correctly

**Tasks**:
1. ✅ **DONE**: Map `--yes` → `nonInteractive` in `install.ts` (line 96)
2. ⏳ **TODO**: Enhance validation in `setup-wizard.ts` (line 305-310)
   - Add `validateConfigCompleteness()` helper
   - Check ALL required fields, not just Benchling
   - Provide clear error messages with missing field names
3. ⏳ **TODO**: Add tests for non-interactive mode
   - Test with complete config → should succeed
   - Test with incomplete config → should fail with helpful error
   - Test with missing config → should fail

**Files to modify**:
- `bin/commands/setup-wizard.ts` (enhance validation)
- `test/bin/install.test.ts` (add tests)

**Time estimate**: 2-3 hours

### Phase 2: Improve Consistency (SHORT TERM)

**Goal**: Standardize flag behavior across all commands

**Tasks**:
1. Add `--yes` support to `setup-profile` command
2. Standardize on `enquirer` library (remove `inquirer`)
3. Document flag behavior in all command help text
4. Add `validateConfigCompleteness()` as shared utility

**Files to modify**:
- `bin/commands/setup-profile.ts`
- `bin/commands/setup-wizard.ts`
- `bin/commands/install.ts`
- `lib/utils/config-validator.ts` (new file)
- `package.json` (remove inquirer dependency)

**Time estimate**: 4-6 hours

### Phase 3: Enhanced Validation (MEDIUM TERM)

**Goal**: Provide better feedback and repair options

**Tasks**:
1. Enhance `validate` command with `--fix` option
2. Add `--dry-run` to `deploy` command
3. Improve error messages with actionable suggestions
4. Add config health check to all commands

**Files to modify**:
- `bin/commands/validate.ts` (enhance)
- `bin/commands/deploy.ts` (add dry-run)
- `lib/utils/config-validator.ts` (enhance)

**Time estimate**: 6-8 hours

### Phase 4: Refactor (LONG TERM)

**Goal**: Unify flag naming and behavior

**Tasks**:
1. Deprecate `nonInteractive` in favor of `yes`
2. Update all command interfaces
3. Add migration guide for any external users
4. Update documentation

**Files to modify**:
- All commands in `bin/commands/`
- `bin/cli.ts`
- Documentation

**Time estimate**: 8-12 hours

---

## 5. Recommended Immediate Fix

**Apply Option A (Smart Non-Interactive Mode) in Phase 1**

This provides:
- ✅ Immediate fix for `--yes` not working
- ✅ Clear error messages for users
- ✅ Safe (validates config)
- ✅ Minimal changes (low risk)

**Code change** (in `bin/commands/setup-wizard.ts`):

```typescript
// Replace lines 305-327 with:
if (nonInteractive) {
    const validation = validateConfigCompleteness(config);

    if (!validation.isComplete) {
        throw new Error(
            `Non-interactive mode requires complete configuration.\n\n` +
            `Missing required fields:\n` +
            validation.missing.map(f => `  - ${f}`).join('\n') + '\n\n' +
            `To fix:\n` +
            `  1. Run: npm run setup (without --yes)\n` +
            `  2. Or manually edit: ~/.config/benchling-webhook/${profile}/config.json`
        );
    }

    // Update metadata and return
    const now = new Date().toISOString();
    const finalConfig = config as ProfileConfig;
    finalConfig._metadata = {
        version: "0.7.0",
        createdAt: config._metadata?.createdAt || now,
        updatedAt: now,
        source: "wizard",
    };

    if (inheritFrom) {
        finalConfig._inherits = inheritFrom;
    }

    return finalConfig;
}
```

**Add helper function** (at top of file):

```typescript
function validateConfigCompleteness(config: Partial<ProfileConfig>): {
    isComplete: boolean;
    missing: string[];
} {
    const required: [string, unknown][] = [
        ['quilt.stackArn', config.quilt?.stackArn],
        ['quilt.catalog', config.quilt?.catalog],
        ['quilt.database', config.quilt?.database],
        ['quilt.queueUrl', config.quilt?.queueUrl],
        ['benchling.tenant', config.benchling?.tenant],
        ['benchling.clientId', config.benchling?.clientId],
        ['benchling.clientSecret', config.benchling?.clientSecret],
        ['benchling.appDefinitionId', config.benchling?.appDefinitionId],
        ['packages.bucket', config.packages?.bucket],
        ['packages.prefix', config.packages?.prefix],
        ['deployment.region', config.deployment?.region],
        ['deployment.account', config.deployment?.account],
    ];

    const missing = required
        .filter(([_, value]) => !value || (typeof value === 'string' && value.trim() === ''))
        .map(([key]) => key);

    return {
        isComplete: missing.length === 0,
        missing,
    };
}
```

---

## 6. Testing Checklist

After implementing the fix, verify:

- [ ] `npm run setup -- --yes` (with complete config) → No prompts, succeeds
- [ ] `npm run setup -- --yes` (with incomplete config) → Clear error, lists missing fields
- [ ] `npm run setup` (without --yes) → Interactive prompts as usual
- [ ] `npm run deploy:dev -- --yes` → No prompts, deploys
- [ ] `npx @quiltdata/benchling-webhook --yes` → No prompts, installs + deploys

---

## 7. Related Issues

- GitHub Issue #221: Next Steps Implementation
- Related to Phase 3 command chaining (`install = setup + deploy`)

---

## Appendix: Complete Prompt Inventory

### Prompts in `setup-wizard.ts`

| Line | Prompt | Condition | Skippable? |
|------|--------|-----------|------------|
| 332 | Quilt Stack ARN | Always | ✅ With nonInteractive |
| 332 | Quilt Catalog URL | Always | ✅ With nonInteractive |
| 332 | Quilt Athena Database | Always | ✅ With nonInteractive |
| 332 | SQS Queue URL | Always | ✅ With nonInteractive |
| 397 | Benchling Tenant | Always | ✅ With nonInteractive |
| 409 | Has App Definition ID? | Always | ✅ With nonInteractive |
| 422 | App Definition ID | If has ID | ✅ With nonInteractive |
| 446 | App Definition ID | If doesn't have ID | ✅ With nonInteractive |
| 459 | OAuth Client ID | Always | ✅ With nonInteractive |
| 459 | OAuth Client Secret | Always | ✅ With nonInteractive |
| 485 | Test Entry ID | Always (optional) | ✅ With nonInteractive |
| 513 | Package S3 Bucket | Always | ✅ With nonInteractive |
| 513 | Package Prefix | Always | ✅ With nonInteractive |
| 513 | Metadata Key | Always | ✅ With nonInteractive |
| 545 | AWS Region | Always | ✅ With nonInteractive |
| 545 | AWS Account ID | Always | ✅ With nonInteractive |
| 578 | Log Level | Always | ✅ With nonInteractive |
| 578 | Webhook Allow List | Always | ✅ With nonInteractive |
| 578 | Enable Verification | Always | ✅ With nonInteractive |
| 724 | Continue manually? | If infer fails | ❌ Never (exits) |
| 773 | Save anyway? | If validation fails | ❌ Never (exits) |

**Total**: 19 prompts (17 skippable with proper nonInteractive implementation)

### Prompts in `install.ts`

| Line | Prompt | Condition | Skippable? |
|------|--------|-----------|------------|
| 137 | Deploy to AWS now? | If not --yes | ✅ With --yes |

**Total**: 1 prompt (1 skippable)

### Prompts in `deploy.ts`

| Line | Prompt | Condition | Skippable? |
|------|--------|-----------|------------|
| 321 | Proceed with deployment? | If not --yes | ✅ With --yes |

**Total**: 1 prompt (1 skippable)

### Prompts in `setup-profile.ts`

| Line | Prompt | Condition | Skippable? |
|------|--------|-----------|------------|
| 58 | Overwrite existing? | If profile exists | ❌ No flag |
| 101 | Use inheritance? | Always | ❌ No flag |
| 101 | App Definition ID | Always | ❌ No flag |
| 101 | Docker image tag | Always | ❌ No flag |
| 101 | Different Quilt stack? | Always | ❌ No flag |
| 101 | Different Secret ARN? | Always | ❌ No flag |
| 147 | Quilt Stack ARN | If customizing | ❌ No flag |
| 161 | Secret ARN | If customizing | ❌ No flag |

**Total**: 8 prompts (0 skippable - NO FLAG SUPPORT)

---

**END OF ANALYSIS**
