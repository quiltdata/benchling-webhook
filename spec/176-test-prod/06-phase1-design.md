# Phase 1 Design - Complete test:prod Implementation

**Date**: 2025-11-03
**References**: 01-requirements.md, 02-analysis.md, 03-specifications.md, 04-phases.md

## Design Overview

This design implements a comprehensive production testing capability by extending the existing dev testing pattern to production environments. The implementation follows the "make the change easy, then make the easy change" principle by leveraging existing test infrastructure.

## Technical Architecture

### Component Diagram
```
┌─────────────────────────────────────────────────────────────┐
│ User Commands (npm scripts)                                  │
│  - npm run deploy:dev → deploy + test:dev                   │
│  - npm run deploy:prod → deploy + test:prod                 │
│  - npm run test:dev → test dev endpoint                     │
│  - npm run test:prod → test prod endpoint                   │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ Makefile Targets (docker/Makefile)                          │
│  - test-deployed-dev: Read dev endpoint from deploy.json    │
│  - test-deployed-prod: Read prod endpoint from deploy.json  │
│  - test-docker-prod: Test local Docker (renamed)            │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ Configuration Storage (~/.config/benchling-webhook/)        │
│  deploy.json:                                                │
│    {                                                         │
│      "dev": { "endpoint": "...", ... },                     │
│      "prod": { "endpoint": "...", ... }                     │
│    }                                                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ Test Execution (docker/scripts/test_webhook.py)             │
│  - Generic webhook testing (accepts URL parameter)          │
│  - Tests all endpoints: health, event, canvas, lifecycle    │
│  - Returns exit code 0 (success) or 1 (failure)            │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

#### Development Testing Flow
```
npm run test:dev
  → make -C docker test-deployed-dev
    → Read ~/.config/benchling-webhook/deploy.json (dev.endpoint)
    → uv run python scripts/test_webhook.py <dev-endpoint>
      → HTTP requests to dev endpoint
      → Validate responses
      → Return exit code
    → Propagate exit code
  → Report results
```

#### Production Testing Flow
```
npm run test:prod
  → make -C docker test-deployed-prod
    → Read ~/.config/benchling-webhook/deploy.json (prod.endpoint)
    → uv run python scripts/test_webhook.py <prod-endpoint>
      → HTTP requests to prod endpoint
      → Validate responses
      → Return exit code
    → Propagate exit code
  → Report results
```

#### Production Deployment Flow
```
npm run deploy:prod -- --quilt-stack-arn <arn> --benchling-secret <name> --yes
  → ts-node bin/cli.ts deploy
    → bin/commands/deploy.ts
      → Validate inputs
      → Execute CDK deployment
      → Query CloudFormation stack for WebhookEndpoint output
      → Write to ~/.config/benchling-webhook/deploy.json (prod section)
      → Execute npm run test:prod
        → [Production Testing Flow above]
      → Return final exit code
  → Report deployment + test results
```

## Implementation Design

### 1. Version Bump

**File**: `package.json`

**Change**: Update version from 0.6.2 to 0.6.3

**Implementation**:
```bash
npm version patch
```

**Rationale**: Semantic versioning - patch version for backward-compatible features

---

### 2. TypeScript Type Definitions

**File**: `bin/commands/deploy.ts` (add interface at top)

**Interface Definition**:
```typescript
interface DeploymentConfig {
    dev?: EnvironmentConfig;
    prod?: EnvironmentConfig;
}

interface EnvironmentConfig {
    endpoint: string;
    imageTag: string;
    deployedAt: string;
    stackName: string;
    region?: string;
}
```

**Rationale**: Type safety for deploy.json operations

---

### 3. Makefile Refactoring

**File**: `docker/Makefile`

**Changes**:

#### 3.1. Rename Existing Target
```makefile
# OLD (line ~211):
test-prod: run-prod health-prod
    @echo "Running webhook tests against http://localhost:$(PORT_DOCKER_PROD)"
    uv run python scripts/test_webhook.py http://localhost:$(PORT_DOCKER_PROD)

# NEW:
test-docker-prod: run-prod health-prod
    @echo "Running webhook tests against http://localhost:$(PORT_DOCKER_PROD)"
    uv run python scripts/test_webhook.py http://localhost:$(PORT_DOCKER_PROD)
```

**Rationale**: Frees up "test-prod" name, clarifies this tests local Docker

#### 3.2. Add New Target (after test-deployed-dev, around line 250)
```makefile
# Test deployed prod stack via API Gateway endpoint
test-deployed-prod: check-xdg
    @echo "🧪 Testing deployed prod stack..."
    @PROD_ENDPOINT=$$(jq -r '.prod.endpoint // empty' $(XDG_CONFIG)/deploy.json 2>/dev/null); \
    if [ -z "$$PROD_ENDPOINT" ]; then \
        echo "❌ No prod endpoint found in $(XDG_CONFIG)/deploy.json"; \
        echo "💡 Run 'npm run deploy:prod' first to deploy the prod stack"; \
        exit 1; \
    fi; \
    echo "📡 Testing endpoint: $$PROD_ENDPOINT"; \
    uv run python scripts/test_webhook.py "$$PROD_ENDPOINT"
```

**Rationale**: Mirrors test-deployed-dev pattern exactly, uses prod key instead of dev

#### 3.3. Update Help Text (line ~44)
```makefile
# OLD:
echo "  test-prod             - Test webhooks against docker prod (port $(PORT_DOCKER_PROD))"

# NEW:
echo "  test-docker-prod      - Test webhooks against docker prod (port $(PORT_DOCKER_PROD))"
echo "  test-deployed-dev     - Test dev stack via API Gateway endpoint"
echo "  test-deployed-prod    - Test prod stack via API Gateway endpoint"
```

**Rationale**: Clear documentation of all test targets

#### 3.4. Update .PHONY Declaration (line ~19)
```makefile
# OLD:
.PHONY: ... test-prod test-ecr test-local test-benchling test-query

# NEW:
.PHONY: ... test-docker-prod test-deployed-prod test-ecr test-local test-benchling test-query
```

**Rationale**: Proper Make hygiene

---

### 4. Deployment Command Enhancement

**File**: `bin/commands/deploy.ts`

**Changes**:

#### 4.1. Add Imports (top of file)
```typescript
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { execSync } from "child_process";
```

#### 4.2. Add Helper Function (before deployCommand)
```typescript
/**
 * Store deployment configuration in XDG config directory
 */
function storeDeploymentConfig(
    environment: 'dev' | 'prod',
    config: EnvironmentConfig
): void {
    const configDir = join(homedir(), ".config", "benchling-webhook");
    const deployJsonPath = join(configDir, "deploy.json");

    // Read existing deploy.json or create new one
    let deployConfig: DeploymentConfig = {};
    if (existsSync(deployJsonPath)) {
        const content = readFileSync(deployJsonPath, "utf8");
        deployConfig = JSON.parse(content);
    }

    // Update environment section
    deployConfig[environment] = config;

    // Ensure config directory exists
    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
    }

    // Write deploy.json atomically
    const tempPath = `${deployJsonPath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(deployConfig, null, 2));

    // Atomic rename (POSIX)
    if (process.platform === 'win32') {
        // Windows doesn't have atomic rename with overwrite
        if (existsSync(deployJsonPath)) {
            const backupPath = `${deployJsonPath}.backup`;
            if (existsSync(backupPath)) {
                require('fs').unlinkSync(backupPath);
            }
            require('fs').renameSync(deployJsonPath, backupPath);
        }
        require('fs').renameSync(tempPath, deployJsonPath);
    } else {
        // Unix: atomic rename
        require('fs').renameSync(tempPath, deployJsonPath);
    }

    console.log(`✅ Stored deployment config in ${deployJsonPath}`);
    console.log(`   Environment: ${environment}`);
    console.log(`   Endpoint: ${config.endpoint}`);
}
```

**Rationale**: Atomic file writes prevent corruption, mirrors dev-deploy.ts pattern

#### 4.3. Modify deployCommand Function (after successful CDK deploy)

**Insert this code block after CDK deploy succeeds** (find the section that handles successful deployment):

```typescript
// After successful deployment, store endpoint and run tests
console.log("");
console.log("Retrieving deployment endpoint...");

try {
    const region = options.region || process.env.AWS_REGION || "us-east-1";
    const cloudformation = new CloudFormationClient({ region });
    const stackName = "BenchlingWebhookStack"; // Or extract from CDK context

    const command = new DescribeStacksCommand({ StackName: stackName });
    const response = await cloudformation.send(command);

    if (response.Stacks && response.Stacks.length > 0) {
        const stack = response.Stacks[0];
        const endpointOutput = stack.Outputs?.find((o) => o.OutputKey === "WebhookEndpoint");
        const webhookUrl = endpointOutput?.OutputValue || "";

        if (webhookUrl) {
            // Determine image tag (from options or "latest")
            const imageTag = options.imageTag || "latest";

            // Store prod deployment config
            storeDeploymentConfig('prod', {
                endpoint: webhookUrl,
                imageTag: imageTag,
                deployedAt: new Date().toISOString(),
                stackName: stackName,
                region: region,
            });

            // Run production tests
            console.log("");
            console.log("Running production integration tests...");
            try {
                execSync("npm run test:prod", { stdio: "inherit" });
                console.log("");
                console.log("✅ Production deployment and tests completed successfully!");
            } catch (testError) {
                console.error("");
                console.error("❌ Production tests failed!");
                console.error("   Deployment completed but tests did not pass.");
                console.error("   Review test output above for details.");
                process.exit(1);
            }
        } else {
            console.warn("⚠️  Could not retrieve WebhookEndpoint from stack outputs");
            console.warn("   Skipping test execution");
        }
    }
} catch (error) {
    console.warn(`⚠️  Could not retrieve/test deployment endpoint: ${(error as Error).message}`);
    console.warn("   Deployment succeeded but tests were skipped");
}
```

**Rationale**:
- Store prod config immediately after deployment
- Run tests automatically
- Fail deployment if tests fail
- Mirrors dev-deploy.ts pattern

---

### 5. npm Script Updates

**File**: `package.json`

**Changes**:

```json
{
  "scripts": {
    "deploy:prod": "ts-node bin/cli.ts deploy",
    "test:dev": "make -C docker test-deployed-dev",
    "test:prod": "make -C docker test-deployed-prod",
    "test:remote": "npm run test:dev # DEPRECATED: Use test:dev instead. Will be removed in 0.7.0"
  }
}
```

**Note**: The deploy:prod script doesn't need modification here because the test execution is now handled inside deploy.ts

**Rationale**:
- Clear, intuitive command names
- Deprecation notice inline
- Simple delegation to Make targets

---

### 6. Documentation Updates

#### 6.1. README.md Updates

**Section: Testing Strategy**

Add after "Available Test Commands":
```markdown
#### Remote Deployment Testing

```bash
# Test development stack
npm run test:dev          # Test dev stack via API Gateway

# Test production stack
npm run test:prod         # Test prod stack via API Gateway

# Deprecated (use test:dev)
npm run test:remote       # DEPRECATED - will be removed in 0.7.0
```

**What it tests**:
- API Gateway endpoint accessibility
- Health checks (`/health`, `/health/ready`)
- Webhook processing (`/event`, `/canvas`, `/lifecycle`)
- Integration with deployed AWS infrastructure

**Prerequisites**:
- Stack must be deployed (via `npm run deploy:dev` or `npm run deploy:prod`)
- Deployment endpoint stored in `~/.config/benchling-webhook/deploy.json`
```

**Section: Deployment Workflows → Production Release**

Update Step 2:
```markdown
#### Step 2: Deploy to production

```bash
npm run deploy:prod -- \
  --quilt-stack-arn <arn> \
  --benchling-secret <name> \
  --image-tag <version> \
  --yes
```

This will:
1. Deploy the CDK stack with production configuration
2. Store the deployment endpoint in `~/.config/benchling-webhook/deploy.json`
3. Automatically run integration tests against the deployed endpoint
4. Fail if tests do not pass

**Note**: Production deployment will fail if integration tests fail, ensuring no broken deployments.
```

#### 6.2. CLAUDE.md Updates

**Section: Daily Development → Before creating PR**

```markdown
```bash
npm run test:local           # Verify integration works
npm run test:dev             # Test deployed dev stack (if deployed)
git commit -m "type(scope): description"
gh pr create
```

**Section: Testing Strategy → Available Test Commands**

```markdown
# Remote deployment testing
npm run test:dev             # Test dev stack via API Gateway (clearer than test:remote)
npm run test:prod            # Test prod stack via API Gateway
npm run test:remote          # DEPRECATED - use test:dev (will be removed in 0.7.0)
```

---

## Design Decisions and Rationale

### Decision 1: Single-Phase Implementation
**Decision**: Implement all changes in one phase
**Rationale**: Changes are tightly coupled; partial implementation would create confusion
**Trade-off**: Larger PR, but no intermediate broken states

### Decision 2: Atomic Config Writes
**Decision**: Use temp file + rename for deploy.json updates
**Rationale**: Prevents corruption if process crashes during write
**Trade-off**: Slight complexity, but critical for reliability

### Decision 3: Test Execution in deploy.ts
**Decision**: Run tests inside deploy.ts, not via npm script chain
**Rationale**: Better error handling, clearer exit codes, mirrors dev-deploy.ts
**Trade-off**: More code in deploy.ts, but cleaner interface

### Decision 4: Fail-Fast on Test Failure
**Decision**: Production deployment fails if tests fail
**Rationale**: Catch deployment issues immediately, don't deploy broken code
**Trade-off**: Deployment takes slightly longer, but higher confidence

### Decision 5: Keep test:remote Temporarily
**Decision**: Deprecate but don't remove in 0.6.3
**Rationale**: Avoid breaking existing workflows, allow gradual migration
**Trade-off**: Extra deprecation notice maintenance

### Decision 6: Mirror Dev Pattern Exactly
**Decision**: Prod testing uses identical pattern to dev testing
**Rationale**: Consistency, leverage existing infrastructure, easier to understand
**Trade-off**: None - this is pure benefit

### Decision 7: jq for JSON Parsing
**Decision**: Use jq in Makefile for JSON parsing
**Rationale**: Already used in test-deployed-dev, reliable and fast
**Trade-off**: Dependency on jq being installed (acceptable for development)

### Decision 8: XDG Config Directory
**Decision**: Continue using ~/.config/benchling-webhook/
**Rationale**: Follow existing XDG pattern, avoid new config locations
**Trade-off**: None - maintains consistency

## Error Handling Strategy

### Error Scenario 1: Missing deploy.json
**Detection**: File doesn't exist
**Handling**: Clear error message with deployment instructions
**Exit Code**: 1 (failure)

### Error Scenario 2: Missing Environment Key
**Detection**: jq returns empty string
**Handling**: "No {env} endpoint found" message with deployment command
**Exit Code**: 1 (failure)

### Error Scenario 3: Invalid JSON
**Detection**: jq parse error
**Handling**: "Corrupted deploy.json" message with re-run setup suggestion
**Exit Code**: 1 (failure)

### Error Scenario 4: Network Failure
**Detection**: test_webhook.py returns exit 1
**Handling**: Test script's native error reporting (already good)
**Exit Code**: 1 (failure), propagated through chain

### Error Scenario 5: Test Timeout
**Detection**: test_webhook.py timeout
**Handling**: Test script's native timeout handling (requests timeout)
**Exit Code**: 1 (failure)

### Error Scenario 6: CloudFormation Query Failure
**Detection**: DescribeStacks throws exception
**Handling**: Warn but don't fail deployment (infra is deployed)
**Exit Code**: 0 (warning only)

## Testing Strategy

### Unit Tests
- **deploy.ts config storage**: Mock file system, verify JSON written correctly
- **Makefile targets**: Dry-run verification, syntax checks
- **npm scripts**: Verify correct Make targets called

### Integration Tests
- **Full dev workflow**: deploy:dev → test:dev
- **Full prod workflow**: deploy:prod → test:prod (requires real AWS)
- **Standalone tests**: test:dev and test:prod without deployment
- **Error handling**: Test missing config scenarios

### Manual Validation
- Real dev deployment and testing
- Real prod deployment and testing (in staging environment)
- Verify all documentation examples work

## Performance Considerations

### Test Execution Time
- Health checks: 1-2 seconds
- Webhook tests: 5-10 seconds
- Canvas tests: 3-5 seconds
- Lifecycle tests: 3-5 seconds
- **Total**: ~15-25 seconds per test run

### Deployment Impact
- CloudFormation query: 1-2 seconds
- Config file write: < 1 second
- Test execution: 15-25 seconds
- **Total added time**: ~20-30 seconds to deploy:prod

### Optimization Opportunities (Future)
- Parallel test execution (not needed for current test count)
- Cached endpoint (already implemented via deploy.json)
- Conditional testing (could add --skip-tests flag if needed)

## Security Considerations

### Configuration File Security
- Location: ~/.config/benchling-webhook/ (user-only directory)
- Permissions: Default user permissions (600 for files, 700 for directory)
- Content: Endpoints only, no secrets stored

### Test Execution Security
- Uses existing AWS credentials
- No additional permissions required
- Tests against deployed infrastructure (not local secrets)

### Deployment Security
- No changes to IAM roles or policies
- No changes to secret storage
- No changes to network security

## Backward Compatibility

### Maintained Compatibility
- ✅ Existing test:remote still works (deprecated)
- ✅ Existing deploy:dev still works
- ✅ Existing test:local still works
- ✅ XDG config extended, not replaced

### Breaking Changes (None)
- No removal of existing commands
- No changes to existing behavior
- No changes to configuration format (only addition)

### Migration Path
- test:remote → test:dev (same behavior)
- No user action required immediately
- Removal planned for 0.7.0

## Rollback Plan

If implementation fails:
1. **Git Revert**: Single branch, easy to revert all commits
2. **Config Cleanup**: Remove prod section from deploy.json if needed
3. **No Infrastructure Changes**: Stack remains unchanged
4. **Quick Recovery**: < 5 minutes to revert and redeploy

## Success Criteria Validation

This design satisfies all acceptance criteria from 01-requirements.md:

- ✅ AC-1: New test commands (test:dev, test:prod)
- ✅ AC-2: Environment detection via deploy.json
- ✅ AC-3: Production deployment integration
- ✅ AC-4: Reusable test infrastructure
- ✅ AC-5: Documentation updates
- ✅ AC-6: Version bump to 0.6.3

## Next Steps

After design approval:
1. Create episodes document (07-phase1-episodes.md)
2. Create checklist document (08-phase1-checklist.md)
3. Begin implementation following BDD/TDD approach
