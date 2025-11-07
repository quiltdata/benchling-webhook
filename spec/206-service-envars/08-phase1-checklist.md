# Phase 1 Checklist: Service Environment Variables Implementation

**Issue**: #206 - Service envars

**Branch**: `206-service-envars`

**Date**: 2025-11-06

**Status**: IMPLEMENTATION TRACKING

## Overview

This checklist tracks the detailed implementation of explicit service environment variables, following the episodes defined in `07-phase1-episodes.md`.

**Progress**: 0/10 episodes complete

---

## Episode 1: Update Type Definitions

**Goal**: Make `stackArn` optional in `QuiltConfig` interface

### Tasks

- [ ] Write failing tests for optional `stackArn`
- [ ] Update `QuiltConfig` interface in `lib/types/config.ts`:
  - [ ] Change `stackArn: string` to `stackArn?: string`
  - [ ] Add JSDoc comment explaining deployment-time usage
  - [ ] Add JSDoc comments for all existing fields
  - [ ] Add optional `icebergDatabase?: string` field
  - [ ] Document field purpose and example values
- [ ] Run tests: `npm run test:ts`
- [ ] Verify TypeScript compilation: `npm run build:typecheck`
- [ ] Fix IDE diagnostics
- [ ] Commit: `feat: make QuiltConfig.stackArn optional and add icebergDatabase`
- [ ] Push to branch

**Test Coverage Requirements**:
- Config type validation tests

**Success Criteria**:
- [x] TypeScript compilation succeeds
- [ ] No errors in dependent files
- [ ] All tests pass
- [ ] Documentation clear

---

## Episode 2: Create Service Resolver Module

**Goal**: Implement service resolution from CloudFormation stack outputs

### Tasks

#### Test Creation (TDD Red)

- [ ] Create `tests/lib/utils/service-resolver.test.ts`
- [ ] Write test: "resolves all required services from stack outputs"
- [ ] Write test: "normalizes catalog URL from Catalog output"
- [ ] Write test: "normalizes catalog URL from CatalogDomain output"
- [ ] Write test: "extracts hostname from ApiGatewayEndpoint"
- [ ] Write test: "removes protocol and trailing slash from catalog URL"
- [ ] Write test: "handles optional Iceberg database present"
- [ ] Write test: "handles optional Iceberg database missing"
- [ ] Write test: "throws error for missing PackagerQueueUrl"
- [ ] Write test: "throws error for missing UserAthenaDatabaseName"
- [ ] Write test: "throws error for missing catalog URL"
- [ ] Write test: "validates SQS queue URL format"
- [ ] Write test: "supports alternative output names (QueueUrl, UserBucket)"
- [ ] Run tests (should fail): `npm run test:ts`

#### Implementation (TDD Green)

- [ ] Create `lib/utils/service-resolver.ts`
- [ ] Define `ResolvedServices` interface
- [ ] Define `ServiceResolverOptions` interface
- [ ] Define `ParsedStackArn` interface (or import from config-resolver)
- [ ] Implement `parseStackArn()` function
- [ ] Implement `normalizeCatalogUrl()` helper function
- [ ] Implement `validateQueueUrl()` helper function
- [ ] Implement `extractStackOutputs()` helper function
- [ ] Implement main `resolveQuiltServices()` function:
  - [ ] Parse stack ARN
  - [ ] Create CloudFormation client (or use mock)
  - [ ] Query stack outputs
  - [ ] Extract PackagerQueueUrl (with fallback to QueueUrl)
  - [ ] Extract UserAthenaDatabaseName (with fallback)
  - [ ] Extract and normalize catalog URL
  - [ ] Extract optional IcebergDatabase
  - [ ] Extract optional package bucket
  - [ ] Validate required outputs
  - [ ] Validate URL formats
  - [ ] Return ResolvedServices object
- [ ] Add error handling with descriptive messages
- [ ] Add JSDoc comments for all exported functions
- [ ] Run tests (should pass): `npm run test:ts`

#### Refactoring (TDD Refactor)

- [ ] Extract common patterns
- [ ] Improve error messages with suggestions
- [ ] Add usage examples in JSDoc
- [ ] Check test coverage: `npm run test:ts -- --coverage`
- [ ] Ensure coverage ≥85%
- [ ] Fix IDE diagnostics
- [ ] Run linter: `npm run lint`

#### Validation

- [ ] All tests pass
- [ ] Coverage ≥85%
- [ ] Error messages clear and actionable
- [ ] Handles all CloudFormation output variations
- [ ] TypeScript compilation succeeds

#### Commit

- [ ] Commit: `feat: add service resolver for CloudFormation stack outputs`
- [ ] Push to branch

**Test Coverage Requirements**:
- All resolver functions
- All error cases
- All output format variations
- URL normalization logic

---

## Episode 3: Enhance Deployment Command

**Goal**: Integrate service resolver into deployment flow

### Tasks

#### Test Creation (TDD Red)

- [ ] Update `tests/bin/commands/deploy.test.ts` (or create if missing)
- [ ] Write test: "resolves services before CDK deployment"
- [ ] Write test: "displays resolved services in deployment plan"
- [ ] Write test: "passes resolved services as CloudFormation parameters"
- [ ] Write test: "handles service resolution errors gracefully"
- [ ] Write test: "aborts deployment on resolution failure"
- [ ] Write test: "shows helpful error message for missing outputs"
- [ ] Run tests (should fail): `npm run test:ts`

#### Implementation (TDD Green)

- [ ] Open `bin/commands/deploy.ts`
- [ ] Import `resolveQuiltServices` from service-resolver
- [ ] Import `ResolvedServices` type
- [ ] Add service resolution step after validation (around line 180):
  - [ ] Add spinner: "Resolving Quilt services from CloudFormation..."
  - [ ] Call `resolveQuiltServices({ stackArn, region })`
  - [ ] Handle success: spinner.succeed()
  - [ ] Handle errors with try/catch
  - [ ] Display error and suggestions on failure
  - [ ] Exit with code 1 on failure
- [ ] Update deployment plan display (around line 280):
  - [ ] Add "Resolved Services:" section
  - [ ] Display packagerQueueUrl
  - [ ] Display athenaUserDatabase
  - [ ] Display quiltWebHost
  - [ ] Display icebergDatabase (if present)
- [ ] Update CloudFormation parameters (around line 327):
  - [ ] Add `PackagerQueueUrl=${services.packagerQueueUrl}`
  - [ ] Add `AthenaUserDatabase=${services.athenaUserDatabase}`
  - [ ] Add `QuiltWebHost=${services.quiltWebHost}`
  - [ ] Add `IcebergDatabase=${services.icebergDatabase || ""}`
  - [ ] Remove or update deprecated parameters
- [ ] Run tests (should pass): `npm run test:ts`

#### Refactoring (TDD Refactor)

- [ ] Extract deployment plan formatting to helper function
- [ ] Improve error message formatting
- [ ] Add JSDoc comments for new logic
- [ ] Fix IDE diagnostics
- [ ] Run linter: `npm run lint`

#### Validation

- [ ] All tests pass
- [ ] Services resolved before deployment
- [ ] Deployment plan shows all services
- [ ] Errors handled gracefully with helpful messages
- [ ] TypeScript compilation succeeds

#### Commit

- [ ] Commit: `feat: integrate service resolution into deployment command`
- [ ] Push to branch

**Test Coverage Requirements**:
- Service resolution integration
- Error handling paths
- Parameter passing logic

---

## Episode 4: Update CDK Stack Parameters

**Goal**: Add new CloudFormation parameters for services

### Tasks

#### Test Creation (TDD Red)

- [ ] Update `tests/lib/benchling-webhook-stack.test.ts` (or create)
- [ ] Write test: "creates PackagerQueueUrl parameter"
- [ ] Write test: "creates AthenaUserDatabase parameter"
- [ ] Write test: "creates QuiltWebHost parameter"
- [ ] Write test: "creates IcebergDatabase parameter with empty default"
- [ ] Write test: "renames BenchlingSecretARN parameter"
- [ ] Write test: "passes service parameters to FargateService"
- [ ] Write test: "QuiltStackARN parameter removed or deprecated"
- [ ] Run tests (should fail): `npm run test:ts`

#### Implementation (TDD Green)

- [ ] Open `lib/benchling-webhook-stack.ts`
- [ ] Add new CloudFormation parameters (after line 58):
  - [ ] `PackagerQueueUrl` parameter (String, required, no default)
  - [ ] `AthenaUserDatabase` parameter (String, required, no default)
  - [ ] `QuiltWebHost` parameter (String, required, no default)
  - [ ] `IcebergDatabase` parameter (String, optional, default "")
- [ ] Rename `BenchlingSecretARN` parameter for consistency
- [ ] Comment out or remove `QuiltStackARN` parameter (line 58-62)
- [ ] Update FargateService instantiation (around line 128):
  - [ ] Add `packagerQueueUrl: packagerQueueUrlParam.valueAsString`
  - [ ] Add `athenaUserDatabase: athenaUserDatabaseParam.valueAsString`
  - [ ] Add `quiltWebHost: quiltWebHostParam.valueAsString`
  - [ ] Add `icebergDatabase: icebergDatabaseParam.valueAsString`
  - [ ] Update `benchlingSecret` to `benchlingSecretArn`
  - [ ] Remove `stackArn` parameter
- [ ] Update parameter descriptions for clarity
- [ ] Run tests (should pass): `npm run test:ts`

#### Refactoring (TDD Refactor)

- [ ] Group related parameters together
- [ ] Improve parameter descriptions
- [ ] Add comments explaining parameter usage
- [ ] Fix IDE diagnostics
- [ ] Run linter: `npm run lint`

#### Validation

- [ ] CDK synthesis succeeds: `npm run build:synth`
- [ ] All parameters present in CloudFormation template
- [ ] Parameters correctly typed
- [ ] Default values appropriate
- [ ] All tests pass

#### Commit

- [ ] Commit: `feat: add CloudFormation parameters for explicit services`
- [ ] Push to branch

**Test Coverage Requirements**:
- Parameter creation
- Parameter passing to constructs
- CDK synthesis validation

---

## Episode 5: Update Fargate Service - Props and Environment Variables

**Goal**: Update props interface and create explicit environment variables

### Tasks

#### Test Creation (TDD Red)

- [ ] Update `tests/lib/fargate-service.test.ts` (or create)
- [ ] Write test: "accepts service-specific props"
- [ ] Write test: "sets PACKAGER_SQS_URL environment variable"
- [ ] Write test: "sets ATHENA_USER_DATABASE environment variable"
- [ ] Write test: "sets QUILT_WEB_HOST environment variable"
- [ ] Write test: "sets ICEBERG_DATABASE environment variable"
- [ ] Write test: "renames BENCHLING_SECRET_ARN environment variable"
- [ ] Write test: "does not set QuiltStackARN environment variable"
- [ ] Run tests (should fail): `npm run test:ts`

#### Implementation (TDD Green)

- [ ] Open `lib/fargate-service.ts`
- [ ] Update `FargateServiceProps` interface (around line 19):
  - [ ] Add `readonly packagerQueueUrl: string`
  - [ ] Add `readonly athenaUserDatabase: string`
  - [ ] Add `readonly quiltWebHost: string`
  - [ ] Add `readonly icebergDatabase: string`
  - [ ] Add `readonly benchlingSecretArn: string`
  - [ ] Remove `readonly stackArn: string` (or comment out)
  - [ ] Remove `readonly benchlingSecret: string`
- [ ] Update environment variables object (around line 215):
  - [ ] Add `PACKAGER_SQS_URL: props.packagerQueueUrl`
  - [ ] Add `ATHENA_USER_DATABASE: props.athenaUserDatabase`
  - [ ] Add `QUILT_WEB_HOST: props.quiltWebHost`
  - [ ] Add `ICEBERG_DATABASE: props.icebergDatabase`
  - [ ] Rename `BenchlingSecret` to `BENCHLING_SECRET_ARN: props.benchlingSecretArn`
  - [ ] Remove `QuiltStackARN: props.stackArn`
- [ ] Update environment variable comments for clarity
- [ ] Run tests (should pass): `npm run test:ts`

#### Refactoring (TDD Refactor)

- [ ] Group related environment variables
- [ ] Add section comments (AWS, Quilt, Benchling, Application)
- [ ] Consistent naming conventions
- [ ] Fix IDE diagnostics
- [ ] Run linter: `npm run lint`

#### Validation

- [ ] All tests pass
- [ ] Props interface updated correctly
- [ ] Environment variables set correctly
- [ ] No TypeScript compilation errors

#### Commit

- [ ] Commit: `feat: update Fargate service props and environment variables`
- [ ] Push to branch

**Test Coverage Requirements**:
- Props interface
- Environment variable creation
- All new env vars present

---

## Episode 6: Update Fargate Service - IAM Permissions

**Goal**: Remove CloudFormation permissions and use explicit resource ARNs

### Tasks

#### Test Creation (TDD Red)

- [ ] Update `tests/lib/fargate-service.test.ts`
- [ ] Write test: "does not grant CloudFormation permissions"
- [ ] Write test: "grants SQS permissions with explicit queue ARN"
- [ ] Write test: "extracts queue ARN from URL correctly"
- [ ] Write test: "grants Glue permissions with explicit database ARN"
- [ ] Write test: "grants Athena database permissions"
- [ ] Write test: "grants Iceberg permissions when database provided"
- [ ] Write test: "does not grant Iceberg permissions when database empty"
- [ ] Run tests (should fail): `npm run test:ts`

#### Implementation (TDD Green)

- [ ] Open `lib/fargate-service.ts`
- [ ] Remove CloudFormation IAM permissions (lines 85-93):
  - [ ] Delete `cloudformation:DescribeStacks` policy
  - [ ] Delete `cloudformation:DescribeStackResources` policy
- [ ] Add helper function `queueArnFromUrl()`:
  ```typescript
  function queueArnFromUrl(url: string, region: string, account: string): string {
    const match = url.match(/\/([^/]+)$/);
    if (!match) throw new Error(`Invalid SQS URL: ${url}`);
    const queueName = match[1];
    return `arn:aws:sqs:${region}:${account}:${queueName}`;
  }
  ```
- [ ] Update SQS permissions (around line 140):
  - [ ] Extract queue ARN from `props.packagerQueueUrl`
  - [ ] Use explicit queue ARN in policy resource
  - [ ] Keep actions unchanged
- [ ] Update Glue permissions (around line 153):
  - [ ] Use `props.athenaUserDatabase` for database ARN
  - [ ] Use explicit database ARN instead of wildcard
  - [ ] Update table ARN to use specific database
- [ ] Add conditional Iceberg permissions:
  ```typescript
  if (props.icebergDatabase && props.icebergDatabase.trim() !== "") {
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"],
        resources: [
          `arn:aws:glue:${region}:${account}:database/${props.icebergDatabase}`,
          `arn:aws:glue:${region}:${account}:table/${props.icebergDatabase}/*`,
        ],
      }),
    );
  }
  ```
- [ ] Update Secrets Manager permissions to use `props.benchlingSecretArn`
- [ ] Run tests (should pass): `npm run test:ts`

#### Refactoring (TDD Refactor)

- [ ] Extract ARN building helpers if repeated
- [ ] Add comments explaining permission scope
- [ ] Consistent permission patterns
- [ ] Fix IDE diagnostics
- [ ] Run linter: `npm run lint`

#### Validation

- [ ] All tests pass
- [ ] No CloudFormation permissions in generated policy
- [ ] All permissions use explicit resource ARNs
- [ ] Conditional Iceberg permissions work correctly
- [ ] IAM policies valid (check CDK synth output)

#### Commit

- [ ] Commit: `feat: remove CloudFormation permissions and use explicit resource ARNs`
- [ ] Push to branch

**Test Coverage Requirements**:
- IAM permission policies
- Queue ARN extraction
- Conditional permission logic
- All permission types covered

---

## Episode 7: Remove Deprecated ConfigResolver

**Goal**: Delete config-resolver.ts and clean up imports

### Tasks

- [ ] Search codebase for imports of `config-resolver.ts`:
  ```bash
  grep -r "from.*config-resolver" --include="*.ts"
  ```
- [ ] Verify no remaining imports (should be none after previous episodes)
- [ ] Delete `lib/utils/config-resolver.ts` (440 lines removed)
- [ ] Delete `tests/lib/utils/config-resolver.test.ts` (if exists)
- [ ] Search for any remaining references to `ConfigResolver` class
- [ ] Update any comments mentioning config-resolver
- [ ] Run TypeScript compilation: `npm run build:typecheck`
- [ ] Run all tests: `npm run test:ts`
- [ ] Fix any remaining issues
- [ ] Run linter: `npm run lint`
- [ ] Fix IDE diagnostics

#### Validation

- [ ] File deleted successfully
- [ ] No import errors
- [ ] TypeScript compilation succeeds
- [ ] All tests pass
- [ ] No references to old code remain

#### Commit

- [ ] Commit: `refactor: remove deprecated ConfigResolver (~440 lines)`
- [ ] Push to branch

**Test Coverage Requirements**:
- N/A (deletion)

---

## Episode 8: Update Test Infrastructure

**Goal**: Update tests and local development to use explicit environment variables

### Tasks

#### Docker Compose Updates

- [ ] Open `docker/docker-compose.yml`
- [ ] Update `app-dev` service environment:
  - [ ] Add `PACKAGER_SQS_URL=${PACKAGER_SQS_URL}`
  - [ ] Add `ATHENA_USER_DATABASE=${ATHENA_USER_DATABASE}`
  - [ ] Add `QUILT_WEB_HOST=${QUILT_WEB_HOST}`
  - [ ] Add `ICEBERG_DATABASE=${ICEBERG_DATABASE:-}`
  - [ ] Update `BENCHLING_SECRET_ARN=${BENCHLING_SECRET_ARN}`
  - [ ] Remove `QuiltStackARN`
- [ ] Update `app` service (production) similarly
- [ ] Test Docker Compose: `docker-compose config` (validates syntax)

#### Local Development Scripts

- [ ] Update `docker/scripts/run_local.py`:
  - [ ] Load explicit env vars from profile config
  - [ ] Set `PACKAGER_SQS_URL` from profile
  - [ ] Set `ATHENA_USER_DATABASE` from profile
  - [ ] Set `QUILT_WEB_HOST` from profile
  - [ ] Set `ICEBERG_DATABASE` from profile (if present)
  - [ ] Update `BENCHLING_SECRET_ARN`
  - [ ] Remove `QuiltStackARN` loading
- [ ] Create `.env.example` file with new variables:
  ```bash
  # Quilt Services
  PACKAGER_SQS_URL=https://sqs.us-east-1.amazonaws.com/123456789012/packager-queue
  ATHENA_USER_DATABASE=quilt_catalog
  QUILT_WEB_HOST=quilt.example.com
  ICEBERG_DATABASE=

  # Benchling Configuration
  BENCHLING_SECRET_ARN=arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-abc123
  BENCHLING_TENANT=my-company
  PACKAGE_BUCKET=benchling-packages
  PACKAGE_PREFIX=benchling
  PACKAGE_METADATA_KEY=experiment_id

  # Application
  AWS_REGION=us-east-1
  LOG_LEVEL=INFO
  ```

#### Integration Test Updates

- [ ] Update integration test configurations
- [ ] Update test data/fixtures to use new env vars
- [ ] Remove CloudFormation mocking where no longer needed
- [ ] Add service connectivity validation tests

#### Testing

- [ ] Test Docker Compose: `make run-dev`
- [ ] Test local server: `make run-local PROFILE=dev`
- [ ] Test integration: `make test-integration`
- [ ] Fix any issues discovered
- [ ] Run linter: `make -C docker lint`

#### Validation

- [ ] Docker Compose works with new env vars
- [ ] Local development server works
- [ ] Integration tests pass
- [ ] All test scripts work

#### Commit

- [ ] Commit: `test: update test infrastructure for explicit environment variables`
- [ ] Push to branch

**Test Coverage Requirements**:
- Integration tests
- Local development scripts
- Docker Compose configuration

---

## Episode 9: Update Documentation

**Goal**: Create migration guide and update all documentation

### Tasks

#### Migration Guide

- [ ] Create `spec/206-service-envars/MIGRATION.md`
- [ ] Write "What Changed" section:
  - [ ] Explain stack ARN removal
  - [ ] Explain explicit environment variables
  - [ ] Explain breaking change
- [ ] Write "Why This Change" section:
  - [ ] Performance improvement
  - [ ] Security enhancement
  - [ ] Operational transparency
- [ ] Write "Before and After" section with examples:
  - [ ] Show old configuration
  - [ ] Show new configuration
  - [ ] Show old deployment
  - [ ] Show new deployment
- [ ] Write "Migration Steps" section:
  - [ ] Step 1: Update to v1.0.0
  - [ ] Step 2: Run setup wizard (optional)
  - [ ] Step 3: Redeploy with new version
  - [ ] Step 4: Verify deployment
- [ ] Write "Common Issues" section:
  - [ ] Missing stack outputs
  - [ ] Service resolution failures
  - [ ] Permission errors
- [ ] Write "Rollback Procedure" section
- [ ] Add troubleshooting tips

#### Environment Variables Documentation

- [ ] Create or update `docs/ENVIRONMENT_VARIABLES.md`
- [ ] Document each container environment variable:
  - [ ] Name, purpose, format, required/optional, example
  - [ ] `PACKAGER_SQS_URL`
  - [ ] `ATHENA_USER_DATABASE`
  - [ ] `QUILT_WEB_HOST`
  - [ ] `ICEBERG_DATABASE`
  - [ ] `BENCHLING_SECRET_ARN`
  - [ ] All other env vars
- [ ] Add validation rules section
- [ ] Add examples section

#### README Updates

- [ ] Update `README.md`:
  - [ ] Update version references
  - [ ] Add breaking change notice at top
  - [ ] Update "Quick Start" section
  - [ ] Update configuration examples
  - [ ] Add link to migration guide
  - [ ] Update prerequisite section if needed

#### CHANGELOG Updates

- [ ] Update `CHANGELOG.md`:
  - [ ] Add `## [1.0.0] - 2025-11-06` section
  - [ ] Add "Breaking Changes" subsection:
    - [ ] Stack ARN no longer passed to container
    - [ ] Explicit service environment variables required
    - [ ] ConfigResolver removed
    - [ ] Profile configuration changes
  - [ ] Add "Added" subsection:
    - [ ] Service resolver module
    - [ ] Explicit environment variables
    - [ ] Iceberg database support
  - [ ] Add "Removed" subsection:
    - [ ] ConfigResolver class
    - [ ] CloudFormation permissions
    - [ ] QuiltStackARN environment variable
  - [ ] Add "Changed" subsection:
    - [ ] Deployment command now resolves services
    - [ ] IAM permissions use explicit ARNs
    - [ ] Improved startup performance
  - [ ] Add "Migration" link to guide

#### Validation

- [ ] All documentation accurate
- [ ] Examples work and tested
- [ ] Links valid and working
- [ ] No typos or formatting issues
- [ ] Clear and easy to follow

#### Commit

- [ ] Commit: `docs: add migration guide and update documentation for v1.0.0`
- [ ] Push to branch

**Test Coverage Requirements**:
- N/A (documentation)

---

## Episode 10: Version Bump and Final Integration

**Goal**: Bump version, run full test suite, validate end-to-end integration

### Tasks

#### Version Management

- [ ] Update `package.json` version to `1.0.0`
- [ ] Verify version consistent across files
- [ ] Update version references in code if needed

#### Test Suite Execution

- [ ] Run TypeScript tests: `npm run test:ts`
- [ ] Run Python tests (if applicable): `make -C docker test-unit`
- [ ] Run linter: `make lint`
- [ ] Check test coverage: `npm run test:ts -- --coverage`
- [ ] Verify coverage ≥85%
- [ ] Fix any test failures
- [ ] Fix any linting issues
- [ ] Fix all IDE diagnostics

#### Local Integration Tests

- [ ] Test local server: `make test-local PROFILE=dev`
- [ ] Verify all tests pass
- [ ] Check server logs for errors
- [ ] Verify no CloudFormation API calls in logs

#### CDK Synthesis

- [ ] Run CDK synth: `npm run build:synth`
- [ ] Review generated CloudFormation template
- [ ] Verify all parameters present
- [ ] Verify environment variables in task definition
- [ ] Verify IAM policies correct

#### Dev Deployment

- [ ] Deploy to dev environment:
  ```bash
  npm run deploy:dev -- --profile dev --yes
  ```
- [ ] Monitor deployment progress
- [ ] Wait for deployment to complete
- [ ] Check CloudFormation events for errors

#### Container Validation

- [ ] Check ECS service status (should be healthy)
- [ ] View CloudWatch logs: `npm run logs -- --profile dev --type=ecs --tail=100`
- [ ] Verify no CloudFormation API calls in startup logs
- [ ] Verify environment variables logged correctly
- [ ] Check for any error messages

#### Health Check Validation

- [ ] Test health endpoint:
  ```bash
  DEV_URL=$(jq -r '.active.dev.endpoint' ~/.config/benchling-webhook/dev/deployments.json)
  curl "$DEV_URL/health" | jq
  ```
- [ ] Verify health check passes
- [ ] Test ready endpoint: `curl "$DEV_URL/health/ready" | jq`
- [ ] Verify all services accessible

#### Webhook Integration Test

- [ ] Test webhook processing (if test entry ID available):
  ```bash
  make test-deployed-dev PROFILE=dev
  ```
- [ ] Verify webhook received and processed
- [ ] Check SQS queue for message
- [ ] Verify package creation (if applicable)

#### Performance Validation

- [ ] Note container startup time from logs
- [ ] Compare with baseline (target: <5 seconds, baseline: ~7 seconds)
- [ ] Verify ≥20% improvement
- [ ] Document actual performance

#### Final Checks

- [ ] Review all commits for quality
- [ ] Verify conventional commit messages
- [ ] Check git diff for any unintended changes
- [ ] Verify no sensitive data in commits
- [ ] Verify no temporary files committed

#### Documentation Review

- [ ] Review all updated documentation
- [ ] Verify migration guide accuracy
- [ ] Test documentation examples
- [ ] Check for broken links

#### Commit and Tag

- [ ] Final commit: `chore: bump version to 1.0.0 for breaking change release`
- [ ] Push to branch
- [ ] Create git tag: `git tag v1.0.0`
- [ ] Push tag: `git push origin v1.0.0` (after PR merge)

#### Validation Checklist

- [ ] Version bumped to 1.0.0
- [ ] All tests pass (unit, integration, E2E)
- [ ] Test coverage ≥85%
- [ ] Linting passes
- [ ] CDK synthesis succeeds
- [ ] Dev deployment successful
- [ ] Container starts without CloudFormation API calls
- [ ] Health checks pass
- [ ] Webhook processing works
- [ ] Performance targets met
- [ ] Documentation complete
- [ ] No regressions identified

---

## Post-Implementation Tasks

### PR Preparation

- [ ] Create pull request against `main` branch
- [ ] Fill in PR template with:
  - [ ] Issue reference (#206)
  - [ ] Summary of changes
  - [ ] Breaking changes section
  - [ ] Migration guide link
  - [ ] Testing performed
  - [ ] Performance results
- [ ] Request code review
- [ ] Address review comments
- [ ] Update PR based on feedback

### Deployment Checklist

- [ ] Merge PR to main branch
- [ ] Tag release: `v1.0.0`
- [ ] Publish npm package (if applicable)
- [ ] Deploy to production:
  ```bash
  npm run deploy:prod -- --yes
  ```
- [ ] Validate production deployment
- [ ] Monitor for issues

### Communication

- [ ] Announce breaking change to users
- [ ] Provide migration guidance
- [ ] Update documentation site (if applicable)
- [ ] Post release notes
- [ ] Monitor support channels for questions

### Monitoring

- [ ] Watch CloudWatch metrics for anomalies
- [ ] Monitor error rates
- [ ] Track deployment success rate
- [ ] Review user feedback
- [ ] Address any issues promptly

---

## Quality Gates

All quality gates must pass before marking implementation complete:

### Code Quality

- [ ] All linting passes (`make lint`)
- [ ] No TypeScript errors
- [ ] No Python errors (if applicable)
- [ ] Code review approved
- [ ] All IDE diagnostics fixed

### Testing

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] E2E tests pass
- [ ] Coverage ≥85%
- [ ] Manual testing complete

### Documentation

- [ ] README updated
- [ ] CHANGELOG updated
- [ ] Migration guide complete
- [ ] Environment variables documented
- [ ] All examples tested

### Security

- [ ] IAM permissions reviewed
- [ ] No CloudFormation permissions in task role
- [ ] Secrets handled correctly
- [ ] No sensitive data in logs
- [ ] Security scan passed (if applicable)

### Performance

- [ ] Startup time measured and improved
- [ ] No performance regressions
- [ ] Performance targets met (≥20% improvement)
- [ ] Load testing passed (if applicable)

### Deployment

- [ ] Dev deployment successful
- [ ] Prod deployment successful (or staged)
- [ ] Health checks pass
- [ ] Monitoring shows no issues
- [ ] Rollback procedure tested (optional)

---

## Issue Resolution

Upon completion of all tasks and quality gates:

- [ ] Update issue #206 with implementation summary
- [ ] Link to merged PR
- [ ] Document any deviations from original plan
- [ ] Note any follow-up work needed
- [ ] Close issue #206

---

## Notes

**Implementation Progress**: Track completion by checking boxes as tasks are completed.

**Blockers**: Document any blockers or issues encountered during implementation.

**Decisions**: Record any implementation decisions that deviate from the design.

**Follow-up**: List any follow-up work identified during implementation.
