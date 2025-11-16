# Resource Discovery Enhancement Summary

**Issue**: #206 - Service environment variables (Phase 2)
**Branch**: `merge-main-into-206`
**Date**: 2025-11-16
**Related Plan**: `IMPLEMENTATION-PLAN-RESOURCES.md`

## Quick Overview

Enhance stack inference to discover three additional AWS resources from Quilt CloudFormation stacks:

| Resource | Type | Purpose |
|----------|------|---------|
| `UserAthenaNonManagedRoleWorkgroup` | AWS::Athena::WorkGroup | User query workgroup |
| `IcebergWorkGroup` | AWS::Athena::WorkGroup | Iceberg query workgroup |
| `IcebergDatabase` | AWS::Glue::Database | Iceberg database |

## Key Architecture Decision

**Resources vs Outputs**:
- **Current**: Stack inference queries `stack.Outputs[]` (user-defined exports)
- **New**: Must query `stack.Resources[]` via `DescribeStackResourcesCommand`
- **Reason**: These resources are NOT exported as stack outputs

```typescript
// CURRENT (Outputs)
const outputs = stack.Outputs || [];
const queueUrl = outputs.find(o => o.OutputKey === "PackagerQueueUrl")?.OutputValue;

// NEW (Resources)
const resources = await describeStackResources(stackName);
const workgroup = resources.find(r =>
  r.LogicalResourceId === "UserAthenaNonManagedRoleWorkgroup"
)?.PhysicalResourceId;
```

## Implementation Scope

### 7 Tasks, 14 Hours Total

1. **Type System** (1h) - Add fields to TypeScript interfaces
2. **Resource Discovery** (3h) - Implement `getStackResources()` and `extractQuiltResources()`
3. **Stack Inference** (2h) - Integrate resource discovery into `inferQuiltConfig()`
4. **Setup Wizard** (1h) - Display discovered resources
5. **Status Command** (2h) - Show resources in status output
6. **Config Persistence** (1h) - Save resources to profile config
7. **Integration Tests** (4h) - Live AWS tests with real stacks

### Files Modified (10 files)

**Core Logic**:
- `lib/types/config.ts` - Add `athenaUserWorkgroup`, `athenaIcebergWorkgroup` to `QuiltConfig`
- `lib/wizard/types.ts` - Add fields to `StackQueryResult`
- `lib/utils/stack-inference.ts` - New `getStackResources()` and `extractQuiltResources()`
- `bin/commands/infer-quilt-config.ts` - Call resource discovery

**User Experience**:
- `lib/wizard/phase2-stack-query.ts` - Display resources in wizard
- `bin/commands/status.ts` - Display resources in status command
- `lib/wizard/phase6-integrated-mode.ts` - Save to config
- `lib/wizard/phase7-standalone-mode.ts` - Save to config

**Testing**:
- `test/integration/stack-resource-discovery.test.ts` - Live AWS integration tests
- `test/integration/README.md` - Test documentation

## Critical Features

### 1. Graceful Degradation
Resources are **optional**. If resource discovery fails:
- Log a warning
- Continue with setup/status
- Don't fail the command

### 2. Live Integration Tests
**Requirements**:
- AWS credentials configured
- Quilt stack deployed
- Profile config with `stackArn`

**Safety**:
- Read-only operations
- No create/update/delete
- Safe for production stacks

**Run Tests**:
```bash
npm run test:integration
```

### 3. Configuration Flow

```
Setup Wizard
  → inferQuiltConfig()
    → findQuiltStacks()
      → DescribeStacksCommand (outputs)
      → DescribeStackResourcesCommand (resources)  ← NEW
        → Extract by LogicalResourceId
    → Return StackQueryResult
  → Save to ProfileConfig
  → Display in wizard

Status Command
  → Load ProfileConfig
  → DescribeStackResourcesCommand  ← NEW
  → Display resources
```

## Expected Output

### Setup Wizard
```
Step 2: Quilt Stack Configuration

Querying CloudFormation stack for catalog: dev.quiltdata.com...

✓ Stack query succeeded

Stack ARN: arn:aws:cloudformation:us-east-2:123456789012:stack/tf-dev-bench/...
Database: quilt_dev_catalog
Queue URL: https://sqs.us-east-2.amazonaws.com/123456789012/packager-queue
Region: us-east-2
Account: 123456789012
Athena User Workgroup: quilt-user-workgroup-dev          ← NEW
Athena Iceberg Workgroup: quilt-iceberg-workgroup-dev    ← NEW
```

### Status Command
```
Quilt Stack Resources:
  User Workgroup: quilt-user-workgroup-dev               ← NEW
  Iceberg Workgroup: quilt-iceberg-workgroup-dev         ← NEW
  Iceberg Database: quilt_iceberg_db                     ← NEW
```

### Saved Configuration
```json
{
  "quilt": {
    "stackArn": "arn:aws:cloudformation:...",
    "catalog": "https://dev.quiltdata.com",
    "database": "quilt_dev_catalog",
    "queueUrl": "https://sqs.us-east-2.amazonaws.com/...",
    "region": "us-east-2",
    "athenaUserWorkgroup": "quilt-user-workgroup-dev",
    "athenaIcebergWorkgroup": "quilt-iceberg-workgroup-dev",
    "icebergDatabase": "quilt_iceberg_db"
  }
}
```

## Deliverables

### Code Changes
1. Type definitions with JSDoc comments
2. Resource discovery utilities
3. Stack inference integration
4. Setup wizard display
5. Status command display
6. Configuration persistence
7. Integration tests with README

### Documentation
1. Implementation plan (`IMPLEMENTATION-PLAN-RESOURCES.md`)
2. Integration test README
3. JSDoc comments explaining resource vs output
4. Code examples in plan

## Success Criteria

- [ ] All 7 tasks completed
- [ ] Integration tests run against real AWS
- [ ] Tests verify all 3 target resources
- [ ] Resources displayed in wizard
- [ ] Resources displayed in status command
- [ ] Resources saved to config
- [ ] Graceful degradation if resources missing
- [ ] No breaking changes to existing functionality

## Ready for Implementation

This plan is complete and ready for execution by a TypeScript specialist agent. All implementation details, code examples, file paths, and acceptance criteria are provided.

**Next Step**: Assign tasks to TypeScript agent in order (1→7)

---

**Full Plan**: `/Users/ernest/GitHub/benchling-webhook/spec/206-service-envars/IMPLEMENTATION-PLAN-RESOURCES.md`
**Total Effort**: 14 hours
**Risk Level**: Low
**Breaking Changes**: None
