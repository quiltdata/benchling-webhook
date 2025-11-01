# Analysis - Current vs. Secrets-Only Architecture

**Spec**: 156a-secrets-only
**Date**: 2025-10-31

## Current Implementation Analysis (spec/156-secrets-manager)

### Configuration Sources (Too Many!)

The current system accepts configuration from 6 different sources:

1. **CLI Options**: `--catalog`, `--bucket`, `--tenant`, `--client-id`, `--client-secret`, `--app-id`, `--benchling-secrets`
2. **Environment Variables**: `QUILT_CATALOG`, `QUILT_USER_BUCKET`, `BENCHLING_TENANT`, `BENCHLING_CLIENT_ID`, `BENCHLING_CLIENT_SECRET`, `BENCHLING_APP_DEFINITION_ID`, `BENCHLING_SECRETS`
3. **.env File**: All of the above
4. **Quilt3 CLI Config**: For catalog URL only
5. **CloudFormation Inference**: From Quilt stack outputs
6. **AWS Secrets Manager**: Via `BENCHLING_SECRETS` parameter

### Problems with Current Approach

#### Problem 1: Configuration Priority Confusion

```typescript
// From lib/utils/config.ts lines 209-263
export function loadConfigSync(options: ConfigOptions = {}): Partial<Config> {
    // 1. Load .env file
    const dotenvVars = existsSync(envFile) ? loadDotenv(envFile) : {};

    // 2. Merge with process.env
    const envVars = { ...dotenvVars, ...process.env };

    // 3. Try to get catalog from quilt3 config
    const quilt3Catalog = getQuilt3Catalog();

    // 4. CLI options take priority
    quiltCatalog: options.catalog || envVars.QUILT_CATALOG || quilt3Catalog,
}
```

**Issue**: When debugging, it's hard to know which source provided which value. A user might set `QUILT_CATALOG` in three different places and get confused about which one is being used.

#### Problem 2: Too Many Required Environment Variables

For the Docker container to work, you need:
- `QUILT_CATALOG`
- `QUILT_USER_BUCKET`
- `QUILT_DATABASE`
- `QUEUE_ARN`
- `BENCHLING_TENANT`
- `BENCHLING_CLIENT_ID`
- `BENCHLING_CLIENT_SECRET`
- `BENCHLING_APP_DEFINITION_ID` (optional)
- `CDK_DEFAULT_ACCOUNT`
- `CDK_DEFAULT_REGION`

That's **10 environment variables** minimum!

#### Problem 3: Inference Logic is Complex

```typescript
// From lib/utils/stack-inference.ts
export async function inferStackConfig(catalogUrl: string): Promise<InferredStackInfo> {
    // 1. Fetch config.json from catalog
    config = await fetchJson(configUrl);

    // 2. Extract API Gateway ID
    const apiGatewayId = extractApiGatewayId(config.apiGatewayEndpoint);

    // 3. Find stack by searching for API Gateway resource
    const stackName = findStackByResource(region, apiGatewayId);

    // 4. Get stack outputs
    stackDetails = getStackDetails(region, stackName);

    // 5. Extract specific outputs
    const databaseOutput = stackDetails.outputs.find(o => o.OutputKey === "UserAthenaDatabaseName");
    const queueArnOutput = stackDetails.outputs.find(o => o.OutputKey === "PackagerQueueArn");
}
```

**Issue**: This inference logic only works during CLI deployment, not at container runtime. The container still needs all environment variables explicitly set.

#### Problem 4: Untestable with Docker Locally

To test with Docker locally, you must:
1. Create a `.env` file with 10+ variables
2. OR manually export 10+ environment variables
3. OR set up AWS Secrets Manager + manually construct all Quilt variables

None of these options are simple or reliable.

### Quilt Stack Output Analysis

From `lib/utils/stack-inference.ts`, the Quilt stack provides these outputs:

| Output Key | Purpose | Example Value |
|---|---|---|
| `UserAthenaDatabaseName` | Athena database for Quilt packages | `quilt_example_db` |
| `PackagerQueueArn` | SQS queue for processing | `arn:aws:sqs:us-east-1:123456789012:QuiltStack-PackagerQueue` |

Additional information from `config.json` (fetched from catalog URL):
- `region`: AWS region where stack is deployed
- `apiGatewayEndpoint`: Catalog API endpoint
- `analyticsBucket`: S3 bucket for analytics (not used by webhook)
- `serviceBucket`: S3 bucket for service data (not used by webhook)

### What We Actually Need

Looking at the code, the **only** values the container truly needs are:

1. **For Quilt Integration**:
   - Quilt catalog domain (can derive from stack or config.json)
   - Quilt database name (from stack output: `UserAthenaDatabaseName`)
   - SQS Queue ARN (from stack output: `PackagerQueueArn`)
   - User bucket name (needs to be specified - not in stack outputs!)
   - AWS region (from stack ARN)

2. **For Benchling Integration**:
   - Client ID
   - Client secret
   - Tenant
   - App definition ID

3. **For AWS**:
   - AWS account ID (from stack ARN)
   - AWS region (from stack ARN)

## Proposed Secrets-Only Architecture

### Single Stack Parameter Approach

Instead of passing individual configuration values, pass a single **CloudFormation Stack ARN**:

```
arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-def-123
```

From this ARN, we can derive:
- **Region**: `us-east-1` (parse ARN)
- **Account**: `123456789012` (parse ARN)
- **Stack Name**: `QuiltStack` (parse ARN)

Then query CloudFormation API for stack outputs:
- **Database**: `UserAthenaDatabaseName` output
- **Queue ARN**: `PackagerQueueArn` output
- **Catalog URL**: Fetch `config.json` from API Gateway endpoint in outputs (or infer from exports)

### Configuration Comparison

| Aspect | Current (156-secrets-manager) | Proposed (156a-secrets-only) |
|---|---|---|
| **Env Vars for Container** | 10+ variables | 2 variables |
| **Configuration Sources** | 6 sources | 2 sources (AWS only) |
| **Inference Location** | CLI deployment time | Container runtime |
| **Local Docker Setup** | Complex .env file | Simple: 2 envars |
| **Testability** | Difficult | Straightforward |
| **Debugging** | Hard (multiple sources) | Easy (single source of truth) |
| **Cloud Deployment** | ECS injects many env vars | ECS injects 2 env vars |

### Example: Setting Up Local Docker Test

**Current Approach** (156-secrets-manager):
```bash
# Create .env file with 10+ variables
cat > .env << 'EOF'
QUILT_CATALOG=my-catalog.company.com
QUILT_USER_BUCKET=my-user-bucket
QUILT_DATABASE=quilt_my_catalog_db
QUEUE_ARN=arn:aws:sqs:us-east-1:123456789012:MyQueue
BENCHLING_TENANT=mycompany
BENCHLING_CLIENT_ID=xxx
BENCHLING_CLIENT_SECRET=yyy
BENCHLING_APP_DEFINITION_ID=zzz
CDK_DEFAULT_ACCOUNT=123456789012
CDK_DEFAULT_REGION=us-east-1
AWS_REGION=us-east-1
PKG_PREFIX=benchling
PKG_KEY=experiment_id
LOG_LEVEL=INFO
EOF

docker run --env-file .env benchling-webhook
```

**Proposed Approach** (156a-secrets-only):
```bash
# 1. Create secret in AWS Secrets Manager (one-time setup)
aws secretsmanager create-secret \
  --name my-benchling-creds \
  --secret-string '{"client_id":"xxx","client_secret":"yyy","tenant":"mycompany","app_definition_id":"zzz"}'

# 2. Run Docker with just 2 env vars
docker run \
  -e QuiltStackARN=arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc \
  -e BenchlingSecret=my-benchling-creds \
  -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
  benchling-webhook
```

Much simpler! The container handles all the querying and derivation.

### Key Differences

1. **Runtime vs. Build-time Inference**:
   - Current: Inference happens during `cdk deploy` at CLI time
   - Proposed: Inference happens during container startup at runtime

2. **Configuration Ownership**:
   - Current: CLI tool owns configuration assembly
   - Proposed: Container owns configuration assembly

3. **Flexibility**:
   - Current: Can override individual values from many sources
   - Proposed: Single source of truth (AWS CloudFormation + Secrets Manager)

4. **Backward Compatibility**:
   - Current: Maintains compatibility with old individual parameters
   - Proposed: Breaking change - only supports new approach

## Implementation Impact

### Files That Need Changes

1. **`lib/utils/config.ts`**: Complete refactor
   - Remove multi-source loading logic
   - Add CloudFormation ARN parsing
   - Add runtime stack querying
   - Keep validation logic

2. **`lib/utils/stack-inference.ts`**: Adapt for runtime use
   - Make suitable for container startup (currently CLI-only)
   - Add caching for stack outputs
   - Add error handling for missing outputs

3. **`bin/commands/deploy.ts`**: Simplify CLI
   - Remove individual Benchling parameter handling
   - Accept QuiltStackARN parameter
   - Accept BenchlingSecret parameter
   - Remove complex validation (let container validate)

4. **`lib/benchling-webhook-stack.ts`**: Update CDK stack
   - Change CloudFormation parameters
   - Update ECS task definition to pass only 2 env vars
   - Update IAM permissions (add CloudFormation read, Secrets Manager read)

5. **Test files**: Update mocks
   - Keep mock testing approach
   - Update Docker test documentation

### Migration Path

This is a **breaking change**. Users must:

1. Deploy new version with new parameters
2. Update CI/CD pipelines to use new parameter format
3. Create Benchling secrets in AWS Secrets Manager
4. Provide QuiltStackARN instead of individual parameters

### Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Breaking existing deployments | Clear migration guide, major version bump |
| CloudFormation API failures at runtime | Cache results, provide fallback to env vars for debugging |
| Slower container startup | Acceptable tradeoff for simplicity; implement caching |
| Harder to debug without env vars | Add verbose logging mode, health check endpoint showing resolved config |

## Conclusion

The secrets-only architecture (156a-secrets-only) is **radically simpler** than the current implementation:

- ✅ **Testable**: Easy to set up local Docker testing
- ✅ **Debuggable**: Single source of truth
- ✅ **Maintainable**: Less code, clearer logic
- ✅ **Secure**: All secrets in AWS Secrets Manager
- ✅ **Flexible**: Can update config by updating CloudFormation stack or secret

The main tradeoff is a **breaking change** requiring migration, but the long-term benefits outweigh the one-time migration cost.

## Next Steps

1. Design detailed architecture → `03-architecture.md`
2. Define testing strategy → `04-testing-strategy.md`
3. Create implementation plan → `05-implementation-plan.md`
