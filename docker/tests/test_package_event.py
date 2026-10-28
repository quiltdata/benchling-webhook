from unittest.mock import Mock, call, patch

import pytest
import requests

from src.package_event import RefreshOutcome, refresh_canvas_for_package_event
from src.packages import Package


@pytest.fixture
def mock_config():
    config = Mock()
    config.aws_region = "us-west-2"
    config.s3_bucket_name = "test-bucket"
    config.quilt_catalog = "test.quiltdata.com"
    config.quilt_write_role_arn = ""
    return config


def test_refresh_canvas_for_package_event_success(mock_config):
    benchling_client = Mock()

    with (
        patch("src.package_event.PackageFileFetcher") as mock_fetcher_class,
        patch("src.package_event.CanvasManager") as mock_canvas_manager,
    ):
        mock_fetcher = Mock()
        mock_fetcher.get_package_top_hash.return_value = "abc123"
        mock_fetcher.get_package_metadata.return_value = {
            "canvas_id": "canvas_123",
            "entry_id": "etr_123456",
        }
        mock_fetcher_class.return_value = mock_fetcher

        mock_manager = Mock()
        mock_manager.update_canvas.return_value = {"success": True, "canvas_id": "canvas_123"}
        mock_canvas_manager.return_value = mock_manager

        result = refresh_canvas_for_package_event(
            "benchling/EXP0001",
            "abc123",
            config=mock_config,
            benchling_factory=lambda: benchling_client,
        )

    assert result.outcome == RefreshOutcome.SUCCESS


def test_refresh_canvas_for_package_event_skips_stale_revision(mock_config):
    with patch("src.package_event.PackageFileFetcher") as mock_fetcher_class:
        mock_fetcher = Mock()
        mock_fetcher.get_package_top_hash.return_value = "newer123"
        mock_fetcher_class.return_value = mock_fetcher

        result = refresh_canvas_for_package_event(
            "benchling/EXP0001",
            "abc123",
            config=mock_config,
            benchling_factory=Mock(),
        )

    assert result.outcome == RefreshOutcome.SKIPPED_STALE


def test_refresh_canvas_for_package_event_skips_missing_canvas_target(mock_config):
    with patch("src.package_event.PackageFileFetcher") as mock_fetcher_class:
        mock_fetcher = Mock()
        mock_fetcher.get_package_metadata.return_value = {"entry_id": "etr_123456"}
        mock_fetcher_class.return_value = mock_fetcher

        result = refresh_canvas_for_package_event(
            "benchling/EXP0001",
            None,
            config=mock_config,
            benchling_factory=Mock(),
        )

    assert result.outcome == RefreshOutcome.SKIPPED_NO_CANVAS


def test_refresh_canvas_for_package_event_classifies_http_5xx_as_transient(mock_config):
    response = Mock(status_code=503)
    error = requests.exceptions.HTTPError("server error", response=response)

    with patch("src.package_event.PackageFileFetcher", side_effect=error):
        result = refresh_canvas_for_package_event(
            "benchling/EXP0001",
            None,
            config=mock_config,
            benchling_factory=Mock(),
        )

    assert result.outcome == RefreshOutcome.TRANSIENT_ERROR
    assert result.error_type == "HTTPError"


def test_refresh_canvas_for_package_event_classifies_http_4xx_as_permanent(mock_config):
    response = Mock(status_code=404)
    error = requests.exceptions.HTTPError("not found", response=response)

    with patch("src.package_event.PackageFileFetcher", side_effect=error):
        result = refresh_canvas_for_package_event(
            "benchling/EXP0001",
            None,
            config=mock_config,
            benchling_factory=Mock(),
        )

    assert result.outcome == RefreshOutcome.PERMANENT_ERROR
    assert result.error_type == "HTTPError"


def test_refresh_canvas_for_package_event_classifies_unexpected_error_as_transient(mock_config):
    with patch("src.package_event.PackageFileFetcher", side_effect=RuntimeError("boom")):
        result = refresh_canvas_for_package_event(
            "benchling/EXP0001",
            None,
            config=mock_config,
            benchling_factory=Mock(),
        )

    assert result.outcome == RefreshOutcome.TRANSIENT_ERROR
    assert result.error_type == "RuntimeError"


def test_related_revision_resolves_nested_link_target_by_display_id(mock_config):
    """A nested related package refreshes the actual indexed entry package Canvas."""
    mock_config.quilt_database = "athena-db"
    mock_config.package_key = "experiment_id"
    benchling_client = Mock()

    with (
        patch("src.package_event.PackageFileFetcher") as mock_fetcher_class,
        patch("src.package_event.PackageQuery") as mock_query_class,
        patch("src.package_event.CanvasManager") as mock_canvas_manager,
    ):
        fetcher = Mock()
        fetcher.get_package_top_hash.return_value = "abc123"
        fetcher.get_package_metadata.return_value = {}
        fetcher.get_package_user_metadata.return_value = {"experiment_id": "EXP1"}
        mock_fetcher_class.return_value = fetcher

        entry_package = Package(
            "test.quiltdata.com",
            "test-bucket",
            "ale/EXP1",
            metadata={"entry_id": "etr_target", "canvas_id": "cnvs_target", "display_id": "EXP1"},
        )
        query = Mock()
        query.find_unique_packages.return_value = {"packages": [entry_package]}
        mock_query_class.return_value = query

        manager = Mock()
        manager.update_canvas.return_value = {"success": True, "canvas_id": "cnvs_target"}
        mock_canvas_manager.return_value = manager

        result = refresh_canvas_for_package_event(
            "ale/raw/data1",
            "abc123",
            config=mock_config,
            benchling_factory=lambda: benchling_client,
        )

    assert result.outcome == RefreshOutcome.SUCCESS
    query.find_unique_packages.assert_called_once_with(key="display_id", value="EXP1")
    payload = mock_canvas_manager.call_args.args[2]
    assert payload.entry_id == "etr_target"
    assert payload.canvas_id == "cnvs_target"
    manager.update_canvas.assert_called_once()


def test_bucketless_related_revision_searches_globally_and_reads_target_bucket(mock_config):
    mock_config.s3_bucket_name = ""
    mock_config.quilt_database = "athena-db"
    mock_config.package_key = "experiment_id"

    with (
        patch("src.package_event.PackageFileFetcher") as mock_fetcher_class,
        patch("src.package_event.PackageQuery") as mock_query_class,
        patch("src.package_event.CanvasManager") as mock_canvas_manager,
    ):
        source_fetcher = Mock()
        source_fetcher.get_package_top_hash.return_value = "abc123"
        source_fetcher.get_package_metadata.return_value = {}
        source_fetcher.get_package_user_metadata.return_value = {"experiment_id": "EXP1"}
        target_fetcher = Mock()
        target_fetcher.get_package_metadata.return_value = {
            "entry_id": "etr_target",
            "canvas_id": "cnvs_target",
        }
        mock_fetcher_class.side_effect = [source_fetcher, target_fetcher]

        entry_package = Package("test.quiltdata.com", "bucket-b", "ale/EXP1", metadata={})
        query = Mock()
        query.find_unique_packages.return_value = {"packages": [entry_package]}
        mock_query_class.return_value = query

        manager = Mock()
        manager.update_canvas.return_value = {"success": True, "canvas_id": "cnvs_target"}
        mock_canvas_manager.return_value = manager

        result = refresh_canvas_for_package_event(
            "ale/raw/data1",
            "abc123",
            config=mock_config,
            benchling_factory=Mock,
            bucket="bucket-a",
        )

    assert result.outcome == RefreshOutcome.SUCCESS
    assert mock_query_class.call_args.kwargs["bucket"] == ""
    assert mock_fetcher_class.call_args_list[0].kwargs["bucket"] == "bucket-a"
    assert mock_fetcher_class.call_args_list[1].kwargs["bucket"] == "bucket-b"
    target_fetcher.get_package_metadata.assert_called_once_with("ale/EXP1")


def test_bucketless_partial_target_lookup_is_retryable(mock_config):
    mock_config.s3_bucket_name = ""
    mock_config.quilt_database = "athena-db"
    mock_config.package_key = "experiment_id"

    with (
        patch("src.package_event.PackageFileFetcher") as mock_fetcher_class,
        patch("src.package_event.PackageQuery") as mock_query_class,
        patch("src.package_event.CanvasManager") as mock_canvas_manager,
    ):
        source_fetcher = Mock()
        source_fetcher.get_package_top_hash.return_value = "abc123"
        source_fetcher.get_package_metadata.return_value = {}
        source_fetcher.get_package_user_metadata.return_value = {"experiment_id": "EXP1"}
        mock_fetcher_class.return_value = source_fetcher

        query = Mock()
        query.find_unique_packages.return_value = {
            "packages": [],
            "results": {"errors": {"bucket-b": "Access denied"}},
        }
        mock_query_class.return_value = query

        result = refresh_canvas_for_package_event(
            "ale/raw/data1",
            "abc123",
            config=mock_config,
            benchling_factory=Mock,
            bucket="bucket-a",
        )

    assert result.outcome == RefreshOutcome.TRANSIENT_ERROR
    assert "incomplete" in (result.error_message or "")
    mock_canvas_manager.assert_not_called()


def test_unindexed_link_target_is_retryable(mock_config):
    mock_config.quilt_database = "athena-db"
    mock_config.package_key = "experiment_id"

    with (
        patch("src.package_event.PackageFileFetcher") as mock_fetcher_class,
        patch("src.package_event.PackageQuery") as mock_query_class,
        patch("src.package_event.CanvasManager") as mock_canvas_manager,
    ):
        source_fetcher = Mock()
        source_fetcher.get_package_top_hash.return_value = "abc123"
        source_fetcher.get_package_metadata.return_value = {}
        source_fetcher.get_package_user_metadata.return_value = {"experiment_id": "EXP1"}
        mock_fetcher_class.return_value = source_fetcher

        query = Mock()
        query.find_unique_packages.return_value = {
            "packages": [],
            "results": {"errors": {}},
        }
        mock_query_class.return_value = query

        result = refresh_canvas_for_package_event(
            "ale/raw/data1",
            "abc123",
            config=mock_config,
            benchling_factory=Mock,
        )

    assert result.outcome == RefreshOutcome.TRANSIENT_ERROR
    assert "not indexed yet" in (result.error_message or "")
    mock_canvas_manager.assert_not_called()


def test_unresolved_old_link_does_not_block_resolvable_new_canvas(mock_config):
    mock_config.quilt_database = "athena-db"
    mock_config.package_key = "experiment_id"

    with (
        patch("src.package_event.PackageFileFetcher") as mock_fetcher_class,
        patch("src.package_event.PackageQuery") as mock_query_class,
        patch("src.package_event.CanvasManager") as mock_canvas_manager,
    ):
        source_fetcher = Mock()
        source_fetcher.get_package_top_hash.return_value = "abc123"
        source_fetcher.get_package_metadata.return_value = {}
        source_fetcher.get_package_user_metadata.return_value = {
            "experiment_id": "OLD",
            "eln_entry": ["NEW"],
        }
        mock_fetcher_class.return_value = source_fetcher

        target_package = Package(
            "test.quiltdata.com",
            "test-bucket",
            "ale/NEW",
            metadata={"entry_id": "etr_new", "canvas_id": "cnvs_new"},
        )
        query = Mock()
        query.find_unique_packages.side_effect = [
            {"packages": [], "results": {"errors": {}}},
            {"packages": [target_package], "results": {"errors": {}}},
        ]
        mock_query_class.return_value = query

        manager = Mock()
        manager.update_canvas.return_value = {"success": True, "canvas_id": "cnvs_new"}
        mock_canvas_manager.return_value = manager

        result = refresh_canvas_for_package_event(
            "ale/raw/data1",
            "abc123",
            config=mock_config,
            benchling_factory=Mock,
        )

    assert result.outcome == RefreshOutcome.TRANSIENT_ERROR
    assert result.error_type == "CanvasRefreshIncomplete"
    assert "OLD" in (result.error_message or "")
    assert query.find_unique_packages.call_args_list == [
        call(key="display_id", value="OLD"),
        call(key="display_id", value="NEW"),
    ]
    manager.update_canvas.assert_called_once()
