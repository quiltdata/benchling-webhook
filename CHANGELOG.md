<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to this project will be documented in this file.

## [0.7.3] - 2025-11-06

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

## [0.7.2] - 2025-11-06

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
