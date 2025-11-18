# Cached Resolution Architecture

**Status**: SPECIFICATION
**Priority**: CRITICAL
**Replaces**: Current broken setup → deploy flow

## Problem

Setup wizard discovers resources that deploy command ignores. Deploy re-queries AWS independently, leading to:
- Data loss (discovered resources discarded)
- Silent failures (empty parameters)
- Slow deploys (redundant CloudFormation queries)

## Solution

**Setup resolves once, deploy reads from config.**

## Architecture

```
Setup Time:
  Phase 2 → Resolve ALL services from AWS
         → Cache in ProfileConfig
         → Validate completeness
         → Save to config.json

Deploy Time:
  Read ProfileConfig
  → Extract cached services
  → Pass to CDK parameters
  → No AWS queries
```

## Config Schema Changes

### Add New Section: `resolvedServices`

```typescript
export interface ProfileConfig {
  // ... existing fields ...

  /**
   * Resolved Quilt services (cached at setup time)
   * These values are passed directly to deployment without re-querying AWS.
   */
  resolvedServices: ResolvedQuiltServices;
}

export interface ResolvedQuiltServices {
  /** SQS queue URL for package creation */
  packagerQueueUrl: string;

  /** Athena/Glue database name */
  athenaUserDatabase: string;

  /** Quilt catalog web host (no protocol) */
  quiltWebHost: string;

  /** Iceberg database (optional) */
  icebergDatabase?: string;

  /** Athena workgroup for user queries (optional) */
  athenaUserWorkgroup?: string;

  /** S3 bucket for Athena results (optional) */
  athenaResultsBucket?: string;

  /** Iceberg workgroup name (optional) */
  icebergWorkgroup?: string;

  /** Timestamp when services were resolved */
  resolvedAt: string;

  /** Quilt stack ARN used for resolution */
  sourceStackArn: string;
}
```

## Required Changes

### 1. Setup Wizard Changes

**File**: `lib/wizard/phase2-stack-query.ts`

#### Tasks:
- [ ] Call `resolveQuiltServices()` instead of `inferQuiltConfig()`
- [ ] If outputs missing, fall back to resource discovery
- [ ] Return `ResolvedQuiltServices` in `StackQueryResult`
- [ ] Add timestamp and source stack ARN to result

**File**: `lib/wizard/phase3-parameter-collection.ts`

#### Tasks:
- [ ] Remove redundant service prompts (use resolved values)
- [ ] Keep only user-configurable parameters (Benchling creds, package config)

**File**: `bin/commands/setup-wizard.ts`

#### Tasks:
- [ ] Store `resolvedServices` in ProfileConfig before saving
- [ ] Validate all required services are non-empty
- [ ] Fail setup if required services missing

### 2. Deploy Command Changes

**File**: `bin/commands/deploy.ts`

#### Tasks:
- [ ] Read `config.resolvedServices` instead of calling `resolveQuiltServices()`
- [ ] Remove `resolveQuiltServices()` call at line 295-319
- [ ] Validate `resolvedServices` exists and is complete
- [ ] Pass cached values directly to CDK parameters
- [ ] Add warning if `resolvedAt` is older than 30 days

### 3. Service Resolver Changes

**File**: `lib/utils/service-resolver.ts`

#### Tasks:
- [ ] Keep existing `resolveQuiltServices()` (used by setup only)
- [ ] Add `resolveQuiltServicesWithFallback()` function:
  - Try outputs first via `DescribeStacks`
  - Fall back to resources via `DescribeStackResources` if outputs missing
- [ ] Add validation for optional fields (warn if empty)

### 4. Type System Changes

**File**: `lib/types/config.ts`

#### Tasks:
- [ ] Add `ResolvedQuiltServices` interface
- [ ] Add `resolvedServices` field to `ProfileConfig`
- [ ] Mark as required (setup must populate it)
- [ ] Update JSON schema for validation
- [ ] Add migration helper for existing configs

### 5. Validation Changes

**File**: `lib/xdg-base.ts` (or new validator)

#### Tasks:
- [ ] Add `validateResolvedServices()` function
- [ ] Check all required fields are non-empty
- [ ] Warn if optional fields are empty
- [ ] Fail if `resolvedAt` timestamp is invalid
- [ ] Fail if `sourceStackArn` doesn't match `quilt.stackArn`

### 6. Migration Support

**File**: `lib/utils/migration.ts` (new file)

#### Tasks:
- [ ] Detect configs without `resolvedServices` field
- [ ] Prompt user to re-run setup
- [ ] Offer to auto-resolve services if stack ARN present
- [ ] Update config schema version

## Data Flow (Fixed)

```
Setup Wizard:
  Phase 1: Catalog Discovery
    → Confirm catalog DNS

  Phase 2: Service Resolution
    → resolveQuiltServicesWithFallback(stackArn)
    → Returns ResolvedQuiltServices
    → Cached in StackQueryResult

  Phase 3: Parameter Collection
    → Uses cached resolvedServices as defaults
    → Collects only user-configurable params

  Save Config:
    → ProfileConfig {
        quilt: { stackArn, catalog, ... },
        benchling: { ... },
        resolvedServices: { ... }  ← CACHED HERE
      }

Deploy Command:
  Read Config:
    → ProfileConfig.resolvedServices

  Validate:
    → All required fields present
    → Warn if stale (>30 days)

  Pass to CDK:
    → PackagerQueueUrl=${config.resolvedServices.packagerQueueUrl}
    → AthenaUserDatabase=${config.resolvedServices.athenaUserDatabase}
    → QuiltWebHost=${config.resolvedServices.quiltWebHost}
    → IcebergWorkgroup=${config.resolvedServices.icebergWorkgroup || ""}
    → ... etc
```

## Validation Rules

### Setup Time:
- [ ] `packagerQueueUrl` must be valid SQS URL
- [ ] `athenaUserDatabase` must be non-empty
- [ ] `quiltWebHost` must be valid hostname
- [ ] `sourceStackArn` must match `quilt.stackArn`
- [ ] Warn if optional fields empty (not fatal)

### Deploy Time:
- [ ] `resolvedServices` field must exist
- [ ] Required fields must be non-empty
- [ ] Warn if `resolvedAt` > 30 days old
- [ ] Fail with clear error if validation fails

## Benefits

1. **Fast Deploys**: No CloudFormation queries at deploy time
2. **Reliability**: Setup validates once, deploy trusts config
3. **Transparency**: User can inspect/edit cached values
4. **Flexibility**: Works with any Quilt stack (outputs or resources)
5. **Debuggability**: Clear error if services incomplete

## Breaking Changes

### Config Schema:
- New required field: `resolvedServices`
- Existing configs need migration (re-run setup)

### CLI Behavior:
- Deploy without valid `resolvedServices` will fail
- Error message directs user to run setup

## Migration Path

### For Existing Users:
1. Deploy detects missing `resolvedServices`
2. Error message: "Configuration outdated. Run: npm run setup"
3. Setup wizard resolves services and updates config
4. Deploy succeeds with cached values

### For New Users:
1. Setup wizard resolves services automatically
2. Config includes `resolvedServices` from first save
3. Deploy just works

## Testing Requirements

### Unit Tests:
- [ ] `resolveQuiltServicesWithFallback()` with outputs
- [ ] `resolveQuiltServicesWithFallback()` with resources (fallback)
- [ ] `validateResolvedServices()` with complete data
- [ ] `validateResolvedServices()` with missing required fields
- [ ] Config schema validation for `ResolvedQuiltServices`

### Integration Tests:
- [ ] Setup → Deploy with outputs-based Quilt stack
- [ ] Setup → Deploy with resources-only Quilt stack
- [ ] Deploy with stale config (>30 days) shows warning
- [ ] Deploy with missing `resolvedServices` fails gracefully
- [ ] Migration from old config format

## Success Criteria

- [ ] Setup wizard resolves and caches all services
- [ ] Deploy command never queries CloudFormation
- [ ] Old configs fail with clear migration instructions
- [ ] New configs work on first deploy
- [ ] All optional fields handled gracefully (empty string OK)
- [ ] Stale configs show warning but don't fail

## Non-Goals

- Automatic re-resolution on deploy (user must re-run setup)
- Background config refresh
- Multi-stack support (one Quilt stack per profile)

## Future Enhancements

- [ ] `npm run setup:refresh` to re-resolve services without full wizard
- [ ] Automatic staleness detection (warn at 30 days, error at 90 days)
- [ ] Config diff tool (show what changed since last setup)
