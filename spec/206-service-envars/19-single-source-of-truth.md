# Single Source of Truth for Athena Configuration

**Problem**: We have TWO places storing the same Athena workgroup/bucket values, causing confusion and bugs.

**Solution**: ONE configuration location. ONE source of truth.

---

## The Rule (Simple Version)

**Setup stores values → Deploy reads EXACT SAME values → CDK passes them to container**

That's it. No transformations. No duplication. No confusion.

---

## Data Flow (One Path Only)

```
Setup Wizard
    ↓
Queries Quilt Stack (DescribeStacks for OUTPUTS + DescribeStackResources for RESOURCES)
    ↓
Writes to config.json → quilt.athenaUserWorkgroup
                      → quilt.athenaResultsBucket
                      → quilt.icebergWorkgroup
    ↓
Deploy Command
    ↓
Reads from config.json → quilt.athenaUserWorkgroup
                       → quilt.athenaResultsBucket
                       → quilt.icebergWorkgroup
    ↓
Passes to CDK via CloudFormation parameters
    ↓
CDK writes to Fargate container environment variables
    ↓
Python app reads from environment variables
```

**One path. One source. No alternatives. No fallbacks.**

---

## Configuration Structure

### XDG Config File: `~/.config/benchling-webhook/{profile}/config.json`

```json
{
  "quilt": {
    "stackArn": "arn:aws:cloudformation:...",
    "catalog": "quilt.example.com",
    "database": "quilt_catalog",
    "queueUrl": "https://sqs...",
    "region": "us-east-1",

    // Athena configuration (discovered from stack RESOURCES)
    "athenaUserWorkgroup": "QuiltUserAthena-staging-Workgroup",
    "athenaResultsBucket": "quilt-staging-athena-results-abc123",
    "icebergWorkgroup": "QuiltIcebergWorkgroup-staging"
  }
}
```

**That's the ONLY place these values are stored.**

---

## What We Removed

### ❌ DELETED: `resolvedServices` object

**Before (WRONG - two locations)**:
```json
{
  "quilt": {
    "athenaUserWorkgroup": "value1"  // Location 1
  },
  "resolvedServices": {
    "athenaUserWorkgroup": "value2"  // Location 2 - WHICH IS CORRECT?!
  }
}
```

**After (CORRECT - one location)**:
```json
{
  "quilt": {
    "athenaUserWorkgroup": "value"  // Only location
  }
}
```

### Why We Had Two Locations (Historical Context)

- `resolvedServices` was for stack OUTPUTS (DescribeStacks)
- `quilt.*` was for stack RESOURCES (DescribeStackResources)
- Athena workgroup/bucket are RESOURCES, not outputs
- So they went in `quilt.*`, not `resolvedServices`
- But deploy command was reading from `resolvedServices` → **BUG**

**Solution**: Delete `resolvedServices`. Use `quilt.*` for everything.

---

## Implementation Checklist

### Phase 1: Remove Duplication

- [ ] Delete `ResolvedQuiltServices` interface from `lib/types/config.ts`
- [ ] Remove `config.resolvedServices` field from ProfileConfig
- [ ] Update setup wizard to write directly to `config.quilt.*`
- [ ] Update deploy command to read from `config.quilt.*`

### Phase 2: Update Resource Discovery

Resource discovery (in setup wizard) finds these values from the Quilt stack:

**From Stack Outputs** (via DescribeStacks):
- `PackagerQueueUrl` → `config.quilt.queueUrl`
- `UserAthenaDatabaseName` → `config.quilt.database`
- `QuiltWebHost` → `config.quilt.catalog`
- `IcebergDatabase` → `config.quilt.icebergDatabase` (optional)

**From Stack Resources** (via DescribeStackResources):
- `UserAthenaNonManagedRoleWorkgroup` (Physical Resource ID) → `config.quilt.athenaUserWorkgroup`
- `UserAthenaResultsBucket` (Physical Resource ID) → `config.quilt.athenaResultsBucket`
- `IcebergWorkGroup` (Physical Resource ID) → `config.quilt.icebergWorkgroup`

All values written to `config.quilt.*`. No other storage location exists.

### Phase 3: Update Deployment

Deploy command reads from `config.quilt.*` and passes to CDK:

```typescript
// bin/commands/deploy.ts
const services = {
    packagerQueueUrl: config.quilt.queueUrl,
    athenaUserDatabase: config.quilt.database,
    quiltWebHost: config.quilt.catalog,
    icebergDatabase: config.quilt.icebergDatabase,
    athenaUserWorkgroup: config.quilt.athenaUserWorkgroup,        // ← Read from quilt.*
    athenaResultsBucket: config.quilt.athenaResultsBucket,        // ← Read from quilt.*
    icebergWorkgroup: config.quilt.icebergWorkgroup,
};

// Pass to CDK (no transformation)
await cdk.deploy({
    parameters: [
        `AthenaUserWorkgroup=${services.athenaUserWorkgroup || ""}`,
        `AthenaResultsBucket=${services.athenaResultsBucket || ""}`,
        // ...
    ]
});
```

### Phase 4: CDK Environment Variables

CDK reads CloudFormation parameters and writes to container environment:

```typescript
// lib/fargate-service.ts
const environmentVars = {
    ATHENA_USER_WORKGROUP: props.athenaUserWorkgroup || "primary",
    ATHENA_RESULTS_BUCKET: props.athenaResultsBucket || "",
    // ...
};
```

**CRITICAL FIX**: Don't pass empty string `""` - omit the variable entirely if empty:

```typescript
// BEFORE (WRONG)
ATHENA_USER_WORKGROUP: props.athenaUserWorkgroup || "primary",
ATHENA_RESULTS_BUCKET: props.athenaResultsBucket || "",  // ← Empty string breaks Athena API

// AFTER (CORRECT)
...(props.athenaUserWorkgroup && { ATHENA_USER_WORKGROUP: props.athenaUserWorkgroup }),
...(props.athenaResultsBucket && { ATHENA_RESULTS_BUCKET: props.athenaResultsBucket }),
```

Or use fallback to "primary" only when actually undefined:

```typescript
ATHENA_USER_WORKGROUP: props.athenaUserWorkgroup || "primary",
// Don't set ATHENA_RESULTS_BUCKET at all if empty (Python will use STS to construct default)
...(props.athenaResultsBucket && { ATHENA_RESULTS_BUCKET: props.athenaResultsBucket }),
```

### Phase 5: Python Consumption

Python reads from environment variables:

```python
# docker/src/config.py
self.athena_user_workgroup = os.getenv("ATHENA_USER_WORKGROUP", "primary")
self.athena_results_bucket = os.getenv("ATHENA_RESULTS_BUCKET", "")

# docker/src/package_query.py
self.workgroup = workgroup or config.athena_user_workgroup or "primary"
```

---

## Testing

### Verify Single Source

```bash
# 1. Check config has values
cat ~/.config/benchling-webhook/default/config.json | jq '.quilt.athenaUserWorkgroup'
# Should output: "QuiltUserAthena-staging-Workgroup"

# 2. Check resolvedServices DOES NOT EXIST
cat ~/.config/benchling-webhook/default/config.json | jq '.resolvedServices'
# Should output: null

# 3. Deploy and check logs
npm run setup -- logs
# Should NOT see: "Value '' at 'workGroup' failed to satisfy constraint"
```

---

## Migration Path

Existing configs have values in BOTH locations. Migration is simple:

1. Keep values in `config.quilt.*` (they're already there)
2. Delete `config.resolvedServices` entirely
3. Update code to read from `config.quilt.*`

No data loss. No re-setup required.

---

## Summary

**ONE RULE**: All Quilt configuration lives in `config.quilt.*`. Period.

**Why This Works**:
- Setup wizard writes to ONE place
- Deploy command reads from ONE place
- No confusion about which value is "correct"
- No sync issues between duplicate fields
- Easy to debug: look at config.json, that's the truth

**If you see ANY code reading from `config.resolvedServices.*`**: DELETE IT. Read from `config.quilt.*` instead.
