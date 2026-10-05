"""Linked packages on the App Canvas: tagged packages and RO-Crate packages (#401).

A package links to a Benchling entry when its metadata either sets the configured
``pkg_key`` (default ``experiment_id``) to the entry's display ID, or, for a
package built from an RO-Crate, lists that display ID under ``eln_entry``.
"""

import json
from unittest.mock import Mock, patch

import pytest

from src.canvas import CanvasManager
from src.canvas_blocks import blocks_to_dict
from src.config import Config
from src.package_query import ELN_ENTRY_KEY, PackageQuery
from src.packages import Package
from src.payload import Payload

DISPLAY_ID = "EXP25000017"

# Package metadata as the Quilt RO-Crate profile projects it.
CRATE_META = {
    "package_name": "test/ro-crate-ingest",
    "creator": ["Ernest Prabhakar"],
    "producer": ["Assay Development", "Laboratory Operations"],
    "instrument": ["Plate Reader 1"],
    "instrument_id": ["INST-000456"],
    "eln_entry": [DISPLAY_ID],
}
TAGGED_META = {"experiment_id": DISPLAY_ID}
# eln_entry typed by hand in the catalog: a string, and no crate roles.
HAND_TYPED_META = {"eln_entry": DISPLAY_ID}

CRATE_ROLE_LINES = (
    "  * **Creator**: Ernest Prabhakar\n"
    "  * **Producer**: Assay Development, Laboratory Operations\n"
    "  * **Instrument**: Plate Reader 1\n"
    "  * **Instrument ID**: INST-000456\n"
)


@pytest.fixture
def mock_config():
    config = Mock(spec=Config)
    config.s3_bucket_name = "lab-bucket"
    config.s3_prefix = "benchling"
    config.quilt_catalog = "test.quiltdata.com"
    config.quilt_database = "test-athena-db"
    config.package_key = "experiment_id"
    config.athena_user_workgroup = "test-workgroup"
    config.aws_region = "us-east-1"
    config.quilt_write_role_arn = None
    config.quilt_api_key = ""
    return config


@pytest.fixture
def mock_payload():
    payload = Mock(spec=Payload)
    payload.entry_id = "etr_FFW6vEAy"
    payload.canvas_id = "cnvs_test456"
    payload.display_id = DISPLAY_ID
    payload.package_name.return_value = f"benchling/{DISPLAY_ID}"
    payload.set_display_id = Mock()
    return payload


@pytest.fixture
def mock_benchling():
    benchling = Mock()
    entry = Mock()
    entry.id = "etr_FFW6vEAy"
    entry.display_id = DISPLAY_ID
    benchling.entries.get_entry_by_id.return_value = entry
    return benchling


def _canvas(benchling, config, payload, package_query):
    return CanvasManager(
        benchling=benchling,
        config=config,
        payload=payload,
        package_query=package_query,
        package_file_fetcher=Mock(get_seal=Mock(return_value=None)),
    )


class TestLinkedPackageLookup:
    """The canvas asks for both link styles and renders what comes back."""

    def test_lookup_matches_configured_key_and_eln_entry(self, mock_benchling, mock_config, mock_payload):
        package_query = Mock()
        package_query.find_unique_packages.return_value = {"packages": []}

        _canvas(mock_benchling, mock_config, mock_payload, package_query)._make_markdown_content()

        package_query.find_unique_packages.assert_called_once_with(
            key="experiment_id", value=DISPLAY_ID, array_key=ELN_ENTRY_KEY
        )

    def test_crate_package_listed_with_roles_and_tagged_package_unchanged(
        self, mock_benchling, mock_config, mock_payload
    ):
        crate = Package("test.quiltdata.com", "lab-bucket", "test/ro-crate-ingest", metadata=CRATE_META)
        tagged = Package("test.quiltdata.com", "lab-bucket", "lab/tagged", metadata=TAGGED_META)
        package_query = Mock()
        package_query.find_unique_packages.return_value = {"packages": [crate, tagged]}

        content = _canvas(mock_benchling, mock_config, mock_payload, package_query)._make_markdown_content()

        crate_line = f"* [test/ro-crate-ingest]({crate.catalog_url}) [[🔄 sync]]({crate.make_sync_url()})\n"
        tagged_line = f"* [lab/tagged]({tagged.catalog_url}) [[🔄 sync]]({tagged.make_sync_url()})\n"
        assert "### Linked Packages" in content
        assert crate_line + CRATE_ROLE_LINES + tagged_line in content

    def test_primary_package_is_not_listed_even_with_eln_entry(self, mock_benchling, mock_config, mock_payload):
        primary = Package(
            "test.quiltdata.com", "lab-bucket", f"benchling/{DISPLAY_ID}", metadata={"eln_entry": [DISPLAY_ID]}
        )
        package_query = Mock()
        package_query.find_unique_packages.return_value = {"packages": [primary]}

        content = _canvas(mock_benchling, mock_config, mock_payload, package_query)._make_markdown_content()

        assert "### Linked Packages" not in content

    def test_bucketless_canvas_offers_browse_button_for_crate_package(self, mock_benchling, mock_config, mock_payload):
        mock_config.s3_bucket_name = ""
        crate = Package("test.quiltdata.com", "lab-bucket", "test/ro-crate-ingest", metadata=CRATE_META)
        package_query = Mock()
        package_query.find_unique_packages.return_value = {"packages": [crate]}

        canvas_blocks = _canvas(mock_benchling, mock_config, mock_payload, package_query)._make_blocks(
            updated_at="2026-09-29 12:00 UTC"
        )

        assert CRATE_ROLE_LINES in canvas_blocks[1].value
        rendered = json.dumps(blocks_to_dict(canvas_blocks))
        assert "Browse test/ro-crate-ingest" in rendered
        assert "browse-linked-etr_FFW6vEAy-pkg-test--ro-crate-ingest-bucket-" in rendered


def _fake_athena(sql, timeout=30):
    """Stand in for Athena: return each package only if the SQL would select it.

    The crate package is returned only when the query checks the eln_entry list
    for the display ID, the hand-typed package only when it compares eln_entry
    as a string, and the tagged package only when it checks the scalar pkg_key.
    """
    if "information_schema.tables" in sql:
        return [{"table_name": "lab-bucket_packages-view"}]

    column = "m.metadata" if "_package_manifest" in sql else "user_meta"
    iceberg = column == "m.metadata"
    rows = []
    if f"json_array_contains(json_extract({column}, '$.eln_entry'), '{DISPLAY_ID}')" in sql:
        rows.append(("test/ro-crate-ingest", CRATE_META))
    if f"json_extract_scalar({column}, '$.eln_entry') = '{DISPLAY_ID}'" in sql:
        rows.append(("lab/hand-typed", HAND_TYPED_META))
    if f"json_extract_scalar({column}, '$.experiment_id') = '{DISPLAY_ID}'" in sql:
        rows.append(("lab/tagged", TAGGED_META))
    return [
        {
            "pkg_name": name,
            "timestamp": "latest",
            "message": None,
            "user_meta": json.dumps(meta),
            **({"_src_bucket": "lab-bucket"} if iceberg else {}),
        }
        for name, meta in rows
    ]


@pytest.mark.parametrize(
    "bucket, iceberg_database",
    [
        pytest.param("lab-bucket", "", id="packages-view"),
        pytest.param("", "", id="bucketless-packages-view-fanout"),
        pytest.param("", "iceberg_db", id="bucketless-iceberg"),
    ],
)
@patch("src.package_query.RoleManager")
def test_crate_package_reaches_canvas_on_every_search_path(
    mock_role_manager_class, bucket, iceberg_database, mock_benchling, mock_config, mock_payload
):
    """End to end from canvas to SQL: crate, hand-typed, and tagged packages all appear, on every path."""
    mock_role_manager_class.return_value._get_or_create_session.return_value = (Mock(), None)
    mock_config.s3_bucket_name = bucket
    package_query = PackageQuery(
        bucket=bucket,
        catalog_url="test.quiltdata.com",
        database="test-athena-db",
        iceberg_database=iceberg_database,
    )
    package_query._execute_query = Mock(side_effect=_fake_athena)
    package_query._list_iceberg_manifest_buckets = Mock(return_value=["lab-bucket"])

    content = _canvas(mock_benchling, mock_config, mock_payload, package_query)._make_markdown_content()

    crate = Package("test.quiltdata.com", "lab-bucket", "test/ro-crate-ingest")
    hand_typed = Package("test.quiltdata.com", "lab-bucket", "lab/hand-typed")
    tagged = Package("test.quiltdata.com", "lab-bucket", "lab/tagged")
    crate_line = f"* [test/ro-crate-ingest]({crate.catalog_url}) [[🔄 sync]]({crate.make_sync_url()})\n"
    hand_typed_line = f"* [lab/hand-typed]({hand_typed.catalog_url}) [[🔄 sync]]({hand_typed.make_sync_url()})\n"
    tagged_line = f"* [lab/tagged]({tagged.catalog_url}) [[🔄 sync]]({tagged.make_sync_url()})\n"
    # Sorted by name. A hand-typed eln_entry string links its package, but it isn't a crate, so no roles follow it.
    assert hand_typed_line + tagged_line + crate_line + CRATE_ROLE_LINES in content
    assert "Failed to search for linked packages" not in content


def test_sealed_canvas_renders_frozen_list_without_search_or_update(mock_benchling, mock_config, mock_payload):
    seal = {
        "event_id": "evt_coYeepNKIpIi",
        "accepted_at": "2026-04-16T00:28:41.650775+00:00",
        "linked_packages": [{"bucket": "lab-bucket", "name": "lab/data", "top_hash": "abc123"}],
    }
    package_query = Mock()
    fetcher = Mock(get_seal=Mock(return_value=("b07c91cf", seal)))
    manager = CanvasManager(mock_benchling, mock_config, mock_payload, package_query, fetcher)

    rendered = json.dumps(blocks_to_dict(manager._make_blocks()))

    package_query.find_unique_packages.assert_not_called()
    assert "Sealed 2026-04-16" in rendered
    assert f"packages/benchling/{DISPLAY_ID}/tree/b07c91cf" in rendered
    assert "packages/lab/data/tree/abc123" in rendered
    assert "update-package-" not in rendered
    assert "browse-linked-" not in rendered
    assert "tree/latest" not in rendered


LOCK_HASH = "9f8e7d6c" * 8


def _sealed_markdown(benchling, config, payload, get_lock=None, lock_error=None):
    fetcher = Mock(get_seal=Mock(return_value=(LOCK_HASH, {"accepted_at": "2026-10-04T10:00:00+00:00"})))
    manager = CanvasManager(benchling, config, payload, Mock(), fetcher, lock_error=lock_error)
    with patch("src.canvas.Registry") as registry:
        registry.return_value.get_lock = get_lock or Mock(return_value=None)
        return manager._make_markdown_content()


def test_locked_canvas_shows_lock_date_and_links_locked_revision(mock_benchling, mock_config, mock_payload):
    mock_config.quilt_api_key = "qk_test"
    lock = {"hash": LOCK_HASH, "lockedAt": "2026-10-05T12:00:00+00:00"}

    content = _sealed_markdown(mock_benchling, mock_config, mock_payload, get_lock=Mock(return_value=lock))

    assert (
        f"**🔒 Locked 2026-10-05** [`9f8e7d6`](https://test.quiltdata.com/b/lab-bucket/packages/benchling/{DISPLAY_ID}/tree/{LOCK_HASH})"
        in content
    )
    assert "Sealed" not in content


def test_resealed_canvas_does_not_show_earlier_lock_as_current(mock_benchling, mock_config, mock_payload):
    mock_config.quilt_api_key = "qk_test"
    earlier = "0123456" + "0" * 57
    lock = {"hash": earlier, "lockedAt": "2026-10-01T12:00:00+00:00"}

    content = _sealed_markdown(mock_benchling, mock_config, mock_payload, get_lock=Mock(return_value=lock))

    assert "**Sealed 2026-10-04**\n\nNot locked: locked at an earlier revision [`0123456`](" in content
    assert f"tree/{earlier})" in content
    assert "Locked 2026-10-01" not in content


def test_sealed_canvas_without_api_key_says_locking_is_not_configured(mock_benchling, mock_config, mock_payload):
    content = _sealed_markdown(mock_benchling, mock_config, mock_payload)

    assert "**Sealed 2026-10-04**\n\nNot locked: no Quilt API key is configured" in content


def test_sealed_canvas_shows_lock_failure(mock_benchling, mock_config, mock_payload):
    mock_config.quilt_api_key = "qk_test"
    error = "PackageLockPolicyTooLarge: unlock another package first"

    content = _sealed_markdown(mock_benchling, mock_config, mock_payload, lock_error=error)

    assert f"**Sealed 2026-10-04**\n\nNot locked: {error}" in content


def test_sealed_canvas_survives_lock_read_failure(mock_benchling, mock_config, mock_payload):
    mock_config.quilt_api_key = "qk_test"

    content = _sealed_markdown(
        mock_benchling, mock_config, mock_payload, get_lock=Mock(side_effect=ConnectionError("unreachable"))
    )

    assert "**Sealed 2026-10-04**\n\nLock status unavailable: unreachable" in content
