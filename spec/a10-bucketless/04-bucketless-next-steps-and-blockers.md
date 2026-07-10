# Bucketless Mode: Next Steps and Blockers

**Branch**: a10-bucketless
**Date**: 2026-07-03
**Status**: Implemented locally, pushed, and opened for review
**PR**: https://github.com/quiltdata/benchling-webhook/pull/396
**Scope**: Post-implementation follow-up. No code.

## Current State

- Bucketless configuration is implemented across setup/config, secret creation and sync, validation, deployment parameter construction, and runtime config parsing.
- Runtime entry and canvas event paths now skip default package creation when no package bucket is configured.
- Linked package lookup now searches all discovered Quilt package-view buckets when running without a configured package bucket.
- Linked package browse and metadata actions preserve the package bucket identity needed to inspect linked packages from other buckets.
- Version was bumped from `0.18.0` to `0.19.0`.
- `CHANGELOG.md` contains a `0.19.0` entry for bucketless support.

## Completed Verification

- `npm test` passed:
  - TypeScript/Jest: 38 suites passed, 602 tests passed, 1 skipped.
  - Python: 446 tests passed.
- `npm run version:verify` passed after the version and changelog commits.
- `git diff --check` passed before committing.
- `npm run test:local` passed after local `.env` propagation was fixed:
  - Docker dev image built successfully.
  - Local container became healthy.
  - Health, readiness, liveness, and webhook smoke checks passed.
  - Summary: 8/8 tests passed.

## Known Blockers

1. A real bucketless AWS stack has not been deployed.
   - No bucketless deployment profile or target stack was specified for this work.
   - Deploying would create or update real AWS resources, so it should be done only against an explicitly selected profile/account.
   - Impact: CloudFormation/ECS behavior is implemented and unit-tested where covered, but not yet validated in a live bucketless stack.

2. Cross-bucket package discovery depends on Athena package-view availability and permissions.
   - Bucketless lookup discovers buckets from `information_schema.tables` entries ending in `_packages-view`.
   - Runtime IAM and Athena permissions must allow listing/querying the relevant package views.
   - Impact: bucketless linked-package search may be incomplete in environments where accessible package views are missing, stale, or not queryable by the task role.

## Next Steps

1. Review and merge PR #396 after code review and CI pass.

2. Prepare a bucketless test profile.
   - Select the AWS account, region, and Benchling tenant to use.
   - Configure the profile without `packages.bucket`.
   - Ensure required Benchling secret fields are present.
   - Ensure local `.env` contains `PACKAGING_REQUEST_QUEUE_URL` when running local smoke tests.

3. Deploy a bucketless dev stack.
   - Use the project deploy script with the selected profile.
   - Confirm the deployment plan clearly reports bucketless mode.
   - Confirm CloudFormation parameters accept the empty package bucket value.
   - Confirm ECS task startup succeeds with a secret that omits `user_bucket`.

4. Run deployed validation.
   - Health and readiness checks should pass once required non-bucket settings are present.
   - Entry created/updated events should return an accepted skipped result and must not enqueue default package creation.
   - Canvas initialization/update flows should render bucketless-safe content and must not imply a default package exists.
   - Linked package sections should still resolve and display packages from accessible package-view buckets.

5. Validate cross-bucket linked package browsing.
   - Use a Benchling entry linked to packages in at least two different Quilt buckets.
   - Confirm linked package buttons preserve bucket identity.
   - Confirm file browsing and metadata views read from the selected linked package's bucket.
   - Confirm duplicate package names in different buckets remain distinguishable enough for users and logs.

6. Validate package revision refresh behavior.
   - Send package revision events from a bucket that is not a configured default bucket.
   - Confirm bucketless deployments do not filter those events out solely because the event bucket differs from a configured bucket.
   - Confirm canvas refresh reads package content from the event bucket.

7. Decide whether additional documentation is required before release.
   - README/setup guidance may need an explicit bucketless setup example.
   - Operational docs may need to explain that bucketless mode disables default notebook-entry package creation.
   - Troubleshooting docs may need to explain Athena package-view discovery requirements.

8. After merge, create the release tag using the project script.
   - Use `npm run version:tag` for a release tag after the branch is merged and the working tree is clean.
   - Use `npm run version:tag:dev` only if a dev prerelease/test image is intended first.

## Open Questions

1. Which AWS profile/account should own the first bucketless test stack?
2. Should bucketless mode be documented as generally available in `README.md`, or kept as release-note-only until deployed validation is complete?
3. Should duplicate linked packages across buckets be shown with explicit bucket labels in the Canvas UI, or is preserving bucket context in buttons/logs sufficient for the first release?
4. Should bucketless smoke tests assert linked-package discovery explicitly, beyond the current webhook skip responses?
