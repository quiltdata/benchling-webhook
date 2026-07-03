# Issue 392 — Configurability Implementation Checklist

Hand-off document for a code implementation agent. Context is in `spec/392-configurability/01`–`05`.

## Constraint

Phases can be developed independently but **all phases deploy together** in one release. Nothing is deployed until everything is ready.

---

## Prerequisite

**Probe complete — see [`05b-probe_results.md`](05b-probe_results.md).** Key finding: `appDefinitionId` (format `appdef_XXXXX`) is NOT the `app_id` for config items. The correct value is the tenanted installation `id` (format `app_XXXXX`), discovered by calling `list_apps()` and matching `app.app_definition.id` to the `app_definition_id` from the Benchling secret.

**Hard prerequisite: Define and deploy config schema paths in `app-manifest.yaml`.** The Benchling SDK rejects `AppConfigItemGenericCreate` calls whose `path` doesn't match a pre-defined configuration schema/definition (see [`05b-probe_results.md`](05b-probe_results.md)). Before any seeding or config-item writes, the exact App Configuration schema paths/types must be declared in [`docker/app-manifest.yaml`](../../docker/app-manifest.yaml), then the app must be deployed/updated so Benchling registers the schema. Only then will `config:seed` work. The write-side features below assume this is done.

## Implementation Status

- [x] Runtime read path, routing model, fallback chain, cache, and invalidation implemented.
- [x] Per-project routing implemented for entry-backed events with graceful fallback.
- [x] Profile/CDK `packages.extraBuckets` IAM support implemented for standalone stacks.
- [x] CLI inspection/seeding/manual-clear helpers implemented.
- [x] README documentation added.
- [x] Unit tests added for routing model, queue metadata, and app ID matching.
- [ ] Benchling App Configuration schema definitions still need to be added to `docker/app-manifest.yaml` and deployed before `config:seed` can create items.

---

## Phase 1 — App Config Items Read Path (Python runtime)

- [x] **Add `benchling.apps.list_app_configuration_items()` call** at app startup in Docker Python code. Fetch all config items scoped to our app using the `app.id` matched from `list_apps()` (`app.app_definition.id == secrets.app_definition_id`), **not** the `appDefinitionId` directly. See [`05b-probe_results.md`](05b-probe_results.md) for details.

- [x] **Build a `RoutingConfig` model** from the config items, keyed by `path` convention:
   - `["quilt", "routing", "<event-type>", "<key>"]` — event-type routing
   - `["quilt", "projects", "<project-name>", "<key>"]` — per-project routing
   - `["quilt", "settings", "<key>"]` — global settings (log level, concurrency)
   - `["quilt", "default", "<key>"]` — fallback values

   All paths are namespaced under `"quilt"` so `config:clear` can safely target only our items (SDK has no delete/archive path yet, so `config:clear` may only be an inspect/manual-cleanup helper unless API support is added).

- [x] **Implement a fallback chain** — for each config value:

   ```text
   Tier 1 (App Config Item) → Tier 2 (Secrets Manager) → Tier 3 (env var / hardcoded default)
   ```

   If the App Config Items API fails or returns empty, behavior is unchanged.

- [x] **Replace hardcoded `PACKAGE_EVENT_CONCURRENCY` and `PACKAGING_REQUEST_CONCURRENCY`** with Tier 1 lookup, falling back to current `"5"` default.

- [x] **Replace `LOG_LEVEL`** with Tier 1 lookup, falling back to secret's `log_level`, falling back to `"INFO"`.

- [x] **Cache Tier 1 config with a 60s TTL** and stale-while-refresh semantics, matching the existing `secrets_manager.py` pattern:
   - On first call: block and fetch
   - Within TTL: return cached value
   - Past TTL, stale value exists: return stale, kick off background refresh thread
   - The `app_id` is also cached; if it needs to change the container restarts anyway

- [x] **Invalidate Tier 1 cache on config lifecycle events.** The app already routes `v2-beta.app.configuration.updated` in [`app.py`](../../docker/src/app.py) — wire this handler to flush the Tier 1 cache so config changes take effect immediately instead of waiting up to 60s for TTL expiry.

## Phase 2 — Per-Project Routing (Python runtime)

- [x] **Resolve project from entry, but only for entry events with a folder.** Not all webhook events are entry-backed. Gate project lookup on `entry.folder_id` being present:
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

- [x] **Apply project routing overrides with defined merge rules.** Precedence (highest → lowest):

   ```text
   Project override → Event-type default → Global default → Legacy fallback
   ```

   **Merge strategy:** field-level merge, not whole-object replace. If a project rule sets only `bucket`, the `prefix` and `workflow` inherit from the event-type or global default. Supported event types: `v2.entry.created`, `v2.entry.updated.fields`, `v2.entry.updated.reviewRecord` (matches existing `supported_event_types` set in [`app.py`](../../docker/src/app.py)).

- [x] **Handle project lookup failure gracefully.** If folder/project API calls fail (network error, deleted folder, missing permissions), log the error and use event-type defaults. Must not crash the webhook handler.

## Phase 3 — ProfileConfig / CDK Changes

- [x] **Add `packages.extraBuckets` to `ProfileConfig`.** An optional list of additional S3 bucket names that the stack needs IAM permissions for (for per-project multi-bucket routing). No auto-creation — operator lists existing buckets.

- [x] **Pass extra buckets through `StackConfig`** to the CDK stack. Add IAM policy statements for each listed bucket (same permissions as the primary `packages.bucket`).

- [x] **Add integrated-mode guard for IAM changes.** When `integratedStack: true`, the Quilt stack owns IAM. Deploy should print a warning that `packages.extraBuckets` is ignored in integrated mode — Tier 1 routes pointing at undeclared buckets will fail at runtime. Validation docs task should cover this.

- [x] **Keep all existing CfnParameters.** No removals. They become deploy-time overrides and runtime fallbacks.

## Phase 4 — CLI: Seed / Clear App Config

- [x] **Add `npm run config:seed` command.** Reads current routing values from `ProfileConfig` + Secrets Manager, creates/updates equivalent App Configuration Items in Benchling via the SDK. **Prerequisite:** The app's configuration schema paths must be defined (see hard Prerequisite section above) — without them the SDK rejects arbitrary paths. Prints the Benchling UI URL where items can be edited.

- [x] **Add `npm run config:clear` command** — **only if the Benchling SDK adds a usable delete/archive endpoint.** As of probe date ([`05b-probe_results.md`](05b-probe_results.md)), `archive_app_configuration_items` is commented out (TODO BNCH-52599) and no SDK delete path exists. If support is still absent when implementing:
   - Provide a dry-run inspection command (`config:inspect --items`) that lists all items under the `["quilt"]` namespace and prints the Benchling UI URL for manual cleanup.
   - Document the manual cleanup process.
   - Skip the `--force` / auto-clear path entirely.

- [x] **Add `npm run config:inspect` command.** Dumps current Tier 1 items and effective resolved config (Tier 1 → secret → env var) for debugging.

## Phase 5 — Docs

- [x] **Update README** to document:
   - Three-tier configuration model
   - How to configure per-project routing in Benchling (add benchmark on what needs to happen)
   - `config:seed`, `config:clear`, `config:inspect` CLI commands
   - The fallback chain and backward compatibility guarantees
   - Integrated-mode IAM limitation: Tier 1 routes can only use buckets covered by the Quilt stack's BucketWritePolicy

---

## Test Plan

- [x] **Unit tests**: Fallback chain resolution, project lookup, missing config items
- [ ] **Integration test**: Deploy, seed config, verify app reads Tier 1 values
- [ ] **No-Tier-1 test**: Deploy without seeding — everything works as before
- [ ] **Rollback test**: Deploy new, roll back to old image — old image works unaffected
