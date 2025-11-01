# Engineering Specifications - Issue #156: Secrets Manager

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Date**: 2025-10-30
**Phase**: I RASP - Specifications

## Overview

Define a unified secrets management approach that provides a single configuration interface while supporting three deployment scenarios: Local Development, Standalone AWS Stack, and Quilt-Integrated Stack. The solution must prioritize security, simplicity, and flexibility.

## Desired End State

### 1. Unified Secret Configuration Interface

#### Primary Configuration Method

**Single Parameter**: `BENCHLING_SECRETS`

Accepts either:
- **Secret ARN**: `arn:aws:secretsmanager:region:account:secret:name`
- **JSON String**: `{"client_id": "...", "client_secret": "...", "tenant": "...", "app_definition_id": "..."}`

**Detection Logic**:
- If value starts with `arn:aws:secretsmanager:`, treat as ARN reference
- Otherwise, treat as JSON string

#### CLI Interface

```bash
# Option 1: Provide JSON directly
npx @quiltdata/benchling-webhook deploy --benchling-secrets '{"client_id":"...","client_secret":"...","tenant":"...","app_definition_id":"..."}'

# Option 2: Provide JSON from file
npx @quiltdata/benchling-webhook deploy --benchling-secrets @secrets.json

# Option 3: Provide existing secret ARN
npx @quiltdata/benchling-webhook deploy --benchling-secrets arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-creds

# Option 4: Use environment variable
export BENCHLING_SECRETS='{"client_id":"...","client_secret":"...","tenant":"...","app_definition_id":"..."}'
npx @quiltdata/benchling-webhook deploy
```

#### Configuration Sources Priority

1. CLI option `--benchling-secrets` (highest)
2. Environment variable `BENCHLING_SECRETS`
3. `.env` file `BENCHLING_SECRETS=...`
4. Individual legacy parameters (deprecated but functional)
5. Auto-discovery from Quilt stack (lowest)

### 2. Secret Structure Standard

#### Required Fields

```json
{
  "client_id": "string",
  "client_secret": "string",
  "tenant": "string"
}
```

#### Optional Fields

```json
{
  "app_definition_id": "string",
  "api_url": "string"
}
```

**Field Definitions**:
- `client_id`: Benchling OAuth client ID
- `client_secret`: Benchling OAuth client secret
- `tenant`: Benchling tenant name (e.g., "company" for company.benchling.com)
- `app_definition_id`: Benchling app definition ID (optional for backward compatibility)
- `api_url`: Custom Benchling API URL (optional, defaults to `https://{tenant}.benchling.com`)

### 3. Deployment Scenario Specifications

#### Scenario A: Standalone Stack with Inline Secrets

**User Provides**: JSON string via CLI or environment variable
**System Behavior**:
1. Validate JSON structure and required fields
2. Create AWS Secrets Manager secret named `benchling-webhook/credentials`
3. Store JSON in secret with all fields
4. Configure IAM permissions for secret access
5. Configure ECS to inject secret as environment variables

**Security Properties**:
- JSON string never stored in CloudFormation template
- Secret created before task definition
- IAM policy grants least-privilege access

#### Scenario B: Standalone Stack with Secret ARN

**User Provides**: ARN of pre-existing secret
**System Behavior**:
1. Validate ARN format
2. Verify secret exists and is accessible
3. Verify secret contains required fields
4. Reference existing secret (do not create)
5. Configure IAM permissions for secret access
6. Configure ECS to inject secret as environment variables

**Security Properties**:
- No plaintext secrets in deployment
- Secret managed outside CDK stack lifecycle
- IAM policy grants least-privilege access

#### Scenario C: Quilt Stack Integration

**User Provides**: Nothing (auto-discovery)
**System Behavior**:
1. Query CloudFormation exports for Quilt stack outputs
2. Locate Benchling secret ARN from Quilt exports
3. Validate secret accessibility
4. Verify secret contains required fields
5. Reference Quilt-managed secret
6. Configure IAM permissions for secret access
7. Configure ECS to inject secret as environment variables

**Fallback**:
- If no Quilt exports found, behave as Standalone Stack
- If exports exist but secret inaccessible, fail with helpful error

**Discovery Convention**:
- Export name pattern: `QuiltStack:BenchlingSecretArn` or similar
- Secret name pattern: `quilt/benchling/*` or discoverable via tags

#### Scenario D: Local Development

**User Provides**: Environment variables directly
**System Behavior**:
1. No AWS deployment
2. Application reads from environment variables:
   - `BENCHLING_CLIENT_ID`
   - `BENCHLING_CLIENT_SECRET`
   - `BENCHLING_TENANT`
   - `BENCHLING_APP_DEFINITION_ID` (optional)
3. No Secrets Manager access required

**Note**: This specification focuses on AWS deployment. Local development without AWS is out of scope for this issue but should be considered in runtime code design.

### 4. Backward Compatibility Specifications

#### Deprecation Phase (Version 0.6.x)

**Deprecated Parameters** (still functional):
- `--tenant`
- `--client-id`
- `--client-secret`
- `--app-id`

**Behavior**:
- If `--benchling-secrets` is provided, use it (ignore individual params)
- If individual params provided without `--benchling-secrets`, use them with deprecation warning
- Warning message: "Individual secret parameters are deprecated. Use --benchling-secrets instead. See documentation for migration guide."

#### Migration Documentation

Provide clear guide:
1. How to extract current secrets from deployment
2. How to format JSON for `--benchling-secrets`
3. How to store in AWS Secrets Manager
4. How to update existing stack

#### Removal Phase (Version 1.0.x)

**Removed Parameters**:
- All individual secret parameters removed
- Only `--benchling-secrets` supported

**Migration Path**:
- Users must update to 0.6.x first
- Verify new parameter works
- Upgrade to 1.0.x

### 5. Security Specifications

#### Secret Handling Requirements

1. **No Plaintext in Code**: Secrets never hardcoded
2. **No Plaintext in Logs**: Secrets masked in all output
3. **No Plaintext in CloudFormation**: Secrets referenced by ARN or created from encrypted parameters
4. **Encrypted at Rest**: AWS Secrets Manager handles encryption
5. **Encrypted in Transit**: TLS for all API calls
6. **Least Privilege Access**: IAM policies grant only necessary permissions

#### IAM Policy Specification

**Task Execution Role**: Read-only access to specific secret

```
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue",
    "secretsmanager:DescribeSecret"
  ],
  "Resource": "<secret-arn>"
}
```

**Task Role**: No secrets access (execution role handles it)

#### Secret Rotation Support

**Initial Scope**: Static secrets (no rotation)
**Future Enhancement**: Support AWS Secrets Manager rotation
- Lambda function for rotation
- Benchling API for credential refresh
- ECS task refresh on rotation

### 6. Validation Specifications

#### CLI Validation (Pre-Deployment)

**When** `--benchling-secrets` **is ARN**:
1. Validate ARN format matches `arn:aws:secretsmanager:*`
2. Extract region from ARN
3. Attempt to describe secret (does it exist?)
4. Attempt to get secret value (do we have permissions?)
5. Parse secret value as JSON
6. Validate required fields present
7. Display masked secret summary for confirmation

**When** `--benchling-secrets` **is JSON**:
1. Parse JSON (fail if invalid)
2. Validate required fields present
3. Validate field types (all strings)
4. Warn if extra fields present (forward compatibility)
5. Validate tenant format (alphanumeric/hyphens)
6. Display masked secret summary for confirmation

**When** `--benchling-secrets` **not provided**:
1. Check for Quilt stack exports
2. If exports found, validate as ARN above
3. If no exports, check for individual params
4. If individual params present, show deprecation warning
5. If nothing found, show helpful error with examples

#### Runtime Validation (Container Startup)

1. Check for secret in AWS Secrets Manager
2. If not found, check environment variables
3. If neither found, exit with clear error
4. Parse secret value as JSON
5. Validate required fields
6. Initialize Benchling client
7. Test connection (optional health check)

#### Validation Error Messages

**Missing Required Field**:
```
Error: Benchling secrets missing required field 'client_id'
Expected format: {"client_id":"...", "client_secret":"...", "tenant":"..."}
```

**Invalid ARN**:
```
Error: Invalid secret ARN format
Provided: not-an-arn
Expected: arn:aws:secretsmanager:region:account:secret:name
```

**Secret Not Found**:
```
Error: Secret not found in AWS Secrets Manager
ARN: arn:aws:secretsmanager:us-east-1:123456789012:secret:missing
Verify the secret exists and you have permissions to access it.
```

**Invalid JSON**:
```
Error: Invalid JSON in BENCHLING_SECRETS
Parse error: Unexpected token '}' at position 42
```

### 7. Configuration Update Specifications

#### Updating Secrets in Running Stack

**Method 1: Update Secret Value** (Recommended)
1. User updates secret value in AWS Secrets Manager console/CLI
2. User restarts ECS service tasks
3. Tasks fetch updated secret on startup

**Method 2: Update Stack Parameter**
1. User provides new `--benchling-secrets` value
2. User runs `deploy` command again
3. CloudFormation updates parameter
4. ECS service rolls out new tasks

**Secret Name Stability**:
- Secret name should remain constant across updates
- If secret ARN changes, stack update required
- If secret value changes, only service restart required

### 8. Integration Points

#### CDK Stack Integration

**Input**: Accept `benchlingSecrets` prop in stack constructor
- Type: `string` (ARN or JSON)
- Optional: No (required parameter)

**Output**:
- IAM policies for secret access
- ECS environment variables configuration
- CloudFormation outputs for secret ARN

#### CLI Integration

**Input**: New option `--benchling-secrets <value>`
- Accepts: ARN string, JSON string, or file path (prefixed with @)
- Environment variable: `BENCHLING_SECRETS`
- Config file: `BENCHLING_SECRETS=...`

**Output**:
- Validation results
- Masked secret summary
- Deployment confirmation

#### Container Runtime Integration

**Input**: Environment variables or Secrets Manager
- Primary: ECS injected secret values as individual env vars
- Fallback: Direct environment variables for local development

**Output**:
- Initialized Benchling API client
- Health check endpoint responds with secret status (redacted)

### 9. Monitoring and Observability

#### CloudWatch Metrics

- Secret retrieval latency
- Secret retrieval failures
- Secret validation errors
- Container startup failures due to secrets

#### CloudWatch Logs

- Secret ARN used (not value)
- Secret field names present (not values)
- Validation errors with redacted details
- Secret update events

#### Health Check Endpoint

`GET /health/secrets`

**Response**:
```json
{
  "status": "healthy",
  "secret_source": "secretsmanager",
  "secret_arn": "arn:aws:secretsmanager:...",
  "fields_present": ["client_id", "client_secret", "tenant", "app_definition_id"],
  "last_retrieved": "2025-10-30T12:34:56Z"
}
```

### 10. Documentation Specifications

#### User Documentation

**Required Sections**:
1. Secrets configuration overview
2. Three deployment scenario guides
3. Secret format reference
4. Migration guide from old parameters
5. Troubleshooting guide
6. Security best practices

#### Developer Documentation

**Required Sections**:
1. Architecture decision records (ADR)
2. Secret flow diagrams
3. Error handling patterns
4. Testing strategies
5. Local development setup

### 11. Testing Specifications

#### Unit Tests

- JSON parsing and validation
- ARN format validation
- Secret structure validation
- Error message generation
- Configuration priority logic

#### Integration Tests

- Secret creation in Secrets Manager
- Secret retrieval from Secrets Manager
- IAM policy application
- ECS task startup with secrets
- Secret update and task refresh

#### End-to-End Tests

- Full deployment with JSON secrets
- Full deployment with ARN secrets
- Full deployment with Quilt discovery
- Migration from old to new parameters
- Secret rotation scenario

### 12. Success Metrics

#### Functional Metrics

- ✅ Single parameter replaces 4+ individual parameters
- ✅ Supports all three deployment scenarios
- ✅ Zero plaintext secrets in CloudFormation
- ✅ Backward compatible with existing deployments
- ✅ Auto-discovery works for Quilt integration

#### Non-Functional Metrics

- ✅ Secret retrieval adds < 200ms to container startup
- ✅ Validation provides actionable error messages
- ✅ Documentation enables self-service migration
- ✅ Test coverage > 85% for secrets code
- ✅ Zero security vulnerabilities in secret handling

#### User Experience Metrics

- ✅ Deployment with secrets completes in single command
- ✅ Error messages clearly indicate remediation steps
- ✅ Migration guide enables smooth transition
- ✅ No manual AWS console steps required

## Technical Uncertainties and Risks

### Uncertainty 1: Quilt Stack Secret Structure

**Question**: What is Quilt's exact secret structure and naming convention?
**Impact**: Cannot implement auto-discovery without this information
**Mitigation**: Research Quilt codebase or coordinate with Quilt team
**Resolution Path**: Document in analysis phase, implement generic discovery

### Uncertainty 2: CloudFormation Parameter Encryption

**Question**: Can CloudFormation parameters with `NoEcho` truly protect secrets?
**Impact**: May still expose secrets in CloudFormation API calls
**Mitigation**: Prefer ARN references over inline secrets
**Resolution Path**: Test and document limitations, recommend ARN approach

### Uncertainty 3: Secret Value Updates

**Question**: How to force ECS tasks to fetch updated secret values?
**Impact**: Secret updates may require manual service restart
**Mitigation**: Document restart procedure, consider automated refresh
**Resolution Path**: Implement health check for secret age, document process

### Risk 1: Breaking Changes for Existing Deployments

**Probability**: Low (backward compatibility designed in)
**Impact**: High (user deployments could fail)
**Mitigation**: Deprecation warnings, migration guide, version pinning
**Contingency**: Support both old and new parameters indefinitely

### Risk 2: IAM Permission Errors

**Probability**: Medium (complex permission requirements)
**Impact**: Medium (deployment failures, runtime errors)
**Mitigation**: Clear error messages, permission testing, documentation
**Contingency**: Provide IAM policy templates, troubleshooting guide

### Risk 3: Secret Discovery Failures

**Probability**: Medium (depends on Quilt stack state)
**Impact**: Medium (failed deployments)
**Mitigation**: Graceful fallback, clear error messages
**Contingency**: Manual secret configuration always available

## Architectural Constraints

### CDK Constraints

1. Secret structure must be known at synthesis time (for ECS secret references)
2. Conditional resource creation (secret vs reference) requires CDK logic
3. Parameter values available during synthesis but not all AWS APIs

### AWS Constraints

1. Secrets Manager has eventual consistency
2. ECS task definitions are immutable (require new revision for changes)
3. IAM permission changes can take time to propagate

### Backward Compatibility Constraints

1. Existing deployments use hardcoded secret name `benchling-webhook/credentials`
2. Existing code expects specific environment variable names
3. Cannot break existing deployments during upgrade

### Security Constraints

1. Never expose secrets in CloudFormation templates
2. Never log secret values
3. Follow AWS security best practices
4. Comply with secret rotation requirements (future)

## Out of Scope

1. **Secret Rotation**: Implementation deferred to future version
2. **Multi-Environment Secrets**: Single secret per deployment (dev/staging/prod handled by separate stacks)
3. **Secret Caching**: Container fetches secrets on startup only
4. **Custom Encryption Keys**: Use AWS-managed keys initially
5. **Local Development Without AWS**: Focus on AWS deployment scenarios

## Dependencies

### External Dependencies

- AWS Secrets Manager SDK
- AWS CloudFormation SDK
- AWS IAM SDK
- AWS ECS SDK
- Commander.js for CLI parsing
- JSON schema validation library (optional)

### Internal Dependencies

- Configuration loader system
- Validation framework
- CDK construct patterns
- CLI command structure
- Error message formatting

## Success Criteria Summary

**This specification is successful if:**

1. A single `BENCHLING_SECRETS` parameter can configure all deployment scenarios
2. Secrets are never exposed in plaintext in CloudFormation or logs
3. Existing deployments continue to function with deprecation warnings
4. Quilt integration discovers secrets automatically
5. Clear documentation enables user self-service
6. Comprehensive tests validate all scenarios
7. IAM policies follow least-privilege principles
8. Error messages provide actionable remediation steps

**This specification is complete and ready for phase breakdown.**
