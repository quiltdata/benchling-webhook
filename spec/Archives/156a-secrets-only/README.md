# Spec 156a: Secrets-Only Architecture

**Status**: Design Complete - Ready for Implementation
**Created**: 2025-10-31
**Supersedes**: spec/156-secrets-manager (flawed and untestable)

## Overview

This specification defines a **radically simplified** secrets management architecture where the Docker container accepts ONLY 2 environment variables, with ALL other configuration derived from AWS CloudFormation and Secrets Manager.

## The Problem

The current implementation (spec/156-secrets-manager) is **flawed and untestable** because:

- ❌ Accepts 10+ environment variables
- ❌ Complex multi-source configuration loading (CLI, env vars, .env files, inference)
- ❌ Difficult to test with Docker locally
- ❌ Hard to debug configuration issues
- ❌ Configuration state scattered across multiple layers

## The Solution

**Radical Simplification**: Accept ONLY these 2 environment variables:

1. **`QuiltStackARN`**: CloudFormation stack ARN
   - Example: `arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123`
   - Used to derive: region, account, stack name
   - Query for: database, queue ARN, user bucket, catalog URL

2. **`BenchlingSecret`**: Secrets Manager secret name or ARN
   - Example: `my-benchling-creds` or `arn:aws:secretsmanager:...`
   - Contains: client_id, client_secret, tenant, app_definition_id

## Key Benefits

✅ **Testable**: Easy to set up local Docker testing
✅ **Simple**: Only 2 env vars vs. 10+
✅ **Debuggable**: Single source of truth (AWS)
✅ **Secure**: All secrets in Secrets Manager
✅ **Maintainable**: Less code, clearer logic
✅ **Flexible**: Update config by updating CloudFormation or secret

## Architecture Comparison

### Current (156-secrets-manager)
```bash
# Requires 10+ environment variables
export QUILT_CATALOG=my-catalog.com
export QUILT_USER_BUCKET=my-bucket
export QUILT_DATABASE=my_db
export QUEUE_ARN=arn:aws:sqs:...
export BENCHLING_TENANT=mycompany
export BENCHLING_CLIENT_ID=xxx
export BENCHLING_CLIENT_SECRET=yyy
export BENCHLING_APP_DEFINITION_ID=zzz
export CDK_DEFAULT_ACCOUNT=123456789012
export CDK_DEFAULT_REGION=us-east-1
# ... and more

docker run --env-file .env benchling-webhook
```

### Proposed (156a-secrets-only)
```bash
# Create secret once
aws secretsmanager create-secret \
  --name my-benchling-creds \
  --secret-string '{"client_id":"xxx","client_secret":"yyy","tenant":"mycompany"}'

# Run with just 2 env vars
docker run \
  -e QuiltStackARN='arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/abc' \
  -e BenchlingSecret='my-benchling-creds' \
  benchling-webhook
```

## Configuration Flow

```
Container Startup
    │
    ├─> Read QuiltStackARN env var
    │   └─> Parse ARN → extract region, account, stack name
    │   └─> Query CloudFormation API → get stack outputs
    │       └─> Extract: database, queue ARN, bucket, catalog
    │
    ├─> Read BenchlingSecret env var
    │   └─> Query Secrets Manager API → get secret value
    │       └─> Parse JSON → extract client_id, client_secret, tenant
    │
    └─> Assemble complete configuration
        └─> Initialize application
```

## Document Structure

1. **[01-requirements.md](./01-requirements.md)**: Core requirements and success criteria
2. **[02-analysis.md](./02-analysis.md)**: Current implementation analysis and comparison
3. **[03-architecture.md](./03-architecture.md)**: Detailed design and component specifications
4. **[04-testing-strategy.md](./04-testing-strategy.md)**: Testing approach for mock and Docker testing
5. **[05-implementation-plan.md](./05-implementation-plan.md)**: Step-by-step implementation guide

## Key Design Decisions

### 1. Runtime Configuration Resolution

**Decision**: Resolve configuration at container startup, not at deployment time

**Rationale**:
- Simplifies CLI deployment (fewer parameters)
- Allows configuration updates without redeployment
- Makes container self-sufficient

### 2. Single Source of Truth

**Decision**: AWS CloudFormation + Secrets Manager are the ONLY configuration sources

**Rationale**:
- Eliminates configuration priority confusion
- Makes debugging straightforward
- Enforces security best practices

### 3. Breaking Change

**Decision**: No backward compatibility with old parameter approach

**Rationale**:
- Clean break allows for simpler design
- Old approach is fundamentally flawed
- Migration guide provided for existing users

### 4. Mock Testing Unchanged

**Decision**: Keep existing mock test infrastructure

**Rationale**:
- Fast unit tests don't need AWS
- Mock AWS SDK clients in tests
- Backward compatible with existing test suite

## Implementation Summary

### New Files to Create

- `lib/utils/config-resolver.ts`: Main configuration resolver
- `lib/utils/config-loader.ts`: Application entry point helpers
- `test/docker/test-stack.yaml`: Test CloudFormation stack

### Files to Modify

- `lib/benchling-webhook-stack.ts`: Simplify to 2 CFN parameters
- `bin/commands/deploy.ts`: Update CLI to accept new parameters
- `bin/benchling-webhook.ts`: Use ConfigResolver
- All test files: Update to use mocked AWS clients

### Files to Deprecate

- Parts of `lib/utils/config.ts`: Multi-source loading logic
- Individual Benchling parameter handling in deploy command

## Testing Strategy

### Mock Testing (Unchanged)
- Unit tests with mocked AWS SDK clients
- Fast, no AWS dependencies
- Tests continue to work as-is

### Docker Testing (New Approach)
1. Create test secret in AWS Secrets Manager
2. Identify Quilt stack ARN
3. Run Docker container with 2 env vars
4. Container resolves config from AWS
5. Test endpoints (/health, /config)

## Implementation Phases

1. **Phase 1**: Create ConfigResolver class with full test coverage
2. **Phase 2**: Update application entry point to use ConfigResolver
3. **Phase 3**: Simplify CDK stack to 2 parameters
4. **Phase 4**: Update CLI deploy command
5. **Phase 5**: Add health check endpoints
6. **Phase 6**: Update all tests
7. **Phase 7**: Update documentation

## Success Criteria

Implementation complete when:

- ✅ Container accepts only `QuiltStackARN` and `BenchlingSecret`
- ✅ All configuration derived from AWS CloudFormation + Secrets Manager
- ✅ Local mock tests pass without modification
- ✅ Local Docker tests work with manual AWS setup
- ✅ Clear error messages for all failure scenarios
- ✅ `/config` endpoint displays resolved configuration
- ✅ Documentation and migration guide complete

## Migration Path

For existing deployments:

1. Create Benchling secret in AWS Secrets Manager:
   ```bash
   aws secretsmanager create-secret \
     --name benchling-webhook-prod \
     --secret-string '{"client_id":"...","client_secret":"...","tenant":"..."}'
   ```

2. Get your Quilt stack ARN:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name QuiltStack \
     --query 'Stacks[0].StackId' \
     --output text
   ```

3. Deploy with new parameters:
   ```bash
   npx @quiltdata/benchling-webhook deploy \
     --quilt-stack-arn arn:aws:cloudformation:... \
     --benchling-secret benchling-webhook-prod
   ```

4. Update CI/CD pipelines to use new parameter format

## Risk Assessment

| Risk | Impact | Mitigation |
| ------ | -------- | ----------- |
| Breaking existing deployments | HIGH | Migration guide, major version bump (2.0.0) |
| Slower container startup | LOW | Acceptable tradeoff, implement caching |
| CloudFormation API failures | MEDIUM | Clear error messages, fallback logging |
| Complex debugging | LOW | Health check endpoint, detailed errors |

## Timeline Estimate

- **Phase 1** (ConfigResolver): 4-6 hours
- **Phase 2** (Application): 2-3 hours
- **Phase 3** (CDK): 2-3 hours
- **Phase 4** (CLI): 2-3 hours
- **Phase 5** (Health checks): 1-2 hours
- **Phase 6** (Tests): 3-4 hours
- **Phase 7** (Docs): 2-3 hours

**Total**: 16-24 hours of focused development

## Next Steps

1. ✅ Review complete specification
2. ⬜ Create feature branch: `feat/156a-secrets-only`
3. ⬜ Implement Phase 1: ConfigResolver
4. ⬜ Implement Phase 2: Application entry point
5. ⬜ Continue through remaining phases
6. ⬜ Test thoroughly at each phase
7. ⬜ Create PR with complete implementation
8. ⬜ Update version to 2.0.0 (breaking change)
9. ⬜ Deploy to test environment
10. ⬜ Validate in production

## Questions?

See the detailed specification documents in this directory:
- Requirements → [01-requirements.md](./01-requirements.md)
- Analysis → [02-analysis.md](./02-analysis.md)
- Architecture → [03-architecture.md](./03-architecture.md)
- Testing → [04-testing-strategy.md](./04-testing-strategy.md)
- Implementation → [05-implementation-plan.md](./05-implementation-plan.md)
