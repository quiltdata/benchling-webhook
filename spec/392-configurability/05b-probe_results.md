# Probe Results: `list_app_configuration_items`

Run `2026-07-02`, profile `dev`, tenant `quilt-dtt`.

---

## Exec Summary

| Question | Answer |
|----------|--------|
| Is `appDefinitionId` the same as `app_id`? | **No** — HTTP 400 `invalidId` |
| What is the correct `app_id`? | The **tenanted installation `id`** (format `app_XXXXX`) from `list_apps()` |
| How do we find it at startup? | `list_apps()` → match `app.app_definition.id == secrets.app_definition_id` |
| Can we create config items? | **No** (yet) — the path must match a pre-defined configuration schema/definition |

---

## Probe Script

Written at [`docker/scripts/probe_config_items.py`](../../docker/scripts/probe_config_items.py).

Run (from repo root):

```bash
cd docker && uv run python -m scripts.probe_config_items --profile dev [--seed]
```

- `--seed` attempts to create test config items (fails — schema not defined)
- `--verbose` / `-v` prints progress to stderr
- Exits 0 if any candidate succeeded, 1 if all failed

---

## Results

### Metadata

```json
{
  "profile": "dev",
  "tenant": "quilt-dtt",
  "app_definition_id": "appdef_wqFfaXBVMu",
  "installed_apps": [
    { "id": "app_lTvdpW99kWi3LWg9", "name": "nightly-quilttest-com",   "app_definition_id": "appdef_wqFfaXBVMu" },
    { "id": "app_VJVPr9y2kLZRYrIz", "name": "nightly-quilttest2-com",  "app_definition_id": "appdef_17TwAmkFbAO" },
    { "id": "app_oqVe5IOvjAwdjslZ", "name": "open-quiltdata-com",      "app_definition_id": "appdef_13k4O0m8gyG" },
    { "id": "app_9pQRdGFci4N1A4RM", "name": "quilt-docker",            "app_definition_id": "appdef_15F3yJpAblA" }
  ]
}
```

**Key:** Our app (`appdef_wqFfaXBVMu`) is installed as `app_lTvdpW99kWi3LWg9` / `nightly-quilttest-com`.

### Candidate 1 — `appDefinitionId`

| Field | Value |
|-------|-------|
| Candidate | `appDefinitionId` |
| HTTP status | **400** |
| Error | `appId: appdef_wqFfaXBVMu is invalid` |

**Verdict:** `appDefinitionId` (format `appdef_XXXXX`) is **not** the `app_id` parameter. The API expects a different ID format.

### Candidate 2 — `list_apps()` enumeration

| Field | Value |
|-------|-------|
| Candidate | `app.id (name=nightly-quilttest-com)` |
| HTTP status | **200** |
| Items returned | **0** (not yet seeded) |

| Field | Value |
|-------|-------|
| Candidate | `app.id (name=nightly-quilttest2-com)` |
| HTTP status | **200** |
| Items returned | **0** |

| Field | Value |
|-------|-------|
| Candidate | `app.id (name=open-quiltdata-com)` |
| HTTP status | **200** |
| Items returned | **0** |

| Field | Value |
|-------|-------|
| Candidate | `app.id (name=quilt-docker)` |
| HTTP status | **200** |
| Items returned | **0** |

**Verdict:** The tenanted installation `id` (format `app_XXXXX`) is the correct `app_id` parameter. All four installed apps responded with HTTP 200, returning 0 items (nothing configured yet).

### Candidate 3 — No `app_id` filter

| Field | Value |
|-------|-------|
| Candidate | `no_app_id` |
| HTTP status | **200** |
| Items returned | **0** |

**Verdict:** Calling without an `app_id` also works and returns config items across all apps.

### Candidate 4 — Seed round-trip (attempted)

Creating config items via `AppConfigItemGenericCreate` with arbitrary paths failed:

```
BenchlingError: Expected exactly one config to match given path ('probe-test',)
```

**Why:** Benchling's app configuration requires a **pre-defined configuration schema**. The `path` must exactly match an existing configuration definition (created via the Benchling UI or a schema API call). Arbitrary paths are rejected.

---

## Conclusions for Phase 1 Implementation

1. **`app_id` source at startup:**

   Do **not** use `app_definition_id` from the secret directly. Instead:
   
   ```python
   # Find our app by matching app_definition_id
   for page in benchling.apps.list_apps():
       for app in page:
           if app.app_definition.id == secrets.app_definition_id:
               our_app_id = app.id  # e.g., "app_lTvdpW99kWi3LWg9"
               break
   ```

   This `our_app_id` is the correct value to pass to `list_app_configuration_items(app_id=...)`.

2. **API compatibility:**

   | Call | Status | Notes |
   |------|--------|-------|
   | `list_app_configuration_items(app_id=app_XXXXX)` | ✅ 200 | Filtered to one app |
   | `list_app_configuration_items(app_id=appdef_XXXXX)` | ❌ 400 | Wrong ID format |
   | `list_app_configuration_items()` | ✅ 200 | Returns items for all apps |

3. **Configuration items:**

   - All apps currently have 0 config items.
   - To seed items, the app needs a **configuration schema/definition** first.
   - Creating items from scratch via the SDK is blocked until the schema exists.
   - Phase 1 implementation should plan for this: either define the schema via the Benchling UI, or create it programmatically during deployment.

4. **Implementation checklist update:**

   In [`06-configurability-checklist.md`](06-configurability-checklist.md), resolve Task 1:
   
   > **How to find `app_id`:** List installed apps with `list_apps()`, match `app.app_definition.id` to the `app_definition_id` from the Benchling secret, then use the matched `app.id`.

---

## SDK Gotchas

- **`PageIterator` yields pages, not items:** Each iteration gives `List[Model]` (a page). Flatten with `[item for page in iterator for item in page]`.
- **`AppConfigItem.app.name` is in `additional_properties`:** The `app` attribute's `name` field may not be a direct property — use `app.get("name")` as fallback.
- **No delete endpoint:** The SDK has `archive_app_configuration_items` commented out (TODO BNCH-52599). Items created during testing must be cleaned up manually via the Benchling UI.
