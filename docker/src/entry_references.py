"""Extract typed references out of a Benchling entry's structured data.

A Benchling entry points at other Benchling objects in three places:

1. Note links -- ``days[].notes[].links[]``, each ``{id, type, webURL}``. ``type``
   is a closed enum (``EntryLink.type`` in the Benchling OpenAPI spec) of 18
   tokens spanning entities, inventory, references, dashboards, and plain
   external hyperlinks -- see :data:`LINK_TYPE_CATEGORY`.
2. Entity-link fields -- ``fields[name]`` whose ``type`` mentions ``entity``,
   carrying one or more entity IDs directly in ``value``.
3. Results tables -- ``results_table`` notes carrying an ``assayResultSchemaId``
   (the discovery site for assay results, issues #68/#69).

This module is pure: it operates on the entry dict already fetched by
``EntryPackager`` and makes no Benchling API calls. Resolving each reference to a
full record (``get_by_id`` / ``bulk_get``) is the caller's job; this layer only
discovers and classifies what an entry points at.

Shared discovery layer for entity packaging (#143), the full entry-linked
resource map (#389), and assay results (#68/#69).
"""

from dataclasses import dataclass
from enum import Enum
from typing import Any, Iterator, Optional


class LinkCategory(str, Enum):
    """How a note-link type relates to packaging (per #389 conclusions)."""

    ENTITY = "entity"  # registry entity; GET-by-id + v2.entity.registered event
    INVENTORY = "inventory"  # packageable via GET-by-id; no webhook events
    REFERENCE = "reference"  # packageable; has its own create/update events
    METADATA = "metadata"  # GET works but low value to package as a record
    NOT_PACKAGEABLE = "not_packageable"  # no read API (dashboards, protocol)
    UNCERTAIN = "uncertain"  # endpoint depends on tenant API version; verify first
    EXTERNAL = "external"  # plain http(s) hyperlink ("link"); no Benchling ID
    UNKNOWN = "unknown"  # type not in the known enum -- surfaced, not dropped


# EntryLink.type -> category. Covers all 18 enum tokens from test/openapi.yaml.
# Unknown/future tokens fall through to LinkCategory.UNKNOWN via classify_link_type.
LINK_TYPE_CATEGORY: dict[str, LinkCategory] = {
    # entities (eventable via v2.entity.registered)
    "custom_entity": LinkCategory.ENTITY,
    "dna_sequence": LinkCategory.ENTITY,
    "aa_sequence": LinkCategory.ENTITY,
    "batch": LinkCategory.ENTITY,
    # inventory (packageable on reference, no events)
    "container": LinkCategory.INVENTORY,
    "box": LinkCategory.INVENTORY,
    "plate": LinkCategory.INVENTORY,
    "location": LinkCategory.INVENTORY,
    # references (packageable, own events)
    "entry": LinkCategory.REFERENCE,
    "request": LinkCategory.REFERENCE,
    "workflow": LinkCategory.REFERENCE,
    # metadata-only pointers
    "user": LinkCategory.METADATA,
    "folder": LinkCategory.METADATA,
    # no read API exists -- keep the webURL as a reference only
    "sql_dashboard": LinkCategory.NOT_PACKAGEABLE,
    "insights_dashboard": LinkCategory.NOT_PACKAGEABLE,
    "protocol": LinkCategory.NOT_PACKAGEABLE,
    # endpoint depends on tenant API version (v2-alpha) -- verify before relying
    "stage_entry": LinkCategory.UNCERTAIN,
    # plain external hyperlink (no Benchling id)
    "link": LinkCategory.EXTERNAL,
}

# Note: dna_oligo / rna_oligo / mixture / assay_run / assay_result / workflow_task
# are NOT EntryLink types -- they cannot appear as note links. They reach an entry
# via structured note parts / inventory tables, not links[].

# Categories whose resources can be fetched as a record via GET-by-id.
PACKAGEABLE_CATEGORIES = frozenset({LinkCategory.ENTITY, LinkCategory.INVENTORY, LinkCategory.REFERENCE})

# Linkable entity types (subset of LINK_TYPE_CATEGORY that are LinkCategory.ENTITY).
ENTITY_LINK_TYPES = frozenset(t for t, cat in LINK_TYPE_CATEGORY.items() if cat is LinkCategory.ENTITY)

# Note ``type`` value that carries tabular assay results. Kept as a set for
# extensibility, but scoped to ``results_table`` only: that is the note type that
# carries an ``assayResultSchemaId`` (#68/#69). A generic ``table`` or a
# ``registration_table`` is a different mechanism and must not be swept in here.
RESULTS_TABLE_NOTE_TYPES = frozenset({"results_table"})


@dataclass(frozen=True)
class LinkRef:
    """A classified note link. ``id``/``web_url`` are absent for some types
    (``link`` has no id; ``location`` has no webURL)."""

    type: str
    category: LinkCategory
    id: Optional[str] = None
    web_url: Optional[str] = None

    @property
    def is_packageable(self) -> bool:
        return self.category in PACKAGEABLE_CATEGORIES


@dataclass(frozen=True)
class EntityReference:
    """A reference to a Benchling entity discovered inside an entry.

    ``type`` is the discovery type as seen in the entry (e.g. ``custom_entity``
    from a note link, or ``entity_link`` from a field) -- not necessarily the
    entity's own schema type. ``source`` records where the reference was found.
    """

    id: str
    type: str
    web_url: Optional[str] = None
    source: str = "note_link"  # "note_link" | "entity_field"


@dataclass(frozen=True)
class ResultsTableReference:
    """A reference to an assay-results table embedded in an entry note."""

    assay_result_schema_id: str
    api_id: Optional[str] = None
    name: Optional[str] = None


def _iter_notes(entry_data: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Yield every note across all days, defensively skipping malformed shapes."""
    for day in entry_data.get("days") or []:
        if not isinstance(day, dict):
            continue
        for note in day.get("notes") or []:
            if isinstance(note, dict):
                yield note


def _iter_fields(entry_data: dict[str, Any]) -> Iterator[tuple[Optional[str], dict[str, Any]]]:
    """Yield ``(name, field)`` pairs.

    Benchling renders entry ``fields`` as a name-keyed dict; some payloads use a
    list of field objects instead, so both are accepted.
    """
    fields = entry_data.get("fields")
    if isinstance(fields, dict):
        for name, fval in fields.items():
            if isinstance(fval, dict):
                yield name, fval
    elif isinstance(fields, list):
        for fval in fields:
            if isinstance(fval, dict):
                yield fval.get("name"), fval


def _field_value_ids(fval: dict[str, Any]) -> list[str]:
    """Pull entity ID(s) out of a field value (single value or ``isMulti`` list).

    Empty strings are dropped, mirroring the ``if not link_id`` guard on note links.
    """
    val = fval.get("value")
    if isinstance(val, str):
        return [val] if val else []
    if isinstance(val, list):
        return [v for v in val if isinstance(v, str) and v]
    return []


def _link_web_url(link: dict[str, Any]) -> Optional[str]:
    return link.get("webURL") or link.get("web_url")


def classify_link_type(link_type: Optional[str]) -> LinkCategory:
    """Map an EntryLink ``type`` token to its :class:`LinkCategory`.

    Unknown/future tokens map to ``UNKNOWN`` rather than being silently dropped.
    """
    if not link_type:
        return LinkCategory.UNKNOWN
    return LINK_TYPE_CATEGORY.get(link_type, LinkCategory.UNKNOWN)


def extract_note_links(entry_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Return every link object across all note bodies, unfiltered and untyped.

    Lowest-level primitive; most callers want :func:`classify_links` or
    :func:`extract_entity_references`.
    """
    links: list[dict[str, Any]] = []
    for note in _iter_notes(entry_data):
        for link in note.get("links") or []:
            if isinstance(link, dict):
                links.append(link)
    return links


def classify_links(entry_data: dict[str, Any]) -> list[LinkRef]:
    """Return every note link, classified by category and deduped.

    Surfaces the *full* set of objects an entry points at -- entities, inventory,
    references, metadata pointers, dashboards, and external URLs -- so callers can
    decide what to fetch (e.g. ``[r for r in classify_links(e) if r.is_packageable]``).
    Deduped by Benchling ID when present, else by URL; first-seen order preserved.
    """
    seen: set[str] = set()
    refs: list[LinkRef] = []
    for link in extract_note_links(entry_data):
        link_type = link.get("type")
        link_id = link.get("id")
        web_url = _link_web_url(link)
        dedup_key = link_id or web_url
        if dedup_key is not None:
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
        refs.append(
            LinkRef(
                type=str(link_type) if link_type is not None else "",
                category=classify_link_type(link_type),
                id=link_id,
                web_url=web_url,
            )
        )
    return refs


def extract_entity_references(
    entry_data: dict[str, Any],
    *,
    types: "frozenset[str] | set[str]" = ENTITY_LINK_TYPES,
) -> list[EntityReference]:
    """Return deduped entity references from note links and entity-link fields.

    Note links are filtered to ``types`` (default: all linkable entity types).
    Entity-link fields are detected by an ``entity`` substring in the field
    ``type`` and are included regardless of ``types``. References are deduped by
    ID, preserving first-seen order (note links before fields).
    """
    seen: set[str] = set()
    refs: list[EntityReference] = []

    for link in extract_note_links(entry_data):
        link_id = link.get("id")
        link_type = link.get("type")
        if not link_id or link_type not in types or link_id in seen:
            continue
        seen.add(link_id)
        refs.append(
            EntityReference(
                id=str(link_id),
                type=str(link_type),
                web_url=_link_web_url(link),
                source="note_link",
            )
        )

    for _name, fval in _iter_fields(entry_data):
        ftype = fval.get("type")
        if not ftype or "entity" not in str(ftype).lower():
            continue
        for value_id in _field_value_ids(fval):
            if value_id in seen:
                continue
            seen.add(value_id)
            refs.append(EntityReference(id=value_id, type=str(ftype), source="entity_field"))

    return refs


def extract_results_tables(entry_data: dict[str, Any]) -> list[ResultsTableReference]:
    """Return deduped assay-results-table references from entry notes.

    Only notes whose ``type`` is a results-table type *and* that carry an
    ``assayResultSchemaId`` are returned. Deduped by ``(api_id, schema_id)``.
    """
    seen: set[tuple[Optional[str], str]] = set()
    tables: list[ResultsTableReference] = []
    for note in _iter_notes(entry_data):
        if note.get("type") not in RESULTS_TABLE_NOTE_TYPES:
            continue
        schema_id = note.get("assayResultSchemaId")
        if not schema_id:
            continue
        api_id = note.get("apiId")
        key = (api_id, schema_id)
        if key in seen:
            continue
        seen.add(key)
        tables.append(
            ResultsTableReference(
                assay_result_schema_id=schema_id,
                api_id=api_id,
                name=note.get("name"),
            )
        )
    return tables


# Bump when the references.json shape changes in a way consumers must notice.
REFERENCES_SCHEMA_VERSION = 1


def summarize_references(entry_data: dict[str, Any]) -> dict[str, Any]:
    """Build a JSON-serializable summary of everything an entry points at.

    Intended to be written into the package alongside ``entry.json`` (as
    ``references.json``) so downstream consumers see the discovered objects
    without re-parsing the raw entry. Records discovery only -- no Benchling
    records are fetched here.
    """
    return {
        "schema_version": REFERENCES_SCHEMA_VERSION,
        "entities": [
            {"id": e.id, "type": e.type, "web_url": e.web_url, "source": e.source}
            for e in extract_entity_references(entry_data)
        ],
        "links": [
            {
                "id": link.id,
                "type": link.type,
                "category": link.category.value,
                "web_url": link.web_url,
                "packageable": link.is_packageable,
            }
            for link in classify_links(entry_data)
        ],
        "results_tables": [
            {
                "assay_result_schema_id": t.assay_result_schema_id,
                "api_id": t.api_id,
                "name": t.name,
            }
            for t in extract_results_tables(entry_data)
        ],
    }
