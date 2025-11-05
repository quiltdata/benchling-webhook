# Phase 3: Install Wizard Modularization - COMPLETE

**Date:** 2025-11-04
**Commit:** c0c30b6
**Related:** [#176](https://github.com/quiltdata/benchling-webhook/issues/176), [02-todo.md](./02-todo.md)

---

## Summary

Successfully completed Phase 3 of the configuration architecture cleanup by extracting the install wizard into focused, maintainable modules and rewriting the main orchestration to use the new v0.7.0 XDGConfig API.

**Goal:** Split monolithic setup wizard into focused modules, remove bloat, use new XDGConfig API.

**Status:** ✅ COMPLETE

---

## Files Created

### 1. `scripts/config/validator.ts` (310 lines)

**Purpose:** Configuration validation functions

**Exports:**
- `validateBenchlingTenant(tenant)` - Tests Benchling tenant URL accessibility
- `validateBenchlingCredentials(tenant, clientId, clientSecret)` - Validates OAuth credentials via token endpoint
- `validateS3BucketAccess(bucketName, region, awsProfile?)` - Tests S3 bucket access permissions
- `validateConfig(config, options?)` - Comprehensive validation of complete ProfileConfig

**Key Features:**
- HTTP-based validation for Benchling endpoints
- AWS SDK integration for S3 validation
- Detailed error messages and warnings
- Non-blocking warnings for network issues
- Type-safe with `ValidationResult` interface

**Spec Target:** ~150 lines (actual: 310 lines - comprehensive validation warranted more)

---

### 2. `scripts/config/wizard.ts` (297 lines)

**Purpose:** Interactive configuration prompts

**Exports:**
- `runConfigWizard(options?)` - Interactive prompt flow for collecting configuration

**Key Features:**
- Profile inheritance support via `inheritFrom` option
- Preserves existing values as defaults
- Handles sensitive data (passwords) securely
- Non-interactive mode validation
- Structured prompts by configuration section:
  1. Quilt configuration
  2. Benchling credentials
  3. Package settings
  4. Deployment configuration
  5. Optional settings (logging, security)

**Spec Target:** ~200 lines (actual: 297 lines - comprehensive prompts)

---

### 3. `scripts/infer-quilt-config.ts` (337 lines)

**Purpose:** Automatic Quilt stack detection and configuration inference

**Exports:**
- `inferQuiltConfig(options?)` - Infers Quilt configuration from CLI and CloudFormation

**Key Features:**
- Reads from `quilt3 config` CLI command
- Scans AWS CloudFormation stacks for Quilt deployments
- Interactive catalog selection when multiple stacks found
- Returns `ProfileConfig.quilt` format (v0.7.0)
- Fallback to manual configuration on failure
- CLI executable with `--region`, `--profile`, `--non-interactive` flags

**Spec Target:** Keep as-is (actual: 337 lines - adapted from bin/commands version)

---

### 4. `scripts/install-wizard.ts` (278 lines)

**Purpose:** Main orchestration for complete setup workflow

**Exports:**
- `runInstallWizard(options?)` - Complete configuration workflow orchestration

**Key Features:**
- Uses new `XDGConfig` API (readProfile, writeProfile, profileExists)
- Profile inheritance support via `--inherit-from` flag
- Comprehensive error handling and user prompts
- Validation integration with skip option
- Clear next steps after setup completion
- CLI argument parsing with help text

**CLI Options:**
```bash
--profile <name>          # Profile name (default: "default")
--inherit-from <profile>  # Inherit from another profile
--region <region>         # AWS region (default: "us-east-1")
--aws-profile <profile>   # AWS profile to use
--yes, -y                 # Non-interactive mode
--skip-validation         # Skip configuration validation
--help, -h                # Show help message
```

**Spec Target:** ~100 lines orchestration (actual: 278 lines - more comprehensive error handling)

---

## Architecture Improvements

### Separation of Concerns

| Module | Responsibility | Lines |
|--------|---------------|-------|
| `validator.ts` | All validation logic | 310 |
| `wizard.ts` | All inquirer prompts | 297 |
| `infer-quilt-config.ts` | Quilt detection | 337 |
| `install-wizard.ts` | Orchestration flow | 278 |

**Total:** 1,222 lines across 4 focused modules

### Key Differences from v0.6.x

1. ✅ **NO legacy config types** - Uses only `ProfileConfig` from v0.7.0
2. ✅ **NO manual fallback logic** - XDGConfig handles profile management
3. ✅ **NO AWS account verification** - Moved to deploy command (as per spec)
4. ✅ **NO secrets sync prompt** - Must be run explicitly via separate command
5. ✅ **Profile inheritance** - New `--inherit-from` flag for profile hierarchies

### Integration Points

- ✅ Uses `XDGConfig.readProfile()` for loading existing configs
- ✅ Uses `XDGConfig.writeProfile()` for saving configs
- ✅ Uses `XDGConfig.profileExists()` for checking profiles
- ✅ Uses `XDGConfig.readProfileWithInheritance()` for inherited profiles
- ✅ Returns `ProfileConfig` type (v0.7.0 format)
- ✅ No references to legacy `ConfigType` enum
- ✅ No references to `BaseConfig`, `UserConfig`, `DerivedConfig`

---

## Line Count Comparison

**Original (v0.6.x):**
```
bin/commands/setup-wizard.ts: 822 lines (monolithic)
```

**New (v0.7.0):**
```
scripts/config/validator.ts:      310 lines
scripts/config/wizard.ts:         297 lines
scripts/infer-quilt-config.ts:    337 lines
scripts/install-wizard.ts:        278 lines
─────────────────────────────────────────
Total:                          1,222 lines
```

**Analysis:**

While the total line count increased by ~400 lines (48%), each module is now:

- **Focused:** Single responsibility principle
- **Testable:** Clear interfaces for unit testing
- **Maintainable:** Comprehensive JSDoc documentation
- **Reusable:** Can be imported independently
- **Type-safe:** Full TypeScript type coverage

---

## Testing Status

| Test | Status | Notes |
|------|--------|-------|
| **Linting** | ✅ PASS | All files pass ESLint |
| **Type Safety** | ✅ PASS | TypeScript compilation successful |
| **Integration** | ⚠️ PARTIAL | Other files still use v0.6.x APIs (Phase 4 work) |
| **Unit Tests** | ⏳ PENDING | To be added in Phase 6 |

---

## Breaking Changes

This is part of v0.7.0 breaking changes:

- ❌ **NO backward compatibility** with v0.6.x config files
- ✅ **New profile directory structure:** `~/.config/benchling-webhook/{profile}/config.json`
- ✅ **Legacy detection:** Helpful migration messages built into XDGConfig
- ✅ **Profile inheritance:** New `_inherits` field in config

---

## Next Steps (Phase 4)

The following files still need updates to use new wizard modules:

### Priority 1: CLI Commands
- [ ] `bin/commands/setup-wizard.ts` - Replace with call to `scripts/install-wizard.ts`
- [ ] `bin/commands/deploy.ts` - Update to use new XDGConfig API
- [ ] `bin/commands/config-profiles.ts` - Update profile management
- [ ] `bin/commands/sync-secrets.ts` - Update to read from new config format

### Priority 2: Deployment Scripts
- [ ] `bin/dev-deploy.ts` - Update deployment tracking to use `deployments.json`
- [ ] `bin/check-logs.ts` - Update to read from `deployments.json`

### Priority 3: Test Infrastructure
- [ ] Update test helpers to use new config structure
- [ ] Update mocks for ProfileConfig format

---

## Documentation Updates Needed

- [x] Module documentation (JSDoc) - ✅ Complete
- [ ] CLAUDE.md - Update setup commands
- [ ] README.md - Update quick start guide
- [ ] Add MIGRATION.md for v0.6.x users

---

## Verification Commands

```bash
# Show help
npx ts-node scripts/install-wizard.ts --help

# Create default profile
npx ts-node scripts/install-wizard.ts

# Create dev profile inheriting from default
npx ts-node scripts/install-wizard.ts --profile dev --inherit-from default

# Create profile with specific AWS region
npx ts-node scripts/install-wizard.ts --profile prod --region us-west-2

# Infer Quilt config only
npx ts-node scripts/infer-quilt-config.ts --region us-east-1

# Non-interactive mode (requires existing config)
npx ts-node scripts/install-wizard.ts --profile default --yes
```

---

## Learnings & Decisions

### Design Decisions

1. **Module Size Trade-off:** Accepted larger modules (310, 297 lines) in favor of:
   - Comprehensive error handling
   - Complete JSDoc documentation
   - Non-blocking warnings for network failures

2. **Error Handling Strategy:**
   - Network validation failures are warnings, not errors
   - User can proceed with warnings but not errors
   - Clear error messages with actionable suggestions

3. **Profile Inheritance:**
   - Implemented via `_inherits` field in config
   - Deep merge of nested objects
   - Circular dependency detection
   - Explicit with `--inherit-from` flag

4. **Secrets Management:**
   - Removed automatic secrets sync prompt
   - Made it explicit via separate command
   - Follows principle of least surprise

### Technical Challenges

1. **TypeScript Validation Result Warnings:**
   - `warnings` is optional in `ValidationResult`
   - Fixed by adding null checks: `if (!result.warnings) result.warnings = [];`

2. **Inquirer Type Safety:**
   - Inquirer types can be tricky with dynamic questions
   - Used explicit typing for validation functions

3. **Module Organization:**
   - Initially targeted smaller modules
   - Decided comprehensive functionality > arbitrary line limits

---

## Checklist

### Parallel Group 3A: Extract Modules ✅
- [x] Create `scripts/config/wizard.ts` (prompts only)
- [x] Create `scripts/config/validator.ts` (validation only)
- [x] Review `scripts/infer-quilt-config.ts` (adapted from bin/commands)

### Task 3.2: Rewrite Main Wizard ✅
- [x] Update `scripts/install-wizard.ts` to use new modules
- [x] Use new `XDGConfig` API (no manual fallback logic)
- [x] Remove AWS account verification
- [x] Remove secrets sync prompt
- [x] Support `--inherit-from` flag

### Quality Checks ✅
- [x] Lint all files
- [x] Type check all files
- [x] Add comprehensive JSDoc
- [x] Follow TypeScript standards (4-space indent, double quotes)
- [x] Explicit return types on exports
- [x] No `any` types

### Commit & Documentation ✅
- [x] Git commit with conventional format
- [x] Create Phase 3 summary document
- [x] Update TODO status

---

## Metrics

| Metric | Value |
|--------|-------|
| **Files Created** | 4 |
| **Lines of Code** | 1,222 |
| **Functions Exported** | 6 |
| **CLI Commands** | 2 |
| **Test Coverage** | 0% (pending Phase 6) |
| **Documentation** | 100% (JSDoc complete) |
| **Type Safety** | 100% |

---

**Phase 3 Status:** ✅ **COMPLETE**

**Ready for:** Phase 4 (CLI & Deploy Command Updates)
