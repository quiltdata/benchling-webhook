# Resource Discovery Flow Audit

**Status**: BROKEN
**Severity**: CRITICAL
**Impact**: Setup → Deploy flow is completely broken
**Date**: 2025-11-17

## Executive Summary

The resource discovery flow from setup wizard through deployment is **completely broken** due to multiple architectural mismatches between:

1. **Setup Wizard** (`infer-quilt-config.ts`) - discovers resources from CloudFormation RESOURCES
2. **Service Resolver** (`service-resolver.ts`) - resolves services from CloudFormation OUTPUTS
3. **CDK Stack** (`benchling-webhook-stack.ts`) - expects specific CloudFormation parameter names

These three systems are **fundamentally incompatible** and use completely different data models.

## Critical Issues

### Issue 1: Resource Discovery vs Output Resolution Mismatch

**Problem**: Setup wizard discovers resources that service resolver cannot use.

#### Setup Wizard Discovers (via `DescribeStackResources`):
```typescript
// From infer-quilt-config.ts line 203-224
const resources = await getStackResources(region, stack.StackName);
const discovered = extractQuiltResources(resources);

// Discovers RESOURCE physical IDs:
{
  athenaUserWorkgroup,        // Physical ID of AWS::Athena::WorkGroup resource
  athenaUserPolicy,           // Physical ID of AWS::IAM::Policy resource
  icebergWorkgroup,           // Physical ID of AWS::Athena::WorkGroup resource
  icebergDatabase,            // Physical ID of AWS::Glue::Database resource
  athenaResultsBucket,        // Physical ID of AWS::S3::Bucket resource
  athenaResultsBucketPolicy   // Physical ID of AWS::IAM::Policy resource
}
```

#### Service Resolver Expects (via `DescribeStacks`):
```typescript
// From service-resolver.ts line 238-310
const outputs: Record<string, string> = {};
for (const output of stack.Outputs) {
  if (output.OutputKey && output.OutputValue) {
    outputs[output.OutputKey] = output.OutputValue;
  }
}

// Expects STACK OUTPUTS:
{
  PackagerQueueUrl,              // ✓ Required
  UserAthenaDatabaseName,        // ✓ Required
  QuiltWebHost,                  // ✓ Required
  IcebergDatabase,               // Optional
  UserAthenaWorkgroupName,       // ❌ NOT DISCOVERED - wants output, not resource
  AthenaResultsBucketName,       // ❌ NOT DISCOVERED - wants output, not resource
  IcebergWorkgroupName           // ❌ NOT DISCOVERED - wants output, not resource
}
```

**Impact**: Resources discovered during setup are **discarded** at deployment time because service resolver looks for non-existent outputs.

---

### Issue 2: Configuration Type Mismatch

**Problem**: `ProfileConfig` type doesn't match what service resolver needs.

#### ProfileConfig Contains (from `types/config.ts`):
```typescript
export interface QuiltConfig {
  stackArn?: string;                    // Used for discovery
  catalog: string;                      // ✓ Used
  database: string;                     // ✓ Used
  queueUrl: string;                     // ✓ Used
  region: string;                       // ✓ Used
  icebergDatabase?: string;             // Discovered but not used in deployment
  athenaUserWorkgroup?: string;         // ❌ Discovered but wrong format
  athenaUserPolicy?: string;            // ❌ Not needed for deployment
  icebergWorkgroup?: string;            // ❌ Discovered but wrong format
  athenaResultsBucket?: string;         // ❌ Discovered but wrong format
  athenaResultsBucketPolicy?: string;   // ❌ Not needed for deployment
}
```

#### Service Resolver Needs:
```typescript
export interface QuiltServices {
  packagerQueueUrl: string;              // ✓ Resolved from PackagerQueueUrl output
  athenaUserDatabase: string;            // ✓ Resolved from UserAthenaDatabaseName output
  quiltWebHost: string;                  // ✓ Resolved from QuiltWebHost output
  icebergDatabase?: string;              // ✓ Resolved from IcebergDatabase output
  athenaUserWorkgroup?: string;          // ❌ MISMATCH: wants output name, not resource ID
  athenaResultsBucket?: string;          // ❌ MISMATCH: wants output name, not resource ID
  icebergWorkgroup?: string;             // ❌ MISMATCH: wants output name, not resource ID
}
```

**Impact**: New resource fields in `ProfileConfig` are **incompatible** with deployment.

---

### Issue 3: CloudFormation Parameter Name Mismatch

**Problem**: CDK stack parameters don't match service resolver field names.

#### Service Resolver Returns:
```typescript
{
  packagerQueueUrl: "https://sqs...",
  athenaUserDatabase: "quilt_catalog",
  quiltWebHost: "catalog.example.com",
  icebergDatabase: "quilt_iceberg",
  athenaUserWorkgroup: "workgroup-name",     // ❌ Field exists but never populated
  athenaResultsBucket: "bucket-name",        // ❌ Field exists but never populated
  icebergWorkgroup: "iceberg-workgroup"      // ❌ Field exists but never populated
}
```

#### CDK Stack Expects (from `benchling-webhook-stack.ts` line 60-101):
```typescript
const packagerQueueUrlParam = new cdk.CfnParameter(this, "PackagerQueueUrl", ...);
const athenaUserDatabaseParam = new cdk.CfnParameter(this, "AthenaUserDatabase", ...);
const quiltWebHostParam = new cdk.CfnParameter(this, "QuiltWebHost", ...);
const icebergDatabaseParam = new cdk.CfnParameter(this, "IcebergDatabase", ...);

// NEW parameters that service resolver CAN'T populate:
const icebergWorkgroupParam = new cdk.CfnParameter(this, "IcebergWorkgroup", ...);
const athenaUserWorkgroupParam = new cdk.CfnParameter(this, "AthenaUserWorkgroup", ...);
const athenaResultsBucketParam = new cdk.CfnParameter(this, "AthenaResultsBucket", ...);
```

#### Deploy Command Passes (from `deploy.ts` line 393-410):
```typescript
const parameters = [
  `PackagerQueueUrl=${services.packagerQueueUrl}`,
  `AthenaUserDatabase=${services.athenaUserDatabase}`,
  `QuiltWebHost=${services.quiltWebHost}`,
  `IcebergDatabase=${services.icebergDatabase || ""}`,

  // ALWAYS EMPTY - service resolver never populates these:
  `IcebergWorkgroup=${services.icebergWorkgroup || ""}`,           // ❌ Always ""
  `AthenaUserWorkgroup=${services.athenaUserWorkgroup || ""}`,     // ❌ Always ""
  `AthenaResultsBucket=${services.athenaResultsBucket || ""}`,     // ❌ Always ""

  // Other parameters...
];
```

**Impact**: New CDK parameters are **always empty strings** because service resolver can't find the outputs.

---

### Issue 4: Stack Output Naming Assumptions

**Problem**: Service resolver assumes Quilt stacks export specific output names that may not exist.

#### Service Resolver Hardcoded Output Names:
```typescript
// From service-resolver.ts line 308-310
const athenaUserWorkgroup = outputs.UserAthenaWorkgroupName;
const athenaResultsBucket = outputs.AthenaResultsBucketName;
const icebergWorkgroup = outputs.IcebergWorkgroupName;
```

#### Reality:
- **Most Quilt stacks DO NOT export these outputs**
- Quilt CloudFormation templates export:
  - ✓ `PackagerQueueUrl`
  - ✓ `UserAthenaDatabaseName`
  - ✓ `QuiltWebHost`
  - ✓ `IcebergDatabase` (recent stacks)
  - ❌ `UserAthenaWorkgroupName` - NOT EXPORTED
  - ❌ `AthenaResultsBucketName` - NOT EXPORTED
  - ❌ `IcebergWorkgroupName` - NOT EXPORTED

**Impact**: Service resolver silently fails to populate optional fields, leading to empty environment variables in containers.

---

### Issue 5: Data Loss in Config Persistence

**Problem**: Resources discovered during setup are persisted to `config.json` but never used.

#### Setup Wizard Flow:
```
1. Phase 2 (stack-query) → calls inferQuiltConfig
2. inferQuiltConfig → discovers resources via DescribeStackResources
3. Phase 3 (parameters) → stores discovered values in ProfileConfig
4. Config saved to ~/.config/benchling-webhook/{profile}/config.json
```

#### Deployment Flow:
```
1. deploy.ts → reads ProfileConfig
2. deploy.ts → calls resolveQuiltServices (IGNORES ProfileConfig resources)
3. resolveQuiltServices → queries stack OUTPUTS (not resources)
4. Returns QuiltServices with empty optional fields
5. Passes empty strings to CDK parameters
```

**Impact**: All discovered resource information is **thrown away** at deployment time.

---

## Root Cause Analysis

The fundamental issue is a **three-way architectural mismatch**:

1. **Setup wizard** uses `DescribeStackResources` API to find CloudFormation RESOURCES
2. **Service resolver** uses `DescribeStacks` API to find CloudFormation OUTPUTS
3. **CDK stack** expects CloudFormation PARAMETERS passed via CLI

These three systems were developed independently with incompatible assumptions about data flow.

### Why This Happened

1. **v0.8.0 Setup Wizard** added resource discovery via `DescribeStackResources`
   - Goal: Find Athena workgroups and S3 buckets for IAM permissions
   - Implementation: Added fields to `QuiltConfig` interface

2. **v1.0.0 Service Resolver** added optional output fields
   - Goal: Pass workgroup/bucket names as environment variables
   - Assumption: Quilt stacks export these as outputs (they don't)

3. **CDK Stack** added new parameters
   - Goal: Accept optional workgroup/bucket values
   - Assumption: Service resolver would provide them (it can't)

Each change assumed the others would "just work" but they use fundamentally incompatible APIs.

---

## Impact Assessment

### User Experience
- **Setup wizard appears to work** - discovers resources, saves config
- **Deployment silently fails to use discovered data** - no errors, just empty values
- **Container starts with incomplete environment variables**
- **Hard to debug** - no clear error messages indicating the mismatch

### Technical Debt
- Three parallel systems doing similar work differently
- Type system doesn't prevent this (QuiltConfig vs QuiltServices vs CDK Parameters)
- Silent failure mode - no validation that discovered data is actually used

### Operational Risk
- Deployments may work but with degraded functionality
- IAM permissions may be incomplete if workgroups/buckets aren't discovered
- No way to verify resource discovery succeeded

---

## Fix Strategy (High Level)

### Option A: Outputs-Based Approach (Recommended)
1. **Quilt stacks MUST export all required outputs**
   - Add `UserAthenaWorkgroupName`, `AthenaResultsBucketName`, `IcebergWorkgroupName` to T4 template
   - This is the cleanest fix but requires Quilt stack changes

2. **Service resolver stays as-is**
   - Already correctly queries outputs
   - Just needs Quilt stacks to export the right values

3. **Setup wizard uses service resolver**
   - Replace `inferQuiltConfig` resource discovery with `resolveQuiltServices`
   - Eliminates duplicate code and ensures consistency

### Option B: Hybrid Approach (Fallback)
1. **Service resolver tries outputs first, falls back to resources**
   - If `UserAthenaWorkgroupName` output exists, use it
   - Otherwise, query `DescribeStackResources` as fallback

2. **Setup wizard saves both outputs and resources**
   - Cache resource IDs in config for fallback

3. **Deploy command validates data completeness**
   - Warn if optional fields are empty

### Option C: Cached Resolution Approach (RECOMMENDED - Best Solution)
1. **Setup wizard resolves EVERYTHING at setup time**
   - Run `resolveQuiltServices()` during Phase 2
   - Fall back to resource discovery if outputs missing
   - Cache complete resolved services in config

2. **Deploy reads cached services from config**
   - No AWS queries at deploy time
   - Just pass config values to CDK parameters
   - Validate completeness before deploy

3. **Benefits**:
   - ✅ Fast deploys (no CloudFormation queries)
   - ✅ Works with any Quilt stack (outputs or resources)
   - ✅ Single source of truth (config file)
   - ✅ Explicit validation at setup time
   - ✅ User can inspect/edit resolved values

**Why best**: Separates discovery (setup time) from deployment (deploy time). Config file becomes the contract between them.

### Option D: Resources-Only Approach (Not Recommended)
1. **Remove service resolver entirely**
2. **Use setup wizard's resource discovery everywhere**
3. **Pass resource IDs directly to CDK**

**Why not**: Resource discovery is fragile (depends on logical IDs) and mixes deployment-time resolution with setup.

---

## Required Changes

### Immediate (Fix Broken Flow)
1. **Service Resolver**: Add fallback to `DescribeStackResources` when outputs missing
2. **Deploy Command**: Validate that required services are non-empty before CDK deploy
3. **Tests**: Add integration test that verifies end-to-end setup → deploy flow

### Short-Term (Remove Duplication)
1. **Setup Wizard**: Replace `inferQuiltConfig` with `resolveQuiltServices`
2. **Config Schema**: Remove resource-specific fields from `QuiltConfig`
3. **Type System**: Ensure `ProfileConfig` → `QuiltServices` → CDK parameters use same field names

### Long-Term (Proper Architecture)
1. **Quilt Stacks**: Export all workgroup/bucket names as CloudFormation outputs
2. **Remove Resource Discovery**: Delete `DescribeStackResources` code entirely
3. **Single Source of Truth**: Service resolver is the only place that queries AWS

---

## Testing Requirements

### Unit Tests Needed
- [ ] Service resolver with missing optional outputs (should not throw)
- [ ] Service resolver with malformed outputs (should throw clear error)
- [ ] Config schema validation (ensure QuiltConfig → QuiltServices mapping)

### Integration Tests Needed
- [ ] **CRITICAL**: Full setup → deploy → verify flow
  - Run setup wizard
  - Read resulting config
  - Call deploy with that config
  - Verify all parameters are populated
- [ ] Fallback behavior when outputs missing
- [ ] Error messages when required outputs missing

### Regression Tests Needed
- [ ] Existing Quilt stacks (without new outputs) still work
- [ ] New Quilt stacks (with new outputs) use them
- [ ] Invalid stack ARNs fail fast with clear errors

---

## Recommendations

### Priority 1: Stop the Bleeding
1. **Immediately revert** the new CDK parameters (`IcebergWorkgroup`, `AthenaUserWorkgroup`, `AthenaResultsBucket`)
2. **Document** that optional Athena resources are not yet supported
3. **Release patch** (0.8.1) that removes broken parameters

### Priority 2: Fix the Architecture
1. **Consolidate** resource discovery into service resolver
2. **Remove** duplicate code in `infer-quilt-config.ts`
3. **Validate** that ProfileConfig → QuiltServices → CDK params have matching fields

### Priority 3: Add Validation
1. **Setup wizard** should validate that discovered resources match expected schema
2. **Deploy command** should fail fast if required services are missing
3. **CDK stack** should validate parameter completeness before provisioning

---

## Appendix: Code References

### Key Files
- [bin/commands/infer-quilt-config.ts](../../bin/commands/infer-quilt-config.ts) - Resource discovery
- [lib/utils/service-resolver.ts](../../lib/utils/service-resolver.ts) - Output resolution
- [lib/benchling-webhook-stack.ts](../../lib/benchling-webhook-stack.ts) - CDK parameters
- [bin/commands/deploy.ts](../../bin/commands/deploy.ts) - Parameter mapping
- [lib/types/config.ts](../../lib/types/config.ts) - Type definitions

### Data Flow Diagram
```
Setup Wizard
  ├─> Phase 2: inferQuiltConfig()
  │     ├─> DescribeStackResources (CloudFormation API)
  │     └─> Discovers: athenaUserWorkgroup, icebergWorkgroup, athenaResultsBucket
  │
  └─> Saves to ProfileConfig in ~/.config/benchling-webhook/{profile}/config.json

Deploy Command
  ├─> Reads ProfileConfig
  ├─> resolveQuiltServices()
  │     ├─> DescribeStacks (CloudFormation API)
  │     └─> Resolves: UserAthenaWorkgroupName, IcebergWorkgroupName, AthenaResultsBucketName
  │              (but these outputs DON'T EXIST in most Quilt stacks)
  │
  └─> Passes to CDK:
        ├─> IcebergWorkgroup = ""           (always empty)
        ├─> AthenaUserWorkgroup = ""        (always empty)
        └─> AthenaResultsBucket = ""        (always empty)

CDK Stack
  └─> Creates parameters with default: ""
        (environment variables are empty strings in container)
```

---

## Conclusion

The resource discovery flow is **fundamentally broken** due to architectural mismatches between three independent systems. The immediate fix is to **revert the new optional parameters** and then properly architect a unified approach that uses CloudFormation **outputs** (not resources) as the single source of truth.

Without fixing this, the setup wizard gives users false confidence that configuration is complete, while deployments silently fail to use the discovered data.
