# Bucketless Linked-Package Search via Iceberg Tables

**Date**: 2026-07-04
**Status**: Proposed

## Problem

The current [bucketless linked-package search](04-bucketless-next-steps-and-blockers.md) uses an expensive fanout:

1. Lists all `{bucket}_packages-view` tables from Athena's `information_schema`
2. Fans out N concurrent Athena queries (up to 12 threads, one per bucket)
3. Each query uses `json_extract_scalar(user_meta, '$.key')` — raw JSON string parsing on the old parquet-backed views
4. Each query has a tight 10-second timeout
5. Risks hitting Athena's concurrent-DDL quota (20 per account)

This is slow, brittle, and doesn't scale to deployments with many buckets.

## Proposal

Replace the concurrent fanout with a **single Athena query** against the per-bucket Iceberg tables that the Quilt Platform already maintains.

### Background: Per-Bucket Iceberg Tables

The Quilt Platform 1.70.0+ maintains per-bucket Iceberg tables in a dedicated Glue database (`QUILT_ICEBERG_GLUE_DB`):

| Iceberg table | Columns | Analogous to |
|---|---|---|
| `{bucket}_package_manifest` | `top_hash`, `message`, `metadata` (STRUCT) | `_manifests` |
| `{bucket}_package_revision` | `pkg_name`, `timestamp`, `top_hash` | `_packages` |
| `{bucket}_package_tag` | `pkg_name`, `tag_name`, `top_hash` | `_packages` (named refs) |

Key advantage: `metadata` is a **native Athena STRUCT** column, not a raw JSON string. Querying `metadata.experiment_id` is schema-native — no `json_extract_scalar` overhead.

### Approach: Single UNION ALL Query

When the webhook is configured with an Iceberg database name (new config: `QUILT_ICEBERG_DATABASE`), the bucketless search path:

1. Lists all `{bucket}_package_manifest` tables from the Iceberg database via `information_schema.tables`
2. Builds a **single Athena query** that joins `package_revision` ↔ `package_manifest` via `top_hash`, UNION ALL across all buckets
3. Filters on `metadata.{key}` as a STRUCT field access
4. Returns the merged result — one Athena call, one result set

#### SQL shape

```sql
SELECT r.pkg_name, r.timestamp, m.message, m.metadata, '{bucket_a}' AS bucket
FROM "{iceberg_db}"."{bucket_a}_package_revision" r
JOIN "{iceberg_db}"."{bucket_a}_package_manifest" m ON r.top_hash = m.top_hash
WHERE m.metadata.{key} = '{value}'
  AND r.pkg_name IN (SELECT pkg_name FROM "{iceberg_db}"."{bucket_a}_package_tag" WHERE tag_name = 'latest')

UNION ALL

SELECT r.pkg_name, r.timestamp, m.message, m.metadata, '{bucket_b}' AS bucket
FROM "{iceberg_db}"."{bucket_b}_package_revision" r
JOIN "{iceberg_db}"."{bucket_b}_package_manifest" m ON r.top_hash = m.top_hash
WHERE m.metadata.{key} = '{value}'
  AND r.pkg_name IN (SELECT pkg_name FROM "{iceberg_db}"."{bucket_b}_package_tag" WHERE tag_name = 'latest')
```

### Fallback

If `QUILT_ICEBERG_DATABASE` is not set, fall back to the existing `_packages-view` fanout. This maintains backward compatibility with deployments that don't have Iceberg tables (pre-1.70.0).

### Performance Analysis

| Factor | Current fanout (parquet views) | Proposed (Iceberg) |
|---|---|---|
| Athena queries | N (one per bucket) | 1 |
| Metadata access | `json_extract_scalar` (parse JSON per row) | `metadata.{key}` (STRUCT, schema-native) |
| Scan type | Full table scan (parquet) | Iceberg partition pruning |
| Startup overhead | N × Athena query startup | 1 × Athena query startup |
| Concurrency risk | Hits DDL quota at 20+ buckets | One query, no quota risk |
| Timeout model | 10s per bucket (any slow bucket fails) | Single configurable timeout |

**Estimated improvement**: 10–50× faster for typical multi-bucket deployments, and more reliable (no partial failures).

### Config Changes

```python
# config.py — new optional property
quilt_iceberg_database: Optional[str]  # from QUILT_ICEBERG_DATABASE env var
```

### Implementation Plan

1. **`config.py`**: Add `quilt_iceberg_database` property reading `QUILT_ICEBERG_DATABASE`
2. **`package_query.py`**:
   - Accept `iceberg_database` in `__init__`
   - Add `_list_iceberg_manifest_buckets()` — discover tables from Iceberg Glue DB
   - Add `_find_unique_packages_in_iceberg()` — single UNION ALL query across all bucket manifests
   - Add `_packages_selected_from_iceberg()` — build the per-bucket subquery
   - Modify `_find_unique_packages_in_all_buckets()` (or `find_unique_packages()`) to prefer Iceberg path
3. **Tests**: Add bucketless + Iceberg test cases

### Open Questions

1. Should we query `package_revision` (all revisions) and filter by `package_tag WHERE tag_name = 'latest'`, or query `package_tag` directly and join through `package_revision`? The former returns one row per revision; the latter returns only the latest. The current `_packages-view` uses `timestamp = 'latest'` — analog: filter through `package_tag`.
2. What happens if a bucket has Iceberg tables but some are empty/stale? The UNION ALL query should handle empty result sets gracefully (they contribute zero rows).
3. Should we make the Iceberg query timeout configurable? The current 30s default should be fine for a single query.
4. Can we reduce table listing overhead by caching the Iceberg table list? Tables change infrequently (on bucket add/remove) — a 5-minute TTL cache would be safe.
