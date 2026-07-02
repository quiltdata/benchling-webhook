# Issue 392 — Configurability Implementation Checklist

Hand-off document for a code implementation agent. Context is in `spec/392-configurability/01`–`05`.

## Constraint

Phases can be developed independently but **all phases deploy together** in one release. Nothing is deployed until everything is ready.

---

## Prerequisite

**Run `05a-list_app_configuration_items.md` first** to determine the correct `app_id` parameter for `benchling.apps.list_app_configuration_items()`. Update this checklist with the result before starting Phase 1.

---

## Phase 1 — App Config Items Read Path (Python runtime)

1. **Add `benchling.apps.list_app_configuration_items()` call** at app startup in Docker Python code. Fetch all config items scoped to our app using the `app_id` identified by the prerequisite probe (likely `appDefinitionId` from the secret, or a separate `app.id` discovered via `list_apps()`).

1. **Build a `RoutingConfig` model** from the config items, keyed by `path` convention:
   - `["quilt", "routing", "<event-type>", "<key>"]` — event-type routing
   - `["quilt", "projects", "<project-name>", "<key>"]` — per-project routing
   - `["quilt", "settings", "<key>"]` — global settings (log level, concurrency)
   - `["quilt", "default", "<key>"]` — fallback values

   All paths are namespaced under `"quilt"` so `config:clear` can safely delete only our items.

1. **Implement a fallback chain** — for each config value:

   ```text
   Tier 1 (App Config Item) → Tier 2 (Secrets Manager) → Tier 3 (env var / hardcoded default)
   ```

   If the App Config Items API fails or returns empty, behavior is unchanged.

1. **Replace hardcoded `PACKAGE_EVENT_CONCURRENCY` and `PACKAGING_REQUEST_CONCURRENCY`** with Tier 1 lookup, falling back to current `"5"` default.

1. **Replace `LOG_LEVEL`** with Tier 1 lookup, falling back to secret's `log_level`, falling back to `"INFO"`.

1. **Cache Tier 1 config with a 60s TTL** and stale-while-refresh semantics, matching the existing `secrets_manager.py` pattern:
   - On first call: block and fetch
   - Within TTL: return cached value
   - Past TTL, stale value exists: return stale, kick off background refresh thread
   - The `app_id` is also cached; if it needs to change the container restarts anyway

## Phase 2 — Per-Project Routing (Python runtime)

1. **Resolve project from entry, but only for entry events with a folder.** Not all webhook events are entry-backed. Gate project lookup on `entry.folder_id` being present:
   - Has `folder_id` → resolve project, apply per-project overrides
   - No `folder_id` → skip project lookup, use event-type defaults

   Resolution chain:

   ```python
   entry = benchling.entries.get_entry_by_id(entry_id)
   if entry.folder_id:
       folder = benchling.folders.get_by_id(entry.folder_id)
       project = benchling.projects.get_by_id(folder.project_id)
       project_name = project.name  # key into Tier 1
   ```

1. **Apply project routing overrides with defined merge rules.** Precedence (highest → lowest):

   ```text
   Project override → Event-type default → Global default → Legacy fallback
   ```

   **Merge strategy:** field-level merge, not whole-object replace. If a project rule sets only `bucket`, the `prefix` and `workflow` inherit from the event-type or global default. Supported event types: `entry.created`, `entry.updated.fields`, `v2.canvas.userInteracted` (matches existing `supported_event_types` set in `app.py`).

1. **Handle project lookup failure gracefully.** If folder/project API calls fail (network error, deleted folder, missing permissions), log the error and use event-type defaults. Must not crash the webhook handler.

## Phase 3 — ProfileConfig / CDK Changes

1. **Add `packages.extraBuckets` to `ProfileConfig`.** An optional list of additional S3 bucket names that the stack needs IAM permissions for (for per-project multi-bucket routing). No auto-creation — operator lists existing buckets.

1. **Pass extra buckets through `StackConfig`** to the CDK stack. Add IAM policy statements for each listed bucket (same permissions as the primary `packages.bucket`).

1. **Add integrated-mode guard for IAM changes.** When `integratedStack: true`, the Quilt stack owns IAM. Deploy should print a warning that `packages.extraBuckets` is ignored in integrated mode — Tier 1 routes pointing at undeclared buckets will fail at runtime. Validation docs task should cover this.

1. **Keep all existing CfnParameters.** No removals. They become deploy-time overrides and runtime fallbacks.

## Phase 4 — CLI: Seed / Clear App Config

1. **Add `npm run config:seed` command.** Reads current routing values from `ProfileConfig` + Secrets Manager, creates equivalent App Configuration Items in Benchling via the SDK. Prints the Benchling UI URL where items can be edited.

1. **Add `npm run config:clear` command.** Deletes only App Configuration Items under the `["quilt"]` path namespace. Requires `--force`. Shows a dry-run preview of what will be deleted before confirming. App falls back to legacy config after items are removed.

1. **Add `npm run config:inspect` command.** Dumps current Tier 1 items and effective resolved config (Tier 1 → secret → env var) for debugging.

## Phase 5 — Docs

1. **Update README** to document:
   - Three-tier configuration model
   - How to configure per-project routing in Benchling (add benchmark on what needs to happen)
   - `config:seed`, `config:clear`, `config:inspect` CLI commands
   - The fallback chain and backward compatibility guarantees
   - Integrated-mode IAM limitation: Tier 1 routes can only use buckets covered by the Quilt stack's BucketWritePolicy

1. **Add `app-manifest.yaml` entries** for any new App Configuration Items the app expects (declares them to Benchling).

---

## Test Plan

- **Unit tests**: Fallback chain resolution, project lookup, missing config items
- **Integration test**: Deploy, seed config, verify app reads Tier 1 values
- **No-Tier-1 test**: Deploy without seeding — everything works as before
- **Rollback test**: Deploy new, roll back to old image — old image works unaffected
