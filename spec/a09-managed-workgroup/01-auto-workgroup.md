# Athena Workgroup Backward Compatibility Plan

## Problem Statement

The project recently migrated from the old `UserAthenaNonManagedRoleWorkgroup` to `BenchlingAthenaWorkgroup` (commit 8f9ca4a). However, **this workgroup only exists in NEW Quilt stacks**, creating a breaking change for legacy deployments.

**Current Situation:**

- New Quilt stacks: Have `BenchlingAthenaWorkgroup` resource
- Legacy Quilt stacks: Do NOT have `BenchlingAthenaWorkgroup` resource
- Code now references `BenchlingAthenaWorkgroup` exclusively
- Legacy stacks fail to discover workgroup during setup/deployment

## Solution: Self-Managed Workgroup with Auto-Creation

Create `BenchlingAthenaWorkgroup` **within this Benchling Webhook stack** instead of relying on the Quilt stack. This provides:

- ✅ **Backward compatibility**: Works with both old and new Quilt stacks
- ✅ **Self-contained**: No dependency on Quilt stack structure
- ✅ **Seamless migration**: Legacy stacks automatically get the workgroup
- ✅ **AWS-managed results**: No S3 bucket configuration needed

## User Requirements (from Q&A)

1. **Creation Location**: In the Benchling Webhook stack (self-contained)
2. **Fallback Behavior**: Auto-create workgroup if not found in Quilt stack
3. **Configuration**: AWS-managed (no custom S3 location needed)

## Implementation Plan

### Phase 1: Create Athena Workgroup in CDK Stack

**File**: [lib/benchling-webhook-stack.ts](../lib/benchling-webhook-stack.ts)

**Add new construct** (after VPC setup, before NLB):

```typescript
// Create Athena Workgroup for package queries
// This workgroup is created in the webhook stack (not Quilt stack) for backward compatibility
// with legacy stacks that don't have BenchlingAthenaWorkgroup
const athenaWorkgroup = new athena.CfnWorkGroup(this, "BenchlingAthenaWorkgroup", {
    name: `${id}-athena-workgroup`, // e.g., "BenchlingWebhookStack-default-athena-workgroup"
    description: "Athena workgroup for Benchling webhook package queries",
    workGroupConfiguration: {
        resultConfiguration: {
            // AWS-managed: Query results stored in AWS-managed S3 location
            // No need to specify outputLocation - AWS handles it automatically
        },
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
    },
    state: "ENABLED",
});

// Use the created workgroup name for the service
const athenaWorkgroupName = athenaWorkgroup.name;
```

**Key decisions:**

- Use `CfnWorkGroup` (L1 construct) for direct CloudFormation control
- Name format: `{stackId}-athena-workgroup` (unique per deployment)
- AWS-managed results (no S3 bucket needed)
- CloudWatch metrics enabled for observability

### Phase 2: Update Fargate Service to Use Stack Workgroup

**File**: [lib/benchling-webhook-stack.ts](../lib/benchling-webhook-stack.ts)

**Change lines 256-258** (where FargateService is instantiated):

```typescript
// OLD (current):
athenaUserWorkgroup: athenaUserWorkgroupValue,

// NEW:
// Use stack-created workgroup (NOT from Quilt stack discovery)
athenaUserWorkgroup: athenaWorkgroupName,
```

**Remove CloudFormation parameter** `AthenaUserWorkgroup` (lines 98-102):

- No longer needed - workgroup is created in stack, not discovered
- Simplifies configuration

### Phase 3: Update IAM Permissions

**File**: [lib/fargate-service.ts](../lib/fargate-service.ts)

**Update lines 233-256** (Athena permissions):

```typescript
// Grant Athena access to task role for package querying
// Use the stack-created workgroup
const athenaWorkgroups = [
    // Stack-created workgroup (primary access)
    `arn:aws:athena:${config.deployment.region}:*:workgroup/${props.athenaUserWorkgroup}`,
    // Fallback to primary workgroup (for graceful degradation)
    `arn:aws:athena:${config.deployment.region}:*:workgroup/primary`,
];

taskRole.addToPolicy(
    new iam.PolicyStatement({
        actions: [
            "athena:StartQueryExecution",
            "athena:GetQueryExecution",
            "athena:GetQueryResults",
            "athena:StopQueryExecution",
            "athena:GetWorkGroup",
        ],
        resources: athenaWorkgroups,
    }),
);
```

**No changes needed** - current implementation already supports fallback to primary.

### Phase 4: Remove Quilt Stack Discovery for Workgroup

**File**: [lib/utils/stack-inference.ts](../lib/utils/stack-inference.ts)

**Update `extractQuiltResources()` function** (lines 165-209):

**Remove** `BenchlingAthenaWorkgroup` from `resourceMapping` (line 172):

```typescript
// OLD:
const resourceMapping: Record<string, keyof DiscoveredQuiltResources> = {
    BenchlingAthenaWorkgroup: "athenaUserWorkgroup",  // ← REMOVE THIS LINE
    UserAthenaNonManagedRolePolicy: "athenaUserPolicyArn",
    BucketWritePolicy: "bucketWritePolicyArn",
    BenchlingSecret: "benchlingSecretArn",
};

// NEW:
const resourceMapping: Record<string, keyof DiscoveredQuiltResources> = {
    // BenchlingAthenaWorkgroup removed - now created in webhook stack
    UserAthenaNonManagedRolePolicy: "athenaUserPolicyArn",
    BucketWritePolicy: "bucketWritePolicyArn",
    BenchlingSecret: "benchlingSecretArn",
};
```

**Update JSDoc** (lines 62-68) to remove workgroup mention:

```typescript
/**
 * Discovered Quilt resources from stack
 *
 * Target resources:
 * - UserAthenaNonManagedRolePolicy (AWS::IAM::ManagedPolicy)
 * - BucketWritePolicy (AWS::IAM::ManagedPolicy)
 * - BenchlingSecret (AWS::SecretsManager::Secret)
 */
```

**Update `DiscoveredQuiltResources` interface** (line 69-74):

```typescript
export interface DiscoveredQuiltResources {
    // athenaUserWorkgroup removed - no longer discovered from Quilt stack
    athenaUserPolicyArn?: string;
    bucketWritePolicyArn?: string;
    benchlingSecretArn?: string;
}
```

### Phase 5: Update Configuration Schema (Optional - Keep for Legacy)

**File**: [lib/types/config.ts](../lib/types/config.ts)

**Decision**: KEEP `athenaUserWorkgroup` field in config schema for backward compatibility, but mark as deprecated:

```typescript
/**
 * Athena workgroup name (DEPRECATED)
 *
 * Resolved from BenchlingAthenaWorkgroup stack resource (v0.8.0+)
 *
 * @deprecated v0.11.0+ - Workgroup is now created in the webhook stack automatically.
 *                        This field is ignored and kept only for backward compatibility.
 */
athenaUserWorkgroup?: string;
```

**Rationale**: Existing configs may have this field populated. Marking deprecated but not removing prevents breaking existing configs.

### Phase 6: Update Deployment Logic

**File**: [bin/commands/deploy.ts](../bin/commands/deploy.ts)

**No changes needed** - Workgroup is now created by CDK stack, not passed as parameter.

**File**: [bin/xdg-launch.ts](../bin/xdg-launch.ts)

**Update line 203** (buildEnvVars function):

```typescript
// OLD:
ATHENA_USER_WORKGROUP: config.quilt.athenaUserWorkgroup || "primary",

// NEW - Use stack-created workgroup name format:
ATHENA_USER_WORKGROUP: `BenchlingWebhookStack-${profileName}-athena-workgroup`,
```

**Note**: This requires passing `stackName` to `buildEnvVars()` to construct the workgroup name dynamically.

### Phase 7: Update Tests

**File**: [test/integration/xdg-launch-pure-functions.test.ts](../test/integration/xdg-launch-pure-functions.test.ts)

**Remove BenchlingAthenaWorkgroup from mock resources** (lines 328-332, 356-360):

```typescript
// Remove these blocks:
BenchlingAthenaWorkgroup: {
    physicalResourceId: "test-athena-workgroup",
    resourceType: "AWS::Athena::WorkGroup",
    resourceStatus: "CREATE_COMPLETE",
},
```

**Update expectations** - workgroup should NOT be in discovered resources:

```typescript
// Should NOT discover workgroup anymore
expect(discovered.athenaUserWorkgroup).toBeUndefined();
```

**File**: [test/integration/stack-resource-discovery.test.ts](../test/integration/stack-resource-discovery.test.ts)

**Remove workgroup discovery tests** - no longer relevant since workgroup is created in webhook stack.

### Phase 8: Update Documentation

**Files to update:**

1. **[CLAUDE.md](../CLAUDE.md)** - Add migration note:

   ```markdown
   ## Athena Workgroup (v0.11.0+)

   The Benchling webhook stack now creates its own `BenchlingAthenaWorkgroup` instead of
   discovering it from the Quilt stack. This ensures backward compatibility with legacy
   Quilt stacks that don't have the workgroup resource.

   - Workgroup name: `{stackName}-athena-workgroup`
   - Configuration: AWS-managed (automatic query result handling)
   - IAM permissions: Automatically granted to ECS task role
   ```

2. **[spec/206-service-envars/RESOURCE-DISCOVERY-SUMMARY.md](../spec/206-service-envars/RESOURCE-DISCOVERY-SUMMARY.md)**
   - Remove `BenchlingAthenaWorkgroup` from discovered resources table

3. **[CHANGELOG.md](../CHANGELOG.md)** - Add entry:

   ```markdown
   ## [Unreleased]

   ### Added
   - Create `BenchlingAthenaWorkgroup` within webhook stack for backward compatibility

   ### Changed
   - BREAKING: No longer discover `BenchlingAthenaWorkgroup` from Quilt stack
   - Athena workgroup is now self-managed by the webhook stack

   ### Migration Guide
   Legacy stacks will automatically get the workgroup created during next deployment.
   No manual intervention required.
   ```

## Critical Files Summary

### Files to Modify

1. [lib/benchling-webhook-stack.ts](../lib/benchling-webhook-stack.ts) - Add workgroup creation
2. [lib/utils/stack-inference.ts](../lib/utils/stack-inference.ts) - Remove workgroup discovery
3. [lib/types/config.ts](../lib/types/config.ts) - Deprecate config field
4. [bin/xdg-launch.ts](../bin/xdg-launch.ts) - Update env var construction
5. [test/integration/xdg-launch-pure-functions.test.ts](../test/integration/xdg-launch-pure-functions.test.ts) - Update tests
6. [test/integration/stack-resource-discovery.test.ts](../test/integration/stack-resource-discovery.test.ts) - Remove workgroup tests
7. [CLAUDE.md](../CLAUDE.md) - Document change
8. [CHANGELOG.md](../CHANGELOG.md) - Add migration note

### Files to Review (might not need changes)

- [lib/fargate-service.ts](../lib/fargate-service.ts) - IAM permissions (likely OK as-is)
- [docker/src/package_query.py](../docker/src/package_query.py) - Python workgroup usage (no change needed)
- [docker/src/config.py](../docker/src/config.py) - Config parsing (no change needed)

## Rollout Strategy

### Step 1: Development

1. Implement changes in feature branch
2. Run unit tests: `npm test`
3. Test local Docker build: `npm run test:local`

### Step 2: Dev Environment Testing

1. Deploy to dev environment
2. Verify workgroup creation in CloudFormation console
3. Verify ECS task logs show correct workgroup
4. Test webhook functionality end-to-end

### Step 3: Production Rollout

1. Test with a non-critical legacy stack first
2. Monitor CloudWatch logs for workgroup usage
3. Verify Athena queries execute successfully
4. Roll out to remaining stacks

## Benefits

1. **Backward Compatibility**: Works with both new and legacy Quilt stacks
2. **Self-Contained**: No dependency on Quilt stack resource structure
3. **Simplified Configuration**: No need to discover workgroup from external stack
4. **Automatic Migration**: Legacy stacks get workgroup on next deployment
5. **AWS-Managed**: No S3 bucket configuration needed
6. **Per-Stack Isolation**: Each webhook stack has its own workgroup

## Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| Workgroup name conflicts | Use unique name per stack: `{stackId}-athena-workgroup` |
| IAM permission issues | Maintain fallback to `primary` workgroup in permissions |
| Query result storage | Use AWS-managed configuration (no custom S3 needed) |
| Legacy config breaks | Keep deprecated `athenaUserWorkgroup` field in schema |

## Testing Checklist

- [ ] Unit tests pass (`npm test`)
- [ ] Local Docker tests pass (`npm run test:local`)
- [ ] Dev deployment creates workgroup successfully
- [ ] ECS logs show correct workgroup name
- [ ] Athena queries execute without errors
- [ ] Legacy stack upgrade works seamlessly
- [ ] New stack deployment works as before
- [ ] CloudWatch metrics appear for workgroup

## Success Criteria

1. ✅ Workgroup created automatically in webhook stack
2. ✅ Legacy stacks work without manual intervention
3. ✅ New stacks continue to work normally
4. ✅ Athena queries execute successfully using new workgroup
5. ✅ No breaking changes to existing configurations
6. ✅ Tests pass completely
