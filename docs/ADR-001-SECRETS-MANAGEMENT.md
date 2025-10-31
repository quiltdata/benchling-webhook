# ADR-001: Unified Secrets Management Approach

**Status**: Accepted
**Date**: 2025-10-30
**Decision Makers**: Engineering Team
**Related Issue**: #156

---

## Context

The Benchling Webhook integration requires Benchling API credentials (client ID, client secret, tenant) to authenticate requests. The original implementation had several limitations:

### Problems with Original Approach

1. **Multiple Parameters**: Required 3-4 separate CLI parameters (`--tenant`, `--client-id`, `--client-secret`, `--app-id`)
2. **Complexity**: Users had to remember and configure multiple parameters
3. **CloudFormation Exposure**: Individual parameters visible in CloudFormation (even with `noEcho`)
4. **Maintenance Burden**: Code had to handle each parameter separately
5. **Error-Prone**: Easy to forget one parameter during deployment
6. **No Centralization**: Secrets scattered across environment variables and parameters

### Requirements

1. Simplify user experience - single configuration point
2. Support AWS Secrets Manager for enterprise security
3. Maintain backward compatibility during transition
4. Enable secret rotation without redeployment
5. Prevent secret exposure in logs and CloudFormation
6. Support multiple deployment scenarios (standalone, Quilt integration)
7. Provide clear migration path from old approach

---

## Decision

We will implement a **unified secrets management approach** with the following characteristics:

### 1. Single Parameter: `BENCHLING_SECRETS`

Replace multiple individual parameters with one consolidated parameter:

**Old Approach** (Deprecated):
```bash
--tenant company \
--client-id xxx \
--client-secret yyy \
--app-id zzz
```

**New Approach** (v0.6.0+):
```bash
--benchling-secrets '{"client_id":"xxx","client_secret":"yyy","tenant":"company"}'
```

### 2. Multiple Input Formats

Support three input formats for flexibility:

#### Format A: JSON String
```bash
--benchling-secrets '{"client_id":"xxx","client_secret":"yyy","tenant":"company"}'
```

#### Format B: JSON File Reference
```bash
--benchling-secrets @secrets.json
```

#### Format C: AWS Secrets Manager ARN
```bash
--benchling-secrets arn:aws:secretsmanager:us-east-1:123456789012:secret:name
```

### 3. Automatic Format Detection

The CLI detects format based on content:
- Starts with `arn:aws:secretsmanager:` → ARN format
- Starts with `@` → File reference
- Starts with `{` → JSON string
- Otherwise → JSON string (will fail validation)

### 4. Secrets Manager Integration

All secrets stored in AWS Secrets Manager (`benchling-webhook/credentials`):
- **ARN format**: Reference existing secret (no creation)
- **JSON format**: Create/update secret in Secrets Manager
- ECS tasks retrieve from Secrets Manager at runtime
- IAM policies control access

### 5. Runtime Secret Resolution

ECS containers use hierarchical resolution:

**Primary**: AWS Secrets Manager (via ECS secrets injection)
```bash
BENCHLING_CLIENT_ID=xxx         # From Secrets Manager
BENCHLING_CLIENT_SECRET=yyy     # From Secrets Manager
BENCHLING_TENANT=zzz            # From CloudFormation parameter or Secrets Manager
```

**Fallback**: Environment variables (local development)
```bash
BENCHLING_CLIENT_ID=xxx
BENCHLING_CLIENT_SECRET=yyy
BENCHLING_TENANT=zzz
```

### 6. Validation Framework

Comprehensive validation before deployment:
- JSON syntax validation
- Required fields validation (`client_id`, `client_secret`, `tenant`)
- Optional fields validation (`app_definition_id`, `api_url`)
- ARN format validation
- Field type validation (all strings)
- Tenant format validation (alphanumeric + hyphens)

### 7. Security Measures

- **NoEcho**: CloudFormation parameters use `noEcho: true`
- **Masked Output**: CLI masks secrets in all output
- **No Logs**: Secrets never logged to CloudWatch in plaintext
- **IAM Policies**: Least privilege access to Secrets Manager
- **Encryption**: Secrets encrypted at rest (Secrets Manager) and in transit (TLS)

### 8. Backward Compatibility

Deprecation strategy over multiple versions:

- **v0.6.x**: New parameter available, old parameters work with warnings
- **v0.7.x - v0.9.x**: Deprecation warnings continue, encourage migration
- **v1.0.x**: Old parameters removed (breaking change)

### 9. Configuration Priority

When multiple sources provided:
1. CLI flag `--benchling-secrets` (highest priority)
2. Environment variable `BENCHLING_SECRETS`
3. `.env` file `BENCHLING_SECRETS=...`
4. Individual legacy parameters (deprecated)
5. Auto-discovery from Quilt stack (planned)

---

## Alternatives Considered

### Alternative 1: Continue with Individual Parameters

**Rejected**: Does not solve the core problems of complexity and maintainability.

**Pros**:
- No migration needed
- Familiar to existing users

**Cons**:
- Complexity remains (4 parameters)
- No centralization
- No secret rotation support
- CloudFormation parameter limits

### Alternative 2: Environment Variables Only

**Rejected**: Does not work well with AWS deployment and secret rotation.

**Pros**:
- Simple local development
- Familiar pattern

**Cons**:
- Not suitable for production (no encryption at rest)
- No audit trail
- Difficult to rotate
- No integration with AWS IAM

### Alternative 3: Configuration File Required

**Rejected**: Adds friction to deployment workflow.

**Pros**:
- Clean separation of config
- Easy to manage

**Cons**:
- Extra file to manage
- Risk of committing secrets to git
- Not suitable for CI/CD pipelines

### Alternative 4: AWS Systems Manager Parameter Store

**Rejected**: Secrets Manager is more suitable for credentials.

**Pros**:
- Free tier available
- Familiar AWS service

**Cons**:
- Not designed for secrets (Parameter Store is for config)
- No automatic encryption
- No rotation support
- Less audit features

### Alternative 5: Inline JSON Only (No ARN Support)

**Rejected**: Does not support secret reuse and centralized management.

**Pros**:
- Simpler implementation
- Fewer code paths

**Cons**:
- Cannot reference existing secrets
- Cannot share secrets across stacks
- No support for secret rotation
- Forces secret duplication

---

## Consequences

### Positive

1. **Simplified UX**: Users configure secrets once via single parameter
2. **Security**: Secrets stored in AWS Secrets Manager with encryption
3. **Flexibility**: Multiple formats support different use cases
4. **Rotation**: Secrets can be rotated without stack redeployment
5. **Audit**: CloudTrail logs all secret access
6. **Maintainability**: Less code to maintain (one parameter vs. four)
7. **Validation**: Comprehensive pre-deployment validation catches errors
8. **Documentation**: Single concept to document and explain

### Negative

1. **Migration Burden**: Existing users must migrate to new parameter
2. **Learning Curve**: Users must learn JSON format
3. **Complexity**: More complex validation logic in CLI
4. **Testing**: More test scenarios to cover
5. **CloudFormation Limitation**: Still using `unsafePlainText()` for parameter passing

### Neutral

1. **Backward Compatibility**: Maintained during transition period
2. **Code Changes**: Requires changes in CLI, CDK, and documentation
3. **Versioning**: Clear version boundaries for deprecation
4. **Documentation**: Extensive documentation required

---

## Implementation Details

### Phase 1: Validation Framework
- Created `lib/utils/secrets.ts` with validation functions
- JSON parsing and structure validation
- ARN format validation
- Comprehensive error messages

### Phase 2: CLI Integration
- Added `--benchling-secrets` parameter to deploy command
- Integrated validation in deployment workflow
- Added deprecation warnings for old parameters
- Secret masking in CLI output

### Phase 3: CDK Stack Changes
- Added `BenchlingSecrets` CloudFormation parameter
- Conditional secret handling in Fargate service
- Support for both ARN and JSON formats
- Maintained backward compatibility

### Phase 4: Runtime Configuration
- Secrets Manager secret creation via CDK
- ECS secrets injection configuration
- IAM policies for secret access
- Environment variable fallback

---

## Migration Path

### For Users

**Before v1.0.0** (Current v0.6.x):
```bash
# Old way still works (with warnings)
npx @quiltdata/benchling-webhook deploy \
  --tenant company \
  --client-id xxx \
  --client-secret yyy

# New way (recommended)
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets '{"client_id":"xxx","client_secret":"yyy","tenant":"company"}'
```

**After v1.0.0** (Future):
```bash
# Only new way supported
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets '{"client_id":"xxx","client_secret":"yyy","tenant":"company"}'
```

### For Developers

**Deprecation Timeline**:
1. v0.6.0: New parameter introduced, old parameters deprecated
2. v0.7.0 - v0.9.x: Warning messages displayed
3. v1.0.0: Old parameters removed from code

**Code Cleanup** (v1.0.0):
- Remove individual parameter parsing
- Remove backward compatibility code
- Simplify configuration logic
- Update tests to remove deprecated paths

---

## Metrics and Success Criteria

### Success Metrics

- ✅ Single parameter replaces 4 individual parameters
- ✅ Zero plaintext secrets in CloudFormation templates
- ✅ Validation catches 100% of format errors before deployment
- ✅ Secret retrieval adds <200ms to container startup
- ✅ Backward compatibility maintained (old parameters work)
- ✅ Migration documentation enables self-service
- ✅ User satisfaction: Simpler deployment workflow

### Monitoring

- CloudWatch metrics for secret retrieval latency
- CloudWatch metrics for validation failures
- CloudTrail audit logs for secret access
- User feedback on migration experience

---

## Future Enhancements

### Planned

1. **Quilt Stack Auto-Discovery**: Automatically discover Benchling secrets from Quilt CloudFormation exports
2. **Secret Rotation**: Implement automated secret rotation with Lambda
3. **Admin API**: REST API for secret management and validation
4. **Multi-Region**: Support secret replication across regions
5. **Secret Versioning**: Support referencing specific secret versions

### Under Consideration

1. **Custom Secret Names**: Allow users to specify secret names
2. **Secret Caching**: Cache secret values with TTL for performance
3. **Health Dashboard**: UI for secret status and validation
4. **Secret Expiration**: Automatic secret expiration policies
5. **Two-Person Approval**: Require two approvers for secret changes

---

## References

### Related Documents
- [Secrets Configuration Guide](./SECRETS_CONFIGURATION.md)
- [Migration Guide](./SECRETS_CONFIGURATION.md#migration-guide)
- [Troubleshooting](./SECRETS_CONFIGURATION.md#troubleshooting)

### AWS Documentation
- [AWS Secrets Manager Best Practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)
- [ECS Secrets](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data-secrets.html)
- [CloudFormation NoEcho](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/parameters-section-structure.html#parameters-section-structure-properties-noecho)

### Issues and PRs
- [Issue #156: Unified Secrets Manager Approach](https://github.com/quiltdata/benchling-webhook/issues/156)
- [PR #160: Implement Unified Secrets Management](https://github.com/quiltdata/benchling-webhook/pull/160)

---

**Status**: Accepted and Implemented
**Version**: 0.6.0+
**Last Updated**: 2025-10-31
**Supersedes**: None (First ADR for this project)
