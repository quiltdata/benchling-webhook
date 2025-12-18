# A07: Fix CloudFormation Parameter Defaults for Library Usage

**Status:** Proposed
**Date:** 2025-12-17
**Author:** Claude Code
**Issue:** Customer deployments fail with "degraded" mode when using stack as library

## Problem Statement

When customers import `BenchlingWebhookStack` as a library in their own CDK applications, the deployed service reports "degraded" mode with missing configuration:

```json
{
  "status": "healthy",
  "service": "benchling-webhook",
  "version": "0.9.3",
  "mode": "degraded",
  "warning": "Missing required configuration: QUILT_WEB_HOST, ATHENA_USER_DATABASE, PACKAGER_SQS_URL"
}
```

### Root Cause

CloudFormation parameters in [lib/benchling-webhook-stack.ts](../lib/benchling-webhook-stack.ts) have hardcoded empty string defaults:

```typescript
const packagerQueueUrlParam = new cdk.CfnParameter(this, "PackagerQueueUrl", {
    type: "String",
    description: "SQS queue URL for Quilt package creation jobs",
    default: "",  // <-- HARDCODED EMPTY STRING
});

const athenaUserDatabaseParam = new cdk.CfnParameter(this, "AthenaUserDatabase", {
    type: "String",
    description: "Athena/Glue database name for Quilt catalog metadata",
    default: "",  // <-- HARDCODED EMPTY STRING
});

const quiltWebHostParam = new cdk.CfnParameter(this, "QuiltWebHost", {
    type: "String",
    description: "Quilt catalog domain (without protocol or trailing slash)",
    default: "",  // <-- HARDCODED EMPTY STRING
});
```

When customers instantiate the stack with a `config` object containing these values:

```typescript
new BenchlingWebhookStack(app, 'MyStack', {
  config: {
    quilt: {
      catalog: "quilt-dev.datalake.fl86.cloud",
      queueUrl: "https://sqs.us-east-1.amazonaws.com/...",
      database: "userathenadatabase",
      // ...
    },
    // ...
  }
});
```

The CloudFormation parameters **ignore** these config values and use the hardcoded empty string defaults instead. This results in ECS containers receiving empty environment variables:

```typescript
// In fargate-service.ts:302-309
const environmentVars: { [key: string]: string } = {
    QUILT_WEB_HOST: props.quiltWebHost,           // Gets "" from parameter
    ATHENA_USER_DATABASE: props.athenaUserDatabase, // Gets "" from parameter
    PACKAGER_SQS_URL: props.packagerQueueUrl,      // Gets "" from parameter
    // ...
};
```

### Why NPM Deployment Works

The npm deployment command in [bin/commands/deploy.ts](../bin/commands/deploy.ts:571-589) explicitly passes CloudFormation parameters:

```typescript
const parameters = [
    `PackagerQueueUrl=${services.packagerQueueUrl}`,
    `AthenaUserDatabase=${services.athenaUserDatabase}`,
    `QuiltWebHost=${services.quiltWebHost}`,
    // ...
];

const parametersArg = parameters.map(p => `--parameters ${p}`).join(" ");
// Passes to: cdk deploy --parameters PackagerQueueUrl=... --parameters AthenaUserDatabase=...
```

This **overrides** the empty defaults with actual values from the profile config.

### Why Library Usage Fails

Customers using the stack as a library typically do:

```bash
cdk deploy
```

Without passing `--parameters` flags, CloudFormation uses the hardcoded defaults (`""`), ignoring the config passed to the constructor.

## Current Workaround

Customers must pass CloudFormation parameters explicitly:

```bash
cdk deploy \
  --parameters PackagerQueueUrl="https://sqs.us-east-1.amazonaws.com/329834164542/DevQuiltDeploymentStack-PackagerQueue-YR8w3dt7XoFU" \
  --parameters AthenaUserDatabase="userathenadatabase" \
  --parameters QuiltWebHost="quilt-dev.datalake.fl86.cloud" \
  --parameters IcebergDatabase="" \
  --parameters IcebergWorkgroup="" \
  --parameters AthenaUserWorkgroup="" \
  --parameters AthenaResultsBucket=""
```

This is **not documented** and defeats the purpose of passing config to the constructor.

## Proposed Solution

### Option A: Use Config Values as Parameter Defaults (RECOMMENDED)

Change parameter defaults to use values from the `config` object passed to the stack constructor:

```typescript
// In lib/benchling-webhook-stack.ts:60-82
const packagerQueueUrlParam = new cdk.CfnParameter(this, "PackagerQueueUrl", {
    type: "String",
    description: "SQS queue URL for Quilt package creation jobs",
    default: config.quilt.queueUrl || "",  // Use config value as default
});

const athenaUserDatabaseParam = new cdk.CfnParameter(this, "AthenaUserDatabase", {
    type: "String",
    description: "Athena/Glue database name for Quilt catalog metadata",
    default: config.quilt.database || "",  // Use config value as default
});

const quiltWebHostParam = new cdk.CfnParameter(this, "QuiltWebHost", {
    type: "String",
    description: "Quilt catalog domain (without protocol or trailing slash)",
    default: config.quilt.catalog || "",  // Use config value as default
});

const icebergDatabaseParam = new cdk.CfnParameter(this, "IcebergDatabase", {
    type: "String",
    description: "Iceberg database name (optional, leave empty if not used)",
    default: config.quilt.icebergDatabase || "",  // Use config value as default
});

const icebergWorkgroupParam = new cdk.CfnParameter(this, "IcebergWorkgroup", {
    type: "String",
    description: "Iceberg workgroup name (optional, from Quilt stack discovery)",
    default: config.quilt.icebergWorkgroup || "",  // Use config value as default
});

const athenaUserWorkgroupParam = new cdk.CfnParameter(this, "AthenaUserWorkgroup", {
    type: "String",
    description: "Athena workgroup for user queries (optional, from Quilt stack discovery)",
    default: config.quilt.athenaUserWorkgroup || "",  // Use config value as default
});

const athenaResultsBucketParam = new cdk.CfnParameter(this, "AthenaResultsBucket", {
    type: "String",
    description: "S3 bucket for Athena query results (optional, from Quilt stack discovery)",
    default: config.quilt.athenaResultsBucket || "",  // Use config value as default
});
```

**Benefits:**
- Library usage works without passing `--parameters` flags
- NPM deployment command still works (parameters override defaults)
- No breaking changes to existing deployments
- Config values flow through naturally

**Trade-offs:**
- Parameters can still override config values (but this is intentional for runtime updates)
- Slightly more complex parameter definitions

### Option B: Eliminate Parameters for Library Usage

Add logic to detect library usage and bypass the parameter system:

```typescript
// Detect if we're being used as a library (no npm deployment context)
const isLibraryUsage = !process.env.BENCHLING_WEBHOOK_NPM_DEPLOY;

// Use config directly for library usage, parameters for npm deployment
const packagerQueueUrlValue = isLibraryUsage
    ? config.quilt.queueUrl
    : packagerQueueUrlParam.valueAsString;
```

**Benefits:**
- Clear separation between library and npm usage modes
- No parameter passing required for library usage

**Trade-offs:**
- More complex logic
- Harder to update values after deployment (no parameter updates)
- Magic environment variable detection

### Option C: Make Parameters Required (No Defaults)

Remove defaults entirely, forcing explicit values:

```typescript
const packagerQueueUrlParam = new cdk.CfnParameter(this, "PackagerQueueUrl", {
    type: "String",
    description: "SQS queue URL for Quilt package creation jobs",
    // NO DEFAULT - must be provided
});
```

**Benefits:**
- Forces explicit configuration
- Clear error messages when values missing

**Trade-offs:**
- **BREAKING CHANGE** - all deployments must pass parameters
- Makes library usage worse (forces workaround)
- Doesn't solve the actual problem

## Recommendation

**Implement Option A: Use Config Values as Parameter Defaults**

This is the least disruptive change that solves the library usage problem while maintaining backward compatibility with npm deployments.

## Implementation Plan

### Phase 1: Update Parameter Defaults

1. **Update all CloudFormation parameters in [lib/benchling-webhook-stack.ts](../lib/benchling-webhook-stack.ts:60-101)**
   - PackagerQueueUrl → `default: config.quilt.queueUrl || ""`
   - AthenaUserDatabase → `default: config.quilt.database || ""`
   - QuiltWebHost → `default: config.quilt.catalog || ""`
   - IcebergDatabase → `default: config.quilt.icebergDatabase || ""`
   - IcebergWorkgroup → `default: config.quilt.icebergWorkgroup || ""`
   - AthenaUserWorkgroup → `default: config.quilt.athenaUserWorkgroup || ""`
   - AthenaResultsBucket → `default: config.quilt.athenaResultsBucket || ""`

2. **Add validation for required Quilt config fields**
   ```typescript
   // In BenchlingWebhookStack constructor, after line 42
   if (!skipValidation) {
       const requiredQuiltFields = {
           'quilt.catalog': config.quilt.catalog,
           'quilt.database': config.quilt.database,
           'quilt.queueUrl': config.quilt.queueUrl,
       };

       const missingQuiltFields = Object.entries(requiredQuiltFields)
           .filter(([_, value]) => !value)
           .map(([key]) => key);

       if (missingQuiltFields.length > 0) {
           throw new Error(
               `Configuration validation failed. Required Quilt fields missing:\n` +
               missingQuiltFields.map(f => `  - ${f}`).join('\n') + '\n\n' +
               "Run 'npm run setup' to configure your deployment."
           );
       }
   }
   ```

### Phase 2: Update Documentation

1. **Update README library usage example**
   - Show that config values are used as defaults
   - Document that parameters can override config values
   - Remove workaround documentation

2. **Update CLAUDE.md**
   - Document the parameter default behavior
   - Explain when parameters override config

3. **Create migration guide** (if needed)
   - Explain that existing deployments are unaffected
   - Show that library users no longer need `--parameters` flags

### Phase 3: Add Tests

1. **Add unit test for parameter defaults**
   ```typescript
   test('CloudFormation parameters use config values as defaults', () => {
       const app = new cdk.App();
       const stack = new BenchlingWebhookStack(app, 'TestStack', {
           config: {
               quilt: {
                   catalog: 'test.quiltdata.com',
                   database: 'test_db',
                   queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/test',
                   // ...
               },
               // ... other required config
           },
       });

       const template = Template.fromStack(stack);

       // Verify parameters have correct defaults
       template.hasParameter('QuiltWebHost', {
           Default: 'test.quiltdata.com',
       });
       template.hasParameter('AthenaUserDatabase', {
           Default: 'test_db',
       });
       template.hasParameter('PackagerQueueUrl', {
           Default: 'https://sqs.us-east-1.amazonaws.com/123/test',
       });
   });
   ```

2. **Add integration test for library usage**
   - Deploy stack without passing parameters
   - Verify health check returns healthy (not degraded)
   - Verify environment variables are set correctly

### Phase 4: Backward Compatibility Verification

1. **Verify npm deployment still works**
   - Test that `npm run deploy:dev` passes parameters correctly
   - Confirm parameters override config defaults as expected

2. **Test existing stack updates**
   - Deploy to existing stack
   - Verify CloudFormation detects no changes if values unchanged
   - Verify parameter updates still work

## Success Criteria

- [ ] Library usage works without passing `--parameters` flags
- [ ] NPM deployment command continues to work unchanged
- [ ] Health check returns "healthy" (not "degraded") for library deployments
- [ ] ECS containers receive correct environment variables
- [ ] All tests pass
- [ ] Documentation updated with examples
- [ ] No breaking changes to existing deployments

## Rollout Plan

1. **v0.10.0 Release** - Include this fix
2. **Notify affected customers** - Send email with upgrade instructions
3. **Update examples** - Refresh all library usage examples in docs
4. **Monitor deployments** - Watch for any issues in first week

## Open Questions

1. Should we deprecate the parameter system entirely for library usage?
   - **Decision:** No, parameters allow runtime updates without code changes

2. Should we add CloudFormation constraints (e.g., `MinLength: 1`) to prevent empty values?
   - **Decision:** Yes, add in Phase 1 for required fields

3. Do we need a feature flag for backward compatibility?
   - **Decision:** No, this is not a breaking change

## References

- Customer bug report: "degraded" mode health check
- [lib/benchling-webhook-stack.ts](../lib/benchling-webhook-stack.ts:60-76) - Parameter definitions
- [bin/commands/deploy.ts](../bin/commands/deploy.ts:571-589) - NPM deployment command
- [lib/fargate-service.ts](../lib/fargate-service.ts:302-309) - Environment variable configuration
- [docker/src/config.py](../docker/src/config.py:83-85) - Python configuration validation
