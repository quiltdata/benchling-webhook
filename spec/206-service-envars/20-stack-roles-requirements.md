# Requirements: Stack IAM Roles Discovery and Propagation

**Related Issue**: #206 - Service envars (Stack Roles Extension)

**Branch**: `206-service-envars`

**Date**: 2025-11-17

**Status**: REQUIREMENTS

## Problem Statement

The current implementation passes explicit service environment variables (QUILT_WEB_HOST, ATHENA_USER_DATABASE, PACKAGER_SQS_URL) to the Docker container, but does not provide IAM role ARNs from the Quilt stack. This prevents the container from assuming cross-account or cross-stack IAM roles for S3 bucket access.

The Quilt stack exports two critical IAM roles:

- **T4BucketReadRole** - Grants read-only access to the Quilt S3 bucket
- **T4BucketWriteRole** - Grants read-write access to the Quilt S3 bucket

These roles must be:

1. Discovered from the Quilt stack resources during deployment
2. Passed to the Docker container as environment variables
3. Assumed by boto3 when accessing S3 buckets

## Background

### Current State (v1.0.0)

- Setup wizard resolves service endpoints from Quilt stack outputs
- Deployment passes explicit service variables to container
- Container uses direct AWS credentials (task role) for S3 access
- No cross-account or cross-stack role assumption

### Desired State

- Setup wizard resolves IAM role ARNs from Quilt stack resources
- Deployment passes role ARNs as environment variables
- Container assumes roles dynamically for S3 operations
- Supports cross-account Quilt deployments

## User Stories

### US-1: As a DevOps Engineer

**I want** IAM role ARNs to be automatically discovered from the Quilt stack
**So that** I don't have to manually configure cross-account permissions

**Acceptance Criteria**:

- Setup wizard retrieves T4BucketReadRole and T4BucketWriteRole ARNs from stack resources
- Role ARNs are stored in profile configuration
- Role ARNs are validated during setup

### US-2: As a Security Administrator

**I want** S3 access to use role assumption instead of direct credentials
**So that** I can enforce least-privilege access and audit cross-account actions

**Acceptance Criteria**:

- Container assumes QUILT_READ_ROLE_ARN for S3 read operations
- Container assumes QUILT_WRITE_ROLE_ARN for S3 write operations (if needed)
- CloudTrail logs show role assumption events
- ECS task role has sts:AssumeRole permission for discovered roles

### US-3: As a Developer

**I want** boto3 calls to automatically use the correct role
**So that** I don't have to manually manage STS credentials

**Acceptance Criteria**:

- Python code transparently assumes roles when accessing S3
- Role assumption is cached for performance
- Role assumption failures produce clear error messages
- Local development works with mock roles or direct credentials

### US-4: As a Site Reliability Engineer

**I want** role ARNs to be visible in the ECS task definition
**So that** I can troubleshoot permission issues

**Acceptance Criteria**:

- QUILT_READ_ROLE_ARN visible in ECS environment variables
- QUILT_WRITE_ROLE_ARN visible in ECS environment variables
- CloudWatch logs show role assumption status at startup

## Functional Requirements

### FR-1: Stack Role Discovery

The setup wizard must discover IAM roles from Quilt stack resources:

**Discovery Method**:

- Use AWS CloudFormation `DescribeStackResources` API
- Search for resources with logical IDs:
  - `T4BucketReadRole` (Type: AWS::IAM::Role)
  - `T4BucketWriteRole` (Type: AWS::IAM::Role)

**Fallback Behavior**:

- If roles not found, emit warning but continue setup
- Container falls back to direct ECS task role credentials
- Log warning message in CloudWatch at startup

### FR-2: Configuration Storage

Role ARNs must be stored in profile configuration:

**Schema Extension** (`ProfileConfig.quilt`):

```typescript
interface QuiltConfig {
  // ... existing fields ...

  /**
   * IAM role ARN for read-only S3 access (from T4BucketReadRole)
   * Container assumes this role for S3 read operations
   * @example "arn:aws:iam::123456789012:role/quilt-stack-T4BucketReadRole-ABC123"
   */
  readRoleArn?: string;

  /**
   * IAM role ARN for read-write S3 access (from T4BucketWriteRole)
   * Container assumes this role for S3 write operations
   * @example "arn:aws:iam::123456789012:role/quilt-stack-T4BucketWriteRole-XYZ789"
   */
  writeRoleArn?: string;
}
```

**Storage Location**:

- `~/.config/benchling-webhook/{profile}/config.json`
- Fields are optional (backward compatible)

### FR-3: Deployment Propagation

Deployment must pass role ARNs to container:

**Environment Variables**:

- `QUILT_READ_ROLE_ARN` - ARN of T4BucketReadRole
- `QUILT_WRITE_ROLE_ARN` - ARN of T4BucketWriteRole

**Implementation Points**:

1. Update `lib/fargate-service.ts` to accept role ARN properties
2. Add role ARNs to `FargateServiceProps` interface
3. Add role ARNs to container environment variables (line ~290)
4. Update `bin/xdg-launch.ts` to pass role ARNs from config

### FR-4: IAM Task Role Permissions

ECS task role must have permission to assume discovered roles:

**Required Policy**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": [
        "arn:aws:iam::*:role/*-T4BucketReadRole-*",
        "arn:aws:iam::*:role/*-T4BucketWriteRole-*"
      ]
    }
  ]
}
```

**Implementation**:

- Add policy statement to task role in `lib/fargate-service.ts` (line ~126)
- Restrict Resource to known role ARN patterns for security

### FR-5: Python Role Assumption

Python code must assume roles when accessing S3:

**Implementation Strategy**:

- Create `boto3` session with assumed role credentials
- Use `sts.assume_role()` with discovered role ARN
- Cache credentials to avoid repeated STS calls
- Fall back to default credentials if role ARN not provided

**Affected Code**:

- `docker/app/services/s3_service.py` - S3 operations
- `docker/app/services/quilt_service.py` - Quilt package operations
- Add new module: `docker/app/auth/role_manager.py` - Role assumption logic

**API Design**:

```python
class RoleManager:
    """Manages AWS role assumption for cross-account access."""

    def __init__(self, read_role_arn: Optional[str], write_role_arn: Optional[str]):
        """Initialize with role ARNs from environment variables."""
        pass

    def get_s3_client(self, read_only: bool = True) -> boto3.client:
        """Get S3 client with assumed role credentials."""
        # Assumes read_role_arn if read_only=True, else write_role_arn
        # Falls back to default credentials if role ARN not provided
        # Caches credentials until expiration
        pass
```

## Non-Functional Requirements

### NFR-1: Performance

- Role assumption adds <100ms to first S3 operation
- Credentials cached for at least 15 minutes (AWS default)
- No performance impact on subsequent S3 operations

### NFR-2: Reliability

- Role assumption failures do NOT crash the container
- Container falls back to direct credentials if assumption fails
- Health check endpoint reflects role assumption status

### NFR-3: Security

- Role ARNs validated to prevent ARN injection attacks
- Trust policy on discovered roles must allow assumption by ECS task role
- CloudTrail logs all role assumption events for auditing

### NFR-4: Observability

- Log role assumption success/failure at container startup
- Log which role is used for each S3 operation (DEBUG level)
- CloudWatch metrics for role assumption failures

### NFR-5: Backward Compatibility

- Role ARNs are optional - existing deployments work without them
- Container falls back to direct credentials if roles not configured
- No breaking changes to API or configuration schema

## Acceptance Criteria

### AC-1: Discovery

- [ ] Setup wizard retrieves T4BucketReadRole ARN from stack resources
- [ ] Setup wizard retrieves T4BucketWriteRole ARN from stack resources
- [ ] Discovery works for both integrated and standalone stacks
- [ ] Discovery handles missing roles gracefully (warning, not error)

### AC-2: Configuration

- [ ] Role ARNs stored in `config.json` under `quilt.readRoleArn` and `quilt.writeRoleArn`
- [ ] Role ARNs validated as AWS IAM role ARNs (regex pattern)
- [ ] Configuration schema updated with new fields
- [ ] TypeScript types updated in `lib/types/config.ts`

### AC-3: Deployment

- [ ] `QUILT_READ_ROLE_ARN` passed to container environment
- [ ] `QUILT_WRITE_ROLE_ARN` passed to container environment
- [ ] ECS task role has `sts:AssumeRole` permission for discovered roles
- [ ] Environment variables visible in ECS task definition

### AC-4: Runtime

- [ ] Python code assumes read role for S3 read operations
- [ ] Python code falls back to direct credentials if role not configured
- [ ] Credentials cached to avoid repeated STS calls
- [ ] Role assumption failures logged with actionable error messages

### AC-5: Testing

- [ ] Unit tests for role discovery logic
- [ ] Unit tests for role assumption logic
- [ ] Integration tests verify S3 access with assumed roles
- [ ] Local development works without role ARNs (fallback to direct credentials)

### AC-6: Documentation

- [ ] CLAUDE.md updated with role discovery feature
- [ ] README updated with role configuration instructions
- [ ] Python docstrings explain role assumption logic
- [ ] CDK construct comments explain IAM permissions

## Implementation Approach

### Phase 1: Discovery (Setup Wizard)

1. Add `DescribeStackResources` call to `bin/xdg-launch.ts` (or new module)
2. Search for `T4BucketReadRole` and `T4BucketWriteRole` logical IDs
3. Extract physical resource IDs (role ARNs)
4. Store in `ProfileConfig.quilt.readRoleArn` and `writeRoleArn`
5. Validate ARN format before saving

### Phase 2: Propagation (CDK Stack)

1. Update `FargateServiceProps` interface with role ARN properties
2. Update `lib/fargate-service.ts` to accept role ARNs
3. Add role ARNs to container environment variables
4. Add `sts:AssumeRole` policy to ECS task role
5. Update `bin/xdg-launch.ts` to pass role ARNs from config

### Phase 3: Assumption (Python Application)

1. Create `docker/app/auth/role_manager.py` module
2. Implement credential caching with expiration
3. Update `s3_service.py` to use `RoleManager.get_s3_client()`
4. Add startup validation for role ARNs
5. Add CloudWatch logging for role assumption events

### Phase 4: Testing & Documentation

1. Write unit tests for all new modules
2. Write integration tests for cross-account S3 access
3. Update documentation files
4. Test local development fallback behavior

## Open Questions

### Q1: Should we support write operations?

**Decision**: Yes, but optional. Many use cases only need read access.

- If `QUILT_WRITE_ROLE_ARN` not provided, fall back to read role or direct credentials
- Clearly document which operations require write access

### Q2: Should we cache credentials in memory or filesystem?

**Decision**: Memory only (for security).

- Filesystem caching risks credential leakage
- Memory caching sufficient for container lifetime
- Use `botocore.credentials.RefreshableCredentials` for automatic refresh

### Q3: What if roles don't exist in stack?

**Decision**: Treat as optional feature, not error.

- Emit warning during setup if roles not found
- Log warning at container startup if role ARNs not configured
- Fall back to direct ECS task role credentials

### Q4: Should we validate trust relationships during setup?

**Decision**: No, too complex for setup wizard.

- Trust relationship validation requires `iam:GetRole` permission
- Deployment will fail anyway if trust relationship is wrong
- Better to fail fast at deployment time with clear error

### Q5: Should we assume roles for non-S3 operations?

**Decision**: No, only S3 for now.

- SQS, Athena, Glue, Secrets Manager use direct task role credentials
- S3 is the only service requiring cross-account access
- Future enhancement: support custom role ARNs for other services

## Risk Assessment

**High Risk**:

- Role assumption failures could break production deployments
- Mitigation: Fallback to direct credentials, comprehensive testing

**Medium Risk**:

- Credential caching bugs could cause intermittent failures
- Mitigation: Use proven `botocore` credential refresh mechanism

**Low Risk**:

- Configuration schema changes (additive only, backward compatible)
- Discovery failures (non-fatal, clear warnings)

## Dependencies

- AWS CloudFormation API access (`cloudformation:DescribeStackResources`)
- AWS STS API access (`sts:AssumeRole`)
- Quilt stack with T4BucketReadRole and T4BucketWriteRole resources
- boto3 >= 1.28.0 (for modern credential handling)

## Success Metrics

- **Setup Time**: Role discovery adds <2 seconds to setup wizard
- **Startup Time**: Role assumption adds <100ms to container startup
- **Failure Rate**: <1% role assumption failures in production
- **Test Coverage**: 90%+ coverage for new role management code
- **Documentation**: Clear examples for both integrated and standalone modes

## Notes

- This is a **non-breaking change** - role ARNs are optional
- Existing deployments continue to work without modification
- Feature enables cross-account Quilt deployments
- Role ARNs can be manually configured if stack discovery fails
