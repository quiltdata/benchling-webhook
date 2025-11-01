# Requirements - Secrets-Only Architecture

**Spec**: 156a-secrets-only
**Date**: 2025-10-31
**Status**: Design Phase

## Problem Statement

The current secrets management implementation (spec/156-secrets-manager) is **flawed and untestable** due to:

1. **Too many environment variables**: The container accepts multiple individual Benchling parameters (BENCHLING_TENANT, BENCHLING_CLIENT_ID, BENCHLING_CLIENT_SECRET, BENCHLING_APP_DEFINITION_ID), plus Quilt parameters (QUILT_CATALOG, QUILT_USER_BUCKET, QUILT_DATABASE, QUEUE_ARN), creating complexity in configuration management and testing.

2. **Complex inference logic**: The system tries to infer configuration from multiple sources (environment variables, .env files, Quilt stack exports, individual parameters), making it difficult to reason about what configuration will be used.

3. **Difficult to test with Docker**: Local Docker testing requires either:
   - Setting up many environment variables individually
   - Creating a complex .env file
   - Manually coordinating AWS Secrets Manager with local environment

4. **Configuration state scattered across multiple layers**: Configuration can come from CLI, environment variables, .env files, Quilt inference, and AWS Secrets Manager, making debugging nearly impossible.

## Core Principle

**Radical Simplification**: The Docker container should accept ONLY TWO environment variables, with ALL other configuration derived or retrieved from AWS Secrets Manager.

## Requirements

### R1: Minimal Container Environment Variables

The Docker container MUST accept ONLY these two environment variables:

1. **QuiltStackARN**: AWS CloudFormation stack ARN used to infer:
   - AWS Region (from ARN structure)
   - QuiltWebHost (from stack outputs/exports)
   - Quilt Database name (from stack outputs/exports)
   - SQS Queue ARN (from stack outputs/exports)
   - Quilt User Bucket (from stack outputs/exports)
   - AWS Account ID (from ARN structure)

2. **BenchlingSecret**: Name or ARN of AWS Secrets Manager secret containing:
   - client_id
   - client_secret
   - tenant
   - app_definition_id (optional)
   - api_url (optional)

### R2: No Other Environment Variables

The container MUST NOT accept or rely on any other environment variables for configuration (except standard Docker/AWS variables like AWS_REGION which may be set automatically by ECS).

### R3: Local Mock Testing Unchanged

Local mock testing (without Docker) remains unchanged:
- Uses environment variables directly
- No AWS Secrets Manager required
- No Docker container required
- Jest tests continue to work with mocked dependencies

### R4: Local Docker Testing Requires Secret Setup

Local Docker testing requires:
1. User manually creates an AWS Secrets Manager secret with Benchling credentials
2. User manually creates or references a Quilt CloudFormation stack
3. User passes `QuiltStackARN` and `BenchlingSecret` to Docker container
4. Container retrieves all other configuration from AWS

### R5: Derivation Rules from QuiltStackARN

Given a QuiltStackARN like:
```
arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc123
```

The system MUST derive:
- **AWS Region**: `us-east-1` (from ARN)
- **AWS Account**: `123456789012` (from ARN)
- **Stack Name**: `QuiltStack` (from ARN)

Then query CloudFormation Stack Outputs/Exports for:
- **QuiltWebHost**: Look for output key `QuiltCatalog` or similar
- **Quilt Database**: Look for output key `DatabaseName` or similar
- **Queue ARN**: Look for output key `QueueArn` or similar
- **User Bucket**: Look for output key `UserBucket` or similar

### R6: Error Handling

The system MUST provide clear, actionable error messages for:
- Invalid QuiltStackARN format
- Stack not found or inaccessible
- Missing required stack outputs
- Invalid BenchlingSecret name/ARN
- Secret not found or inaccessible
- Secret missing required fields

### R7: Backward Compatibility NOT Required

This is a **breaking change**. The new architecture does NOT need to maintain backward compatibility with:
- Individual Benchling environment variables
- Multiple configuration sources
- .env file inference for deployed containers

Backward compatibility is ONLY required for:
- Local mock testing (non-Docker)
- Test suite behavior

## Success Criteria

1. ✅ Container accepts EXACTLY 2 environment variables: `QuiltStackARN` and `BenchlingSecret`
2. ✅ All other configuration derived from AWS CloudFormation and Secrets Manager
3. ✅ Local mock tests continue to work without modification
4. ✅ Local Docker tests work by manually configuring AWS resources
5. ✅ Clear documentation for setting up local Docker testing
6. ✅ Clear error messages guide users when configuration is invalid
7. ✅ Deployed containers (ECS/Fargate) work seamlessly with minimal environment variable configuration

## Non-Requirements

The following are explicitly OUT OF SCOPE:

1. ❌ Supporting multiple configuration sources (only AWS CloudFormation + Secrets Manager)
2. ❌ Inferring configuration from .env files in deployed containers
3. ❌ Supporting individual environment variables for Benchling/Quilt configuration
4. ❌ Backward compatibility with old deployment approach
5. ❌ Auto-discovery of secrets (user must explicitly provide BenchlingSecret)
6. ❌ Support for non-Quilt deployments (QuiltStackARN is required)

## Open Questions

1. **Q: What are the exact CloudFormation output/export key names used by Quilt stacks?**
   - A: Need to analyze Quilt CDK stack code to determine standard output names

2. **Q: Should BenchlingSecret accept both secret name and full ARN?**
   - A: Yes, support both formats:
     - Simple name: `my-benchling-creds` (assumes same region as QuiltStack)
     - Full ARN: `arn:aws:secretsmanager:us-east-1:123456789012:secret:my-benchling-creds`

3. **Q: What happens if QuiltStack outputs are missing?**
   - A: Fail fast with clear error message indicating which output is missing and how to fix it

4. **Q: How do we handle AWS credentials for accessing CloudFormation and Secrets Manager?**
   - A: Rely on standard AWS SDK credential chain:
     - ECS task role (in production)
     - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) for local Docker
     - IAM role for local development

5. **Q: Should we cache CloudFormation outputs to avoid repeated API calls?**
   - A: Yes, retrieve once at container startup and cache for the lifetime of the container

## Dependencies

- AWS SDK for JavaScript v3:
  - `@aws-sdk/client-cloudformation`
  - `@aws-sdk/client-secrets-manager`
- Existing Config class (will be heavily refactored)
- Existing secrets validation logic (can be reused)

## Next Steps

1. Analyze Quilt CDK stack to determine output key names → spec/156a-secrets-only/02-analysis.md
2. Design new Config class architecture → spec/156a-secrets-only/03-architecture.md
3. Define testing strategy → spec/156a-secrets-only/04-testing-strategy.md
4. Create implementation plan → spec/156a-secrets-only/05-implementation-plan.md
5. Execute implementation
6. Verify with local mock tests
7. Verify with local Docker tests
