# 260325 Customer Feedback

## Scope

This document captures the implementation plan for GitHub issue `#366` and the follow-up clarifications:

1. Setup should properly normalize Benchling tenant input.
2. Docs should explicitly recommend `--aws-profile` and mention `AWS_PROFILE`.
3. Code should warn when a new or unknown config `--profile` is specified because users may confuse it with AWS credential profile selection.
4. Benchling project permission guidance should assume service-account access via Client ID, not end-user OAuth login.
5. Setup should support selecting a non-default workflow for package creation.
6. Logs should avoid blanking during redraw by computing the next frame before clearing the screen.

## Goals

- Reduce setup friction caused by ambiguous Benchling tenant input.
- Reduce profile-selection mistakes caused by overlap between config profiles and AWS credential profiles.
- Document the required Benchling project permission model for service-account usage.
- Add an optional workflow selector that is persisted end-to-end and used at runtime.
- Improve `logs` UX during auto-refresh.

## Non-Goals

- Renaming the existing config `--profile` flag across the CLI.
- Changing the authentication model from service-account credentials to user OAuth login.
- Reworking the overall setup wizard flow.

## Implementation Order

1. Tenant normalization
2. Logs redraw fix
3. Project-permissions documentation
4. AWS profile UX cleanup and warning behavior
5. Workflow parameter end-to-end wiring

## 1. Tenant Normalization

### Problem

Users may enter any of the following during setup:

- `quilt-dtt`
- `quilt-dtt.benchling.com`
- `https://quilt-dtt.benchling.com`

The setup flow currently accepts raw input and later assumes the stored value is already a bare tenant slug.

### Plan

- Add a shared TypeScript tenant normalization helper used by setup and validation.
- Normalize input from:
  - interactive setup prompts
  - CLI overrides
  - any validation path that constructs a Benchling URL
- Persist the normalized bare tenant value in profile config and in Secrets Manager payloads.
- Keep runtime Python normalization in place as a defensive fallback.

### Target Areas

- `/Users/ernest/GitHub/benchling-webhook/lib/configuration-wizard.ts`
- `/Users/ernest/GitHub/benchling-webhook/lib/wizard/phase3-parameter-collection.ts`
- `/Users/ernest/GitHub/benchling-webhook/lib/wizard/phase4-validation.ts`
- `/Users/ernest/GitHub/benchling-webhook/lib/wizard/profile-config-builder.ts`
- `/Users/ernest/GitHub/benchling-webhook/docker/src/secrets_manager.py`

### Expected Behavior

- Setup accepts URL, hostname, or bare tenant.
- Stored config uses the bare tenant value only.
- Validation consistently tests `https://{tenant}.benchling.com`.

## 2. Logs Redraw Fix

### Problem

The `logs` command clears the screen before the next refresh cycle is fully computed, which causes visible blanking.

### Plan

- Reorder the refresh loop so the command:
  1. fetches logs
  2. computes optional rollout status
  3. clears the screen
  4. renders the next frame
- Preserve the existing smart-expansion behavior for empty log windows.
- Keep the first render unchanged.

### Target Areas

- `/Users/ernest/GitHub/benchling-webhook/bin/commands/logs.ts`

### Expected Behavior

- Auto-refresh transitions directly from one rendered frame to the next.
- Users do not see an empty screen while AWS queries are still in progress.

## 3. Benchling Project Permissions Documentation

### Problem

If a Benchling project is used, the service account behind the configured Client ID must be added to that project. This requirement is not surfaced clearly in the main docs.

### Clarification

This repo should document only the service-account model:

- We always use a Client ID tied to the app/service account.
- The relevant identity to grant project access to is the service account, not an end user.

### Plan

- Add a short setup note explaining that Benchling project access must be granted to the service account used by the app.
- Include a minimal verification step such as testing a read/list API call if access appears broken.
- Place this guidance where setup and testing instructions already exist.

### Target Areas

- `/Users/ernest/GitHub/benchling-webhook/README.md`
- `/Users/ernest/GitHub/benchling-webhook/docker/README.md` if operational troubleshooting coverage is helpful

### Expected Behavior

- Users configuring project-scoped integrations understand they must share the project with the service account and give it appropriate access.

## 4. AWS Profile UX Cleanup

### Problem

The CLI already uses:

- `--profile` for config profile selection
- `--aws-profile` for AWS credential profile selection

This is correct mechanically, but easy for users to confuse during setup.

### Clarification

Docs should explicitly recommend `--aws-profile` for AWS credentials and mention `AWS_PROFILE` as an alternative. Code should warn when a new or unknown config profile is specified because the user may have intended an AWS profile instead.

### Plan

- Update setup and README examples to prefer `--aws-profile` when the goal is selecting AWS credentials.
- Mention that `AWS_PROFILE` is also supported.
- In setup entrypoints, detect cases where:
  - `--profile <name>` refers to a config profile that does not already exist
  - `--aws-profile` is not provided
- Show a warning that:
  - `--profile` selects a benchling-webhook config profile
  - `--aws-profile` or `AWS_PROFILE` selects AWS credentials
  - the new config profile will be created if the user continues
- Continue execution after warning. This should be non-blocking.

### Warning Criteria

Warn when all of the following are true:

- the user explicitly passed `--profile`
- the specified config profile does not exist yet
- no explicit `--aws-profile` was provided

Optionally also include `process.env.AWS_PROFILE` in the warning message if present so the effective AWS credential source is obvious.

### Target Areas

- `/Users/ernest/GitHub/benchling-webhook/bin/cli.ts`
- `/Users/ernest/GitHub/benchling-webhook/bin/commands/setup-wizard.ts`
- any setup/install wrapper that threads profile options
- `/Users/ernest/GitHub/benchling-webhook/README.md`

### Expected Behavior

- Docs steer users toward `--aws-profile` for AWS credentials.
- Setup warns before silently creating a config profile in the common confusion case.
- Users relying on `AWS_PROFILE` get explicit acknowledgment in docs.

## 5. Workflow Parameter End-to-End Wiring

### Problem

There is currently no user-facing way to specify a non-default Quilt workflow, and the config/secret/runtime path does not carry such a field.

### Plan

- Add an optional workflow field to setup and config.
- Persist it through:
  - setup wizard
  - profile config
  - secret payload
  - Python secret/config loader
  - package creation request
- Ensure runtime behavior omits the field when not configured.

### Data Shape

Proposed semantics:

- field is optional
- empty value means "use Quilt default"
- non-empty value is passed as `workflow` in the package request payload

### Target Areas

- `/Users/ernest/GitHub/benchling-webhook/lib/types/config.ts`
- `/Users/ernest/GitHub/benchling-webhook/lib/wizard/types.ts`
- `/Users/ernest/GitHub/benchling-webhook/lib/wizard/phase3-parameter-collection.ts`
- `/Users/ernest/GitHub/benchling-webhook/lib/wizard/profile-config-builder.ts`
- `/Users/ernest/GitHub/benchling-webhook/bin/commands/setup-wizard.ts`
- `/Users/ernest/GitHub/benchling-webhook/bin/commands/sync-secrets.ts`
- `/Users/ernest/GitHub/benchling-webhook/lib/wizard/benchling-secret.ts`
- `/Users/ernest/GitHub/benchling-webhook/docker/src/secrets_manager.py`
- `/Users/ernest/GitHub/benchling-webhook/docker/src/config.py`
- `/Users/ernest/GitHub/benchling-webhook/docker/src/entry_packager.py`
- any package payload builder that sends metadata/package creation parameters

### Expected Behavior

- Users can optionally set a workflow name during setup.
- The workflow is persisted and survives redeploys/secret sync.
- Package creation includes `"workflow": "<name>"` only when configured.

## Testing Plan

### Automated

- Add or update unit tests for tenant normalization.
- Add setup-flow tests for new/unknown `--profile` warning behavior.
- Add secret serialization and parsing tests for the optional workflow field.
- Add runtime tests verifying the package payload includes `workflow` when configured and omits it otherwise.
- Add logs command tests for the new redraw ordering if the current command structure is testable.

### Manual

- Run `npm test`.
- Exercise setup with:
  - bare tenant
  - full hostname
  - full URL
- Exercise setup with:
  - `--profile newname`
  - `--aws-profile myaws`
  - `AWS_PROFILE=myaws`
- Verify docs examples are internally consistent.
- Verify `logs --timer 5` no longer blanks during refresh.

## Risks

- Over-warning on `--profile` could annoy valid multi-profile users. Keep the warning narrowly scoped to first-time profile creation.
- Workflow wiring touches both TypeScript and Python config paths, so partial implementation could produce mismatched secret schemas.
- Tenant normalization must not accidentally strip valid embedded characters beyond the URL/domain wrapper.

## Delivery Notes

- Implement in the order listed above.
- Keep warning behavior additive and non-breaking.
- Treat Python-side tenant normalization as a fallback, not the primary fix.
