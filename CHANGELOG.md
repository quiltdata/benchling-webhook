<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **CLI support for npx execution** - Deploy directly without cloning repository (#TBD)
  - Interactive `init` command for configuration setup
  - `validate` command for pre-deployment validation
  - `deploy` command with enhanced UX and progress indicators
  - Automatic configuration inference from Quilt catalog
  - Support for `.env` files, environment variables, and CLI flags with priority ordering
  - Clear, actionable error messages with solution guidance
  - Beautiful terminal output with colors, spinners, and boxes
- New utilities in `lib/utils/config.ts` for configuration loading and validation
- Comprehensive help text for all CLI commands

### Changed

- **Refactored deployment logic** to support both CLI and programmatic usage
  - Extracted pure functions: `checkCdkBootstrap()`, `inferConfiguration()`, `createStack()`
  - Maintained backwards compatibility with existing `npm run cdk` workflow
- Updated `package.json`:
  - Added `bin` entry pointing to `./dist/bin/cli.js`
  - Added CLI-related keywords (`cli`, `npx`)
  - Updated description to mention npx support
  - Added `env.template` to published files
  - Updated build scripts to copy JavaScript files
- Updated `tsconfig.json` for proper CLI compilation with CommonJS module system
- Configuration loading now supports priority: CLI options > environment variables > .env file > inferred values

### Dependencies

- Added CLI dependencies: `commander@^14.0.2`, `dotenv-expand@^12.0.3`, `chalk@^4.1.2`, `ora@^5.4.1`, `enquirer@^2.4.1`, `boxen@^5.1.2`

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
