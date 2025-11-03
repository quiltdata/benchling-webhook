# Specification: Secrets Manager Architecture Implementation

**Spec**: 156b
**Date**: 2025-11-01
**Status**: In Progress
**Related**: GitHub Issue #156, [Requirements](./01-requirements.md)

## Executive Summary

This specification describes **what must be done** to implement the secrets manager architecture defined in GitHub Issue #156 and documented in the requirements.

**Key Principle**: This document describes **behavioral goals and outcomes**, not implementation details or code. It answers "what must the system do?" not "how should it be coded?"

## Table of Contents

1. [Configuration Storage](#configuration-storage)
2. [Container Startup](#container-startup)
3. [Configuration Resolution](#configuration-resolution)
4. [Error Handling](#error-handling)
5. [Testing Strategy](#testing-strategy)
6. [Deployment Process](#deployment-process)
7. [Migration Path](#migration-path)
8. [Validation Criteria](#validation-criteria)

---

## Configuration Storage

### Benchling Secret Structure

**What must happen**: All 11 runtime parameters must be stored in a single AWS Secrets Manager secret as a JSON document.

**Behavioral Goal**: When a user creates or updates the Benchling secret, it must contain all required parameters in a well-defined JSON structure.

**Required Behavior**:

1. The secret must be created in AWS Secrets Manager in the same region as the application
2. The secret must be stored as a JSON string (not binary)
3. The JSON must contain exactly 11 top-level keys (listed in requirements)
4. All 11 parameters must have non-empty values
5. Boolean parameters must be stored as strings (`"true"` or `"false"`)
6. The secret name should follow the pattern `benchling-webhook-{environment}` (e.g., `benchling-webhook-prod`)

**Outcome**: Users can view, update, or create the secret using AWS Console, CLI, or Terraform without touching application code.

### Secret JSON Schema

**What must happen**: The secret must follow a documented, validated schema.

**Required Behavior**:

1. The secret must contain these exact keys (case-sensitive):
   - `CLIENT_ID`
   - `CLIENT_SECRET`
   - `TENANT`
   - `APP_DEFINITION_ID`
   - `LOG_LEVEL`
   - `PKG_PREFIX`
   - `PKG_KEY`
   - `USER_BUCKET`
   - `ECR_REPOSITORY_NAME`
   - `ENABLE_WEBHOOK_VERIFICATION`
   - `WEBHOOK_ALLOW_LIST`

2. Missing keys must cause application startup to fail with a clear error message
3. Extra keys must be ignored (forward compatibility)
4. The schema must be documented in the repository README

**Outcome**: The secret structure is predictable, documented, and validated at startup.

---

## Container Startup

### Environment Variable Requirements

**What must happen**: The container must require exactly 2 environment variables at startup and reject any missing or extra configuration variables.

**Required Behavior**:

1. Container reads `QuiltStackARN` from environment
2. Container reads `BenchlingSecret` from environment
3. If either variable is missing, container fails immediately (before any AWS calls)
4. Container does not read any other `BENCHLING_*` environment variables
5. Container does not read any other configuration from environment

**Outcome**: Simplified deployment - operators only need to provide 2 values.

### Startup Sequence

**What must happen**: The container must follow a predictable startup sequence that fails fast on misconfiguration.

**Required Behavior**:

1. **Phase 1: Environment Validation**
   - Check `QuiltStackARN` is set
   - Check `BenchlingSecret` is set
   - Fail immediately if either is missing

2. **Phase 2: Configuration Resolution**
   - Parse CloudFormation ARN
   - Fetch CloudFormation stack outputs
   - Fetch Benchling secret from Secrets Manager
   - Validate all 11 parameters are present
   - Assemble configuration object

3. **Phase 3: Application Initialization**
   - Initialize logging with configured log level
   - Initialize Benchling client with credentials
   - Initialize AWS clients (S3, SQS, Athena)
   - Start Flask application

4. **Phase 4: Health Check**
   - Expose `/health` endpoint showing:
     - Service status
     - Configuration source (secrets-only-mode)
     - Number of parameters loaded (11)

**Outcome**: Clear, observable startup process with fail-fast behavior.

---

## Configuration Resolution

### AWS API Interactions

**What must happen**: The configuration resolver must fetch data from AWS services and assemble a complete configuration object.

**Required Behavior**:

**CloudFormation ARN Parsing**:

1. Extract region from ARN (e.g., `us-east-1`)
2. Extract account ID from ARN (e.g., `712023778557`)
3. Extract stack name from ARN (e.g., `quilt-staging`)
4. Validate ARN format matches CloudFormation stack ARN pattern
5. Fail with clear error if ARN is invalid

**CloudFormation Stack Outputs**:

1. Call `DescribeStacks` API with parsed stack name and region
2. Extract required outputs:
   - S3 bucket name (from `UserBucket` or `BucketName` output)
   - SQS queue ARN (from `PackagerQueueArn` output)
   - Database name (from `UserAthenaDatabaseName` output)
   - Catalog URL (from `Catalog`, `CatalogDomain`, or `ApiGatewayEndpoint` output)
3. Fail with clear error if stack not found or outputs missing
4. Fail with clear error if IAM permissions are insufficient

**Secrets Manager Fetch**:

1. Call `GetSecretValue` API with secret name and region
2. Parse JSON from `SecretString` field
3. Validate all 11 required parameters are present
4. Fail with clear error if secret not found
5. Fail with clear error if JSON is invalid
6. Fail with clear error if any parameter is missing
7. Fail with clear error if IAM permissions are insufficient

**Configuration Assembly**:

1. Combine CloudFormation outputs and secret parameters
2. Create a configuration object with all values
3. Cache the configuration for the container lifetime
4. Do not make repeated AWS API calls (cache is sufficient)

**Outcome**: The application has complete, validated configuration loaded from AWS services.

### Configuration Caching

**What must happen**: Configuration must be fetched once at startup and cached for the container lifetime.

**Required Behavior**:

1. Configuration is resolved once during container initialization
2. Configuration is cached in memory
3. Subsequent requests use cached configuration (no AWS API calls)
4. Configuration cannot be changed without restarting the container
5. Container restart triggers fresh configuration resolution

**Outcome**: Efficient startup, predictable behavior, no runtime AWS dependencies for configuration.

---

## Error Handling

### Configuration Errors

**What must happen**: All configuration errors must fail fast with actionable error messages.

**Required Behavior**:

**Missing Environment Variables**:

```text
❌ Configuration Error: Missing required environment variables

Required: QuiltStackARN, BenchlingSecret

Current:
  QuiltStackARN: not set
  BenchlingSecret: not set

See: https://github.com/quiltdata/benchling-webhook#configuration
```

**Invalid CloudFormation ARN**:

```text
❌ Configuration Error: Invalid CloudFormation stack ARN format

Expected: arn:aws:cloudformation:region:account:stack/name/id
Received: invalid-arn

See: https://github.com/quiltdata/benchling-webhook#cloudformation
```

**Missing Secret Parameters**:

```text
❌ Configuration Error: Missing required parameters in secret 'benchling-webhook-dev'

Missing: LOG_LEVEL, PKG_PREFIX, USER_BUCKET

Expected secret format (JSON):
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

See: https://github.com/quiltdata/benchling-webhook#secret-format
```

**AWS Permission Errors**:

```text
❌ Configuration Error: Access denied to secret 'benchling-webhook-dev'

The IAM role lacks required permissions.

Required permissions:
  - secretsmanager:GetSecretValue

See: https://github.com/quiltdata/benchling-webhook#permissions
```

**Outcome**: Operators can diagnose and fix configuration issues without reading code.

---

## Testing Strategy

### Unit Tests

**What must happen**: Unit tests must validate application behavior without requiring AWS resources.

**Required Behavior**:

1. Tests mock the configuration resolver at the AWS boundary
2. Tests provide complete test configuration via mocks
3. Tests execute the same code paths as production
4. Tests do not read environment variables for configuration (use mocks)
5. Tests do not require AWS credentials
6. Tests run successfully in CI/CD without AWS access
7. Tests validate:
   - Application startup with mocked configuration
   - Error handling for missing configuration
   - All business logic with test data

**Outcome**: Fast, reliable unit tests that validate production code paths.

### Integration Tests

**What must happen**: Integration tests must validate end-to-end configuration resolution with real AWS services.

**Required Behavior**:

1. Tests create a temporary secret in AWS Secrets Manager
2. Tests build a Docker container locally
3. Tests run the container with real AWS resources
4. Tests validate:
   - Configuration is correctly resolved from AWS
   - Health endpoint returns expected data
   - Config endpoint shows all 11 parameters
   - Application can connect to Benchling and AWS services
5. Tests clean up temporary resources after completion

**Outcome**: High confidence that deployment will succeed.

### Test Commands

**What must happen**: npm scripts must execute tests as described in requirements.

**Required Behavior**:

**`npm run test`**:

- Runs all unit tests (Python and TypeScript)
- Uses mocked configuration resolver
- Requires no AWS credentials
- Exits with code 0 on success, non-zero on failure

**`npm run docker:test`**:

- Builds Docker container
- Runs integration tests with real AWS
- Requires AWS credentials
- Cleans up resources on completion
- Exits with code 0 on success, non-zero on failure

**Outcome**: Clear test execution with predictable behavior.

---

## Deployment Process

### Development Deployment

**What must happen**: Deploying to development must be a single command that creates a working stack.

**Required Behavior**:

**`npm run cdk:dev` must**:

1. Create a development tag (e.g., `v0.5.4-20251101T185415Z`)
2. Push the tag to GitHub
3. Wait for CI to build Docker image (linux/amd64)
4. Deploy CloudFormation stack with:
   - `--quilt-stack-arn` pointing to staging Quilt stack
   - `--benchling-secret` pointing to development secret
5. Create ECS service with 2 tasks
6. Wait for tasks to become healthy
7. Report success with ALB URL
8. Fail immediately if Circuit Breaker triggers

**Outcome**: One-command deployment to development environment.

### Production Deployment

**What must happen**: Deploying to production must follow the same process with production parameters.

**Required Behavior**:

**`npm run cli -- deploy` must**:

1. Accept `--quilt-stack-arn` parameter (production stack)
2. Accept `--benchling-secret` parameter (production secret)
3. Accept `--image-tag` parameter (released version)
4. Deploy CloudFormation stack with production configuration
5. Create ECS service with desired task count
6. Wait for tasks to become healthy
7. Report success with ALB URL
8. Fail immediately if Circuit Breaker triggers

**Outcome**: Consistent deployment process across environments.

---

## Migration Path

### From Legacy Mode to Secrets-Only Mode

**What must happen**: Existing deployments using individual environment variables must have a clear migration path.

**Required Steps**:

#### Step 1: Create Benchling Secret

1. Gather all 11 parameters from current deployment
2. Create JSON document with all parameters
3. Create secret in AWS Secrets Manager using AWS CLI or Console
4. Record the secret name (e.g., `benchling-webhook-prod`)

#### Step 2: Identify Quilt Stack

1. Identify the CloudFormation stack containing Quilt infrastructure
2. Get the full stack ARN using AWS CLI or Console
3. Record the ARN

#### Step 3: Update Deployment

1. Update deployment script/command to use:
   - `--quilt-stack-arn <arn>`
   - `--benchling-secret <secret-name>`
2. Remove all individual environment variable parameters
3. Deploy updated stack

#### Step 4: Verify

1. Check health endpoint returns success
2. Check config endpoint shows all 11 parameters
3. Verify application functionality

**Outcome**: Smooth migration with no data loss or downtime.

---

## Validation Criteria

### Deployment Validation

**What must happen**: After deployment, the system must be observable and verifiable.

**Required Behavior**:

**Health Endpoint** (`GET /health`):

```json
{
  "status": "healthy",
  "service": "benchling-webhook",
  "version": "1.0.0",
  "config_source": "secrets-only-mode",
  "config_parameters": 11
}
```

**Config Endpoint** (`GET /config`):

```json
{
  "mode": "secrets-only",
  "region": "us-east-1",
  "account": "712023778557",
  "benchling": {
    "tenant": "quilt-dtt",
    "client_id": "wqF***Ye",
    "has_app_definition": true
  },
  "quilt": {
    "catalog": "nightly.quilttest.com",
    "database": "user***",
    "bucket": "quilt-***",
    "queue_arn": "arn:aws:sqs:***"
  },
  "parameters": {
    "pkg_prefix": "benchling",
    "pkg_key": "experiment_id",
    "log_level": "INFO",
    "webhook_verification": true
  }
}
```

**ECS Service Status**:

- Running task count: 2
- Desired task count: 2
- Health check: passing
- Circuit Breaker: not triggered

**CloudFormation Stack**:

- Status: `CREATE_COMPLETE` or `UPDATE_COMPLETE`
- Resources: all created successfully
- No rollback occurred

**Outcome**: Observable system state confirming correct deployment.

### Functional Validation

**What must happen**: The application must function correctly with the new configuration architecture.

**Required Behavior**:

1. Application accepts webhook requests from Benchling
2. Application verifies webhook signatures (if enabled)
3. Application creates Quilt packages in configured S3 bucket
4. Application sends messages to configured SQS queue
5. Application writes to configured Athena database
6. Application respects configured log level
7. Application uses configured package prefix and key

**Outcome**: Full application functionality with secrets-only configuration.

---

## Rollout Strategy

### Phase 1: Implementation (Current)

**What must be done**:

1. Update Python configuration code to read all 11 parameters from secret
2. Remove hardcoded defaults for `LOG_LEVEL`, `PKG_PREFIX`, `PKG_KEY`, `USER_BUCKET`
3. Update configuration resolver to validate all 11 parameters
4. Update test fixtures to provide all 11 parameters
5. Update error messages to show all 11 required parameters

**Outcome**: Application supports full 11-parameter secret.

### Phase 2: Testing

**What must be done**:

1. Create development secret with all 11 parameters
2. Deploy to development using `npm run cdk:dev`
3. Verify health and config endpoints
4. Run integration tests
5. Validate all functionality works

**Outcome**: Confidence in secrets-only implementation.

### Phase 3: Documentation

**What must be done**:

1. Update repository README with new architecture
2. Document all 11 secret parameters with examples
3. Write migration guide for existing deployments
4. Document breaking changes
5. Update deployment instructions

**Outcome**: Clear documentation for users.

### Phase 4: Production Rollout

**What must be done**:

1. Create production secret with all 11 parameters
2. Deploy to production with secrets-only mode
3. Monitor health checks and application metrics
4. Verify functionality
5. Communicate breaking changes to users

**Outcome**: Production running on secrets-only architecture.

---

## Success Metrics

### Deployment Success

The implementation is successful when:

1. ✅ `npm run cdk:dev` completes without Circuit Breaker
2. ✅ ECS tasks start and remain healthy
3. ✅ Health endpoint returns `200 OK` with `config_parameters: 11`
4. ✅ Config endpoint shows all 11 parameters from secret
5. ✅ Application processes webhooks successfully

### Code Quality

The implementation is successful when:

1. ✅ All unit tests pass with mocked 11-parameter configuration
2. ✅ Integration tests pass with real AWS and 11-parameter secret
3. ✅ No hardcoded configuration defaults remain
4. ✅ No legacy mode code remains
5. ✅ Production and test code paths are identical

### User Experience

The implementation is successful when:

1. ✅ Users can update any parameter via secret (no code changes)
2. ✅ Deployment requires only 2 environment variables
3. ✅ Error messages clearly explain configuration issues
4. ✅ Documentation is complete and accurate
5. ✅ Migration path is clear and tested

---

## References

- **Requirements**: [01-requirements.md](./01-requirements.md)
- **GitHub Issue #156**: <https://github.com/quiltdata/benchling-webhook/issues/156>
- **Incident Report**: [README.md](./README.md)

---

**Document Status**: Complete
**Last Updated**: 2025-11-01
**Next Action**: Implement Phase 1 changes per rollout strategy
