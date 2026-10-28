"""View Related Canvas rendering, paging, and partial-error behavior."""

import json
from unittest.mock import Mock

from botocore.exceptions import ClientError

from src.canvas import CanvasManager
from src.canvas_blocks import blocks_to_dict
from src.config import Config
from src.package_query import ELN_ENTRY_KEY
from src.packages import Package
from src.pagination import parse_related_package_button_id
from src.payload import Payload


def _manager(packages, *, has_next=False, errors=None, package_exists=True):
    config = Mock(spec=Config)
    config.s3_bucket_name = "lab-bucket"
    config.s3_prefix = "ale"
    config.quilt_catalog = "catalog.example.com"
    config.quilt_database = "athena-db"
    config.package_key = "experiment_id"
    config.aws_region = "us-east-1"
    config.quilt_write_role_arn = None

    payload = Mock(spec=Payload)
    payload.entry_id = "etr_1"
    payload.canvas_id = "cnvs_1"
    payload.display_id = "EXP26000030"

    benchling = Mock()
    benchling.entries.get_entry_by_id.return_value.display_id = "EXP26000030"

    query = Mock()
    query.find_related_packages.return_value = {
        "packages": packages,
        "has_next": has_next,
        "results": {"errors": errors or {}},
    }

    fetcher = Mock()
    fetcher.get_seal.return_value = None
    fetcher.role_manager.get_s3_client.return_value.head_object.side_effect = ClientError(
        {"Error": {"Code": "404"}}, "HeadObject"
    )
    if package_exists:
        fetcher.get_package_top_hash.return_value = "abc"
    else:
        fetcher.get_package_top_hash.side_effect = ClientError({"Error": {"Code": "404"}}, "GetObject")

    return CanvasManager(benchling, config, payload, package_query=query, package_file_fetcher=fetcher), query


def test_related_view_renders_links_buttons_paging_and_partial_failures():
    packages = [
        Package(
            "catalog.example.com",
            "lab-bucket",
            "ale/sample-bucket-raw",
            modified_at="1793181000",
            message="instrument output",
        ),
        Package("catalog.example.com", "lab-bucket", "ale/raw-2", modified_at="1793180999"),
        Package("catalog.example.com", "lab-bucket", "ale/raw-3", modified_at="1793180998"),
        Package("catalog.example.com", "lab-bucket", "ale/raw-4", modified_at="1793180997"),
        Package("catalog.example.com", "raw-bucket", "ale/raw-5", modified_at="1793180996"),
    ]
    manager, query = _manager(
        packages,
        has_next=True,
        errors={"denied-bucket": "Access denied"},
    )

    blocks = blocks_to_dict(manager.get_related_package_blocks())
    rendered = json.dumps(blocks)
    markdown = blocks[0]["value"]

    query.find_related_packages.assert_called_once_with(
        prefix="ale",
        own_package_name="ale/EXP26000030",
        key="experiment_id",
        value="EXP26000030",
        page_number=0,
        page_size=5,
        array_key=ELN_ENTRY_KEY,
    )
    assert "2026-10-28 09:50 UTC" in markdown
    assert "instrument output" in markdown
    assert "raw-bucket" in markdown and "Read-only" in markdown
    assert "denied-bucket" in markdown and "Results are incomplete" in markdown
    assert "Retry Search" in rendered
    assert "next-page-related-etr_1-p1-s5" in rendered
    link_buttons = [
        child
        for block in blocks
        if block["type"] == "SECTION"
        for child in block["children"]
        if child["text"].startswith("Link ")
    ]
    assert parse_related_package_button_id(link_buttons[0]["id"]) == ("etr_1", "ale/sample-bucket-raw")
    assert all("ale/raw-5" not in child["text"] for child in link_buttons)


def test_prefix_is_shown_as_written():
    manager, _query = _manager([])
    manager.config.s3_prefix = "ale_team"

    markdown = blocks_to_dict(manager.get_related_package_blocks())[0]["value"]

    assert "`ale_team/`" in markdown


def test_out_of_range_revision_time_is_shown_as_written():
    manager, _query = _manager([Package("catalog.example.com", "lab-bucket", "ale/raw-1", modified_at="1e20")])

    markdown = blocks_to_dict(manager.get_related_package_blocks())[0]["value"]

    assert "ale/raw-1" in markdown and "1e20" in markdown


def test_related_view_requires_existing_entry_package():
    manager, query = _manager([], package_exists=False)

    rendered = json.dumps(blocks_to_dict(manager.get_related_package_blocks()))

    assert "Create this entry's package" in rendered
    query.find_related_packages.assert_not_called()


def test_late_related_search_cannot_overwrite_sealed_canvas():
    package = Package("catalog.example.com", "lab-bucket", "ale/raw-1")
    manager, query = _manager([package])
    manager.is_sealed_or_staged = Mock(return_value=True)
    manager.update_canvas_with_blocks = Mock()

    result = manager.update_related_canvas()

    query.find_related_packages.assert_called_once()
    manager.is_sealed_or_staged.assert_called_once()
    manager.update_canvas_with_blocks.assert_not_called()
    assert result == {"success": False, "skipped": "sealed"}
