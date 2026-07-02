# Benchling as a Configuration Source

## Question

Can users store configuration information inside Benchling itself — e.g. in projects, entry fields, or app settings — that the webhook can pull at runtime, rather than (or in addition to) the webhook's own config files and Secrets Manager secrets?

## Executive Summary

**Yes, there is one excellent first-party mechanism and several indirect ones.** The strongest candidate is the **App Configuration Items** API — a native key-value store scoped to a Benchling app that is editable through the Benchling UI and readable at runtime via the SDK. This is purpose-built for what issue #392 needs.

The full landscape of Benchling-hosted data sources:

| Source | Configurable via UI? | Read via API? | Purpose-built for config? | Recommendation |
|--------|---------------------|---------------|--------------------------|----------------|
| **App Configuration Items** | ✅ App settings page | ✅ `benchling.apps.*` | ✅ Yes | ⭐ **Primary candidate** |
| **Project (via folder)** | ✅ Project list / folder tree | ✅ Entry → Folder → Project API | ✅ Yes — natural organizational unit | ⭐ **Primary for per-project routing** |
| **Entity schemas** | ✅ Schema designer | ✅ `benchling.schemas.*` | ❌ No (schema definitions) | Use to discover entry type for routing |
| **Entry custom fields** | ✅ Entry editor | ✅ Entry API `fields` | ❌ No (data, not config) | Not recommended for routing config |
| **Folders** | ✅ Folder tree | ✅ `benchling.folders.*` | ⚠️ Partial (hierarchy only) | Weak — naming conventions fragile |
| **Dropdowns** | ✅ Dropdown designer | ✅ `benchling.dropdowns.*` | ⚠️ Partial (option lists) | Use for enumeration values |
| **Entry schema name/template** | ✅ Schema designer | ✅ Entry API `schema` | ❌ No | Useful as routing dimension |

---

## 1. ⭐ App Configuration Items (Primary Recommendation)

### What It Is

Benchling has a first-party **App Configuration** API (`/app-configuration-items`) that acts as a structured key-value store scoped to a Benchling application. It's designed for exactly this purpose — apps storing runtime configuration that can be read programmatically.

### SDK Access

Available through `benchling.apps.*` in the Benchling Python SDK:

```python
# List all config items for the app
items = benchling.apps.list_app_configuration_items(app_id=our_app_id)

# Get a specific item by ID
item = benchling.apps.get_app_configuration_item_by_id("cfg_xyz123")

# Create a config item
from benchling_sdk.models import AppConfigItemJsonCreate, JsonAppConfigItemType
item = benchling.apps.create_app_configuration_item(
    AppConfigItemJsonCreate(
        path=["workflows", "entry_created", "bucket"],
        value="my-experiment-bucket",
        description="S3 bucket for entry.created events",
    )
)

# Bulk operations (async task)
from benchling_sdk.models import AppConfigItemCreate
task = benchling.apps.bulk_create_app_configuration_items([
    AppConfigItemJsonCreate(path=["..."]),
    AppConfigItemBooleanCreate(path=["..."], value=True),
])
```

### Supported Value Types

| Type | SDK Model | Use Case |
|------|-----------|----------|
| **JSON** | `JsonAppConfigItem` | Arbitrary structured config — best for complex routing rules |
| **Text** | `TextAppConfigItem` | Single string values (bucket names, prefixes) |
| **Secure Text** | `SecureTextAppConfigItem` | Encrypted values (API keys, passwords) |
| **Boolean** | `BooleanAppConfigItem` | Feature flags, toggles |
| **Integer** | `IntegerAppConfigItem` | Numeric limits, counts |
| **Float** | `FloatAppConfigItem` | Decimal values |
| **Date** / **Datetime** | `DateAppConfigItem` / `DatetimeAppConfigItem` | Scheduling, timestamps |
| **Entity Schema** | `EntitySchemaAppConfigItem` | Reference to an entity schema |
| **Field** | `FieldAppConfigItem` | Reference to a specific schema field |
| **Array Element** | `ArrayElementAppConfigItem` | List elements |

### Path Hierarchy

Config items use a **path** field (array of strings) for hierarchical addressing, similar to a filesystem or JSON path:

```python
# Naming convention: ["domain", "workflow", "key"]
path=["routing", "entry.created", "target_bucket"]
path=["routing", "v2.canvas.userInteracted", "workflow"]
path=["scheduling", "retry_delay_seconds"]
path=["features", "use_new_packager"]
```

This makes it natural to model "configurable workflows" — one hierarchy level for the event type/workflow, another for the specific setting.

### How Users Set Values

App Configuration Items are editable through the **Benchling App Configuration UI** — the same place where app setup screens appear. Users (or admins) can change values without touching AWS or our config files.

### Constraints & Considerations

| Factor | Detail |
|--------|--------|
| **App-scoped** | Items are tied to a specific Benchling app (identified by `app_id`). Our app's config items are isolated from other apps. |
| **Access control** | Items inherit the app's permissions — same users who can install/configure the app can read items. |
| **Rate limits** | Standard Benchling API rate limits apply. Bulk operations are async (return a task). |
| **No events** | Changing a config item does not emit a webhook — the app must poll or cache values. |
| **No CloudFormation** | These items are purely in Benchling; the CDK stack cannot read them at deploy time. |
| **SDK version** | Available in `benchling-api-client` ≥1.23.1 (which we already use). |

### How It Would Work in Practice

```
┌─────────────────┐     deploy-time     ┌──────────────────┐
│  ProfileConfig   │ ──────────────────→ │  CDK Stack        │
│  (XDG file)      │                     │  (infrastructure) │
└─────────────────┘                     └──────────────────┘
                                                    │
                                          (env vars for AWS
                                           service endpoints)
                                                    ▼
┌─────────────────┐     runtime         ┌──────────────────┐
│  Benchling App   │ ←──────────────── │  Python App        │
│  Config Items    │  benchling.apps.   │  (webhook handler) │
│  (key-value)     │  list_app_config…  │                    │
└─────────────────┘                     └──────────────────┘
```

The webhook handler at startup (or on each event) fetches relevant config items from Benchling using the SDK client it already has, then dispatches based on those rules. Changes made in the Benchling UI take effect on the next webhook event (no redeploy needed).

---

## 2. Entry Fields (Per-Event Routing Hints)

### What It Is

Every Benchling entry has **fields** — structured data defined by its schema. Fields can be text, dropdowns, numbers, dates, entities, etc. The webhook already fetches entry data via `benchling.entries.get_entry_by_id()` in `entry_packager.py`.

### Existing Usage

In `entry_references.py`, we already parse entry fields to discover links to other entities. The `entry_packager.py` fetches the full entry dict including `fields`.

### Configuration Opportunities

A schema designer could add a field like "Quilt Target Bucket" (dropdown) or "Quilt Workflow" (text) to entry schemas. The webhook then reads that field value from the entry data and uses it to route:

```python
entry = benchling.entries.get_entry_by_id(entry_id)
target_bucket = entry.fields.get("quilt_target_bucket")
workflow_name = entry.fields.get("quilt_workflow")
```

### Constraints

| Factor | Detail |
|--------|--------|
| **Per-entry** | Values are set per entry, not globally — good for per-experiment routing, bad for global defaults |
| **Schema-dependent** | The field must exist in the entry's schema; different schemas may not have the field |
| **UI-native** | Users set values naturally in the Benchling entry editor |
| **No namespace collision** | Field names are scoped per schema — but prefixing with `quilt_` is wise |
| **Fetched on every event** | We already fetch the entry — the field value comes for free |

### When to Use

- Per-experiment bucket routing ("this experiment goes to bucket A, that one to bucket B")
- Per-entry workflow selection
- As a complement to global config (entry-level override)

---

## 3. Entity Schemas (Discovering Structure)

### What It Is

Entity schemas define the field structure for entries in a registry. The SDK provides `benchling.schemas.*` with methods like `list_entry_schemas()`, `get_entry_schema()`, `list_entity_schemas()`.

### Configuration Opportunities

- **Schema discovery**: The webhook could discover which schemas exist and use schema names/IDs as routing dimensions
- **Field type inspection**: Check if a schema has a certain field before trying to read it
- **Template matching**: Route entries based on which entry template they were created from (`entry_template_id` on the Entry model)

```python
# Discover schema for a given entry
entry_schema = entry.schema  # Available on fetched Entry
if entry_schema and entry_schema.name == "Sequencing Results":
    # Apply sequencing-specific routing
    ...
```

### Constraints

- Read-only — schemas are created by Benchling admins in the Schema Designer
- Schema names can change; IDs are stable

---

## 4. Projects (Primary Per-Project Routing Dimension)

### The Entry → Folder → Project Chain

The Entry model does **not** have a `project_id` directly, but the chain is straightforward:

```text
Entry.folder_id → Folder → Folder.project_id → Project
```

The **Folder** model (`benchling_api_client/models/folder.py`) has exactly the fields needed:

```python
class Folder:
    id: str
    name: str
    parent_folder_id: str | None  # For nested folder trees
    project_id: str               # The project this folder belongs to
```

The **Project** model (`benchling_api_client/models/project.py`) is simpler — mostly metadata:

```python
class Project:
    id: str
    name: str
    owner: Organization | UserSummary
    archive_record: ArchiveRecord | None
    # No custom fields, no tags, no key-value storage
```

### How to Resolve at Runtime

```python
# 1. Entry comes in via webhook — we already fetch it
entry = benchling.entries.get_entry_by_id(entry_id)

# 2. Get the folder to find the project
folder = benchling.folders.get_by_id(entry.folder_id)

# 3. Read the project_id
project_id = folder.project_id

# 4. (Optional) Get the project name for human-readable routing
project = benchling.projects.get_by_id(project_id)
project_name = project.name  # e.g. "Drug X Phase 2 Study"
```

### Configuration Opportunities

The **project name** (or ID) is a stable routing dimension. Map project names to routing rules in **App Configuration Items**:

```json
{
  "project_routing": {
    "Drug X Phase 2 Study": {
      "bucket": "quilt-drugx-phase2",
      "workflow": "clinical-pipeline",
      "prefix": "drugx"
    },
    "Cell Line Screening": {
      "bucket": "quilt-cell-line-screening",
      "workflow": "screening-pipeline",
      "prefix": "screening"
    }
  },
  "default": {
    "bucket": "quilt-benchling-default",
    "workflow": "",
    "prefix": "benchling"
  }
}
```

### Why Projects Work Well

| Factor | Detail |
|-------- | -------- |
| **Stable** | Project names change less often than entries or experiments |
| **Organizational** | Projects map to real teams/studies/screens — the right unit for routing |
| **Natural UX** | Users organize work by project; routing by project matches mental model |
| **No per-entry burden** | All entries in a project automatically get the same routing — no manual per-entry config |
| **Cachable** | Project ID lookup is a fast API call; results can be cached per event batch |

---

## 5. Folders (Weak, Hierarchy Only)

### What It Is

Folders organize entries in a tree. The SDK provides `benchling.folders.*` with `get_folder()`, `list_folders()`. Like projects, the model is minimal: `id`, `name`, `parent_folder_id`, `archive_record`.

### Configuration Opportunities

The folder hierarchy could be used as a routing dimension:

```python
entry = benchling.entries.get_entry_by_id(entry_id)
folder_id = entry.folder_id
if folder_id:
    folder = benchling.folders.get_folder(folder_id)
    # Walk up folder tree for convention-based routing
    # e.g., /Projects/ABC123/QuiltConfig → discover routing rules
```

### Why It's Weak

- No custom fields or metadata on folders
- Walking the folder tree is fragile (folder names change, are reorganized)
- Not a natural configuration surface
- Requires the user to maintain a naming convention

---

## 6. Dropdowns (Enumerated Values)

### What It Is

Dropdowns are reusable option lists in Benchling. The SDK provides `benchling.dropdowns.*`. Each dropdown has a name and a list of options.

### Configuration Opportunities

Useful as a source of enumerated values for routing configuration:

```python
dropdowns = benchling.dropdowns.list_dropdowns()
for d in dropdowns:
    if d.name == "Quilt Target Buckets":
        # Options define valid bucket targets
        for option in d.options:
            valid_buckets.append(option.name)
```

### Constraints

- Dropdowns define option *lists*, not key-value config
- No mechanism to associate a dropdown option with a configuration value (other than the option name)
- Best used in combination with entry fields (dropdown field → select value → route)

---

## Recommended Architecture for Issue #392

### Tier 1: App Configuration Items (global defaults)

Use App Configuration Items for global routing rules that apply to all entries (or for mapping project names to routing rules):

```python
# Fetch routing rules at startup
config_items = benchling.apps.list_app_configuration_items(app_id=our_app_id)
routing_rules = {}
for item in config_items:
    if item.path[0] == "routing":
        # {"routing": {"entry.created": {"bucket": "bucket-a", "workflow": "alpha"}}}
        pass
```

**Advantages:** Editable via Benchling UI, structured values, scoped to our app.

### Tier 2: Per-Project Routing (via folder → project chain)

Use the entry's folder → project chain to look up project-specific routing rules in App Configuration Items:

```python
# 1. Fetch the entry (already done)
entry = benchling.entries.get_entry_by_id(entry_id)

# 2. Walk folder → project
folder = benchling.folders.get_by_id(entry.folder_id)
project = benchling.projects.get_by_id(folder.project_id)

# 3. Look up routing rules for this project
#    (from Tier 1 config items, cached at startup)
project_rules = routing_rules.get("projects", {}).get(project.name, routing_rules.get("default"))
```

**Advantages:** Zero per-entry config — all entries in a project inherit its routing. Matches how users naturally organize work.

### Tier 3: Secrets Manager (sensitive, infrastructure-level)

Keep sensitive/static config in AWS Secrets Manager as today:

- Benchling OAuth credentials (client_id, client_secret)
- Infrastructure references (bucket ARNs, queue URLs)
- Default values that shouldn't change without deploy review

### Not Recommended for Config Storage

- **Projects** — too little metadata, wrong abstraction
- **Folders** — fragile naming conventions, no structured storage
- **Standalone dropdowns** — option lists, not key-value

---

## What This Means for "No Auto-Creation"

The "no auto-creation" goal is about **infrastructure** (buckets, workgroups, queues) — not about configuration. App Configuration Items are the right tool for configuring *how* the webhook uses infrastructure, but the deploy-time check that referenced resources actually exist is still a CDK/infrastructure concern. These are orthogonal.

---

## What This Means for "Multiple Buckets"

App Configuration Items can define the bucket-per-event-type and bucket-per-project mapping:

```json
{
  "routing": {
    "entry.created":     { "bucket": "quilt-benchling-experiments" },
    "entry.updated":     { "bucket": "quilt-benchling-experiments" },
    "v2.canvas.userInteracted": {
      "bucket": "quilt-benchling-canvases",
      "workflow": "canvas-workflow"
    }
  },
  "projects": {
    "Drug X Phase 2":  { "bucket": "quilt-drugx-phase2", "prefix": "drugx" },
    "Cell Screening":  { "bucket": "quilt-screening",    "prefix": "screen" }
  }
}
```

The CDK stack still needs IAM permissions for all possible buckets at deploy time, but the routing logic lives in Benchling.

---

## What This Means for "Configurable Workflows"

A workflow configuration stored in App Configuration Items could look like:

```json
{
  "workflows": {
    "default": {
      "package_prefix": "benchling",
      "metadata_key": "experiment_id",
      "workflow_name": ""
    },
    "sequencing": {
      "event_types": ["entry.created", "entry.updated.fields"],
      "schema_filter": ["Sequencing Results", "QC Report"],
      "package_prefix": "sequencing",
      "metadata_key": "run_id",
      "workflow_name": "fastq-pipeline"
    },
    "canvas_interaction": {
      "event_types": ["v2.canvas.userInteracted"],
      "package_prefix": "interactive",
      "metadata_key": "experiment_id",
      "workflow_name": ""
    }
  }
}
```

---

## Related SDK Models

Found in `benchling_api_client` and `benchling_sdk` (already installed, version ≥1.23.1):

### API Endpoints (in `benchling_api_client/api/apps/`)
- `list_app_configuration_items.py` — List with `app_id`, `ids`, `modified_at` filters
- `get_app_configuration_item_by_id.py` — Get single item
- `create_app_configuration_item.py` — Create (supports 8+ value types)
- `update_app_configuration_item.py` — Update existing
- `bulk_create_app_configuration_items.py` — Async bulk create
- `bulk_update_app_configuration_items.py` — Async bulk update

### SDK Service (`benchling_sdk/services/v2/stable/app_service.py`)
- `benchling.apps.list_app_configuration_items(app_id=...)`
- `benchling.apps.get_app_configuration_item_by_id(item_id)`
- `benchling.apps.create_app_configuration_item(...)`
- `benchling.apps.update_app_configuration_item(...)`
- `benchling.apps.bulk_create_app_configuration_items(...)`
- `benchling.apps.bulk_update_app_configuration_items(...)`

### Value Type Models
- `JsonAppConfigItem` — Structured JSON, ideal for complex routing rules
- `TextAppConfigItem` — String values
- `SecureTextAppConfigItem` — Encrypted values
- `BooleanAppConfigItem` — Feature flags
- `IntegerAppConfigItem` / `FloatAppConfigItem` — Numeric
- `DateAppConfigItem` / `DatetimeAppConfigItem` — Temporal
- `EntitySchemaAppConfigItem` — Schema references
- `FieldAppConfigItem` — Field references
- `ArrayElementAppConfigItem` — List elements

### Entry/Field Models
- `Entry` — `fields` (dict of name → Field), `folder_id`, `schema`, `display_id`
- `Field` — `value` (Any), `display_value`, `type`, `text_value`
- `Fields` — Dict[str, Field] on the Entry model
- `EntrySchema` — `id`, `name`, `modified_at`

---

## Key Takeaway

**App Configuration Items are the right tool for configurable workflows/multi-bucket routing.** They are:
1. Native to Benchling — purpose-built for app configuration storage
2. Editable through the Benchling UI — no AWS console access needed
3. Readable at runtime — using the SDK client we already have
4. Structured — JSON items can hold arbitrary routing rule trees
5. Scoped — tied to our app, isolated from other apps

Entry custom fields complement this by enabling per-entry overrides. The two together cover the full range from "global defaults" to "per-experiment routing."
