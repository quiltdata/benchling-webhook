# Phase 3: CDK Secret Handling Refactoring - Design Document

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Date**: 2025-10-31
**Phase**: Phase 3 - CDK Secret Handling Refactoring

## Overview

This design document defines the technical architecture for refactoring the CDK stack to accept Benchling secrets as a single consolidated CloudFormation parameter (`BENCHLING_SECRETS`) instead of multiple individual parameters. This change simplifies secret management while maintaining full backward compatibility with existing deployments.

## Reference Documents

- **Requirements**: spec/156-secrets-manager/01-requirements.md
- **Analysis**: spec/156-secrets-manager/02-analysis.md
- **Specifications**: spec/156-secrets-manager/03-specifications.md
- **Phases**: spec/156-secrets-manager/04-phases.md (Phase 3)
- **Phase 2 Design**: spec/156-secrets-manager/08-phase2-design.md

## Phase 3 Objectives

From 04-phases.md:

1. **CloudFormation Parameter Addition**: Add `BenchlingSecrets` parameter to accept consolidated JSON string
2. **Deprecate Old Parameters**: Mark individual secret parameters as deprecated while keeping them functional
3. **Container Environment Update**: Configure ECS container to use `BENCHLING_SECRETS` environment variable
4. **Backward Compatibility**: Ensure existing deployments continue to work with old parameters
5. **Stack Tests**: Update tests to validate both new and old parameter approaches

## Design Principles

### 1. Backward Compatibility First

- Existing stacks using individual parameters must continue working
- No breaking changes in this phase
- Old parameters remain functional but marked as deprecated

### 2. Test-Driven Development

- Write failing tests first for new parameter behavior
- Implement minimum code to pass tests
- Refactor while keeping tests green

### 3. Security

- Never expose secrets in CloudFormation outputs or logs
- Use proper secret handling in ECS configuration
- Maintain least-privilege IAM policies

### 4. Simplicity

- Minimize changes to existing code
- Clear parameter precedence rules
- Simple migration path for users

## Current State Analysis

### Current CloudFormation Parameters (from benchling-webhook-stack.ts)

Currently, the stack does NOT have explicit CFT parameters for Benchling secrets. Instead, the secrets are passed as stack props and used directly to create a Secrets Manager secret:

```typescript
export interface BenchlingWebhookStackProps extends cdk.StackProps {
    readonly benchlingClientId: string;
    readonly benchlingClientSecret: string;
    readonly benchlingTenant: string;
    // ... other props
}
```

### Current Secret Handling (from fargate-service.ts, lines 148-156)

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

**Problem**: Uses `unsafePlainText()` which embeds secrets in CloudFormation template.

### Current Container Environment (from fargate-service.ts, lines 180-209)

Individual environment variables and secrets:
- `BENCHLING_TENANT` - environment variable
- `BENCHLING_CLIENT_ID` - from Secrets Manager
- `BENCHLING_CLIENT_SECRET` - from Secrets Manager
- `BENCHLING_APP_DEFINITION_ID` - from Secrets Manager (optional)

## Target State Architecture

### New CloudFormation Parameter Structure

Add a single `BenchlingSecrets` parameter that accepts JSON string containing all Benchling secrets:

```typescript
const benchlingSecretsParam = new cdk.CfnParameter(this, "BenchlingSecrets", {
    type: "String",
    description: "JSON string containing Benchling secrets (client_id, client_secret, tenant, app_definition_id)",
    default: "",  // Empty default to maintain optional behavior
    noEcho: true, // Prevent CloudFormation from displaying the value
});
```

### Parameter Precedence Logic

1. If `BenchlingSecrets` parameter is provided (non-empty), use it exclusively
2. If `BenchlingSecrets` is empty, fall back to individual parameters for backward compatibility
3. Display deprecation warning if both are provided (handled in CLI, not CDK)

### Updated Container Environment Configuration

Instead of individual secret references, pass a single `BENCHLING_SECRETS` environment variable:

```typescript
environment: {
    BENCHLING_SECRETS: benchlingSecretsParam.valueAsString,
    // ... other env vars
}
```

**Note**: We use environment variable (not ECS secret) because the secrets are already being handled securely through CloudFormation's `noEcho` feature. The container application will parse the JSON and handle secrets appropriately.

### Backward Compatibility Approach

Keep old parameters but mark as deprecated:

```typescript
// Deprecated parameters (kept for backward compatibility)
const benchlingClientIdParam = new cdk.CfnParameter(this, "BenchlingClientId", {
    type: "String",
    description: "[DEPRECATED] Use BenchlingSecrets parameter instead",
    default: "",
    noEcho: true,
});

const benchlingClientSecretParam = new cdk.CfnParameter(this, "BenchlingClientSecret", {
    type: "String",
    description: "[DEPRECATED] Use BenchlingSecrets parameter instead",
    default: "",
    noEcho: true,
});

const benchlingTenantParam = new cdk.CfnParameter(this, "BenchlingTenant", {
    type: "String",
    description: "[DEPRECATED] Use BenchlingSecrets parameter instead",
    default: "",
});
```

### Secrets Manager Secret Creation Logic

Two modes of operation:

**Mode 1: New Parameter (BenchlingSecrets provided)**
- Parse JSON from `BenchlingSecrets` parameter
- Create Secrets Manager secret with parsed values
- Use proper `SecretValue` methods (no `unsafePlainText()`)

**Mode 2: Old Parameters (backward compatibility)**
- Use individual parameters to create secret
- Continue using existing logic
- Display deprecation notice in CDK output

```typescript
const useNewParam = benchlingSecretsParam.valueAsString !== "";

let secretValue: { [key: string]: cdk.SecretValue };

if (useNewParam) {
    // New approach: Parse JSON string into individual secret values
    // Note: We can't parse JSON in CDK synthesis, so we'll create the secret
    // with a reference to the parameter and let CloudFormation resolve it
    secretValue = {
        // CloudFormation will resolve this as a JSON string
        benchling_secrets: cdk.SecretValue.cfnParameter(benchlingSecretsParam),
    };
} else {
    // Old approach: Individual parameters (deprecated)
    secretValue = {
        client_id: cdk.SecretValue.cfnParameter(benchlingClientIdParam),
        client_secret: cdk.SecretValue.cfnParameter(benchlingClientSecretParam),
        tenant: cdk.SecretValue.cfnParameter(benchlingTenantParam),
    };
}
```

## Implementation Strategy

### File Changes Required

1. **lib/benchling-webhook-stack.ts**
   - Add `BenchlingSecrets` CFT parameter
   - Add backward compatibility parameters (marked deprecated)
   - Update props interface to accept optional `benchlingSecrets` JSON string
   - Pass new parameter to FargateService construct

2. **lib/fargate-service.ts**
   - Update props interface to accept `benchlingSecrets?: string`
   - Modify Secrets Manager secret creation to support both modes
   - Remove `unsafePlainText()` usage
   - Update container environment configuration to use `BENCHLING_SECRETS`

3. **bin/commands/deploy.ts**
   - Update parameter passing logic to include new `BenchlingSecrets` parameter
   - Pass `benchlingSecrets` value from config to stack props

4. **test/benchling-webhook-stack.test.ts**
   - Add tests for new parameter structure
   - Add tests for backward compatibility mode
   - Add tests to verify no `unsafePlainText()` usage
   - Verify container environment has `BENCHLING_SECRETS` variable

### CloudFormation Parameter Mapping

CLI configuration to CloudFormation parameters:

| Config Source | CFT Parameter | Value Format |
| -------------- | --------------- | -------------- |
| `--benchling-secrets` (JSON) | `BenchlingSecrets` | JSON string |
| `--benchling-secrets` (ARN) | `BenchlingSecrets` | JSON string (resolved from ARN) |
| Individual flags (deprecated) | `BenchlingClientId`, etc. | Individual strings |

**Important**: The CLI will resolve ARN references before passing to CDK, so the CDK always receives JSON strings or empty strings.

## IAM and Security Considerations

### Secrets Manager Permissions

No changes required to IAM policies. The task role already has:
- `secretsmanager:GetSecretValue` for reading secrets
- Proper resource restrictions

### CloudFormation Parameter Security

- Use `noEcho: true` for all secret parameters
- Prevents display in CloudFormation console
- Prevents exposure in CloudFormation events
- Stack updates still work (values are preserved)

### Container Secret Access

The container application will:
1. Check for `BENCHLING_SECRETS` environment variable
2. Parse JSON to extract individual secrets
3. Use parsed values for Benchling API authentication
4. Fall back to individual env vars if `BENCHLING_SECRETS` not present (Phase 6)

## Testing Strategy

### Unit Tests

1. **New Parameter Tests**
   - Verify `BenchlingSecrets` parameter exists in template
   - Verify parameter has `noEcho: true`
   - Verify container receives `BENCHLING_SECRETS` environment variable

2. **Backward Compatibility Tests**
   - Verify old parameters still exist
   - Verify old parameters marked as deprecated
   - Verify container still works with old parameters

3. **Secrets Manager Tests**
   - Verify secret is created
   - Verify no `unsafePlainText()` in template
   - Verify proper `SecretValue` usage

4. **IAM Tests**
   - Verify task role has Secrets Manager read permissions
   - Verify least-privilege access

### Integration Tests

1. **New Parameter Deployment**
   - Deploy stack with `BenchlingSecrets` parameter
   - Verify container starts successfully
   - Verify container can access secrets

2. **Backward Compatible Deployment**
   - Deploy stack with old individual parameters
   - Verify container starts successfully
   - Verify no breaking changes

3. **Parameter Update Test**
   - Deploy with old parameters
   - Update to new parameter via stack update
   - Verify seamless transition

## Migration Path for Users

### Phase 3 Scope
This phase only adds infrastructure support. User-facing migration happens in later phases.

For Phase 3:
- Infrastructure supports both old and new parameters
- No user action required
- Existing deployments continue working unchanged

### Future Phases
- Phase 4: CLI creates Secrets Manager secret from JSON input
- Phase 5: Auto-discovery from Quilt stack
- Phase 6: Runtime fallback for local development
- Phase 7: Documentation and migration guide

## Deprecation Strategy

### Phase 3 (This Phase)
- Add deprecation notices to parameter descriptions in CFT
- Mark old parameters with "[DEPRECATED]" prefix
- Keep full functionality of old parameters

### Future Phases
- Phase 7: Add migration guide documentation
- Phase 8: Remove old parameters in v1.0.0 release

## Risk Mitigation

### Risk: Breaking Existing Deployments

**Mitigation**:
- Maintain full backward compatibility
- Keep old parameters functional
- Test with both parameter styles
- Add comprehensive integration tests

### Risk: Secret Exposure

**Mitigation**:
- Use `noEcho: true` on all secret parameters
- Avoid logging secret values
- Use proper CloudFormation secret handling
- Remove `unsafePlainText()` usage

### Risk: Container Startup Failures

**Mitigation**:
- Container app already supports individual env vars (Phase 6 will add JSON support)
- Gradual rollout approach
- Comprehensive health checks
- Circuit breaker for failed deployments

### Risk: CloudFormation Template Changes

**Mitigation**:
- Test CloudFormation updates with existing stacks
- Verify parameter updates work correctly
- Test rollback scenarios
- Use CDK assertions to validate template structure

## Success Criteria

1. Stack accepts `BenchlingSecrets` CloudFormation parameter
2. Stack accepts old individual parameters for backward compatibility
3. Old parameters marked as deprecated in descriptions
4. Container receives `BENCHLING_SECRETS` environment variable when new parameter used
5. Container receives individual env vars when old parameters used
6. No `unsafePlainText()` usage in CDK code
7. All tests pass (unit and integration)
8. Existing deployments continue to work
9. Stack updates work for both parameter styles
10. IAM permissions are correct and least-privilege

## Non-Goals for Phase 3

These are explicitly out of scope for this phase:

- Creating Secrets Manager secrets from CLI (Phase 4)
- Quilt stack auto-discovery (Phase 5)
- Container runtime secret parsing from JSON (Phase 6)
- User documentation and migration guide (Phase 7)
- Removing old parameters (Phase 8)

Phase 3 focuses solely on CDK infrastructure changes to support the new parameter structure while maintaining backward compatibility.

## Related Documents

- **Next**: spec/156-secrets-manager/12-phase3-episodes.md (Implementation episodes)
- **Then**: spec/156-secrets-manager/13-phase3-checklist.md (Implementation checklist)

## Summary

Phase 3 refactors the CDK stack to support consolidated Benchling secrets through a single `BenchlingSecrets` CloudFormation parameter while maintaining full backward compatibility with existing individual parameters. This creates the infrastructure foundation for later phases to build upon, enabling simpler secret management and better security practices.

The key innovation is supporting both modes of operation simultaneously, allowing gradual migration of existing deployments without breaking changes. All secrets are properly handled with `noEcho` and secure CloudFormation practices, removing the need for `unsafePlainText()` usage.
