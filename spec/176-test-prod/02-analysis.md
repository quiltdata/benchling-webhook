# Analysis - Issue #176: test:prod Command

**Date**: 2025-11-03
**References**: 01-requirements.md

## Current State Assessment

### Existing Test Infrastructure

#### npm Scripts (package.json)
Current test-related scripts in `package.json`:
```json
{
  "test": "npm run build:typecheck && npm run test:ts && npm run test:python",
  "test:ci": "npm run build:typecheck && npm run test:ts",
  "test:local": "make -C docker build && make -C docker test-local",
  "test:python": "make -C docker test-unit",
  "test:remote": "npm run deploy:dev && make -C docker test-deployed-dev",
  "test:ts": "cross-env NODE_ENV=test jest --maxWorkers=50%"
}
```

**Current Structure**:
- `test`: Fast unit tests (TypeScript + Python + linting)
- `test:local`: Docker-based local integration tests
- `test:remote`: Deploys dev stack and tests via API Gateway
- No production-specific testing command exists

#### Docker Makefile Test Targets
From `docker/Makefile`:
```makefile
test-dev:       # Test against docker dev server (port 5002)
test-prod:      # Test against docker prod server (port 5003) - EXISTS but different meaning
test-ecr:       # Test ECR image locally
test-local:     # Auto-managed local server tests
test-integration: # Full integration with real Benchling
test-deployed-dev: # Test dev stack via API Gateway endpoint
```

**Key Finding**: `test-prod` already exists in Docker Makefile but refers to testing a local Docker container on port 5003, NOT a deployed production stack.

#### Test Scripts
1. **`docker/scripts/test_webhook.py`**:
   - Generic webhook testing script
   - Accepts server URL as command-line argument
   - Tests health endpoints, webhooks, canvas, and lifecycle events
   - Returns exit code 0 for success, 1 for failure
   - Already environment-agnostic!

2. **`test-deployed-dev` target** (docker/Makefile:240-250):
   ```makefile
   test-deployed-dev: check-xdg
       @echo "🧪 Testing deployed dev stack..."
       @DEV_ENDPOINT=$$(jq -r '.dev.endpoint // empty' $(XDG_CONFIG)/deploy.json 2>/dev/null); \
       if [ -z "$$DEV_ENDPOINT" ]; then \
           echo "❌ No dev endpoint found in $(XDG_CONFIG)/deploy.json"; \
           exit 1; \
       fi; \
       echo "📡 Testing endpoint: $$DEV_ENDPOINT"; \
       uv run python scripts/test_webhook.py "$$DEV_ENDPOINT"
   ```
   - Reads endpoint from `~/.config/benchling-webhook/deploy.json`
   - Uses same `test_webhook.py` script
   - Environment-specific via JSON path

### Deployment Workflows

#### Development Deployment (bin/dev-deploy.ts)
Flow:
1. Creates timestamped dev tag (e.g., `v0.6.2-20251103T120000Z`)
2. Pushes tag to GitHub (triggers CI)
3. Waits for CI to build Docker image
4. Deploys CDK stack with CI-built image
5. Stores endpoint in `~/.config/benchling-webhook/deploy.json` under `dev` key:
   ```json
   {
     "dev": {
       "endpoint": "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
       "imageTag": "0.6.2-20251103T120000Z",
       "deployedAt": "2025-11-03T12:05:00.000Z",
       "stackName": "BenchlingWebhookStack"
     }
   }
   ```

**Current Trigger**: `npm run deploy:dev` runs tests via `make -C docker test-deployed-dev`

#### Production Deployment (bin/cli.ts -> bin/commands/deploy.ts)
Flow:
1. Validates configuration (Quilt stack ARN, Benchling secret)
2. Runs CDK deploy with specified image tag
3. Outputs deployment results
4. **NO automated testing currently**

**Current Trigger**: `npm run deploy:prod` does NOT run any tests

### XDG Configuration System

**Config Location**: `~/.config/benchling-webhook/deploy.json`

**Current Schema**:
```json
{
  "dev": {
    "endpoint": "string",
    "imageTag": "string",
    "deployedAt": "ISO8601 timestamp",
    "stackName": "string"
  }
  // No "prod" key exists yet
}
```

**Gap**: No production deployment info stored in XDG config

### Current Code Idioms and Conventions

#### Testing Patterns
1. **Make targets for Docker operations**: All Docker/deployment testing goes through Makefile
2. **Python scripts for webhook testing**: Generic scripts accept URL parameter
3. **npm scripts for workflow orchestration**: High-level commands chain make targets
4. **XDG config for deployment tracking**: Deployments write outputs to `~/.config/benchling-webhook/deploy.json`

#### Naming Conventions
- `test:*` for unit/integration tests
- `deploy:*` for deployment operations
- Docker Makefile uses hyphenated names (`test-deployed-dev`)
- npm scripts use colons (`test:remote`)

#### Error Handling
- Make targets fail fast with exit codes
- Graceful error messages with emoji indicators (✅, ❌)
- Clear instructions when prerequisites missing

## Current Challenges and Gaps

### Challenge 1: Naming Confusion
**Issue**: `test:remote` is ambiguous - "remote" could mean dev or prod
**Impact**: Developers unsure which environment they're testing
**Current Behavior**: `test:remote` tests dev stack, despite generic name

### Challenge 2: No Production Testing
**Issue**: `deploy:prod` doesn't validate deployment success
**Impact**: Production deployments could fail silently
**Current Workaround**: Manual testing via curl or Benchling UI

### Challenge 3: Docker Makefile Conflict
**Issue**: `test-prod` target already exists but means "test local Docker on port 5003"
**Impact**: Cannot simply rename npm script without addressing Makefile conflict
**Current State**: Two different meanings for "test-prod"

### Challenge 4: Missing Production Config Storage
**Issue**: Production deployments don't write to `deploy.json`
**Impact**: Cannot automatically detect prod endpoint for testing
**Current Workaround**: Parse CloudFormation stack outputs manually

### Challenge 5: Inconsistent Testing Interface
**Issue**: Dev testing uses XDG config, but no equivalent for prod
**Impact**: Different code paths for dev vs prod testing
**Current State**: `test-deployed-dev` pattern not replicated for prod

## Architectural Considerations

### Current Architecture
```
npm scripts (package.json)
    ↓
Docker Makefile targets
    ↓
Python test scripts (test_webhook.py)
    ↓
Deployed endpoints (dev or prod)
```

### Configuration Flow
```
Deployment (dev-deploy.ts)
    → CloudFormation outputs
    → XDG config (deploy.json)
    → Make targets read config
    → Test scripts use endpoints
```

### Endpoint Discovery
**Dev**: Stored in `deploy.json` by `dev-deploy.ts` (line 322-335)
**Prod**: NOT stored anywhere, must query CloudFormation stack

## Technical Debt Opportunities

### Opportunity 1: Unified Configuration Storage
Both dev and prod deployments should write to `deploy.json` with environment-specific keys

### Opportunity 2: Consistent Test Target Naming
Rename Docker Makefile `test-prod` to `test-prod-local` or `test-docker-prod` to free up name

### Opportunity 3: Reusable Test Infrastructure
`test_webhook.py` is already generic - just need consistent endpoint resolution

### Opportunity 4: Deploy Command Consistency
Both `deploy:dev` and `deploy:prod` should follow same pattern:
1. Deploy stack
2. Store outputs
3. Run tests
4. Report results

## Code Areas Requiring Changes

### Files to Modify
1. **package.json**: Add `test:dev`, `test:prod`, update `deploy:prod`
2. **docker/Makefile**:
   - Rename `test-prod` → `test-docker-prod`
   - Add `test-deployed-prod` target
3. **bin/commands/deploy.ts**: Store prod endpoint in `deploy.json`
4. **deploy.json schema**: Add prod environment structure

### Files NOT Requiring Changes
1. **test_webhook.py**: Already generic, no changes needed
2. **dev-deploy.ts**: Already follows desired pattern
3. **test infrastructure**: Reusable as-is

## Dependencies and Sequencing

### Must Complete First
1. Update deploy.json schema to include prod environment
2. Modify deploy:prod to write outputs to deploy.json

### Then Can Implement
3. Add test-deployed-prod Makefile target (mirrors test-deployed-dev)
4. Add npm scripts (test:dev, test:prod)
5. Update deploy:prod to run tests after deployment

### Finally
6. Update documentation
7. Deprecate test:remote

## Existing System Constraints

### Constraint 1: XDG Configuration Standard
Must follow existing XDG pattern: `~/.config/benchling-webhook/deploy.json`

### Constraint 2: CloudFormation Stack Outputs
Production deployments use CloudFormation - must query stack for endpoint

### Constraint 3: Make-based Testing
Docker testing infrastructure uses Make - must maintain compatibility

### Constraint 4: Python Testing Scripts
Test scripts use Python with uv - must maintain this pattern

### Constraint 5: Exit Codes
Test scripts must return proper exit codes (0=success, 1=failure) for CI/CD

## Risk Assessment

### Low Risk
- Adding new npm scripts (non-breaking)
- Adding new Make targets (non-breaking)
- Extending deploy.json schema (backward compatible)

### Medium Risk
- Renaming Docker Makefile target (could break developer workflows)
- Modifying deploy:prod to run tests (could slow deployment, but catchable)

### High Risk (None Identified)
All changes are additive or low-impact refactoring

## Performance Considerations

### Test Execution Time
- Health checks: ~1-2 seconds
- Webhook tests: ~5-10 seconds per endpoint
- Total test suite: ~30-45 seconds
- Within 3-minute acceptance criteria

### Deployment Impact
- Adding tests to deploy:prod will add ~1 minute to deployment
- Acceptable trade-off for production verification

## Conclusion

The current infrastructure is well-positioned for this enhancement:
- Test scripts are already generic and reusable
- XDG configuration pattern is established
- Dev deployment already follows desired pattern

**Main gaps**:
1. Production deployment doesn't store outputs
2. No production-specific test commands
3. Naming conflicts in Docker Makefile
4. Missing test integration in deploy:prod workflow

**Recommended approach**: Follow dev-deploy pattern for prod, with minimal refactoring of existing test infrastructure.
