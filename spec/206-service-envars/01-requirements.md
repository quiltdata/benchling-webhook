# Requirements: Service Environment Variables

**Issue**: #206 - Service envars

**Branch**: `206-service-envars`

**Date**: 2025-11-06

**Status**: REQUIREMENTS ANALYSIS

## Problem Statement

The current implementation passes the Quilt CloudFormation stack ARN to the Docker container, which then queries AWS CloudFormation at runtime to resolve service-specific resources (SQS queue URLs, database names, S3 bucket names, Quilt web host). This indirect approach:

1. Increases runtime complexity and latency
2. Requires CloudFormation read permissions
3. Makes configuration less transparent
4. Couples the container to CloudFormation implementation details
5. Increases failure surface area (CloudFormation API calls can fail)

## User Stories

### US-1: As a DevOps Engineer
**I want** explicit environment variables for each service dependency
**So that** I can understand and troubleshoot the container's configuration without querying AWS

**Acceptance Criteria**:
- All service URLs/ARNs are visible as environment variables in ECS task definition
- No runtime CloudFormation queries are required during normal operation
- Container startup is faster due to reduced API calls

### US-2: As a Site Reliability Engineer
**I want** the container to fail fast with clear error messages
**So that** I can quickly identify missing or misconfigured services

**Acceptance Criteria**:
- Container validates all required environment variables at startup
- Missing variables produce clear, actionable error messages
- Health check endpoint reflects configuration status

### US-3: As a Developer
**I want** the configuration to be testable locally
**So that** I can develop and debug without AWS credentials

**Acceptance Criteria**:
- Environment variables can be set via local `.env` file
- Mock values work for local development
- Tests don't require AWS API access

### US-4: As a Security Auditor
**I want** minimal IAM permissions for the ECS task
**So that** the attack surface is reduced

**Acceptance Criteria**:
- CloudFormation read permissions removed from task role
- Only service-specific permissions remain (S3, SQS, Athena, Glue, Secrets Manager)
- IAM policy follows principle of least privilege

## Acceptance Criteria

### AC-1: Environment Variable Configuration
- [ ] `PACKAGER_SQS_URL` - Full SQS queue URL for the Quilt packager
- [ ] `ATHENA_USER_DATABASE` - Athena database name for user data
- [ ] `ICEBERG_DATABASE` - Iceberg database name (optional, use if available)
- [ ] `QUILT_WEB_HOST` - Quilt catalog web host URL
- [ ] `BENCHLING_SECRET_ARN` - Secrets Manager ARN (already exists)
- [ ] `PACKAGE_BUCKET` - S3 bucket name for packages (already exists)
- [ ] All deprecated `QuiltStackARN`-related code removed

### AC-2: Breaking Change Management
- [ ] All stack ARN lookup code removed from Python application
- [ ] CloudFormation permissions removed from IAM task role
- [ ] CDK stack parameters updated to accept explicit service values
- [ ] Deployment command updated to resolve and pass service values
- [ ] Migration guide provided for existing deployments

### AC-3: Backward Compatibility
- [ ] **NOT APPLICABLE** - This is a breaking change
- [ ] Version bump to indicate breaking change (0.x.0 -> 1.0.0 or major version)
- [ ] Clear documentation of breaking changes in CHANGELOG

### AC-4: Testing and Validation
- [ ] Unit tests pass with new environment variable structure
- [ ] Integration tests verify service connectivity
- [ ] Local development works with mock environment variables
- [ ] Deployed containers start successfully with new configuration
- [ ] Health check validates all required services are accessible

### AC-5: Documentation
- [ ] README updated with new deployment instructions
- [ ] Migration guide for existing deployments
- [ ] Environment variable reference documentation
- [ ] Breaking changes clearly highlighted in CHANGELOG

## High-Level Approach

1. **Analysis Phase**: Identify all current stack ARN usage patterns
2. **Design Phase**: Define explicit environment variables for each service
3. **Implementation Phase**:
   - Update CDK infrastructure to resolve service values at deployment time
   - Update Python application to use explicit environment variables
   - Remove CloudFormation query code
   - Update IAM permissions
4. **Testing Phase**: Validate all integration points
5. **Documentation Phase**: Provide migration guidance

## Success Metrics

- **Startup Time**: Container startup reduced by removing CloudFormation API calls
- **Code Complexity**: Lines of code reduced by removing indirection
- **IAM Permissions**: CloudFormation permissions removed from task role
- **Test Coverage**: Maintain or improve 85%+ test coverage
- **Deployment Success**: 100% successful deployments in dev and prod environments

## Open Questions

1. **Q**: Should we support both old and new configuration during a transition period?
   **A**: No - this is a breaking change. Clean break is preferred.

2. **Q**: What happens to existing deployments?
   **A**: Requires redeployment with new configuration. Provide clear migration guide.

3. **Q**: Should we keep stack ARN as optional fallback?
   **A**: No - clean break reduces complexity and technical debt.

4. **Q**: How do we handle Iceberg database (optional)?
   **A**: Make environment variable optional. Use Athena as fallback if not provided.

5. **Q**: Should profile configuration schema change?
   **A**: Yes - update `ProfileConfig` interface to include explicit service fields.

## Dependencies

- AWS CDK 2.222.0+
- Python 3.11+
- Existing Quilt stack deployment
- Access to Quilt stack outputs during deployment

## Risk Assessment

**High Risk**:
- Breaking change affects all deployments
- Requires coordination with all users

**Medium Risk**:
- Configuration complexity during deployment

**Low Risk**:
- Technical implementation (straightforward refactoring)

## Notes

- This is a **BREAKING CHANGE** - version should be bumped accordingly
- Deployment command must resolve service values from Quilt stack before passing to CDK
- Consider adding validation to deployment command to verify service accessibility
