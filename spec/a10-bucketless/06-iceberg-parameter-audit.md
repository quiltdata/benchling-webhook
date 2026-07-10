# Iceberg Parameter Propagation Audit

**Date**: 2026-07-06
**Status**: Follow-up specification
**Scope**: Documents what was implemented after [05-iceberg-search.md](05-iceberg-search.md), what is incomplete, and what must be fixed before this path is considered deployable.

## Summary

Spec 05 correctly identified `QUILT_ICEBERG_DATABASE` as the runtime switch for the faster bucketless linked-package search, but it did not specify how that value is discovered, stored in profile configuration, transformed into stack configuration, passed through deployment, granted IAM access, or verified.

The current implementation partially wires the value into runtime and CloudFormation, then patches deployment with an untyped profile read. That makes the path fragile:

1. The container can run without an Iceberg database even when the Quilt stack has one.
2. Setup and stack inference do not populate the value.
3. Typed config transforms drop the value.
4. IAM grants do not cover the Iceberg Glue database or the Glue action now used to list tables.
5. Runtime errors can report the wrong failing service or database.
6. The Iceberg SQL path still has correctness risks independent of parameter passing.

This spec defines the required behavior and audit findings only. It does not prescribe code-level implementation.

## What Was Implemented

### Runtime Configuration

The Python container now has a runtime setting named `quilt_iceberg_database`, sourced from the `QUILT_ICEBERG_DATABASE` environment variable.

When this value is present and the package bucket is not configured, bucketless linked-package search chooses the Iceberg query path instead of the legacy all-bucket `_packages-view` fanout.

### Runtime Search Path

The Iceberg search path now:

1. Uses the Glue API to list tables in the configured Iceberg database.
2. Treats tables ending in `_package_manifest` as searchable bucket manifests.
3. Builds one `UNION ALL` Athena query across those buckets.
4. Joins per-bucket `package_revision`, `package_manifest`, and `package_tag` tables.
5. Filters on native Iceberg metadata fields instead of JSON string extraction.
6. Returns the same broad result shape as the existing linked-package search path.

### CloudFormation Parameter

The CDK stack now defines an optional `IcebergDatabase` CloudFormation parameter.

The Fargate service construct accepts an optional Iceberg database value and passes it to the task environment as `QUILT_ICEBERG_DATABASE`.

### Deployment Hack

The deploy command currently passes the `IcebergDatabase` CloudFormation parameter by reading `config.quilt.icebergDatabase` through an untyped cast.

This was added as a direct deployment patch. It does not make `icebergDatabase` a properly propagated profile, stack, wizard, or inference field.

### Tests

Python tests were added for the basic Iceberg runtime path:

1. Bucketless mode uses Iceberg when an Iceberg database is configured.
2. Bucketless mode falls back to fanout when no Iceberg database is configured.
3. Bucket-specific mode does not use the Iceberg path.
4. Empty Iceberg table discovery returns no linked packages.
5. The generated SQL contains the expected Iceberg table references.
6. Multiple matched packages can be represented in the returned result.

## What 05 Did Not Specify

Spec 05 did not define the authoritative source of the Iceberg database value.

It did not specify whether the value comes from:

1. A Quilt CloudFormation output.
2. A Quilt CloudFormation resource physical ID.
3. A setup wizard discovery step.
4. A profile field.
5. A deploy CLI option.
6. A manual config edit.

It did not specify how the value flows through:

1. `ProfileConfig`
2. profile JSON schema validation
3. setup wizard stack query results
4. stack inference
5. profile building
6. `profileToStackConfig`
7. `StackConfig`
8. CDK stack construction
9. CloudFormation parameters
10. ECS task environment variables
11. local `xdg-launch` environment variables

It did not specify the IAM implications of listing and querying Iceberg tables in a different Glue database.

It did not specify the deploy-time validation or operator-facing display needed to prove the fast path is active.

## Current Gaps

### Profile And Schema

`QuiltConfig` has an optional `icebergDatabase` field, but the profile JSON schema does not include it under `quilt.properties`.

Expected behavior:

1. `quilt.icebergDatabase` is a supported optional profile field.
2. The schema accepts and validates it.
3. Unknown-field handling must not be the reason this value appears to work.
4. Existing profiles without the field remain valid.

### Stack Configuration

`StackConfig` does not include `quilt.icebergDatabase`.

`profileToStackConfig` does not copy `profile.quilt.icebergDatabase`.

Expected behavior:

1. `icebergDatabase` is part of the typed stack configuration when present.
2. CDK receives the value through the same typed path as catalog, database, queue URL, region, workgroup, and managed policy ARNs.
3. Deploy must not recover the value through an `unknown` cast.

### Setup And Discovery

`StackQueryResult` does not include an Iceberg database field.

The profile builder does not copy a discovered Iceberg database into `config.quilt.icebergDatabase`.

Stack resource discovery does not include the Quilt `IcebergDatabase` resource.

The inference command has broad database-output matching that can confuse database-like outputs if more outputs are introduced.

Expected behavior:

1. Discovery should prefer an explicit Quilt stack resource or output that represents the Iceberg Glue database.
2. If the Quilt stack has a logical `IcebergDatabase` resource, its physical resource ID should be captured as `quilt.icebergDatabase`.
3. If a future Quilt stack output provides the same value, that output should be matched by exact name, not by broad substring matching.
4. Setup should display the discovered Iceberg database when present.
5. Setup should leave the field absent when the Quilt stack does not expose Iceberg resources.
6. A manually configured `quilt.icebergDatabase` must be preserved when reusing an existing profile unless a newer discovery result intentionally replaces it.

### Deploy Parameter Passing

The deploy command currently builds `IcebergDatabase` using an untyped cast against `config.quilt`.

Expected behavior:

1. Deployment uses the typed stack or profile config field.
2. The deploy plan displays the Iceberg database when present.
3. A deployment intended to test bucketless Iceberg search must show a non-empty Iceberg database before CDK deploy starts.
4. The CloudFormation parameter, stack default, Fargate prop, and ECS environment variable must all receive the same value.
5. There must be no separate deploy-only path that can drift from setup, profile validation, or CDK synthesis.

### Local Launch

The local `xdg-launch` environment builder does not pass `QUILT_ICEBERG_DATABASE`.

Expected behavior:

1. Local launches use the same profile value as deployed ECS tasks.
2. Local bucketless smoke tests can exercise the Iceberg path without hand-exporting the variable.

### IAM

The Fargate task role currently grants Glue access for the regular Quilt/Athena database only.

The runtime Iceberg discovery path calls Glue `GetTables`, but the inline policy includes `GetDatabase`, `GetTable`, and `GetPartitions`, not `GetTables`.

Expected behavior:

1. When `quilt.icebergDatabase` is set, the task role can call Glue APIs needed to list and query the Iceberg database.
2. Required Glue actions include the table-listing action used by runtime discovery.
3. Glue resources cover the catalog, the regular Quilt database, the Iceberg database, and the tables under both databases as needed.
4. Athena execution permissions remain tied to the configured Athena workgroup.
5. If a Quilt-managed Athena policy is attached, the implementation must verify whether it covers the Iceberg Glue database. If it does not, the webhook stack must add the missing grants.
6. The deployed role must not rely on broad accidental permissions from the deploying user or a local profile.

### Runtime Query Correctness

The current Iceberg query joins `package_tag` by package name and tag name, but does not require the revision top hash to match the latest tag top hash.

Expected behavior:

1. The Iceberg path returns only the latest package revision for each package.
2. The query must constrain the selected revision to the `latest` tag's top hash.
3. The query must not return historical revisions just because the package has a latest tag.

The current metadata result handling assumes the selected Iceberg metadata value can be parsed as JSON.

Expected behavior:

1. The query result must provide metadata in a format that the Python result builder can parse deterministically.
2. Native Athena `STRUCT` values must either be serialized intentionally or handled by a parser designed for Athena's returned representation.
3. Failed metadata parsing must not hide a successful package match.

The metadata key is interpolated as a STRUCT field name.

Expected behavior:

1. Metadata keys used in Iceberg SQL must be validated before query construction.
2. Invalid or unsupported metadata keys must produce a clear configuration error.
3. The implementation must not treat arbitrary user input as a SQL identifier.

### Error Reporting

Current AccessDenied rewriting reports an Athena StartQueryExecution problem on the regular Athena database even when the failure may be Glue `GetTables`, Glue table access, the Iceberg database, or another call.

Expected behavior:

1. Glue access failures identify Glue and the target database.
2. Athena execution failures identify Athena and the target workgroup.
3. Missing Iceberg configuration is reported separately from no linked packages found.
4. Permission failures must not be converted into "no linked packages found."
5. Canvas warnings should tell the operator which profile/stack parameter is missing or which IAM permission is missing.

## Required Fixes

### Fix The Configuration Contract

`quilt.icebergDatabase` must be the single source of truth for this feature in profile configuration.

The value must be optional. Absence means the deployment does not use Iceberg-backed bucketless search and may use the legacy fallback.

Presence means the deployment intends to use Iceberg-backed bucketless search and must have matching runtime configuration and IAM.

### Fix Discovery And Profile Persistence

Setup and inference must discover the Iceberg database from the Quilt stack when available.

Discovery must use exact resource or output names. It must not rely on generic output names containing the word `Database`.

The profile builder must persist the discovered value into `quilt.icebergDatabase`.

Existing manually configured values must be preserved unless a deterministic discovery source replaces them.

### Fix Typed Propagation

The typed path must carry `quilt.icebergDatabase` from profile to stack:

1. Profile config
2. Profile schema
3. Stack query result
4. Profile builder
5. Stack config
6. Config transform
7. CDK stack
8. Fargate service
9. ECS environment
10. Local launch environment

Deploy must stop using the untyped `unknown` cast.

### Fix IAM

The ECS task role must have the Glue permissions needed for both the regular Quilt database and the Iceberg database.

At minimum, the role must be able to:

1. Read the Glue catalog.
2. Read the regular Quilt database and tables needed by the legacy path.
3. Read the Iceberg database.
4. List tables in the Iceberg database.
5. Read Iceberg package tables used by linked-package search.

The required permissions must be covered by tests at the synthesized CloudFormation/template level.

### Fix Runtime SQL Semantics

The Iceberg query must select only the latest tagged package revision.

The metadata result must be shaped so the Python result builder can reliably attach package metadata.

Metadata field identifiers must be validated before query construction.

### Fix Operator Visibility

Deployment output must show whether Iceberg search is enabled.

The Canvas app output must distinguish:

1. Iceberg enabled and linked packages found.
2. Iceberg enabled and no linked packages found.
3. Iceberg disabled, using legacy fallback.
4. Iceberg configured but inaccessible.
5. Iceberg configured but missing required tables.

The deployed revision shown in Canvas must be enough to confirm the user is testing the intended image/tag.

## Test Requirements

### TypeScript Unit Tests

Add coverage that proves:

1. Profile schema accepts `quilt.icebergDatabase`.
2. `profileToStackConfig` preserves `quilt.icebergDatabase`.
3. Stack inference extracts the Iceberg database from the intended Quilt stack resource or exact output.
4. Profile builders persist the discovered Iceberg database.
5. Deploy parameter construction uses the typed value and does not require an untyped cast.
6. CDK synthesis sets `QUILT_ICEBERG_DATABASE` on the ECS task.
7. CDK synthesis grants Glue access for the Iceberg database and includes the table-listing action.
8. Local launch environment includes `QUILT_ICEBERG_DATABASE` when configured.

### Python Unit Tests

Add coverage that proves:

1. Bucketless search uses Iceberg only when an Iceberg database is configured.
2. The generated query constrains latest tag top hash correctly.
3. Metadata returned from Iceberg is parsed consistently.
4. Invalid metadata keys are rejected before query execution.
5. Glue access errors are reported as Glue access errors.
6. Athena execution errors are reported as Athena execution errors.
7. Permission errors do not become empty-result success responses.

### Integration And Deployment Tests

Add a testable stack deployment path that proves:

1. The selected profile contains a non-empty `quilt.icebergDatabase`.
2. The deployed CloudFormation stack has the expected `IcebergDatabase` parameter value.
3. The ECS task definition has `QUILT_ICEBERG_DATABASE` set.
4. The ECS task role can list Iceberg manifest tables.
5. Bucketless Canvas refresh finds a known linked package without using the legacy fanout path.

## Acceptance Criteria

This feature is complete only when all of the following are true:

1. A profile generated from a Quilt stack with Iceberg resources contains `quilt.icebergDatabase`.
2. A deployment from that profile sets the `IcebergDatabase` CloudFormation parameter without any untyped config cast.
3. The running container receives `QUILT_ICEBERG_DATABASE`.
4. The task role can call Glue table-listing APIs against the Iceberg database.
5. The task role can query the Iceberg package tables through Athena.
6. Bucketless linked-package refresh uses a single Iceberg query and does not fan out across `_packages-view` tables.
7. Linked packages are found for a known Benchling entry that has packages in accessible Quilt buckets.
8. A permission problem produces an actionable warning, not a false "no linked packages found" result.
9. The legacy fanout remains available only for deployments with no configured Iceberg database.
10. Unit and integration tests cover config propagation, IAM, runtime query correctness, and deploy-time observability.

## Deployment Blocker

Do not treat the current Iceberg parameter implementation as production-ready.

The current deploy-side cast can make one deployment appear to work, but it bypasses the typed configuration system and does not solve setup discovery, profile validation, local launch, IAM, or SQL correctness. A real fix must move the Iceberg database through the same configuration and deployment conventions used by the rest of the Quilt service settings.
