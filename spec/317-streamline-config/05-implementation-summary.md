# Implementation Summary: Minimal StackConfig Interface

## Completed Tasks

### 1. Created `lib/types/stack-config.ts`

Minimal interface containing only fields required by CDK stack:

**Included fields:**
- `benchling.secretArn` (required) - Reference to AWS Secrets Manager secret
- `quilt.catalog` (required) - Quilt catalog domain
- `quilt.database` (required) - Athena/Glue database name
- `quilt.queueUrl` (required) - SQS queue URL
- `quilt.region` (required) - AWS region for Quilt resources
- `quilt.writeRoleArn` (optional) - IAM role for S3 access
- `deployment.region` (required) - AWS deployment region
- `deployment.imageTag` (optional) - Docker image tag
- `deployment.vpc` (optional) - VPC configuration
- `deployment.stackName` (optional) - CloudFormation stack name
- `security.webhookAllowList` (optional) - IP filtering for REST API Gateway

**Excluded fields:**
- `benchling.tenant`, `clientId`, `appDefinitionId` (stored in secret, read at runtime)
- `packages.*` (passed as environment variables to container)
- `logging.*` (passed as environment variables to container)
- `_metadata`, `_inherits` (wizard metadata, not needed by stack)

### 2. Created `lib/utils/config-transform.ts`

Transformation and validation utilities:

**Functions:**
- `profileToStackConfig(profile: ProfileConfig): StackConfig` - Transforms ProfileConfig to StackConfig
- `validateStackConfig(config: ProfileConfig): ValidationResult` - Validates required fields

**Validation logic:**
- Checks all required fields are present
- Validates ARN formats (secretArn, writeRoleArn)
- Validates URL formats (queueUrl)
- Validates VPC configuration (subnets, AZs, CIDR)
- Validates IP allowlist CIDR blocks
- Returns warnings for optional fields (writeRoleArn)

**Error handling:**
- Clear error messages with actionable suggestions
- Throws descriptive errors on invalid configuration
- Separates fatal errors from warnings

### 3. Created `test/config-transform.test.ts`

Comprehensive test coverage (87%):

**Test suites:**
- `validateStackConfig` - 6 tests
  - Valid configuration passes
  - Missing secretArn fails
  - Missing Quilt fields fail
  - Missing writeRoleArn warns
  - Invalid VPC configuration fails
  - Invalid CIDR blocks fail

- `profileToStackConfig` - 4 tests
  - Valid transformation
  - Excludes wizard metadata
  - Handles optional fields
  - Throws on invalid configuration

**Coverage:**
```
config-transform.ts    |   87.34 |       75 |     100 |   87.17
```

## Design Principles

### Separation of Concerns

**ProfileConfig (XDG user configuration):**
- Contains ALL configuration (wizard, deployment, runtime)
- Stored in `~/.config/benchling-webhook/{profile}/config.json`
- Used by setup wizard, secrets sync, test scripts

**StackConfig (CDK infrastructure configuration):**
- Contains ONLY infrastructure-related fields
- Derived from ProfileConfig via transformation
- Used by CDK stack constructors

### Benefits

1. **Reduced Coupling** - Stack doesn't depend on wizard metadata
2. **Easier Testing** - Fewer fields to mock in stack tests
3. **Clear Interface** - Explicit about what the stack needs
4. **Better Validation** - Early error detection before deployment
5. **Future-Proof** - Adding wizard fields won't affect stack

## File Structure

```
lib/
├── types/
│   ├── config.ts              # ProfileConfig (existing)
│   └── stack-config.ts        # StackConfig (new)
└── utils/
    └── config-transform.ts    # Transformation utilities (new)

test/
└── config-transform.test.ts   # Comprehensive tests (new)
```

## Next Steps

### Phase 2: Update Stack Constructors
- [ ] Update `lib/benchling-webhook-stack.ts` to use StackConfig
- [ ] Update `lib/fargate-service.ts` to use StackConfig
- [ ] Update `lib/rest-api-gateway.ts` to use StackConfig

### Phase 3: Fix Deploy Script
- [ ] Update `bin/commands/deploy.ts` to call createStack() directly
- [ ] Remove buildCdkEnv() function (no longer needed)
- [ ] Remove subprocess spawning (npx cdk deploy)

### Phase 4: Simplify bin/benchling-webhook.ts
- [ ] Remove ProfileConfig reconstruction logic
- [ ] Build StackConfig directly from legacy Config
- [ ] Remove direct CDK CLI support

### Phase 5: Update Tests
- [ ] Update stack tests to mock StackConfig instead of ProfileConfig
- [ ] Verify all integration tests still pass
- [ ] Update test fixtures

## Code Quality

- ✅ TypeScript 4-space indentation
- ✅ Comprehensive JSDoc comments
- ✅ No `any` types
- ✅ Proper type safety
- ✅ All exports documented
- ✅ ESLint passing
- ✅ Tests passing (10/10)
- ✅ High coverage (87%)

## Breaking Changes

None. This is a new interface that doesn't affect existing code yet.

## Backward Compatibility

Fully backward compatible. ProfileConfig remains unchanged and continues to work as before.
