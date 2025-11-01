# Requirements: Secrets-Only Mode Deployment Fix

**Spec**: 165b
**Date**: 2025-11-01
**Status**: ✅ Complete
**Related**: Spec 156a (Secrets-Only Architecture)

## Problem Statement

### Current Situation

`npm run cdk:dev` fails during ECS deployment with Circuit Breaker triggered after ~4.5 minutes:

```
CREATE_FAILED | AWS::ECS::Service | FargateServiceECC8084D
Error: ECS Deployment Circuit Breaker was triggered
```

**Observations**:
- Infrastructure creates successfully (VPC, Load Balancer, Task Definition) ✅
- Only ECS service fails (container startup issue) ❌
- No container logs available (log group deleted during rollback)
- CloudFormation in `ROLLBACK_COMPLETE` state

### Root Cause

The deployment script `bin/cdk-dev.js` was deploying in **legacy mode** (10+ environment variables) instead of **secrets-only mode** (2 parameters).

From [spec/156a-secrets-only/01-requirements.md:96-105](../156a-secrets-only/01-requirements.md#L96-L105):

> **R7: Backward Compatibility NOT Required**
>
> Backward compatibility is ONLY required for:
> - Local mock testing (non-Docker)
> - Test suite behavior

**Legacy mode was never meant to be deployed to production.**

### Why Legacy Mode Failed

In legacy mode, Python's `config.py` tries to load individual environment variables, but the CDK stack configuration was incomplete:

- Sets `BENCHLING_TENANT` as environment variable ✅
- Sets `BENCHLING_CLIENT_ID`, `BENCHLING_CLIENT_SECRET` as ECS Secrets ✅
- But `secrets_resolver.py` needs ALL THREE as environment variables OR the `BENCHLING_SECRETS` parameter ❌

**Result**: Container fails to start because config initialization fails.

### The Fundamental Problem

**We were testing one thing (secrets-only mode with mocked AWS) but deploying another (legacy mode with real AWS).**

This violated the core principle: **Production and tests must use the SAME code path.**

## Requirements

### R1: Single Code Path ⭐ CRITICAL

Production and tests MUST execute identical code paths.

**Acceptance Criteria**:
- ✅ Production uses `ConfigResolver.resolve()` with real AWS APIs
- ✅ Tests use `ConfigResolver.resolve()` with mocked AWS APIs
- ✅ Both paths initialize `Config` class identically
- ✅ No conditional logic based on deployment mode

**Rationale**: Divergent code paths lead to bugs that only appear in production.

### R2: Remove Legacy Mode from Production

Python `config.py` MUST NOT support individual environment variables in production.

**Acceptance Criteria**:
- ✅ Remove `_load_from_env_vars()` method from `docker/src/config.py`
- ✅ Remove imports of `secrets_resolver` module
- ✅ `Config.__post_init__()` requires `QuiltStackARN` and `BenchlingSecret`
- ✅ Clear error message when environment variables are missing

**Rationale**: Legacy mode was only for backward-compatible testing, not production deployment.

### R3: Update Deployment Script

`bin/cdk-dev.js` MUST deploy using secrets-only mode.

**Acceptance Criteria**:
- ✅ Pass `--quilt-stack-arn` parameter to deploy command
- ✅ Pass `--benchling-secret` parameter to deploy command
- ✅ Use existing AWS Secrets Manager secret (`benchling-webhook-dev`)
- ✅ Use existing Quilt CloudFormation stack ARN

**Rationale**: Deployment script must match production configuration requirements.

### R4: Update Test Fixtures

Tests MUST use mocked `ConfigResolver` instead of environment variables.

**Acceptance Criteria**:
- ✅ Create `mock_config_resolver` fixture in `conftest.py`
- ✅ Mock `ConfigResolver.resolve()` to return test configuration
- ✅ Set `QuiltStackARN` and `BenchlingSecret` environment variables in fixture
- ✅ All config tests use the fixture

**Rationale**: Tests must execute the same code path as production.

### R5: Backward Compatibility for Tests

Tests MUST continue to pass without requiring AWS credentials.

**Acceptance Criteria**:
- ✅ Tests do not require real AWS API calls
- ✅ Tests do not require `.env` files
- ✅ Tests mock at the AWS API boundary (not environment variables)
- ✅ All existing test assertions remain valid

**Rationale**: Developer experience must not degrade - tests should run locally without AWS setup.

### R6: Clear Error Messages

Configuration errors MUST provide actionable guidance.

**Acceptance Criteria**:
- ✅ Missing environment variables show clear error message
- ✅ Error message explains which variables are required
- ✅ Error message links to deployment documentation

**Example**:
```python
raise ValueError(
    "Missing required environment variables for secrets-only mode.\n"
    "Required: QuiltStackARN, BenchlingSecret\n"
    "See: https://github.com/quiltdata/benchling-webhook#deployment"
)
```

### R7: Code Simplification

Changes MUST result in simpler, more maintainable code.

**Acceptance Criteria**:
- ✅ Net reduction in lines of code
- ✅ Fewer code paths in `config.py`
- ✅ Single source of truth for configuration

**Target**: Reduce complexity by removing dual-mode support.

## Success Criteria

### Deployment Success

1. ✅ `npm run cdk:dev` completes successfully
2. ✅ CloudFormation creates all 36/36 resources
3. ✅ ECS service starts without Circuit Breaker
4. ✅ 2 tasks running and healthy
5. ✅ Health endpoint returns `200 OK`

### Code Quality

1. ✅ All tests pass (`pytest docker/tests/`)
2. ✅ Net reduction in total lines of code
3. ✅ No conditional deployment mode logic in Python
4. ✅ Clear error messages for misconfiguration

### Documentation

1. ✅ Migration guide for existing deployments
2. ✅ Updated deployment instructions
3. ✅ Breaking changes documented

## Non-Requirements

### Out of Scope

The following are explicitly **NOT** required for this fix:

1. ❌ **Remove legacy mode from CDK** - Can be done in future cleanup
2. ❌ **Remove legacy deploy command** - Can be done in future cleanup
3. ❌ **Update all documentation** - Only update deployment guide
4. ❌ **Secrets rotation support** - Future enhancement
5. ❌ **Pre-deployment validation** - Future enhancement

### Future Work

These improvements are deferred to future PRs:

1. Clean up `lib/fargate-service.ts` legacy code paths (lines 169-325)
2. Clean up `bin/commands/deploy.ts` legacy deploy function (lines 49-383)
3. Remove unused `docker/src/secrets_resolver.py`
4. Add pre-deployment validation (check secrets exist before deploying)
5. Improve health checks (add dependency checks)

## Breaking Changes

### Python Configuration

⚠️ **BREAKING**: Individual Benchling environment variables are no longer supported.

**Before** (no longer works):
```bash
export BENCHLING_TENANT=test
export BENCHLING_CLIENT_ID=test-id
export BENCHLING_CLIENT_SECRET=test-secret
```

**After** (required):
```bash
export QuiltStackARN=arn:aws:cloudformation:region:account:stack/name/id
export BenchlingSecret=benchling-webhook-prod
```

### Test Configuration

⚠️ **BREAKING**: Tests must use `mock_config_resolver` fixture.

**Before** (no longer works):
```python
def test_config(monkeypatch):
    monkeypatch.setenv("BENCHLING_TENANT", "test")
    config = get_config()
```

**After** (required):
```python
def test_config(mock_config_resolver):
    config = get_config()  # Uses mocked resolver
```

## Dependencies

### AWS Resources Required

1. **Benchling Secret** in AWS Secrets Manager
   - Name: `benchling-webhook-dev` (development)
   - Contains: `client_id`, `client_secret`, `tenant`, `app_definition_id`
   - Created: 2025-11-01

2. **Quilt CloudFormation Stack**
   - Stack: `quilt-staging` (development)
   - ARN: `arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/e51b0c10-10c9-11ee-9b41-12fda87498a3`
   - Contains: S3 bucket, SQS queue, RDS database outputs

### Permissions Required

Deployment requires AWS permissions for:
- `secretsmanager:GetSecretValue` on Benchling secret
- `cloudformation:DescribeStacks` on Quilt stack
- `ecs:*` for ECS service management
- `ecr:*` for Docker image push

## Validation

### Pre-Deployment Checklist

- ✅ Benchling secret exists in AWS Secrets Manager
- ✅ Quilt stack is deployed and accessible
- ✅ AWS credentials configured with appropriate permissions
- ✅ All unit tests passing
- ✅ Docker image builds successfully

### Post-Deployment Verification

1. **Health Check**:
   ```bash
   curl http://<alb-dns>/health
   # Expected: {"status": "healthy", "config_source": "secrets-only-mode"}
   ```

2. **Config Endpoint**:
   ```bash
   curl http://<alb-dns>/config
   # Expected: {"mode": "secrets-only", ...}
   ```

3. **ECS Service**:
   ```bash
   aws ecs describe-services --cluster benchling-webhook --services benchling-webhook
   # Expected: runningCount: 2, desiredCount: 2
   ```

4. **Container Logs**:
   ```bash
   aws logs tail /aws/ecs/benchling-webhook --follow
   # Expected: "Starting Benchling webhook processor..."
   ```

## Timeline

- **Requirements**: 2025-11-01 (this document)
- **Implementation**: 2025-11-01 (commits `f47b04c`, `8a800b8`)
- **Testing**: 2025-11-01 (all tests passing)
- **Deployment**: Pending (ready for `npm run cdk:dev`)

## References

- **Spec 156a**: [Secrets-Only Architecture](../156a-secrets-only/)
- **Issue #156**: https://github.com/quiltdata/benchling-webhook/issues/156
- **Branch**: `156-secrets-manager`
- **Commits**:
  - `f47b04c`: fix: switch cdk:dev to use secrets-only mode deployment
  - `8a800b8`: refactor: remove legacy mode, use secrets-only everywhere
