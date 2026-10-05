from unittest.mock import Mock, patch

import pytest
import requests

from src.package_event import RefreshOutcome, refresh_canvas_for_package_event


@pytest.fixture
def mock_config():
    config = Mock()
    config.aws_region = "us-west-2"
    config.s3_bucket_name = "test-bucket"
    config.quilt_catalog = "test.quiltdata.com"
    config.quilt_write_role_arn = ""
    config.quilt_api_key = ""
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


def _refresh_with_seal(config, seal, lock_error=None):
    """Run a package event for revision abc123; return (result, lock_sealed_revision mock, CanvasManager mock)."""
    with (
        patch("src.package_event.PackageFileFetcher") as mock_fetcher_class,
        patch("src.package_event.CanvasManager") as mock_canvas_manager,
        patch("src.package_event.lock_sealed_revision", return_value=lock_error) as mock_lock,
    ):
        mock_fetcher = mock_fetcher_class.return_value
        mock_fetcher.bucket = "test-bucket"
        mock_fetcher.get_package_top_hash.return_value = "abc123"
        mock_fetcher.get_package_metadata.return_value = {
            "canvas_id": "canvas_123",
            "entry_id": "etr_123456",
            "display_id": "EXP0001",
        }
        mock_fetcher.get_seal.return_value = seal
        mock_canvas_manager.return_value.update_canvas.return_value = {"success": True}

        result = refresh_canvas_for_package_event(
            "benchling/EXP0001", "abc123", config=config, benchling_factory=lambda: Mock()
        )
    return result, mock_lock, mock_canvas_manager


def test_package_event_locks_sealed_revision(mock_config):
    mock_config.quilt_api_key = "qk_test"

    result, mock_lock, _ = _refresh_with_seal(mock_config, ("abc123", {"linked_packages": []}))

    assert result.outcome == RefreshOutcome.SUCCESS
    mock_lock.assert_called_once()
    assert mock_lock.call_args.args[1:] == ("test-bucket", "benchling/EXP0001", "abc123", "EXP0001")


def test_package_event_does_not_lock_unsealed_revision(mock_config):
    mock_config.quilt_api_key = "qk_test"

    result, mock_lock, _ = _refresh_with_seal(mock_config, None)

    assert result.outcome == RefreshOutcome.SUCCESS
    mock_lock.assert_not_called()


def test_package_event_without_api_key_seals_only_and_logs_once(mock_config):
    with (
        patch("src.package_event._lock_unconfigured_logged", False),
        patch("src.package_event.logger") as mock_logger,
    ):
        for _ in range(2):
            result, mock_lock, _ = _refresh_with_seal(mock_config, ("abc123", {}))
            assert result.outcome == RefreshOutcome.SUCCESS
            mock_lock.assert_not_called()

    unconfigured = [c for c in mock_logger.info.call_args_list if "not configured" in c.args[0]]
    assert len(unconfigured) == 1


def test_package_event_passes_lock_failure_to_canvas_and_succeeds(mock_config):
    mock_config.quilt_api_key = "qk_test"
    error = "PackageLockPolicyTooLarge: unlock another package first"

    result, _, mock_canvas_manager = _refresh_with_seal(mock_config, ("abc123", {}), lock_error=error)

    assert result.outcome == RefreshOutcome.SUCCESS
    assert mock_canvas_manager.call_args.kwargs["lock_error"] == error
