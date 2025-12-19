# Specifications: Explicit Service Environment Variables

**Issue**: #206 - Service envars

**Branch**: `206-service-envars`

**Date**: 2025-11-06

**Status**: ENGINEERING SPECIFICATIONS

## Overview

This specification defines the desired end state for replacing stack ARN-based runtime configuration resolution with explicit service environment variables. The goal is to improve startup performance, security, and operational transparency by resolving configuration at deployment time rather than container startup.

## Goals

### Primary Goals

1. **Eliminate Runtime CloudFormation Queries**: Remove all CloudFormation API calls from container startup
2. **Explicit Service Configuration**: Pass individual service endpoints as environment variables
3. **Enhanced Security**: Remove CloudFormation read permissions from ECS task role
4. **Improved Observability**: Make all configuration visible in ECS task definition
5. **Faster Startup**: Reduce container cold start time by eliminating API calls

### Secondary Goals

1. **Simplified Testing**: Enable local development with simple environment variables
2. **Clear Error Messages**: Fail fast at deployment time with actionable errors
3. **Configuration Transparency**: Audit trail of resolved service values
4. **Flexible Architecture**: Support both Athena and Iceberg databases

## Desired End State Architecture

### Configuration Flow

```
Deployment Time:
  Profile Config → Deployment Command → CloudFormation API → Resolve Services:
    - PackagerQueueUrl
    - UserAthenaDatabaseName
    - Catalog URL
    - (Optional) IcebergDatabase
  → Validate Services → CDK Deploy → CloudFormation Parameters →
    ECS Task Definition → Explicit Environment Variables

Runtime:
  Container Startup → Read Environment Variables → Validate Required →
    Start Application (no AWS API calls needed)
```

### Environment Variables (Container)

All service configuration passed as explicit environment variables:

**AWS Infrastructure**:
- `AWS_REGION` (existing)
- `AWS_DEFAULT_REGION` (existing)

**Quilt Services**:
- `PACKAGER_SQS_URL` - Full SQS queue URL (e.g., `https://sqs.us-east-1.amazonaws.com/123456789012/packager-queue`)
- `ATHENA_USER_DATABASE` - Athena database name for user data
- `ICEBERG_DATABASE` - (Optional) Iceberg database name, if available
- `QUILT_WEB_HOST` - Quilt catalog domain (hostname only, no protocol)

**Benchling Configuration**:
- `BENCHLING_SECRET_ARN` - Secrets Manager ARN (existing, renamed from `BenchlingSecret`)
- `BENCHLING_TENANT` (existing)
- `PACKAGE_BUCKET` - S3 bucket name (existing as `BENCHLING_PKG_BUCKET`)
- `PACKAGE_PREFIX` - S3 key prefix (existing as `BENCHLING_PKG_PREFIX`)
- `PACKAGE_METADATA_KEY` - Metadata key (existing as `BENCHLING_PKG_KEY`)

**Application Configuration**:
- `FLASK_ENV` (existing)
- `LOG_LEVEL` (existing)
- `ENABLE_WEBHOOK_VERIFICATION` (existing)
- `BENCHLING_WEBHOOK_VERSION` (existing)

**Deprecated/Removed**:
- ~~`QuiltStackARN`~~ - No longer passed to container

### CloudFormation Parameters (CDK Stack)

Parameters for runtime-configurable deployment values:

**Required Parameters**:
- `PackagerQueueUrl` - SQS queue URL for Quilt packager
- `AthenaUserDatabase` - Athena database name
- `QuiltWebHost` - Quilt catalog hostname
- `BenchlingSecretArn` - Secrets Manager ARN for Benchling credentials
- `PackageBucket` - S3 bucket for packages
- `LogLevel` - Application log level
- `ImageTag` - Docker image tag

**Optional Parameters**:
- `IcebergDatabase` - Iceberg database name (empty string if not available)
- `QuiltDatabase` - Alias for backward compatibility (deprecated)

### Profile Configuration Schema

Update `QuiltConfig` interface in `lib/types/config.ts`:

```typescript
interface QuiltConfig {
  /**
   * Quilt CloudFormation stack ARN (optional, for deployment-time resolution)
   * Used by deployment command to resolve service endpoints.
   * Not passed to container.
   */
  stackArn?: string;

  /**
   * Quilt catalog domain (without protocol)
   * Resolved from stack outputs or specified explicitly
   */
  catalog: string;

  /**
   * Athena/Glue database name for catalog metadata
   * Resolved from stack UserAthenaDatabaseName output
   */
  database: string;

  /**
   * SQS queue URL for package creation jobs
   * Resolved from stack PackagerQueueUrl output
   */
  queueUrl: string;

  /**
   * AWS region for Quilt resources
   */
  region: string;

  /**
   * (Optional) Iceberg database name
   * Resolved from stack IcebergDatabase output if available
   */
  icebergDatabase?: string;
}
```

## Architectural Principles

### Principle 1: Deployment-Time Resolution

**Specification**: All service endpoints must be resolved at deployment time, not runtime

**Implementation**:
- Deployment command queries CloudFormation for stack outputs
- Validates all required outputs are present
- Passes resolved values as CDK context or CloudFormation parameters
- CDK creates environment variables in task definition

### Principle 2: Fail Fast

**Specification**: Configuration errors must be caught at deployment time

**Validation Points**:
1. **Pre-deployment**: Profile configuration validation
2. **Deployment command**: Stack output validation
3. **CDK synthesis**: Parameter validation
4. **Container startup**: Environment variable validation
5. **Health check**: Service connectivity validation

### Principle 3: Explicit Over Implicit

**Specification**: Configuration must be visible and auditable

**Requirements**:
- All service endpoints visible in ECS task definition
- CloudWatch logs show configuration at startup
- Deployment output displays all resolved values
- No hidden runtime resolution

### Principle 4: Least Privilege

**Specification**: ECS task role must have minimal required permissions

**Permissions**:
- ✅ Secrets Manager read (specific secret ARN)
- ✅ S3 read/write (specific bucket)
- ✅ SQS send message (specific queue)
- ✅ Athena query execution (specific workgroup)
- ✅ Glue database read (specific database)
- ❌ CloudFormation read (REMOVED)

### Principle 5: Testability

**Specification**: All components must be testable without AWS

**Requirements**:
- Local development uses simple environment variables
- Unit tests mock AWS services
- Integration tests validate service connectivity
- No required AWS API calls for basic functionality

## Integration Points

### Integration Point 1: Quilt Stack Outputs

**Required CloudFormation Outputs**:

| Output Key | Purpose | Example Value |
| ------------ | --------- | --------------- |
| `PackagerQueueUrl` | SQS queue for package creation | `https://sqs.us-east-1.amazonaws.com/123456789012/packager-queue` |
| `UserAthenaDatabaseName` | Athena database for user data | `quilt_user_catalog` |
| `Catalog` or `CatalogDomain` or `ApiGatewayEndpoint` | Catalog web host | `quilt.example.com` or `https://api.execute-api.us-east-1.amazonaws.com` |

**Optional CloudFormation Outputs**:

| Output Key | Purpose | Example Value |
| ------------ | --------- | --------------- |
| `IcebergDatabase` | Iceberg database name | `quilt_iceberg_catalog` |
| `UserBucket` or `BucketName` | S3 bucket name (if not in profile) | `quilt-packages-prod` |

**Compatibility**: Support multiple output key names for backward compatibility with different Quilt stack versions

### Integration Point 2: AWS Secrets Manager

**Secret Structure**: (No changes from current implementation)

```json
{
  "client_id": "client_...",
  "client_secret": "secret_...",
  "tenant": "my-company",
  "app_definition_id": "app_...",
  "api_url": "https://my-company.benchling.com/api/v2"
}
```

### Integration Point 3: Deployment Command

**New Responsibilities**:
1. Query CloudFormation stack for outputs
2. Validate required outputs present
3. Normalize catalog URL (extract hostname)
4. Validate SQS queue URL format
5. Pass resolved values to CDK

**Interface**:

```typescript
interface ResolvedServices {
  packagerQueueUrl: string;
  athenaUserDatabase: string;
  quiltWebHost: string;
  icebergDatabase?: string;
  packageBucket?: string;
}

async function resolveQuiltServices(
  stackArn: string,
  region: string
): Promise<ResolvedServices>
```

### Integration Point 4: CDK Stack

**New CloudFormation Parameters**:
- `PackagerQueueUrl` (replaces stack ARN lookup)
- `AthenaUserDatabase` (new, explicit)
- `QuiltWebHost` (new, explicit)
- `IcebergDatabase` (new, optional)

**Updated Environment Variables**:
- Map parameters to container environment variables
- Remove `QuiltStackARN` variable
- Add new service-specific variables

### Integration Point 5: ECS Task Role

**Updated IAM Permissions**:
- Remove CloudFormation read permissions
- Keep all service-specific permissions
- Add explicit resource ARNs where possible

## Quality Attributes

### Performance

**Target**: Container cold start < 5 seconds (reduced from ~7 seconds)

**Measurement**:
- ECS task start time to healthy state
- Health check response time
- First request latency

**Validation**:
- CloudWatch Container Insights metrics
- Load testing with multiple concurrent starts

### Security

**Target**: Zero CloudFormation permissions in task role

**Measurement**:
- IAM policy review
- Least privilege validation
- Attack surface analysis

**Validation**:
- IAM Access Analyzer
- Policy simulation
- Security audit

### Observability

**Target**: 100% configuration visibility in ECS console

**Measurement**:
- Count of environment variables in task definition
- Configuration audit trail completeness

**Validation**:
- Manual review of ECS task definition
- CloudWatch Logs inspection
- Configuration change tracking

### Reliability

**Target**: 99.9% deployment success rate

**Measurement**:
- Deployment success/failure count
- Rollback frequency
- Error categorization

**Validation**:
- Deployment metrics tracking
- Error log analysis
- Canary deployments

### Maintainability

**Target**: 25% reduction in configuration-related code

**Measurement**:
- Lines of code removed (ConfigResolver: ~440 lines)
- Cyclomatic complexity reduction
- Test code simplification

**Validation**:
- Code review
- Static analysis metrics
- Test coverage reports

## Success Criteria

### Functional Criteria

1. ✅ **Container starts without CloudFormation API calls**
   - Validation: CloudWatch Logs show no CloudFormation requests
   - Measurement: AWS CloudTrail analysis

2. ✅ **All service endpoints configurable via environment variables**
   - Validation: Manual testing with different configurations
   - Measurement: Integration test coverage

3. ✅ **Deployment command resolves services successfully**
   - Validation: Deployment logs show resolved values
   - Measurement: Deployment success rate

4. ✅ **IAM permissions follow least privilege**
   - Validation: IAM Access Analyzer findings = 0
   - Measurement: Permission count reduction

5. ✅ **Configuration visible in ECS console**
   - Validation: Manual review of task definition
   - Measurement: Environment variable count

### Non-Functional Criteria

1. ✅ **Startup time reduced by ≥20%**
   - Current: ~7 seconds to healthy
   - Target: <5 seconds to healthy
   - Measurement: CloudWatch Container Insights

2. ✅ **Code complexity reduced**
   - Remove ConfigResolver (~440 lines)
   - Simplify Fargate service configuration
   - Measurement: Lines of code diff

3. ✅ **Test coverage maintained at ≥85%**
   - Unit tests
   - Integration tests
   - E2E tests
   - Measurement: Coverage reports

4. ✅ **Zero breaking changes to runtime behavior**
   - Same functionality with different configuration approach
   - Measurement: Integration test parity

5. ✅ **Clear migration path documented**
   - Migration guide with examples
   - Breaking change announcement
   - Measurement: User feedback, deployment success

## Constraints and Assumptions

### Constraints

1. **Breaking Change**: This is a major version bump
   - Users must redeploy with new configuration
   - No gradual migration support

2. **Quilt Stack Dependency**: Requires specific CloudFormation outputs
   - Must coordinate with Quilt stack versioning
   - May require Quilt stack updates

3. **AWS SDK Dependency**: Deployment command needs CloudFormation client
   - Already available in current implementation
   - No new dependencies required

4. **Profile Configuration Update**: Requires profile schema changes
   - Users must update profiles or re-run setup wizard
   - Auto-migration not feasible

### Assumptions

1. **Quilt Stack Availability**: Stack outputs are available at deployment time
   - Assumption: Stack is deployed and accessible
   - Validation: Pre-flight check in deployment command

2. **Service Stability**: Service endpoints don't change frequently
   - Assumption: SQS URL, database names are stable
   - Impact: Redeployment required for changes

3. **Network Connectivity**: Deployment machine can reach AWS APIs
   - Assumption: CloudFormation API accessible
   - Validation: Network connectivity check

4. **Permission Model**: Deployment credentials have CloudFormation read access
   - Assumption: CI/CD or user has sufficient permissions
   - Validation: IAM permission check

## Technical Decisions

### Decision 1: Deployment-Time vs Runtime Resolution

**Decision**: Resolve at deployment time

**Rationale**:
- Faster container startup (remove API calls)
- Better security (remove CloudFormation permissions)
- Improved observability (visible in ECS)
- Fail fast (errors at deployment, not runtime)

**Trade-offs**:
- Redeployment required for configuration changes
- More complex deployment command

### Decision 2: Environment Variable Naming

**Decision**: UPPER_SNAKE_CASE with descriptive names

**Rationale**:
- Consistent with existing patterns (`AWS_REGION`, `LOG_LEVEL`)
- Clear and unambiguous
- Follows 12-factor app conventions

**Examples**:
- `PACKAGER_SQS_URL` (not `QUEUE_URL`)
- `ATHENA_USER_DATABASE` (not `DATABASE`)
- `ICEBERG_DATABASE` (clear optional purpose)
- `QUILT_WEB_HOST` (clear domain reference)

### Decision 3: Optional Iceberg Support

**Decision**: Make Iceberg database optional

**Rationale**:
- Not all Quilt stacks have Iceberg
- Graceful degradation to Athena
- Future-proof for Iceberg adoption

**Implementation**:
- Environment variable defaults to empty string
- Container checks for non-empty value
- Falls back to Athena if not available

### Decision 4: Stack ARN Retention

**Decision**: Keep `stackArn` in profile config as optional field

**Rationale**:
- Deployment command needs it for resolution
- Not passed to container
- Allows profile-based configuration

**Migration Path**:
- Existing profiles keep `stackArn`
- Deployment command uses it if present
- Future: Could be removed if services specified explicitly

### Decision 5: Breaking Change Approach

**Decision**: Clean break, no backward compatibility

**Rationale**:
- Reduces code complexity
- Eliminates confusion
- Forces explicit configuration
- Aligns with major version bump

**Mitigation**:
- Clear version bump (e.g., 0.8.0 → 1.0.0)
- Comprehensive migration guide
- Breaking change announcement
- Deployment-time validation

## Open Technical Questions

**(None remaining - all questions answered in requirements)**

## Non-Goals

This specification explicitly does NOT include:

1. **Backward Compatibility**: No support for old configuration approach
2. **Automatic Migration**: No auto-update of existing deployments
3. **Dynamic Configuration**: No runtime configuration changes
4. **Service Discovery**: No automatic service endpoint discovery
5. **Configuration UI**: No graphical configuration tool
6. **Multi-Region**: No cross-region service resolution

## Next Steps

Proceed to **Phases** document to define:
1. Implementation breakdown
2. Incremental PR strategy
3. Testing strategy per phase
4. Risk mitigation per phase
5. Rollback procedures
