<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Development deployment workflow** - New `npm run cdk:dev` command for testing changes before production (#141)
  - Creates timestamped dev git tags (e.g., `v0.5.3-20251030T123456Z`)
  - Pushes tag to GitHub, triggering CI to build Docker image for x86_64 (AWS-compatible)
  - Waits for CI/CD pipeline to complete (monitors GitHub Actions API)
  - Deploys CDK stack using CI-built image tag instead of `latest`
  - Added `--image-tag` CLI option to deploy command for manual control
  - Added `IMAGE_TAG` environment variable support in configuration
  - New documentation: `DEV_DEPLOYMENT.md` with complete usage guide
  - **IMPORTANT**: Uses CI-built images, NOT local builds (ARM builds would fail in AWS)
- **Package naming improvements** - Packages now use DisplayID for better organization (#141)
  - Package directories named with DisplayID (e.g., `PRT001`) instead of EntryID (e.g., `bfi_abc123`)
  - README titles use "DisplayID - Name" format for better readability
  - Comprehensive test suite validates DisplayID usage throughout
- **Upload URL improvements** - Enhanced package revision workflow (#141)
  - Upload URLs now include `?action=revisePackage` query parameter
  - Directs users to revision workflow when clicking package upload links
  - Added 19 comprehensive tests for URL format validation
- **CLI manifest tests** - Added comprehensive test coverage for Benchling app manifest (#141)
  - 23 new tests verify "quilt-entry" identifier in manifest output
  - Tests validate DNS naming conventions, manifest structure, and webhook subscriptions
  - Ensures proper YAML format and completeness

### Fixed

- **WebhookAllowList parameter handling** - Fixed deployment failures when IP allowlist is empty
  - API Gateway resource policy now correctly handles empty `WebhookAllowList` parameter
  - No longer attempts to create invalid IP conditions with empty strings
  - Deployments with empty allowlist now succeed (allows all IPs as documented)
- **Complete QUEUE_URL to QUEUE_ARN migration** - Fixed remaining references after v0.5.3
  - Fixed `docker/tests/test_app.py` - corrected `queue_url` attribute to `queue_arn`
  - Fixed `docker/scripts/run_local.py` - updated environment variable to use `QUEUE_ARN`
  - Fixed `docker/scripts/test_benchling.py` - updated parameter from `queue_url` to `queue_arn`
  - Fixed `docker/docker-compose.yml` - updated environment variable in both services
  - Removed dead code from `bin/commands/validate.ts` - eliminated non-existent `sqsQueueUrl` validation

### Changed

- **File metadata structure** - Simplified file metadata by removing redundant filename field (#141)
  - Filename no longer duplicated in metadata (already stored as dictionary key)
  - Cleaner JSON structure with reduced payload size
  - Follows DRY (Don't Repeat Yourself) principle
- **Documentation updates** - All user-facing docs now reference QUEUE_ARN
  - Updated `AGENTS.md` - corrected variables table to show `QUEUE_ARN`
  - Updated `docker/README.md` - replaced `SQS_QUEUE_URL` with `QUEUE_ARN`
  - Updated `docker/src/README.md` - replaced `SQS_QUEUE_URL` with `QUEUE_ARN`

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
