# Requirements: Secrets Manager Architecture

**Spec**: 156b
**Date**: 2025-11-01
**Status**: In Progress
**Related**: GitHub Issue #156, Spec 156a (Secrets-Only Architecture)

## Objective

Redesign the Benchling webhook for **maximum simplicity, testability, and modifiability** by splitting configuration into three distinct components as described in GitHub Issue #156.

## Architecture Overview

### Three-Component Design

#### A. Benchling Secret (AWS Secrets Manager)

A single AWS Secrets Manager secret containing **all 11 runtime parameters**.

**Required Parameters**:

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `APP_DEFINITION_ID` | string | `appdef_wqFfaXBVMu` | App definition ID for webhook verification |
| `CLIENT_ID` | string | `wqFfVOhbYe` | OAuth client ID from Benchling app |
| `CLIENT_SECRET` | string | `6NUPNtpWP7f...` | OAuth client secret from Benchling app |
| `ECR_REPOSITORY_NAME` | string | `quiltdata/benchling` | Custom ECR repository name |
| `ENABLE_WEBHOOK_VERIFICATION` | boolean/string | `true` | Verify webhook signatures |
| `LOG_LEVEL` | string | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL) |
| `PKG_PREFIX` | string | `benchling` | Quilt package name prefix |
| `PKG_KEY` | string | `experiment_id` | Metadata key for linking entries to packages |
| `TENANT` | string | `quilt-dtt` | Benchling subdomain (e.g., `myorg` from `myorg.benchling.com`) |
| `USER_BUCKET` | string | `my-s3-bucket` | S3 bucket for Benchling exports |
| `WEBHOOK_ALLOW_LIST` | string | `` | Comma-separated IP allowlist (empty for no restrictions) |

**Note**: All 11 parameters MUST be stored in the Benchling secret. The application MUST NOT use hardcoded defaults for any of these values.

#### B. Docker Container (2 Environment Variables)

The container extracts all 11 runtime parameters from just **2 environment variable inputs**:

1. **`QuiltStackARN`** - CloudFormation stack ARN containing Quilt infrastructure
   - Example: `arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/e51b0c10-10c9-11ee-9b41-12fda87498a3`
   - Purpose: Provides AWS region, account, and access to CloudFormation outputs (if needed)

2. **`BenchlingSecret`** - AWS Secrets Manager secret name containing all 11 runtime parameters
   - Example: `benchling-webhook-dev`
   - Purpose: Contains all application configuration

The container's configuration resolver MUST:

- Parse the CloudFormation ARN to extract region and account
- Fetch CloudFormation stack outputs (for infrastructure details like SQS queue, database)
- Fetch all 11 runtime parameters from the Benchling secret
- Assemble complete application configuration
- Fail fast with clear error messages if any required parameter is missing

#### C. Webhook Process

The webhook process uses the resolved configuration to call Benchling and Amazon APIs to generate packages and canvases.

## Requirements

### R1: Single Configuration Source (CRITICAL)

All runtime parameters MUST be stored in the Benchling secret in AWS Secrets Manager.

**Acceptance Criteria**:

- All 11 parameters listed in section A are stored in the secret as JSON
- The application reads ALL configuration from the secret (no hardcoded defaults)
- Users can change any parameter by updating the secret (no code changes required)
- The secret follows a documented JSON schema

**Rationale**: Issue #156 specifies that all runtime parameters must be in the secret for maximum simplicity and modifiability.

### R2: Two Environment Variables Only

The container MUST require exactly 2 environment variables at startup.

**Acceptance Criteria**:

- Container fails immediately if `QuiltStackARN` is not set
- Container fails immediately if `BenchlingSecret` is not set
- Container MUST NOT read any other environment variables for runtime configuration
- Error messages clearly state which variables are missing

**Rationale**: Simplicity - 2 inputs instead of 10+.

### R3: Configuration Resolver

The application MUST have a configuration resolver that fetches and assembles complete configuration from AWS.

**Acceptance Criteria**:

- Resolver parses CloudFormation ARN to extract region and account
- Resolver calls AWS Secrets Manager to fetch the Benchling secret
- Resolver validates all 11 required parameters are present in the secret
- Resolver calls CloudFormation DescribeStacks to get infrastructure outputs (queue ARN, database name, etc.)
- Resolver assembles complete configuration object
- Resolver caches configuration for container lifetime (no repeated AWS calls)

**Rationale**: The container must dynamically resolve configuration from AWS services.

### R4: No Legacy Mode

The application MUST NOT support reading individual environment variables (legacy mode).

**Acceptance Criteria**:

- Remove all code that reads `BENCHLING_TENANT`, `BENCHLING_CLIENT_ID`, etc. from environment
- Remove all code that reads `PKG_PREFIX`, `PKG_KEY`, `LOG_LEVEL` from environment
- Only `QuiltStackARN` and `BenchlingSecret` are read from environment
- All other configuration comes from AWS Secrets Manager

**Rationale**: Legacy mode caused the deployment failure. Issue #156 specifies a clean, simple architecture with no backward compatibility.

### R5: Production and Tests Use Identical Code Path

Production and tests MUST execute the exact same configuration resolution logic.

**Acceptance Criteria**:

- Production: `ConfigResolver.resolve()` calls real AWS APIs
- Tests: `ConfigResolver.resolve()` is mocked to return test data
- Both execute identical application startup logic
- No conditional code based on environment (test vs production)
- Tests do not require AWS credentials or real AWS resources

**Rationale**: Divergent code paths led to the deployment failure. Tests must validate production behavior.

### R6: NPM Scripts (Make Targets)

The following npm scripts MUST work as described in Issue #156:

#### `npm run config`

Generate the Benchling secret from `.env` file or command-line arguments.

**Acceptance Criteria**:

- Reads 10 parameters from `.env` file with `BENCHLING_` prefix
- Creates or updates AWS Secrets Manager secret
- Validates all required parameters are present
- Outputs success message with secret ARN
- Supports dry-run mode to preview changes

**Status**: ✅ Implemented

**Usage**:
```bash
npm run config -- --secret-name benchling-webhook-dev --region us-east-1
npm run config -- --secret-name benchling-webhook-prod --env-file .env.prod
npm run config -- --secret-name test-secret --dry-run
```

#### `npm run test`

Unit tests the webhook process with mocks (no secrets required).

**Acceptance Criteria**:

- Mocks `ConfigResolver` to return test data
- Runs all Python and TypeScript unit tests
- Requires no AWS credentials
- Runs successfully in CI/CD environment

**Status**: Partially implemented (needs update for full 11-parameter secret)

#### `npm run docker:test`

Integration tests which generate the secret and run the webhook process locally via freshly built Docker container with REAL data.

**Acceptance Criteria**:

- Builds Docker container locally
- Creates temporary secret in AWS Secrets Manager (or uses existing dev secret)
- Runs container with real AWS resources
- Validates end-to-end configuration resolution
- Requires AWS credentials

**Status**: Partially implemented

#### `npm run cdk:dev`

Uses CI to build a container (linux/amd64) and deploy a stack around it.

**Acceptance Criteria**:

- Creates dev tag (e.g., `v0.5.4-20251101T185415Z`)
- Pushes tag to GitHub
- Waits for CI to build Docker image (x86_64)
- Deploys CloudFormation stack with secrets-only mode:
  - `--quilt-stack-arn <arn>`
  - `--benchling-secret <secret-name>`
- Deployment succeeds without Circuit Breaker
- ECS tasks start successfully

**Status**: Partially implemented (works with 4-parameter secret, needs 11-parameter secret)

### R7: Clear Error Messages

Configuration errors MUST provide actionable guidance.

**Acceptance Criteria**:

- Missing environment variables show which variables are required
- Missing secret parameters show which parameters are missing
- Invalid CloudFormation ARN shows expected format
- AWS permission errors suggest which permissions are needed
- All errors include links to documentation

**Example**:

```text
❌ Configuration Error: Missing required parameters in secret 'benchling-webhook-dev'

Missing: LOG_LEVEL, PKG_PREFIX, USER_BUCKET

Expected secret format:
{
  "CLIENT_ID": "...",
  "CLIENT_SECRET": "...",
  "TENANT": "...",
  "APP_DEFINITION_ID": "...",
  "LOG_LEVEL": "INFO",
  "PKG_PREFIX": "benchling",
  "PKG_KEY": "experiment_id",
  "USER_BUCKET": "my-bucket",
  "ECR_REPOSITORY_NAME": "quiltdata/benchling",
  "ENABLE_WEBHOOK_VERIFICATION": "true",
  "WEBHOOK_ALLOW_LIST": ""
}

See: https://github.com/quiltdata/benchling-webhook#configuration
```

### R8: Backward Compatibility NOT Required

Individual environment variables (legacy mode) are DEPRECATED and no longer supported.

**Breaking Change**: Applications using individual environment variables MUST migrate to secrets-only mode.

**Acceptance Criteria**:

- Documentation clearly states breaking change
- Migration guide provided
- Legacy mode code completely removed

### R9: Full Customizability

Users MUST be able to customize all 11 parameters without code changes.

**Acceptance Criteria**:

- All parameters read from secret (not hardcoded)
- Changing a parameter requires only updating the secret
- No container rebuild required to change parameters
- No code changes required to change parameters

**Rationale**: Issue #156 emphasizes "modifiability" - users must be able to configure the application via the secret.

## Success Criteria

### Deployment Success

1. `npm run cdk:dev` completes successfully
2. CloudFormation creates all resources without rollback
3. ECS service starts without Circuit Breaker
4. 2 tasks running and healthy
5. Health endpoint returns `200 OK`
6. Config endpoint shows all 11 parameters from secret

### Code Quality

1. All tests pass (`npm run test`)
2. Production and tests use identical code paths
3. No legacy mode code remains
4. No hardcoded configuration defaults

### Documentation

1. README updated with new architecture
2. Migration guide for existing deployments
3. Breaking changes clearly documented
4. All 11 parameters documented with examples

## Breaking Changes

### Environment Variables No Longer Supported

⚠️ **BREAKING**: Individual environment variables are no longer supported.

**Before** (no longer works):

```bash
export BENCHLING_TENANT=test
export BENCHLING_CLIENT_ID=test-id
export BENCHLING_CLIENT_SECRET=test-secret
export BENCHLING_APP_DEFINITION_ID=appdef_test
export BENCHLING_PKG_BUCKET=test-bucket
export BENCHLING_PKG_PREFIX=benchling
export BENCHLING_PKG_KEY=experiment_id
# ... etc
```

**After** (required):

```bash
export QuiltStackARN=arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123
export BenchlingSecret=benchling-webhook-prod
```

All configuration parameters are stored in the `benchling-webhook-prod` secret in AWS Secrets Manager.

## Non-Requirements

### Out of Scope

The following are explicitly **NOT** required:

1. Support for legacy mode (individual environment variables)
2. Reading configuration from `.env` files in production
3. CloudFormation parameter overrides for individual fields
4. Multiple secrets (all parameters in one secret)
5. Dynamic secret rotation during runtime

### Future Work

These enhancements are deferred to future releases:

1. ~~`npm run config` command to generate secrets from `.env`~~ ✅ **IMPLEMENTED**
2. Pre-deployment validation (check secrets exist before deploying)
3. Secrets rotation support with graceful reload
4. Configuration diff tool (compare running config vs secret)
5. Secret schema versioning for forward compatibility

## References

- **GitHub Issue #156**: <https://github.com/quiltdata/benchling-webhook/issues/156>
- **Spec 156a**: [Original secrets-only architecture design](../156a-secrets-only/)
- **Branch**: `156-secrets-manager`

---

**Document Status**: Complete
**Last Updated**: 2025-11-01
**Next**: Write behavioral specification in [02-spec.md](./02-spec.md)
