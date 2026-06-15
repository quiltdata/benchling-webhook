"""Tests for entry_references extractor (shared discovery for #143 + #68/#69)."""

import json

from src.entry_references import (
    ENTITY_LINK_TYPES,
    EVENTABLE_CATEGORIES,
    FETCHABLE_CATEGORIES,
    LINK_TYPE_CATEGORY,
    EntityReference,
    LinkCategory,
    LinkRef,
    ResultsTableReference,
    classify_link_type,
    classify_links,
    extract_entity_references,
    extract_note_links,
    extract_results_tables,
    summarize_references,
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

    def test_empty_string_field_values_ignored(self):
        # Mirrors the `if not link_id` guard on note links: no EntityReference(id="").
        entry = _entry(
            fields={
                "Empty": {"type": "entity_link", "value": ""},
                "EmptyMulti": {"type": "entity_link", "value": ["", "bfi_ok", ""]},
            }
        )
        refs = extract_entity_references(entry)
        assert [r.id for r in refs] == ["bfi_ok"]


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


class TestEntityLinkTypes:
    """Lock the linkable-entity set to the EntryLink enum (#389)."""

    def test_set_matches_entrylink_entities(self):
        # custom_entity, dna_sequence, aa_sequence, batch -- and nothing else.
        assert ENTITY_LINK_TYPES == {"custom_entity", "dna_sequence", "aa_sequence", "batch"}

    def test_batch_is_an_entity_reference(self):
        entry = _entry(_link_note({"id": "bat_1", "type": "batch", "webURL": "u"}))
        assert [r.id for r in extract_entity_references(entry)] == ["bat_1"]

    def test_oligos_are_not_link_types(self):
        # dna_oligo / rna_oligo cannot appear as note links -- not in the enum.
        for t in ("dna_oligo", "rna_oligo"):
            assert t not in ENTITY_LINK_TYPES
            assert t not in LINK_TYPE_CATEGORY


class TestClassifyLinkType:
    def test_full_enum_is_mapped(self):
        # All 18 EntryLink.type tokens from test/openapi.yaml.
        enum = {
            "link", "user", "request", "entry", "stage_entry", "protocol", "workflow",
            "custom_entity", "aa_sequence", "dna_sequence", "batch", "box", "container",
            "location", "plate", "insights_dashboard", "folder", "sql_dashboard",
        }  # fmt: skip
        assert set(LINK_TYPE_CATEGORY) == enum
        # none fall through to UNKNOWN
        assert all(classify_link_type(t) is not LinkCategory.UNKNOWN for t in enum)

    def test_category_assignments(self):
        assert classify_link_type("custom_entity") is LinkCategory.ENTITY
        assert classify_link_type("batch") is LinkCategory.ENTITY
        assert classify_link_type("container") is LinkCategory.INVENTORY
        assert classify_link_type("entry") is LinkCategory.REFERENCE
        assert classify_link_type("user") is LinkCategory.METADATA
        assert classify_link_type("sql_dashboard") is LinkCategory.NOT_PACKAGEABLE
        assert classify_link_type("stage_entry") is LinkCategory.UNCERTAIN
        assert classify_link_type("link") is LinkCategory.EXTERNAL

    def test_unknown_and_empty_fall_through(self):
        assert classify_link_type("future_type") is LinkCategory.UNKNOWN
        assert classify_link_type(None) is LinkCategory.UNKNOWN
        assert classify_link_type("") is LinkCategory.UNKNOWN


class TestClassifyLinks:
    def test_surfaces_all_types_classified(self):
        entry = _entry(
            _link_note(
                {"id": "bfi_1", "type": "custom_entity", "webURL": "u1"},
                {"id": "con_1", "type": "container", "webURL": "u2"},
                {"id": "axdash_1", "type": "sql_dashboard", "webURL": "u3"},
                {"type": "link", "webURL": "https://example.com"},
            )
        )
        refs = classify_links(entry)
        assert refs == [
            LinkRef(type="custom_entity", category=LinkCategory.ENTITY, id="bfi_1", web_url="u1"),
            LinkRef(type="container", category=LinkCategory.INVENTORY, id="con_1", web_url="u2"),
            LinkRef(
                type="sql_dashboard",
                category=LinkCategory.NOT_PACKAGEABLE,
                id="axdash_1",
                web_url="u3",
            ),
            LinkRef(type="link", category=LinkCategory.EXTERNAL, id=None, web_url="https://example.com"),
        ]

    def test_is_fetchable_filter(self):
        entry = _entry(
            _link_note(
                {"id": "bfi_1", "type": "custom_entity", "webURL": "u1"},
                {"id": "axdash_1", "type": "sql_dashboard", "webURL": "u3"},
                {"type": "link", "webURL": "https://example.com"},
            )
        )
        fetchable = [r.id for r in classify_links(entry) if r.is_fetchable]
        assert fetchable == ["bfi_1"]

    def test_disposition_and_eventable_by_category(self):
        def link_of(t, i):
            return _link_note({"id": i, "type": t, "webURL": "u"})

        entry = _entry(
            link_of("custom_entity", "bfi_1"),  # entity
            link_of("container", "con_1"),  # inventory
            link_of("entry", "etr_1"),  # reference
            link_of("user", "ent_1"),  # metadata
            link_of("sql_dashboard", "axdash_1"),  # not_packageable
        )
        by_id = {r.id: r for r in classify_links(entry)}
        assert by_id["bfi_1"].disposition == "nest_or_standalone"
        assert by_id["bfi_1"].is_eventable is True
        assert by_id["con_1"].disposition == "nest"
        assert by_id["con_1"].is_eventable is False  # inventory: nest-only
        assert by_id["etr_1"].disposition == "link"
        assert by_id["ent_1"].disposition == "pointer"
        assert by_id["axdash_1"].disposition == "skip"

    def test_dedupes_by_id_then_url(self):
        entry = _entry(
            _link_note(
                {"id": "bfi_1", "type": "custom_entity", "webURL": "u1"},
                {"id": "bfi_1", "type": "custom_entity", "webURL": "u1"},
                {"type": "link", "webURL": "https://dup.com"},
                {"type": "link", "webURL": "https://dup.com"},
            )
        )
        refs = classify_links(entry)
        assert [(r.type, r.id or r.web_url) for r in refs] == [
            ("custom_entity", "bfi_1"),
            ("link", "https://dup.com"),
        ]

    def test_fetchable_and_eventable_category_membership(self):
        assert FETCHABLE_CATEGORIES == {
            LinkCategory.ENTITY,
            LinkCategory.INVENTORY,
            LinkCategory.REFERENCE,
        }
        assert EVENTABLE_CATEGORIES == {LinkCategory.ENTITY, LinkCategory.REFERENCE}


class TestSummarizeReferences:
    def test_serializable_summary_of_all_discovered(self):
        entry = _entry(
            _link_note(
                {"id": "bfi_1", "type": "custom_entity", "webURL": "u1"},
                {"id": "axdash_1", "type": "sql_dashboard", "webURL": "u2"},
            ),
            {"type": "results_table", "apiId": "tbl_1", "assayResultSchemaId": "assaysch_1", "name": "T1"},
            fields={"Cell Line": {"type": "entity_link", "value": "seq_field"}},
        )
        summary = summarize_references(entry)
        # JSON-serializable end to end (categories are plain strings, etc.)
        assert json.loads(json.dumps(summary)) == summary
        assert summary["schema_version"] == 1
        assert [e["id"] for e in summary["entities"]] == ["bfi_1", "seq_field"]
        assert {link["type"] for link in summary["links"]} == {"custom_entity", "sql_dashboard"}
        assert summary["links"][0]["category"] == "entity"
        assert summary["links"][0]["disposition"] == "nest_or_standalone"
        assert summary["links"][0]["fetchable"] is True
        assert summary["links"][0]["eventable"] is True
        assert summary["links"][1]["disposition"] == "skip"
        assert summary["links"][1]["fetchable"] is False
        assert summary["results_tables"] == [{"assay_result_schema_id": "assaysch_1", "api_id": "tbl_1", "name": "T1"}]

    def test_empty_entry_yields_empty_arrays(self):
        summary = summarize_references({})
        assert summary == {
            "schema_version": 1,
            "entities": [],
            "links": [],
            "results_tables": [],
        }
