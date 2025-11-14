# Smart Prompting Semantics for --yes Flag

**Date**: 2025-11-13
**Status**: 📋 SPECIFICATION
**Parent**: [15-noninteractive-yes-flags-analysis.md](./15-noninteractive-yes-flags-analysis.md)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Current Behavior](#2-current-behavior)
3. [Desired Behavior](#3-desired-behavior)
4. [Scope of Changes](#4-scope-of-changes)
5. [Requirements](#5-requirements)
6. [Out of Scope](#6-out-of-scope)
7. [Success Criteria](#7-success-criteria)

---

## 1. Overview

### 1.1 Problem Statement

The `--yes` flag currently has inconsistent behavior across commands and still prompts users even when it shouldn't. Users expect `--yes` to mean "don't ask me for things you already know or have defaults for."

### 1.2 Goal

Change the semantics of `--yes` to implement "smart prompting":

- **Use CONFIGURED values without prompting** (values already saved in this profile)
- **Use OPTIONAL values without prompting** (fields with system hardcoded presets)
- **Prompt for required fields that have no configured or optional value**
- **Never skip over purely INHERITED values** (values from base profile used only as prompt defaults)

### 1.3 User Experience Target

```bash
# First time (no config exists yet, no CONFIGURED values)
$ npm run setup -- --yes
Using optional defaults where available...
Configuring required fields...

? Quilt Stack ARN: [prompt]
? Quilt Catalog: [prompt]
? Quilt Database: [prompt]
? Quilt Queue URL: [prompt]
? Benchling Tenant: [prompt]
? Benchling Client ID: [prompt]
? Benchling Client Secret: [prompt]
? Benchling App Definition ID: [prompt]
? S3 Bucket: [prompt]
? Deployment Region: [prompt]
? AWS Account ID: [prompt]

[automatically uses OPTIONAL presets for: packages.prefix, packages.metadataKey]
✓ Configuration saved

# Second time (config already exists with CONFIGURED values)
$ npm run setup -- --yes
✓ Using existing configuration from profile
[no prompts at all - uses all CONFIGURED values]

# Without --yes (traditional interactive)
$ npm run setup
[full wizard with all prompts and confirmations, showing existing CONFIGURED values as defaults]
```

---

## 2. Current Behavior

### 2.1 Problem: Prompts Despite --yes Flag

**Commands affected:**

- `npm run setup -- --yes` (via install.ts → setup-wizard.ts)
- `npx @quiltdata/benchling-webhook --yes` (via cli.ts → install.ts → setup-wizard.ts)

**Current behavior:**

- Prompts for ALL configuration fields
- Ignores existing configuration values
- Makes `--yes` effectively useless for repeat deployments

### 2.2 Root Cause

In [setup-wizard.ts](../../bin/commands/setup-wizard.ts):

- Lines 305-327: `nonInteractive` mode only validates 3 Benchling fields
- Lines 329-600: Always runs full wizard when validation fails or when `nonInteractive=false`
- No logic to selectively skip prompts based on existing values

---

## 3. Desired Behavior

### 3.1 New Smart Prompting Semantics

When `--yes` flag is provided:

1. **Load existing configuration**
   - Load profile config if it exists
   - Identify CONFIGURED values (fields with actual saved values in this profile)

2. **Apply OPTIONAL presets**
   - Automatically use system hardcoded presets for OPTIONAL fields
   - Examples: `packages.prefix = "benchling"`, `packages.metadataKey = "experiment_id"`
   - Don't prompt for these fields

3. **Determine missing required fields**
   - Identify fields that are required AND have no CONFIGURED value AND have no OPTIONAL preset
   - Only these fields need user input

4. **Handle INHERITED values correctly**
   - For `setup-profile`: INHERITED values from base profile are NOT treated as CONFIGURED
   - INHERITED values only serve as prompt defaults, not as skip criteria
   - User must still be prompted (but default is shown from inherited value)

5. **Minimal prompting**
   - If all required fields have CONFIGURED or OPTIONAL values → No prompts, proceed immediately
   - If some required fields missing → Show list of missing fields, prompt only for those
   - Skip all confirmation prompts

### 3.2 Behavior Without --yes Flag

Full interactive mode (current behavior):

- Prompt for all fields with existing values as defaults
- Show all confirmation prompts
- Allow editing all values
- Provide detailed explanations and help

---

## 4. Scope of Changes

### 4.1 Commands Requiring Updates

**Primary focus (Phase 1):**

1. [setup-wizard.ts](../../bin/commands/setup-wizard.ts) - Core wizard logic
2. [install.ts](../../bin/commands/install.ts) - Flag passing
3. [init.ts](../../bin/commands/init.ts) - Flag passing

**Secondary focus (Phase 2):**
4. [setup-profile.ts](../../bin/commands/setup-profile.ts) - Profile creation
5. [deploy.ts](../../bin/commands/deploy.ts) - Already works, verify consistency

### 4.2 Configuration Fields Inventory

**Required fields (must have CONFIGURED or OPTIONAL value):**

**Quilt Configuration:**

- `quilt.stackArn` - Required, no OPTIONAL preset
- `quilt.catalog` - Required, no OPTIONAL preset
- `quilt.database` - Required, no OPTIONAL preset (inferred from Quilt stack)
- `quilt.queueUrl` - Required, no OPTIONAL preset (inferred from Quilt stack)
- `quilt.region` - Required, no OPTIONAL preset (inferred from Quilt stack)

**Benchling Configuration:**

- `benchling.tenant` - Required, no OPTIONAL preset
- `benchling.clientId` - Required, no OPTIONAL preset
- `benchling.clientSecret` - Required, no OPTIONAL preset
- `benchling.appDefinitionId` - Required, no OPTIONAL preset

**Package Configuration:**

- `packages.bucket` - Required, no OPTIONAL preset
- `packages.prefix` - OPTIONAL preset: `"benchling"`
- `packages.metadataKey` - OPTIONAL preset: `"experiment_id"`

**Deployment Configuration:**

- `deployment.region` - Required, no OPTIONAL preset (inferred from Quilt stack)
- `deployment.account` - Required, no OPTIONAL preset (inferred from Quilt stack)

**Truly optional fields (can be empty):**

- `benchling.testEntryId` - Optional, can be omitted
- `deployment.logLevel` - OPTIONAL preset (from system)
- `deployment.webhookAllowList` - Optional, can be empty
- `deployment.enableVerification` - OPTIONAL preset: `"yes"`

### 4.3 Value Type Decision Matrix

| Value Type | Has CONFIGURED Value | Has OPTIONAL Preset | --yes Behavior |
|------------|---------------------|---------------------|----------------|
| CONFIGURED | ✅ Yes | N/A | Use CONFIGURED value, no prompt |
| OPTIONAL | ❌ No | ✅ Yes | Use OPTIONAL preset, no prompt |
| Required Missing | ❌ No | ❌ No | **Prompt required** |
| INHERITED (setup-profile) | ❌ No (not saved in this profile) | Maybe | Show inherited value as prompt default, but still prompt |
| Optional Empty | ❌ No | ✅ Yes/Optional | Use default/empty, no prompt |

---

## 5. Requirements

### 5.1 Functional Requirements

**FR-1: Value Type Detection**

- System MUST identify CONFIGURED values (fields with actual saved values in this profile)
- System MUST identify OPTIONAL presets (fields with system hardcoded defaults)
- System MUST identify INHERITED values (for setup-profile: values from base profile)
- System MUST distinguish between required fields and truly optional fields

**FR-2: Smart Prompting Logic**

- When `--yes=true` AND all required fields have CONFIGURED or OPTIONAL values → System MUST NOT prompt
- When `--yes=true` AND some required fields have no CONFIGURED or OPTIONAL value → System MUST prompt ONLY for those missing fields
- When `--yes=true` → System MUST NOT show confirmation prompts
- When `--yes=false` → System MUST use existing full interactive wizard
- System MUST NOT treat INHERITED values as CONFIGURED (must still prompt, showing inherited as default)

**FR-3: OPTIONAL Preset Application**

- System MUST apply OPTIONAL presets for fields without CONFIGURED values when `--yes=true`
- System MUST document which fields have OPTIONAL presets and their values
- System MUST use OPTIONAL presets without prompting when `--yes=true`
- OPTIONAL presets: `packages.prefix="benchling"`, `packages.metadataKey="experiment_id"`

**FR-4: User Feedback**

- System MUST show which CONFIGURED values are being used
- System MUST show which OPTIONAL presets are being applied
- System MUST indicate when prompting for required fields
- System MUST indicate when proceeding without prompts

**FR-5: Backward Compatibility**

- System MUST continue to support `nonInteractive` parameter during transition
- System MUST treat `nonInteractive=true` same as `yes=true`
- System MUST not break existing code using `nonInteractive`

### 5.2 Non-Functional Requirements

**NFR-1: User Experience**

- Smart prompting MUST reduce prompt count by 80%+ for repeat deployments
- Error messages MUST be actionable and clear
- Users MUST understand why they're being prompted (if at all)

**NFR-2: Safety**

- System MUST validate all configuration before proceeding
- System MUST NOT proceed with incomplete required fields
- System MUST NOT use invalid values silently

**NFR-3: Maintainability**

- Configuration field metadata MUST be centralized
- Prompt logic MUST be reusable across commands
- Changes MUST be testable with automated tests

---

## 6. Out of Scope

### 6.1 Explicitly NOT Included

**Not in this spec:**

- ❌ Removing `nonInteractive` parameter (that's a future cleanup task)
- ❌ Migrating from `inquirer` to `enquirer` (that's a separate library standardization task)
- ❌ Adding new configuration fields
- ❌ Changing default values for existing fields
- ❌ Adding `--skip-prompts` or other new flags
- ❌ Implementing `--dry-run` mode
- ❌ Creating new validation commands
- ❌ Modifying deployment logic beyond prompting behavior

### 6.2 Future Enhancements

These are good ideas but separate efforts:

- Configuration validation command with `--fix` option
- Shared configuration validator utility
- Enhanced error messages with suggestions
- CI/CD-specific configuration modes

---

## 7. Success Criteria

### 7.1 Primary Success Metrics

**Scenario 1: Complete Configuration + --yes**

```bash
npm run setup -- --yes
```

- ✅ MUST show "Using existing configuration" message
- ✅ MUST NOT prompt for any input
- ✅ MUST proceed to deployment (or setup-only) immediately
- ✅ MUST complete successfully

**Scenario 2: Partial Configuration + --yes**

```bash
$ npm run setup -- --yes
# (e.g., profile exists but missing benchling.tenant and quilt.stackArn)
```

- ✅ MUST prompt ONLY for those 2 missing required fields (no CONFIGURED or OPTIONAL values)
- ✅ MUST NOT prompt for fields with CONFIGURED values
- ✅ MUST apply OPTIONAL presets (packages.prefix, packages.metadataKey)
- ✅ MUST complete successfully after minimal input

**Scenario 3: No Configuration + --yes**

```bash
$ npx @quiltdata/benchling-webhook --yes
# (first time user, no config file exists)
```

- ✅ MUST show "Using optional presets where available"
- ✅ MUST prompt for all required fields without OPTIONAL presets (~11 fields including quilt.database)
- ✅ MUST NOT prompt for fields with OPTIONAL presets (packages.prefix, packages.metadataKey only)
- ✅ MUST automatically apply OPTIONAL presets without prompting
- ✅ MUST NOT show confirmation prompts
- ✅ MUST save configuration
- ✅ MUST complete successfully

**Scenario 4: No --yes Flag (Interactive Mode)**

```bash
npm run setup
```

- ✅ MUST show full wizard with all prompts
- ✅ MUST show CONFIGURED values as defaults in prompts
- ✅ MUST show OPTIONAL presets as defaults in prompts (if no CONFIGURED value)
- ✅ MUST allow editing all fields
- ✅ MUST show confirmation prompts
- ✅ MUST maintain current interactive experience

**Scenario 5: setup-profile with --yes (INHERITED values)**

```bash
$ npx benchling-webhook setup-profile dev --yes
# (default profile exists, dev profile is new)
```

- ✅ MUST show "Inheriting from 'default' profile"
- ✅ MUST still prompt for profile-specific required fields (e.g., appDefinitionId)
- ✅ MUST show INHERITED values as prompt defaults (but still prompt!)
- ✅ MUST NOT treat INHERITED values as CONFIGURED
- ✅ MUST skip confirmation prompts only
- ✅ MUST save profile configuration

### 7.2 Regression Prevention

**Must NOT break:**

- ❌ Existing code using `nonInteractive` parameter
- ❌ Deploy command's `--yes` behavior
- ❌ Profile inheritance functionality
- ❌ Configuration validation
- ❌ Profile save/load functionality

### 7.3 Test Coverage Requirements

**Unit tests MUST cover:**

- CONFIGURED value detection (field exists in profile with actual value)
- OPTIONAL preset identification (system hardcoded defaults)
- INHERITED value detection (for setup-profile: from base profile)
- Missing required field identification
- Smart prompting decision logic (CONFIGURED/OPTIONAL/INHERITED/Missing)
- Backward compatibility with `nonInteractive` parameter

**Integration tests MUST cover:**

- Complete CONFIGURED profile + --yes → no prompts
- Partial CONFIGURED profile + --yes → minimal prompts for missing required fields
- No config + --yes → prompt for required fields, auto-use OPTIONAL presets
- No --yes → full interactive mode with all prompts
- setup-profile + --yes → prompts even with INHERITED values
- Flag passing through command chain (cli → install → setup-wizard)
- OPTIONAL preset application (packages.prefix, packages.metadataKey only)

---

## 8. Implementation Checklist

### 8.1 What Needs to Be Done

**Configuration Infrastructure:**

- [ ] Define complete field metadata (name, required, hasOptionalPreset, optionalPresetValue)
- [ ] Create CONFIGURED value detection logic (check if field has value in this profile)
- [ ] Create OPTIONAL preset identification logic (system hardcoded defaults)
- [ ] Create INHERITED value detection logic (for setup-profile: values from base profile)
- [ ] Create missing required field identification logic

**Smart Prompting Logic:**

- [ ] Implement smart prompting decision tree based on CONFIGURED/OPTIONAL/INHERITED
- [ ] Create selective field prompting mechanism (only prompt for required fields without CONFIGURED or OPTIONAL values)
- [ ] Ensure INHERITED values are NOT treated as CONFIGURED (still prompt with inherited as default)
- [ ] Preserve full interactive mode for `--yes=false`
- [ ] Add user feedback messages (using CONFIGURED, using OPTIONAL presets, missing fields)

**Command Updates:**

- [ ] Update `setup-wizard.ts` to use smart prompting
- [ ] Ensure `install.ts` passes `yes` flag correctly
- [ ] Ensure `init.ts` passes `yes` flag correctly
- [ ] Verify `deploy.ts` consistency
- [ ] Update `setup-profile.ts` to support `--yes` flag

**Backward Compatibility:**

- [ ] Support both `yes` and `nonInteractive` parameters
- [ ] Map `nonInteractive=true` → `yes=true` behavior
- [ ] Ensure existing code doesn't break

**Testing:**

- [ ] Write unit tests for CONFIGURED/OPTIONAL/INHERITED value detection
- [ ] Write unit tests for smart prompting decision logic
- [ ] Write integration tests for all success scenarios
- [ ] Write regression tests for existing behavior
- [ ] Test NPX user experience locally
- [ ] Test setup-profile with INHERITED values (must still prompt with --yes)

**Documentation:**

- [ ] Update command help text to explain `--yes` behavior
- [ ] Document smart prompting semantics
- [ ] Add examples to README
- [ ] Update user guide

### 8.2 What Does NOT Need to Be Done

- ❌ Refactoring unrelated code
- ❌ Adding new configuration options
- ❌ Removing `nonInteractive` parameter (future cleanup)
- ❌ Changing library dependencies
- ❌ Modifying CDK deployment logic
- ❌ Adding new CLI flags beyond `--yes`

---

## 9. Acceptance Testing

### 9.1 Manual Test Scenarios

**Test 1: Repeat Deployment (Happy Path - All CONFIGURED)**

```bash
# Setup: Profile already configured completely with all CONFIGURED values
$ cat ~/.config/benchling-webhook/profiles/default.json
# Shows complete config with all required fields

$ npm run setup -- --yes
Expected Output:
  ✓ Loading configuration from profile 'default'
  ✓ All required fields have CONFIGURED values
  [no prompts]
  ✓ Configuration validated
  Deploy to AWS? (auto-confirmed with --yes)
  [deployment proceeds]
```

**Test 2: Incomplete Configuration**

```bash
# Setup: Profile exists but missing tenant and stackArn
$ npm run setup -- --yes
Expected Output:
  Using defaults where available...
  Configuring missing required fields...

  ? Benchling Tenant: [user inputs]
  ? Quilt Stack ARN: [user inputs]

  ✓ Configuration saved
  Deploy to AWS? (auto-confirmed with --yes)
  [deployment proceeds]
```

**Test 3: First Time User**

```bash
# Setup: No profile exists
$ npx @quiltdata/benchling-webhook --yes
Expected Output:
  No configuration found
  Using defaults where available...
  Configuring required fields...

  ? Quilt Stack ARN: [user inputs]
  ? Quilt Catalog: [user inputs]
  ? Quilt Database: [user inputs]
  ? Quilt Queue URL: [user inputs]
  ? Benchling Tenant: [user inputs]
  ? Benchling Client ID: [user inputs]
  ? Benchling Client Secret: [user inputs]
  ? Benchling App Definition ID: [user inputs]
  ? S3 Bucket: [user inputs]
  ? Deployment Region: [user inputs]
  ? AWS Account ID: [user inputs]

  [uses OPTIONAL presets for: packages.prefix, packages.metadataKey]

  ✓ Configuration saved
  [deployment proceeds automatically]
```

**Test 4: Interactive Mode (No --yes)**

```bash
$ npm run setup
Expected Output:
  Welcome to Benchling Webhook Setup...

  [full wizard with all prompts]
  [existing values shown as defaults]
  [confirmation prompts shown]

  ? Save configuration? (Y/n)
  ? Deploy to AWS now? (Y/n)
```

### 9.2 Automated Test Requirements

**Test Suite MUST verify:**

1. ✅ Complete CONFIGURED config + --yes = 0 prompts
2. ✅ Partial CONFIGURED config + --yes = prompts only for missing required fields
3. ✅ No config + --yes = prompts for all required fields, auto-applies OPTIONAL presets
4. ✅ Any config + no --yes = full interactive wizard
5. ✅ OPTIONAL presets (packages.prefix, packages.metadataKey) applied correctly when --yes used
6. ✅ CONFIGURED values preserved when --yes used
7. ✅ nonInteractive parameter still works (backward compatibility)
8. ✅ Field metadata correctly identifies CONFIGURED/OPTIONAL/INHERITED status
9. ✅ quilt.database is treated as REQUIRED (no OPTIONAL preset)
10. ✅ Missing field detection accurate

---

## 10. Related Documents

- [15-noninteractive-yes-flags-analysis.md](./15-noninteractive-yes-flags-analysis.md) - Problem analysis and proposed solutions
- [README.md](./README.md) - Phase tracking and overview

---

## 11. Notes

### 11.1 Design Decisions

**Why smart prompting instead of strict non-interactive?**

- More user-friendly for first-time setup
- Reduces friction for repeat deployments
- Allows progressive configuration (add fields over time)
- Better error messages (shows what's missing, doesn't just fail)

**Why keep nonInteractive parameter temporarily?**

- Backward compatibility
- Allows gradual migration
- Reduces risk of breaking existing internal code

**Why not add --skip-prompts flag?**

- Confusing to have multiple similar flags
- `--yes` with smart prompting covers all use cases
- Simpler mental model for users

### 11.2 Open Questions

None. Specification is complete and ready for implementation.

---

## 12. Changelog

| Date | Change | Author |
|------|--------|--------|
| 2025-11-13 | Initial specification created | Assistant |
