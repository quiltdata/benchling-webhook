# Non-Interactive and --yes Flag Behavior Analysis

**Issue**: `npm run setup -- --yes` still prompts user for input, contradicting expected non-interactive behavior.

**Date**: 2025-11-13
**Status**: 🔴 BROKEN - Inconsistent behavior across commands
**Updated**: 2025-11-13 - Revised to standardize on `--yes` with smart prompting semantics

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

```flowchart
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

### 3.1 Option A: Smart Prompting with --yes Flag

**Concept**: When `--yes` is provided, use existing config values as defaults and **only prompt for fields that don't have defaults**. This makes `--yes` work for both first-time setup and repeat deployments.

**New Semantics**:

- `--yes` = "Auto-confirm everything that has a default, but still prompt for required fields without defaults"
- Fields with existing values → Use them (no prompt)
- Fields with built-in defaults → Use them (no prompt)
- Fields without defaults → Prompt (but don't prompt for confirmation)

**Implementation**:

```typescript
// bin/commands/setup-wizard.ts
async function runConfigWizard(options: WizardOptions = {}): Promise<ProfileConfig> {
    const { existingConfig = {}, yes = false, inheritFrom } = options;

    // Build list of fields that need values
    const fieldsToPrompt = determineRequiredFields(existingConfig);

    if (yes) {
        // With --yes: Only prompt for fields without defaults
        if (fieldsToPrompt.length === 0) {
            // All fields have values or defaults - proceed without prompts
            return updateConfigMetadata(existingConfig as ProfileConfig);
        }

        // Some fields still need input - prompt only for those
        console.log(chalk.yellow(`\nThe following fields need values:\n`));
        const answers = await promptForFields(fieldsToPrompt, existingConfig);
        return mergeConfigWithAnswers(existingConfig, answers);
    }

    // Without --yes: Normal interactive flow (all prompts + confirmations)
    return runFullInteractiveWizard(existingConfig);
}

function determineRequiredFields(config: Partial<ProfileConfig>): string[] {
    const required = [
        { key: 'quilt.stackArn', value: config.quilt?.stackArn, hasDefault: false },
        { key: 'quilt.catalog', value: config.quilt?.catalog, hasDefault: false },
        { key: 'quilt.database', value: config.quilt?.database, hasDefault: true }, // Default: 'benchling'
        { key: 'quilt.queueUrl', value: config.quilt?.queueUrl, hasDefault: false },
        { key: 'benchling.tenant', value: config.benchling?.tenant, hasDefault: false },
        { key: 'benchling.clientId', value: config.benchling?.clientId, hasDefault: false },
        { key: 'benchling.clientSecret', value: config.benchling?.clientSecret, hasDefault: false },
        { key: 'benchling.appDefinitionId', value: config.benchling?.appDefinitionId, hasDefault: false },
        { key: 'packages.bucket', value: config.packages?.bucket, hasDefault: false },
        { key: 'packages.prefix', value: config.packages?.prefix, hasDefault: true }, // Default: 'benchling/'
        { key: 'deployment.region', value: config.deployment?.region, hasDefault: false },
        { key: 'deployment.account', value: config.deployment?.account, hasDefault: false },
    ];

    return required
        .filter(field => !field.value && !field.hasDefault)
        .map(field => field.key);
}
```

**Pros**:

- ✅ Works for first-time setup AND repeat deployments
- ✅ No errors thrown - always makes progress
- ✅ Intuitive: "yes" means "use defaults when possible"
- ✅ CI/CD friendly (can pre-populate config, use --yes for rest)
- ✅ Minimal prompts (only when truly needed)

**Cons**:

- ⚠️ May still prompt on first run (if fields lack defaults)
- ⚠️ Requires implementing smart field-by-field prompting

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

### 3.3 Option C: Unify on Single Flag (RECOMMENDED FOR LONG-TERM)

**Concept**: Remove `nonInteractive` parameter entirely, standardize on `--yes` everywhere with smart prompting semantics from Option A.

**Changes**:

1. **Remove `nonInteractive` parameter** from all command interfaces
2. **Replace with `yes` parameter** consistently across codebase
3. **Implement smart prompting** (from Option A) in all commands
4. **Update all command calls** to use `yes` instead of `nonInteractive`

```typescript
// Before (inconsistent):
export async function setupWizardCommand(options: {
    nonInteractive?: boolean;  // ❌ Internal naming
    // ...
}) { }

// After (unified):
export async function setupWizardCommand(options: {
    yes?: boolean;  // ✅ Matches CLI flag
    // ...
}) {
    // Smart prompting: only prompt for fields without defaults
    const fieldsToPrompt = determineRequiredFields(existingConfig);

    if (yes && fieldsToPrompt.length === 0) {
        // All fields have values - no prompts needed
        return existingConfig;
    }

    if (yes) {
        // Only prompt for missing required fields
        return promptForFields(fieldsToPrompt);
    }

    // Full interactive mode
    return runFullWizard();
}
```

**Migration Strategy**:

1. Add `yes` parameter alongside `nonInteractive` (both work)
2. Deprecate `nonInteractive` with console warnings
3. Update all internal calls to use `yes`
4. Remove `nonInteractive` in next major version

**Pros**:

- ✅ Simpler mental model (one flag, one name)
- ✅ Consistent across all commands
- ✅ Matches user expectations (`--yes` = yes parameter)
- ✅ Less code to maintain long-term
- ✅ Combined with Option A smart prompting

**Cons**:

- ⚠️ Large refactor required (8-12 hours)
- ⚠️ Breaks existing internal APIs (needs migration)
- ⚠️ Risk of regression bugs (needs thorough testing)

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

### 3.5 Options Comparison

| Criterion | Option A: Smart Prompting | Option B: Skip Flag | Option C: Unify on --yes | Option D: Validate Cmd |
|-----------|--------------------------|---------------------|--------------------------|------------------------|
| **Effort** | 4-6 hours | 4-6 hours | 8-12 hours | 4-6 hours |
| **First-time setup** | ✅ Prompts for missing | ✅ Uses defaults | ✅ Prompts for missing | ⚠️ Extra validation step |
| **Repeat deployments** | ✅ No prompts | ✅ No prompts | ✅ No prompts | ✅ No prompts (after validate) |
| **Safety** | ✅ High (validates) | ⚠️ Medium (may use bad defaults) | ✅ High (validates) | ✅ High |
| **User Experience** | ✅ Intuitive | ❌ Confusing (two flags) | ✅ Excellent | ⚠️ Requires extra step |
| **Backward Compatible** | ✅ Yes | ✅ Yes | ⚠️ No (breaking change) | ✅ Yes |
| **Risk** | ✅ Low | ⚠️ Medium | ⚠️ High (large refactor) | ✅ Low |
| **Maintenance** | ✅ Low | ❌ High (two systems) | ✅ Low (one system) | ✅ Low |
| **CI/CD Friendly** | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ Requires pre-validation |

**Recommendation**: **Combine Options A + C** for best outcome:

- Phase 1: Implement Option A (smart prompting) with backward-compatible `yes` + `nonInteractive` parameters
- Phase 2-3: Roll out to all commands
- Phase 4: Deprecate and remove `nonInteractive` (Option C)

This gives us the benefits of both approaches while managing risk through phased implementation.

---

## 4. Implementation Plan

### Recommended Approach: Phased Implementation

**Phase 1 + Phase 4 Combined**: Implement Option A (smart prompting) while simultaneously standardizing on `--yes` (Option C).

---

### Phase 1: Implement Smart Prompting with --yes (IMMEDIATE)

**Goal**: Make `--yes` work correctly with smart prompting semantics

**Tasks**:

1. ✅ **DONE**: Map `--yes` → `nonInteractive` in `install.ts` (line 96)
2. ⏳ **TODO**: Replace `nonInteractive` with `yes` in setup-wizard.ts
   - Change parameter from `nonInteractive: boolean` to `yes: boolean`
   - Update all references within the file
3. ⏳ **TODO**: Implement smart prompting logic in `setup-wizard.ts`
   - Add `determineRequiredFields()` helper (checks which fields need values)
   - Modify wizard to only prompt for missing fields when `yes=true`
   - Keep existing behavior when `yes=false` (full interactive mode)
4. ⏳ **TODO**: Update `install.ts` to pass `yes` instead of `nonInteractive`
   - Line 96: Change from `nonInteractive: nonInteractive || yes` to `yes: yes`
5. ⏳ **TODO**: Add tests for smart prompting mode
   - Test with complete config + `--yes` → no prompts
   - Test with partial config + `--yes` → prompts only for missing fields
   - Test without `--yes` → full interactive mode

**Files to modify**:

- `bin/commands/setup-wizard.ts` (implement smart prompting, rename parameter)
- `bin/commands/install.ts` (pass `yes` instead of `nonInteractive`)
- `test/bin/install.test.ts` (add tests)

**Time estimate**: 4-6 hours

---

### Phase 2: Standardize Across All Commands (SHORT TERM)

**Goal**: Apply `--yes` with smart prompting to all commands

**Tasks**:

1. Add `--yes` support to `setup-profile` command
   - Add `yes` parameter to command options
   - Skip overwrite confirmations when `yes=true`
   - Prompt only for missing required fields
2. Ensure `deploy` command uses same pattern
   - Already uses `--yes` correctly
   - Verify consistency with new smart prompting approach
3. Update `init` command (delegates to setup-wizard)
   - Pass through `yes` parameter
4. Document flag behavior in all command help text
5. Standardize on `enquirer` library (remove `inquirer`)
   - Migrate all prompts to use `enquirer`
   - Remove `inquirer` dependency

**Files to modify**:

- `bin/commands/setup-profile.ts`
- `bin/commands/init.ts`
- `bin/commands/deploy.ts` (verify)
- `bin/cli.ts` (update help text)
- `package.json` (remove inquirer dependency)

**Time estimate**: 4-6 hours

---

### Phase 3: Enhanced Validation (MEDIUM TERM)

**Goal**: Provide better feedback and tooling

**Tasks**:

1. Extract field validation into shared utility
   - Create `lib/utils/config-validator.ts`
   - Move `determineRequiredFields()` to shared module
   - Add field metadata (defaults, descriptions, validation rules)
2. Enhance `validate` command with `--fix` option
   - Check config completeness
   - Offer to fix missing fields interactively
3. Add `--dry-run` to `deploy` command
   - Show what would be deployed without actually deploying
4. Improve error messages with actionable suggestions

**Files to modify**:

- `lib/utils/config-validator.ts` (new file)
- `bin/commands/setup-wizard.ts` (use shared validator)
- `bin/commands/validate.ts` (enhance)
- `bin/commands/deploy.ts` (add dry-run)

**Time estimate**: 6-8 hours

---

### Phase 4: Clean Up Deprecated Code (LONG TERM)

**Goal**: Remove all traces of `nonInteractive` parameter

**Tasks**:

1. Search for remaining `nonInteractive` references
   - Should only be in type definitions or fallback code
2. Remove deprecated `nonInteractive` parameter from all interfaces
3. Remove any fallback code for `nonInteractive`
4. Update documentation and migration guide
5. Release as new major version (breaking change)

**Files to modify**:

- All command type definitions
- `bin/commands/*.ts` (remove fallback code)
- `CHANGELOG.md` (document breaking change)
- Documentation

**Time estimate**: 2-3 hours

---

## 5. Recommended Immediate Fix

### Apply Option A + C Combined (Smart Prompting with --yes Standardization)

This provides:

- ✅ Immediate fix for `--yes` not working
- ✅ Works for both first-time setup and repeat deployments
- ✅ Standardizes on `--yes` (removes `nonInteractive` confusion)
- ✅ Smart prompting (only prompts when needed)
- ✅ Backward compatible during transition

**Step 1: Update function signature** (in `bin/commands/setup-wizard.ts`):

```typescript
// Change line ~290:
// Before:
async function runConfigWizard(options: WizardOptions = {}): Promise<ProfileConfig> {
    const { existingConfig = {}, nonInteractive = false, inheritFrom } = options;

// After:
async function runConfigWizard(options: WizardOptions = {}): Promise<ProfileConfig> {
    const { existingConfig = {}, yes = false, nonInteractive = false, inheritFrom } = options;

    // Backward compatibility: support old nonInteractive parameter
    const useYesMode = yes || nonInteractive;
```

**Step 2: Replace validation logic** (replace lines 305-327):

```typescript
// Smart prompting logic
if (useYesMode) {
    // Determine which fields still need values
    const fieldsToPrompt = determineRequiredFields(config);

    if (fieldsToPrompt.length === 0) {
        // All fields have values or defaults - no prompts needed
        console.log(chalk.green('✓ Using existing configuration'));

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

    // Some fields need values - prompt only for those
    console.log(chalk.yellow(`\nThe following fields need values:`));
    fieldsToPrompt.forEach(field => console.log(chalk.yellow(`  - ${field}`)));
    console.log('');

    // Prompt for only the missing fields
    const answers = await promptForSpecificFields(fieldsToPrompt, config);

    // Merge answers with existing config
    return mergeConfigWithAnswers(config, answers);
}

// Without --yes: continue with full interactive mode
// (existing wizard logic on lines 329+)
```

**Step 3: Add helper function** (at top of file):

```typescript
function determineRequiredFields(config: Partial<ProfileConfig>): string[] {
    const fieldChecks = [
        { key: 'quilt.stackArn', value: config.quilt?.stackArn, hasDefault: false },
        { key: 'quilt.catalog', value: config.quilt?.catalog, hasDefault: false },
        { key: 'quilt.database', value: config.quilt?.database, hasDefault: true }, // Default: 'benchling'
        { key: 'quilt.queueUrl', value: config.quilt?.queueUrl, hasDefault: false },
        { key: 'quilt.region', value: config.quilt?.region, hasDefault: false },
        { key: 'benchling.tenant', value: config.benchling?.tenant, hasDefault: false },
        { key: 'benchling.clientId', value: config.benchling?.clientId, hasDefault: false },
        { key: 'benchling.clientSecret', value: config.benchling?.clientSecret, hasDefault: false },
        { key: 'benchling.appDefinitionId', value: config.benchling?.appDefinitionId, hasDefault: false },
        { key: 'packages.bucket', value: config.packages?.bucket, hasDefault: false },
        { key: 'packages.prefix', value: config.packages?.prefix, hasDefault: true }, // Default: 'benchling/'
        { key: 'packages.metadataKey', value: config.packages?.metadataKey, hasDefault: true }, // Default: 'user_metadata'
        { key: 'deployment.region', value: config.deployment?.region, hasDefault: false },
        { key: 'deployment.account', value: config.deployment?.account, hasDefault: false },
    ];

    // Return only fields that have no value and no default
    return fieldChecks
        .filter(field => {
            const hasValue = field.value && (typeof field.value !== 'string' || field.value.trim() !== '');
            return !hasValue && !field.hasDefault;
        })
        .map(field => field.key);
}

async function promptForSpecificFields(
    fieldKeys: string[],
    existingConfig: Partial<ProfileConfig>
): Promise<Partial<ProfileConfig>> {
    // Implementation: prompt only for the specified fields
    // Use existing prompt definitions from wizard but filter to only fieldKeys
    const answers: Partial<ProfileConfig> = {};

    // TODO: Implement field-by-field prompting
    // For now, can throw helpful error
    throw new Error(
        `Cannot proceed in --yes mode: missing required fields.\n` +
        `Missing: ${fieldKeys.join(', ')}\n\n` +
        `Please run 'npm run setup' without --yes to configure these fields.`
    );
}

function mergeConfigWithAnswers(
    config: Partial<ProfileConfig>,
    answers: Partial<ProfileConfig>
): ProfileConfig {
    // Deep merge answers into config
    return {
        ...config,
        ...answers,
        _metadata: {
            version: "0.7.0",
            createdAt: config._metadata?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: "wizard",
        },
    } as ProfileConfig;
}
```

**Step 4: Update install.ts** (line 96):

```typescript
// Before:
setupResult = await setupWizardCommand({
    nonInteractive: nonInteractive || yes,
    isPartOfInstall: true,
});

// After:
setupResult = await setupWizardCommand({
    yes: yes,  // Pass yes directly
    nonInteractive: nonInteractive,  // Keep for backward compatibility
    isPartOfInstall: true,
});
```

---

## 6. Testing Checklist

After implementing the fix, verify:

- [ ] `npm run setup -- --yes` (with complete config) → No prompts, uses existing config
- [ ] `npm run setup -- --yes` (with partial config) → Prompts only for missing required fields
- [ ] `npm run setup -- --yes` (with no config) → Prompts for all required fields (but uses defaults where available)
- [ ] `npm run setup` (without --yes) → Full interactive prompts with confirmations
- [ ] `npm run deploy:dev -- --yes` → No prompts, deploys immediately
- [ ] `npx @quiltdata/benchling-webhook --yes` (first time) → Prompts for missing fields, then deploys
- [ ] `npx @quiltdata/benchling-webhook --yes` (repeat) → No prompts, uses existing config, deploys immediately
- [ ] Backward compatibility: Old code using `nonInteractive` parameter still works

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
