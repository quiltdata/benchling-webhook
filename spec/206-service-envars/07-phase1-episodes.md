# Phase 1 Episodes: Service Environment Variables Implementation

**Issue**: #206 - Service envars

**Branch**: `206-service-envars`

**Date**: 2025-11-06

**Status**: EPISODE BREAKDOWN

## Episode Overview

Episodes are atomic, testable implementation units following Test-Driven Development (TDD):
1. Write failing tests (Red)
2. Implement minimum code to pass (Green)
3. Refactor while keeping tests green (Refactor)
4. Commit and push

## Episode 1: Update Type Definitions

**Goal**: Update `QuiltConfig` interface to make `stackArn` optional and document usage

**Files**:
- `lib/types/config.ts`

**TDD Cycle**:

**Red - Write Failing Tests**:
```typescript
// tests/lib/types/config.test.ts
describe("QuiltConfig", () => {
  test("stackArn is optional", () => {
    const config: QuiltConfig = {
      catalog: "quilt.example.com",
      database: "quilt_db",
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      region: "us-east-1"
      // stackArn not provided
    };
    expect(config).toBeDefined();
  });
});
```

**Green - Implement**:
- Update `QuiltConfig` interface: `stackArn?:  string`
- Add JSDoc comments for all fields
- Document deployment vs runtime usage
- Add optional `icebergDatabase` field

**Refactor**:
- Improve JSDoc formatting
- Add usage examples
- Verify no breaking changes to schema

**Success Criteria**:
- [ ] TypeScript compilation succeeds
- [ ] Tests pass
- [ ] No errors in dependent files
- [ ] Documentation clear and accurate

**Commit Message**: `feat: make QuiltConfig.stackArn optional and add icebergDatabase`

---

## Episode 2: Create Service Resolver Module

**Goal**: Implement service resolution from CloudFormation stack outputs

**Files**:
- `lib/utils/service-resolver.ts` (new)
- `tests/lib/utils/service-resolver.test.ts` (new)

**TDD Cycle**:

**Red - Write Failing Tests**:
```typescript
describe("resolveQuiltServices", () => {
  test("resolves all required services from stack outputs", async () => {
    const mockCfn = mockCloudFormationClient({
      PackagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      UserAthenaDatabaseName: "quilt_db",
      Catalog: "quilt.example.com"
    });

    const services = await resolveQuiltServices({
      stackArn: "arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/id",
      mockCloudFormation: mockCfn
    });

    expect(services).toEqual({
      packagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      athenaUserDatabase: "quilt_db",
      quiltWebHost: "quilt.example.com"
    });
  });

  test("normalizes catalog URL from various formats", async () => {
    // Test Catalog output
    // Test CatalogDomain output
    // Test ApiGatewayEndpoint extraction
    // Test protocol removal
    // Test trailing slash removal
  });

  test("handles optional Iceberg database", async () => {
    // Test with IcebergDatabase output
    // Test without IcebergDatabase output
  });

  test("throws error for missing required outputs", async () => {
    // Test missing PackagerQueueUrl
    // Test missing UserAthenaDatabaseName
    // Test missing Catalog/CatalogDomain/ApiGatewayEndpoint
  });

  test("validates SQS queue URL format", async () => {
    // Test valid URL
    // Test invalid URL
  });
});
```

**Green - Implement**:
1. Create `service-resolver.ts` with interfaces
2. Implement `parseStackArn()` (may reuse from config-resolver)
3. Implement `normalizeCatalogUrl()` helper
4. Implement `validateQueueUrl()` helper
5. Implement `resolveQuiltServices()` main function
6. Add error handling with descriptive messages

**Refactor**:
- Extract common patterns
- Improve error messages
- Add JSDoc comments
- Simplify logic where possible

**Success Criteria**:
- [ ] All tests pass
- [ ] Coverage ≥85%
- [ ] Error messages clear and actionable
- [ ] Handles all output format variations

**Commit Message**: `feat: add service resolver for CloudFormation stack outputs`

---

## Episode 3: Enhance Deployment Command

**Goal**: Integrate service resolver into deployment flow

**Files**:
- `bin/commands/deploy.ts`
- `tests/bin/commands/deploy.test.ts`

**TDD Cycle**:

**Red - Write Failing Tests**:
```typescript
describe("deploy command with service resolution", () => {
  test("resolves services before deployment", async () => {
    // Mock service resolver
    // Mock CDK deploy
    // Verify services resolved
    // Verify parameters passed correctly
  });

  test("displays resolved services in deployment plan", async () => {
    // Capture console output
    // Verify services displayed
  });

  test("handles service resolution errors gracefully", async () => {
    // Mock resolution failure
    // Verify error message
    // Verify deployment aborted
  });
});
```

**Green - Implement**:
1. Import `resolveQuiltServices`
2. Add service resolution step after validation
3. Display resolved services in deployment plan
4. Add error handling for resolution failures
5. Build CloudFormation parameters with resolved values
6. Pass parameters to CDK deploy

**Refactor**:
- Extract deployment plan display logic
- Improve error message formatting
- Add spinner feedback for resolution step

**Success Criteria**:
- [ ] Services resolved before deployment
- [ ] Deployment plan shows all services
- [ ] Errors handled gracefully
- [ ] Tests pass

**Commit Message**: `feat: integrate service resolution into deployment command`

---

## Episode 4: Update CDK Stack Parameters

**Goal**: Add new CloudFormation parameters for services

**Files**:
- `lib/benchling-webhook-stack.ts`

**TDD Cycle**:

**Red - Write Failing Tests**:
```typescript
describe("BenchlingWebhookStack", () => {
  test("creates service parameters", () => {
    // Create stack
    // Verify PackagerQueueUrl parameter exists
    // Verify AthenaUserDatabase parameter exists
    // Verify QuiltWebHost parameter exists
    // Verify IcebergDatabase parameter exists
  });

  test("passes parameters to Fargate service", () => {
    // Create stack
    // Verify FargateService receives correct props
  });
});
```

**Green - Implement**:
1. Add `PackagerQueueUrl` parameter
2. Add `AthenaUserDatabase` parameter
3. Add `QuiltWebHost` parameter
4. Add `IcebergDatabase` parameter (optional, default empty)
5. Rename `BenchlingSecretARN` parameter for clarity
6. Remove or deprecate `QuiltStackARN` parameter
7. Pass new parameters to `FargateService`

**Refactor**:
- Group related parameters
- Improve parameter descriptions
- Consistent naming conventions

**Success Criteria**:
- [ ] CDK synthesis succeeds
- [ ] All parameters present in template
- [ ] Parameters passed to Fargate service
- [ ] Tests pass

**Commit Message**: `feat: add CloudFormation parameters for explicit services`

---

## Episode 5: Update Fargate Service - Part 1 (Props and Environment Variables)

**Goal**: Update props interface and environment variables

**Files**:
- `lib/fargate-service.ts`

**TDD Cycle**:

**Red - Write Failing Tests**:
```typescript
describe("FargateService environment variables", () => {
  test("sets explicit service environment variables", () => {
    // Create service
    // Verify PACKAGER_SQS_URL set
    // Verify ATHENA_USER_DATABASE set
    // Verify QUILT_WEB_HOST set
    // Verify ICEBERG_DATABASE set
  });

  test("removes QuiltStackARN environment variable", () => {
    // Create service
    // Verify QuiltStackARN not present
  });
});
```

**Green - Implement**:
1. Update `FargateServiceProps` interface
   - Add service-specific fields
   - Remove or make optional `stackArn`
2. Update environment variable mapping
   - Add `PACKAGER_SQS_URL`
   - Add `ATHENA_USER_DATABASE`
   - Add `QUILT_WEB_HOST`
   - Add `ICEBERG_DATABASE`
   - Rename `BenchlingSecret` → `BENCHLING_SECRET_ARN`
   - Remove `QuiltStackARN`

**Refactor**:
- Group related env vars
- Add comments for clarity
- Consistent naming

**Success Criteria**:
- [ ] Props interface updated
- [ ] Environment variables correct
- [ ] Tests pass
- [ ] No compilation errors

**Commit Message**: `feat: update Fargate service props and environment variables`

---

## Episode 6: Update Fargate Service - Part 2 (IAM Permissions)

**Goal**: Remove CloudFormation permissions and use explicit resource ARNs

**Files**:
- `lib/fargate-service.ts`

**TDD Cycle**:

**Red - Write Failing Tests**:
```typescript
describe("FargateService IAM permissions", () => {
  test("does not grant CloudFormation permissions", () => {
    // Create service
    // Verify no cloudformation:DescribeStacks
    // Verify no cloudformation:DescribeStackResources
  });

  test("grants SQS permissions with explicit queue ARN", () => {
    // Create service with queue URL
    // Verify SQS policy uses specific queue ARN
  });

  test("grants Glue permissions with explicit database ARN", () => {
    // Create service with database name
    // Verify Glue policy uses specific database ARN
  });

  test("grants Iceberg permissions when database provided", () => {
    // Create service with Iceberg database
    // Verify Iceberg database permissions added
  });

  test("does not grant Iceberg permissions when not provided", () => {
    // Create service without Iceberg database
    // Verify no Iceberg permissions
  });
});
```

**Green - Implement**:
1. Remove CloudFormation IAM permissions (Lines 85-93)
2. Add helper function `queueArnFromUrl()`
3. Update SQS permissions to use explicit queue ARN
4. Update Glue permissions to use explicit database ARN
5. Add conditional Iceberg database permissions
6. Verify all other permissions unchanged

**Refactor**:
- Extract ARN building to helpers
- Consistent permission patterns
- Clear comments

**Success Criteria**:
- [ ] No CloudFormation permissions
- [ ] Explicit resource ARNs used
- [ ] Conditional Iceberg permissions work
- [ ] Tests pass
- [ ] IAM policies valid

**Commit Message**: `feat: remove CloudFormation permissions and use explicit resource ARNs`

---

## Episode 7: Remove Deprecated ConfigResolver

**Goal**: Delete config-resolver.ts and remove imports

**Files**:
- `lib/utils/config-resolver.ts` (delete)
- Any files importing ConfigResolver

**TDD Cycle**:

**Red - Not Applicable** (deletion)

**Green - Implement**:
1. Search for all imports of `config-resolver`
2. Verify none remain (should be replaced in previous episodes)
3. Delete `lib/utils/config-resolver.ts`
4. Delete associated tests
5. Update any documentation references

**Refactor**:
- Clean up any remaining references
- Update comments

**Success Criteria**:
- [ ] File deleted
- [ ] No import errors
- [ ] TypeScript compilation succeeds
- [ ] Tests pass

**Commit Message**: `refactor: remove deprecated ConfigResolver (~440 lines)`

---

## Episode 8: Update Test Infrastructure

**Goal**: Update tests to use explicit environment variables

**Files**:
- `docker-compose.yml`
- `scripts/run_local.py`
- Test configuration files
- Integration test scripts

**TDD Cycle**:

**Red - Write Failing Tests**:
```typescript
describe("local development setup", () => {
  test("loads explicit service env vars from profile", () => {
    // Test profile loading
    // Verify env vars set correctly
  });

  test("works with docker-compose", () => {
    // Test docker-compose configuration
    // Verify all required env vars present
  });
});
```

**Green - Implement**:
1. Update `docker-compose.yml`:
   - Add new environment variables
   - Remove `QuiltStackARN`
2. Update `scripts/run_local.py`:
   - Load explicit env vars from profile
   - Set for local Flask server
3. Update integration test configurations
4. Update test data/fixtures
5. Add example `.env.example` file

**Refactor**:
- Consistent env var naming
- Clear documentation
- Remove obsolete configs

**Success Criteria**:
- [ ] Docker Compose works
- [ ] Local server works
- [ ] Integration tests pass
- [ ] Documentation updated

**Commit Message**: `test: update test infrastructure for explicit environment variables`

---

## Episode 9: Update Documentation

**Goal**: Create migration guide and update all documentation

**Files**:
- `README.md`
- `CHANGELOG.md`
- `spec/206-service-envars/MIGRATION.md` (new)
- `docs/ENVIRONMENT_VARIABLES.md` (new or update)

**TDD Cycle**:

**Red - Not Applicable** (documentation)

**Green - Implement**:

**README.md**:
1. Update "Quick Start" section
2. Update configuration examples
3. Add breaking change notice
4. Update version reference

**CHANGELOG.md**:
1. Add v1.0.0 section (or appropriate version)
2. List breaking changes
3. List new features
4. Link to migration guide

**MIGRATION.md**:
1. Explain what changed and why
2. Before/after configuration examples
3. Step-by-step migration instructions
4. Common errors and solutions
5. Rollback procedure

**ENVIRONMENT_VARIABLES.md**:
1. List all container environment variables
2. Document each: purpose, format, required/optional
3. Provide examples
4. Document validation rules

**Refactor**:
- Check for typos
- Verify links
- Ensure clarity

**Success Criteria**:
- [ ] All docs updated
- [ ] Examples work
- [ ] Links valid
- [ ] Clear and accurate

**Commit Message**: `docs: add migration guide and update documentation for v1.0.0`

---

## Episode 10: Version Bump and Final Integration

**Goal**: Bump version, run full test suite, validate integration

**Files**:
- `package.json`
- Git tags

**TDD Cycle**:

**Red - Not Applicable** (version management)

**Green - Implement**:
1. Update `package.json` version to 1.0.0
2. Run full test suite:
   ```bash
   make test
   make lint
   ```
3. Run integration tests:
   ```bash
   make test-local PROFILE=dev
   ```
4. Test deployment:
   ```bash
   npm run deploy:dev -- --profile dev --yes
   ```
5. Verify deployed container:
   - Check CloudWatch logs
   - Verify no CloudFormation API calls
   - Test health check
   - Test webhook processing

**Refactor**:
- Address any issues found
- Update documentation if needed

**Success Criteria**:
- [ ] Version bumped to 1.0.0
- [ ] All tests pass
- [ ] Coverage ≥85%
- [ ] Deployment successful
- [ ] Integration validated
- [ ] No CloudFormation API calls in logs

**Commit Message**: `chore: bump version to 1.0.0 for breaking change release`

---

## Episode Summary

| Episode | Component | Estimated Time | Tests | Dependencies |
|---------|-----------|----------------|-------|--------------|
| 1 | Type definitions | 30 min | Unit | None |
| 2 | Service resolver | 2 hours | Unit | Episode 1 |
| 3 | Deployment command | 1.5 hours | Unit | Episodes 1-2 |
| 4 | CDK stack params | 1 hour | Unit | Episodes 1-3 |
| 5 | Fargate env vars | 1 hour | Unit | Episodes 1-4 |
| 6 | IAM permissions | 1 hour | Unit | Episodes 1-5 |
| 7 | Remove old code | 30 min | None | Episodes 2-6 |
| 8 | Test infrastructure | 2 hours | Integration | Episodes 1-7 |
| 9 | Documentation | 2 hours | None | Episodes 1-8 |
| 10 | Version & integration | 1 hour | E2E | Episodes 1-9 |

**Total Estimated Time**: ~12.5 hours

## Testing Checkpoints

After each episode:
1. Run `make lint` - fix any linting issues
2. Run `make test` - verify all tests pass
3. Check coverage - maintain ≥85%
4. Commit changes with conventional commit message
5. Push to branch

After all episodes:
1. Full test suite (unit + integration + E2E)
2. Deploy to dev environment
3. Validate container behavior
4. Verify startup time improvement
5. Check CloudWatch logs for API calls
6. Test webhook end-to-end

## Next Steps

After episodes complete:
1. Create checklist document for detailed tracking
2. Begin implementation following TDD cycle
3. Test thoroughly after each episode
4. Update checklist progress
5. Prepare for PR review
