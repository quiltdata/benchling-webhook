# Incident Report: ECS Deployment Circuit Breaker Failure

**Spec**: 156b
**Date**: 2025-11-01
**Status**: Incident Resolved, Requirements Documented
**Related**: Spec 156a (Secrets-Only Architecture), GitHub Issue #156
**Branch**: `156-secrets-manager`

## Incident Summary

### What Went Wrong

On 2025-11-01, deployment via `npm run cdk:dev` failed with ECS Circuit Breaker triggered after ~4.5 minutes:

```text
CREATE_FAILED | AWS::ECS::Service | FargateServiceECC8084D
Error: ECS Deployment Circuit Breaker was triggered
```

**Observations**:

- Infrastructure resources created successfully (VPC, Load Balancer, Task Definition) ✅
- ECS service failed to start containers ❌
- No container logs available (log group deleted during rollback)
- CloudFormation stack in `ROLLBACK_COMPLETE` state

### Root Cause

The deployment script `bin/dev-deploy.ts` was deploying using **legacy mode** (10+ individual environment variables) instead of **secrets-only mode** (2 AWS parameters).

**Key Problem**: We were testing secrets-only mode with mocked AWS, but deploying legacy mode with real AWS - two completely different code paths. Production and tests were divergent.

### Why It Failed

In legacy mode, the Python application tries to load individual environment variables like `BENCHLING_TENANT`, `BENCHLING_CLIENT_ID`, etc. However:

1. The CDK stack was only partially configured for legacy mode
2. Some variables were passed as environment variables, others as ECS Secrets
3. The configuration resolver couldn't find all required values
4. Container startup failed due to configuration initialization errors

**Fundamental Issue**: Legacy mode was never intended for production deployment - it existed only for backward-compatible testing with environment variables.

## Suggested Fix

### The Solution

Implement GitHub Issue #156's vision completely:

1. **Store all 11 runtime parameters in AWS Secrets Manager** (not just 4 Benchling credentials)
2. **Require only 2 environment variables** for container startup:
   - `QuiltStackARN` - CloudFormation stack containing Quilt infrastructure
   - `BenchlingSecret` - Secrets Manager secret containing all 11 runtime parameters
3. **Remove legacy mode entirely** from production code
4. **Make production and test code paths identical** via mocked `ConfigResolver`

### What This Achieves

- **Maximum simplicity**: 2 inputs instead of 10+
- **Full customizability**: All 11 parameters configurable via secret without code changes
- **Testability**: Mock at AWS boundary, not environment variables
- **Single code path**: Production and tests execute identical logic

## Current Status vs Requirements

### What's Implemented (Commits `f47b04c`, `8a800b8`)

✅ Removed legacy mode from Python config
✅ Updated `cdk:dev` to pass secrets-only parameters
✅ Tests use mocked `ConfigResolver` (same code path as production)
✅ Deployment working with 2 environment variables

### What's NOT Yet Aligned with Issue #156

❌ Secret only stores 4 Benchling credentials (not all 11 parameters)
❌ Other parameters use hardcoded defaults (can't customize without code changes)
❌ `USER_BUCKET` comes from CloudFormation (should be in secret per issue)
❌ `PKG_PREFIX`, `PKG_KEY`, `LOG_LEVEL` hardcoded (should be in secret per issue)
❌ `WEBHOOK_ALLOW_LIST`, `ECR_REPOSITORY_NAME` not implemented

## Documents

This incident report references two documents:

1. **[01-requirements.md](./01-requirements.md)** - Complete requirements from GitHub Issue #156
2. **[02-spec.md](./02-spec.md)** - Behavioral specification of what must be done (no code)

## Issue #156: The Complete Vision

GitHub Issue #156 describes a **3-component architecture**:

### A. Benchling Secret (11 Runtime Parameters)

All runtime configuration stored in AWS Secrets Manager secret:

| Parameter | Description |
|-----------|-------------|
| `CLIENT_ID` | OAuth client ID from Benchling app |
| `CLIENT_SECRET` | OAuth client secret from Benchling app |
| `TENANT` | Benchling subdomain |
| `APP_DEFINITION_ID` | App definition ID for webhook verification |
| `ECR_REPOSITORY_NAME` | Custom ECR repo name |
| `ENABLE_WEBHOOK_VERIFICATION` | Verify webhook signatures |
| `LOG_LEVEL` | Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL) |
| `PKG_PREFIX` | Quilt package name prefix |
| `PKG_KEY` | Metadata key for linking entries to packages |
| `USER_BUCKET` | S3 bucket for Benchling exports |
| `WEBHOOK_ALLOW_LIST` | Comma-separated IP allowlist |

### B. Docker Container (2 Environment Variables)

Container extracts all 11 runtime parameters from just 2 inputs:

1. `QuiltStackARN` - CloudFormation stack ARN
2. `BenchlingSecret` - Secrets Manager secret name

The container's `ConfigResolver`:

- Parses CloudFormation ARN to get region/account
- Fetches stack outputs (if needed for additional infrastructure details)
- Fetches all 11 parameters from Secrets Manager
- Assembles complete configuration

### C. Webhook Process

Calls Benchling and Amazon APIs to generate packages and canvases using resolved configuration.

## Next Steps

1. **Complete requirements analysis** - Document all 11 parameters from Issue #156 in [01-requirements.md](./01-requirements.md)
2. **Write behavioral specification** - Describe what must happen (not how) in [02-spec.md](./02-spec.md)
3. **Implement missing parameters** - Store all 11 in secret, not just 4
4. **Update ConfigResolver** - Read all parameters from secret
5. **Verify Make targets** - Ensure `npm run test`, `npm run docker:test`, `npm run cdk:dev` work as described
6. **Deploy and validate** - Test with real AWS resources

## References

- **GitHub Issue**: <https://github.com/quiltdata/benchling-webhook/issues/156>
- **Spec 156a**: [Original secrets-only architecture design](../156a-secrets-only/)
- **Branch**: `156-secrets-manager`
- **Commits (Partial Fix)**:
  - `f47b04c` - fix: switch cdk:dev to use secrets-only mode deployment
  - `8a800b8` - refactor: remove legacy mode, use secrets-only everywhere

---

**Report Status**: Complete
**Last Updated**: 2025-11-01
**Next Action**: Rewrite requirements and specification to match Issue #156
