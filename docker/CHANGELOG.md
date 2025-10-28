<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to the Benchling-Quilt Integration project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.11] - 2025-10-27

### Added

- Version synchronization test to ensure package.json, docker/pyproject.toml, and docker/app-manifest.yaml remain in sync
- app-manifest.yaml now published as GitHub release asset for Benchling App installations

### Fixed

- Version bump script (bin/version.js) now updates all three version files instead of just package.json
- `docker-validate` target now validates ECR repository is publicly accessible without authentication
- `docker-validate` reads Docker image URI from `cdk-outputs.json` instead of requiring version parameter

## [0.4.10] - 2025-10-27

### Added

- Canvas error notification section to display warnings and errors to users
- Athena permissions (StartQueryExecution, GetQueryExecution, GetQueryResults) to ECS task role
- Glue Data Catalog permissions for Athena queries
- S3 permissions for Athena query results bucket
- Test event file for Athena access denied scenario

### Fixed

- Canvas now displays error notifications instead of failing silently when PackageQuery encounters AWS permission issues
- Improved error messages for Athena AccessDeniedException with actionable guidance

## [0.4.9] - 2025-10-27

### Added

- Integrated release workflow into CI pipeline for automated GitHub releases, Docker image publishing, and NPM package publishing
- Support for both production and pre-release (dev) versions

### Changed

- Updated Python to 3.14 in CI workflows
- Updated aws-actions/configure-aws-credentials to v5
- Updated actions/setup-python to v6
- Streamlined release process with automated tagging and publishing

## [0.4.8] - 2025-10-27

### Changed

- **Repository Consolidation** - Established benchling-webhook as primary source repository
  - Copied application files from enterprise/benchling to docker/ directory
  - Removed docker-sync workflow (no longer syncing from enterprise repo)
  - Updated repository URLs in pyproject.toml to point to benchling-webhook
  - Simplified package.json scripts to delegate Docker operations to Makefile
  - Added version sync script to maintain consistency between package.json and pyproject.toml
- **Infrastructure Migration** - Migrated from Lambda to Docker/Fargate for improved scalability and resource management
- **Improved Deployment** - Streamlined Docker-based deployment workflow with health checks and automated verification
- **Enhanced Testing** - Added comprehensive test commands for local development and CI/CD workflows

### Removed

- **bin/docker.js** - Eliminated duplicate Docker tooling in favor of docker/Makefile and docker/scripts/docker.py

### Fixed

- Resolved CloudFormation deployment conflicts during stack updates
- Ensured ECR repository exists before Docker push in CI

## [0.4.7] - 2025-10-25

### Added

- **Docker Deployment Automation** - Streamlined ECR repository management
  - Single `docker-ecr-create` target creates both architecture-specific and generic repositories
  - Simplified deployment workflow: develop locally with `push-local` (creates repos if needed), deploy to CI with `push-ci`

### Changed

- **CI Workflow Updates** - Renamed workflow file and configured automated ECR deployment
  - Workflow now triggers on `benchling-docker` branch instead of `master`
  - Uses `make push-ci` for standardized deployment process

## [0.4.6] - 2025-10-24

### Added

- **Package Linking via Athena Database** - Find and display packages linked to Benchling entries
  - Canvas now shows linked packages for each entry using Athena database queries
  - Navigate buttons moved to top of canvas for better accessibility
  - Configure package lookup key via `PKG_KEY` environment variable (default: `experiment_id`)
  - Optionally restrict searches to current bucket with `PKG_BUCKET_ONLY=true`

### Changed

- **Improved Canvas Code Organization** - Refactored canvas management for maintainability
  - Extracted formatting utilities to `canvas_formatting.py` (33% code reduction)
  - Extracted block builders to `canvas_blocks.py` for reusable UI components
  - Simplified navigation button creation and error message formatting

## [0.4.5] - 2025-10-23

### Added

- **Package Entry Browser** - Browse files within Quilt packages directly from Benchling Canvas ([#938](https://github.com/quiltdata/enterprise/issues/938))
  - Paginated file list browsing (15 files per page)
  - View files in Catalog or download via QuiltSync
  - Package metadata viewer
  - Error handling for empty or missing packages

### Fixed

- Canvas button interactions now properly route to file browser
- File browser display format optimized for Benchling Canvas
- Entry ID extraction from pagination button IDs

## [0.4.4] - 2025-10-22

### Fixed

- **Code quality improvements from PR review** ([#929](https://github.com/quiltdata/enterprise/pull/929))
  - Fixed AWS region default inconsistency between config.py and env.template (now consistently `us-east-2`)
  - Enhanced HTTP retry logic to only retry appropriate status codes (429, 5xx) instead of all HTTPError exceptions
  - Added proper temporary file cleanup with try/finally blocks in entry_packager.py to prevent resource leaks
  - Fixed timestamp generation in test_webhook.py to generate fresh timestamps at runtime instead of import time
  - Removed unnecessary runtime assertions in test_benchling.py
  - Fixed documentation references: corrected `make test-benchling` command and removed non-existent SPECIFICATION.md link
  - Updated pyproject.toml URLs to point to actual quiltdata/enterprise repository
  - Replaced CLAUDE.md symlink with actual file containing relative documentation paths
  - Removed broken WORKFLOW.md symlink

## [0.4.3] - 2025-10-22

### Added

- **URL-encoded QuiltSync redirect URIs with path and version support** - Canvas now generates properly URL-encoded redirect links for QuiltSync integration
  - `raw_sync_uri(path, version)` method provides unencoded URIs with hash fragment format
  - `sync_uri(path, version)` method generates valid redirect URLs with properly encoded special characters
  - Supports optional `path` parameter for deep-linking to specific files within packages
  - Supports optional `version` parameter for linking to specific package versions
  - Always includes catalog parameter for proper QuiltSync routing
  - Enables seamless "Open in QuiltSync" functionality from Benchling Canvas
  - Example: `quilt+s3://bucket#package=name@hash&path=README.md&catalog=host`
  - Example encoded: `https://catalog.quiltdata.com/redir/quilt%2Bs3%3A%2F%2F...`

### Fixed

- Fixed infinite recursion bug in `CanvasManager.sync_uri` property
- Changed `sync_uri` and `raw_sync_uri` from properties to methods to support optional parameters
- Added comprehensive test suite for Canvas URL generation and encoding with 18 tests ([tests/test_canvas.py](tests/test_canvas.py))

## [0.4.2] - 2025-10-21

### Added

- **Webhook Signature Verification** - Secure webhook authentication using Benchling SDK
  - Automatic verification of webhook signatures using `benchling_sdk.apps.helpers.webhook_helpers.verify()`
  - Configuration via `BENCHLING_APP_DEFINITION_ID` and `ENABLE_WEBHOOK_VERIFICATION` environment variables
  - Applied to all webhook endpoints: `/event`, `/lifecycle`, `/canvas`
  - Returns 401 Unauthorized for invalid signatures
  - Enabled by default for production security
  - Can be disabled for local development/testing
  - Comprehensive unit tests for verification logic (6 new tests)
  - Documentation in README with setup instructions

### Changed

- Switch canvas configuration (back?) to using asychronous PATCH
- Updated app-manifest for simplification and uniqueness
- Updated test fixtures to disable webhook verification during tests
- Enhanced security posture with signature validation on all webhook endpoints

## [0.4.1] - 2025-10-21

### Added

- GitHub Actions CI workflow for automated testing and deployment
  - Runs unit tests with coverage reporting on all pushes
  - Builds and pushes Docker images to ECR on master branch
  - Uses change detection to optimize CI resources

### Fixed

- Canvas API integration to retrieve entry_id from resource_id ([#934](https://github.com/quiltdata/enterprise/pull/934))
- Canvas endpoint test failures by adding missing `canvasId` and `resourceId` fields to test data
- Comprehensive tests for canvas resource_id extraction
- Fallback mechanism for entry_id lookup with precedence: explicit resourceId > canvas lookup > most_recent_entry

## [0.4.0] - 2025-10-14

### Changed

- Unified payload parsing with `Payload.from_request()` class method
- Improved Canvas synchronization logic
- Enhanced console output with human-friendly formatting
- Cleaned up Canvas code and improved error handling
- Guess most-recent-entry for canvas events

## [0.3.x] - Earlier

### Added

- Benchling Canvas support (#931)
- Docker deployment configuration
- Integration test framework
- Makefile targets for development workflow (run-local, run-dev, test-integration)
- Health check endpoints (/health, /health/ready)

### Changed

- Consolidated Step Functions workflow into Python orchestration (#923)
- Fixed Makefile run-dev target and integration test issues
- Updated Benchling configuration for Docker deployment

### Infrastructure

- Added ngrok support for local development
- Improved Docker hot-reload for development
- Enhanced testing infrastructure with auto-managed local server
