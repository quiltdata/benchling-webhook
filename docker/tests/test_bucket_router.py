"""Tests for multi-bucket routing (bucket_router module)."""

from src.bucket_router import resolve_bucket_for_entry

DEFAULT = "default-bucket"


class TestResolveBucketForEntry:
    def test_empty_map_returns_default(self):
        entry = {"id": "etr_1", "folder_id": "lib_a"}
        assert resolve_bucket_for_entry(entry, {}, DEFAULT) == DEFAULT

    def test_none_entry_returns_default(self):
        assert resolve_bucket_for_entry(None, {"lib_a": "bucket-a"}, DEFAULT) == DEFAULT

    def test_folder_id_match(self):
        entry = {"id": "etr_1", "folder_id": "lib_a"}
        assert resolve_bucket_for_entry(entry, {"lib_a": "bucket-a"}, DEFAULT) == "bucket-a"

    def test_camel_case_folder_id_match(self):
        entry = {"id": "etr_1", "folderId": "lib_a"}
        assert resolve_bucket_for_entry(entry, {"lib_a": "bucket-a"}, DEFAULT) == "bucket-a"

    def test_project_id_match(self):
        entry = {"id": "etr_1", "project_id": "src_p"}
        assert resolve_bucket_for_entry(entry, {"src_p": "bucket-p"}, DEFAULT) == "bucket-p"

    def test_camel_case_project_id_match(self):
        entry = {"id": "etr_1", "projectId": "src_p"}
        assert resolve_bucket_for_entry(entry, {"src_p": "bucket-p"}, DEFAULT) == "bucket-p"

    def test_folder_takes_precedence_over_project(self):
        entry = {"id": "etr_1", "folder_id": "lib_a", "project_id": "src_p"}
        bucket_map = {"lib_a": "bucket-a", "src_p": "bucket-p"}
        assert resolve_bucket_for_entry(entry, bucket_map, DEFAULT) == "bucket-a"

    def test_unmapped_folder_falls_through_to_project(self):
        entry = {"id": "etr_1", "folder_id": "lib_other", "project_id": "src_p"}
        bucket_map = {"lib_a": "bucket-a", "src_p": "bucket-p"}
        assert resolve_bucket_for_entry(entry, bucket_map, DEFAULT) == "bucket-p"

    def test_no_match_returns_default(self):
        entry = {"id": "etr_1", "folder_id": "lib_other", "project_id": "src_other"}
        bucket_map = {"lib_a": "bucket-a", "src_p": "bucket-p"}
        assert resolve_bucket_for_entry(entry, bucket_map, DEFAULT) == DEFAULT

    def test_non_string_ids_ignored(self):
        entry = {"id": "etr_1", "folder_id": 123, "project_id": None}
        bucket_map = {"123": "bucket-x"}
        assert resolve_bucket_for_entry(entry, bucket_map, DEFAULT) == DEFAULT

    def test_entry_without_ids_returns_default(self):
        entry = {"id": "etr_1"}
        assert resolve_bucket_for_entry(entry, {"lib_a": "bucket-a"}, DEFAULT) == DEFAULT
