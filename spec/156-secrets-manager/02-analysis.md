# Analysis - Issue #156: Secrets Manager

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Date**: 2025-10-30
**Phase**: I RASP - Analysis

## Current State Overview

The Benchling Webhook integration currently manages secrets through three distinct mechanisms across different deployment scenarios, creating inconsistency and complexity in the codebase.

## Current Architecture

### 1. CDK Stack Infrastructure

**File**: `/Users/ernest/GitHub/benchling-webhook/lib/benchling-webhook-stack.ts`

The CDK stack accepts Benchling credentials as constructor properties:
- `benchlingClientId: string`
- `benchlingClientSecret: string`
- `benchlingTenant: string`

These values are NOT CloudFormation parameters, meaning they must be provided at stack synthesis time and cannot be updated without redeploying the stack.

### 2. Fargate Service Secret Management

**File**: `/Users/ernest/GitHub/benchling-webhook/lib/fargate-service.ts` (lines 147-159)

The Fargate service creates an AWS Secrets Manager secret:

```typescript
const benchlingSecret = new secretsmanager.Secret(this, "BenchlingCredentials", {
    secretName: "benchling-webhook/credentials",
    description: "Benchling API credentials for webhook processor",
    secretObjectValue: {
        client_id: cdk.SecretValue.unsafePlainText(props.benchlingClientId),
        client_secret: cdk.SecretValue.unsafePlainText(props.benchlingClientSecret),
    },
});
```

**Key Issues**:
- Uses `unsafePlainText()` which defeats the purpose of Secrets Manager
- Creates secret from plaintext props passed at deployment time
- Secret name is hardcoded as `benchling-webhook/credentials`
- No support for pre-existing secrets (Quilt integration scenario)
- App Definition ID is added to secrets but not stored in Secrets Manager (lines 205-208)

### 3. Container Environment Configuration

**File**: `/Users/ernest/GitHub/benchling-webhook/lib/fargate-service.ts` (lines 196-208)

The container receives secrets via ECS Secrets:

```typescript
secrets: {
    BENCHLING_CLIENT_ID: ecs.Secret.fromSecretsManager(benchlingSecret, "client_id"),
    BENCHLING_CLIENT_SECRET: ecs.Secret.fromSecretsManager(benchlingSecret, "client_secret"),
    BENCHLING_APP_DEFINITION_ID: ecs.Secret.fromSecretsManager(benchlingSecret, "app_definition_id"),
}
```

**Key Issues**:
- `app_definition_id` is referenced but never written to the secret (missing field)
- No fallback to environment variables
- Tightly coupled to specific secret structure

### 4. CLI Configuration System

**File**: `/Users/ernest/GitHub/benchling-webhook/lib/utils/config.ts`

The configuration loader supports multiple sources:
1. CLI options (highest priority)
2. Environment variables
3. `.env` file
4. `quilt3 config` (for catalog only)
5. Inferred values from catalog

**Current CLI Options** (from `/Users/ernest/GitHub/benchling-webhook/bin/cli.ts`):
- `--tenant <name>`
- `--client-id <id>`
- `--client-secret <secret>`
- `--app-id <id>`

Each credential is a separate CLI parameter.

### 5. Deployment Flow

**File**: `/Users/ernest/GitHub/benchling-webhook/bin/commands/deploy.ts`

Current deployment process:
1. Load config from multiple sources (lines 30-48)
2. Validate configuration (lines 50-68)
3. Display deployment plan with masked secrets (line 124)
4. Synthesize CDK stack with plaintext secrets (line 161)
5. Deploy via CDK with parameters (lines 174-198)

**Key Issues**:
- Secrets are passed as plaintext props to CDK constructs
- No support for passing secrets as a single JSON object
- CloudFormation parameters are created for runtime values but not for secrets

## Existing Code Idioms

### 1. Configuration Management Pattern

The codebase uses a multi-layered configuration approach:
- TypeScript interfaces define configuration schemas (`Config`, `ConfigOptions`)
- `loadConfigSync()` merges multiple sources with priority
- `validateConfig()` provides detailed validation with help text
- CLI options use descriptive names with Commander.js

### 2. CloudFormation Parameter Pattern

**File**: `/Users/ernest/GitHub/benchling-webhook/lib/benchling-webhook-stack.ts` (lines 44-130)

Runtime-configurable values use `CfnParameter`:
```typescript
const webhookAllowListParam = new cdk.CfnParameter(this, "WebhookAllowList", {
    type: "String",
    description: "...",
    default: props.value || "",
});
```

This pattern allows post-deployment updates via CloudFormation console.

### 3. Error Handling and User Guidance

**File**: `/Users/ernest/GitHub/benchling-webhook/lib/utils/config.ts` (lines 185-298)

Comprehensive validation with:
- Detailed error messages
- Contextual help text
- Distinction between user-provided vs inferred values
- CLI-friendly formatting

### 4. AWS Resource Naming Conventions

- Secret name: `benchling-webhook/credentials`
- Log group: `/ecs/benchling-webhook`
- Service name: `benchling-webhook-service`
- Stack name: `BenchlingWebhookStack`

Pattern: lowercase with hyphens, descriptive resource-type suffixes.

## Current System Constraints

### 1. Deployment Model Constraints

**Standalone Deployment**:
- User provides credentials via CLI/env vars
- CDK creates new Secrets Manager secret with plaintext
- Fargate retrieves from newly created secret

**Quilt Integration**:
- Quilt stack pre-creates Benchling secrets
- Current code CANNOT discover or use existing secrets
- Forces duplicate secret configuration

**Local Development**:
- No lambda function in this architecture (uses Fargate)
- Local development requires full AWS deployment
- Cannot test webhook processing locally without AWS resources

### 2. CDK Synthesis Constraints

- Secrets must be known at `cdk synth` time
- Cannot reference existing Secrets Manager secrets by name/ARN
- Cannot defer secret resolution to deployment or runtime

### 3. Security Constraints

- Secrets passed as plaintext through CDK props
- `unsafePlainText()` bypasses CloudFormation encryption
- Secrets visible in CloudFormation template (though marked as `NoEcho` would help)
- No support for secret rotation

### 4. IAM Permissions

**Current Grants** (lines 159):
- Task role has `secretsmanager:GetSecretValue` on created secret
- No permissions for discovering secrets
- No permissions for listing secrets by tags/prefix

## Architectural Challenges

### Challenge 1: Secret Creation vs Reference

**Current**: CDK always creates a new secret from plaintext props
**Needed**: Conditionally create OR reference existing secret

**Constraints**:
- CDK requires secret structure known at synth time
- Cannot conditionally create resources based on runtime checks
- Quilt's secret structure may differ from hardcoded structure

### Challenge 2: Plaintext Secret Exposure

**Current**: `unsafePlainText()` exposes secrets in CloudFormation
**Needed**: Secrets never in plaintext in templates

**Options**:
- Use `CfnParameter` with `NoEcho: true`
- Reference pre-existing secrets by ARN
- Accept secret ARN instead of secret values

### Challenge 3: Single Parameter for Multiple Secrets

**Current**: Each secret field is separate prop/param
**Needed**: Single `BENCHLING_SECRETS` parameter

**Challenges**:
- CloudFormation parameter must be a string
- JSON structure needs parsing in CDK or Lambda
- Validation of JSON structure before deployment
- Backward compatibility with existing individual parameters

### Challenge 4: Quilt Secret Discovery

**Current**: No mechanism to discover existing secrets
**Needed**: Auto-detect Quilt's Benchling secrets

**Unknown**:
- Quilt's secret naming convention (need to research)
- Quilt's secret JSON structure
- How to distinguish Quilt vs standalone deployments
- Whether Quilt uses tags/metadata for secret discovery

### Challenge 5: Local Development Fallback

**Current**: Hard dependency on Secrets Manager
**Needed**: Fallback to environment variables locally

**Challenge**:
- Container code must handle both secret sources
- Clear error messages when both are unavailable
- No environment variable fallback currently implemented

### Challenge 6: App Definition ID Storage

**Current**: App Definition ID referenced but not stored (lines 205-208)
**Issue**: Container expects `BENCHLING_APP_DEFINITION_ID` from secret but it's never written

**Needed**:
- Include `app_definition_id` in secret structure
- Handle optional vs required fields
- Backward compatibility for secrets without this field

## Technical Debt Assessment

### High Priority

1. **Unsafe Plaintext Secrets**: `unsafePlainText()` usage violates AWS security best practices
2. **Missing App Definition ID**: Code references field that doesn't exist in secret
3. **No Quilt Integration**: Cannot use pre-existing Quilt secrets
4. **No Local Development**: Cannot test without full AWS deployment

### Medium Priority

1. **Parameter Proliferation**: Many individual secrets create deployment complexity
2. **Hardcoded Secret Name**: Cannot customize secret location
3. **No Secret Rotation**: Static secrets with no rotation support
4. **Limited Error Handling**: Secret retrieval failures not gracefully handled

### Low Priority

1. **Secret Caching**: Container may retrieve secrets on every request
2. **Multi-Environment**: No support for dev/staging/prod environments
3. **Audit Logging**: Limited visibility into secret access patterns

## Gap Analysis

### Requirements vs Current State

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| Single `BENCHLING_SECRETS` parameter | Individual parameters per secret | Major refactoring needed |
| CLI `--benchling-secrets` option | Individual CLI options | New option + validation |
| Quilt secret discovery | No discovery mechanism | Need research + implementation |
| Environment variable fallback | No fallback | Runtime code changes |
| Local development support | AWS-only | Architecture change needed |
| Backward compatibility | N/A | Migration strategy required |
| Security best practices | `unsafePlainText()` | Use proper secret references |

## Design Considerations for Next Phase

### 1. Secret Parameter Approaches

**Option A: Secret ARN Parameter**
- User provides ARN of pre-existing secret
- CDK references secret by ARN
- Pros: Secure, supports Quilt integration
- Cons: User must create secret first

**Option B: JSON String Parameter**
- User provides JSON with all credentials
- CDK creates secret from parameter value
- Pros: Single parameter, familiar pattern
- Cons: Still plaintext in CloudFormation

**Option C: Hybrid Approach**
- Accept either secret ARN OR JSON string
- Auto-detect based on format (arn:aws:secretsmanager:... vs {})
- Pros: Maximum flexibility
- Cons: Complex validation logic

### 2. Quilt Integration Approaches

**Option A: Convention-Based Discovery**
- Assume Quilt secret name: `quilt/benchling-credentials`
- Try to lookup, fallback to creating new
- Pros: Zero configuration
- Cons: Brittle if Quilt changes naming

**Option B: Explicit Configuration**
- Add `--quilt-mode` flag indicating Quilt stack
- Add `--benchling-secret-arn` for explicit reference
- Pros: Explicit, debuggable
- Cons: More configuration burden

**Option C: Stack Parameter Detection**
- Detect Quilt stack via CloudFormation exports
- Query exports for secret ARN
- Pros: Automatic, reliable
- Cons: Complex cross-stack dependencies

### 3. Backward Compatibility Strategy

**Phase 1**: Add new parameter while keeping old ones
**Phase 2**: Deprecation warnings for old parameters
**Phase 3**: Remove old parameters in major version

Alternative: Support both forever, document new approach as preferred

## Dependencies and Integration Points

### External Dependencies

1. **AWS Secrets Manager SDK**: Secret creation/retrieval
2. **CloudFormation**: Parameter handling and stack updates
3. **CDK Constructs**: Secret resource types
4. **ECS Secrets**: Container secret injection
5. **IAM Policies**: Secret access permissions

### Internal Integration Points

1. **CDK Stack Constructor**: Accepts secret configuration
2. **Fargate Service**: Creates/references secrets
3. **CLI Deploy Command**: Accepts and validates secrets
4. **Config Loader**: Loads secrets from various sources
5. **Config Validator**: Validates secret format and content

### Cross-Repository Dependencies

1. **Quilt Stack**: May provide pre-existing secrets (need to confirm structure)
2. **Benchling API**: Secret values must match Benchling OAuth configuration
3. **ECS Task Definition**: Secret environment variable names

## Summary

The current secrets management implementation has three major architectural gaps:

1. **Inflexibility**: Hardcoded secret creation with no support for pre-existing secrets
2. **Security**: Plaintext secrets flow through CDK synthesis and CloudFormation
3. **Complexity**: Multiple individual parameters instead of unified configuration

The primary challenge is balancing security (not exposing secrets in CloudFormation), flexibility (supporting multiple deployment scenarios), and simplicity (single parameter configuration) while maintaining backward compatibility with existing deployments.

The next phase (Specifications) must define the desired end state that addresses these gaps while working within CDK's constraints and maintaining the codebase's existing patterns for configuration management, validation, and error handling.
