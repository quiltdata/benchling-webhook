"""View Related Canvas rendering, paging, and partial-error behavior."""

import json
from unittest.mock import Mock

from botocore.exceptions import ClientError

from src.canvas import CanvasManager
from src.canvas_blocks import blocks_to_dict
from src.config import Config
from src.package_query import ELN_ENTRY_KEY
from src.packages import Package
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
    assert "link-related-etr_1-pkg-ale--sample-bucket-raw-bucket-lab-bucket" in rendered
    assert "link-related-etr_1-pkg-ale--raw-5" not in rendered


def test_related_view_requires_existing_entry_package():
    manager, query = _manager([], package_exists=False)

    rendered = json.dumps(blocks_to_dict(manager.get_related_package_blocks()))

    assert "Create this entry's package" in rendered
    query.find_related_packages.assert_not_called()
