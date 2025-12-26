# Current Setup Wizard State Analysis

## Executive Summary

The setup wizard orchestrates 7 phases to configure webhook deployment. It currently requires **two critical human decisions** and performs **automatic discovery** of Quilt stack resources.

## Use Cases

### 1. **New Installation** (No existing configuration)

- First-time deployment to AWS
- No profile configuration exists locally
- Requires full discovery and parameter collection

### 2. **Update Existing** (Profile exists)

- Reconfigure existing deployment
- Update Benchling credentials or AWS resources
- Can inherit previous values

### 3. **Integrated Mode** (Use Quilt's built-in webhook)

- Webhook runs inside Quilt stack's infrastructure
- Shares Quilt's BenchlingSecret
- **No separate deployment needed**

### 4. **Standalone Mode** (Separate webhook stack)

- Independent infrastructure
- Dedicated BenchlingSecret
- **Requires separate CloudFormation stack deployment**

---

## Decision Points

### Automatic (System Determines)

| Phase | Decision | Criteria |
|-------|----------|----------|
| **1. Catalog Discovery** | Detect Quilt catalog DNS | CLI arg → config → quilt3 detection → manual |
| **2. Stack Query** | Find Quilt CloudFormation stack | DNS-based discovery via AWS |
| **2. Stack Query** | Extract Athena workgroup | Resource exists in stack → use it |
| **4. Validation** | Check AWS permissions | IAM/S3/Secrets access tests |

### Human Required

| Phase | Question | Impact |
|-------|----------|--------|
| **5. Mode Decision** | Use Quilt's built-in webhook? | **Determines entire deployment architecture** |
| **7. Standalone Mode** | Deploy now or setup-only? | **Triggers CloudFormation deployment** |

---

## Critical Flow Split: Phase 5 Decision

```
Phase 5: Mode Decision
   │
   ├─> YES (Integrated)
   │   └─> Phase 6: Update secret → EXIT
   │       No deployment, no stack
   │
   └─> NO (Standalone)
       └─> Phase 7: Create secret → Ask deploy?
           │
           ├─> YES: Deploy CFN stack → EXIT
           └─> NO: Setup only → EXIT
```

**Key Insight:** The Phase 5 decision is architectural - it determines whether webhook infrastructure is embedded (integrated) or independent (standalone).

---

## Current Workgroup Discovery Issues

### Problem Context

The wizard **automatically discovers** `BenchlingAthenaWorkgroup` from the Quilt stack (Phase 2):

```typescript
// lib/utils/stack-inference.ts:64
Target resources:
- BenchlingAthenaWorkgroup (AWS::Athena::WorkGroup)
- UserAthenaNonManagedRolePolicy (AWS::IAM::ManagedPolicy)
- BucketWritePolicy (AWS::IAM::ManagedPolicy)
- BenchlingSecret (AWS::SecretsManager::Secret)
```

### The Gap

1. **Legacy Quilt stacks** (pre-2024) → No `BenchlingAthenaWorkgroup` resource → Discovery fails
2. **New Quilt stacks** (2024+) → Has `BenchlingAthenaWorkgroup` → Discovery succeeds

**Current behavior:** Setup fails for legacy stacks (workgroup not found).

### Desired Behavior (from spec/a09-managed-workgroup/02)

**Conditional resolution:**

1. **If Quilt has workgroup** → Use it (discovered in Phase 2)
2. **If Quilt lacks workgroup** → Create webhook-managed workgroup

**Challenge:** The wizard must **decide at runtime** whether to create the workgroup, but CloudFormation requires **static template decisions**.

---

## Architectural Constraint

**CloudFormation limitation:** Resources cannot be conditionally created based on external discovery without custom resources.

**Options:**

1. **Always create webhook-managed workgroup** (simplest, violates requirement #1)
2. **Use CDK custom resource** (complex, runtime discovery in CDK)
3. **Split wizard into discovery + deployment phases** (discovery determines template variant)

---

## Recommendation for Next Steps

### Option A: Unconditional Creation (Simplest)

- Always create `{stackName}-athena-workgroup` in webhook stack
- Ignore Quilt's workgroup even if it exists
- **Pro:** Simple, backward compatible
- **Con:** Violates "use Quilt's workgroup if available" requirement

### Option B: Pre-Deployment Discovery (Most Flexible)

- Phase 2 discovers workgroup availability
- Phase 7 deployment uses **different CDK template variants**:
  - Variant A: No workgroup creation (use Quilt's)
  - Variant B: Create workgroup (legacy stack fallback)
- **Pro:** True conditional logic, meets requirements
- **Con:** Requires template selection mechanism in deploy.ts

### Option C: Custom Resource (Most Complex)

- CDK Custom Resource queries Quilt stack at deploy-time
- Conditionally creates workgroup based on discovery
- **Pro:** Fully automated, no wizard changes
- **Con:** Complex Lambda function, harder to maintain

---

## Human Decision Summary

| Decision | Phase | Default | Can Auto-Accept? |
|----------|-------|---------|------------------|
| Use Quilt catalog DNS | 1 | Detected value | Yes (`--yes`) |
| Use integrated mode | 5 | Yes (if secret exists) | Yes (`--yes`) |
| Deploy standalone stack | 7 | No | No (safety) |

**Note:** `--yes` flag auto-accepts defaults but **cannot auto-deploy** standalone stacks (requires explicit confirmation).
