"""Extract typed references out of a Benchling entry's structured data.

A Benchling entry can point at other Benchling objects in three places:

1. Note links -- ``days[].notes[].links[]``, each ``{id, type, webURL}``. Entity
   mentions appear as ``custom_entity`` / ``dna_sequence`` / ``aa_sequence`` /
   ``dna_oligo`` / ``rna_oligo``; the same list also carries non-entity types
   (e.g. ``sql_dashboard``), so callers must filter by ``type``.
2. Entity-link fields -- ``fields[name]`` whose ``type`` mentions ``entity``,
   carrying one or more entity IDs directly in ``value``.
3. Results tables -- ``results_table`` notes carrying an ``assayResultSchemaId``
   (the discovery site for assay results, issues #68/#69).

This module is pure: it operates on the entry dict already fetched by
``EntryPackager`` and makes no Benchling API calls. Resolving each reference to a
full record (``get_by_id`` / ``bulk_get``) is the caller's job.

Shared discovery layer for entity packaging (#143) and assay results (#68/#69).
"""

from dataclasses import dataclass
from typing import Any, Dict, Iterator, List, Optional, Tuple

# Note-link / field ``type`` values that denote a registry entity. Used to keep
# entity references out of the non-entity links (dashboards, etc.) that share
# the same ``links[]`` array.
ENTITY_LINK_TYPES = frozenset(
    {
        "custom_entity",
        "dna_sequence",
        "aa_sequence",
        "dna_oligo",
        "rna_oligo",
    }
)

# Note ``type`` values that carry tabular assay results.
RESULTS_TABLE_NOTE_TYPES = frozenset(
    {
        "results_table",
        "registration_table",
        "table",
    }
)


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


def _iter_notes(entry_data: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
    """Yield every note across all days, defensively skipping malformed shapes."""
    for day in entry_data.get("days") or []:
        if not isinstance(day, dict):
            continue
        for note in day.get("notes") or []:
            if isinstance(note, dict):
                yield note


def _iter_fields(entry_data: Dict[str, Any]) -> Iterator[Tuple[Optional[str], Dict[str, Any]]]:
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


def _field_value_ids(fval: Dict[str, Any]) -> List[str]:
    """Pull entity ID(s) out of a field value (single value or ``isMulti`` list)."""
    val = fval.get("value")
    if isinstance(val, str):
        return [val]
    if isinstance(val, list):
        return [v for v in val if isinstance(v, str)]
    return []


def extract_note_links(entry_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return every link object across all note bodies, unfiltered.

    Lower-level primitive; most callers want :func:`extract_entity_references`.
    """
    links: List[Dict[str, Any]] = []
    for note in _iter_notes(entry_data):
        for link in note.get("links") or []:
            if isinstance(link, dict):
                links.append(link)
    return links


def extract_entity_references(
    entry_data: Dict[str, Any],
    *,
    types: "frozenset[str] | set[str]" = ENTITY_LINK_TYPES,
) -> List[EntityReference]:
    """Return deduped entity references from note links and entity-link fields.

    Note links are filtered to ``types`` (default: all known entity types).
    Entity-link fields are detected by an ``entity`` substring in the field
    ``type`` and are included regardless of ``types``. References are deduped by
    ID, preserving first-seen order (note links before fields).
    """
    seen: set[str] = set()
    refs: List[EntityReference] = []

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
                web_url=link.get("webURL") or link.get("web_url"),
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


def extract_results_tables(entry_data: Dict[str, Any]) -> List[ResultsTableReference]:
    """Return deduped assay-results-table references from entry notes.

    Only notes whose ``type`` is a results-table type *and* that carry an
    ``assayResultSchemaId`` are returned. Deduped by ``(api_id, schema_id)``.
    """
    seen: set[Tuple[Optional[str], str]] = set()
    tables: List[ResultsTableReference] = []
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
