# Analysis Document: Configuration and Secrets Architecture

**Spec**: 156c-secrets-config
**Branch**: 156c-secrets-config
**Issue**: #156 - secrets manager
**Date**: 2025-11-02

## Executive Summary

This analysis examines the current state of the Benchling webhook integration's configuration and secrets management architecture. The system has evolved through multiple iterations (v0.5.4 → v0.6.0) toward a "secrets-only" model but still lacks the unified, XDG-compliant configuration storage and Makefile-driven workflow specified in the requirements. This document identifies architectural patterns, implementation gaps, and challenges that must be addressed to achieve the target v0.6.0 architecture.

## 1. Current Architecture Analysis

### 1.1 Configuration Sources (Multiple Sources of Truth)

The current system (v0.5.4 transitioning to v0.6.0) accepts configuration from **six different sources**, creating complexity and potential conflicts:

1. **CLI Options** (`bin/cli.ts`):
   - `--quilt-stack-arn`, `--benchling-secret`, `--catalog`, `--bucket`, `--tenant`, `--client-id`, `--client-secret`, `--app-id`, `--benchling-secrets`

2. **Environment Variables**:
   - `QUILT_STACK_ARN`, `BENCHLING_SECRET`, `QUILT_CATALOG`, `QUILT_USER_BUCKET`, `BENCHLING_TENANT`, `BENCHLING_CLIENT_ID`, `BENCHLING_CLIENT_SECRET`, `BENCHLING_APP_DEFINITION_ID`, etc.

3. **.env Files** (`env.template`):
   - All of the above variables
   - Manual creation and maintenance required
   - No schema validation

4. **Quilt3 CLI Config** (`~/.quilt3/config.yml`):
   - Catalog URL inference only
   - Accessed via `lib/utils/config.ts:getQuilt3Catalog()`

5. **CloudFormation Stack Outputs** (`lib/utils/stack-inference.ts`):
   - Inference during deployment only
   - Not available at runtime

6. **AWS Secrets Manager**:
   - Via `BENCHLING_SECRETS` or `BenchlingSecret` parameter
   - Currently used for Benchling credentials only

**Gap vs. Requirements**: Requirements specify a single source of truth (XDG configuration split across three files: `~/.config/benchling-webhook/default.json` for user settings, `~/.config/benchling-webhook/config/default.json` for derived settings, and `~/.config/benchling-webhook/deploy/default.json` for deployment outputs). Current implementation has no XDG support and maintains multiple configuration sources.

### 1.2 Secrets Management Implementation

#### Current State (v0.6.0 Partial Implementation)

**Secrets-Only Mode** exists but is incomplete:

```typescript
// From lib/benchling-webhook-stack.ts (lines 11-32)
export interface BenchlingWebhookStackProps extends cdk.StackProps {
    readonly quiltStackArn: string;     // REQUIRED
    readonly benchlingSecret: string;   // REQUIRED
}
```

**What Works**:
- Stack accepts `quiltStackArn` and `benchlingSecret` parameters
- CDK stack creates CloudFormation parameters
- Container receives `QuiltStackARN` and `BenchlingSecret` environment variables
- Python application resolves config via `ConfigResolver` at runtime (See `docker/src/config.py`)

**What's Missing**:
- No XDG configuration storage
- No `make install` command
- No interactive credential collection
- No automatic inference during installation
- No configuration validation before deployment
- No unified configuration file format

#### Secret Creation Workflow

**Current Process** (`bin/create-secret.ts`):
1. Reads 10 variables from `.env` file or environment
2. Validates required parameters
3. Creates/updates secret in AWS Secrets Manager
4. No local persistence of configuration

**Problems**:
- Manual `.env` file maintenance required
- No validation until secret creation attempt
- No feedback loop for missing configuration
- No integration with deployment workflow

**Gap vs. Requirements**: Requirements specify `make install` should handle complete setup including secret creation, credential validation, and XDG persistence. Current implementation requires manual steps.

### 1.3 Configuration Resolution Architecture

#### TypeScript Side (CDK Deployment)

**Current Implementation** (`lib/utils/config.ts`):

```typescript
export function loadConfigSync(options: ConfigOptions = {}): Partial<Config> {
    // 1. Load .env file
    const dotenvVars = existsSync(envFile) ? loadDotenv(envFile) : {};

    // 2. Merge with process.env
    const envVars = { ...dotenvVars, ...process.env };

    // 3. Try to get catalog from quilt3 config
    const quilt3Catalog = getQuilt3Catalog();

    // 4. CLI options take priority
    return {
        quiltCatalog: options.catalog || envVars.QUILT_CATALOG || quilt3Catalog,
        // ... more fields
    };
}
```

**Characteristics**:
- Synchronous, file-based configuration loading
- Priority: CLI > env vars > .env file > quilt3 config
- No validation until deployment attempt
- No caching or persistence

**Gap vs. Requirements**: Requirements specify XDG-based configuration with JSON schema validation and priority rules that favor XDG over environment variables.

#### Python Side (Runtime Application)

**Current Implementation** (`docker/src/config.py`):

```python
@dataclass
class Config:
    """Application configuration - production uses secrets-only mode."""

    def __post_init__(self):
        quilt_stack_arn = os.getenv("QuiltStackARN")
        benchling_secret = os.getenv("BenchlingSecret")

        if not quilt_stack_arn or not benchling_secret:
            raise ValueError("Missing required environment variables...")

        # Resolve all configuration from AWS
        resolver = ConfigResolver()
        resolved = resolver.resolve(quilt_stack_arn, benchling_secret)
```

**Characteristics**:
- Runtime resolution from AWS APIs
- Requires network connectivity and AWS credentials
- No local caching or fallback
- Clean separation: only 2 input parameters

**Assessment**: Python side correctly implements secrets-only architecture. The gap is in the setup/installation workflow that should create these parameters.

### 1.4 Testing Infrastructure

#### Current Test Organization

**TypeScript Tests** (`test/` directory):
- Unit tests for configuration utilities: `test/utils-config.test.ts`
- Stack synthesis tests
- No integration tests with real AWS services
- Mocked AWS SDK clients

**Python Tests** (`docker/tests/` directory):
- Unit tests with mocked dependencies
- Integration tests require manual server setup
- No automated fixture management

#### Test Commands Analysis

**npm Test Commands** (`package.json`):
```json
{
    "test": "npm run typecheck && npm run test-ts && npm run test:python",
    "test-ci": "npm run typecheck && npm run test-ts",
    "test-ts": "NODE_ENV=test node --max-old-space-size=4096 ./node_modules/.bin/jest",
    "typecheck": "tsc --noEmit"
}
```

**Docker Test Commands** (`docker/Makefile`):
- `make test` - Runs lint + test-unit + test-integration
- `make test-unit` - Unit tests only (fast, no AWS)
- `make test-local` - Auto-managed local server with test webhooks
- `make test-dev` - Tests against running Docker dev server
- `make test-prod` - Tests against running Docker production server
- `make test-ecr` - Tests against ECR-pulled image
- `make test-benchling` - Validates Benchling OAuth credentials
- `make test-integration` - Full integration with real Benchling

**Gap vs. Requirements**: Requirements specify three-tier testing (`make test`, `make test-local`, `make test-remote`) with clear separation. Current implementation has the right components but inconsistent naming and no top-level Makefile orchestration.

### 1.5 Deployment Workflow

#### Current Deployment Process

**Via npm CLI** (`bin/commands/deploy.ts`):

1. Parse CLI options and environment variables
2. Validate `quiltStackArn` parameter (required)
3. Check if `benchlingSecret` exists in AWS Secrets Manager
4. If secret doesn't exist, offer to run `npm run config` interactively
5. Check CDK bootstrap status
6. Display deployment plan with masked ARNs
7. Execute `npx cdk deploy` with parameters
8. Retrieve stack outputs and test webhook endpoint

**Challenges**:
- Interactive prompts require manual intervention
- No automated credential validation before deployment
- No persistent configuration file created
- No idempotent re-run capability
- No integration with `make` workflow

**Gap vs. Requirements**: Requirements specify `make install` creates persistent XDG configuration, then deployment reads from that configuration. Current workflow is npm-centric with no Makefile integration.

#### Configuration Inference

**Stack Inference Tool** (`bin/get-env.js`):

```javascript
// Fetches config.json from catalog
// Queries CloudFormation for stack details
// Generates env.inferred file with inferred values
```

**Usage**:
```bash
node bin/get-env.js https://catalog.example.com --write
# Creates env.inferred file (not .env to avoid overwriting)
```

**Problems**:
- Separate tool, not integrated into deployment workflow
- Inference happens at deploy-time, not at runtime
- Results written to file that must be manually reviewed and merged
- No validation of inferred values

**Gap vs. Requirements**: Requirements specify automatic inference during `make install` with immediate validation and XDG persistence.

### 1.6 Makefile Analysis

**Current State**: There is **NO top-level Makefile** in the project root.

**Docker Makefile** (`docker/Makefile`):
- Comprehensive targets for Docker development
- No dependency on parent directory Makefile
- Includes `.env` file from parent: `-include ../.env`
- Delegates to npm scripts for some operations

**Docker Deploy Makefile** (`docker/make.deploy`):
- Separate file for deployment-related targets
- ECR push operations
- Image tagging logic

**Gap vs. Requirements**: Requirements specify top-level Makefile as orchestration layer with `make install`, `make test`, `make test-local`, `make test-remote`, `make release`, `make tag` targets. None of these exist.

### 1.7 XDG Configuration Storage

**Current State**: **No XDG support whatsoever**.

**What Exists**:
- `.env` files in project directory
- Environment variables
- No `~/.config/benchling-webhook/` directory
- No JSON configuration schema
- No persistent configuration storage

**What Would Be Required**:
- XDG Base Directory specification compliance
- JSON schema for `default.json` configuration
- Atomic write operations for configuration updates
- Schema validation on read
- Migration from `.env` to XDG format

**Gap vs. Requirements**: Complete implementation gap. No code exists for XDG configuration management.

## 2. Code Idioms and Conventions

### 2.1 TypeScript Conventions

**Style** (Enforced by ESLint):
- 4-space indentation
- Double quotes for strings
- Trailing commas required
- Semicolons required
- Explicit return types on exported functions

**Example** (`lib/benchling-webhook-stack.ts`):
```typescript
export class BenchlingWebhookStack extends cdk.Stack {
    constructor(
        scope: Construct,
        id: string,
        props: BenchlingWebhookStackProps,
    ) {
        super(scope, id, props);
        // ...
    }
}
```

**Error Handling Pattern**:
```typescript
export class ConfigResolverError extends Error {
    constructor(
        message: string,
        public readonly suggestion?: string,
        public readonly details?: string,
    ) {
        super(message);
        this.name = "ConfigResolverError";
    }

    format(): string {
        // Structured error formatting
    }
}
```

### 2.2 Python Conventions

**Style** (Enforced by black + isort):
- PEP 8 compliance
- Type hints on function signatures
- Dataclasses for configuration objects

**Example** (`docker/src/config.py`):
```python
@dataclass
class Config:
    """Application configuration - production uses secrets-only mode."""
    flask_env: str = ""
    log_level: str = ""
    # ...
```

**Error Handling Pattern**:
```python
try:
    resolver = ConfigResolver()
    resolved = resolver.resolve(quilt_stack_arn, benchling_secret)
except (ConfigResolverError, ValueError) as e:
    raise ValueError(f"Failed to resolve configuration from AWS: {str(e)}")
```

### 2.3 CLI Patterns

**Commander.js Usage** (`bin/cli.ts`):
- Command-based CLI structure
- Options with validation
- Help text with examples
- Async action handlers

**Ora Spinners** (`bin/commands/deploy.ts`):
- Progress feedback for long operations
- Success/failure indication
- Contextual status messages

**Enquirer Prompts**:
- Interactive confirmation prompts
- Input validation
- Default values

### 2.4 AWS SDK Patterns

**Client Instantiation**:
```typescript
const client = new SecretsManagerClient({ region });
const command = new GetSecretValueCommand({ SecretId: secretIdentifier });
const response = await client.send(command);
```

**Error Handling**:
```typescript
catch (error: unknown) {
    if (error instanceof ResourceNotFoundException) {
        throw new ConfigResolverError("Secret not found", "Check secret name");
    }
    throw error;
}
```

### 2.5 Testing Patterns

**Jest Tests**:
- Describe/it structure
- beforeEach/afterEach cleanup
- Environment variable mocking
- File system mocking

**Python Tests**:
- pytest fixtures
- unittest.mock for AWS services
- Parametrized tests for multiple scenarios

## 3. Current System Constraints

### 3.1 AWS Infrastructure Constraints

**CloudFormation Stack Dependencies**:
- Stack must reference existing Quilt CloudFormation stack
- Stack outputs must be queryable at runtime
- IAM permissions required: `cloudformation:DescribeStacks`, `secretsmanager:GetSecretValue`

**Secrets Manager Constraints**:
- Secret format must match expected JSON schema
- Secrets cannot be deleted immediately (30-day recovery period)
- Secret names must be unique per region
- ARN format varies (name vs. full ARN)

**ECS/Fargate Constraints**:
- Environment variables passed to container at startup
- No hot-reload of configuration without service restart
- Task role must have sufficient IAM permissions
- Container must have network access to AWS APIs

### 3.2 Quilt Stack Integration Constraints

**Required Outputs**:
- `UserAthenaDatabaseName` - Athena database for package queries
- `PackagerQueueArn` - SQS queue for package creation

**Optional but Useful**:
- API Gateway endpoint (for catalog URL inference)
- S3 bucket names (if standardized)

**Challenge**: Not all Quilt stacks expose the same outputs. Some may require manual bucket specification.

### 3.3 Development Environment Constraints

**Local Docker Development**:
- Requires AWS credentials mounted at runtime
- Mock mode exists but limited functionality
- Hot-reload works via Docker volume mounts
- Port conflicts possible (5001, 5002, 5003)

**CI/CD Constraints**:
- GitHub Actions runners don't persist home directory
- XDG directories may not exist between jobs
- Secrets must come from CI secrets store
- AWS credentials handled via OIDC or keys

### 3.4 Backward Compatibility Constraints

**v0.5.4 Deployments**:
- Existing deployments use individual environment variables
- CloudFormation stacks have parameters for each field
- Migration path must not break existing installations

**Deprecation Timeline** (from CHANGELOG.md):
- v0.6.x: New parameter available, old parameters deprecated
- v0.7.x - v0.9.x: Deprecation warnings continue
- v1.0.x: Old parameters removed (breaking change)

**Implication**: Implementation must maintain backward compatibility during transition period.

## 4. Technical Debt Assessment

### 4.1 Configuration Complexity Debt

**Severity**: High
**Impact**: Developer onboarding, debugging, maintenance

**Issues**:
1. Six different configuration sources create confusion
2. Priority rules are implicit and undocumented
3. No single source of truth for "current configuration"
4. Debugging requires checking multiple locations
5. Testing requires extensive mocking

**Quantification**:
- 10+ environment variables required minimum
- 6 configuration sources to check
- 3 different file formats (.env, JSON, YAML)
- Manual setup steps: 5-7 depending on environment

### 4.2 Testing Infrastructure Debt

**Severity**: Medium
**Impact**: Development velocity, confidence in changes

**Issues**:
1. No top-level test orchestration
2. Inconsistent test naming (test-unit vs. test-local vs. test-dev)
3. Manual server management for integration tests
4. No automated fixture setup/teardown
5. No test data management strategy

**Quantification**:
- TypeScript tests: ~15 test files, ~200 assertions
- Python tests: ~20 test files, ~150 assertions
- Integration tests require manual Benchling entry setup
- No CI/CD validation of test infrastructure

### 4.3 Documentation Debt

**Severity**: Medium
**Impact**: User adoption, support burden

**Current State**:
- README covers basic deployment
- No comprehensive setup guide
- Configuration parameters scattered across multiple files
- Troubleshooting guidance minimal
- Migration guides incomplete

**Gap Analysis**:
- No architecture decision records (ADRs) for key decisions
- No runbook for common operational tasks
- No debug guide for configuration issues
- Examples focus on simple cases, not edge cases

### 4.4 Security Debt

**Severity**: Low (Addressed in v0.6.0)
**Impact**: Audit compliance, security posture

**Addressed**:
- Secrets moved to AWS Secrets Manager
- Secrets masked in CLI output
- IAM least-privilege policies
- CloudTrail audit logging

**Remaining Gaps**:
- No credential rotation automation
- No expiration policy for secrets
- Local `.env` files may contain sensitive data
- No enforcement of XDG permissions (0600)

## 5. Gaps Between Current State and Requirements

### 5.1 Story 1: Zero-Configuration Bootstrap

**Requirement**: Run a single command that sets up the entire development environment.

**Current State**:
- No `make install` command exists
- Manual `.env` file creation required
- Manual secret creation via `npm run config`
- Manual catalog inference via `node bin/get-env.js`

**Gap Summary**:
- ❌ No single command for complete setup
- ❌ Multiple manual steps required
- ❌ No automated dependency installation
- ❌ No integrated validation

**Implementation Effort**: High (20-30 hours)

### 5.2 Story 2: Automatic Configuration Inference

**Requirement**: System automatically detects Quilt catalog and AWS settings.

**Current State**:
- Inference tool exists (`bin/get-env.js`) but is standalone
- Inference happens at deployment time, not installation time
- Results written to file, not persisted to XDG config
- No integration with deployment workflow

**Gap Summary**:
- ⚠️ Partial implementation exists but not integrated
- ❌ No automatic inference during installation
- ❌ No persistence to XDG configuration
- ❌ No runtime resolution from persisted config

**Implementation Effort**: Medium (15-20 hours)

### 5.3 Story 3: Interactive Credential Collection

**Requirement**: Prompt only for information that cannot be automatically inferred.

**Current State**:
- `bin/commands/init.ts` exists but creates `.env` file
- No integration with XDG configuration
- No automatic inference integration
- No credential validation before storage

**Gap Summary**:
- ⚠️ Interactive prompts exist but output to wrong format
- ❌ No integration with automatic inference
- ❌ No XDG configuration output
- ❌ No validation loop

**Implementation Effort**: Medium (10-15 hours)

### 5.4 Story 4: Configuration Validation

**Requirement**: Immediate feedback when credentials or settings are incorrect.

**Current State**:
- Basic validation in `bin/create-secret.ts`
- Validation happens during secret creation, not before
- No pre-deployment validation of complete configuration
- No Benchling API test until runtime

**Gap Summary**:
- ⚠️ Basic validation exists but incomplete
- ❌ No comprehensive validation framework
- ❌ No credential testing before deployment
- ❌ No S3 bucket access validation

**Implementation Effort**: Medium (15-20 hours)

### 5.5 Story 5: Incremental Testing

**Requirement**: Test changes at multiple levels (unit, local integration, remote integration).

**Current State**:
- Test infrastructure exists but poorly organized
- No top-level Makefile for orchestration
- Inconsistent naming of test targets
- Manual server management for integration tests

**Gap Summary**:
- ⚠️ Test components exist but not well-organized
- ❌ No unified `make test`, `make test-local`, `make test-remote`
- ❌ No automated server lifecycle management
- ❌ No CI-only test targets

**Implementation Effort**: Medium (15-20 hours)

### 5.6 Story 6: Single Source of Truth

**Requirement**: All configuration stored in one location with clear precedence rules.

**Current State**:
- Six different configuration sources
- No XDG configuration directory
- No persistent configuration storage
- Priority rules implicit and inconsistent

**Gap Summary**:
- ❌ No XDG configuration implementation
- ❌ No single source of truth
- ❌ No JSON schema validation
- ❌ No clear precedence documentation

**Implementation Effort**: High (25-30 hours)

### 5.7 Story 7: Secrets Management

**Requirement**: Sensitive credentials stored in AWS Secrets Manager.

**Current State**:
- ✅ Secrets Manager integration exists
- ✅ Secret creation/update tool exists
- ⚠️ Manual process, not automated
- ⚠️ No validation before storage

**Gap Summary**:
- ✅ Core functionality implemented
- ❌ Not integrated into installation workflow
- ❌ No automatic validation
- ⚠️ No rotation automation

**Implementation Effort**: Low (5-10 hours for integration)

### 5.8 Story 8: Idempotent Installation

**Requirement**: Re-run installation command without breaking working setup.

**Current State**:
- No installation command exists
- `.env` files can be overwritten accidentally
- No configuration backup mechanism
- No merge logic for updates

**Gap Summary**:
- ❌ No installation command to make idempotent
- ❌ No configuration preservation logic
- ❌ No backup/restore mechanism
- ❌ No merge strategy for updates

**Implementation Effort**: Medium (10-15 hours)

### 5.9 Story 9: Local Development Without AWS

**Requirement**: Run and test Flask application locally with mocked AWS services.

**Current State**:
- ✅ Mock mode exists (`docker/scripts/run_local.py`)
- ✅ Local server can run without AWS credentials
- ⚠️ Limited functionality in mock mode
- ⚠️ Mock data setup is manual

**Gap Summary**:
- ✅ Core mock functionality exists
- ⚠️ Mock data management needs improvement
- ⚠️ Documentation of mock mode incomplete
- ⚠️ Mock mode not integrated with `make test-local`

**Implementation Effort**: Low (5-10 hours for enhancement)

### 5.10 Story 10: Shared Configuration Architecture

**Requirement**: Same Docker container and secrets architecture for standalone and Quilt Stack deployments.

**Current State**:
- ✅ Container uses secrets-only architecture
- ✅ Same image works for both deployment types
- ✅ Configuration resolution at runtime
- ✅ No deployment-specific code in container

**Gap Summary**:
- ✅ Architecture correctly implemented
- ✅ No gaps identified
- ✅ Deployment agnostic

**Implementation Effort**: None (already met)

## 6. Architectural Challenges

### 6.1 XDG vs. Environment Variables

**Challenge**: How to maintain compatibility with CI/CD environments that rely on environment variables?

**Current Situation**:
- CI/CD systems (GitHub Actions, GitLab CI) provide secrets via environment variables
- XDG configuration may not persist between CI jobs
- Container deployment already uses environment variables

**Design Considerations**:
1. XDG configuration should be **primary** for local development
2. Environment variables should **override** XDG for CI/CD
3. Container runtime should support both sources
4. Migration path must not break existing CI/CD pipelines

**Proposed Priority**:
```
CLI Options > Environment Variables > XDG Configuration > Defaults
```

### 6.2 Quilt Catalog Discovery

**Challenge**: Users may work with multiple Quilt catalogs (dev, staging, production).

**Current Situation**:
- `~/.quilt3/config.yml` stores single default catalog
- No mechanism to specify catalog per project
- Inference tool assumes single catalog

**Design Considerations**:
1. Should XDG config support multiple catalog profiles?
2. Should catalog be specified per-project or globally?
3. How to handle conflicts between inference from `quilt3 config` CLI and XDG config?

**Requirements Decision**: YES to multi-profile support. The default profile (default.json) is assumed; users can manually create alternate profiles for other catalogs (e.g., dev.json, staging.json), which should also include the relevant AWS_PROFILE.

### 6.3 Configuration Migration Strategy

**Challenge**: Existing users have `.env` files that must be migrated to XDG format.

**Current Situation**:
- `.env` files are widespread
- Breaking change in v0.6.0 (NOT v1.0.0)

**Requirements Decision**: NO automated migration support. This is a breaking change with no backward compatibility.

**Migration Approach**:
1. NO `make migrate` command provided
2. NO parallel operation during transition
3. `.env` files may work during development ONLY
4. Users must manually run `make install` to create XDG configuration
5. Clear documentation of breaking change in v0.6.0

**Impact**:
- Clean break simplifies implementation
- Forces adoption of new architecture
- Eliminates technical debt from supporting multiple configuration sources

### 6.4 AWS Profile Management

**Challenge**: Developers often use multiple AWS profiles (personal, company, client).

**Current Situation**:
- AWS SDK respects `AWS_PROFILE` environment variable
- No profile-aware configuration storage
- Single XDG configuration file

**Design Considerations**:
1. Should XDG config include AWS profile name?
2. Should configuration path include profile: `~/.config/benchling-webhook/{profile}/default.json`?
3. How to handle profile switching?

**Requirements Decision**: YES to profile-specific configuration. Users can manually create alternate profiles (e.g., default.json, staging.json, production.json) that include the relevant AWS_PROFILE setting. Profile switching is manual by specifying which profile file to use.

### 6.5 Secrets Synchronization

**Challenge**: Keeping XDG configuration in sync with AWS Secrets Manager.

**Current Situation**:
- Secrets stored in AWS Secrets Manager
- XDG config would store secret **references** (ARNs), not secrets themselves
- No automatic sync mechanism

**Design Considerations**:
1. User settings file (`default.json`) contains actual credentials for `make install` to use
2. Derived settings file (`config/default.json`) stores secret ARNs, not secret values
3. `make install` creates/updates secret in AWS Secrets Manager
4. Secret rotation requires manual update
5. Validation should re-check secret accessibility

**Requirements Decision**: Secret rotation is MANUAL. No automatic credential rotation support.

**Security Consideration**:
- User settings file contains credentials locally (user-managed, not encrypted per requirements)
- Derived config stores only ARNs and references
- Secrets synced to AWS Secrets Manager during `make install`

### 6.6 Testing with Real AWS Services

**Challenge**: Integration tests require real AWS resources and credentials.

**Current Situation**:
- `make test-integration` requires real Benchling credentials
- Tests modify real data (create packages, query Athena)
- No isolated test environment

**Design Considerations**:
1. Provide test mode that uses dedicated test resources
2. Clear separation between unit (mocked) and integration (real AWS)
3. CI/CD builds packages and images only (no deployment testing)
4. Test cleanup must be reliable

**Requirements Decision**: Offline mode support is NONE. No functionality available when AWS services are unreachable.

**Risk**:
- Integration tests can't run on contributor forks (no AWS credentials)
- Must rely on core maintainer testing for integration coverage
- Development requires AWS connectivity

## 7. Implementation Priorities by User Story

### Priority 1 (Critical Path - Must Have for v0.6.0)

1. **Story 6**: Single Source of Truth (XDG implementation)
   - Enables all other stories
   - Foundation for configuration management
   - Estimated: 25-30 hours

2. **Story 1**: Zero-Configuration Bootstrap
   - User-facing entry point
   - Drives adoption
   - Estimated: 20-30 hours

3. **Story 7**: Secrets Management Integration
   - Security requirement
   - Integration with `make install`
   - Estimated: 5-10 hours

### Priority 2 (Important - Should Have for v0.6.0)

4. **Story 2**: Automatic Configuration Inference
   - Reduces manual configuration
   - Improves DX significantly
   - Estimated: 15-20 hours

5. **Story 4**: Configuration Validation
   - Prevents deployment failures
   - Better error messages
   - Estimated: 15-20 hours

6. **Story 5**: Incremental Testing
   - Development workflow improvement
   - CI/CD reliability
   - Estimated: 15-20 hours

### Priority 3 (Nice to Have - Can Defer)

7. **Story 3**: Interactive Credential Collection
   - Enhances `make install` UX
   - Can use basic version initially
   - Estimated: 10-15 hours

8. **Story 8**: Idempotent Installation
   - Quality of life improvement
   - Not blocking for initial use
   - Estimated: 10-15 hours

9. **Story 9**: Local Development Enhancement
   - Already partially implemented
   - Refinement, not new feature
   - Estimated: 5-10 hours

### Priority 4 (Already Implemented)

10. **Story 10**: Shared Configuration Architecture
    - ✅ Already meets requirements
    - No additional work needed

**Total Estimated Effort**: 120-165 hours (3-4 weeks for 1 developer)

## 8. Key Decision Points

### 8.1 Makefile vs. npm Scripts

**Question**: Should top-level orchestration be in Makefile or npm scripts?

**Requirements Position**: Makefile is top-level orchestrator, npm scripts are implementation.

**Current State**: npm scripts are primary interface, no top-level Makefile.

**Recommendation**: Implement top-level Makefile that delegates to npm scripts. This:
- Provides environment-agnostic interface
- Allows shell scripting for complex operations
- Maintains npm scripts for TypeScript/Node operations
- Aligns with requirements specification

### 8.2 XDG Configuration Schema

**Question**: What should the JSON schema for XDG configuration files contain?

**Requirements Decision**: Configuration split into three files with distinct purposes.

**Proposed Schemas**:

1. **`~/.config/benchling-webhook/default.json`** (User Settings):
```json
{
  "quiltCatalog": "https://quilt-catalog.example.com",
  "benchlingTenant": "company",
  "benchlingClientId": "...",
  "benchlingClientSecret": "...",
  "benchlingAppDefinitionId": "...",
  "benchlingPkgBucket": "s3://bucket-name",
  "awsProfile": "default"
}
```

2. **`~/.config/benchling-webhook/config/default.json`** (Derived Settings):
```json
{
  "quiltStackArn": "arn:aws:cloudformation:...",
  "benchlingSecretArn": "arn:aws:secretsmanager:...",
  "awsRegion": "us-east-1",
  "awsAccount": "123456789012"
}
```

3. **`~/.config/benchling-webhook/deploy/default.json`** (Deployment Outputs):
```json
{
  "webhookEndpoint": "https://...",
  "stackName": "BenchlingWebhookStack",
  "lastDeployment": "2025-11-02T12:00:00Z"
}
```

**Validation**: JSON Schema v7 for strict validation, no version field required per requirements

### 8.3 Backward Compatibility Strategy

**Question**: How long to maintain `.env` file support?

**Requirements Decision**: NONE. v0.6.0 is a breaking change with no backward compatibility.

**Migration Path**:
- v0.6.0: XDG configuration required, `.env` files NOT supported
- Existing `.env` files may be used during development only
- Legacy environment variables NOT SUPPORTED in production
- No automated migration tooling provided
- Users must manually create XDG configuration via `make install`

**Rationale**: Clean break allows for simpler implementation and clearer architecture without technical debt from supporting multiple configuration sources.

### 8.4 CI/CD Configuration Source

**Question**: How should CI/CD pipelines provide configuration without XDG directories?

**Requirements Decision**: CI/CD only creates packages and Docker containers. Users push information from XDG to their stack directly.

**Recommendation**:
- CI/CD builds and packages artifacts (npm packages, Docker images)
- CI/CD does NOT perform deployments
- Developers use local XDG configuration to deploy to their own stacks
- No XDG configuration needed in CI/CD environment
- Document this pattern clearly in deployment guide

## 9. Refactoring Opportunities

### 9.1 Configuration Module Consolidation

**Current State**: Configuration logic scattered across multiple files:
- `lib/utils/config.ts` (212 lines)
- `lib/utils/config-loader.ts` (119 lines)
- `lib/utils/config-resolver.ts` (300+ lines)
- `bin/benchling-webhook.ts` (legacy getConfig function)

**Opportunity**: Consolidate into cohesive module with clear responsibilities:
- `lib/utils/config/index.ts` - Public API
- `lib/utils/config/xdg.ts` - XDG storage operations (3 file types: default.json, config/default.json, deploy/default.json)
- `lib/utils/config/inference.ts` - Automatic inference from `quilt3 config` CLI
- `lib/utils/config/validation.ts` - Validation logic (Benchling auth, S3 bucket access)
- `lib/utils/config/schema.ts` - JSON schema definitions

**Note**: Prefer npm scripts over Python for new configuration utilities unless Python is dramatically easier.

**Benefits**:
- Clear separation of concerns
- Easier testing
- Better maintainability
- Simpler imports

### 9.2 Error Handling Standardization

**Current State**: Multiple error types and patterns:
- `ConfigResolverError` with `format()` method
- Plain `Error` with string messages
- Validation errors in arrays
- Inconsistent error formatting

**Opportunity**: Standardize on error hierarchy:
```typescript
abstract class ConfigError extends Error {
    abstract format(): string;
}

class ValidationError extends ConfigError { }
class InferenceError extends ConfigError { }
class StorageError extends ConfigError { }
```

**Benefits**:
- Consistent error handling
- Better error messages
- Easier debugging
- Type-safe error handling

### 9.3 Test Organization

**Current State**: Tests mixed between unit and integration without clear structure.

**Opportunity**: Reorganize tests:
```
test/
  unit/          # Fast, mocked tests
  integration/   # Slower, real AWS tests
  fixtures/      # Shared test data
  helpers/       # Test utilities
```

**Benefits**:
- Clear test separation
- Faster test execution (unit only)
- Better CI/CD configuration
- Easier test maintenance

### 9.4 CLI Command Refactoring

**Current State**: Commands in `bin/commands/` directory, some logic in main CLI file.

**Opportunity**: Consistent command structure:
- Each command in own file
- Shared validation utilities
- Common error handling
- Consistent help text format

**Benefits**:
- Easier to add new commands
- Consistent UX
- Better testability
- Clearer documentation

## 10. Conclusion

### Current State Summary

The Benchling webhook integration has made significant progress toward a secrets-only architecture, but critical gaps remain:

✅ **Implemented**:
- Secrets-only mode for container runtime
- AWS Secrets Manager integration
- Configuration resolution from CloudFormation
- Basic CLI with deployment workflow
- Comprehensive test infrastructure

❌ **Missing**:
- XDG configuration storage
- `make install` bootstrap command
- Automatic configuration inference during installation
- Comprehensive validation framework
- Top-level Makefile orchestration
- Configuration migration tooling
- Idempotent setup workflow

### Path Forward

To achieve the requirements, implementation must focus on:

1. **Foundation** (Priority 1):
   - Implement XDG configuration module
   - Create top-level Makefile
   - Build `make install` command

2. **Enhancement** (Priority 2):
   - Integrate automatic inference
   - Add comprehensive validation
   - Improve testing infrastructure

3. **Polish** (Priority 3):
   - Interactive credential collection
   - Idempotent operations
   - Migration tooling

### Success Criteria

The implementation will be successful when:
- A new developer can run `make install` and have a working environment in under 10 minutes
- Configuration exists in a single location (`~/.config/benchling-webhook/default.json`)
- Validation catches errors before deployment attempts
- Tests can run at three distinct levels (unit, local, remote)
- Documentation clearly explains the workflow

### Risk Mitigation

Key risks include:
- Backward compatibility breakage → Mitigation: NONE. v0.6.0 is a breaking change. Clear communication and documentation required.
- CI/CD configuration complexity → Mitigation: CI/CD only builds artifacts; users deploy from local XDG config
- Quilt Stack output variability → Mitigation: Graceful degradation with manual overrides
- User resistance to migration → Mitigation: Clean architecture and improved developer experience justify breaking change

### Breaking Change Summary (v0.6.0)

1. Configuration moved from `.env` to XDG structure (`~/.config/benchling-webhook/`)
2. Three-file configuration model: user settings, derived settings, deployment outputs
3. NO backward compatibility with `.env` files in production
4. Environment variable-based configuration REMOVED
5. `make install` required before first use
6. Manual secret rotation only
7. No offline mode support
8. Multi-profile support via manual profile creation

This analysis provides the foundation for detailed design and implementation planning in subsequent phases.
