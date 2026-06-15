"""Tests for entry_references extractor (shared discovery for #143 + #68/#69)."""

from src.entry_references import (
    ENTITY_LINK_TYPES,
    EntityReference,
    ResultsTableReference,
    extract_entity_references,
    extract_note_links,
    extract_results_tables,
)


def _entry(*notes, fields=None):
    """Build a minimal entry dict with one day holding the given notes."""
    return {
        "id": "etr_test",
        "days": [{"date": "2026-06-15", "title": "Day 1", "notes": list(notes)}],
        "fields": fields or {},
    }


def _link_note(*links):
    return {"type": "text", "text": "", "links": list(links)}


class TestExtractNoteLinks:
    def test_collects_links_across_notes(self):
        entry = _entry(
            _link_note({"id": "bfi_1", "type": "custom_entity", "webURL": "u1"}),
            _link_note({"id": "seq_1", "type": "dna_sequence", "webURL": "u2"}),
        )
        ids = [link["id"] for link in extract_note_links(entry)]
        assert ids == ["bfi_1", "seq_1"]

    def test_empty_when_no_links(self):
        assert extract_note_links(_entry(_link_note())) == []

    def test_tolerates_missing_days_notes_links(self):
        assert extract_note_links({}) == []
        assert extract_note_links({"days": [{}]}) == []
        assert extract_note_links({"days": [{"notes": [{}]}]}) == []


class TestExtractEntityReferences:
    def test_returns_entity_links_only(self):
        entry = _entry(
            _link_note(
                {"id": "bfi_1", "type": "custom_entity", "webURL": "u1"},
                {"id": "axdash_1", "type": "sql_dashboard", "webURL": "u2"},
            )
        )
        refs = extract_entity_references(entry)
        assert refs == [EntityReference(id="bfi_1", type="custom_entity", web_url="u1", source="note_link")]

    def test_dedupes_repeated_mentions(self):
        entry = _entry(
            _link_note({"id": "bfi_1", "type": "custom_entity", "webURL": "u1"}),
            _link_note({"id": "bfi_1", "type": "custom_entity", "webURL": "u1"}),
        )
        refs = extract_entity_references(entry)
        assert [r.id for r in refs] == ["bfi_1"]

    def test_all_known_entity_types_pass_filter(self):
        notes = [_link_note({"id": f"id_{t}", "type": t, "webURL": "u"}) for t in sorted(ENTITY_LINK_TYPES)]
        refs = extract_entity_references(_entry(*notes))
        assert {r.type for r in refs} == set(ENTITY_LINK_TYPES)

    def test_pulls_entity_link_fields_single_and_multi(self):
        entry = _entry(
            fields={
                "Cell Line": {"type": "entity_link", "value": "bfi_field"},
                "Plasmids": {"type": "entity_link", "isMulti": True, "value": ["seq_a", "seq_b"]},
                "Project": {"type": "text", "value": "ignored"},
            }
        )
        refs = extract_entity_references(entry)
        assert [(r.id, r.source) for r in refs] == [
            ("bfi_field", "entity_field"),
            ("seq_a", "entity_field"),
            ("seq_b", "entity_field"),
        ]

    def test_field_ids_deduped_against_note_links(self):
        entry = _entry(
            _link_note({"id": "bfi_1", "type": "custom_entity", "webURL": "u1"}),
            fields={"Cell Line": {"type": "entity_link", "value": "bfi_1"}},
        )
        refs = extract_entity_references(entry)
        assert [r.id for r in refs] == ["bfi_1"]
        assert refs[0].source == "note_link"  # first-seen wins

    def test_custom_type_filter(self):
        entry = _entry(
            _link_note(
                {"id": "bfi_1", "type": "custom_entity", "webURL": "u1"},
                {"id": "seq_1", "type": "dna_sequence", "webURL": "u2"},
            )
        )
        refs = extract_entity_references(entry, types={"dna_sequence"})
        assert [r.id for r in refs] == ["seq_1"]

    def test_fields_as_list_shape(self):
        entry = {
            "days": [],
            "fields": [{"name": "Cell Line", "type": "entity_link", "value": "bfi_x"}],
        }
        refs = extract_entity_references(entry)
        assert [r.id for r in refs] == ["bfi_x"]


class TestExtractResultsTables:
    def test_returns_tables_with_schema_id(self):
        entry = _entry(
            {"type": "results_table", "apiId": "tbl_1", "assayResultSchemaId": "assaysch_1", "name": "T1"},
            {"type": "text", "links": []},
        )
        assert extract_results_tables(entry) == [
            ResultsTableReference(assay_result_schema_id="assaysch_1", api_id="tbl_1", name="T1")
        ]

    def test_skips_tables_without_schema_id(self):
        entry = _entry({"type": "results_table", "apiId": "tbl_1"})
        assert extract_results_tables(entry) == []

    def test_dedupes_by_api_and_schema(self):
        note = {"type": "results_table", "apiId": "tbl_1", "assayResultSchemaId": "assaysch_1"}
        entry = _entry(dict(note), dict(note))
        assert len(extract_results_tables(entry)) == 1
