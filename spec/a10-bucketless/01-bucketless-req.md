# Requirements: Optional Bucket Parameter and Bucketless Package Discovery

**Branch**: a10-bucketless
**Date**: 2026-07-03
**Scope**: User requirements only. This document intentionally does not prescribe code structure, implementation mechanisms, or internal algorithms.

## Problem Statement

The Benchling webhook currently assumes that a specific Quilt bucket is configured for package creation and package lookup. This makes deployments less flexible for users who do not want the webhook to target one bucket as the default destination.

Users need the CloudFormation bucket parameter to be optional. When a bucket is not configured, the webhook must operate in a bucketless mode with two externally visible behaviors:

1. The webhook must not automatically create a package for every Benchling notebook entry.
2. The webhook must search across all accessible buckets when looking for linked packages.

## Definitions

### Bucket Parameter

The CloudFormation parameter that identifies the default Quilt bucket for webhook package operations.

### Bucket-Configured Mode

The deployment mode where the bucket parameter is present and has a valid value.

### Bucketless Mode

The deployment mode where the bucket parameter is omitted, left unset, or otherwise not provided by the deploying user.

### Linked Package

A Quilt package that is already associated with a Benchling notebook entry through user-visible linking metadata, references, or other established linkage recognized by the product.

### Automatic Package Creation

Webhook behavior that creates a new Quilt package as a default side effect of receiving or processing a Benchling notebook entry event.

## User Requirements

### UR-1: The Bucket Parameter Is Optional

**As a** user deploying the Benchling webhook
**I want** the bucket CloudFormation parameter to be optional
**So that** I can deploy the webhook without choosing one default Quilt bucket.

**Acceptance Criteria**:

1. A deployment can be configured without providing the bucket parameter.
2. A deployment without the bucket parameter is considered valid user configuration.
3. Users are not required to invent a placeholder bucket to complete deployment.
4. User-facing deployment guidance clearly distinguishes bucket-configured mode from bucketless mode.
5. Error messages must not describe the missing bucket parameter as a deployment failure when bucketless mode is intended.

### UR-2: Existing Bucket-Configured Behavior Remains Available

**As a** user who already configures a bucket
**I want** the existing bucket-targeted workflow to remain available
**So that** current deployments and operational expectations are preserved.

**Acceptance Criteria**:

1. When the bucket parameter is provided, the webhook continues to treat that bucket as the configured bucket.
2. Users with existing bucket-configured deployments do not need to change their configuration to keep the same workflow.
3. Documentation describes bucket-configured mode as an available mode, not as a deprecated or invalid configuration.
4. Bucketless mode does not change the meaning of a provided bucket parameter.

### UR-3: Bucketless Mode Does Not Auto-Create Packages for Every Notebook Entry

**As a** Benchling user whose organization has many notebook entries
**I want** bucketless mode to avoid automatically creating a Quilt package for every notebook entry
**So that** the webhook does not produce unwanted packages across my Quilt environment.

**Acceptance Criteria**:

1. When the bucket parameter is not provided, processing a Benchling notebook entry must not create a new default package solely because the notebook entry exists or was changed.
2. Bucketless mode must not require users to disable the webhook to prevent broad automatic package creation.
3. Bucketless mode must avoid surprising package proliferation for notebook entries that have no linked package.
4. User-facing behavior must make it clear that absence of a configured bucket means absence of default package creation.
5. The webhook may still process notebook entry events for other supported purposes, provided that processing does not create a default package for each entry.

### UR-4: Bucketless Mode Searches All Accessible Buckets for Linked Packages

**As a** user who links Benchling notebook entries to existing Quilt packages
**I want** bucketless mode to search all accessible Quilt buckets for linked packages
**So that** linked packages can be found without requiring a single configured bucket.

**Acceptance Criteria**:

1. When the bucket parameter is not provided, linked package lookup must not be limited to one configured bucket.
2. Bucketless mode must search every bucket that the deployed webhook is authorized to inspect.
3. If a linked package exists in any accessible bucket, bucketless mode must be capable of finding it.
4. Users must not need to duplicate linked packages into a single default bucket for the webhook to find them.
5. If no linked package is found in any accessible bucket, the user-visible result must clearly indicate that no linked package was found.
6. If the webhook lacks access to one or more expected buckets, the user-visible result or operational documentation must make the access boundary understandable.

### UR-5: Bucketless Mode Updates Linked Packages Without Creating Unlinked Packages

**As a** user maintaining Benchling-linked Quilt packages
**I want** bucketless mode to operate on packages that are already linked
**So that** existing package relationships continue to work without generating unrelated packages.

**Acceptance Criteria**:

1. When a notebook entry has a linked package in an accessible bucket, bucketless mode may perform the supported package-related behavior for that linked package.
2. When a notebook entry has no linked package in any accessible bucket, bucketless mode must not create a new package as a fallback default behavior.
3. Bucketless mode must preserve the distinction between "linked package found" and "no linked package found."
4. Users must be able to reason from observable results whether the webhook acted on an existing linked package or skipped package work because no link existed.

### UR-6: Search Scope Is User-Comprehensible

**As an** administrator responsible for Quilt bucket access
**I want** the bucketless search scope to be clearly described
**So that** I understand which buckets can participate in linked package discovery.

**Acceptance Criteria**:

1. User documentation explains that bucketless mode searches accessible buckets, not every bucket in every account unconditionally.
2. User documentation explains that access permissions define the practical search scope.
3. If multiple deployment contexts are supported, the documentation identifies whose permissions determine bucket accessibility.
4. The product must not imply that inaccessible buckets will be searched.

### UR-7: Ambiguous or Duplicate Linked Packages Are Handled Predictably

**As a** user with packages across multiple buckets
**I want** bucketless mode to behave predictably if more than one linked package matches a notebook entry
**So that** package actions do not target the wrong package silently.

**Acceptance Criteria**:

1. If exactly one linked package is found across accessible buckets, that package is the unambiguous match.
2. If multiple linked packages are found for the same notebook entry, the user-visible behavior must avoid silent arbitrary selection.
3. Duplicate-match behavior must be documented.
4. The result for duplicate matches must be understandable to an administrator troubleshooting the notebook entry.

### UR-8: Bucketless Mode Has Clear Operational Feedback

**As an** operator of the webhook
**I want** clear feedback about bucketless behavior
**So that** I can distinguish expected no-op behavior from failures.

**Acceptance Criteria**:

1. When bucketless mode skips package creation because no linked package exists, that outcome must be distinguishable from an error.
2. When bucketless mode finds and acts on a linked package, that outcome must be distinguishable from a skipped event.
3. When bucketless mode cannot complete linked package lookup because of permissions or service availability, that outcome must be distinguishable from "no linked package exists."
4. Operational feedback must not expose sensitive package, bucket, or Benchling data beyond what an authorized operator should see.

### UR-9: Bucketless Mode Is Safe by Default

**As an** organization adopting the webhook
**I want** omission of the bucket parameter to result in conservative behavior
**So that** the webhook does not create storage artifacts or packages unexpectedly.

**Acceptance Criteria**:

1. Missing bucket configuration must not trigger broad package creation.
2. Missing bucket configuration must not choose an arbitrary bucket as a default target.
3. Missing bucket configuration must not infer a package destination from unrelated deployment metadata.
4. Bucketless mode may discover existing linked packages, but it must not invent new package destinations for unlinked notebook entries.

## Non-Requirements

The following are explicitly outside this requirements document:

1. Specific code changes, classes, functions, modules, or file paths.
2. Specific CloudFormation template syntax.
3. Specific API calls used to list buckets, inspect packages, or resolve links.
4. Specific data structures used to represent package links.
5. Performance optimizations or caching strategies.
6. Migration scripts.
7. Changes to package-linking semantics beyond the user-visible bucketless behavior described above.

## Success Criteria

1. Users can deploy without a bucket parameter.
2. Users who provide a bucket retain the bucket-configured workflow.
3. Bucketless deployments do not create a package for every notebook entry.
4. Bucketless deployments find linked packages across all accessible buckets.
5. Bucketless deployments clearly report the difference between linked-package success, no linked package found, duplicate linked packages, and lookup failure.
6. Documentation makes the two modes and their consequences clear to deployers and operators.

## Open Questions

1. What exact user-visible signal defines that a Quilt package is linked to a Benchling notebook entry?
2. If multiple linked packages are found across accessible buckets, should the preferred user outcome be an error, a warning with no action, or a deterministic documented selection rule?
3. Should bucketless mode expose a way for users to preview or audit which buckets are accessible before processing events?
4. Are there user-facing limits needed for very large organizations with many accessible buckets?
5. Should bucketless mode be the recommended default for new deployments, or should documentation present both modes neutrally?
