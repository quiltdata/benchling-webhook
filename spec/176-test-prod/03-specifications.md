# Engineering Specifications - Issue #176: test:prod Command

**Date**: 2025-11-03
**References**: 01-requirements.md, 02-analysis.md

## Desired End State

### 1. Test Command Interface

#### npm Scripts
```json
{
  "test:dev": "Test development stack via API Gateway endpoint",
  "test:prod": "Test production stack via API Gateway endpoint",
  "test:remote": "Deprecated alias for test:dev (remove in 0.7.0)"
}
```

**Success Criteria**:
- Commands are self-documenting (names clearly indicate environment)
- Both dev and prod use identical test infrastructure
- Commands fail fast with actionable error messages
- Exit codes properly indicate success (0) or failure (1)

### 2. Deployment Configuration Schema

#### XDG Configuration (`~/.config/benchling-webhook/deploy.json`)
```typescript
interface DeploymentConfig {
  dev?: EnvironmentConfig;
  prod?: EnvironmentConfig;
}

interface EnvironmentConfig {
  endpoint: string;           // API Gateway webhook URL
  imageTag: string;           // Docker image tag deployed
  deployedAt: string;         // ISO 8601 timestamp
  stackName: string;          // CloudFormation stack name
  region?: string;            // AWS region (default: us-east-1)
}
```

**Success Criteria**:
- Both dev and prod deployments write to same config file
- Schema is backward compatible (existing dev configs still work)
- Config is atomically updated (no partial writes)
- Missing config produces clear error messages

### 3. Test Infrastructure Architecture

#### Test Execution Flow
```
npm run test:dev/test:prod
  → Makefile target (test-deployed-dev/test-deployed-prod)
    → Read endpoint from deploy.json
    → Execute test_webhook.py with endpoint URL
      → Health checks (/health, /health/ready)
      → Webhook endpoint tests (/event)
      → Canvas endpoint tests (/canvas)
      → Lifecycle endpoint tests (/lifecycle)
    → Return exit code
  → Report results
```

**Success Criteria**:
- Single test script (`test_webhook.py`) works for all environments
- Endpoint resolution is environment-aware
- Test results are clearly formatted with success/failure indicators
- Failures include diagnostic information

### 4. Production Deployment Integration

#### Enhanced deploy:prod Workflow
```
npm run deploy:prod
  1. Validate inputs (stack ARN, secret name, image tag)
  2. Execute CDK deployment
  3. Query CloudFormation stack outputs
  4. Write deployment config to deploy.json (prod section)
  5. Execute npm run test:prod
  6. Report final status
```

**Success Criteria**:
- Test failures cause deployment to fail (exit code 1)
- Successful tests log confirmation message
- Deploy.json updated before tests run
- Deployment logs clearly show test execution phase

### 5. Docker Makefile Refactoring

#### Updated Targets
```makefile
# Local Docker testing (renamed to avoid conflict)
test-docker-prod:   # Test local Docker container on port 5003

# Remote deployment testing (new)
test-deployed-dev:  # Test dev stack via API Gateway (existing)
test-deployed-prod: # Test prod stack via API Gateway (new)
```

**Success Criteria**:
- No naming conflicts between local and remote testing
- Consistent naming pattern across environments
- Targets follow existing Make conventions
- Help text clearly describes each target

## Architectural Goals

### Goal 1: Environment Parity
Dev and prod environments must be tested identically, using the same test logic and validation criteria.

### Goal 2: Configuration Consistency
All deployment environments must follow the same configuration storage pattern (XDG-based).

### Goal 3: Deployment Verification
Production deployments must not succeed unless integration tests pass.

### Goal 4: Developer Experience
Command names must be intuitive, and error messages must be actionable.

### Goal 5: Backward Compatibility
Existing workflows must continue to function during deprecation period.

## Design Principles

### Principle 1: Fail Fast
Tests should detect problems immediately and fail with clear diagnostics.

### Principle 2: Single Responsibility
Each component (npm script, Make target, Python script) has one clear purpose.

### Principle 3: DRY (Don't Repeat Yourself)
Test logic is written once and reused across environments.

### Principle 4: Configuration Over Convention
Deployment endpoints are explicitly configured, not inferred.

### Principle 5: Graceful Degradation
Missing configuration produces helpful error messages, not cryptic failures.

## Integration Points

### Integration Point 1: CloudFormation Stack Outputs
**Interface**: AWS CloudFormation DescribeStacks API
**Data Flow**: Stack outputs → deploy.json → test commands
**Contract**: Stack must expose `WebhookEndpoint` output key

### Integration Point 2: XDG Configuration System
**Interface**: JSON file at `~/.config/benchling-webhook/deploy.json`
**Data Flow**: Deployment commands write, test commands read
**Contract**: JSON schema must be valid and include required fields

### Integration Point 3: Test Execution
**Interface**: Python script with URL argument and exit code return
**Data Flow**: Make target → Python script → HTTP requests → exit code
**Contract**: Exit 0 for success, exit 1 for any failure

### Integration Point 4: npm Script Chain
**Interface**: npm script execution with exit code propagation
**Data Flow**: deploy:prod → CDK deploy → test:prod → exit code
**Contract**: Any failure stops the chain and returns non-zero

## API Contracts

### Contract 1: deploy.json Structure
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "dev": { "$ref": "#/definitions/environment" },
    "prod": { "$ref": "#/definitions/environment" }
  },
  "definitions": {
    "environment": {
      "type": "object",
      "required": ["endpoint", "imageTag", "deployedAt", "stackName"],
      "properties": {
        "endpoint": { "type": "string", "format": "uri" },
        "imageTag": { "type": "string" },
        "deployedAt": { "type": "string", "format": "date-time" },
        "stackName": { "type": "string" },
        "region": { "type": "string", "default": "us-east-1" }
      }
    }
  }
}
```

### Contract 2: Test Script Interface
```python
# Command line interface
# Usage: python test_webhook.py <endpoint-url>
# Returns: exit code 0 (success) or 1 (failure)
# Stdout: Test results with emoji indicators
```

### Contract 3: Make Target Interface
```makefile
# Target: test-deployed-{env}
# Prerequisites: check-xdg
# Success: exit 0
# Failure: exit 1, prints error message
```

### Contract 4: npm Script Interface
```javascript
// Script: test:dev or test:prod
// Success: exit code 0, prints "✅ All tests passed!"
// Failure: exit code 1, prints "❌ {N} test(s) failed"
```

## Quality Gates

### Quality Gate 1: Test Coverage
- All webhook endpoints must be tested (event, canvas, lifecycle)
- All health endpoints must be tested (/health, /health/ready, /health/live)
- Minimum 10 distinct test cases executed

### Quality Gate 2: Performance
- Health checks must complete in < 5 seconds
- Full test suite must complete in < 3 minutes
- No test hangs or timeouts beyond configured limits

### Quality Gate 3: Error Reporting
- Test failures must include endpoint URL and response details
- Missing configuration must show exact file path and expected structure
- Network errors must distinguish between connection and timeout issues

### Quality Gate 4: Deployment Validation
- Production deployment must fail if tests fail
- Test failures must not leave infrastructure in bad state
- Deployment logs must clearly indicate test phase

### Quality Gate 5: Documentation
- All new commands must be documented in README.md
- CLAUDE.md must include test commands in daily workflow section
- Deprecation notice for test:remote must be clear

## Success Metrics

### Metric 1: Command Usage
**Target**: Developers use `test:dev` and `test:prod` instead of `test:remote`
**Measurement**: GitHub search for script usage in documentation and issues

### Metric 2: Test Reliability
**Target**: 99% success rate for legitimate deployments
**Measurement**: Test exit codes across all deployments

### Metric 3: Error Clarity
**Target**: All test failures include actionable next steps
**Measurement**: Manual review of error messages

### Metric 4: Performance
**Target**: Test execution under 3 minutes
**Measurement**: Time from test start to exit

### Metric 5: Deployment Safety
**Target**: Zero production deployments succeed with failing tests
**Measurement**: Audit of production deployment logs

## Validation Criteria

### Validation 1: Unit Tests
- Test webhook script runs successfully with mock endpoints
- Configuration reading/writing works correctly
- Exit codes propagate correctly through script chain

### Validation 2: Integration Tests
- Deploy dev stack and verify test:dev passes
- Deploy prod stack and verify test:prod passes
- Verify test failures cause deployment to fail

### Validation 3: Backward Compatibility
- Existing deploy:dev workflow still works
- Existing test:local still works
- Old test:remote still works (with deprecation warning)

### Validation 4: Documentation
- README includes all new commands
- Examples show both dev and prod usage
- Deprecation timeline is clear

### Validation 5: Error Scenarios
- Missing deploy.json produces helpful error
- Invalid endpoint URL fails gracefully
- Network errors are clearly reported

## Technical Constraints

### Constraint 1: XDG Base Directory Specification
Must use `~/.config/benchling-webhook/` as config directory (XDG_CONFIG_HOME)

### Constraint 2: CloudFormation Output Keys
Must use existing output key names (WebhookEndpoint) - cannot change stack

### Constraint 3: Python Runtime
Test scripts must run with `uv run python` for consistency

### Constraint 4: Make Compatibility
Makefile targets must work on both Linux and macOS

### Constraint 5: npm Script Compatibility
Scripts must work on Windows (via make equivalent) and Unix systems

## Risk Mitigation

### Risk 1: Breaking Changes
**Mitigation**: Deprecate test:remote gradually, maintain for one minor version (0.6.x → 0.7.0)

### Risk 2: Configuration Corruption
**Mitigation**: Atomic file writes, validate JSON before writing, backup existing config

### Risk 3: Test False Positives
**Mitigation**: Require multiple endpoint tests, validate response content not just status codes

### Risk 4: Deployment Rollback
**Mitigation**: Tests run after deployment (infrastructure already created), but before marking success

### Risk 5: Developer Confusion
**Mitigation**: Clear naming, comprehensive documentation, helpful error messages

## Out of Scope

The following are explicitly NOT part of this specification:

1. **Test Content Changes**: Not modifying what tests validate, only where they run
2. **CI/CD Integration**: Not changing GitHub Actions workflows (separate concern)
3. **Multi-Region Support**: Single region only (us-east-1), multi-region is future work
4. **Test Parallelization**: Sequential execution is acceptable for current test count
5. **Custom Test Suites**: Single comprehensive test suite for all environments
6. **Rollback Mechanisms**: Not implementing automatic rollback on test failure
7. **Performance Optimization**: Current test suite performance is acceptable
8. **Authentication Testing**: Using existing Benchling credentials, not testing auth flows

## Implementation Notes

### Note 1: Gradual Migration
Implement test:dev and test:prod first, deprecate test:remote in documentation, remove in 0.7.0.

### Note 2: Config File Location
Use existing XDG pattern - no need to create new config files or directories.

### Note 3: Error Messages
Follow existing emoji convention (✅ ❌ 💡) for consistency with other commands.

### Note 4: Version Bump
Version 0.6.3 bump should occur before implementation begins, not after.

### Note 5: TypeScript vs Python
Use TypeScript for deployment logic, Python for test execution (maintain existing patterns).
