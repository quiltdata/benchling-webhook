# Checklist: Bucketless Mode Implementation, Tests, and Test Stack Deployment

**Branch**: a10-bucketless
**Date**: 2026-07-03
**References**: `01-bucketless-req.md`, `02-bucketless-audit.md`
**Scope**: Enumerated tasks only. No code or implementation snippets.

## Checklist Instructions

- Use `[x]` to mark completed tasks.
- Use `[ ]` for pending tasks.
- Keep commits focused by episode.
- Run `npm test` before any commit intended for review.
- Fix IDE diagnostics after edits.
- Use project npm scripts rather than raw tool commands when an npm script exists.
- Use `--` when passing args to npm scripts.

## Pre-Implementation Setup

### Repository State

- [ ] Confirm branch is `a10-bucketless`.
- [ ] Confirm branch is based on current `main`.
- [ ] Confirm working tree contains only intended spec changes before implementation begins.
- [ ] Read `spec/a10-bucketless/01-bucketless-req.md`.
- [ ] Read `spec/a10-bucketless/02-bucketless-audit.md`.
- [ ] Review current npm scripts with `npm run`.
- [ ] Install dependencies if needed with `npm install`.

### Baseline Validation

- [ ] Run `npm run build:typecheck`.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run test:python`.
- [ ] Run `npm test` if the targeted baseline commands pass.
- [ ] Record any pre-existing failures before making code changes.
- [ ] Confirm IDE diagnostics are clear or record pre-existing diagnostics.

## Episode 1: Make Bucket Optional in User Configuration

### Implementation Tasks

- [ ] Update user-facing config types so package bucket can be absent.
- [ ] Update profile schema validation so `packages.bucket` is not globally required.
- [ ] Preserve validation for malformed bucket values when a bucket is provided.
- [ ] Update setup wizard parameter collection so non-interactive setup can intentionally produce bucketless config.
- [ ] Update profile config builders so new and existing profile flows can represent bucketless mode.
- [ ] Update setup validation so S3 bucket access validation only applies when a bucket is configured.
- [ ] Update legacy/general configuration validators that still require `quiltUserBucket`.
- [ ] Update user-facing setup messages to distinguish bucket-configured mode from bucketless mode.

### Unit Tests

- [ ] Add TypeScript tests for valid bucketless profile config.
- [ ] Add TypeScript tests that a provided valid bucket still passes validation.
- [ ] Add TypeScript tests that a provided invalid bucket still fails or warns according to existing conventions.
- [ ] Add setup wizard tests for non-interactive bucketless setup.
- [ ] Add setup wizard tests proving existing bucket-configured setup remains unchanged.
- [ ] Update existing config fixture tests that assume `packages.bucket` is mandatory.

### Quality Gates

- [ ] Run `npm run build:typecheck`.
- [ ] Run affected TypeScript tests.
- [ ] Confirm IDE diagnostics are clear.

## Episode 2: Make Bucket Optional in Secrets and Runtime Config

### Implementation Tasks

- [ ] Update secret creation and sync flows so `user_bucket` can be absent for bucketless profiles.
- [ ] Update secret examples and validation messages to distinguish required Benchling credentials from optional package bucket.
- [ ] Update Python secret data models so bucketless secrets are valid.
- [ ] Update Python secret parsing so missing bucket does not fail startup.
- [ ] Update runtime config application so `config.s3_bucket_name` has a clear bucketless representation.
- [ ] Audit every direct read of `config.s3_bucket_name` and classify it as bucket-required, bucketless-aware, or unchanged.

### Unit Tests

- [ ] Add TypeScript tests for syncing a bucketless secret.
- [ ] Add TypeScript tests for syncing a bucket-configured secret.
- [ ] Add Python tests for parsing bucketless secrets.
- [ ] Add Python tests for parsing existing bucket-configured secrets.
- [ ] Add Python tests proving missing Benchling credentials still fail validation.
- [ ] Update secret resolver tests that assume `user_bucket` is always present.

### Quality Gates

- [ ] Run `npm run build:typecheck`.
- [ ] Run affected TypeScript secret/config tests.
- [ ] Run affected Python secret/config tests.
- [ ] Confirm IDE diagnostics are clear.

## Episode 3: Make CloudFormation and ECS Wiring Bucketless-Aware

### Implementation Tasks

- [ ] Update `PackageBucket` CloudFormation parameter behavior so an absent bucket is valid.
- [ ] Update CDK stack synthesis so bucketless mode does not create invalid bucket-specific IAM resources.
- [ ] Preserve bucket-specific permissions and environment behavior when a bucket is configured.
- [ ] Update ECS service props and task role behavior for both modes.
- [ ] Update deployment command parameter construction for bucketless profiles.
- [ ] Update deployment plan output so bucketless mode is explicit and not shown as a blank bucket.
- [ ] Confirm centralized ECR image configuration remains unchanged.

### Unit Tests

- [ ] Add CDK template tests for bucketless stack synthesis.
- [ ] Add CDK template tests for bucket-configured stack synthesis.
- [ ] Add ECS task role tests for bucketless permissions.
- [ ] Add ECS task role tests proving existing bucket-configured permissions remain available.
- [ ] Add deploy command tests for bucketless parameter handling.
- [ ] Update snapshot or assertion tests that assume `PackageBucket` is always populated.

### Quality Gates

- [ ] Run `npm run build:typecheck`.
- [ ] Run CDK and deployment-related TypeScript tests.
- [ ] Confirm synthesized templates do not contain invalid empty-bucket ARNs.
- [ ] Confirm IDE diagnostics are clear.

## Episode 4: Stop Bucketless Entry Events from Auto-Creating Packages

### Implementation Tasks

- [ ] Identify the authoritative runtime mode check for bucketless behavior.
- [ ] Update the entry-event processing path so bucketless mode does not enqueue automatic package creation for every notebook entry.
- [ ] Preserve canvas event behavior needed for user-visible canvas updates.
- [ ] Preserve bucket-configured entry-event behavior.
- [ ] Ensure skipped bucketless entry events produce clear operational feedback.
- [ ] Ensure skipped bucketless entry events are not reported as failures.
- [ ] Ensure unsupported event behavior remains unchanged.

### Unit Tests

- [ ] Add Python tests for `v2.entry.created` in bucketless mode.
- [ ] Add Python tests for `v2.entry.updated.fields` in bucketless mode.
- [ ] Add Python tests for `v2.entry.updated.reviewRecord` in bucketless mode.
- [ ] Add Python tests proving bucketless entry events do not enqueue packaging requests.
- [ ] Add Python tests proving bucket-configured entry events still enqueue packaging requests.
- [ ] Add Python tests for response body and logs or observable status for skipped bucketless package creation.
- [ ] Update packaging publisher and consumer tests if their assumptions about accepted work change.

### Quality Gates

- [ ] Run affected Python app and flexible-route tests.
- [ ] Run affected packaging publisher and consumer tests.
- [ ] Run `npm run test:python`.
- [ ] Confirm IDE diagnostics are clear.

## Episode 5: Make Linked-Package Lookup Search Across Accessible Buckets

### Implementation Tasks

- [ ] Identify the product-approved source of accessible buckets for runtime lookup.
- [ ] Update linked-package lookup so bucketless mode searches all accessible buckets.
- [ ] Preserve single-bucket linked-package lookup when a bucket is configured.
- [ ] Preserve enough bucket identity on each linked package result for URLs, browsing, and duplicate handling.
- [ ] Define observable behavior for no linked package found.
- [ ] Define observable behavior for lookup failure.
- [ ] Define observable behavior for duplicate linked packages across buckets.
- [ ] Ensure lookup feedback is understandable in Canvas and logs.

### Unit Tests

- [ ] Add Python tests for bucketless lookup across multiple accessible buckets.
- [ ] Add Python tests for no linked packages found in bucketless mode.
- [ ] Add Python tests for duplicate linked packages across buckets.
- [ ] Add Python tests for partial or total lookup failure.
- [ ] Add Python tests proving bucket-configured lookup remains scoped to the configured bucket.
- [ ] Add tests for package result objects preserving bucket identity.
- [ ] Update canvas tests that assume linked-package lookup uses only `config.s3_bucket_name`.

### Quality Gates

- [ ] Run affected package query tests.
- [ ] Run affected canvas tests.
- [ ] Run `npm run test:python`.
- [ ] Confirm IDE diagnostics are clear.

## Episode 6: Update Canvas Browsing, Sync Links, and Package Event Refresh

### Implementation Tasks

- [ ] Update primary canvas content for bucketless mode so it does not imply a default package exists when none does.
- [ ] Update footer and status text so bucketless mode is clear.
- [ ] Update linked-package browse interactions so the selected linked package's bucket is preserved.
- [ ] Update file browsing so linked packages in different buckets can be opened correctly.
- [ ] Update metadata browsing so linked packages in different buckets can be inspected correctly.
- [ ] Update sync links so they are only shown when the package destination is known.
- [ ] Reassess package revision event filtering for bucketless mode.
- [ ] Update package revision canvas refresh to use the event package bucket where appropriate.
- [ ] Preserve existing behavior for bucket-configured deployments.

### Unit Tests

- [ ] Add canvas rendering tests for bucketless mode with no linked packages.
- [ ] Add canvas rendering tests for bucketless mode with one linked package.
- [ ] Add canvas rendering tests for bucketless mode with linked packages in multiple buckets.
- [ ] Add browse-linked-package tests that include bucket identity.
- [ ] Add package file fetcher tests for linked packages outside the configured bucket.
- [ ] Add package event consumer tests for bucketless package events.
- [ ] Add package event refresh tests using event bucket identity.
- [ ] Update existing tests that assume browse button package name alone is sufficient.

### Quality Gates

- [ ] Run affected canvas, browse, package files, package event, and SQS consumer tests.
- [ ] Run `npm run test:python`.
- [ ] Confirm IDE diagnostics are clear.

## Episode 7: Update CLI, Docs, and User-Facing Guidance

### Implementation Tasks

- [ ] Update README setup instructions for bucket-configured and bucketless modes.
- [ ] Update secret-format documentation for optional bucket behavior.
- [ ] Update deployment plan wording for bucketless mode.
- [ ] Update validation command output for bucketless mode.
- [ ] Update local testing notes if setup commands differ for bucketless profiles.
- [ ] Update troubleshooting guidance for no linked package found.
- [ ] Update troubleshooting guidance for inaccessible buckets.
- [ ] Update troubleshooting guidance for duplicate linked packages.

### Documentation Checks

- [ ] Confirm docs do not say the bucket is universally required.
- [ ] Confirm docs state that bucketless mode does not auto-create packages for every notebook entry.
- [ ] Confirm docs state that bucketless mode searches accessible buckets for linked packages.
- [ ] Confirm docs explain that permissions define accessible buckets.
- [ ] Confirm docs preserve instructions for bucket-configured deployments.

### Quality Gates

- [ ] Run documentation-adjacent TypeScript tests if CLI output tests changed.
- [ ] Confirm IDE diagnostics are clear.

## Episode 8: Full Unit and Local Verification

### TypeScript Verification

- [ ] Run `npm run build:typecheck`.
- [ ] Run `npm run test:ts`.
- [ ] Run `npm run test:unit`.

### Python Verification

- [ ] Run `npm run test:python`.
- [ ] Run targeted Python tests for bucketless runtime behavior.

### Full Project Verification

- [ ] Run `npm test`.
- [ ] Fix all lint, typecheck, and test failures.
- [ ] Confirm IDE diagnostics are clear.
- [ ] Review `git diff` for unrelated changes.

### Local Container Verification

- [ ] Run `npm run test:local`.
- [ ] Verify bucket-configured local behavior still passes.
- [ ] Run the available local command or profile path for bucketless behavior.
- [ ] Verify bucketless local behavior does not auto-create packages for entry events.
- [ ] Verify bucketless local behavior can render linked-package lookup outcomes.

## Episode 9: Deploy a Testable Bucketless Stack

### Pre-Deployment Preparation

- [ ] Confirm the target profile for bucketless testing.
- [ ] Confirm the target stage is `dev`.
- [ ] Confirm required Benchling credentials are available in the profile or secret.
- [ ] Confirm Quilt catalog, database, queue, workgroup, and managed policies are available as needed.
- [ ] Confirm no bucket is configured for the bucketless test profile.
- [ ] Confirm expected accessible buckets for linked-package lookup.
- [ ] Confirm AWS account and region before deploying.

### Deployment

- [ ] Run setup or profile update for the bucketless test profile using project npm scripts.
- [ ] Run `npm run setup:sync-secrets -- --profile <bucketless-profile>` if secrets need syncing.
- [ ] Run `npm run deploy:dev -- --profile <bucketless-profile> --yes`.
- [ ] Confirm deployment uses the centralized ECR image.
- [ ] Confirm stack deploy succeeds.
- [ ] Confirm stack outputs include a testable webhook endpoint.
- [ ] Confirm deployed task starts successfully.

### Deployed Stack Tests

- [ ] Run `npm run test:dev -- --profile <bucketless-profile>` if compatible with the selected profile.
- [ ] Run deployed health-only test if full test suite requires bucket-configured assumptions.
- [ ] Send a Benchling entry event to the deployed bucketless stack.
- [ ] Verify the entry event does not auto-create a package.
- [ ] Verify logs show an expected bucketless skip or no-op outcome, not an error.
- [ ] Test a notebook entry with one linked package in an accessible bucket.
- [ ] Verify the linked package is found.
- [ ] Test a notebook entry with no linked package.
- [ ] Verify the no-linked-package outcome is clear.
- [ ] Test a duplicate linked-package case if feasible.
- [ ] Verify duplicate handling is clear and non-silent.
- [ ] Test package browsing for a linked package if Canvas access is available.

### Log and Diagnostics Review

- [ ] Check ECS logs with `npx ts-node scripts/check-logs.ts --profile <bucketless-profile> --type=ecs --tail=100`.
- [ ] Check API logs if webhook requests fail.
- [ ] Confirm no startup errors mention missing `user_bucket` as fatal.
- [ ] Confirm no invalid S3 ARN or empty bucket errors appear.
- [ ] Confirm linked-package lookup logs distinguish found, none found, duplicate, and lookup failure where applicable.

## Episode 10: Final Review and Handoff

### Final Quality Gates

- [ ] Run `npm test`.
- [ ] Run `npm run test:integration` if changes affect deployed-stack contracts.
- [ ] Run `npm run test:local` if runtime container behavior changed.
- [ ] Run `npm run test:dev` or equivalent deployed bucketless verification.
- [ ] Confirm IDE diagnostics are clear.
- [ ] Confirm working tree only contains intended changes.

### Backward Compatibility Review

- [ ] Confirm existing bucket-configured profiles still validate.
- [ ] Confirm existing bucket-configured secrets still parse.
- [ ] Confirm existing bucket-configured deployments still synthesize.
- [ ] Confirm existing bucket-configured entry events still create packages.
- [ ] Confirm existing bucket-configured linked-package lookup still works.
- [ ] Confirm existing package revision refresh behavior still works.

### Release Readiness

- [ ] Update changelog or release notes if required by project convention.
- [ ] Document migration impact for existing users.
- [ ] Document test stack name, profile, account, and region used for verification.
- [ ] Document deployed endpoint test result.
- [ ] Document any known limitations or deferred open questions.
- [ ] Prepare PR summary with tests run.
- [ ] Ensure no secrets, endpoints requiring redaction, or sensitive bucket/package details are exposed in committed docs.
