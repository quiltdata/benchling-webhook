# Migration Strategy

How existing deployments — both open-source standalone and platform-integrated — transition from the current config model to the three-tier model without breaking stacks, losing settings, or requiring manual reconfiguration.

---

## Migration Principles

1. **Backward compatible always** — existing stacks must update cleanly; no `cdk deploy` failures from removed parameters
2. **Phased rollout** — read the new sources first, write the new sources later, remove the old sources last
3. **No data loss** — every existing configuration value is automatically carried forward
4. **Opt-in for new features** — per-project routing is additive; existing single-bucket setups work unchanged

---

## What Changes (Recap from 04-tier-audit.md)

| Setting | Current location | New location | Changes on deploy? | Changes at runtime? |
|---------|-----------------|-------------|-------------------|---------------------|
| `packages.bucket` | Secrets Manager + IAM | **Tier 1** per-project routing | IAM permissions stay; `user_bucket` in secret becomes fallback | App reads routing from Benchling config items |
| `packages.prefix` | Secrets Manager as `pkg_prefix` | **Tier 1** per-project routing | No CDK change | App reads from Tier 1 |
| `packages.metadataKey` | Secrets Manager as `pkg_key` | **Tier 1** per-project routing | No CDK change | App reads from Tier 1 |
| `packages.workflow` | Secrets Manager as `workflow` | **Tier 1** per-project routing | No CDK change | App reads from Tier 1 |
| `logging.level` | Secrets Manager as `log_level` | **Tier 1** app config item | No CDK change | App reads from Tier 1 |
| `PACKAGE_EVENT_CONCURRENCY` | Hardcoded env var | **Tier 1** app config item | No CDK change | App reads from Tier 1 |
| `PACKAGING_REQUEST_CONCURRENCY` | Hardcoded env var | **Tier 1** app config item | No CDK change | App reads from Tier 1 |
| All CfnParameters | `lib/benchling-webhook-stack.ts` | **Stays** as CfnParameters | No change | Still set env vars; values are now fallbacks |

Key insight: **the CDK stack and CfnParameters don't change**. The env vars they set become *fallbacks* — the app checks Tier 1 first, falls back to the env var / secret if no value is found.

---

## Stack Upgrade: Legacy CfnParameters

### Question: Do we keep the legacy CfnParameters when upgrading?

**Yes.** They stay in the template. Here's why:

1. **Removing a CfnParameter from the CDK template causes CloudFormation to DELETE it from the stack parameters.** If a parameter has no default and was required, the update fails. If it has a default, the value is silently dropped — which is fine, but unnecessary churn.
2. **CfnParameters are free** — they don't cost money and don't add meaningful synthesis time.
3. **They serve as deploy-time overrides** — an operator running `npm run deploy:prod -- --parameters PackagerQueueUrl=https://...` still works.
4. **They act as a documented interface** — anyone reading the CloudFormation template can see what the stack expects.

### What we do instead

| Parameter | Action |
|-----------|--------|
| `PackagerQueueUrl` | **Keep.** Still needed for env var. |
| `AthenaUserDatabase` | **Keep.** Still needed for env var. |
| `QuiltWebHost` | **Keep.** Still needed for env var. |
| `AthenaUserWorkgroup` | **Keep.** Still needed for env var. |
| `BenchlingSecretARN` | **Keep.** Still needed for secret reference. |
| `LogLevel` | **Keep.** Still the fallback for log level (overridden by Tier 1 at runtime). |
| `ImageTag` | **Keep.** Controls which Docker image runs. |
| `PackageBucket` | **Keep.** Still needed for IAM permissions. |
| `QuiltDatabase` | **Keep.** Still needed for IAM. |

**All CfnParameters stay.** The runtime simply prefers Tier 1 values where they exist.

### What changes in the stack template

Only two things:

1. **New env vars MAY be added** for the `app_id` that the Python app uses to fetch Tier 1 config items (e.g., `BENCHLING_APP_ID`). This would be a new CfnParameter or hardcoded value.
2. **IAM policies MAY need expansion** if per-project routing references buckets not currently in the IAM policy. This is an *existing IAM change* — not new infrastructure.

---

## Open Source (Standalone) Migration

### Phase 1: Read-side only (no stack update)

**What the user does:** `npm update && npm run deploy -- --profile my-profile`

**What happens:**
1. CDK stack deploys identically — no CfnParameters added or removed
2. New Python app code fetches Tier 1 config items from Benchling
3. If no Tier 1 items exist, falls back to current secret/env var values
4. Everything works exactly as before — zero config changes

**Code changes in this phase:**
```
# New: Tier 1 config loader with fallback chain
def resolve_routing_config(benchling, config):
    """Fetch routing rules: Tier 1 → secret → env var fallback."""
    tier1_rules = _fetch_tier1_config(benchling)
    if tier1_rules:
        return tier1_rules

    # Legacy fallback (current behavior)
    return {
        "bucket": config.s3_bucket_name,
        "prefix": config.s3_prefix,
        "metadata_key": config.package_key,
        "workflow": config.workflow,
    }
```

**Rollback:** Downgrade the app image. Old code never reads Tier 1.

### Phase 2: Seed Tier 1 config items

**What the user does:** `npm run config:seed` (new CLI command)

**What happens:**
1. The CLI reads existing ProfileConfig/Secret values
2. Creates App Configuration Items in Benchling via the SDK
3. Prints a confirmation: "Routing config migrated to Benchling. Edit at: ..."

```
npm run config:seed -- --profile sales

  ✓ Read existing config from profile 'sales'
  ✓ Connected to Benchling (tenant: my-company)
  ✓ Created 4 App Configuration Items for routing rules
  ✓ Source of truth: Benchling → App Configuration
  ℹ️  Edit these values at: https://my-company.benchling.com/app/...
```

**No deploy needed.** The app discovers the items on the next webhook event.

**Rollback:** Delete the App Configuration Items (CLI: `npm run config:clear`) — app falls back to legacy values.

### Phase 3: Opt-in per-project routing

**What the user does:**
1. Configures project names in App Configuration Items (via Benchling UI or CLI)
2. Optionally adds new S3 buckets to `ProfileConfig.packages.bucket` for IAM permissions

**What happens:**
1. CDK stack gets additional IAM policies for new buckets (if any)
2. App reads entry → folder → project → routing rule
3. Entries route based on project name

```
# In App Configuration Items (JSON):
{
  "projects": {
    "Study Alpha":  { "bucket": "quilt-alpha",  "prefix": "alpha" },
    "Study Beta":   { "bucket": "quilt-beta",   "prefix": "beta"  }
  },
  "default": {
    "bucket": "quilt-benchling-main",
    "prefix": "benchling"
  }
}
```

---

## Platform (Integrated Stack) Migration

Platform users deploy the webhook as part of the Quilt stack. Their upgrade path is different because the **Quilt stack owns the infrastructure** and the webhook config lives in a Quilt-managed secret.

### What's different

| Aspect | Standalone | Platform (Integrated) |
|--------|-----------|----------------------|
| Stack owner | User deploys `BenchlingWebhookStack` | Quilt stack includes webhook resources |
| Secret | Managed by `sync-secrets.ts` | Existing `BenchlingSecret` in Quilt stack |
| IAM policies | Created by webhook stack | Managed by Quilt stack resources |
| Config profile | `~/.config/benchling-webhook/{profile}` | User has profile but Quilt stack is external |

### Migration for integrated mode

**Phase 1 (Read-side):** Same as standalone — no infra changes, app reads Tier 1 config first.

**Phase 2 (Seed):** Same `npm run config:seed` command, but reads from the integrated stack's existing secret. The secret still exists and is still managed by the Quilt stack.

**Phase 3 (Per-project routing):** If new buckets are needed, the platform user must:
1. Ensure the Quilt stack's `BucketWritePolicy` covers the new buckets
2. Or ask their Quilt platform admin to add the buckets

This is a constraint of the integrated model — the webhook cannot create its own IAM policies.

---

## Edge Cases and Risks

### 1. Stack update removes a CfnParameter that was in use

**Risk:** Low — we aren't removing CfnParameters.  
**If we did:** CloudFormation would show a "Before" value in the change set and prompt for a new value. The parameter would be removed from subsequent `describe-stacks` output but the running container still had the old env var.

**Mitigation:** Never remove CfnParameters. Mark them as `@deprecated` in code comments and ignore the env var value at runtime if Tier 1 has a value.

### 2. App Configuration Items don't exist yet

**Risk:** Medium — first deploy after code change hits a new API call pattern.  
**If it fails:** The error is logged (non-fatal) and the app falls back to legacy config. Zero service disruption.

**Testing:**
- Unit test: `resolve_routing_config()` returns fallback when `list_app_configuration_items` returns empty
- Integration test: Deploy without seeding config items, verify old behavior unchanged

### 3. Benchling API rate limits

**Risk:** Low — `list_app_configuration_items` is a single API call at startup, cached for the lifetime of the container process.  
**If rate-limited:** Boto3 retries handle this. If it fails completely, fallback logic applies.

### 4. User deletes App Configuration Items accidentally

**Recovery:** App falls back to legacy secret/env var values automatically.  
**Restore:** `npm run config:seed -- --restore` re-creates the items from current secret values.

### 5. Rollback deploys an older image

**Safe by design:** Old code never calls `list_app_configuration_items`. It reads config exactly as before.  
**Seeded items** remain in Benchling but are ignored. No stale/conflicting state.

### 6. Two stacks sharing one Benchling tenant

If two standalone stacks (e.g., `dev` and `prod`) point at the same Benchling tenant, they would both see the same App Configuration Items. This is correct only if they should share routing rules.

**Mitigation:** Use a path prefix convention: `path=["routing", "dev", ...]` vs `path=["routing", "prod", ...]`. Or rely on `app_id` scoping (each stack registers as a separate Benchling app instance).

### 7. Mixed version deployment during rolling update

ECS rolling updates run old and new containers simultaneously for a brief window. The new code reads Tier 1; the old code reads secrets/env vars. Both paths resolve to the same values (Tier 1 has the same data as the source-of-truth), so no inconsistency.

---

## Backward Compatibility Guarantees

| Scenario | Works? | How |
|----------|--------|-----|
| Existing stack deploys with zero config changes | ✅ | All CfnParameters unchanged, default values unchanged |
| Existing secret has `user_bucket`, `pkg_prefix`, etc. | ✅ | Tier 1 fallback reads these exactly as today |
| `npm run deploy -- --parameters LogLevel=DEBUG` | ✅ | CfnParameter override still works; env var set as before |
| Old Docker image (pre-Tier-1) deployed on new config | ✅ | Old code never calls `list_app_configuration_items` |
| New Docker image deployed on old config (no Tier 1 items) | ✅ | New code calls `list_app_configuration_items`, gets empty, falls back to secret/env vars |
| User removes Tier 1 items while running new image | ✅ | Next webhook event gets fallback values; degraded but working |
| Two profiles sharing one Benchling app_id | ✅ (if intentional) | Paths are namespaced by profile name |

---

## Rollback Procedure

### Rollback Tier 1 → Secrets Manager only

If Tier 1 config items are causing issues (e.g., wrong routing, API errors):

```bash
# Option A: Delete the items (app falls back to secret values)
npm run config:clear

# Option B: Re-deploy previous Docker image
npm run deploy:prod -- --profile sales --image-tag 0.17.2
```

The app container restart picks up whichever image is deployed. Tier 1 items remain in Benchling but are ignored by old code.

### Rollback entire migration

```bash
# 1. Delete App Configuration Items
npm run config:clear

# 2. Re-deploy old image tag
npm run deploy:prod -- --profile sales --image-tag 0.17.0

# 3. (Optional) Restore secret to known-good state
npm run setup -- --profile sales
```

---

## Migration Timeline

```
Phase 1: Read-side only        ████████████░░░░░░  (this release)
  - Add Tier 1 fetch + fallback logic
  - All existing behavior unchanged
  - Safe to deploy immediately

Phase 2: Seed CLI tool          ░░░░████████████░░  (next release)
  - npm run config:seed command
  - npm run config:clear command
  - Documentation for editing in Benchling UI

Phase 3: Per-project routing    ░░░░░░░░██████████  (future release)
  - Full routing resolution entry → folder → project
  - Multi-bucket IAM support
  - ProfileConfig changes for bucket lists
```

Each phase is independently deployable and reversible.
