# Requirements Document

## GitHub Issue Reference

**Issue Number**: #156
**Issue Title**: secrets manager
**Branch**: 156c-secrets-config

## Problem Statement

The Benchling webhook integration currently requires users to manually configure multiple environment variables, leading to configuration errors, duplication of information, and a fragmented development workflow. The goal is to redesign the system for maximum simplicity, testability, and modifiability by implementing a unified configuration model using XDG-compliant storage, AWS Secrets Manager, and a streamlined Makefile-based workflow. This is a BREAKING CHANGE (v0.6.0) that splits configuration and tasks for optimal developer experience.

## User Stories

### Story 1: Zero-Configuration Bootstrap
**As a** new developer joining the project
**I want** to run a single command that sets up the entire development environment
**So that** I can start contributing immediately without manual configuration steps or reading extensive documentation

### Story 2: Automatic Configuration Inference
**As a** developer with existing Quilt infrastructure
**I want** the system to automatically detect my Quilt catalog and AWS settings
**So that** I do not need to re-enter information that already exists in my environment

### Story 3: Interactive Credential Collection
**As a** developer setting up Benchling integration
**I want** to be prompted only for information that cannot be automatically inferred
**So that** I provide exactly what is needed without guessing at configuration values

### Story 4: Configuration Validation
**As a** developer configuring the system
**I want** immediate feedback when credentials or settings are incorrect
**So that** I can fix configuration problems before attempting deployment

### Story 5: Incremental Testing
**As a** developer implementing new features
**I want** to test my changes at multiple levels (unit, local integration, remote integration)
**So that** I can validate functionality progressively without deploying to production

### Story 6: Single Source of Truth
**As a** DevOps engineer
**I want** all configuration stored in one location with clear precedence rules
**So that** I can manage environments without worrying about environment variable pollution or conflicting sources

### Story 7: Secrets Management
**As a** security-conscious developer
**I want** sensitive credentials stored in AWS Secrets Manager
**So that** secrets are encrypted at rest, auditable, and never stored in version control

### Story 8: Idempotent Installation
**As a** developer troubleshooting configuration issues
**I want** to re-run the installation command without breaking my working setup
**So that** I can update or fix configuration without fear of data loss

### Story 9: Local Development Without AWS
**As a** developer working offline or in a constrained environment
**I want** to run and test the Flask application locally with mocked AWS services
**So that** I can develop without constant AWS dependencies

### Story 10: Shared Configuration Architecture
**As a** Quilt Stack administrator
**I want** the same Docker container and secrets architecture to work for both standalone deployments and Quilt Stack integrations
**So that** I can maintain a consistent configuration model across deployment types

## Acceptance Criteria

### AC1: One-Command Bootstrap
1. Running `make install` installs all Node.js and Python dependencies
2. Command creates XDG-compliant configuration directory at `~/.config/benchling-webhook/`
3. Command auto-infers Quilt catalog from `~/.quilt3/config.yml` if available
4. Command prompts interactively for missing Benchling credentials (tenant, client ID, client secret, app definition ID)
5. Command validates all credentials before proceeding
6. Command creates or updates secrets in AWS Secrets Manager
7. Command generates `~/.config/benchling-webhook/default.json` with configuration
8. If any validation step fails, command exits with explicit diagnostic message

### AC2: Configuration Model
1. User settings stored in `~/.config/benchling-webhook/default.json` (XDG-compliant)
2. Configuration file includes QuiltStackArn, BenchlingSecretArn, and resolved AWS settings
3. No `.env` files required for deployment operations
4. npm scripts read configuration from XDG directory
5. Deployment outputs written back to XDG configuration
6. Configuration file validates against JSON schema on read

### AC3: Testing Tiers
1. `make test` runs TypeScript linters, Python linters, and mocked unit tests (no external dependencies)
2. `make test-local` builds Docker image, pulls credentials from AWS Secrets Manager, and runs Flask webhook with real Benchling payloads
3. `make test-remote` (CI only) builds dev Docker image, pushes to ECR, deploys dev stack, and executes remote integration tests
4. `make release` (CI only) promotes verified image and stack to production after successful tests
5. `make tag` creates and pushes version tags for release pipeline

### AC4: Secret Environment Variables
1. System supports 11 environment variables with documented defaults (5 required, 6 optional)
2. Required variables: BENCHLING_TENANT, BENCHLING_CLIENT_ID, BENCHLING_CLIENT_SECRET, BENCHLING_APP_DEFINITION_ID, BENCHLING_PKG_BUCKET
3. Optional variables with defaults: BENCHLING_ENABLE_WEBHOOK_VERIFICATION (true), BENCHLING_LOG_LEVEL (INFO), BENCHLING_PKG_KEY (experiment_id), BENCHLING_PKG_PREFIX (benchling), BENCHLING_WEBHOOK_ALLOW_LIST (""), BENCHLING_TEST_ENTRY (none)
4. All secrets stored in AWS Secrets Manager with encryption at rest
5. Secrets synced from XDG configuration to AWS Secrets Manager during installation

### AC5: Configuration Validation
1. Benchling credentials validated by test API call before saving
2. S3 bucket access validated by attempting to list objects
3. Quilt catalog URL validated by checking for valid HTTPS endpoint
4. AWS credentials validated before attempting Secrets Manager operations
5. Docker base image validated before attempting build
6. Configuration schema validated when reading from XDG directory

### AC6: Error Handling and Diagnostics
1. Missing Quilt catalog prompts user to run `quilt3 config` and retry
2. Corrupted XDG config triggers schema validation error and suggests re-running `make install`
3. Invalid AWS credentials triggers permission check and profile/region guidance
4. Docker build failure triggers base image pull and retry
5. Secrets Manager unreachable triggers IAM permission validation and retry with backoff
6. CDK stack drift detected with `cdk diff` preflight check
7. Missing secret variables caught by schema validation before secrets sync

### AC7: Technology Stack Integration
1. Makefile provides top-level orchestration (environment-agnostic)
2. npm scripts handle CDK infrastructure and implementation scripts
3. Python implements Docker container application
4. XDG standard used for configuration storage at `~/.config/benchling-webhook/`
5. All components read from unified configuration source

### AC8: Deployment Workflow
1. `make install` creates initial configuration
2. npm scripts read configuration from XDG directory for CDK operations
3. Secrets synced to AWS Secrets Manager from configuration
4. CDK deployment resolves all settings from QuiltStackArn and BenchlingSecretArn
5. Deployment outputs (endpoint, stack ARN) written back to XDG configuration

### AC9: Documentation and Examples
1. README provides clear instructions for `make install` workflow
2. Configuration failure modes documented with causes and mitigations
3. All secret environment variables documented with types, defaults, and descriptions
4. Example configurations provided for common scenarios
5. Migration guide provided for users upgrading from previous versions

### AC10: Backward Compatibility
1. Existing `.env` files continue to work during transition period (with deprecation warning)
2. Migration script provided to convert `.env` to XDG configuration
3. Legacy environment variables supported with clear deprecation notices
4. Documentation clearly marks breaking changes for v0.6.0

## High-Level Implementation Approach

The implementation will create a unified configuration model that eliminates environment variable pollution and provides a single source of truth:

1. **XDG Configuration Storage**: Implement configuration persistence in `~/.config/benchling-webhook/` following XDG Base Directory specification, with JSON schema validation and atomic write operations

2. **Interactive Bootstrap Script**: Create `make install` target that orchestrates dependency installation, configuration inference, interactive prompts, validation, and secrets synchronization

3. **Configuration Inference Engine**: Implement logic to auto-detect Quilt catalog from `~/.quilt3/config.yml`, extract AWS region and account from credentials, and resolve CloudFormation stack outputs

4. **Secrets Management Integration**: Build credential validation system that tests Benchling API access, validates S3 permissions, and syncs validated credentials to AWS Secrets Manager

5. **Testing Infrastructure**: Establish three-tier testing approach with unit tests using mocks, local integration using Docker with real credentials, and remote integration using deployed dev stack

6. **Makefile Orchestration**: Implement top-level Makefile targets that delegate to npm and Python scripts while maintaining environment independence

7. **Configuration Validation Framework**: Create JSON schema for configuration file, validation hooks for credentials and permissions, and clear error messages with remediation guidance

8. **Migration Support**: Provide tooling to migrate from `.env` files to XDG configuration, deprecation warnings for legacy patterns, and parallel support during transition

## Success Metrics

### Metric 1: Setup Time Reduction
- Measure time from git clone to successful deployment
- Target: Under 10 minutes for experienced developers with AWS credentials
- Baseline: Current multi-step manual configuration process

### Metric 2: Configuration Error Rate
- Track number of configuration-related support issues
- Target: 80% reduction in configuration errors
- Measure: GitHub issues tagged with "configuration" or "setup"

### Metric 3: Developer Onboarding
- Survey new contributors on setup experience
- Target: 90% successful first-time setup without assistance
- Measure: Post-onboarding feedback form

### Metric 4: Test Execution Coverage
- Track percentage of developers using incremental testing workflow
- Target: 100% of PRs include `make test` results
- Measure: CI logs and PR descriptions

### Metric 5: Configuration Validation Success
- Measure percentage of installations that pass validation on first attempt
- Target: 95% of installations succeed with valid AWS credentials
- Track: Installation script analytics

### Metric 6: Idempotency Verification
- Verify that re-running `make install` does not break working setups
- Target: 100% idempotent operations
- Test: Automated test suite running installation multiple times

### Metric 7: Secrets Management Adoption
- Track percentage of deployments using AWS Secrets Manager vs environment variables
- Target: 100% of new deployments use Secrets Manager
- Measure: Deployment telemetry and configuration audit

## Open Questions

### Question 1: Quilt Catalog Discovery
**Question**: Should the system support multiple Quilt catalogs, or assume a single default catalog per user?

**Context**: Users may work with multiple Quilt deployments (dev, staging, production). The current design assumes a single default catalog from `~/.quilt3/config.yml`, but users may need to specify different catalogs for different projects.

**Impact**: Affects configuration schema and whether XDG config needs environment-specific profiles.

### Question 2: AWS Profile Management
**Question**: How should the system handle multiple AWS profiles? Should configuration be profile-specific, or maintain a single global configuration?

**Context**: Developers often use different AWS profiles for different environments (personal, company, client projects). The XDG configuration needs to either be profile-aware or allow profile override.

**Impact**: Determines whether configuration path includes AWS profile name or if profile is a runtime parameter.

### Question 3: Configuration Encryption
**Question**: Should the XDG configuration file encrypt sensitive fields (even though they are also in AWS Secrets Manager)?

**Context**: The configuration file contains ARNs and potentially resolved values. While ARNs are not secrets, some users may want local configuration encrypted for defense in depth.

**Impact**: Adds complexity to configuration reading/writing but provides additional security layer.

### Question 4: Docker Image Registry
**Question**: Should the system support custom Docker registries beyond the default ECR repository?

**Context**: Organizations may want to use their own Docker registries for image management. The current design assumes a specific ECR registry.

**Impact**: Affects configuration schema and Docker image pull authentication.

### Question 5: Offline Mode Support
**Question**: What functionality should be available when AWS services are unreachable (offline development, CI environments without AWS)?

**Context**: Developers may want to work on code without AWS connectivity, but many operations currently require AWS API access for validation and secrets retrieval.

**Impact**: Determines which operations need offline fallback modes and mock implementations.

### Question 6: Configuration Versioning
**Question**: Should the XDG configuration include version metadata to support schema evolution and migration?

**Context**: As the configuration format evolves, we need a way to detect and migrate older configuration files to newer formats.

**Impact**: Affects configuration schema design and requires migration tooling for version upgrades.

### Question 7: CI/CD Integration
**Question**: How should CI/CD pipelines authenticate and access configuration when XDG directories may not persist between jobs?

**Context**: GitHub Actions, GitLab CI, and other CI systems may not preserve home directories or configuration between jobs. They may also need different authentication patterns.

**Impact**: May require alternative configuration sources (environment variables, CI secrets) or workspace persistence strategies.

### Question 8: Secret Rotation
**Question**: Should the system support automatic credential rotation, or is manual rotation sufficient?

**Context**: AWS Secrets Manager supports automatic rotation for certain secret types. Benchling OAuth credentials may expire or need periodic rotation for security.

**Impact**: Determines if rotation logic needs to be implemented and how applications detect and use rotated credentials.

## Related Issues and Dependencies

### GitHub Issues
- Issue #156: Main tracking issue for secrets manager redesign (this document)
- Related issues for specific configuration aspects (to be created during phasing)

### External Dependencies
- **AWS Secrets Manager**: Core service for encrypted credential storage
- **AWS CloudFormation**: Source of Quilt Stack configuration via stack outputs
- **Quilt3 Python Library**: Source of Quilt catalog configuration at `~/.quilt3/config.yml`
- **XDG Base Directory Specification**: Standard for user configuration storage
- **Make**: Build automation tool for orchestration
- **Docker**: Containerization platform for application packaging

### Internal Dependencies
- **CDK Stack**: Infrastructure-as-code requiring configuration inputs
- **Flask Application**: Python webhook processor requiring credentials at runtime
- **npm Scripts**: CLI and deployment tools requiring configuration access
- **Testing Infrastructure**: All test tiers require credential access

### File System Locations
- `~/.config/benchling-webhook/default.json` - Primary configuration storage
- `~/.quilt3/config.yml` - Source for Quilt catalog inference
- `~/.aws/credentials` and `~/.aws/config` - Source for AWS authentication
- `env.template` - Documentation of available configuration variables (deprecated in favor of XDG)

## Technical Context

### Current Architecture (v0.5.4)
- Configuration scattered across `.env` files, environment variables, and command-line parameters
- Secrets passed directly to CDK as parameters
- Manual credential management and validation
- No unified configuration storage
- Multiple sources of truth for settings

### Target Architecture (v0.6.0)
- **Configuration Layer**: XDG-compliant storage at `~/.config/benchling-webhook/default.json`
- **Secrets Layer**: AWS Secrets Manager with encrypted storage and IAM-controlled access
- **Orchestration Layer**: Makefile targets delegating to npm and Python scripts
- **Validation Layer**: Credential testing and permission verification before deployment
- **Testing Layer**: Three-tier approach (unit, local integration, remote integration)

### Key Design Principles
- **Single Source of Truth**: XDG configuration is authoritative
- **Fail Fast**: Validation before deployment prevents partial stacks
- **Idempotence**: Re-running commands never breaks working setup
- **Observability**: Every stage logs explicit diagnostics
- **Separation of Concerns**: Makefile orchestrates, npm/Python implement
- **Security by Default**: Secrets in AWS Secrets Manager, never in version control

### Technology Stack
- **Makefile**: Environment-agnostic orchestration
- **Node.js (>=18.0.0)**: CDK infrastructure and CLI tools
- **Python**: Docker container application
- **TypeScript**: CDK stack definitions and npm scripts
- **AWS CDK**: Infrastructure-as-code framework
- **Docker**: Application containerization
- **AWS Services**: Secrets Manager, CloudFormation, ECR, Fargate, S3, SQS, API Gateway

### Configuration Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BENCHLING_APP_DEFINITION_ID` | Yes | - | Benchling app identifier from manifest |
| `BENCHLING_CLIENT_ID` | Yes | - | OAuth client ID from Benchling app |
| `BENCHLING_CLIENT_SECRET` | Yes | - | OAuth client secret from Benchling app |
| `BENCHLING_PKG_BUCKET` | Yes | - | S3 bucket for package storage |
| `BENCHLING_TENANT` | Yes | - | Benchling tenant name (e.g., "company" for company.benchling.com) |
| `BENCHLING_TEST_ENTRY` | No | - | Test entry ID for integration validation |
| `BENCHLING_ENABLE_WEBHOOK_VERIFICATION` | No | `true` | Enable/disable webhook signature verification |
| `BENCHLING_LOG_LEVEL` | No | `INFO` | Python logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL) |
| `BENCHLING_PKG_KEY` | No | `experiment_id` | Metadata key for package linking |
| `BENCHLING_PKG_PREFIX` | No | `benchling` | S3 key prefix for stored packages |
| `BENCHLING_WEBHOOK_ALLOW_LIST` | No | `""` | Comma-separated IP allowlist for webhook access |

### Configuration Failure Modes Reference

| Failure | Cause | Mitigation |
|---------|-------|------------|
| Missing Quilt catalog | Quilt3 not configured | Prompt user to run `quilt3 config` and retry |
| XDG config corrupted | Manual file edit | Validate JSON schema on read; re-run `make install` |
| AWS auth error | Invalid credentials | Check `AWS_PROFILE` and region before operations |
| Docker build failure | Outdated base image | Auto-pull latest base before build |
| Secrets not synced | Secrets Manager unreachable | Validate IAM permissions; retry sync with backoff |
| CDK stack drift | Manual AWS changes | Run `cdk diff` preflight; warn on drift detection |
| Missing secret variables | Incomplete `make install` | Schema validation before secrets sync |

### Migration Path
- v0.5.4 (current): `.env` files and environment variables
- v0.6.0 (target): XDG configuration with AWS Secrets Manager
- v1.0.0 (future): Remove legacy `.env` support completely

### Breaking Changes (v0.6.0)
1. Configuration moved from `.env` to `~/.config/benchling-webhook/default.json`
2. Deployment requires `make install` before first use
3. Secrets must exist in AWS Secrets Manager
4. Command-line parameters changed for CDK deployment
5. Environment variable-based configuration deprecated

## Implementation Scope

### In Scope
- XDG configuration file creation and management
- Interactive bootstrap with `make install`
- Configuration inference from Quilt and AWS
- Credential validation before deployment
- AWS Secrets Manager integration
- Three-tier testing infrastructure
- Makefile orchestration layer
- Migration tooling from `.env` to XDG
- Comprehensive error handling and diagnostics
- Documentation updates

### Out of Scope
- Automatic credential rotation (manual rotation only)
- Multi-profile configuration management (single profile per installation)
- Configuration encryption beyond AWS Secrets Manager
- Custom Docker registry support (ECR only in v0.6.0)
- Offline mode for AWS-dependent operations
- Web-based configuration UI
- Configuration import/export tooling
- Centralized configuration management for multiple developers
