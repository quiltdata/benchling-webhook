# Phase 1 Episodes - Complete test:prod Implementation

**Date**: 2025-11-03
**References**: 06-phase1-design.md

## Episode Structure

Each episode is an atomic, testable, committable change following BDD/TDD principles:
1. Write failing test (if applicable)
2. Implement minimum code to pass
3. Run test suite
4. Fix IDE diagnostics
5. Commit and push

---

## Episode 1: Version Bump

### Description
Bump package version from 0.6.2 to 0.6.3 for new test:prod feature

### Changes
- **File**: `package.json`
- **Action**: Update version field

### TDD Cycle
**Red**: N/A (version bump doesn't have tests)
**Green**: Execute `npm version patch`
**Refactor**: N/A

### Validation
```bash
# Verify version updated
grep '"version"' package.json | grep '0.6.3'

# Verify no syntax errors
npm run build:typecheck
```

### Success Criteria
- [ ] package.json shows version 0.6.3
- [ ] Version bump committed
- [ ] TypeScript compilation succeeds

### Commit Message
```
chore: bump version to 0.6.3 for test:prod feature

Prepare for production testing command implementation.
Part of GitHub issue #176.
```

---

## Episode 2: TypeScript Type Definitions

### Description
Add TypeScript interfaces for deployment configuration structure

### Changes
- **File**: `bin/commands/deploy.ts`
- **Action**: Add interfaces at top of file

### Code Changes
```typescript
// Add after imports, before existing code:

/**
 * Deployment configuration stored in ~/.config/benchling-webhook/deploy.json
 */
interface DeploymentConfig {
    dev?: EnvironmentConfig;
    prod?: EnvironmentConfig;
}

/**
 * Environment-specific deployment details
 */
interface EnvironmentConfig {
    endpoint: string;       // API Gateway webhook URL
    imageTag: string;       // Docker image tag deployed
    deployedAt: string;     // ISO 8601 timestamp
    stackName: string;      // CloudFormation stack name
    region?: string;        // AWS region (default: us-east-1)
}
```

### TDD Cycle
**Red**: N/A (type definitions don't have runtime tests)
**Green**: Add interfaces
**Refactor**: Verify types compile

### Validation
```bash
# Verify TypeScript compilation
npm run build:typecheck

# Verify no linting errors
npm run lint
```

### Success Criteria
- [ ] Interfaces defined in deploy.ts
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

### Commit Message
```
feat(types): add deployment configuration interfaces

Add DeploymentConfig and EnvironmentConfig interfaces to support
storing prod deployment information alongside dev.

Part of GitHub issue #176.
```

---

## Episode 3: Makefile Refactoring - Rename test-prod

### Description
Rename existing `test-prod` target to `test-docker-prod` to free up name for remote testing

### Changes
- **File**: `docker/Makefile`
- **Actions**:
  1. Rename target (line ~211)
  2. Update .PHONY declaration (line ~19)
  3. Update help text (line ~44)

### Code Changes

#### Change 1: Rename Target (around line 211)
```makefile
# OLD:
# Test webhooks against docker production (auto-starts if not running)
test-prod: run-prod health-prod
    @echo "Running webhook tests against http://localhost:$(PORT_DOCKER_PROD)"
    uv run python scripts/test_webhook.py http://localhost:$(PORT_DOCKER_PROD)

# NEW:
# Test webhooks against local docker production container (auto-starts if not running)
test-docker-prod: run-prod health-prod
    @echo "Running webhook tests against http://localhost:$(PORT_DOCKER_PROD)"
    uv run python scripts/test_webhook.py http://localhost:$(PORT_DOCKER_PROD)
```

#### Change 2: Update .PHONY (around line 19)
```makefile
# OLD:
.PHONY: help build test clean install lint ngrok kill \
        check-xdg check-ngrok run-local run-local-verbose run-dev run run-local-ngrok run-ecr \
        test test-unit test-integration test-dev test-prod test-ecr test-local test-benchling test-query \
        health-local health-dev health logs-dev logs

# NEW:
.PHONY: help build test clean install lint ngrok kill \
        check-xdg check-ngrok run-local run-local-verbose run-dev run run-local-ngrok run-ecr \
        test test-unit test-integration test-dev test-docker-prod test-ecr test-local test-benchling test-query \
        health-local health-dev health logs-dev logs
```

#### Change 3: Update Help Text (around line 44)
```makefile
# OLD:
echo "  test-prod             - Test webhooks against docker prod (port $(PORT_DOCKER_PROD))"

# NEW:
echo "  test-docker-prod      - Test local docker prod container (port $(PORT_DOCKER_PROD))"
```

### TDD Cycle
**Red**: N/A (Makefile syntax doesn't have tests)
**Green**: Rename target and update references
**Refactor**: Verify Make syntax

### Validation
```bash
# Verify Makefile syntax
make -C docker -n test-docker-prod

# Verify help text
make -C docker help | grep test-docker-prod

# Verify .PHONY includes new name
grep test-docker-prod docker/Makefile
```

### Success Criteria
- [ ] test-prod renamed to test-docker-prod
- [ ] .PHONY updated
- [ ] Help text updated
- [ ] Makefile syntax valid

### Commit Message
```
refactor(docker): rename test-prod to test-docker-prod

Rename local Docker test target to clarify it tests a local container,
not a deployed production stack. This frees up the test-prod name for
testing deployed production environments.

Part of GitHub issue #176.
```

---

## Episode 4: Add test-deployed-prod Makefile Target

### Description
Add new Makefile target for testing deployed production stack via API Gateway

### Changes
- **File**: `docker/Makefile`
- **Actions**:
  1. Add test-deployed-prod target (after test-deployed-dev, around line 251)
  2. Update .PHONY declaration
  3. Update help text

### Code Changes

#### Change 1: Add Target (after test-deployed-dev, around line 251)
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

#### Change 2: Update .PHONY (around line 19)
```makefile
# Add test-deployed-prod to the list
.PHONY: help build test clean install lint ngrok kill \
        check-xdg check-ngrok run-local run-local-verbose run-dev run run-local-ngrok run-ecr \
        test test-unit test-integration test-dev test-docker-prod test-deployed-prod test-ecr test-local test-benchling test-query \
        health-local health-dev health logs-dev logs
```

#### Change 3: Update Help Text (around line 44)
```makefile
# Add after test-deployed-dev line
echo "  test-deployed-dev     - Test dev stack via API Gateway endpoint"
echo "  test-deployed-prod    - Test prod stack via API Gateway endpoint"
```

### TDD Cycle
**Red**: Test should fail with "No prod endpoint found" (expected before deployment)
**Green**: Add target implementation
**Refactor**: Verify error messages match dev pattern

### Validation
```bash
# Verify Makefile syntax
make -C docker -n test-deployed-prod || echo "Expected error (no prod endpoint yet)"

# Verify help text includes new target
make -C docker help | grep test-deployed-prod

# Verify error message is helpful
make -C docker test-deployed-prod 2>&1 | grep "deploy:prod"
```

### Success Criteria
- [ ] test-deployed-prod target added
- [ ] .PHONY includes new target
- [ ] Help text includes new target
- [ ] Error message when endpoint missing is clear
- [ ] Makefile syntax valid

### Commit Message
```
feat(docker): add test-deployed-prod Makefile target

Add target for testing deployed production stack via API Gateway.
Mirrors test-deployed-dev pattern but reads prod endpoint from
deploy.json.

Part of GitHub issue #176.
```

---

## Episode 5: Add Helper Function to deploy.ts

### Description
Add helper function for storing deployment configuration in deploy.json

### Changes
- **File**: `bin/commands/deploy.ts`
- **Action**: Add storeDeploymentConfig function

### Code Changes

#### Add Imports (if not already present)
```typescript
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
```

#### Add Helper Function (before deployCommand function)
```typescript
/**
 * Store deployment configuration in XDG config directory
 * Uses atomic write pattern to prevent corruption
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

    // Atomic rename (platform-specific)
    const fs = require('fs');
    if (process.platform === 'win32') {
        // Windows: create backup before rename
        if (existsSync(deployJsonPath)) {
            const backupPath = `${deployJsonPath}.backup`;
            if (existsSync(backupPath)) {
                fs.unlinkSync(backupPath);
            }
            fs.renameSync(deployJsonPath, backupPath);
        }
        fs.renameSync(tempPath, deployJsonPath);
    } else {
        // Unix: atomic rename with overwrite
        fs.renameSync(tempPath, deployJsonPath);
    }

    console.log(`✅ Stored deployment config in ${deployJsonPath}`);
    console.log(`   Environment: ${environment}`);
    console.log(`   Endpoint: ${config.endpoint}`);
}
```

### TDD Cycle
**Red**: Write test for config storage (create test file)
**Green**: Implement helper function
**Refactor**: Verify atomic write behavior

### Validation
```bash
# Verify TypeScript compilation
npm run build:typecheck

# Manual test (requires mock or real deployment context)
# Will be validated in integration test
```

### Success Criteria
- [ ] storeDeploymentConfig function added
- [ ] TypeScript compilation succeeds
- [ ] Atomic write pattern implemented
- [ ] Cross-platform compatible (Windows + Unix)

### Commit Message
```
feat(deploy): add helper for storing deployment config

Add storeDeploymentConfig helper function with atomic write pattern
to safely update deploy.json. Supports both dev and prod environments.

Part of GitHub issue #176.
```

---

## Episode 6: Integrate Config Storage and Testing in deploy.ts

### Description
Modify deployCommand to store prod endpoint and run tests after successful deployment

### Changes
- **File**: `bin/commands/deploy.ts`
- **Action**: Add post-deployment logic

### Code Changes

#### Add Import for CloudFormation
```typescript
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { execSync } from "child_process";
```

#### Modify deployCommand Function
Find the section after successful CDK deployment and add:

```typescript
// After successful deployment, store endpoint and run tests
console.log("");
console.log("Retrieving deployment endpoint...");

try {
    const region = options.region || process.env.AWS_REGION || "us-east-1";
    const cloudformation = new CloudFormationClient({ region });
    const stackName = "BenchlingWebhookStack";

    const command = new DescribeStacksCommand({ StackName: stackName });
    const response = await cloudformation.send(command);

    if (response.Stacks && response.Stacks.length > 0) {
        const stack = response.Stacks[0];
        const endpointOutput = stack.Outputs?.find((o) => o.OutputKey === "WebhookEndpoint");
        const webhookUrl = endpointOutput?.OutputValue || "";

        if (webhookUrl) {
            // Determine image tag
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
                execSync("npm run test:prod", {
                    stdio: "inherit",
                    cwd: process.cwd()
                });
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

### TDD Cycle
**Red**: Test should fail when no test:prod script exists (next episode fixes)
**Green**: Add config storage and test execution logic
**Refactor**: Improve error handling and logging

### Validation
```bash
# Verify TypeScript compilation
npm run build:typecheck

# Will be fully validated after test:prod script added
```

### Success Criteria
- [ ] Config storage integrated after deployment
- [ ] Test execution integrated after config storage
- [ ] Error handling for missing endpoint
- [ ] Error handling for test failures
- [ ] TypeScript compilation succeeds

### Commit Message
```
feat(deploy): store prod endpoint and run tests after deployment

After successful production deployment:
1. Query CloudFormation for WebhookEndpoint
2. Store endpoint in ~/.config/benchling-webhook/deploy.json
3. Run integration tests via npm run test:prod
4. Fail deployment if tests fail

This ensures production deployments are validated before marking
as successful.

Part of GitHub issue #176.
```

---

## Episode 7: Add npm Scripts for test:dev and test:prod

### Description
Add new npm scripts for testing dev and prod environments

### Changes
- **File**: `package.json`
- **Action**: Add test:dev and test:prod scripts

### Code Changes
```json
{
  "scripts": {
    "test:dev": "make -C docker test-deployed-dev",
    "test:prod": "make -C docker test-deployed-prod",
    "test:remote": "npm run test:dev"
  }
}
```

**Note**: Change test:remote to call test:dev for backward compatibility

### TDD Cycle
**Red**: N/A (npm scripts don't have unit tests)
**Green**: Add scripts to package.json
**Refactor**: Verify scripts execute correctly

### Validation
```bash
# Verify scripts exist
npm run test:dev -- --version 2>&1 || echo "Expected error (no endpoint yet)"
npm run test:prod -- --version 2>&1 || echo "Expected error (no endpoint yet)"

# Verify JSON syntax
npm run build:typecheck
```

### Success Criteria
- [ ] test:dev script added
- [ ] test:prod script added
- [ ] test:remote updated to use test:dev
- [ ] package.json valid JSON

### Commit Message
```
feat(scripts): add test:dev and test:prod commands

Add npm scripts for testing deployed dev and prod stacks:
- test:dev: Test development stack via API Gateway
- test:prod: Test production stack via API Gateway
- test:remote: Updated to use test:dev (backward compatible)

Part of GitHub issue #176.
```

---

## Episode 8: Update README.md Documentation

### Description
Document new test commands and production deployment behavior

### Changes
- **File**: `README.md`
- **Actions**:
  1. Update "Available Test Commands" section
  2. Update "Production Release" section

### Code Changes

#### Update "Available Test Commands" Section
Find the testing section and add:
```markdown
#### Remote Deployment Testing

```bash
# Test development stack
npm run test:dev          # Test dev stack via API Gateway (clearer than test:remote)

# Test production stack
npm run test:prod         # Test prod stack via API Gateway

# Deprecated (use test:dev instead)
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

#### Update "Production Release" Section
Find "Step 2: Deploy to production" and update:
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
3. **Automatically run integration tests** against the deployed endpoint
4. **Fail if tests do not pass**, ensuring no broken deployments

**Note**: Production deployment will fail if integration tests fail. This is intentional
to prevent deploying broken code to production.
```

### TDD Cycle
**Red**: N/A (documentation doesn't have tests)
**Green**: Update documentation
**Refactor**: Ensure examples are accurate

### Validation
```bash
# Verify markdown syntax
# (Manual review or markdown linter if available)
```

### Success Criteria
- [ ] Remote testing section added
- [ ] Production deployment section updated
- [ ] Examples are accurate
- [ ] Deprecation notice included

### Commit Message
```
docs: document test:dev and test:prod commands

Update README.md to document:
- New test:dev and test:prod commands
- Production deployment now runs tests automatically
- Deprecation notice for test:remote

Part of GitHub issue #176.
```

---

## Episode 9: Update CLAUDE.md Documentation

### Description
Update CLAUDE.md with new test commands in daily workflow

### Changes
- **File**: `docker/CLAUDE.md` or root `CLAUDE.md`
- **Actions**: Update daily development workflow and test commands

### Code Changes

Find "Daily development" section and update:
```markdown
#### Daily development

```bash
npm run test                 # Fast unit tests (lint + typecheck + mocked tests)
npm run test:local           # Local Docker integration (when needed)
npm run test:dev             # Test deployed dev stack (if deployed)
```

Find "Before creating PR" section and update:
```markdown
#### Before creating PR

```bash
npm run test:local           # Verify integration works
npm run test:dev             # Test deployed dev stack (optional)
git commit -m "type(scope): description"
gh pr create
```

Find "Available Test Commands" section (if exists) and update:
```markdown
#### Available Test Commands

```bash
# Remote deployment testing
npm run test:dev             # Test dev stack via API Gateway (clearer than test:remote)
npm run test:prod            # Test prod stack via API Gateway
npm run test:remote          # DEPRECATED - use test:dev (will be removed in 0.7.0)
```

### TDD Cycle
**Red**: N/A (documentation doesn't have tests)
**Green**: Update documentation
**Refactor**: Ensure consistency with README

### Validation
```bash
# Verify markdown syntax
# Manual review
```

### Success Criteria
- [ ] Daily workflow updated
- [ ] Test commands documented
- [ ] Consistent with README.md

### Commit Message
```
docs: update CLAUDE.md with new test commands

Update developer workflow documentation to include test:dev
and test:prod commands. Mark test:remote as deprecated.

Part of GitHub issue #176.
```

---

## Episode 10: Integration Testing and Validation

### Description
Run comprehensive integration tests to validate entire implementation

### Changes
- **File**: None (testing only)
- **Action**: Execute test scenarios

### Test Scenarios

#### Scenario 1: npm Script Validation
```bash
# Verify all scripts exist
npm run test:dev -- --help || echo "Expected error (no endpoint)"
npm run test:prod -- --help || echo "Expected error (no endpoint)"

# Verify build succeeds
npm run build:typecheck
npm test
```

#### Scenario 2: Makefile Target Validation
```bash
# Verify Make targets exist
make -C docker help | grep test-deployed-dev
make -C docker help | grep test-deployed-prod
make -C docker help | grep test-docker-prod

# Verify targets fail gracefully without endpoint
make -C docker test-deployed-prod 2>&1 | grep "deploy:prod"
```

#### Scenario 3: Full Dev Workflow (if dev stack deployed)
```bash
# If dev stack exists, test it
if [ -f ~/.config/benchling-webhook/deploy.json ]; then
    npm run test:dev
fi
```

#### Scenario 4: Documentation Validation
```bash
# Verify examples in README are syntactically correct
# Manual review of README.md examples
```

### TDD Cycle
**Red**: N/A (integration testing phase)
**Green**: Fix any issues found
**Refactor**: Improve error messages if needed

### Validation
```bash
# Full test suite
npm test

# TypeScript compilation
npm run build:typecheck

# Linting
npm run lint
```

### Success Criteria
- [ ] All unit tests pass
- [ ] TypeScript compilation succeeds
- [ ] Linting passes
- [ ] Make targets exist and have correct syntax
- [ ] npm scripts exist and delegate correctly
- [ ] Error messages are clear and helpful
- [ ] Documentation examples are accurate

### Commit Message
```
test: validate test:prod implementation

Integration testing of complete test:prod feature:
- Verified npm scripts exist and delegate correctly
- Verified Make targets have correct syntax
- Verified error messages are helpful
- Validated against acceptance criteria

All acceptance criteria from issue #176 are met.

Closes #176.
```

---

## Episode Summary

### Total Episodes: 10
1. ✅ Version Bump (0.6.2 → 0.6.3)
2. ✅ TypeScript Type Definitions
3. ✅ Makefile: Rename test-prod → test-docker-prod
4. ✅ Makefile: Add test-deployed-prod
5. ✅ Add storeDeploymentConfig helper
6. ✅ Integrate config storage and testing in deploy.ts
7. ✅ Add npm scripts (test:dev, test:prod)
8. ✅ Update README.md documentation
9. ✅ Update CLAUDE.md documentation
10. ✅ Integration testing and validation

### Dependencies
- Episodes 1-2: Independent (can run in parallel)
- Episode 3: Must complete before Episode 4
- Episodes 4-7: Sequential (build on each other)
- Episodes 8-9: Independent (documentation)
- Episode 10: Must be last (validation)

### Estimated Time
- Version bump: 5 minutes
- Type definitions: 10 minutes
- Makefile refactoring: 30 minutes
- deploy.ts enhancements: 45 minutes
- npm scripts: 10 minutes
- Documentation: 30 minutes
- Integration testing: 30 minutes

**Total**: ~2.5 hours
