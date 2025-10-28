<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.4.13] - 2025-10-28

### Changed

- **Simplified configuration**: Auto-infer AWS and Quilt config from catalog at deployment time
- **Reduced required .env variables**: From 20+ to just 6 (catalog URL, user bucket, 4 Benchling credentials)
- **Renamed `BUCKET_NAME` → `QUILT_USER_BUCKET`**: Clearer distinction between user data bucket and Quilt system buckets
- **Added CDK bootstrap validation**: Fails fast with helpful error if account/region not bootstrapped
- **Made LOG_LEVEL configurable**: Override default INFO level for production debugging

### Removed

- Unused environment variables: `BENCHLING_API_KEY`, `PKG_BUCKET_ONLY`, `PREFIX`, `STAGE`, `FLASK_ENV`

### Fixed

- Module import issue: CLI argument parsing now only runs when executed directly, not on import

## [0.4.12] - 2025-10-27

### Added

- Dev release workflow with timestamped pre-release tags for testing CI/CD pipeline

### Changed

- Refactored release script to separate version bumping from tag creation
- version.js now outputs just the version number when called with no arguments

## [0.4.11] - 2025-10-27

### Added

- Version synchronization test to ensure package.json, docker/pyproject.toml, and docker/app-manifest.yaml remain in sync
- app-manifest.yaml now published as GitHub release asset for Benchling App installations

### Fixed

- Version bump script (bin/version.js) now updates all three version files instead of just package.json
- `docker-validate` target now validates ECR repository is publicly accessible without authentication
- `docker-validate` reads Docker image URI from `cdk-outputs.json` instead of requiring version parameter
- `docker-validate` will fail if repository requires authentication, ensuring public access is maintained

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

- **Infrastructure Migration** - Migrated from Lambda to Docker/Fargate for improved scalability and resource management
- **Improved Deployment** - Streamlined Docker-based deployment workflow with health checks and automated verification
- **Enhanced Testing** - Added comprehensive test commands for local development and CI/CD workflows

### Fixed

- Resolved CloudFormation deployment conflicts during stack updates
- Ensured ECR repository exists before Docker push in CI
