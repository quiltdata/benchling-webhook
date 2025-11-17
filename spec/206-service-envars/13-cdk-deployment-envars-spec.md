# CDK Deployment Environment Variables Specification

**Issue**: #206 - Service envars

**Status**: TECHNICAL SPECIFICATION

**Date**: 2025-11-16

**Version**: 1.0.0

---

## Overview

Align CDK deployment with the new XDG Launch environment variable architecture. The CDK stack must create CloudFormation parameters for each new environment variable and pass them to the ECS Fargate container, eliminating the inconsistency between local (xdg-launch) and deployed (CDK) execution environments.

---

## Core Principle

**Single Source of Truth**: XDG Profile Configuration → Environment Variables (same mapping for both local and deployed)

The environment variable mapping logic in `bin/xdg-launch.ts:buildEnvVars()` (lines 152-208) defines the canonical mapping. CDK deployment must replicate this exactly.

---

## Current State

### What Works

- XDG Launch reads profile config → maps to env vars → passes to Docker/Flask
- CDK reads profile config → creates parameters → passes to Fargate
- Service resolution from Quilt stack at deployment time (eliminates runtime CloudFormation calls)

### The Problem

**Environment variables differ between local and deployed execution**:

| Envar | XDG Launch (local) | CDK (deployed) | Status |
|-------|-------------------|----------------|--------|
| `QUILT_WEB_HOST` | ✅ Set | ❌ Missing | **NEW** |
| `ATHENA_USER_DATABASE` | ✅ Set | ✅ Set | Exists |
| `ATHENA_USER_WORKGROUP` | ✅ Set | ❌ Optional | **NEW** |
| `ATHENA_RESULTS_BUCKET` | ✅ Set | ❌ Optional | **NEW** |
| `ICEBERG_DATABASE` | ✅ Set | ✅ Set | Exists |
| `ICEBERG_WORKGROUP` | ✅ Set | ❌ Missing | **NEW** |
| `PACKAGER_SQS_URL` | ✅ Set | ✅ Set | Exists |
| `BENCHLING_SECRET_ARN` | ✅ Set | ✅ Set | Exists |
| `BENCHLING_TENANT` | ✅ Set | ✅ Set | Exists |
| `BENCHLING_LOG_LEVEL` | ✅ Set | ❌ Uses `LOG_LEVEL` | Inconsistent |
| `PACKAGE_BUCKET` | ✅ Set | ❌ Uses `BENCHLING_PKG_BUCKET` | Inconsistent |
| `PACKAGE_PREFIX` | ✅ Set | ❌ Uses `BENCHLING_PKG_PREFIX` | Inconsistent |
| `PACKAGE_METADATA_KEY` | ✅ Set | ❌ Uses `BENCHLING_PKG_KEY` | Inconsistent |
| `ENABLE_WEBHOOK_VERIFICATION` | ✅ Set | ✅ Set | Exists |

**Result**: Python application must handle two different sets of environment variable names depending on execution context.

---

## Required Changes

### 1. Environment Variable Naming Consistency

**What**: Standardize all environment variable names to match XDG Launch specification.

**Where**: `lib/fargate-service.ts:245-269` (environment variable mapping)

**Changes**:

- Rename `BENCHLING_PKG_*` → `PACKAGE_*` (3 variables)
- Rename `LOG_LEVEL` → `BENCHLING_LOG_LEVEL`
- Add missing variables: `ICEBERG_WORKGROUP`, `ATHENA_USER_WORKGROUP`, `ATHENA_RESULTS_BUCKET`
- Remove deprecated `BenchlingSecret` (line 283)

**New Variable Set** (must exactly match `bin/xdg-launch.ts:152-208`):

```typescript
{
  // AWS Configuration
  AWS_REGION: string,
  AWS_DEFAULT_REGION: string,

  // Quilt Services
  QUILT_WEB_HOST: string,
  ATHENA_USER_DATABASE: string,
  ATHENA_USER_WORKGROUP: string,          // NEW (optional, from Quilt stack discovery)
  ATHENA_RESULTS_BUCKET: string,          // NEW (optional, from Quilt stack discovery)
  ICEBERG_DATABASE: string,
  ICEBERG_WORKGROUP: string,              // NEW
  PACKAGER_SQS_URL: string,

  // Benchling Configuration
  BENCHLING_SECRET_ARN: string,
  BENCHLING_TENANT: string,
  BENCHLING_LOG_LEVEL: string,            // RENAMED from LOG_LEVEL

  // Package Storage
  PACKAGE_BUCKET: string,                 // RENAMED from BENCHLING_PKG_BUCKET
  PACKAGE_PREFIX: string,                 // RENAMED from BENCHLING_PKG_PREFIX
  PACKAGE_METADATA_KEY: string,           // RENAMED from BENCHLING_PKG_KEY

  // Application Configuration
  FLASK_ENV: "production",
  ENABLE_WEBHOOK_VERIFICATION: string,
  BENCHLING_WEBHOOK_VERSION: string,
}
```

---

### 2. CloudFormation Parameter Updates

**What**: Add missing CloudFormation parameters for new environment variables.

**Where**: `lib/benchling-webhook-stack.ts:56-114` (parameter definitions)

**Add New Parameters**:

```typescript
// Add after line 82 (IcebergDatabase parameter):
const icebergWorkgroupParam = new cdk.CfnParameter(this, "IcebergWorkgroup", {
    type: "String",
    description: "Iceberg workgroup name (optional)",
    default: "",
});

const athenaUserWorkgroupParam = new cdk.CfnParameter(this, "AthenaUserWorkgroup", {
    type: "String",
    description: "Athena workgroup for user queries (optional, from Quilt stack)",
    default: "",
});

const athenaResultsBucketParam = new cdk.CfnParameter(this, "AthenaResultsBucket", {
    type: "String",
    description: "S3 bucket for Athena query results (optional, from Quilt stack)",
    default: "",
});
```

**Rename Existing Parameters**:

- `LogLevel` → keep but update usage to set `BENCHLING_LOG_LEVEL` envar
- `PackageBucket` → keep but update usage to set `PACKAGE_BUCKET` envar

---

### 3. Service Resolver Enhancement

**What**: Resolve additional Quilt stack resources at deployment time.

**Where**: `lib/utils/service-resolver.ts` (QuiltServices interface)

**Add to QuiltServices Interface**:

```typescript
export interface QuiltServices {
    // Existing
    packagerQueueUrl: string;
    athenaUserDatabase: string;
    quiltWebHost: string;
    icebergDatabase: string;

    // NEW - from Quilt stack discovery
    athenaUserWorkgroup?: string;        // From UserAthenaWorkgroupName output
    athenaResultsBucket?: string;        // From AthenaResultsBucketName output
    icebergWorkgroup?: string;           // From IcebergWorkgroupName output
}
```

**Resolution Logic**:

- Read additional CloudFormation stack outputs
- Default to empty string if outputs don't exist
- Pass to stack parameters for container environment

---

### 4. FargateService Props Update

**What**: Pass resolved Quilt resources to Fargate service.

**Where**:

1. `lib/fargate-service.ts:22-46` (FargateServiceProps interface)
2. `lib/benchling-webhook-stack.ts:151-172` (FargateService instantiation)

**Add to FargateServiceProps**:

```typescript
export interface FargateServiceProps {
    // ... existing props ...

    // NEW - additional Quilt resources
    readonly icebergWorkgroup?: string;
}
```

**Update Stack Instantiation** (`lib/benchling-webhook-stack.ts:151-172`):

```typescript
this.fargateService = new FargateService(this, "FargateService", {
    // ... existing props ...
    icebergWorkgroup: icebergWorkgroupValue,  // NEW
    athenaUserWorkgroup: athenaUserWorkgroupValue,  // Update from config to param
    athenaResultsBucket: athenaResultsBucketValue,  // Update from config to param
});
```

---

### 5. Deployment Command Updates

**What**: Resolve and pass new parameters during deployment.

**Where**: `bin/commands/deploy.ts:292-319` (service resolution) and `bin/commands/deploy.ts:382-396` (parameter building)

**Service Resolution** (lines 292-319):

- Extend `resolveQuiltServices()` call to return new optional fields
- Handle missing outputs gracefully (empty string defaults)

**Parameter Building** (lines 382-396):

```typescript
const parameters = [
    // Existing explicit service parameters
    `PackagerQueueUrl=${services.packagerQueueUrl}`,
    `AthenaUserDatabase=${services.athenaUserDatabase}`,
    `QuiltWebHost=${services.quiltWebHost}`,
    `IcebergDatabase=${services.icebergDatabase || ""}`,

    // NEW - additional Quilt resources
    `IcebergWorkgroup=${services.icebergWorkgroup || ""}`,
    `AthenaUserWorkgroup=${services.athenaUserWorkgroup || ""}`,
    `AthenaResultsBucket=${services.athenaResultsBucket || ""}`,

    // Existing legacy parameters
    `BenchlingSecretARN=${benchlingSecret}`,
    `ImageTag=${options.imageTag}`,
    `PackageBucket=${config.packages.bucket}`,
    `QuiltDatabase=${config.quilt.database || ""}`,  // IAM permissions only (same value as AthenaUserDatabase)
    `LogLevel=${config.logging?.level || "INFO"}`,
];
```

**Note**: `QuiltDatabase` and `AthenaUserDatabase` receive the same value (`config.quilt.database`) but serve different purposes:

- `AthenaUserDatabase` → passed as `ATHENA_USER_DATABASE` environment variable to container
- `QuiltDatabase` → used for IAM Glue database permissions (not an environment variable)

---

## Implementation Order

1. **Service Resolver** - Add new optional fields to QuiltServices interface and resolution logic
2. **Stack Parameters** - Add new CloudFormation parameters
3. **Fargate Props** - Update FargateServiceProps interface
4. **Environment Variables** - Standardize naming in fargate-service.ts
5. **Stack Instantiation** - Pass new parameters to FargateService
6. **Deploy Command** - Resolve and pass new parameters

---

## Testing Strategy

### Verification Steps

1. **Local vs Deployed Parity**:

   ```bash
   # Local execution
   npm run test:native -- --verbose | grep -E "^  [A-Z_]+="

   # Deployed execution (check ECS logs)
   aws logs tail /aws/ecs/BenchlingWebhookStack --format short
   ```

   Compare environment variable sets - must be identical.

2. **Stack Parameter Validation**:

   ```bash
   aws cloudformation describe-stacks \
     --stack-name BenchlingWebhookStack \
     --query 'Stacks[0].Parameters[*].[ParameterKey,ParameterValue]' \
     --output table
   ```

   Verify all new parameters present.

3. **Container Environment Check**:

   ```bash
   aws ecs describe-task-definition \
     --task-definition benchling-webhook-task \
     --query 'taskDefinition.containerDefinitions[0].environment' \
     --output json
   ```

   Verify all environment variables match XDG Launch spec.

### Test Cases

| Test | Command | Expected Result |
|------|---------|-----------------|
| Dev deployment | `npm run deploy:dev -- --yes` | Stack deploys with all envars |
| Prod deployment | `npm run deploy:prod -- --yes` | Stack deploys with all envars |
| Local native | `npm run test:native` | Same envars as deployed |
| Local Docker dev | `npm run test:local` | Same envars as deployed |

---

## Breaking Changes

### Environment Variable Renames

| Old Name | New Name | Impact |
|----------|----------|--------|
| `LOG_LEVEL` | `BENCHLING_LOG_LEVEL` | Python code must check both (fallback) |
| `BENCHLING_PKG_BUCKET` | `PACKAGE_BUCKET` | Python code must check both (fallback) |
| `BENCHLING_PKG_PREFIX` | `PACKAGE_PREFIX` | Python code must check both (fallback) |
| `BENCHLING_PKG_KEY` | `PACKAGE_METADATA_KEY` | Python code must check both (fallback) |

### Migration Strategy

**Phase 1** (this change):

- CDK sets both old and new variable names
- Python code prefers new names, falls back to old

**Phase 2** (next release):

- Deprecation warnings when old names used
- Documentation updated

**Phase 3** (future):

- Remove old names entirely

---

## Success Criteria

- ✅ All environment variables match between local and deployed execution
- ✅ All CloudFormation parameters map 1:1 to environment variables
- ✅ Service resolution includes all optional Quilt resources
- ✅ Zero hardcoded values - everything from XDG profile or Quilt stack
- ✅ Backward compatibility maintained via fallback logic
- ✅ Tests pass for all execution modes (native, Docker dev, Docker prod, deployed)

---

## References

- [12-xdg-launch-spec.md](./12-xdg-launch-spec.md) - Environment variable mapping specification
- [bin/xdg-launch.ts](../../bin/xdg-launch.ts) - Reference implementation (buildEnvVars function)
- [lib/fargate-service.ts](../../lib/fargate-service.ts) - Current CDK environment variables
- [lib/benchling-webhook-stack.ts](../../lib/benchling-webhook-stack.ts) - CloudFormation parameters
- [bin/commands/deploy.ts](../../bin/commands/deploy.ts) - Deployment command

---

## Notes

### Why This Matters

**Problem**: Developers test locally with XDG Launch, deploy with CDK, but the two environments have different variable names. Bugs that don't appear locally can appear in production.

**Solution**: Make the environment variable mapping identical. XDG Launch defines the canonical mapping; CDK replicates it exactly.

### Design Decisions

1. **Optional vs Required**: New Quilt resources (workgroups, results bucket) are optional because older Quilt stacks may not export them. Use empty string defaults.

2. **Backward Compatibility**: Keep old variable names temporarily to avoid breaking existing deployments mid-upgrade.

3. **Service Resolution Timing**: Resolve at deployment time (not runtime) to eliminate CloudFormation API calls during webhook processing.

4. **Parameter Explosion**: Accept more CloudFormation parameters to achieve environment parity - deployment-time resolution is a one-time cost.
