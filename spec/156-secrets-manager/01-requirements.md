# Requirements Analysis - Issue #156: Secrets Manager

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Date**: 2025-10-30
**Phase**: I RASP - Requirements

## Problem Statement

The current secrets management approach for the Benchling Webhook integration lacks consistency across three deployment scenarios (Local Development, Standalone Stack, Quilt Stack). Each scenario uses different mechanisms to access secrets, creating complexity in configuration management, potential security vulnerabilities, and maintenance challenges.

## User Stories

### Story 1: Developer Local Configuration
**As a** developer working on the Benchling Webhook integration locally
**I want** a unified approach to provide Benchling secrets during local development
**So that** I can test webhook functionality without deploying to AWS and without hardcoding sensitive values

**Acceptance Criteria**:
1. Local development supports reading secrets from environment variables
2. Local development provides clear error messages when secrets are missing
3. Documentation clearly explains how to configure local secrets
4. No secrets are committed to version control

### Story 2: Standalone Stack Deployment
**As a** user deploying the Standalone Stack to AWS
**I want** a simple way to provide Benchling secrets during deployment
**So that** I can deploy the webhook without manually creating AWS Secrets Manager resources

**Acceptance Criteria**:
1. Single configuration parameter accepts all required Benchling secrets
2. Deployment process creates/updates AWS Secrets Manager with provided secrets
3. Lambda functions retrieve secrets from AWS Secrets Manager at runtime
4. Fallback to environment variables if Secrets Manager is unavailable
5. Clear error messages guide users on secret configuration

### Story 3: Quilt Stack Integration
**As a** Quilt administrator deploying the integrated Benchling-Quilt stack
**I want** the webhook to discover existing Quilt-managed secrets
**So that** I don't need to duplicate secret configuration across systems

**Acceptance Criteria**:
1. Webhook automatically discovers Quilt's Benchling secrets in AWS Secrets Manager
2. Clear documentation explains secret naming conventions and discovery process
3. Fallback to environment variables if Secrets Manager lookup fails
4. No manual secret duplication required

### Story 4: CLI Configuration Simplicity
**As a** user interacting with the deployment CLI
**I want** an intuitive option to provide secrets during deployment
**So that** I can complete deployment in a single step without separate AWS console operations

**Acceptance Criteria**:
1. CLI provides `--benchling-secrets` option accepting JSON or file path
2. CLI validates secret format before deployment
3. CLI provides helpful examples and documentation
4. CLI supports interactive prompts for missing secrets
5. CLI masks secret values in output logs

### Story 5: Migration from Current Implementation
**As a** maintainer of the Benchling Webhook codebase
**I want** to deprecate individual CloudFormation parameters
**So that** the codebase is simpler and more maintainable

**Acceptance Criteria**:
1. Existing individual CFT parameters are deprecated but still functional
2. Migration guide explains how to transition to new approach
3. Warning messages inform users of deprecated parameters
4. Future version removes deprecated parameters
5. All tests updated to use new secrets approach

## High-Level Implementation Approach

### Configuration Layer
- Add `BENCHLING_SECRETS` parameter to CloudFormation template as primary configuration
- Maintain backward compatibility with existing individual parameters during transition
- Add CLI option `--benchling-secrets` to accept JSON string or file path

### Runtime Secrets Resolution
Implement a hierarchical secrets resolution strategy:
1. **Primary**: AWS Secrets Manager lookup (configured via `BENCHLING_SECRETS` or discovered from Quilt)
2. **Fallback**: Environment variables
3. **Error**: Clear error messages with configuration guidance

### Deployment Scenarios
- **Local**: Read from environment variables exclusively
- **Standalone**: Accept secrets via CLI, store in Secrets Manager, retrieve at runtime
- **Quilt**: Discover existing Secrets Manager secret, retrieve at runtime

### Security Considerations
- Never log or expose secret values in plain text
- Use AWS IAM policies to control Secrets Manager access
- Validate secret format and required fields
- Support secret rotation through Secrets Manager

## Success Criteria

1. **Unified Interface**: Single `BENCHLING_SECRETS` parameter replaces multiple individual parameters
2. **Deployment Simplicity**: Users can deploy with secrets in a single CLI command
3. **Local Development**: Developers can test locally using environment variables
4. **Quilt Integration**: Automatic discovery eliminates duplicate configuration
5. **Security**: No secrets in logs, code, or version control
6. **Backward Compatibility**: Existing deployments continue to function during migration
7. **Documentation**: Clear guides for all three deployment scenarios
8. **Test Coverage**: Comprehensive tests validate all scenarios and error conditions

## Open Questions

1. **Secret Format**: What is the exact JSON schema for `BENCHLING_SECRETS`? Should it include:
   - Benchling API URL
   - Benchling API key/token
   - Tenant identifier
   - Other Benchling-specific configuration?

2. **Quilt Discovery**: How does Quilt currently name and structure Benchling secrets in AWS Secrets Manager? What is the discovery mechanism?

3. **Migration Timeline**: What is the deprecation and removal timeline for individual CFT parameters?

4. **Secret Rotation**: Should the implementation support AWS Secrets Manager rotation for Benchling credentials?

5. **Multi-Environment**: Do users need to support multiple Benchling environments (dev/staging/prod) in a single deployment?

6. **CLI Validation**: What specific validations should the CLI perform on secret values before deployment?

7. **Error Recovery**: What should happen if Secrets Manager is unavailable at runtime? Should there be caching or retry logic?

8. **Existing Deployments**: How should existing deployments migrate? Should there be an automated migration path?

## References

- GitHub Issue: #156
- Current CloudFormation Template: (to be analyzed in Step 2)
- Current Lambda Secret Handling: (to be analyzed in Step 2)
- CLI Implementation: (to be analyzed in Step 2)
