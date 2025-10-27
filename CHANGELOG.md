# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
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

## [0.5.0] - 2025-10-27

### Changed
- **Infrastructure Migration** - Migrated from Lambda to Docker/Fargate for improved scalability and resource management
- **Improved Deployment** - Streamlined Docker-based deployment workflow with health checks and automated verification
- **Enhanced Testing** - Added comprehensive test commands for local development and CI/CD workflows

### Fixed
- Resolved CloudFormation deployment conflicts during stack updates
