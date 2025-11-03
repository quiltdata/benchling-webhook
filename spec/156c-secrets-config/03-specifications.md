# Specifications Document: Secrets Configuration Architecture

**Spec**: 156c-secrets-config
**Branch**: 156c-secrets-config
**Issue**: #156 - secrets manager
**Date**: 2025-11-02

## Executive Summary

This document specifies the target architecture for the Benchling webhook integration's configuration and secrets management system (v0.6.0). The system will transition from a scattered multi-source configuration model to a unified XDG-compliant architecture with AWS Secrets Manager integration, orchestrated through Makefile commands. This specification defines the desired end state, architectural goals, and success criteria without prescribing implementation details.

## 1. System Architecture Goals

### 1.1 Configuration Storage Architecture

**Primary Configuration Storage**:
- Location: `~/.config/benchling-webhook/default.json` (XDG Base Directory compliant)
- Format: JSON with strict schema validation
- Persistence: Atomic writes with backup preservation
- Permissions: 0600 (read/write owner only)

**Configuration Schema Structure**:
The configuration file shall contain:
- Version metadata for schema migration support
- AWS resource identifiers (ARNs for Quilt Stack and Benchling Secret)
- AWS authentication context (profile, region, account)
- Deployment outputs (webhook endpoint, stack name, timestamps)
- No plaintext secrets (only references to Secrets Manager)

**Configuration Priority Model**:
Priority order (highest to lowest):
1. CLI options (runtime override)
2. Environment variables (CI/CD compatibility)
3. XDG configuration file (local development default)
4. Inferred values (automatic detection)
5. Built-in defaults (safe fallbacks)

**Success Criteria**:
- Single authoritative configuration file per installation
- Zero environment variable pollution for local development
- Clear precedence rules documented and enforced
- Schema validation catches malformed configuration before use
- Atomic write operations prevent partial state corruption

### 1.2 Secrets Management Architecture

**Secrets Storage Model**:
- All sensitive credentials stored in AWS Secrets Manager
- XDG configuration stores only ARN references, never plaintext secrets
- Secret format: JSON with predefined schema matching application expectations
- Secret lifecycle: Create during installation, rotate on demand, never in version control

**Required Secret Fields**:
The Benchling secret shall contain:
- `BENCHLING_TENANT` - Tenant identifier
- `BENCHLING_CLIENT_ID` - OAuth client ID
- `BENCHLING_CLIENT_SECRET` - OAuth client secret
- `BENCHLING_APP_DEFINITION_ID` - Application definition ID
- `BENCHLING_PKG_BUCKET` - S3 bucket for package storage

**Optional Secret Fields** (with defaults):
- `BENCHLING_ENABLE_WEBHOOK_VERIFICATION` (default: true)
- `BENCHLING_LOG_LEVEL` (default: INFO)
- `BENCHLING_PKG_KEY` (default: experiment_id)
- `BENCHLING_PKG_PREFIX` (default: benchling)
- `BENCHLING_WEBHOOK_ALLOW_LIST` (default: empty string)
- `BENCHLING_TEST_ENTRY` (default: none)

**Secrets Synchronization Model**:
- Installation workflow creates or updates secrets in AWS
- XDG configuration updated with secret ARN after successful sync
- Validation occurs before secret creation to prevent invalid state
- Idempotent operations support re-running without data loss

**Success Criteria**:
- Zero secrets stored in local files (except XDG references)
- Secrets accessible only via IAM-authenticated AWS API calls
- Secret schema validation prevents application runtime errors
- Clear error messages when secrets are missing or malformed

### 1.3 Orchestration Architecture

**Top-Level Makefile Interface**:
Provide environment-agnostic commands:
- `make install` - Complete bootstrap and configuration
- `make test` - Unit tests with mocked dependencies
- `make test-local` - Local integration tests with real credentials
- `make test-remote` - Remote integration tests (CI only)
- `make release` - Production promotion (CI only)
- `make tag` - Version tagging for release pipeline

**Command Delegation Model**:
- Makefile orchestrates high-level workflow
- npm scripts handle TypeScript/CDK operations
- Python scripts handle Docker container operations
- Shell scripts handle configuration and validation tasks

**Execution Context Separation**:
- Local development: Uses XDG configuration and AWS credentials
- CI/CD: Uses environment variables with optional XDG
- Container runtime: Uses environment variables with AWS resolution

**Success Criteria**:
- Single command (`make install`) completes full setup
- Consistent interface regardless of operating system
- Clear error messages indicating which subsystem failed
- Operations are idempotent and safe to re-run

## 2. Functional Specifications

### 2.1 Bootstrap Workflow (make install)

**Workflow Stages**:

**Stage 1: Dependency Installation**
- Install Node.js dependencies via npm
- Install Python dependencies for Docker container
- Verify minimum versions for Node.js (>=18.0.0) and Python (>=3.11)
- Report installed versions and any warnings

**Stage 2: Environment Discovery**
- Create XDG configuration directory if not exists
- Detect existing Quilt catalog from `~/.quilt3/config.yml`
- Extract AWS region and account from current AWS credentials
- Detect existing secrets in AWS Secrets Manager if any

**Stage 3: Configuration Inference**
- Query Quilt catalog API for configuration metadata
- Query CloudFormation for Quilt Stack outputs
- Extract S3 bucket, SQS queue, and Athena database information
- Resolve any references that can be automatically determined

**Stage 4: Interactive Credential Collection**
- Prompt for Benchling tenant if not inferred
- Prompt for Benchling client ID and secret
- Prompt for Benchling app definition ID
- Prompt for any missing configuration that cannot be inferred
- Display clear explanations for each prompt

**Stage 5: Credential Validation**
- Test Benchling OAuth by requesting access token
- Test S3 bucket access by listing objects (with appropriate permissions)
- Test SQS queue access by checking queue attributes
- Provide specific error messages if validation fails

**Stage 6: Secrets Synchronization**
- Create or update secret in AWS Secrets Manager
- Validate secret write succeeded
- Store secret ARN in XDG configuration
- Confirm synchronization completed

**Stage 7: Configuration Persistence**
- Write complete configuration to `~/.config/benchling-webhook/default.json`
- Validate configuration against JSON schema
- Set appropriate file permissions (0600)
- Display configuration summary (with secrets masked)

**Success Criteria**:
- Workflow completes in under 10 minutes with valid credentials
- Clear progress indication at each stage
- Fails fast with actionable error messages
- Can be re-run safely to update configuration
- Preserves existing working configuration when safe

### 2.2 Configuration Inference Engine

**Quilt Catalog Inference**:
- Read default catalog from `~/.quilt3/config.yml` if exists
- Parse catalog URL and validate HTTPS endpoint
- Query catalog API for `config.json` metadata
- Extract CloudFormation stack name if available

**CloudFormation Stack Inference**:
- Query CloudFormation for stack details by name or ARN
- Extract stack outputs: `UserAthenaDatabaseName`, `PackagerQueueArn`
- Extract stack parameters if relevant
- Handle stacks with partial or missing outputs gracefully

**AWS Context Inference**:
- Detect AWS profile from `AWS_PROFILE` or default
- Extract region from AWS config or credentials
- Determine account ID via STS GetCallerIdentity
- Cache resolved values in XDG configuration

**Inference Fallback Strategy**:
- Attempt automatic inference first
- Prompt for manual input if inference fails
- Use cached values from XDG if network unavailable
- Provide clear explanation when inference cannot proceed

**Success Criteria**:
- Reduces manual input by 80% for typical installations
- Handles network failures gracefully with cached fallbacks
- Provides clear explanation for each inferred value
- Allows manual override for all inferred values

### 2.3 Validation Framework

**Credential Validation**:

**Benchling OAuth Validation**:
Signature: `validateBenchlingCredentials(tenant, clientId, clientSecret) -> Result`
- Attempt to obtain OAuth token from Benchling API
- Verify token response contains valid access_token
- Test token by making authenticated API call
- Return success or specific error message

**S3 Bucket Validation**:
Signature: `validateS3Access(bucketName, region) -> Result`
- Verify bucket exists via HeadBucket
- Test read permissions via ListObjects (max 1 object)
- Test write permissions via PutObject (test key)
- Clean up test object after validation

**SQS Queue Validation**:
Signature: `validateSQSAccess(queueArn) -> Result`
- Verify queue exists via GetQueueAttributes
- Test send message permissions (with test message)
- Verify message was received (poll once)
- Clean up test message after validation

**Configuration Schema Validation**:
Signature: `validateConfiguration(config) -> ValidationResult`
- Validate against JSON Schema v7
- Check required fields are present
- Verify field types and formats
- Return list of validation errors with field paths

**Success Criteria**:
- Validation catches 95% of configuration errors before deployment
- Error messages include specific remediation steps
- Validation completes in under 30 seconds
- Network errors distinguished from permission errors

### 2.4 Three-Tier Testing Framework

**Tier 1: Unit Tests (make test)**
- Scope: Code-level correctness with mocked dependencies
- Dependencies: None (all AWS SDK calls mocked)
- Execution time: Under 2 minutes
- Coverage requirement: 85% line coverage minimum
- Test data: Fixtures and factory functions

Components tested:
- Configuration loading and schema validation
- Credential inference logic
- Error handling and formatting
- CLI command parsing and validation
- CDK stack synthesis (not deployment)

**Tier 2: Local Integration Tests (make test-local)**
- Scope: Full application flow with real AWS credentials
- Dependencies: Docker, AWS credentials, local Flask server
- Execution time: Under 10 minutes
- Test data: Real Benchling test entries

Components tested:
- Docker container build and startup
- Configuration resolution from AWS Secrets Manager
- Benchling webhook payload processing
- S3 package storage
- SQS message creation
- CloudWatch logging

**Tier 3: Remote Integration Tests (make test-remote)**
- Scope: Full deployed stack in isolated environment
- Dependencies: AWS account, dev stack deployment
- Execution time: Under 30 minutes (including deployment)
- Test data: Ephemeral resources tagged for cleanup

Components tested:
- API Gateway endpoint routing
- ALB load balancing
- Fargate container orchestration
- End-to-end webhook flow
- IAM permissions and networking
- CloudWatch metrics and alarms

**Test Isolation Strategy**:
- Unit tests run in parallel (isolated by mocking)
- Local tests serialize access to shared Docker resources
- Remote tests use separate dev stack with unique names
- Test data cleanup automated after each run

**Success Criteria**:
- Unit tests run on every commit
- Local tests run before PR creation
- Remote tests run in CI pipeline
- All tiers must pass before merge to main
- Test failures include specific diagnostic information

## 3. Integration Specifications

### 3.1 XDG Configuration Module Interface

**Module Responsibilities**:
- Read and write XDG configuration files
- Validate configuration against JSON schema
- Merge configuration from multiple sources per priority model
- Provide atomic write operations with backup

**Core Functions**:

**Load Configuration**:
Signature: `loadConfiguration(options?) -> Configuration`
- Read from `~/.config/benchling-webhook/default.json`
- Validate against JSON schema
- Merge with environment variables per priority rules
- Return validated configuration object or throw error

**Save Configuration**:
Signature: `saveConfiguration(config: Configuration) -> void`
- Validate configuration against schema before writing
- Create backup of existing configuration
- Write atomically (temp file + rename)
- Set appropriate permissions (0600)

**Merge Configuration**:
Signature: `mergeConfiguration(base: Configuration, overrides: Partial<Configuration>) -> Configuration`
- Apply priority rules to determine final values
- Preserve existing fields not in overrides
- Validate merged result against schema
- Return merged configuration

**Success Criteria**:
- Module has zero external dependencies beyond Node.js stdlib
- All operations are synchronous for simplicity
- Clear error messages for schema validation failures
- Atomic writes prevent partial state corruption

### 3.2 Secrets Manager Integration Interface

**Module Responsibilities**:
- Create and update secrets in AWS Secrets Manager
- Retrieve secret values with caching
- Validate secret format and contents
- Handle secret ARN resolution

**Core Functions**:

**Create Secret**:
Signature: `createSecret(name: string, value: object, region: string) -> SecretArn`
- Validate secret value against expected schema
- Create secret in AWS Secrets Manager
- Tag secret with appropriate metadata
- Return secret ARN for storage in XDG configuration

**Update Secret**:
Signature: `updateSecret(arn: string, value: object) -> void`
- Validate secret value against expected schema
- Update secret in AWS Secrets Manager
- Preserve existing tags and metadata
- Handle conflicts (concurrent updates)

**Retrieve Secret**:
Signature: `retrieveSecret(arn: string) -> object`
- Fetch secret value from AWS Secrets Manager
- Parse JSON and validate against schema
- Cache result for configurable TTL (default: 5 minutes)
- Return parsed secret object

**Success Criteria**:
- Secrets never logged or printed to console
- Clear distinction between ARN and secret value in interfaces
- Caching reduces AWS API calls by 90% for repeated access
- Handles network errors with exponential backoff

### 3.3 CDK Stack Integration Points

**Configuration Input**:
- CDK stack receives two parameters: `quiltStackArn` and `benchlingSecret`
- Parameters resolved from XDG configuration during deployment
- No environment variables required for CDK operations

**Stack Output Persistence**:
- After successful deployment, capture stack outputs
- Write outputs back to XDG configuration under `deploymentOutputs`
- Include: webhook endpoint URL, stack name, deployment timestamp
- Validate outputs before persisting

**Deployment Workflow**:
1. Load configuration from XDG
2. Validate required parameters present
3. Synthesize CDK stack with parameters
4. Deploy stack to AWS CloudFormation
5. Retrieve stack outputs
6. Update XDG configuration with outputs
7. Test webhook endpoint health

**Success Criteria**:
- Deployment reads configuration from single source (XDG)
- Stack outputs automatically captured without manual steps
- Deployment state tracked in XDG configuration
- Rollback scenarios preserve previous configuration

### 3.4 Docker Container Runtime Integration

**Environment Variable Injection**:
- Container receives `QuiltStackARN` and `BenchlingSecret` from ECS task definition
- Python application resolves all other configuration from these two values
- No changes required to container code for configuration model

**Configuration Resolution Flow**:
1. Container starts with two environment variables
2. Application queries CloudFormation for Quilt Stack outputs
3. Application retrieves Benchling secret from Secrets Manager
4. Application constructs complete configuration from resolved values
5. Application validates configuration before starting Flask server

**Local Development Mode**:
- Docker Compose mounts AWS credentials from host
- Container uses host's XDG configuration indirectly via environment variables
- Local override file supports mock mode without AWS

**Success Criteria**:
- Container remains deployment-agnostic (works standalone or in Quilt Stack)
- No configuration logic changes required in Python application
- Local development and production use identical container image

## 4. Quality Specifications

### 4.1 Error Handling Architecture

**Error Classification Model**:

**Configuration Errors**:
- Schema validation failures
- Missing required fields
- Malformed XDG configuration file
- Resolution: Re-run `make install` or edit configuration manually

**Authentication Errors**:
- Invalid AWS credentials
- Missing IAM permissions
- Expired or rotated secrets
- Resolution: Check AWS profile, update IAM policies, refresh credentials

**Network Errors**:
- AWS API unreachable
- Quilt catalog API timeout
- Benchling API rate limiting
- Resolution: Retry with exponential backoff, check network connectivity

**Validation Errors**:
- Benchling credentials invalid
- S3 bucket not accessible
- SQS queue not found
- Resolution: Verify credentials, check resource names, review IAM permissions

**Error Message Format**:
Every error shall include:
- Clear description of what failed
- Specific context (which operation, which resource)
- Suggested remediation steps
- Reference to relevant documentation section

**Success Criteria**:
- 90% of errors include actionable remediation steps
- Error messages distinguish between user error and system error
- Stack traces hidden by default, available with debug flag
- Errors logged to appropriate destination (stderr for CLI, CloudWatch for container)

### 4.2 Idempotency Requirements

**Installation Idempotency**:
- `make install` can be run multiple times safely
- Existing configuration preserved unless explicitly overridden
- Backup created before any destructive operations
- User prompted before overwriting existing values

**Deployment Idempotency**:
- Re-deploying with same configuration produces no changes
- CDK detects drift and reports differences
- Stack outputs updated only if deployment succeeds
- Failed deployment does not corrupt configuration

**Secret Update Idempotency**:
- Updating secret with same values is no-op
- Secret version increments only when value changes
- XDG configuration updated only when secret ARN changes

**Success Criteria**:
- Re-running any command with same inputs produces same result
- No unintended side effects from repeated operations
- Clear indication when operation is no-op
- State transitions are atomic (all or nothing)

### 4.3 Security Requirements

**Credential Protection**:
- No plaintext secrets in files (except AWS Secrets Manager)
- XDG configuration file permissions enforced (0600)
- Secrets masked in all CLI output and logs
- Environment variables cleared after use in memory

**AWS IAM Principles**:
- Least privilege access for all IAM roles
- Separate roles for development and production
- Time-limited credentials recommended (STS)
- MFA recommended for secret creation operations

**Audit and Compliance**:
- All secret access logged to CloudTrail
- Configuration changes logged locally
- Deployment actions logged to CloudWatch
- Support for SOC2 and HIPAA compliance patterns

**Success Criteria**:
- Zero secrets exposed in version control
- Zero secrets in container images
- IAM policies follow least privilege principle
- All sensitive operations auditable

### 4.4 Documentation Requirements

**User-Facing Documentation**:
- Step-by-step setup guide with screenshots
- Common error messages and solutions
- Architecture overview diagram
- Configuration reference with all variables documented

**Developer Documentation**:
- Architecture decision records (ADRs) for key choices
- Module interfaces and contracts
- Testing strategy and guidelines
- Contribution workflow

**Operational Documentation**:
- Runbook for common operational tasks
- Troubleshooting guide with diagnostic commands
- Monitoring and alerting setup
- Disaster recovery procedures

**Success Criteria**:
- New developers can set up environment following docs alone
- Common issues have documented solutions
- All configuration variables documented with examples
- Migration guide available for existing users

## 5. Migration Specifications

### 5.1 Migration Strategy from .env to XDG

**Migration Command**:
Provide `make migrate` command that:
- Detects existing `.env` file in project directory
- Parses environment variables into structured format
- Validates parsed values against expected schema
- Infers missing values using same logic as `make install`
- Writes migrated configuration to XDG directory
- Backs up original `.env` file (does not delete)
- Reports migration success with summary

**Parallel Support Period**:
- v0.6.x: XDG primary, `.env` supported with deprecation warning
- v0.7.x - v0.9.x: Continued parallel support, stronger warnings
- v1.0.x: Remove `.env` support, XDG only

**Deprecation Warning Format**:
When `.env` file detected:
- Display warning message indicating deprecation
- Show migration command: `make migrate`
- Indicate version where support will be removed (v1.0.0)
- Link to migration guide in documentation

**Success Criteria**:
- Migration completes successfully for 95% of existing installations
- Migrated configuration validated before writing
- Original `.env` file preserved as backup
- Clear instructions provided for edge cases

### 5.2 Backward Compatibility Strategy

**Environment Variable Support**:
- Continue reading environment variables during transition
- Environment variables override XDG values (for CI/CD compatibility)
- Deprecation warnings displayed when environment variables used
- Clear migration path documented

**Legacy CLI Options**:
- Existing CLI options continue to work
- New CLI options added for XDG-based workflow
- Help text indicates deprecated options
- Deprecated options removed in v1.0.0

**CloudFormation Parameter Compatibility**:
- Existing stacks using individual parameters continue working
- New deployments use `quiltStackArn` and `benchlingSecret` parameters
- Migration path for existing stacks documented
- Stack updates handle parameter transitions gracefully

**Success Criteria**:
- Zero breaking changes for existing deployments in v0.6.x
- Clear deprecation timeline communicated
- Migration guide available before breaking changes
- Automated migration tools provided where possible

## 6. Technical Constraints and Risks

### 6.1 Architectural Constraints

**XDG Directory Persistence**:
- Constraint: CI/CD environments may not persist home directories
- Impact: XDG configuration unavailable between CI jobs
- Mitigation: Environment variable override support for CI/CD

**AWS API Rate Limits**:
- Constraint: CloudFormation and Secrets Manager have API rate limits
- Impact: High-frequency operations may be throttled
- Mitigation: Caching, exponential backoff, batch operations where possible

**CloudFormation Stack Output Variability**:
- Constraint: Not all Quilt stacks expose identical outputs
- Impact: Inference may fail for some stack configurations
- Mitigation: Graceful degradation with manual override prompts

**Docker Build Context**:
- Constraint: Container cannot access host file system at runtime
- Impact: XDG configuration not directly accessible in container
- Mitigation: Configuration injected via environment variables in ECS task definition

### 6.2 Technical Uncertainties

**Multi-Catalog Support**:
- Uncertainty: Should system support multiple Quilt catalogs per user?
- Impact: Configuration schema complexity, catalog selection UI
- Resolution Required: User research to determine common patterns

**AWS Profile Management**:
- Uncertainty: Should XDG configuration be profile-specific?
- Impact: Configuration directory structure, migration complexity
- Resolution Required: Survey developer workflows and preferences

**Configuration Encryption**:
- Uncertainty: Should XDG configuration encrypt sensitive fields?
- Impact: Implementation complexity, dependency on encryption libraries
- Resolution Required: Security team review and threat modeling

**Offline Mode Requirements**:
- Uncertainty: Which operations must work without AWS connectivity?
- Impact: Mock implementation complexity, testing requirements
- Resolution Required: Define critical offline workflows

### 6.3 Implementation Risks

**Risk: Migration Adoption**
- Description: Users may delay migrating from `.env` to XDG
- Probability: High
- Impact: Maintenance burden of supporting two models
- Mitigation: Strong incentives (better DX, bug fixes only in XDG), clear timeline

**Risk: Quilt Catalog API Changes**
- Description: Catalog API may change, breaking inference
- Probability: Medium
- Impact: Automatic inference fails, requires manual configuration
- Mitigation: Version detection, fallback to manual input, API contract with Quilt team

**Risk: AWS Secrets Manager Costs**
- Description: Secrets Manager charges per secret per month
- Probability: Low (expected)
- Impact: Increased operational costs for large deployments
- Mitigation: Document costs clearly, support secret reuse patterns

**Risk: Configuration Schema Evolution**
- Description: Configuration needs may change over time
- Probability: High
- Impact: Breaking changes for existing configurations
- Mitigation: Schema versioning, automatic migration tooling

**Risk: Testing Environment Availability**
- Description: Integration tests require AWS resources and Benchling account
- Probability: Medium
- Impact: Contributors without access cannot run full test suite
- Mitigation: Comprehensive unit test coverage, CI runs integration tests for maintainers

## 7. Success Metrics

### 7.1 Quantitative Metrics

**Setup Time**:
- Target: Under 10 minutes from clone to deployment for experienced developers
- Measurement: Time from `git clone` to successful `make install`
- Baseline: Current manual process (30-60 minutes)

**Configuration Error Rate**:
- Target: 80% reduction in configuration-related issues
- Measurement: GitHub issues tagged "configuration" or "setup"
- Baseline: Historical issue rate (past 6 months)

**First-Time Setup Success**:
- Target: 90% of new developers succeed without assistance
- Measurement: Post-onboarding survey results
- Baseline: Current success rate (estimated 60%)

**Test Execution Coverage**:
- Target: 100% of PRs include `make test` results
- Measurement: CI logs and PR descriptions
- Baseline: Current test execution rate (estimated 70%)

**Idempotency Verification**:
- Target: 100% of operations idempotent
- Measurement: Automated test suite running operations multiple times
- Baseline: None (new capability)

### 7.2 Qualitative Metrics

**Developer Experience**:
- Target: Positive feedback on setup simplicity
- Measurement: Developer surveys and feedback
- Success Indicator: "Easy" or "Very Easy" rating from 80%+ of developers

**Documentation Quality**:
- Target: Developers can complete setup using docs alone
- Measurement: Documentation feedback and support ticket reduction
- Success Indicator: 50% reduction in setup-related support requests

**Error Message Clarity**:
- Target: Errors include actionable remediation steps
- Measurement: Code review and user feedback
- Success Indicator: 90% of errors have specific remediation guidance

**Maintenance Burden**:
- Target: Reduced time spent on configuration support
- Measurement: Support ticket time tracking
- Success Indicator: 60% reduction in configuration support time

## 8. Design Principles

### 8.1 Core Principles

**Principle 1: Single Source of Truth**
- All configuration resides in one authoritative location (XDG)
- No conflicting configuration sources
- Clear precedence rules when multiple sources present
- Rationale: Eliminates confusion and debugging complexity

**Principle 2: Fail Fast**
- Validation happens before deployment
- Configuration errors caught at installation time
- No partial deployments from invalid configuration
- Rationale: Prevents cascading failures and resource waste

**Principle 3: Idempotence**
- Operations can be safely re-run without side effects
- Re-running with same inputs produces same outputs
- State transitions are atomic (all or nothing)
- Rationale: Enables safe error recovery and experimentation

**Principle 4: Observability**
- Every operation logs clear diagnostic information
- Progress indication for long-running operations
- Error messages include context and remediation
- Rationale: Enables self-service debugging and support

**Principle 5: Separation of Concerns**
- Makefile orchestrates high-level workflow
- npm scripts implement TypeScript/CDK operations
- Python scripts implement container operations
- Rationale: Clear boundaries enable independent evolution

**Principle 6: Security by Default**
- No secrets in files except AWS Secrets Manager
- Minimal permissions required for all operations
- Audit logging enabled for sensitive operations
- Rationale: Reduces security incidents and compliance violations

### 8.2 Implementation Guidelines

**Guideline: Prefer Inference Over Prompts**
- Automatically detect configuration from environment
- Prompt only when inference fails or is ambiguous
- Cache inferred values for future use
- Rationale: Reduces cognitive load on users

**Guideline: Validate Early and Often**
- Schema validation on configuration load
- Credential validation before secret creation
- Deployment validation before CloudFormation submit
- Rationale: Fast feedback reduces iteration time

**Guideline: Graceful Degradation**
- Fallback to manual input when inference fails
- Continue with partial configuration when safe
- Provide clear explanation for degraded functionality
- Rationale: System remains usable in edge cases

**Guideline: Clear Error Messages**
- Describe what failed specifically
- Explain why it failed when possible
- Suggest concrete remediation steps
- Rationale: Enables self-service problem resolution

**Guideline: Respect User Intent**
- Prompt before overwriting existing configuration
- Preserve user customizations during upgrades
- Allow manual override for all inferred values
- Rationale: Builds trust and prevents data loss

## 9. Open Technical Questions

### 9.1 Questions Requiring Resolution Before Implementation

**Question 1: XDG Configuration Granularity**
- Should configuration support environment-specific profiles (dev, staging, prod)?
- Should configuration include AWS profile name or be profile-agnostic?
- Decision Driver: Developer workflow patterns and environment management needs

**Question 2: Credential Validation Depth**
- How deep should validation go (e.g., test Benchling API with real entries)?
- Should validation create test resources (S3 objects, SQS messages)?
- Decision Driver: Balance between validation confidence and setup time/cost

**Question 3: Configuration Encryption**
- Should XDG configuration encrypt non-secret fields?
- What encryption mechanism (gpg, age, AWS KMS)?
- Decision Driver: Security requirements vs. complexity and dependencies

**Question 4: Offline Mode Scope**
- Which operations must work offline (tests, builds, docs)?
- Should offline mode use cached data or mock data?
- Decision Driver: Developer workflow requirements and network reliability

**Question 5: Secret Rotation Automation**
- Should system support automatic credential rotation?
- What rotation schedule and notification mechanism?
- Decision Driver: Security requirements and operational capabilities

**Question 6: Multiple Catalog Support**
- Should single installation support multiple Quilt catalogs?
- How should catalog selection work (config profiles, CLI flags)?
- Decision Driver: User needs analysis and workflow complexity

## 10. Acceptance Criteria Summary

This section maps specifications back to the acceptance criteria defined in requirements document.

### AC1: One-Command Bootstrap (Section 2.1)
- ✓ `make install` orchestrates complete setup
- ✓ XDG directory created automatically
- ✓ Quilt catalog auto-inferred from `~/.quilt3/config.yml`
- ✓ Interactive prompts for missing credentials
- ✓ Validation before proceeding to next stage
- ✓ Secrets created/updated in AWS Secrets Manager
- ✓ Configuration written to `~/.config/benchling-webhook/default.json`
- ✓ Explicit diagnostics on validation failure

### AC2: Configuration Model (Section 1.1)
- ✓ XDG-compliant storage at `~/.config/benchling-webhook/default.json`
- ✓ Includes QuiltStackArn, BenchlingSecretArn, AWS settings
- ✓ No `.env` files required for deployment
- ✓ npm scripts read from XDG directory
- ✓ Deployment outputs written back to XDG
- ✓ JSON schema validation on read

### AC3: Testing Tiers (Section 2.4)
- ✓ `make test` runs linters and unit tests (no external dependencies)
- ✓ `make test-local` builds Docker, pulls credentials, tests with real payloads
- ✓ `make test-remote` (CI only) deploys dev stack and runs integration tests
- ✓ `make release` (CI only) promotes to production after tests pass
- ✓ `make tag` creates version tags for release pipeline

### AC4: Secret Environment Variables (Section 1.2)
- ✓ 11 environment variables (5 required, 6 optional with defaults)
- ✓ Required: BENCHLING_TENANT, CLIENT_ID, CLIENT_SECRET, APP_DEFINITION_ID, PKG_BUCKET
- ✓ Optional with defaults documented
- ✓ All secrets stored in AWS Secrets Manager with encryption
- ✓ Secrets synced from XDG to AWS during installation

### AC5: Configuration Validation (Section 2.3)
- ✓ Benchling credentials validated by OAuth token test
- ✓ S3 bucket access validated by list and put operations
- ✓ Quilt catalog URL validated by HTTPS endpoint check
- ✓ AWS credentials validated before Secrets Manager operations
- ✓ Configuration schema validated when reading from XDG

### AC6: Error Handling and Diagnostics (Section 4.1)
- ✓ Missing Quilt catalog prompts user to run `quilt3 config`
- ✓ Corrupted XDG config triggers schema validation error
- ✓ Invalid AWS credentials triggers permission check and guidance
- ✓ Secrets Manager unreachable triggers IAM validation and retry
- ✓ CDK stack drift detected with preflight check
- ✓ Missing secret variables caught by schema validation

### AC7: Technology Stack Integration (Section 1.3)
- ✓ Makefile provides top-level orchestration
- ✓ npm scripts handle CDK infrastructure
- ✓ Python implements Docker container application
- ✓ XDG standard for configuration storage
- ✓ All components read from unified source

### AC8: Deployment Workflow (Section 3.3)
- ✓ `make install` creates initial configuration
- ✓ npm scripts read from XDG for CDK operations
- ✓ Secrets synced to AWS from configuration
- ✓ CDK resolves settings from QuiltStackArn and BenchlingSecretArn
- ✓ Deployment outputs written back to XDG

### AC9: Documentation and Examples (Section 4.4)
- ✓ README provides `make install` workflow instructions
- ✓ Configuration failure modes documented
- ✓ Secret environment variables documented
- ✓ Example configurations for common scenarios
- ✓ Migration guide for existing users

### AC10: Backward Compatibility (Section 5.2)
- ✓ Existing `.env` files work with deprecation warning
- ✓ Migration script converts `.env` to XDG
- ✓ Legacy environment variables supported with deprecation notices
- ✓ Breaking changes clearly marked for v0.6.0

## 11. Conclusion

This specification defines a comprehensive configuration and secrets management architecture that addresses all requirements and acceptance criteria. The system achieves:

- **Simplicity**: Single command setup, single source of truth
- **Security**: No plaintext secrets, AWS Secrets Manager integration
- **Testability**: Three-tier testing framework with clear separation
- **Maintainability**: Clear module boundaries, comprehensive validation
- **Developer Experience**: Automatic inference, clear error messages, idempotent operations

The architecture is designed for incremental implementation across multiple phases, with clear success criteria at each stage. Technical uncertainties are identified and require resolution before implementation begins. Migration strategy ensures smooth transition from existing `.env`-based model to XDG-based model without breaking existing deployments.

Implementation will proceed according to the phases document (04-phases.md) which breaks this specification into sequential, reviewable units of work.
