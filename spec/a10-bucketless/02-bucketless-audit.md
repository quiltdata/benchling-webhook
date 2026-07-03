# Audit: Code Paths Affected by Bucketless Mode

**Branch**: a10-bucketless
**Date**: 2026-07-03
**Scope**: Identify which code paths must be revisited for bucketless mode. This document intentionally does not prescribe how to change them.

## Requirements Trace

This audit maps code paths to the user requirements in [01-bucketless-req.md](./01-bucketless-req.md):

1. The bucket CloudFormation parameter is optional.
2. When the bucket is absent, entry events must not auto-create packages for every notebook entry.
3. When the bucket is absent, linked-package lookup must search all accessible buckets.
4. Existing bucket-configured behavior must remain available.

## Summary

The current codebase treats the package bucket as required in three layers:

1. **Setup and profile configuration** require `packages.bucket`.
2. **Deployment and stack synthesis** pass a single `PackageBucket` value into the service and IAM policy model.
3. **Runtime Python code** stores a single bucket in `config.s3_bucket_name` and uses it for package writes, package-creation messages, linked-package search, package browsing, package-event filtering, and canvas links.

Bucketless mode therefore touches both deployment-time configuration and runtime behavior. The highest-risk behavior path is the entry-event path: supported Benchling entry events are always enqueued for packaging, and the packaging consumer always runs `EntryPackager.execute_workflow`, which exports entry data, writes to S3, and sends a package-creation message.

## Must Change: Configuration and Deployment Inputs

### `lib/types/config.ts`

Current path:

- `PackageConfig.bucket` is typed as required.
- The profile schema requires `packages.bucket`.
- The schema enforces `bucket` `minLength: 3`.

Evidence:

- `PackageConfig.bucket`: `lib/types/config.ts:311`
- required schema entry: `lib/types/config.ts:761`
- bucket schema constraint: `lib/types/config.ts:765`

Why it must change:

- User requirement UR-1 says the bucket parameter is optional.
- Any profile-level validation that rejects missing `packages.bucket` blocks bucketless mode before deployment.

### `lib/wizard/phase3-parameter-collection.ts`

Current path:

- Package configuration collection declares a bucket variable.
- Non-interactive setup fails when no bucket is supplied.
- User-facing output assumes a bucket is present.

Evidence:

- package configuration prompt block: `lib/wizard/phase3-parameter-collection.ts:310`
- CLI bucket assignment: `lib/wizard/phase3-parameter-collection.ts:320`
- non-interactive bucket fallback: `lib/wizard/phase3-parameter-collection.ts:331`
- missing bucket error: `lib/wizard/phase3-parameter-collection.ts:336`

Why it must change:

- Bucketless mode must be a valid setup outcome.
- Setup must not require users to invent a placeholder bucket.

### `lib/wizard/profile-config-builder.ts`

Current path:

- New profiles always write `packages.bucket`.
- Existing-config setup throws when neither existing config nor secret details include a package bucket.
- Built profile config asserts a bucket value.

Evidence:

- new profile package bucket assignment: `lib/wizard/profile-config-builder.ts:72`
- existing profile bucket source: `lib/wizard/profile-config-builder.ts:113`
- missing bucket error: `lib/wizard/profile-config-builder.ts:123`
- package config bucket assertion: `lib/wizard/profile-config-builder.ts:145`

Why it must change:

- Existing configurations and secrets without a package bucket must be representable.
- Profile creation must be able to describe bucketless mode.

### `lib/wizard/phase4-validation.ts`

Current path:

- Setup validation always validates S3 bucket access.
- Failure output always includes an S3 bucket line.

Evidence:

- S3 bucket validation call: `lib/wizard/phase4-validation.ts:286`
- validation failure output: `lib/wizard/phase4-validation.ts:301`

Why it must change:

- Missing bucket cannot be treated as failed S3 validation when bucketless mode is intended.
- User-facing validation output must distinguish bucketless mode from invalid bucket configuration.

### `lib/configuration-validator.ts`

Current path:

- `quiltUserBucket` is listed as a required field for older/general configuration validation.

Evidence:

- required field list: `lib/configuration-validator.ts:45`
- S3 validation gated on `quiltUserBucket`: `lib/configuration-validator.ts:116`

Why it likely must change:

- Any active command or legacy path using this validator would reject bucketless configuration.
- The S3 validation gate is already conditional, but the required-field check is not.

### `lib/utils/config.ts`

Current path:

- Legacy/general config metadata describes the S3 bucket as explicitly required and not inferable.
- Validation treats present-but-invalid buckets as warnings, but user guidance still says the bucket must be provided.

Evidence:

- required messaging for `quiltUserBucket`: `lib/utils/config.ts:205`
- bucket format validation: `lib/utils/config.ts:250`

Why it likely must change:

- User-facing config guidance must stop representing the bucket as universally required.

## Must Change: Secret Shape and Runtime Config Loading

### `bin/commands/sync-secrets.ts`

Current path:

- The secret JSON always includes `user_bucket` from `config.packages.bucket`.

Evidence:

- secret construction: `bin/commands/sync-secrets.ts:292`
- `user_bucket` assignment: `bin/commands/sync-secrets.ts:299`

Why it must change:

- Bucketless profiles must be syncable to Secrets Manager.
- Runtime cannot depend on a required `user_bucket` field when the deployment is bucketless.

### `bin/commands/create-secret.ts`

Current path:

- The secret interface requires `user_bucket`.
- The generated secret data always includes `user_bucket` from `BENCHLING_USER_BUCKET`.

Evidence:

- `BenchlingSecretData.user_bucket`: `bin/commands/create-secret.ts:39`
- generated `user_bucket`: `bin/commands/create-secret.ts:117`

Why it likely must change:

- Manual secret creation must support bucketless mode if this command remains a supported user path.

### `docker/src/secrets_manager.py`

Current path:

- `BenchlingSecretData.user_bucket` is required.
- Secret validation requires `user_bucket`.
- Secret validation rejects empty `user_bucket`.
- Parsed secrets always populate `user_bucket`.

Evidence:

- dataclass field: `docker/src/secrets_manager.py:70`
- required field list: `docker/src/secrets_manager.py:185`
- example secret includes `user_bucket`: `docker/src/secrets_manager.py:199`
- non-empty string validation includes `user_bucket`: `docker/src/secrets_manager.py:239`
- parsed value assignment: `docker/src/secrets_manager.py:260`

Why it must change:

- Runtime startup and secret refresh must not fail just because bucketless mode has no package bucket.

### `docker/src/config_schema.py`

Current path:

- `SecretConfig.user_bucket` is required.

Evidence:

- Pydantic field: `docker/src/config_schema.py:175`

Why it likely must change:

- Any schema validation path using `SecretConfig` will reject bucketless secrets.

### `docker/src/config.py`

Current path:

- Applying secrets sets `self.s3_bucket_name` directly from `secret_data.user_bucket`.

Evidence:

- secret application block: `docker/src/config.py:292`
- bucket assignment: `docker/src/config.py:304`

Why it must change:

- Runtime code needs a valid representation for "no configured bucket."
- Every downstream consumer of `config.s3_bucket_name` must be audited for bucketless behavior.

## Must Change: CloudFormation and ECS Service Wiring

### `lib/benchling-webhook-stack.ts`

Current path:

- The stack defines a `PackageBucket` CloudFormation parameter.
- The stack passes `packageBucketValue` to `FargateService`.

Evidence:

- `PackageBucket` parameter: `lib/benchling-webhook-stack.ts:127`
- parameter value extraction: `lib/benchling-webhook-stack.ts:147`
- Fargate prop assignment: `lib/benchling-webhook-stack.ts:329`

Why it must change:

- The CloudFormation parameter must support absence as a valid user choice.
- The stack must not make downstream service behavior depend on a required non-empty bucket.

### `lib/fargate-service.ts`

Current path:

- `FargateServiceProps.packageBucket` is required.
- The task role always constructs an S3 ARN from `props.packageBucket`.
- The task role always grants bucket-specific S3 permissions based on that ARN.

Evidence:

- required prop: `lib/fargate-service.ts:46`
- bucket ARN construction: `lib/fargate-service.ts:150`
- bucket-specific policy resources: `lib/fargate-service.ts:171`

Why it must change:

- Bucketless mode cannot create meaningful bucket-specific IAM resources from an absent bucket.
- The permission model must align with the user requirement that bucketless linked-package search covers all accessible buckets.

### `bin/commands/deploy.ts`

Current path:

- Deployment plan summarizes events with `config.packages.bucket`.
- CloudFormation deployment parameters always include `PackageBucket=${config.packages.bucket}`.

Evidence:

- event summary: `bin/commands/deploy.ts:637`
- stack parameter list: `bin/commands/deploy.ts:779`
- `PackageBucket` parameter: `bin/commands/deploy.ts:794`

Why it must change:

- Deploy must allow the bucket parameter to be omitted or empty intentionally.
- User-facing deploy output must identify bucketless mode rather than rendering a misleading bucket-based event summary.

## Must Change: Entry-Event Auto-Creation Path

### `docker/src/app.py`

Current path:

- Supported Benchling entry events are always enqueued as packaging requests.
- Supported events include `v2.entry.created`, `v2.entry.updated.fields`, and `v2.entry.updated.reviewRecord`.

Evidence:

- supported entry event set: `docker/src/app.py:749`
- packaging request enqueue: `docker/src/app.py:761`
- success log says packaging request was enqueued: `docker/src/app.py:763`

Why it must change:

- UR-3 says bucketless mode must not automatically create a package for every notebook entry.
- This is the first runtime gate where entry events become package work.

### `docker/src/packaging_publisher.py`

Current path:

- The publisher is specifically the path from webhook handler to FIFO packaging work.

Evidence:

- module purpose: `docker/src/packaging_publisher.py:1`
- publish function: `docker/src/packaging_publisher.py:41`

Why it may need change:

- If entry events remain accepted but should not become package-creation work in bucketless mode, this path is part of the affected behavior boundary.

### `docker/src/packaging_consumer.py`

Current path:

- Every packaging request consumed from the FIFO queue dispatches to `EntryPackager.execute_workflow`.

Evidence:

- payload parsing and workflow dispatch: `docker/src/packaging_consumer.py:81`
- `execute_workflow` call: `docker/src/packaging_consumer.py:84`

Why it may need change:

- This is the second runtime gate before automatic package creation.
- If bucketless behavior is not fully gated before enqueue, this path must not run package-creation workflow for unlinked notebook entries.

### `docker/src/entry_packager.py`

Current path:

- `execute_workflow` exports the Benchling entry, writes files to the configured S3 bucket, sends a Quilt package-creation message, and returns a package success result.
- `_process_export` writes exported files and metadata to `self.config.s3_bucket_name`.
- `_send_to_sqs` sends a package-creation request with `source_prefix`, `registry`, and `package_name`.

Evidence:

- package name derivation and export processing: `docker/src/entry_packager.py:477`
- S3 object writes: `docker/src/entry_packager.py:523`
- metadata S3 writes: `docker/src/entry_packager.py:549`
- existing `entry.json` read from configured bucket: `docker/src/entry_packager.py:785`
- package-creation message body: `docker/src/entry_packager.py:829`
- workflow sends package-creation SQS message: `docker/src/entry_packager.py:926`
- success result reports package creation workflow success: `docker/src/entry_packager.py:954`

Why it must change:

- This is the core auto-create-package path.
- It cannot run as-is when no bucket is configured.
- It assumes one target registry bucket for both staging exported files and creating package revisions.

## Must Change: Linked-Package Lookup Scope

### `docker/src/canvas.py`

Current path:

- `CanvasManager` constructs `PackageQuery` with exactly `config.s3_bucket_name`.
- Canvas content asks that single query object for linked packages.
- The footer renders one configured bucket.
- Sync URIs are built from `config.s3_bucket_name`.

Evidence:

- `PackageQuery` construction: `docker/src/canvas.py:70`
- `PackageFileFetcher` construction: `docker/src/canvas.py:76`
- sync URI bucket: `docker/src/canvas.py:127`
- linked-package query call: `docker/src/canvas.py:205`
- footer bucket: `docker/src/canvas.py:271`

Why it must change:

- UR-4 says bucketless linked-package lookup must search all accessible buckets.
- The current canvas path limits linked-package search to one configured bucket.
- Bucketless UI cannot truthfully render a single configured bucket in places where no configured bucket exists.

### `docker/src/package_query.py`

Current path:

- `PackageQuery` represents one bucket.
- Its Athena query targets one bucket-specific packages view.
- Returned `Package` objects carry that single bucket.

Evidence:

- class docstring describes one bucket-specific view: `docker/src/package_query.py:35`
- constructor bucket argument: `docker/src/package_query.py:46`
- view name from one bucket: `docker/src/package_query.py:213`
- result bucket assignment: `docker/src/package_query.py:250`
- `Package` creation with one bucket: `docker/src/package_query.py:260`

Why it must change:

- This is the linked-package lookup implementation path that currently prevents all-accessible-bucket search.
- Bucketless mode requires lookup behavior that is not limited to one bucket-specific view.

### `docker/src/packages.py`

Current path:

- `Package` requires a bucket and uses it in catalog URLs.

Evidence:

- constructor bucket argument: `docker/src/packages.py:39`
- catalog URL includes bucket: `docker/src/packages.py:51`

Why it likely remains involved:

- All-accessible-bucket search still needs to preserve the bucket for each found linked package.
- Duplicate linked-package handling depends on identifying matches across package name and bucket.

## Must Change or Reassess: Package Browsing and Package Events

### `docker/src/package_files.py`

Current path:

- `PackageFileFetcher` represents one bucket-backed registry.
- It creates a registry from `s3://{self.bucket}`.

Evidence:

- constructor bucket argument: `docker/src/package_files.py:101`
- registry construction: `docker/src/package_files.py:126`

Why it may need change:

- Browsing linked packages found in different buckets must use the found package's bucket, not an absent or unrelated configured bucket.

### `docker/src/canvas_blocks.py`

Current path:

- Linked-package browse button IDs encode package name but not bucket.

Evidence:

- linked browse button creation: `docker/src/canvas_blocks.py:222`
- button ID creation: `docker/src/canvas_blocks.py:243`

Why it may need change:

- In bucketless mode, the same package name may exist in more than one accessible bucket.
- Browse interactions need enough user-visible context to avoid silently targeting the wrong linked package.

### `docker/src/package_event.py`

Current path:

- Package revision refresh fetches package metadata using `config.s3_bucket_name`.

Evidence:

- `PackageFileFetcher` construction: `docker/src/package_event.py:90`

Why it may need change:

- Package revision events include a registry bucket.
- Bucketless mode cannot assume the configured bucket when refreshing canvases for linked packages across accessible buckets.

### `docker/src/sqs_consumer.py`

Current path:

- Package event consumer filters out events whose bucket does not equal `config.s3_bucket_name`.

Evidence:

- bucket filter: `docker/src/sqs_consumer.py:199`
- unexpected-bucket log fields: `docker/src/sqs_consumer.py:203`

Why it must change or be explicitly scoped:

- UR-4 requires searching all accessible buckets for linked packages.
- If bucketless mode also expects package-event refreshes for linked packages outside a configured bucket, this filter prevents that behavior.

## Test Paths That Need Coverage Updates

### TypeScript tests

Likely affected:

- `test/config-transform.test.ts`
- `test/configuration-validator.test.ts`
- `test/s3-bucket-validator.test.ts`
- `test/sync-secrets.test.ts`
- `test/rest-api-gateway.test.ts`
- `test/benchling-webhook-stack.test.ts`
- `test/multi-environment-fargate-service.test.ts`
- `test/unit/xdg-config.test.ts`
- `test/unit/xdg-config-filesystem.test.ts`
- `test/bin/commands/setup-wizard.test.ts`
- `test/bin/install.test.ts`
- `test/bin/commands/status.test.ts`
- `test/integration/legacy-detection.test.ts`
- `test/integration/xdg-launch-pure-functions.test.ts`

Why:

- These tests construct profile configs with required `packages.bucket`, assert bucket validation behavior, assert stack parameters, or assert ECS permissions/env behavior.

### Python tests

Likely affected:

- `docker/tests/test_config_validation.py`
- `docker/tests/test_secrets_resolver.py`
- `docker/tests/test_app.py`
- `docker/tests/test_flexible_routes.py`
- `docker/tests/test_entry_packager.py`
- `docker/tests/test_packaging_consumer.py`
- `docker/tests/test_canvas.py`
- `docker/tests/test_canvas_browser.py`
- `docker/tests/test_browse_linked_packages.py`
- `docker/tests/test_package_files.py`
- `docker/tests/test_package_event.py`
- `docker/tests/test_sqs_consumer.py`

Why:

- These tests set `config.s3_bucket_name`, expect `user_bucket` in secrets, expect entry events to enqueue packaging, expect single-bucket canvas/package browsing, or expect package-event bucket filtering.

## Documentation and User-Facing Text Paths

Likely affected:

- `README.md`
- `docker/src/README.md`
- `bin/commands/validate.ts`
- `bin/commands/deploy.ts`
- setup wizard output in `lib/wizard/*`
- secret-format examples in `docker/src/secrets_manager.py`
- config guidance in `lib/utils/config.ts`

Why:

- User-facing documentation and CLI output currently describe a bucket-centered deployment and package workflow.
- Bucketless mode requires clear wording that missing bucket is valid and suppresses default package creation.

## Open Audit Questions

1. Should bucketless mode suppress packaging at the webhook handler boundary, the packaging consumer boundary, or both?
2. Should canvas initialization in bucketless mode still show a primary package section when no linked package exists?
3. What source defines the complete set of accessible buckets for linked-package lookup?
4. Should package revision events be accepted from all accessible buckets in bucketless mode, or only from buckets with known linked packages?
5. How should duplicate linked-package matches across buckets be surfaced in canvas interactions and logs?
