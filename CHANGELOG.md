<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to this project will be documented in this file.

## [0.9.0] - 2025-12-03

### Breaking Through: In-Stack VPC Support

- **JWKS caching eliminates cold start timeouts** - Root cause fix for VPC deployment failures (#227)
- **80-100x faster webhook processing** - Subsequent requests use cache (<100ms vs 40-80s per request)
- **HTTP connection pooling** - Reduces initial JWKS fetch from 80s → 40s
- **Migration required** - Existing deployments must destroy and redeploy stack to apply fix

### VPC Safety Features

- **VPC change detection** - Wizard displays critical warning when VPC/subnet selection changes
- **Intra-subnet filtering** - Excludes subnets without NAT Gateway to prevent connectivity issues
- **Profile-aware warnings** - VPC change warnings include profile name in preservation commands

### UX Improvements

- **Webhook allowlist 'none' keyword** - Explicitly disable IP filtering with clearer prompts
- **Better validation feedback** - More actionable guidance for configuration changes

## [0.8.10] - 2025-12-02

### Added

- **REST API v1 Resource Policy IP filtering** - Complete implementation with health endpoint exemption
  - When `webhookAllowList` configured: Two-statement policy blocks unknown IPs at API Gateway edge
  - Health endpoints (`/health`, `/health/ready`, `/health/live`) always accessible from any IP
  - Webhook endpoints (`/event`, `/lifecycle`, `/canvas`) restricted to allowed CIDR blocks
  - Supports single IPs, multiple IPs, and CIDR notation (e.g., `203.0.113.0/24`)
  - Free alternative to AWS WAF ($0.00/month vs $7.60-$17.60/month)

- **API Gateway CloudWatch logging** - Explicit IAM role management for access logs
  - Created dedicated `ApiGatewayCloudWatchRole` with proper trust policy
  - Set account-level CloudWatch role via `CfnAccount` construct
  - Ensures access logs capture all requests (200, 403, etc.) with source IP addresses
  - Provides audit trail for resource policy IP filtering decisions
  - Critical for security compliance and debugging

- **Comprehensive IP filtering documentation**
  - [docs/IP-FILTERING.md](docs/IP-FILTERING.md) - 500+ line operational guide with configuration examples, troubleshooting, CloudWatch queries
  - Architecture specs documenting implementation details and verification plan

### Fixed

- **IP filtering deployment** - Security config now correctly passed from profile to CDK stack
  - Deploy command loads `webhookAllowList` from profile config
  - Passes security configuration to CDK subprocess via environment variables
  - CDK synthesis now shows correct "ENABLED" status with IP list
  - Backward compatible with profiles without `webhookAllowList`

- **IP filtering display logic** - Pre-deployment configuration now correctly shows IP filtering status
  - Display was showing "ENABLED" even when `webhookAllowList` was empty
  - Updated to match actual deployment behavior from `rest-api-gateway.ts`
  - Parses webhook allowlist to show accurate status
  - Displays list of allowed IPs when filtering is enabled

## [0.8.9] - 2025-12-01

### Changed

- **API Gateway architecture** - REST API v1 + Resource Policy
  - REST API Gateway v1 with Resource Policy for IP filtering
  - Network Load Balancer for reliable health checks
  - Stage-based routing: `/{stage}/webhook`, `/{stage}/health`

- **Cost optimization** - Optimized infrastructure costs
  - Network Load Balancer: $16.20/month (vs $23/month for ALB)
  - Resource Policy IP filtering: free (when configured)
  - Variable costs: $3.50/million requests

- **Flexible route handling** - FastAPI supports both direct and stage-prefixed paths
  - API Gateway requests: `/{stage}/health` → Matches `/{stage}/health` route
  - NLB health checks: `/health` → Matches `/health` route
  - No middleware complexity or path rewriting needed
  - See spec/2025-11-26-architecture/13-fastapi-flexible-routes.md

### Added

- **Resource Policy IP filtering** - Free optional IP allowlisting
  - Applied when `webhookAllowList` configured
  - Blocks unknown IPs at API Gateway edge
  - Health endpoints always exempt from IP filtering
  - See spec/2025-11-26-architecture/12-rest-nlb.md

- **VPC subnet selection** - Explicit subnet selection for VPC reuse
  - New `vpcSubnetIds` config option for specifying subnets
  - Environment variables: `VPC_SUBNET_1_ID`, `VPC_SUBNET_2_ID`, `VPC_SUBNET_3_ID`
  - Wizard warns about VPC connectivity and defaults to new VPC
  - See spec/2025-11-26-architecture/14-vpc-subnet-selection-fix.md

### Security

- **Single authentication layer** - FastAPI HMAC verification (raw body access)
- **Optional network layer** - Resource Policy IP filtering (free)
- **Defense-in-depth** - Both layers work together when configured

## [0.8.8]

### Added

- Browse buttons for linked packages in Benchling Canvas
- Read-only package manifest browsing directly from S3 (no local filesystem writes)

### Changed

- **BREAKING**: Removed `--config` alias, use only `--profile` for all commands
- `PackageFileFetcher` now reads manifests directly from S3 instead of using `quilt3.Package.browse()`
- Added `role_arn` and `region` parameters to `PackageFileFetcher` for cross-account access

### Fixed

- **CRITICAL**: `--profile` flag now works correctly for all commands
- Configuration validation allows additional properties for backward compatibility
- Status command works with any profile containing stackArn (not just integrated stacks)
- Python package license corrected to Apache-2.0
- Docker filesystem writes eliminated by reading package manifests directly from S3 (closes #258)
- Pyright type error in `_load_manifest_data()` with explicit type casting
- Python code formatting issues (Black formatter)

## [0.8.3] - 2025-11-18

### Fixed

- Production workflow OIDC role now uses correct AWS account (730278974607) for authentication

## [0.8.2] - 2025-11-18

### Added

- Production Docker build workflow with SHA-tagged immutable images
- `--config` as alias for `--profile` option across all CLI commands
- Enhanced logs command with auto-refresh, sectioned display, and smart time window expansion
- ECS service discovery for integrated Quilt stacks (shows logs from all services)
- Utility modules for ECS discovery and time formatting

### Changed

- Logs command now auto-refreshes every 10s by default (disable with `--timer 0`)
- Logs command shows last 5 entries per group instead of 100 (configure with `--limit`)
- Logs command discovers all ECS services in integrated stacks, not just Benchling
- Default limit changed from `--tail` to `--limit` for clarity
- Removed obsolete `scripts/check-logs.ts` in favor of enhanced `logs` command

### Breaking Changes

- Logs command: `--follow` flag removed (replaced with `--timer` for auto-refresh)
- Logs command: `--tail` renamed to `--limit`
- Logs command: `--stage` flag removed (not used in integrated mode)

## [0.8.0] - 2025-11-17

### Breaking Changes

- **QuiltStackARN removed from runtime** - Services resolved at deployment time, not container startup (faster startup, improved security)
- **Single IAM role** - `QUILT_READ_ROLE_ARN` removed, only `QUILT_WRITE_ROLE_ARN` used for all S3/Athena operations (50% fewer STS calls)

### Added

- **`xdg-launch` command** - Unified configuration bridge for native/Docker modes (eliminates .env files)
- **`test:local` npm script** - Test Docker containers locally with hot-reload
- **`status --no-exit` flag** - Continuous deployment monitoring
- **In-memory ZIP processing** - Eliminated filesystem writes (33% faster extraction, no TMPDIR needed)
- **Cross-account Athena support** - PackageQuery now uses RoleManager for proper IAM role assumption

### Changed

- **Deployment-time service resolution** - Services resolved once at deploy (PACKAGER_SQS_URL, ATHENA_USER_DATABASE, QUILT_WEB_HOST)
- **Simplified IAM configuration** - Single write role for all operations, RoleManager API streamlined
- **Docker environment simplified** - No .env file, explicit service environment variables
- **Health endpoint** - Displays version from pyproject.toml

### Fixed

- Temporary directory errors eliminated (BytesIO replaces tempfile)
- Cross-account Athena queries now work correctly
- Status/validate commands handle optional stackArn gracefully
- QuiltWebHost ambiguity eliminated (catalog URL only)

### Performance

- **16% faster** total processing (eliminated disk I/O)
- **33% faster** ZIP extraction (in-memory vs filesystem)
- **50% fewer** STS API calls (single role vs two)
- **27% smaller** RoleManager code

### Migration

Existing configurations work unchanged. Read role ARN ignored if present. See [spec/206-service-envars/MIGRATION.md](./spec/206-service-envars/MIGRATION.md) and [spec/206-service-envars/23-implementation-summary.md](./spec/206-service-envars/23-implementation-summary.md) for details.

## [0.7.10] - 2025-11-15

### Added

- Enhanced `status` command with comprehensive deployment health checks (ECS service status, ALB target health, recent stack events, secret accessibility, listener rules)
- Auto-refresh status monitoring with `--timer` flag (default: 10 seconds, watches until stack reaches terminal state)
- Catalog validation now shows progress when searching CloudFormation stacks

### Changed

- Status command displays stack outputs, secrets metadata, and minutes since last modified
- Stack outputs and secrets display made more concise and readable
- Status command now auto-refreshes by default when monitoring deployments (use `--timer 0` to disable)

### Fixed

- Catalog matching now enforces exact QuiltWebHost match (prevents ambiguous catalog detection)
- Setup wizard fails fast on catalog mismatch instead of proceeding with wrong configuration
- CDK destroy command no longer requires valid configuration to run
- Removed duplicate completion message in integrated stack mode

## [0.7.9] - 2025-11-15

### Added

- Setup wizard automatically enables Benchling integration in Quilt stack (no manual CloudFormation update needed)
- `status` command to check deployment status and integration state
- `logs` command for viewing CloudWatch logs via NPX

### Changed

- Release notes now filter out non-user-facing commits

### Fixed

- Profile flag now properly respected in log viewing commands

## [0.7.8] - 2025-11-14

### Added

- **Integrated stack mode** - Setup wizard detects and reuses BenchlingSecret from Quilt stacks deployed via T4 template, eliminating duplicate credential entry
- **Catalog verification prompt** - Setup wizard confirms auto-detected catalog DNS before proceeding (skipped with `--yes`)
- **Version display in canvas** - Benchling canvas footer now shows application version from `pyproject.toml`

### Changed

- **Dockerfile rebuilt with Amazon Linux 2023** - Multi-stage build with UV package manager for faster, more reliable container builds
- **Setup wizard modularized** - Refactored into composable phases (profile, catalog, deployment, secrets) for better maintainability
- **Manifest/validate commands migrated to XDG** - Now use profile-based configuration for consistency

### Fixed

- **UV cache disabled in runtime** - Prevents disk space issues in ECS containers
- **Secret sync respects integratedStack flag** - Skips AWS sync when using Quilt stack's BenchlingSecret
- **Test isolation improved** - Removed `env.template` and `os.getenv` calls that could leak between tests

## [0.7.7] - 2025-11-13

### Changed

- **Improved `--yes` flag validation** - Enhanced error messages with detailed context, tested resources, error codes, and actionable hints
- **Improved S3 bucket region handling** - Auto-detects bucket region to prevent 301 errors when bucket is in different region than deployment
- **Internal code quality** - Refactored stack inference module for better testability (test coverage: 32% → 87.5%)

## [0.7.6] - 2025-11-13

### Fixed

- **NPX deployment reliability** - Fixed critical issue where `npx @quiltdata/benchling-webhook` would fail with CDK app not found error
- **Default deployment stage** - Corrected default stage to `prod` (was incorrectly defaulting to `dev` for non-dev profiles)
- **S3 bucket region detection** - Auto-detect S3 bucket region during validation to prevent 301 errors when bucket is in different region than deployment
- **Validation error messages** - Enhanced `--yes` flag validation errors with detailed context, tested resources, specific error codes, and actionable hints

### Changed

- **Streamlined deployment** - Removed automatic test execution after deployment
  - Tests no longer run automatically via npm scripts
  - Deployment success is independent of test results
  - Users can run tests manually when needed

## [0.7.5] - 2025-11-12

### Changed

- Setup wizard now suggests npm scripts in next steps for better UX
- Deploy command verifies secrets exist before attempting sync to avoid overwriting

### Fixed

- Dockerfile base image updated with correct hash and dependencies
- Setup wizard auto-syncs secrets to AWS Secrets Manager after completion

## [0.7.4] - 2025-11-12

### Fixed

- **Setup wizard auto-syncs secrets** - Secrets now automatically sync to AWS Secrets Manager after setup wizard completes
- **Region detection** - Fixed deployment region to correctly use inferred stack region from Quilt catalog
- **Secret sync region** - Fixed sync-secrets command to use correct deployment region instead of hardcoded us-east-1
- **Profile instructions** - Setup wizard now shows correct next steps for custom profiles
- **Test isolation** - Tests no longer overwrite user XDG configuration files

### Changed

- **Deploy validation** - Deploy command now verifies secrets instead of force-updating them on every deployment
- **Cleaner codebase** - Removed legacy mode detection and config_version field (no longer needed)

## [0.7.3] - 2025-11-06

### Added

- Manifest generation in setup wizard for users without App Definition ID

### Changed

- Centralized ECR image management - all deployments use quiltdata ECR (`712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling`)
- Enhanced deployment plan display with complete container image details
- Improved setup wizard credential flow - reordered prompts for better UX

### Fixed

- Profile-aware testing and log monitoring - commands now respect `--profile` flag
- Setup wizard instructions now match user's selected profile

## [0.7.2] - 2025-11-06

### Changed

- **Improved CLI UX** - Running without arguments now launches interactive setup wizard
  - Help and version flags (-h, --help, -v, --version) work as expected
  - Command descriptions clarified (deploy, init)
  - Init command redirects to setup wizard with helpful message

- **Enhanced setup wizard next steps** - Post-setup instructions are now profile-aware
  - Default profile shows simplified commands (npm run deploy, npm run test)
  - Non-default profiles show full commands with profile flags
  - Improved command suggestions in deploy error messages

### Fixed

- **Quilt stack detection** - Now finds stacks without 'quilt' in the name
  - Two-pass detection: fast path for stacks with 'quilt' or 'catalog' in name
  - Thorough pass checks remaining stacks for QuiltWebHost output
  - Correctly identifies production stacks like "sales-prod"
  - Comprehensive test coverage for edge cases

- **CLI argument parsing** - Fixed issue where help/version flags triggered setup wizard
- **Deploy error messages** - Corrected profile argument syntax in error messages

### Fixed

- Deployment tests now use correct XDG profile matching deployment profile
- `test:dev` command now passes `PROFILE=dev` to match `deploy:dev` behavior
- Deployed stack tests now run health checks only (webhook tests require Benchling signatures)

## [0.7.1] - 2025-11-04

### Fixed

- Resolved a regression where `sync-secrets` could upload a secret name or ARN instead of the resolved credential by re-reading the stored payload and extracting the real `client_secret`.
- Normalized the Python secrets resolver to accept both `clientSecret` and `client_secret`, keeping runtime parity with the CLI writer.
- Hardened XDG profile writes by staging temp files inside each profile directory to avoid cross-device rename failures in parallel test runs.

### Added

- Jest regression test covering the `sync-secrets` flow to ensure the resolved secret value is preserved.

## [0.7.0] - 2025-11-04

### BREAKING CHANGES

**Configuration architecture redesigned - manual reconfiguration required.** See [MIGRATION.md](./MIGRATION.md).

**What changed:**

- Config moved: `default.json` → `default/config.json`
- Deployment tracking: Shared `deploy.json` → per-profile `{profile}/deployments.json`
- Profile/stage are now independent (deploy any profile to any stage)

**Migration:**

1. Backup: `cat ~/.config/benchling-webhook/default.json > ~/benchling-backup.json`
2. Upgrade: `npm install @quiltdata/benchling-webhook@latest`
3. Setup: `npm run setup` (re-enter configuration)
4. Deploy: `npm run deploy -- --profile default --stage prod`

### Added

- **Profile inheritance** - Use `_inherits` field to reduce duplication
- **Deployment history** - Full history per profile with rollback capability
- **Profile management** - Commands: `setup`, `setup-profile <name>`, `setup-profile <name> --inherit`

### Changed

- Simplified config structure - single `config.json` per profile (no more user/derived/deploy split)
- Per-profile deployment tracking eliminates cross-profile conflicts

---

## [0.6.3] - 2025-11-04

### Added

- **Production Testing Command** (#176) - New `npm run test:prod` to test production deployments
  - Tests deployed production stack via API Gateway endpoint
  - Automatically runs after `deploy:prod` completes
  - Deployment fails if production tests fail

- **Development Testing Command** - New `npm run test:dev` to test development deployments
  - Renamed from `test:remote` for clarity
  - `test:remote` remains as backward-compatible alias

- **Deployment Configuration Tracking** - Deployment endpoints now stored in `~/.config/benchling-webhook/deploy.json`
  - Separate `dev` and `prod` environment configs
  - Tracks endpoint, image tag, deployment timestamp, stack name, and region
  - Enables test commands to automatically discover deployment endpoints

### Changed

- **Docker Makefile** - Renamed `test-prod` target to `test-docker-prod` for clarity
  - `test-docker-prod` - Tests local Docker production container
  - `test-deployed-prod` - Tests deployed production stack via API Gateway
  - `test-deployed-dev` - Tests deployed development stack via API Gateway

- **Canvas Footer Layout** - Consolidated async notice into unified footer
  - Merged async processing notice with version/deployment info
  - Reduces visual weight with single footer section instead of two

### Fixed

- Production deployments now automatically validated before completion
- Clearer error messages when deployment endpoints not found

## [0.6.2] - 2025-11-03

### Changed

- **Streamlined Setup Wizard** - The setup wizard now optionally deploys to AWS automatically
  - After configuration completes, wizard prompts: "Would you like to deploy to AWS now?"
  - Default is "yes" for one-command deployment experience
  - Users can decline and deploy later with `npx @quiltdata/benchling-webhook deploy`

- **Simplified README** - Drastically reduced documentation to focus on the golden path
  - Removed verbose deployment mode explanations
  - Removed legacy mode documentation from main README
  - Removed manual AWS Secrets Manager commands
  - Removed deprecated parameters section
  - All advanced topics moved to dedicated documentation files
  - README now clearly communicates: one command to setup and deploy

## [0.6.1] - 2025-11-03

### Added

- **NPX Setup Wizard** (#182) - One-command setup experience
  - Running `npx @quiltdata/benchling-webhook` now launches interactive setup wizard
  - Guides through configuration, validation, and deployment preparation
  - Maintains backward compatibility - all existing commands work identically

- **Canvas Footer** - Added version and deployment information footer to Benchling canvas
  - Displays application version (0.6.1)
  - Shows Quilt catalog host
  - Shows S3 bucket name
  - Includes disclaimer text about canvas metadata

### Changed

- **CLI Default Behavior** - Running npx without arguments now starts setup wizard instead of showing help
- **Health Check** - Configuration validation now checks Quilt config fields instead of API access
- Updated application version in health endpoint from 1.0.0 to 0.6.1
- Enhanced canvas markdown formatting with footer section

## [0.6.0] - 2025-11-03

### Added

- **XDG Configuration Management** (#156)
  - Centralized configuration in `~/.config/benchling-webhook/default.json`
  - Interactive setup wizard (`npm run setup`) for first-time configuration
  - Automatic Quilt catalog inference from `quilt3 config`
  - Secrets sync to AWS Secrets Manager with validation
  - Configuration health check (`npm run setup:health`)
  - Eliminates `.env` files and environment variable pollution

- **Unified Test Workflow**
  - `npm run test` - Fast unit tests (lint + typecheck + mocked tests)
  - `npm run test:local` - Local Docker integration with real Benchling
  - `npm run test:remote` - Deploy dev stack and test via API Gateway
  - Added `BENCHLING_TEST_MODE` to disable webhook verification for local testing

- **npm Script Reorganization** (#175)
  - Consistent naming: `setup:*`, `build:*`, `test:*`, `deploy:*`, `release:*`
  - `npm run setup:infer` - Infer Quilt config from catalog
  - `npm run setup:sync-secrets` - Sync secrets to AWS Secrets Manager
  - `npm run deploy:prod` - Deploy to production AWS (renamed from `cli`)
  - `npm run deploy:dev` - Deploy to dev AWS (renamed from `release:dev`)
  - `npm run release:tag` - Create and push version tag

### Changed

- **Configuration Model**
  - XDG config is single source of truth (no more environment variables in scripts)
  - Secrets stored in AWS Secrets Manager, referenced by ARN in XDG config
  - Python CLI now reads from XDG config instead of environment variables
  - Non-interactive mode no longer depends on environment variables

- **Test Strategy**
  - `test:remote` now tests deployed endpoint (not local ECR image)
  - Integration tests use real credentials from Secrets Manager
  - Local tests bypass webhook verification for faster iteration

### Fixed

- Interactive wizard now preserves existing secrets when pressing Enter
- Test entry ID displays correctly on subsequent wizard runs
- Setup script exits cleanly (no hanging from AWS SDK connection pools)
- Removed environment variable dependency in non-interactive setup
- **Deploy command now passes parameters correctly** (#175)
  - Fixed `deploy:prod` not passing `quiltStackArn` and `benchlingSecret` to CDK stack
  - CLI deploy command now sets environment variables for CDK synthesis
  - Production deployment workflow now fully documented

## [0.5.4] - 2025-10-30

### Added

- **Package naming improvements** - Packages now use DisplayID (e.g., `PRT001`) instead of EntryID for better organization
- **Upload URL improvements** - Package links now include `?action=revisePackage` to direct users to revision workflow
- **Stack-specific manifests** - The cli `manifest` generates app-manifests using the name of the catalog.
- **Development deployment workflow** - New `npm run cdk:dev` command for testing changes before production
  - Deploys using CI-built images with timestamped tags
  - Added `--image-tag` CLI option and `IMAGE_TAG` environment variable for version control

### Fixed

- **WebhookAllowList parameter handling** - Fixed deployment failures when IP allowlist is empty
- **QUEUE_ARN migration** - Completed transition from QUEUE_URL to QUEUE_ARN throughout the codebase

## [0.5.3] - 2025-10-30

### Changed

- **⚠️ BREAKING: Replaced QUEUE_URL with QUEUE_ARN throughout codebase**
  - Environment variable renamed from `QUEUE_URL` to `QUEUE_ARN`
  - CloudFormation parameter renamed from `QueueUrl` to `QueueArn`
  - All configurations must now provide the SQS queue ARN instead of URL
  - Eliminates error-prone URL-to-ARN conversion logic in `fargate-service.ts`
  - Python code now converts ARN to URL internally for boto3 compatibility

### Fixed

- Test environment isolation - Added `CDK_DEFAULT_ACCOUNT` cleanup to test hooks
- Updated all test files to use ARN format instead of URL format

## [0.5.2] - 2025-10-29

### Added

- **Runtime configuration via CloudFormation parameters** - Update stack settings without redeployment
  - `QuiltDatabase` - Glue Data Catalog database name
  - `BenchlingTenant` - Benchling tenant identifier
  - `LogLevel` - Application log level with validation (DEBUG/INFO/WARNING/ERROR/CRITICAL)
  - `EnableWebhookVerification` - Toggle webhook signature verification
  - `PackageKey` - Metadata key for linking Benchling entries to Quilt packages
  - Update any parameter through CloudFormation console or CLI without full redeployment
- **Integrated Python tests into npm test workflow** - Python integration tests now run automatically
  - Added `test:ts` and `test:python` commands for separate test suites
  - Main `npm test` command now runs both TypeScript and Python tests sequentially
  - New validation test ensures ECS secrets configuration matches required credentials

### Changed

- **Streamlined configuration and CLI output** - Improved clarity and reliability
  - Database inference now exclusively uses `UserAthenaDatabaseName` from Quilt stack
  - Unified queue configuration to use `QUEUE_URL` consistently
  - Deploy command displays all stack parameters being used for transparency
  - User bucket (`QUILT_USER_BUCKET`) must now be explicitly provided (no longer inferred)
  - Removed confusing analytics/service bucket inference logic

### Fixed

- **Critical deployment failures** - Multiple issues preventing successful deployments
  - Added missing `BENCHLING_APP_DEFINITION_ID` to ECS task definition secrets
  - Fixed `SQS_QUEUE_URL` environment variable name mismatch (was incorrectly `QUEUE_URL`)
  - Made all core Benchling and Quilt configuration unconditionally required to fail fast
  - Container health checks now pass reliably during deployment
  - ECS tasks no longer fail at startup due to missing environment variables
  - CloudFormation stacks no longer get stuck in UPDATE_IN_PROGRESS state

## [0.5.1] - 2025-10-29

### Added

- **Benchling app manifest generation** - New `manifest` command to generate Benchling app manifests
  - Run `npx @quiltdata/benchling-webhook manifest` to create `app-manifest.yaml`
  - Automatically configures OAuth scopes and webhook subscriptions
  - Integrated into deployment workflow for streamlined setup
- **Auto-detect catalog from quilt3 config** - CLI now automatically detects your Quilt catalog from `quilt3 config` when not explicitly provided
  - Eliminates need to manually specify catalog in most cases
  - Falls back to quilt3 configuration if `--catalog` flag or `QUILT_CATALOG` environment variable not set

### Changed

- **Streamlined setup process** - Simplified deployment workflow with better integration of Benchling setup
  - Consolidated documentation for clearer onboarding
  - Enhanced `deploy` command with manifest generation support
- Updated dependency `chalk` to v5 (#146)
- Updated dependency `boxen` to v8 (#145)
- Updated dependency `boto3` to v1.40.62 (#147)
- Updated dependency `@aws-sdk/client-s3` to v3.920.0 (#148)
- Updated dependency `aws-cdk-lib` to v2.221.1 (#139)

### Fixed

- Improved deployment reliability with better error handling

## [0.5.0] - 2025-10-29

### Added

- **CLI support for npx execution** - Deploy directly without cloning repository
  - Run `npx @quiltdata/benchling-webhook init` to set up configuration interactively
  - Run `npx @quiltdata/benchling-webhook validate` to check configuration before deployment
  - Run `npx @quiltdata/benchling-webhook deploy` to deploy your stack
  - Automatic configuration inference from your Quilt catalog
  - Support for `.env` files, environment variables, and CLI flags with intelligent priority ordering
  - Clear, actionable error messages with solution guidance
  - Beautiful terminal output with colors, spinners, and progress indicators

### Fixed

- **Improved database detection** - Configuration inference now correctly detects the `UserAthenaDatabase` from Quilt CloudFormation stacks

## [0.4.14] - 2025-10-29

### Added

- OIDC authentication for npm publishing (#137)

### Changed

- **NPM publish workflow**: Package now publishes compiled JavaScript instead of TypeScript source
  - Renamed `publish:manual` → `publish` for simpler usage
  - Publishes with `dev` tag by default (prerelease), use `--prod` for production
  - Added `--check` flag to view package status without authentication
  - Build artifacts (`dist/`) automatically compiled and cleaned during publish
  - Updated `package.json` to point to compiled files: `dist/lib/index.js`
- Updated TypeScript and ESLint to v24 (major) (#134)
- Updated AWS CDK dependencies (#135)
- Updated @types/node to v24.9.2 (#136)
- Updated boto3 to v1.40.61 (#120)

### Fixed

- docker-validate now ensures ECR repository is publicly accessible (#133)

## [0.4.13] - 2025-10-28

### Changed

- Improved release notes generation with clearer formatting
- Updated publish workflows to support both dev and prod tags

## [0.4.12] - 2025-10-27

### Added

- Automated release notes generation script

### Changed

- Enhanced CI/CD pipeline for releases

## [0.4.11] - 2025-10-26

### Changed

- Updated dependencies and security patches

### Fixed

- Minor bug fixes in webhook processing

## [0.4.10] - 2025-10-25

### Added

- Enhanced error reporting in Lambda functions

### Changed

- Improved logging structure for better debugging

## [0.4.9] - 2025-10-24

### Fixed

- Fixed issue with webhook verification when app definition ID is not provided

## [0.4.8] - 2025-10-23

### Added

- Support for custom ECR repository names

### Changed

- Updated Docker build process

## [0.4.7] - 2025-10-22

### Fixed

- Fixed CloudFormation stack outputs

## [0.4.6] - 2025-10-21

### Changed

- Improved stack synthesis process

## [0.4.5] - 2025-10-20

### Added

- Additional configuration validation

## [0.4.4] - 2025-10-19

### Fixed

- Fixed environment variable expansion

## [0.4.3] - 2025-10-18

### Changed

- Enhanced configuration loading

## [0.4.2] - 2025-10-17

### Fixed

- Fixed CDK bootstrap check

## [0.4.1] - 2025-10-16

### Changed

- Updated documentation

## [0.4.0] - 2025-10-15

### Added

- Major feature update with improved webhook handling

## [0.3.0] - 2025-10-10

### Added

- Enhanced Benchling integration features

## [0.2.0] - 2025-10-05

### Added

- Initial public release

## [0.1.0] - 2025-10-01

### Added

- Initial internal release
