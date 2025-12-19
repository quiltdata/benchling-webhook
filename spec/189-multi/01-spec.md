# Configuration Architecture Cleanup Specification

**Status**: Draft
**Date**: 2025-11-04
**Related**: [#176](https://github.com/quiltdata/benchling-webhook/issues/176), [17-implementation-summary.md](./17-implementation-summary.md)

---

## Executive Summary

The current XDG configuration system and install wizard have accumulated significant technical debt during the multi-environment implementation. This specification proposes a complete restructuring to create a clean, maintainable, and intuitive configuration architecture.

**IMPORTANT: This is a HARD SHIFT with NO backward compatibility. Version 0.7.0 will completely remove all legacy configuration support. Users must manually reconfigure using the new wizard.**

### Current Problems

1. **Directory Structure Chaos**: Mixing of concerns across multiple directory levels
2. **Deploy.json Confusion**: Shared deployment tracking file conflicts with profile isolation
3. **Install Wizard Bloat**: 805 lines doing too much with unclear responsibilities
4. **Inconsistent Profile Fallback**: Manual merging logic scattered across codebase
5. **Type System Misalignment**: Types don't match actual file structure

---

## Part 1: Current State Analysis

### 1.1 Current Directory Structure

```
~/.config/benchling-webhook/
├── default.json              # ❌ User config for "default" profile
├── default.json.backup       # ❌ Backup files clutter root
├── config/
│   ├── default.json          # ❌ "Derived" config (rarely used)
│   └── default.json.backup
├── deploy/                   # ❌ Empty directory (never used)
├── deploy.json               # ❌ SHARED across ALL profiles!
├── logs/
│   └── config.log            # ❌ Logging to config dir
└── profiles/
    ├── dev/
    │   ├── default.json      # ✅ User config for "dev" profile
    │   ├── config/           # ❌ Empty (never used)
    │   └── deploy/           # ❌ Empty (never used)
    ├── custom/
    │   └── ...
    └── temp/
        └── ...
```

### 1.2 Problems Identified

#### Problem #1: `deploy.json` is Profile-Agnostic

**Current behavior**:

```json
// ~/.config/benchling-webhook/deploy.json
{
  "prod": { "endpoint": "...", "imageTag": "0.6.3", ... },
  "dev": { "endpoint": "...", "imageTag": "latest", ... }
}
```

**Issues**:

- Conflates **profile** (configuration source) with **stage** (API Gateway deployment target)
- Cannot deploy `dev` profile to `prod` stage (or vice versa)
- Deployment tracking not isolated per profile
- Testing assumes stage=profile, breaking flexibility

**Example of confusion**:

```bash
# Using "dev" profile to deploy to "prod" stage?
npm run deploy -- --profile dev --environment prod
# ❌ deploy.json["prod"] gets overwritten by dev profile deployment
```

#### Problem #2: Three-Tier Config System is Over-Engineered

**Defined types**:

1. `UserConfig` - User-provided settings
2. `DerivedConfig` - CLI-inferred settings
3. `DeploymentConfig` - Deployment artifacts

**Reality**:

- `config/default.json` (derived) is rarely written or read
- Most code directly reads `default.json` (user config)
- Merging logic is manual and inconsistent
- No actual use case for separation

#### Problem #3: Install Wizard Does Too Much

**Lines 1-805**: `scripts/install-wizard.ts`

**Responsibilities** (too many):

1. ✅ User input collection (Benchling tenant, OAuth, etc.)
2. ✅ Configuration validation (tenant URL, OAuth credentials, S3 bucket)
3. ✅ Quilt stack inference via CLI
4. ❌ AWS account verification (should be in deploy command)
5. ❌ AWS Secrets Manager sync (should be separate script)
6. ❌ Profile fallback logic (should be in XDGConfig)
7. ❌ Manual merging of default profile (lines 346-359)

**Key anti-pattern** (lines 346-359):

```typescript
// Manual profile fallback in wizard
if (profile !== "default") {
    const defaultConfig = xdgConfig.readProfileConfig("user", "default");
    existingConfig = { ...defaultConfig, ...existingConfig };
}
```

**Should be**: `XDGConfig.readConfig({ profile: "dev", fallbackToDefault: true })`

#### Problem #4: XDGConfig is Inconsistent

**Methods**:

- `readConfig(type)` - Old API (no profiles)
- `readProfileConfig(type, profile)` - New API (profiles)
- `getProfilePaths(profile)` - Returns paths but still uses `default.json` filename
- `ensureProfileDirectories(profile)` - Creates `config/` and `deploy/` subdirs that are never used

**Inconsistencies**:

1. Default profile stored at `~/.config/benchling-webhook/default.json`
2. Named profiles stored at `~/.config/benchling-webhook/profiles/dev/default.json`
3. Both use filename `default.json` (confusing!)
4. Subdirectories `config/` and `deploy/` created but never used

#### Problem #5: Profile ≠ Stage Confusion

**Design intent** (from implementation summary):

- **Profile**: Configuration source (`default`, `dev`, `custom`)
- **Stage**: API Gateway deployment target (`dev`, `prod`)

**Current reality**:

- `npm run deploy:dev` uses `--profile dev --environment dev`
- `npm run deploy:prod` uses `--profile default --environment prod`
- `deploy.json` uses **stage** as top-level key, not **profile**
- Tests read `deploy.json[stage]` but use `--profile` for config

**This prevents**:

- Testing prod config in dev stage
- Blue/green deployments with different profiles
- A/B testing configurations

---

## Part 2: Proposed Architecture

### 2.1 Core Principles

1. **Profile = Configuration Context**: A named set of configuration values
2. **Stage = Deployment Target**: An API Gateway stage name (`dev`, `prod`, `staging`, etc.)
3. **One Source of Truth**: Each profile has ONE configuration file
4. **Profile Isolation**: Each profile tracks its own deployments
5. **Explicit Over Implicit**: No magic fallbacks or merging

### 2.2 Simplified Directory Structure

```
~/.config/benchling-webhook/
├── default/
│   ├── config.json           # All configuration
│   └── deployments.json      # Deployment history
├── dev/
│   ├── config.json
│   └── deployments.json
├── prod/
│   ├── config.json
│   └── deployments.json
└── .metadata.json            # Global metadata (version, etc.)
```

**Changes**:

1. ✅ Profiles are top-level directories (no nested `profiles/` folder)
2. ✅ Single `config.json` per profile (no more `default.json`)
3. ✅ Per-profile `deployments.json` (not shared)
4. ✅ No more `config/` and `deploy/` subdirectories
5. ✅ No more backup files cluttering directory
6. ✅ Flat structure - everything at same level

### 2.3 Deployment Tracking Structure

**OLD** (shared across profiles):

```json
// ~/.config/benchling-webhook/deploy.json
{
  "prod": { "endpoint": "...", "imageTag": "0.6.3" },
  "dev": { "endpoint": "...", "imageTag": "latest" }
}
```

**NEW** (per-profile):

```json
// ~/.config/benchling-webhook/profiles/dev/deployments.json
{
  "history": [
    {
      "stage": "dev",
      "timestamp": "2025-11-04T10:30:00Z",
      "imageTag": "latest",
      "endpoint": "https://xxx.execute-api.us-east-1.amazonaws.com/dev",
      "stackName": "BenchlingWebhookStack",
      "region": "us-east-1",
      "deployedBy": "ernest@example.com",
      "commit": "abc123f"
    },
    {
      "stage": "prod",
      "timestamp": "2025-11-03T14:20:00Z",
      "imageTag": "0.6.3",
      "endpoint": "https://xxx.execute-api.us-east-1.amazonaws.com/prod",
      "stackName": "BenchlingWebhookStack",
      "region": "us-east-1",
      "deployedBy": "ernest@example.com",
      "commit": "def456a"
    }
  ],
  "active": {
    "dev": {
      "endpoint": "https://xxx.execute-api.us-east-1.amazonaws.com/dev",
      "imageTag": "latest",
      "deployedAt": "2025-11-04T10:30:00Z"
    },
    "prod": {
      "endpoint": "https://xxx.execute-api.us-east-1.amazonaws.com/prod",
      "imageTag": "0.6.3",
      "deployedAt": "2025-11-03T14:20:00Z"
    }
  }
}
```

**Benefits**:

1. ✅ Track deployment history (rollback capability)
2. ✅ Support multiple stages per profile
3. ✅ Profile isolation (dev profile doesn't see prod profile deployments)
4. ✅ Rich metadata for debugging

### 2.4 Unified Configuration Schema

**Single source of truth** (`config.json`):

```typescript
interface ProfileConfig {
  // Quilt Configuration
  quilt: {
    stackArn: string;
    catalog: string;
    bucket: string;
    database: string;
    queueArn: string;
    region: string;
  };

  // Benchling Configuration
  benchling: {
    tenant: string;
    clientId: string;
    clientSecret?: string;      // Optional (use Secrets Manager instead)
    secretArn?: string;          // AWS Secrets Manager ARN
    appDefinitionId: string;
    testEntryId?: string;
  };

  // Package Configuration
  packages: {
    bucket: string;              // S3 bucket for packages
    prefix: string;              // S3 prefix (default: "benchling")
    metadataKey: string;         // Package metadata key (default: "experiment_id")
  };

  // Deployment Configuration
  deployment: {
    region: string;              // AWS region for CDK deployment
    account?: string;            // AWS account ID
    ecrRepository?: string;      // ECR repository name
    imageTag?: string;           // Docker image tag (default: "latest")
  };

  // Optional Configuration
  logging?: {
    level: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  };

  security?: {
    webhookAllowList?: string;   // Comma-separated IP allowlist
    enableVerification?: boolean; // Webhook signature verification
  };

  // Profile Metadata
  _metadata: {
    version: string;             // Config schema version
    createdAt: string;           // ISO timestamp
    updatedAt: string;           // ISO timestamp
    source: string;              // "wizard" | "manual" | "cli"
  };
}
```

**Changes**:

1. ✅ Nested structure for clarity
2. ✅ No deployment artifacts mixed in (separate file)
3. ✅ Clear optional vs required fields
4. ✅ Consistent naming (no more `benchlingPkgBucket` vs `quiltUserBucket`)

### 2.5 XDGConfig Simplified API

**Remove complexity**:

```typescript
// ❌ OLD API (confusing)
readConfig(type: ConfigType): BaseConfig
readProfileConfig(type: ConfigType, profile: ProfileName): BaseConfig
writeConfig(type: ConfigType, config: BaseConfig): void
writeProfileConfig(type: ConfigType, config: BaseConfig, profile: ProfileName): void
mergeConfigs(configs: ConfigSet): BaseConfig
```

**New clean API**:

```typescript
class XDGConfig {
  // Configuration Management
  readProfile(profile: string): ProfileConfig
  writeProfile(profile: string, config: ProfileConfig): void
  deleteProfile(profile: string): void
  listProfiles(): string[]
  profileExists(profile: string): boolean

  // Deployment Tracking
  getDeployments(profile: string): DeploymentHistory
  recordDeployment(profile: string, deployment: DeploymentRecord): void
  getActiveDeployment(profile: string, stage: string): DeploymentRecord | null

  // Profile Inheritance (NEW!)
  readProfileWithInheritance(profile: string, baseProfile?: string): ProfileConfig

  // Validation
  validateProfile(config: ProfileConfig): ValidationResult

  // Migration
  migrateFromLegacy(): MigrationReport
}
```

**Key improvements**:

1. ✅ Single config type (no more `user` | `derived` | `deploy`)
2. ✅ Profile-first API (profiles are primary concept)
3. ✅ Explicit inheritance (no hidden merging)
4. ✅ Separate deployment tracking
5. ✅ Built-in validation and migration

### 2.6 Install Wizard Refactoring

**Split into focused modules**:

```
scripts/
├── config/
│   ├── wizard.ts              # Interactive prompts only (200 lines)
│   ├── validator.ts           # Configuration validation (150 lines)
│   ├── inferrer.ts            # Quilt config inference (100 lines)
│   └── secrets.ts             # AWS Secrets Manager sync (existing)
└── install-wizard.ts          # Main entry point (50 lines)
```

**New wizard flow**:

```typescript
// scripts/install-wizard.ts
import { runConfigWizard } from "./config/wizard";
import { validateConfig } from "./config/validator";
import { inferQuiltConfig } from "./config/inferrer";
import { syncSecretsToAWS } from "./config/secrets";

export async function installWizard(options: {
  profile: string;
  nonInteractive?: boolean;
}) {
  const { profile, nonInteractive } = options;

  // Step 1: Load existing config (with optional inheritance)
  const xdg = new XDGConfig();
  let config = xdg.profileExists(profile)
    ? xdg.readProfile(profile)
    : inheritFromDefault ? xdg.readProfile("default") : {};

  // Step 2: Infer Quilt config
  const quiltConfig = await inferQuiltConfig();
  config = { ...config, quilt: quiltConfig };

  // Step 3: Run interactive wizard (if not --yes)
  if (!nonInteractive) {
    config = await runConfigWizard(config);
  }

  // Step 4: Validate
  const validation = validateConfig(config);
  if (!validation.isValid) {
    throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
  }

  // Step 5: Save
  xdg.writeProfile(profile, config);

  // Step 6: Sync secrets (optional)
  if (!nonInteractive) {
    const { syncSecrets } = await prompt({ ... });
    if (syncSecrets) {
      await syncSecretsToAWS(profile, config);
    }
  }

  return config;
}
```

**Responsibilities**:

- ✅ `wizard.ts`: User prompts ONLY
- ✅ `validator.ts`: Network validation (tenant URL, OAuth, S3)
- ✅ `inferrer.ts`: Quilt config inference
- ✅ `secrets.ts`: AWS integration (existing)
- ✅ Main: Orchestration only

### 2.7 Profile Inheritance Model

**Explicit inheritance** (opt-in):

```bash
# Create dev profile inheriting from default
benchling-webhook setup-profile dev --inherit-from default

# Prompt only for differences:
# - Benchling App Definition ID (different per environment)
# - Image tag (latest vs version)
# - Optional: Quilt Stack ARN override
```

**Implementation**:

```typescript
// lib/xdg-config.ts
class XDGConfig {
  readProfileWithInheritance(
    profile: string,
    baseProfile: string = "default"
  ): ProfileConfig {
    const base = this.readProfile(baseProfile);

    if (profile === baseProfile) {
      return base;
    }

    const overrides = this.readProfile(profile);

    // Deep merge with overrides taking precedence
    return deepMerge(base, overrides);
  }
}
```

**Storage**:

```json
// ~/.config/benchling-webhook/profiles/dev/config.json
{
  "_inherits": "default",
  "benchling": {
    "appDefinitionId": "app_dev_123"  // Override only this
  },
  "deployment": {
    "imageTag": "latest"               // Override only this
  }
}
```

---

## Part 3: No Migration - Hard Shift to v0.7.0

### 3.1 Breaking Change Strategy

**BREAKING CHANGE: Complete removal of legacy configuration support in v0.7.0**

**Approach**: No automatic migration, no fallback, no legacy support

```typescript
// lib/xdg-config.ts
class XDGConfig {
  constructor() {
    // NO migration logic
    // Only work with new format
    this.ensureBaseDirectoryExists();
  }

  private ensureBaseDirectoryExists(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  readProfile(profile: string): ProfileConfig {
    const configPath = join(this.baseDir, profile, "config.json");

    if (!existsSync(configPath)) {
      throw new Error(`
        ❌ Profile not found: ${profile}

        ${this.getLegacyHelpMessage()}
      `);
    }

    return JSON.parse(readFileSync(configPath, "utf-8"));
  }

  private getLegacyHelpMessage(): string {
    const legacyFiles = [
      join(this.baseDir, "default.json"),
      join(this.baseDir, "deploy.json"),
      join(this.baseDir, "profiles"),
    ];

    const hasLegacyFiles = legacyFiles.some(f => existsSync(f));

    if (hasLegacyFiles) {
      return `
Configuration format changed in v0.7.0.
Your old configuration files are not compatible.

Please run setup wizard to create new configuration:
  npx @quiltdata/benchling-webhook@latest setup

Your old configuration files remain at:
  ~/.config/benchling-webhook/default.json
  ~/.config/benchling-webhook/deploy.json

You can manually reference these files to re-enter your settings.
      `.trim();
    }

    return `
No configuration found for profile: ${profile}

Run setup wizard to create configuration:
  npx @quiltdata/benchling-webhook@latest setup
    `.trim();
  }
}
```

### 3.2 No Migration Steps

**There is NO automatic migration. Users must manually reconfigure.**

**Old structure** (v0.6.x - IGNORED by v0.7.0):

```text
~/.config/benchling-webhook/
├── default.json              # ❌ NOT READ
├── deploy.json               # ❌ NOT READ
├── config/
│   └── default.json          # ❌ NOT READ
└── profiles/
    └── dev/
        └── default.json      # ❌ NOT READ
```

**New structure** (v0.7.0 - REQUIRED):

```text
~/.config/benchling-webhook/
├── default/
│   ├── config.json           # ✅ ONLY THIS IS READ
│   └── deployments.json
└── dev/
    ├── config.json           # ✅ ONLY THIS IS READ
    └── deployments.json
```

### 3.3 User Reconfiguration Required

#### Rationale for Hard Shift

- The legacy configuration structure is fundamentally incompatible with the new architecture
- Auto-migration is complex, error-prone, and masks the architectural shift
- Clean break forces users to understand the new multi-environment model
- Simplifies codebase by removing all legacy code paths immediately
- Users can keep v0.6.x for existing deployments while setting up v0.7.0 separately

#### User Migration Guide

Users upgrading from v0.6.x to v0.7.0 must:

1. **Review current configuration** (before upgrading):
   - Note settings from `~/.config/benchling-webhook/default.json`
   - Note any profile configurations from `~/.config/benchling-webhook/profiles/*/default.json`
   - Document deployment settings from `~/.config/benchling-webhook/deploy.json`

2. **Upgrade and reconfigure**:
   - Install v0.7.0: `npm install -g @quiltdata/benchling-webhook@0.7.0`
   - Run setup wizard: `benchling-webhook setup`
   - Re-enter configuration values when prompted
   - For multi-environment setups, create additional profiles:
     - `benchling-webhook setup-profile dev --inherit-from default`

3. **Verify new configuration**:
   - Test deployment: `benchling-webhook deploy --profile default --stage prod`
   - Confirm webhook functionality
   - Verify logs and monitoring

4. **Clean up** (optional):
   - Old configuration files at `~/.config/benchling-webhook/*.json` can be deleted
   - Or keep them for reference/rollback purposes

---

## Part 4: Implementation Checklist

### Phase 1: Core Refactoring

- [ ] **Task 1.1**: Define new `ProfileConfig` interface
  - [ ] Write TypeScript types
  - [ ] Write JSON schema for validation
  - [ ] Add JSDoc documentation

- [ ] **Task 1.2**: Refactor `XDGConfig` class
  - [ ] Remove `ConfigType` enum
  - [ ] Implement new API methods (profile-first design)
  - [ ] Add profile inheritance support
  - [ ] Add deployment tracking methods
  - [ ] Remove ALL legacy file reading code
  - [ ] Add helpful error messages for missing configs

- [ ] **Task 1.3**: Update file paths and structure
  - [ ] Change from `profiles/{name}/default.json` to `{name}/config.json`
  - [ ] Implement per-profile `deployments.json`
  - [ ] Remove global `deploy.json` support entirely

### Phase 2: Install Wizard Cleanup

- [ ] **Task 2.1**: Split wizard into modules
  - [ ] Extract `wizard.ts` (prompts only)
  - [ ] Extract `validator.ts` (validation only)
  - [ ] Keep `inferrer.ts` as-is (already separate)
  - [ ] Update `install-wizard.ts` (orchestration)

- [ ] **Task 2.2**: Simplify wizard flow
  - [ ] Remove AWS account verification (move to deploy command)
  - [ ] Remove secrets sync prompt (make it explicit flag)
  - [ ] Use new `XDGConfig` API
  - [ ] Remove manual profile fallback logic

### Phase 3: Update Deployment Command

- [ ] **Task 3.1**: Update `bin/commands/deploy.ts`
  - [ ] Use new `XDGConfig.readProfile()` API
  - [ ] Use new `XDGConfig.recordDeployment()` API
  - [ ] Support `--profile` and `--stage` independently
  - [ ] Update deployment tracking format

- [ ] **Task 3.2**: Update test scripts
  - [ ] Read from `deployments.json` instead of `deploy.json`
  - [ ] Support profile-specific deployment lookup
  - [ ] Update `test:dev` and `test:prod` scripts

### Phase 4: Testing & Documentation

- [ ] **Task 4.1**: Write comprehensive tests
  - [ ] Test new `XDGConfig` API
  - [ ] Test profile inheritance
  - [ ] Test migration from all legacy formats
  - [ ] Test deployment tracking

- [ ] **Task 4.2**: Update documentation
  - [ ] Update README.md with new structure
  - [ ] Update CLAUDE.md with new architecture
  - [ ] Write migration guide for users
  - [ ] Add examples for common workflows

### Phase 5: Validation & Release

- [ ] **Task 5.1**: Manual testing
  - [ ] Test fresh install (no legacy files)
  - [ ] Test migration from v0.6.3
  - [ ] Test multi-profile workflows
  - [ ] Test deployment tracking

- [ ] **Task 5.2**: Release
  - [ ] Update CHANGELOG.md
  - [ ] Bump version to v0.7.0
  - [ ] Create release notes
  - [ ] Publish to npm

---

## Part 5: Example Workflows

### Workflow 1: Fresh Install (Single Environment)

```bash
# 1. Run wizard (creates default profile)
npx @quiltdata/benchling-webhook@latest setup

# Result:
# ~/.config/benchling-webhook/
# └── default/
#     └── config.json

# 2. Deploy to prod
npx @quiltdata/benchling-webhook@latest deploy

# Result:
# ~/.config/benchling-webhook/
# └── default/
#     ├── config.json
#     └── deployments.json (with "prod" entry)
```

### Workflow 2: Multi-Environment Setup

```bash
# 1. Setup default profile (prod config)
npx @quiltdata/benchling-webhook@latest setup

# 2. Create dev profile inheriting from default
npx @quiltdata/benchling-webhook@latest setup-profile dev --inherit-from default

# Prompts only for:
# - Benchling App Definition ID (different for dev)
# - Image tag (default: "latest")

# Result:
# ~/.config/benchling-webhook/
# ├── default/
# │   └── config.json
# └── dev/
#     └── config.json (with "_inherits": "default")

# 3. Deploy dev profile to dev stage
npx @quiltdata/benchling-webhook@latest deploy --profile dev --stage dev

# 4. Deploy default profile to prod stage
npx @quiltdata/benchling-webhook@latest deploy --profile default --stage prod

# Result:
# ~/.config/benchling-webhook/
# ├── default/
# │   ├── config.json
# │   └── deployments.json (with "prod" entry)
# └── dev/
#     ├── config.json
#     └── deployments.json (with "dev" entry)
```

### Workflow 3: Advanced (Multiple Stages Per Profile)

```bash
# Use dev profile to test against prod stage
npx @quiltdata/benchling-webhook@latest deploy --profile dev --stage prod

# Result:
# ~/.config/benchling-webhook/
# └── dev/
#     └── deployments.json
#         {
#           "active": {
#             "dev": { ... },
#             "prod": { ... }  // <-- Dev config in prod stage
#           }
#         }

# Run tests against prod stage using dev profile
npm run test -- --profile dev --stage prod
```

### Workflow 4: Upgrading from v0.6.3 to v0.7.0

```bash
# Step 1: Review existing configuration (while still on v0.6.3)
cat ~/.config/benchling-webhook/default.json
cat ~/.config/benchling-webhook/deploy.json
cat ~/.config/benchling-webhook/profiles/dev/default.json  # if using profiles

# Step 2: Install v0.7.0
npm install -g @quiltdata/benchling-webhook@0.7.0

# Step 3: Run any command (will fail with helpful message)
benchling-webhook deploy

# Output:
# ❌ Profile not found: default
#
# Configuration format changed in v0.7.0.
# Your old configuration files are not compatible.
#
# Please run setup wizard to create new configuration:
#   benchling-webhook setup
#
# Your old configuration files remain at:
#   ~/.config/benchling-webhook/default.json
#   ~/.config/benchling-webhook/deploy.json
#
# You can manually reference these files to re-enter your settings.

# Step 4: Run setup wizard and re-enter configuration
benchling-webhook setup

# Step 5: For multi-environment, create additional profiles
benchling-webhook setup-profile dev --inherit-from default

# Step 6: Test deployment
benchling-webhook deploy --profile default --stage prod

# Result (new structure):
# ~/.config/benchling-webhook/
# ├── default.json              # ⚠️  Old file (ignored by v0.7.0)
# ├── deploy.json               # ⚠️  Old file (ignored by v0.7.0)
# ├── profiles/                 # ⚠️  Old directory (ignored by v0.7.0)
# ├── default/
# │   ├── config.json           # ✅ New config (v0.7.0)
# │   └── deployments.json      # ✅ New deployments (v0.7.0)
# └── dev/
#     ├── config.json           # ✅ New config (v0.7.0)
#     └── deployments.json      # ✅ New deployments (v0.7.0)
```

---

## Part 6: Benefits Summary

### For End Users

1. ✅ **Clearer structure**: All profiles in one place
2. ✅ **Better isolation**: Each profile tracks its own deployments
3. ✅ **Flexible workflows**: Deploy any profile to any stage
4. ✅ **Deployment history**: See past deployments, rollback if needed
5. ✅ **Easier setup**: Inherit from default profile, override only what's different

### For Developers

1. ✅ **Simpler code**: Single config type, no manual merging
2. ✅ **Clear API**: Profile-first design, explicit inheritance
3. ✅ **Easier testing**: Profile isolation means independent test environments
4. ✅ **Maintainable**: Modular wizard, focused responsibilities
5. ✅ **Type-safe**: Types match actual file structure

### For Maintainers

1. ✅ **Less confusion**: Clear separation of profile vs stage
2. ✅ **Better debugging**: Deployment history with metadata
3. ✅ **Easier support**: Users can share `config.json` for troubleshooting
4. ✅ **Future-proof**: Architecture supports new features (blue/green, A/B testing)

---

## Appendix A: Type Definitions

```typescript
// lib/types/config.ts

/**
 * Profile Configuration (Single Source of Truth)
 */
export interface ProfileConfig {
  quilt: QuiltConfig;
  benchling: BenchlingConfig;
  packages: PackageConfig;
  deployment: DeploymentConfig;
  logging?: LoggingConfig;
  security?: SecurityConfig;
  _metadata: ConfigMetadata;
  _inherits?: string;  // Optional: base profile name
}

export interface QuiltConfig {
  stackArn: string;
  catalog: string;
  bucket: string;
  database: string;
  queueArn: string;
  region: string;
}

export interface BenchlingConfig {
  tenant: string;
  clientId: string;
  clientSecret?: string;
  secretArn?: string;
  appDefinitionId: string;
  testEntryId?: string;
}

export interface PackageConfig {
  bucket: string;
  prefix: string;
  metadataKey: string;
}

export interface DeploymentConfig {
  region: string;
  account?: string;
  ecrRepository?: string;
  imageTag?: string;
}

export interface LoggingConfig {
  level: "DEBUG" | "INFO" | "WARNING" | "ERROR";
}

export interface SecurityConfig {
  webhookAllowList?: string;
  enableVerification?: boolean;
}

export interface ConfigMetadata {
  version: string;
  createdAt: string;
  updatedAt: string;
  source: "wizard" | "manual" | "cli";
}

/**
 * Deployment Tracking
 */
export interface DeploymentHistory {
  active: Record<string, DeploymentRecord>;
  history: DeploymentRecord[];
}

export interface DeploymentRecord {
  stage: string;
  timestamp: string;
  imageTag: string;
  endpoint: string;
  stackName: string;
  region: string;
  deployedBy?: string;
  commit?: string;
}

/**
 * Migration
 */
export interface MigrationReport {
  success: boolean;
  profilesMigrated: string[];
  errors: string[];
  warnings?: string[];
}
```

---

## Appendix B: Comparison Table

| Aspect | Current (v0.6.3) | Proposed (v0.7.0) |
| -------- | ------------------ | ------------------- |
| **Profile location** | Mixed (root + `profiles/`) | Flat (all top-level) |
| **Config filename** | `default.json` | `config.json` |
| **Config types** | 3 (user, derived, deploy) | 1 (unified) |
| **Deployment tracking** | Shared `deploy.json` | Per-profile `deployments.json` |
| **Profile fallback** | Manual merging in wizard | Explicit inheritance with `_inherits` |
| **Subdirectories** | `config/`, `deploy/`, `profiles/` | None (completely flat) |
| **Backup files** | In-place (clutters dir) | Optional (managed by system) |
| **Wizard LOC** | 805 lines | ~500 lines (modular) |
| **Stage flexibility** | Limited (stage=profile) | Full (any profile → any stage) |
| **Deployment history** | No | Yes (with rollback) |
| **Type safety** | Misaligned | Fully aligned |

---

## Conclusion

This specification proposes a complete cleanup of the configuration architecture, addressing the technical debt accumulated during multi-environment implementation. The new design is clearer, more maintainable, and better aligned with user needs.

**This is a BREAKING CHANGE release (v0.7.0)**:

- NO backward compatibility with v0.6.x configuration files
- NO automatic migration
- Users MUST run setup wizard to reconfigure

**Rationale for Hard Shift**:

- Legacy structure is fundamentally incompatible with new architecture
- Clean break simplifies codebase and reduces technical debt
- Forces users to understand new multi-environment model
- Eliminates complex migration logic and edge cases
- Users can keep v0.6.x installed alongside v0.7.0 if needed

**Next Steps**:

1. Review and approve specification
2. Implement Phase 1 (Core Refactoring - remove all legacy code)
3. Implement Phase 2-4 (Wizard, Deploy, Tests, Docs)
4. Test with fresh installs and reconfiguration workflows
5. Prepare clear upgrade documentation and release notes
6. Release v0.7.0 as BREAKING CHANGE

**Timeline**: 2-3 weeks for full implementation and testing

**User Communication**:

- Release notes must clearly state BREAKING CHANGE
- Provide step-by-step upgrade guide
- Consider publishing upgrade guide before release
- Recommend users document their v0.6.x config before upgrading
