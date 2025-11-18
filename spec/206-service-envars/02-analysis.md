# Analysis: Current State and Challenges

**Issue**: #206 - Service envars

**Branch**: `206-service-envars`

**Date**: 2025-11-06

**Status**: CURRENT STATE ANALYSIS

## Executive Summary

The current architecture uses a "secrets-only" approach where the container receives only two parameters:
1. `QuiltStackARN` - CloudFormation stack ARN
2. `BenchlingSecret` - AWS Secrets Manager ARN

The container then queries CloudFormation at runtime to resolve all service endpoints and configuration. This analysis examines the current implementation, identifies limitations, and assesses the scope of changes required.

## Current Architecture

### 1. Configuration Flow

```
Deployment Time:
  CDK Stack → Creates ECS Task → Sets Environment Variables:
    - QuiltStackARN
    - BenchlingSecret
    - BENCHLING_TENANT (static)
    - BENCHLING_PKG_BUCKET (static)
    - AWS_REGION
    - LOG_LEVEL

Runtime (Container Startup):
  Container → ConfigResolver → CloudFormation API → Stack Outputs:
    - PackagerQueueUrl
    - UserAthenaDatabaseName
    - UserBucket / BucketName
    - Catalog / CatalogDomain / ApiGatewayEndpoint
```

### 2. Key Files and Components

#### TypeScript/CDK Layer

**`lib/benchling-webhook-stack.ts`** (Lines 58-102):
- Creates CloudFormation parameters for:
  - `QuiltStackARN` (default from config)
  - `BenchlingSecretARN` (default from config)
  - `LogLevel`
  - `ImageTag`
  - `PackageBucket`
  - `QuiltDatabase`
- Passes `QuiltStackARN` to Fargate service

**`lib/fargate-service.ts`** (Lines 215-230):
- Sets environment variables in task definition:
  - `QuiltStackARN` (runtime parameter)
  - `BenchlingSecret` (runtime parameter)
  - Static configuration values
- Grants CloudFormation permissions (Lines 85-93):
  ```typescript
  taskRole.addToPolicy(
    new iam.PolicyStatement({
      actions: [
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackResources",
      ],
      resources: [props.stackArn],
    }),
  );
  ```

**`lib/utils/config-resolver.ts`** (Complete file):
- `ConfigResolver` class - main resolution logic
- `parseStackArn()` - extracts region/account/stack name
- `extractStackOutputs()` - queries CloudFormation for outputs
- `resolveAndFetchSecret()` - queries Secrets Manager
- Validates required outputs:
  - `UserAthenaDatabaseName`
  - `PackagerQueueUrl`
  - One of: `Catalog`, `CatalogDomain`, `ApiGatewayEndpoint`

**`lib/types/config.ts`** (Lines 116-151):
- `QuiltConfig` interface includes:
  - `stackArn` (currently required)
  - `catalog`
  - `database`
  - `queueUrl`
  - `region`

**`bin/commands/deploy.ts`** (Lines 104-159):
- Retrieves `stackArn` from profile config
- Passes to CDK via CloudFormation parameters
- Validates stack ARN format

#### Python/Container Layer

Currently, Python code would use the resolved configuration from the TypeScript `ConfigResolver`, but the actual Python implementation files need to be located and analyzed.

### 3. CloudFormation Stack Outputs Required

From `config-resolver.ts` validation logic:

**Required Outputs**:
- `UserAthenaDatabaseName` - Athena database for user data
- `PackagerQueueUrl` or `QueueUrl` - SQS queue URL
- One of: `Catalog`, `CatalogDomain`, or `ApiGatewayEndpoint` - Catalog URL

**Optional Outputs**:
- `UserBucket` or `BucketName` - S3 bucket name
- (Iceberg database not currently supported)

### 4. IAM Permissions (Current)

**Task Execution Role** (`lib/fargate-service.ts` Lines 69-77):
- ECS image pull and CloudWatch Logs write

**Task Role** (`lib/fargate-service.ts` Lines 79-202):
- CloudFormation read (Lines 85-93) **← TO BE REMOVED**
- Secrets Manager read (Lines 98-109)
- S3 access (Lines 114-137)
- SQS access (Lines 141-151)
- Glue access (Lines 156-169)
- Athena access (Lines 174-185)
- S3 for Athena results (Lines 188-202)

## Current Code Idioms and Patterns

### 1. Configuration Management

**Pattern**: Profile-based configuration with XDG directory structure
- Location: `~/.config/benchling-webhook/{profile}/`
- Files: `config.json`, `deployments.json`
- Schema version: `0.7.0`

**Inheritance**: Profiles support `_inherits` for hierarchical configuration

### 2. CloudFormation Parameters

**Pattern**: Runtime-configurable parameters with config defaults
```typescript
const param = new cdk.CfnParameter(this, "ParamName", {
  type: "String",
  description: "...",
  default: config.fieldValue,
});
```

### 3. Environment Variable Naming

**Current Convention**:
- Pascal case for CloudFormation parameters: `QuiltStackARN`, `BenchlingSecret`
- UPPER_SNAKE_CASE for container env vars: `AWS_REGION`, `LOG_LEVEL`
- Mixed approach for Benchling: `BENCHLING_TENANT`, `BENCHLING_PKG_BUCKET`

### 4. Validation and Error Handling

**Pattern**: Custom error classes with formatted output
```typescript
class ConfigResolverError extends Error {
  format(): string {
    // Returns formatted error with suggestions
  }
}
```

### 5. Testing Structure

**Makefile-driven** (`docker/Makefile`):
- `test-unit` - pytest unit tests
- `test-local` - local server tests
- `test-dev` - Docker dev container tests
- `test-deployed-dev` - deployed stack tests
- Profile-aware: `make test-local PROFILE=sales`

## Current System Constraints

### 1. Runtime Dependencies

- **CloudFormation API**: Required for every container cold start
- **Secrets Manager API**: Required for every container cold start
- **Network Latency**: API calls add 100-500ms to startup time
- **API Rate Limits**: CloudFormation throttling possible with many containers

### 2. Permissions Overhead

- Containers require CloudFormation read access
- Broad permissions to entire stack (vs. specific resources)
- Difficult to apply least privilege principle

### 3. Configuration Opacity

- Actual runtime configuration not visible in ECS console
- Debugging requires CloudFormation API access
- No clear audit trail of resolved values

### 4. Testing Complexity

- Local development requires mocking CloudFormation
- Integration tests need real AWS resources
- Cannot test configuration resolution in isolation

### 5. Deployment Coupling

- Container must match Quilt stack version/structure
- Stack output changes break container
- No versioning of configuration schema

## Identified Gaps and Challenges

### Gap 1: Missing Environment Variables

Required but not currently passed explicitly:
- ❌ `PACKAGER_SQS_URL` - SQS queue URL for packager
- ❌ `ATHENA_USER_DATABASE` - Athena database name
- ❌ `ICEBERG_DATABASE` - Iceberg database (optional)
- ❌ `QUILT_WEB_HOST` - Quilt catalog URL

Currently passed implicitly via stack ARN lookup.

### Gap 2: Configuration Resolution Timing

**Current**: Runtime resolution (cold start penalty)
**Desired**: Deployment-time resolution (one-time cost)

### Gap 3: IAM Permission Granularity

**Current**: CloudFormation read access to entire stack
**Desired**: Only service-specific permissions (S3, SQS, Athena, Glue)

### Gap 4: Configuration Validation

**Current**: Validation happens at container startup (fails in production)
**Desired**: Validation happens at deployment time (fails before deployment)

### Gap 5: Local Development

**Current**: Requires AWS credentials or complex mocking
**Desired**: Simple environment variable configuration

## Technical Debt Identified

### 1. ConfigResolver Class

**Location**: `lib/utils/config-resolver.ts`
**Size**: 440 lines
**Status**: **TO BE DEPRECATED**

Key methods to be removed:
- `parseStackArn()` - May be kept for deployment-time use
- `extractStackOutputs()` - Move to deployment command
- `resolve()` - Primary resolution logic (remove)
- `validateRequiredOutputs()` - Move to deployment validation
- `resolveCatalogUrl()` - Move to deployment command

### 2. Environment Variable Passing

**Location**: `lib/fargate-service.ts` Lines 215-230
**Issue**: Mixed configuration approach (some explicit, some via stack ARN)

### 3. Profile Configuration Schema

**Location**: `lib/types/config.ts`
**Issue**: `stackArn` is required but should become optional or removed

### 4. Deployment Command

**Location**: `bin/commands/deploy.ts`
**Issue**: Passes stack ARN but doesn't resolve service values

## Architectural Challenges

### Challenge 1: Breaking Change Management

**Impact**: All existing deployments must be updated
**Mitigation**:
- Clear version bump (0.x → 1.0 or major version)
- Migration guide with examples
- Deployment-time validation

### Challenge 2: Backward Compatibility

**Decision**: Clean break preferred over gradual migration
**Rationale**:
- Reduces code complexity
- Eliminates confusion about which approach is active
- Forces explicit configuration updates

### Challenge 3: Configuration Schema Evolution

**Current**: `QuiltConfig` includes `stackArn`
**Future**: Add explicit service fields, make `stackArn` optional

**Proposed Schema**:
```typescript
interface QuiltConfig {
  // Keep for deployment-time resolution
  stackArn?: string;

  // New explicit fields
  catalog: string;
  database: string;
  queueUrl: string;
  region: string;

  // Optional Iceberg support
  icebergDatabase?: string;
}
```

### Challenge 4: Deployment Command Enhancement

**Current**: Simple pass-through of configuration
**Future**: Must resolve stack outputs and validate services

**Required Changes**:
1. Query CloudFormation stack at deployment time
2. Validate all required outputs exist
3. Optionally verify service accessibility
4. Pass resolved values as CloudFormation parameters

### Challenge 5: Testing Strategy

**Unit Tests**: Must work without AWS
**Integration Tests**: Must validate actual service connectivity
**E2E Tests**: Must work with deployed infrastructure

## Dependencies and Integration Points

### Upstream Dependencies

1. **Quilt Stack CloudFormation Outputs**:
   - Must export required output keys
   - Version compatibility considerations
   - Schema changes require coordination

2. **AWS Services**:
   - SQS queue must exist and be accessible
   - Athena database must exist
   - S3 bucket must exist
   - Iceberg database (optional)

### Downstream Impacts

1. **Existing Deployments**:
   - Requires redeployment with new configuration
   - Cannot be updated via CloudFormation parameter update alone
   - Profile configuration must be updated

2. **CI/CD Pipelines**:
   - May need updates for configuration resolution
   - Testing strategies may need adjustment

3. **Documentation**:
   - README requires updates
   - Migration guide required
   - Example configurations need updating

## Risk Assessment

### High Risk Areas

1. **Breaking Changes**:
   - All users must update simultaneously
   - No gradual migration path
   - **Mitigation**: Clear communication, versioning, migration guide

2. **Service Resolution Failures**:
   - Deployment fails if services not accessible
   - More complex deployment command
   - **Mitigation**: Clear error messages, pre-flight validation

### Medium Risk Areas

1. **Configuration Complexity**:
   - More environment variables to manage
   - Profile schema changes
   - **Mitigation**: Automatic resolution in deployment command

2. **Testing Coverage**:
   - More surface area to test
   - Service connectivity tests needed
   - **Mitigation**: Comprehensive test suite updates

### Low Risk Areas

1. **IAM Permission Removal**:
   - CloudFormation permissions no longer needed
   - **Benefit**: Improved security posture

2. **Performance Improvement**:
   - Faster container startup
   - **Benefit**: Better user experience

## Recommendations for Design Phase

### 1. Configuration Resolution Strategy

**Recommendation**: Resolve at deployment time, cache in CloudFormation parameters

**Approach**:
```
deploy command → query CloudFormation → validate services →
  create parameters → CDK deploy → container receives explicit env vars
```

### 2. Environment Variable Naming

**Recommendation**: Consistent UPPER_SNAKE_CASE convention

**Proposed Names**:
- `PACKAGER_SQS_URL` (not `QUEUE_URL` - more explicit)
- `ATHENA_USER_DATABASE` (not just `DATABASE`)
- `ICEBERG_DATABASE` (optional, clear purpose)
- `QUILT_WEB_HOST` (matches existing pattern)

### 3. Profile Configuration Update

**Recommendation**: Update `QuiltConfig` to include explicit fields, make `stackArn` optional

**Transition**:
- Phase 1: Add new fields, keep `stackArn` as optional
- Phase 2: Deployment command uses `stackArn` if present to populate fields
- Phase 3: Runtime uses explicit fields only

### 4. Error Handling

**Recommendation**: Fail fast at deployment time, not runtime

**Validation Points**:
- Deployment command validates stack outputs exist
- CDK validates CloudFormation parameters
- Container validates environment variables at startup
- Health check validates service connectivity

### 5. Testing Strategy

**Recommendation**: Multi-layer testing approach

**Layers**:
- Unit tests with mocked AWS (no changes needed)
- Local tests with explicit env vars (simplified)
- Integration tests with real services (enhanced)
- Deployment tests with full validation (new)

## Code Removal Checklist

### Files to Remove/Deprecate

- [ ] `lib/utils/config-resolver.ts` - Entire file (440 lines)
  - May keep `parseStackArn()` for deployment command
  - May keep error classes for reuse

### Code Sections to Remove

- [ ] `lib/fargate-service.ts` Lines 85-93 - CloudFormation IAM permissions
- [ ] `lib/fargate-service.ts` Lines 223-224 - Stack ARN environment variable
- [ ] `lib/benchling-webhook-stack.ts` Lines 58-62 - QuiltStackARN parameter (move to deployment)

### Code Sections to Update

- [ ] `lib/types/config.ts` - Update `QuiltConfig` interface
- [ ] `lib/fargate-service.ts` Lines 215-230 - Environment variable configuration
- [ ] `bin/commands/deploy.ts` - Add service resolution logic
- [ ] `lib/benchling-webhook-stack.ts` - Add new CloudFormation parameters

## Conclusion

The current architecture achieves runtime configuration flexibility at the cost of:
- Startup latency
- Runtime complexity
- Broader IAM permissions
- Configuration opacity
- Testing complexity

Moving to explicit environment variables will:
- ✅ Improve startup time (remove API calls)
- ✅ Simplify runtime code (remove ConfigResolver)
- ✅ Enhance security (remove CloudFormation permissions)
- ✅ Increase transparency (visible in ECS console)
- ✅ Simplify testing (no CloudFormation mocking)

This is a significant but worthwhile refactoring that aligns with best practices for container configuration and security.

## Next Steps

Proceed to **Specifications** phase to define:
1. Desired end state architecture
2. Environment variable specifications
3. Deployment command enhancements
4. Configuration schema updates
5. Success criteria and validation
