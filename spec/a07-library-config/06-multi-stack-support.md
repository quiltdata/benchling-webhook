# A07.6: Multi-Stack Deployment Support

**Date**: 2025-12-18
**Status**: Planning
**Related**: A07 Library Config Series, Issue #176 Multi-Environment

---

## Problem Statement

**User requirement**: A single customer is deploying multiple Quilt stacks in a single AWS account (possibly across multiple regions), and the current architecture makes it impossible to deploy more than one `BenchlingWebhookStack` per account/region.

**Current limitation**: The stack name "BenchlingWebhookStack" is hardcoded throughout the codebase (~20 locations), preventing multiple concurrent deployments in the same AWS account/region.

**User's preferred solution**: Let CDK generate unique stack names automatically and track them in deployment history.

---

## Analysis

### Current Architecture

From the exploration and [spec/176-test-prod/11-multi-environment-analysis.md](../176-test-prod/11-multi-environment-analysis.md):

- Stack name is hardcoded to `"BenchlingWebhookStack"` in all locations
- Current multi-environment strategy relies on **different AWS accounts/regions**
- CloudFormation enforces unique stack names per account/region
- Configuration system already supports profiles with independent deployment tracking

### CDK Stack Naming Behavior

When creating a CDK stack, the second parameter is the **construct id**:

```typescript
new BenchlingWebhookStack(app, "BenchlingWebhookStack", { ... });
                              ^^^^^^^^^^^^^^^^^^^
                              construct id (becomes stack name)
```

**Options for stack naming:**

1. **Profile-based naming** (recommended by spec): `BenchlingWebhookStack-${profile}`
2. **CDK auto-generation**: Pass construct id but let CloudFormation generate physical name
3. **Hash-based naming**: Generate unique suffix based on profile + timestamp
4. **User-specified**: Accept explicit stack name via CLI parameter

### User's Request: "Let CDK generate unique ID"

The user wants CDK to automatically generate unique identifiers. However, **CDK requires a construct ID at creation time** - there's no fully automatic mode. We need to choose a strategy that:

1. Generates predictable, trackable names
2. Allows multiple stacks per region
3. Works with existing profile system
4. Maintains backwards compatibility (optional)

**Recommended approach**: **Profile-based naming with optional suffix**

- Default: `BenchlingWebhookStack-{profile}`
- Example: Profile "sales" → Stack "BenchlingWebhookStack-sales"
- Existing "default" profile → Can keep "BenchlingWebhookStack" for backwards compatibility
- Unique per profile, trackable in deployment history

---

## Implementation Strategy

### Phase 1: Make Stack Name Configurable

**Goal**: Remove hardcoded stack name and derive it from profile configuration.

#### 1.1 Update Configuration Types

Add optional `stackName` field to ProfileConfig:

**Files to modify:**

- [lib/types/profile-config.ts](../../lib/types/profile-config.ts) - Add `deployment.stackName?: string`

```typescript
export interface DeploymentConfig {
    region: string;
    account?: string;
    ecrRepository?: string;
    imageTag?: string;
    stackName?: string;  // NEW: Optional custom stack name
}
```

#### 1.2 Update Stack Creation Logic

**Files to modify:**

- [bin/benchling-webhook.ts](../../bin/benchling-webhook.ts) - `createStack()` function (line 134)

Change from:

```typescript
const stack = new BenchlingWebhookStack(app, "BenchlingWebhookStack", { ... });
```

To:

```typescript
const stackName = getStackName(config.profile, config.deployment?.stackName);
const stack = new BenchlingWebhookStack(app, stackName, { ... });
```

Add helper function:

```typescript
function getStackName(profile: string, customName?: string): string {
    if (customName) return customName;
    if (profile === "default") return "BenchlingWebhookStack"; // Backwards compatibility
    return `BenchlingWebhookStack-${profile}`;
}
```

#### 1.3 Update Deployment Commands

**Files to modify:**

- [bin/commands/deploy.ts](../../bin/commands/deploy.ts)
  - Line 46: Remove hardcoded `stackName = "BenchlingWebhookStack"`
  - Line 494: Use profile-based stack name
  - Line 715: Pass stack name to CDK synth
  - Lines 272-279: Display actual stack name in deployment summary

**Key changes:**

1. Read stack name from profile config or generate from profile name
2. Pass stack name to `createStack()`
3. Store stack name in deployment tracking
4. Display stack name in CLI output

#### 1.4 Update Other Commands

**Files to modify:**

- [bin/commands/destroy.ts](../../bin/commands/destroy.ts) - Line 66: Read stack name from profile
- [bin/commands/logs.ts](../../bin/commands/logs.ts) - Line 27: Read stack name from deployment tracking
- [bin/commands/status.ts](../../bin/commands/status.ts) - Lines 186, 191: Read stack name from deployment tracking

### Phase 2: Update Deployment Tracking

**Files to modify:**

- [lib/xdg-config.ts](../../lib/xdg-config.ts) - Ensure `DeploymentRecord` includes `stackName`

The deployment tracking already stores `stackName` per deployment, so this should work automatically once we start passing different names.

**Verify:**

```typescript
export interface DeploymentRecord {
    stage: string;
    timestamp: string;
    imageTag: string;
    endpoint: string;
    stackName: string;  // Already exists
    region: string;
}
```

### Phase 3: Update Setup Wizard (Optional)

**Files to consider:**

- [scripts/install-wizard.ts](../../scripts/install-wizard.ts) - Could prompt for custom stack name
- [scripts/config/wizard.ts](../../scripts/config/wizard.ts) - Add stack name prompt (optional)

**Decision**: Make this **optional** for now. Stack name auto-derives from profile, but advanced users could edit `config.json` to set custom `deployment.stackName`.

### Phase 4: Update Tests

**Files to update:**

- [test/unit/deployment-tracking.test.ts](../../test/unit/deployment-tracking.test.ts) - Update expectations for profile-based names
- [test/integration/*.test.ts](../../test/integration/) - Test multi-stack scenarios
- Add new test: Deploy two different profiles to same account/region

### Phase 5: Documentation Updates

**Files to update:**

- [CLAUDE.md](../../CLAUDE.md) - Update architecture section
- [README.md](../../README.md) - Document multi-stack support
- [MIGRATION.md](../../MIGRATION.md) - Note backwards compatibility for "default" profile

---

## Backwards Compatibility

**Strategy**: The "default" profile keeps the legacy stack name "BenchlingWebhookStack" to avoid breaking existing deployments.

**Impact:**

- Existing deployments using "default" profile: **No breaking changes**
- New profiles (sales, customer1, etc.): Automatically get unique stack names
- Explicit stack name in config: Overrides auto-generation

**Migration path for users who need multiple stacks:**

1. Create new profiles (e.g., "sales", "enterprise")
2. Deploy each profile - gets unique stack name automatically
3. Existing "default" profile continues working unchanged

---

## Critical Files

### Configuration & Types

1. [lib/types/profile-config.ts](../../lib/types/profile-config.ts) - Add `stackName` field
2. [lib/xdg-config.ts](../../lib/xdg-config.ts) - Verify deployment tracking

### Stack Creation

3. [bin/benchling-webhook.ts](../../bin/benchling-webhook.ts) - Make stack name dynamic (line 134)

### Commands

4. [bin/commands/deploy.ts](../../bin/commands/deploy.ts) - Use profile-based stack name (lines 46, 494, 715)
2. [bin/commands/destroy.ts](../../bin/commands/destroy.ts) - Read stack name from profile (line 66)
3. [bin/commands/logs.ts](../../bin/commands/logs.ts) - Read stack name from tracking (line 27)
4. [bin/commands/status.ts](../../bin/commands/status.ts) - Read stack name from tracking (lines 186, 191)

### Tests

8. [test/unit/deployment-tracking.test.ts](../../test/unit/deployment-tracking.test.ts) - Update test expectations

### Documentation

9. [CLAUDE.md](../../CLAUDE.md) - Document multi-stack support
2. [README.md](../../README.md) - Update usage examples

---

## Implementation Steps

1. **Add configuration field** for optional `stackName` in ProfileConfig
2. **Create helper function** `getStackName(profile, customName?)` with backwards compatibility
3. **Update stack creation** in `bin/benchling-webhook.ts` to use dynamic names
4. **Update deploy command** to pass profile-based stack names
5. **Update other commands** (destroy, logs, status) to read stack name from profile/tracking
6. **Add tests** for multi-stack deployment scenarios
7. **Update documentation** to explain multi-stack support

---

## Example Usage After Implementation

```bash
# Profile "default" - uses legacy name (backwards compatible)
npm run setup -- --profile default
npm run deploy:prod -- --profile default
# Creates: BenchlingWebhookStack

# Profile "sales" - gets unique name automatically
npm run setup -- --profile sales
npm run deploy:prod -- --profile sales
# Creates: BenchlingWebhookStack-sales

# Profile "customer-acme" - gets unique name automatically
npm run setup -- --profile customer-acme
npm run deploy:prod -- --profile customer-acme
# Creates: BenchlingWebhookStack-customer-acme

# All three stacks can coexist in same account/region
```

---

## Open Questions

1. **Should we prompt for stack name in the setup wizard?**
   - Recommendation: No, auto-derive from profile for simplicity
   - Advanced users can edit `config.json` manually

2. **Should we support fully custom stack names via CLI?**
   - Recommendation: Yes via config file, no via CLI flag (reduces complexity)

3. **Migration for existing "default" profile users?**
   - Recommendation: Keep "BenchlingWebhookStack" for "default" profile (no migration needed)
   - Document that new profiles get auto-generated names

4. **Stack name validation?**
   - Recommendation: Validate against CloudFormation naming rules (alphanumeric + hyphens, max 128 chars)

---

## Decision Log

### Why profile-based naming instead of fully auto-generated?

**Problem**: CDK requires a construct ID at stack creation time - there's no "auto-generate" mode.

**Options considered**:

1. Hash-based (UUID or timestamp suffix)
2. User-provided explicit name
3. Profile-based naming
4. Environment variable override

**Decision**: Profile-based naming with backwards compatibility

**Rationale**:

- Aligns with existing profile system
- Predictable and trackable
- Human-readable (BenchlingWebhookStack-sales vs BenchlingWebhookStack-a7f3b9d2)
- Backwards compatible for "default" profile
- Enables multiple stacks per region naturally

### Why not add CLI flag for stack name?

**Rationale**:

- Reduces CLI complexity
- Config file is the source of truth (XDG model)
- Stack name should be stable, not vary per deployment
- Advanced users can edit config.json directly

---

## References

- [spec/176-test-prod/11-multi-environment-analysis.md](../176-test-prod/11-multi-environment-analysis.md) - Original multi-environment analysis
- [spec/a07-library-config/05-implementation-plan.md](./05-implementation-plan.md) - Config passing implementation
- [lib/types/profile-config.ts](../../lib/types/profile-config.ts) - Profile configuration types
