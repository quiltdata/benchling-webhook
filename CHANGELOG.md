<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to this project will be documented in this file.

## [0.12.0] - 2026-02-23

### Added

- Handle `v2.entry.updated.reviewRecord` events by triggering the standard entry export workflow (previously ignored)

## [0.11.2] - 2026-01-27

### Added

- Logs now show which service generated each message with `[service-name]` labels
- Logs display relative timestamps (e.g., "4 minutes ago") for easier reading

### Fixed

- Containers automatically restart after secret updates to pick up new values
- Only services using the updated secret restart (not all services in the stack)
- Improved tenant name validation in secrets manager

## [0.11.1] - 2025-12-27

### Added

- **Custom Athena workgroup for standalone deployments** - Creates webhook-managed workgroup instead of using AWS default, matching the integrated stack behavior and ensuring consistent query results handling

### Fixed

- **Setup wizard UX improvements**
  - Removed duplicate standalone deployment prompt
  - Removed duplicate disable confirmation and clarified impact
  - Clear deployment tracking when configuring integrated mode
- **Status command** - Now waits for ECS rollout completion before exiting
- **Athena workgroup configuration** - Enabled AWS-managed query results in fallback workgroup (fixes "No output location provided" errors)

### Changed

- **Integrated flow** - Improved user experience with clearer prompts and better state management
- **Workgroup resolution** - Automatically uses Quilt-managed workgroup when integrated, creates custom webhook-managed workgroup for standalone deployments (replaces AWS default workgroup)

## [0.11.0] - 2025-12-26

### BREAKING CHANGES

- **Removed ATHENA_RESULTS_BUCKET dependency for AWS-managed workgroups**
  - Removed `ATHENA_RESULTS_BUCKET` environment variable and related infrastructure
  - AWS-managed Athena workgroups handle query results automatically
  - No longer need explicit S3 bucket permissions for Athena query results
  - Removed `ResultConfiguration` from Athena API calls
  - Removed `quilt.athenaResultsBucket` runtime usage (field preserved for config discovery)

### Changed

- **Updated Athena workgroup discovery** - Changed CloudFormation resource logical ID from `UserAthenaNonManagedRoleWorkgroup` to `BenchlingAthenaWorkgroup` to align with new Quilt stack naming convention
- **Simplified PackageQuery** - Removed unused `boto3` import and `athena_output_bucket` parameter

### Fixed

- **Test compatibility** - Fixed `test_package_query.py` tests after removing `boto3` module dependency

### Why This Works

AWS-managed workgroups handle query results automatically:

1. Query results location is managed by the workgroup configuration
2. `athena:GetQueryResults` API returns data directly (no S3 access needed)
3. Workgroup configuration takes precedence over client-side `ResultConfiguration`

When workgroups have AWS-managed query results enabled, you cannot specify `ResultConfiguration` in API calls - AWS handles the result location automatically.

## [0.10.0] - 2025-12-24

### BREAKING CHANGES

- **Removed unused Iceberg configuration fields** (#317)
  - Removed `quilt.athenaUserPolicy`, `quilt.athenaResultsBucketPolicy`, and `quilt.athenaResultsBucket`
  - Existing configurations with these fields will continue to work (backwards compatible)

- **Simplified IAM permissions model** (#317)
  - Replaced role assumption with direct managed policy attachment
  - Removed `quilt.writeRoleArn`, replaced with `quilt.bucketWritePolicyArn` and `quilt.athenaUserPolicyArn`
  - ECS task role now has policies attached directly (no more `sts:AssumeRole` calls)
  - Setup wizard discovers managed policies instead of roles

### Changed

- **Streamlined CDK stack configuration** - Created minimal `StackConfig` interface separate from `ProfileConfig`
- **Simplified setup wizard** - Removed Iceberg-related prompts
- **Configuration transformation** - New `config-transform.ts` utility for ProfileConfig → StackConfig conversion

## [0.9.9] - 2025-12-23

### BREAKING CHANGES

- **IP filtering now applies to ALL endpoints including health checks** (#312)
  - External monitoring must be added to `webhookAllowList` or IP filtering disabled
  - See [spec/297-ip-whitelisting/MIGRATION-v1.1.md](spec/297-ip-whitelisting/MIGRATION-v1.1.md)

## [0.9.8] - 2025-12-22

### Fixed

- File catalog URLs now include `/latest/` version component (#313)

## [0.9.7] - 2025-12-18

### Fixed

- Config validation in `npm run deploy:dev` - deploy.ts now passes complete config to CDK (#A07)

## [0.9.6] - 2025-12-18

### Added

- Status monitoring after integrated deployment - prompts to watch stack updates in real-time
- `npm run version:verify` - fail-fast git checks before running tests

### Fixed

- CloudFormation parameter defaults - library usage works without explicit `--parameters`
- Gunicorn PORT environment variable - container respects PORT overrides in ECS
- Gunicorn read-only filesystem compatibility - configured `--worker-tmp-dir /dev/shm`

## [0.9.5] - 2025-12-17

### Fixed

- Container starts successfully without AWS credentials (#302)
  - Degraded mode with health checks passing
  - `npm run test:minimal` reproduces CI environment locally

## [0.9.4] - 2025-12-16

Re-released due to failed tag

## [0.9.3] - 2025-12-16

### Added

- On-demand secret fetching from AWS Secrets Manager on every webhook request
- Enhanced logs command with auto-filtering, JSON parsing, color-coded status
- API Gateway log discovery for REST v1 and HTTP v2
- Webhook URL caching from CloudFormation

### Fixed

- Removed Benchling credentials from `/config` endpoint
- Log ordering shows most recent entries

## [0.9.2] - 2025-12-04

### Added

- Degraded startup mode - app starts without Benchling secrets (#288)
- BenchlingSecret auto-discovery from CloudFormation
- Integrated stack indicators in deployment

### Fixed

- CloudFormation parameter name corrected to `BenchlingWebhook`

## [0.9.1] - 2025-12-04

### Added

- Production ASGI server - migrated to Gunicorn with Uvicorn workers
  - 4 workers for parallel request handling
  - JWKS cache pre-warming on startup

## [0.9.0] - 2025-12-03

### Breaking Changes

- **JWKS caching eliminates cold start timeouts** (#227)
  - 80-100x faster webhook processing (cache hit <100ms vs 40-80s)
  - Migration required: destroy and redeploy stack

### Added

- VPC change detection with critical warnings
- Intra-subnet filtering (excludes subnets without NAT)
- Webhook allowlist 'none' keyword

## [0.8.10] - 2025-12-02

### Added

- REST API v1 Resource Policy IP filtering
  - Health endpoints exempt from filtering
  - Free alternative to AWS WAF
- API Gateway CloudWatch logging with IAM role
- [docs/IP-FILTERING.md](docs/IP-FILTERING.md) - comprehensive operational guide

### Fixed

- Security config passed from profile to CDK stack
- IP filtering display logic shows accurate status

## [0.8.9] - 2025-12-01

### Changed

- REST API v1 + Resource Policy architecture
- Network Load Balancer ($16.20/month vs $23 ALB)
- Flexible route handling - supports both direct and stage-prefixed paths

### Added

- Resource Policy IP filtering (free when configured)
- VPC subnet selection with `vpcSubnetIds` config

## [0.8.8]

### Added

- Browse buttons for linked packages in Benchling Canvas
- Read-only package manifest browsing from S3

### Changed

- **BREAKING**: Removed `--config` alias, use only `--profile`
- `PackageFileFetcher` reads manifests directly from S3

### Fixed

- `--profile` flag works for all commands
- Docker filesystem writes eliminated (#258)

## [0.8.3] - 2025-11-18

### Fixed

- Production OIDC role uses correct AWS account (730278974607)

## [0.8.2] - 2025-11-18

### Added

- Production Docker build workflow with SHA-tagged images
- Enhanced logs command with auto-refresh and sectioned display
- ECS service discovery for integrated stacks

### Changed

- Logs auto-refresh every 10s (disable with `--timer 0`)
- Default limit 5 entries per group (was 100)

### Breaking Changes

- `--follow` removed (use `--timer`)
- `--tail` renamed to `--limit`

## [0.8.0] - 2025-11-17

### Breaking Changes

- QuiltStackARN removed from runtime - services resolved at deployment
- Single IAM role - `QUILT_WRITE_ROLE_ARN` only (50% fewer STS calls)

### Added

- `xdg-launch` command - unified config bridge for native/Docker
- `test:local` npm script
- `status --no-exit` flag
- In-memory ZIP processing (33% faster, no TMPDIR)

### Performance

- 16% faster total processing
- 33% faster ZIP extraction
- 50% fewer STS calls

## [0.7.10] - 2025-11-15

### Added

- Enhanced `status` command with health checks
- Auto-refresh with `--timer` flag (default: 10s)

### Fixed

- Catalog matching enforces exact QuiltWebHost match
- CDK destroy no longer requires valid config

## [0.7.9] - 2025-11-15

### Added

- Setup wizard auto-enables Benchling integration in Quilt stack
- `status` and `logs` commands

## [0.7.8] - 2025-11-14

### Added

- Integrated stack mode - reuses BenchlingSecret from Quilt stacks
- Catalog verification prompt
- Version display in Benchling canvas footer

### Changed

- Dockerfile rebuilt with Amazon Linux 2023 and UV package manager
- Setup wizard modularized into phases

## [0.7.7] - 2025-11-13

### Changed

- Improved `--yes` flag validation with detailed error messages
- Auto-detect S3 bucket region

## [0.7.6] - 2025-11-13

### Fixed

- NPX deployment reliability - CDK app not found error
- Default deployment stage corrected to `prod`
- S3 bucket region detection

### Changed

- Removed automatic test execution after deployment

## [0.7.5] - 2025-11-12

### Fixed

- Setup wizard auto-syncs secrets to AWS Secrets Manager
- Region detection uses inferred stack region
- Secret sync uses correct deployment region

## [0.7.4] - 2025-11-12

### Fixed

- Setup wizard auto-syncs secrets
- Profile-aware instructions

## [0.7.3] - 2025-11-06

### Added

- Manifest generation in setup wizard

### Changed

- Centralized ECR image management (quiltdata account)
- Enhanced deployment plan display

## [0.7.2] - 2025-11-06

### Changed

- Running without arguments launches setup wizard
- Profile-aware next steps

### Fixed

- Quilt stack detection without 'quilt' in name
- CLI argument parsing for help/version

## [0.7.1] - 2025-11-04

### Fixed

- `sync-secrets` regression - preserves resolved credentials
- Python secrets resolver accepts both naming conventions

## [0.7.0] - 2025-11-04

### BREAKING CHANGES

Configuration architecture redesigned. See [MIGRATION.md](./MIGRATION.md).

- Config moved: `default.json` → `default/config.json`
- Deployment tracking: shared `deploy.json` → per-profile `{profile}/deployments.json`
- Profile/stage now independent

### Added

- Profile inheritance with `_inherits`
- Deployment history per profile
- Profile management commands

## [0.6.3] - 2025-11-04

### Added

- `npm run test:prod` for production testing (#176)
- `npm run test:dev` for development testing
- Deployment tracking in `~/.config/benchling-webhook/deploy.json`

## [0.6.2] - 2025-11-03

### Changed

- Setup wizard optionally deploys automatically
- Simplified README focused on golden path

## [0.6.1] - 2025-11-03

### Added

- NPX setup wizard (#182)
- Canvas footer with version info

## [0.6.0] - 2025-11-03

### Added

- XDG Configuration Management (#156)
  - Config in `~/.config/benchling-webhook/`
  - Interactive setup wizard
  - Automatic Quilt catalog inference
- Unified test workflow (`test`, `test:local`, `test:remote`)

### Changed

- Configuration model - XDG single source of truth
- npm script reorganization (#175)

## [0.5.4] - 2025-10-30

### Added

- Package naming uses DisplayID (e.g., `PRT001`)
- Upload URL improvements with `?action=revisePackage`
- Development deployment workflow

### Fixed

- WebhookAllowList parameter handling
- QUEUE_ARN migration completed

## [0.5.3] - 2025-10-30

### Changed

- **BREAKING**: Replaced QUEUE_URL with QUEUE_ARN

## [0.5.2] - 2025-10-29

### Added

- Runtime configuration via CloudFormation parameters
- Python tests in npm workflow

### Changed

- Streamlined configuration and CLI output

### Fixed

- Critical deployment failures - missing env vars and secrets

## [0.5.1] - 2025-10-29

### Added

- `manifest` command for Benchling app manifests
- Auto-detect catalog from quilt3 config

## [0.5.0] - 2025-10-29

### Added

- CLI support for npx execution
- Interactive setup with `npx @quiltdata/benchling-webhook init`

## [0.4.14] - 2025-10-29

### Added

- OIDC authentication for npm publishing (#137)

### Changed

- NPM publish workflow - publishes compiled JS

## Earlier versions

See git history for versions 0.1.0-0.4.13
