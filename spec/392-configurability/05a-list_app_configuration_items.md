# Define: `list_app_configuration_items` Probe

## Objective

Determine the correct `app_id` parameter for `benchling.apps.list_app_configuration_items()` so Phase 1 implementation is unblocked. Specifically:

1. Is `appDefinitionId` (from the Benchling secret) the same as the `app_id` the API expects?
2. If not, what is — and where do we get it?
3. What does a successful response look like (structure, fields, path convention)?
4. Does `list_app_configuration_items` return items scoped to the calling app, or to any app?

---

## How to run

From the repo root with a working `dev` profile and local Docker:

```bash
# Ensure docker/.venv is active and BenchlingSecret env var is set
cd docker
source .venv/bin/activate

# Run the probe script
python -m scripts.probe_config_items
```

The script reads the existing Benchling secret from AWS Secrets Manager, creates a Benchling SDK client (same as the running app does), then calls `list_app_configuration_items` with several candidate identifiers and logs the results.

---

## What to try

### Candidate 1 — `appDefinitionId`

This is stored in the Benchling secret as `app_definition_id` and used at runtime for JWKS fetching and HMAC verification. Try:

```python
items = benchling.apps.list_app_configuration_items(app_id=app_definition_id)
```

### Candidate 2 — `list_apps()` iteration

If Candidate 1 returns empty or errors, enumerate installed apps and inspect their IDs:

```python
apps = benchling.apps.list_apps()
for app in apps:
    print(f"  id={app.id}  name={app.name}  app_definition_id={app.app_definition_id}")
    items = benchling.apps.list_app_configuration_items(app_id=app.id)
    print(f"    -> {len(items)} config items")
```

This tells us whether our Benchling app has a different `id` than its `app_definition_id`.

### Candidate 3 — No filter (optional, may fail)

If the API supports omitting `app_id`:

```python
items = benchling.apps.list_app_configuration_items()
```

### Candidate 4 — By config item `ids` filter

If we know a config item ID exists, fetch it directly:

```python
item = benchling.apps.get_app_configuration_item_by_id("cfg_...")
print(f"  app_id={item.app.id}  path={item.path}")
```

---

## What to record

For each candidate, record:

| Field | Value |
|-------|-------|
| Candidate | e.g. `appDefinitionId` |
| HTTP status | 200 / 403 / 404 |
| Error message | if any |
| Items returned | count |
| First item `id` | `cfg_...` |
| First item `path` | `["..."]` |
| First item `app.id` | The app_id on the returned item |
| First item `app.name` | App name on the returned item |
| First item `value` | (masked if sensitive) |

---

## Expected outputs

### Success — items exist

```json
{
  "status": "ok",
  "app_id_used": "app_def_abc123",
  "total_items": 0,
  "items": []
}
```

### Success — items exist (once seeded)

```json
{
  "status": "ok",
  "app_id_used": "app_def_abc123",
  "total_items": 2,
  "items": [
    {
      "id": "cfg_item_xyz",
      "path": ["routing", "default", "bucket"],
      "value": "my-bucket",
      "app": { "id": "app_…", "name": "Benchling Webhook" }
    }
  ]
}
```

### Error — wrong identifier

```json
{
  "status": "error",
  "candidate": "appDefinitionId",
  "http_status": 404,
  "message": "App not found"
}
```

---

## What to do with the result

Once the probe identifies the correct `app_id` source, update:

1. **`06-configurability-checklist.md`** — resolve task 1's `app_id` source comment with the actual answer
2. **`02-bw-configurability.md`** — if the `app_id` flows through a new env var, add it to the env var table
3. **Implementation** — the Phase 1 startup code will use the identified source

---

## Probe script location

Write the probe as `docker/scripts/probe_config_items.py`. It should:
- Accept `--profile` (default `dev`) to load XDG config
- Read existing Benchling secret from AWS Secrets Manager
- Create a Benchling SDK client (same auth as the running app)
- Try candidates 1–3 above
- Print results as structured JSON to stdout
- Exit 0 on success, 1 if all candidates fail
