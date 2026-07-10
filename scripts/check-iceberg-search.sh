#!/usr/bin/env bash
#
# check-iceberg-search.sh — Probe the bucketless Iceberg package search end-to-end.
#
# Reproduces exactly what the container's PackageQuery._build_iceberg_union_query
# runs when refreshing a bucketless canvas, so you can confirm (outside the
# service) that:
#   1. the Iceberg package_manifest tables exist,
#   2. the `metadata` column is a JSON *string* (not a native STRUCT), and
#   3. the json_extract_scalar filter returns the expected linked package.
#
# Background: metadata is populated from `user_meta AS metadata`
# (quilt_shared.iceberg_queries), i.e. a raw JSON string. Filtering it as a
# STRUCT (`m.metadata.<key>`) raises:
#     TYPE_MISMATCH: Expression m.metadata is not of type ROW
# which surfaces in the canvas as "Failed to search for linked packages".
# This script verifies the json_extract_scalar form that avoids that.
#
# Config is read from the profile at ~/.config/benchling-webhook/<profile>/config.json
# (quilt.icebergDatabase is the Iceberg Glue database, matching QUILT_ICEBERG_DATABASE
# at runtime; falls back to quilt.database when the Iceberg field is absent).
#
# Usage:
#   scripts/check-iceberg-search.sh --value EXP26000016
#   scripts/check-iceberg-search.sh --profile bucketless --value EXP26000016
#   scripts/check-iceberg-search.sh --profile bucketless --key experiment_id --value EXP26000016
#   scripts/check-iceberg-search.sh --profile bucketless --value EXP26000016 --show-buggy
#
# Options:
#   --profile <name>   Profile under ~/.config/benchling-webhook (default: default)
#   --key <name>       Metadata key to filter on (default: packages.metadataKey from config)
#   --value <val>      Metadata value to match (required)
#   --database <name>  Override Iceberg Glue database (default: quilt.icebergDatabase, then quilt.database)
#   --region <name>    Override AWS region (default: quilt.region from config)
#   --workgroup <name> Override Athena workgroup (default: quilt.athenaUserWorkgroup from config)
#   --show-buggy       Also run the old STRUCT-access form to demonstrate the failure
#
set -euo pipefail

PROFILE="default"
KEY=""
VALUE=""
DATABASE=""
REGION=""
WORKGROUP=""
SHOW_BUGGY="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile)   PROFILE="$2"; shift 2 ;;
        --key)       KEY="$2"; shift 2 ;;
        --value)     VALUE="$2"; shift 2 ;;
        --database)  DATABASE="$2"; shift 2 ;;
        --region)    REGION="$2"; shift 2 ;;
        --workgroup) WORKGROUP="$2"; shift 2 ;;
        --show-buggy) SHOW_BUGGY="true"; shift ;;
        -h|--help)   grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

CONFIG="$HOME/.config/benchling-webhook/$PROFILE/config.json"
if [[ ! -f "$CONFIG" ]]; then
    echo "ERROR: profile config not found: $CONFIG" >&2
    exit 1
fi

# Read a dotted path from the profile config.json.
cfg() { python3 -c "import json,sys; d=json.load(open('$CONFIG'));
p='$1'.split('.'); v=d
for k in p:
    v = v.get(k, '') if isinstance(v, dict) else ''
print(v if v is not None else '')"; }

# Prefer the dedicated Iceberg Glue database (matches QUILT_ICEBERG_DATABASE at
# runtime); fall back to quilt.database only when it is absent.
DATABASE="${DATABASE:-$(cfg quilt.icebergDatabase)}"
DATABASE="${DATABASE:-$(cfg quilt.database)}"
REGION="${REGION:-$(cfg quilt.region)}"
WORKGROUP="${WORKGROUP:-$(cfg quilt.athenaUserWorkgroup)}"
KEY="${KEY:-$(cfg packages.metadataKey)}"
CATALOG="$(cfg quilt.catalog)"

if [[ -z "$VALUE" ]]; then
    echo "ERROR: --value is required (the metadata value to search for)" >&2
    exit 1
fi
if [[ -z "$DATABASE" || -z "$REGION" || -z "$WORKGROUP" || -z "$KEY" ]]; then
    echo "ERROR: could not resolve database/region/workgroup/key from $CONFIG" >&2
    echo "  database=$DATABASE region=$REGION workgroup=$WORKGROUP key=$KEY" >&2
    exit 1
fi

echo "profile:   $PROFILE"
echo "catalog:   $CATALOG"
echo "database:  $DATABASE (Iceberg Glue database)"
echo "region:    $REGION"
echo "workgroup: $WORKGROUP"
echo "filter:    $KEY = $VALUE"
echo

# --- 1. Discover per-bucket Iceberg manifest tables -------------------------
echo "### Iceberg package_manifest tables"
MANIFESTS=()
while IFS= read -r line; do
    [[ -n "$line" ]] && MANIFESTS+=("$line")
done < <(aws glue get-tables \
    --database-name "$DATABASE" --region "$REGION" \
    --query 'TableList[?ends_with(Name, `_package_manifest`)].Name' \
    --output text 2>/dev/null | tr '\t' '\n' || true)

if [[ ${#MANIFESTS[@]} -eq 0 ]]; then
    echo "  (none found — is this a bucketless/Iceberg deployment?)" >&2
    exit 1
fi
printf '  %s\n' "${MANIFESTS[@]}"
echo

# --- 2. Confirm the metadata column type ------------------------------------
FIRST_MANIFEST="${MANIFESTS[0]}"
echo "### metadata column type on $FIRST_MANIFEST"
META_TYPE="$(aws glue get-table \
    --database-name "$DATABASE" --name "$FIRST_MANIFEST" --region "$REGION" \
    --query "Table.StorageDescriptor.Columns[?Name=='metadata'].Type | [0]" \
    --output text 2>/dev/null)"
echo "  metadata: $META_TYPE"
if [[ "$META_TYPE" == "string" ]]; then
    echo "  -> JSON string: MUST use json_extract_scalar (STRUCT access would TYPE_MISMATCH)"
else
    echo "  -> WARNING: expected 'string'; schema may have changed"
fi
echo

# --- Athena query runner ----------------------------------------------------
run_query() {
    local label="$1" query="$2"
    echo "### $label"
    local qid
    qid=$(aws athena start-query-execution --region "$REGION" --work-group "$WORKGROUP" \
        --query-execution-context Database="$DATABASE" \
        --query-string "$query" --query 'QueryExecutionId' --output text)
    local state=""
    for _ in $(seq 1 120); do
        state=$(aws athena get-query-execution --region "$REGION" \
            --query-execution-id "$qid" --query 'QueryExecution.Status.State' --output text)
        [[ "$state" == "SUCCEEDED" || "$state" == "FAILED" || "$state" == "CANCELLED" ]] && break
        sleep 0.5
    done
    echo "  state: $state"
    if [[ "$state" == "SUCCEEDED" ]]; then
        aws athena get-query-results --region "$REGION" --query-execution-id "$qid" --output json \
            | python3 -c "import sys,json
d=json.load(sys.stdin); rows=d['ResultSet']['Rows']
if len(rows)<=1:
    print('  (0 matching packages)')
else:
    print(f'  {len(rows)-1} matching package(s):')
    for r in rows[1:11]:
        cells=[c.get('VarCharValue','') for c in r['Data']]
        print('   -', cells[4] + '/' + cells[0] if len(cells)>=5 else cells)"
    else
        echo "  reason: $(aws athena get-query-execution --region "$REGION" \
            --query-execution-id "$qid" --query 'QueryExecution.Status.StateChangeReason' --output text)"
    fi
    echo
    [[ "$state" == "SUCCEEDED" ]]
}

# --- Build UNION ALL branches (mirrors _build_iceberg_union_query) ----------
ESCAPED_VALUE="${VALUE//\'/\'\'}"
build_query() {
    local accessor="$1"  # "json" (fixed) or "struct" (buggy)
    local first="true" sql=""
    for m in "${MANIFESTS[@]}"; do
        local bucket="${m%_package_manifest}"
        local predicate
        if [[ "$accessor" == "struct" ]]; then
            predicate="m.metadata.$KEY = '$ESCAPED_VALUE'"
        else
            predicate="json_extract_scalar(m.metadata, '\$.$KEY') = '$ESCAPED_VALUE'"
        fi
        local branch="SELECT r.pkg_name, r.timestamp, m.message, m.metadata AS user_meta, '$bucket' AS _src_bucket
FROM \"$DATABASE\".\"${bucket}_package_revision\" r
JOIN \"$DATABASE\".\"${bucket}_package_manifest\" m ON r.top_hash = m.top_hash
JOIN \"$DATABASE\".\"${bucket}_package_tag\" t ON r.pkg_name = t.pkg_name AND t.tag_name = 'latest'
WHERE $predicate"
        if [[ "$first" == "true" ]]; then sql="$branch"; first="false"
        else sql="$sql
UNION ALL
$branch"; fi
    done
    printf '%s' "$sql"
}

# --- 3. Run the fixed query -------------------------------------------------
run_query "Fixed query (json_extract_scalar)" "$(build_query json)" && OK="true" || OK="false"

# --- 4. Optionally demonstrate the old failing form -------------------------
if [[ "$SHOW_BUGGY" == "true" ]]; then
    run_query "Buggy query (m.metadata.<key> STRUCT access — expected FAIL)" "$(build_query struct)" || true
fi

if [[ "$OK" == "true" ]]; then
    echo "✅ Iceberg package search succeeded."
else
    echo "❌ Iceberg package search failed — see reason above."
    exit 1
fi
