"""
Tests for Payload class.
"""

from unittest.mock import Mock

import pytest
import requests

from src.payload import CanvasLookupError, CanvasOwnership, Payload, canvas_ownership, read_canvas_entry_id


def canvas_client(entry_id):
    """Fake Benchling client whose canvas lookup returns ``entry_id``."""
    client = Mock()
    client.apps.get_canvas_by_id.return_value = Mock(resource_id=entry_id)
    return client


class TestPayload:
    """Test Payload parsing for various event types."""

    def test_standard_entry_event(self):
        """Test parsing standard entry event."""
        payload_dict = {
            "message": {
                "type": "v2.entry.updated.fields",
                "id": "evt_123",
                "resourceId": "etr_456",
                "canvasId": "canvas_789",
                "timestamp": "2025-10-02T10:00:00Z",
            },
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        assert payload.entry_id == "etr_456"
        assert payload.event_id == "evt_123"
        assert payload.canvas_id == "canvas_789"
        assert payload.timestamp == "2025-10-02T10:00:00Z"
        assert payload.event_type == "v2.entry.updated.fields"
        assert payload.base_url == "https://demo.benchling.com"

    def test_canvas_user_interacted_event(self):
        """Test parsing canvas userInteracted event with buttonId."""
        payload_dict = {
            "message": {
                "type": "v2.canvas.userInteracted",
                "id": "evt_abc",
                "buttonId": "etr_xyz",  # Contains entry_id
                "canvasId": "canvas_123",
                "timestamp": "2025-10-02T11:00:00Z",
            },
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict, benchling=canvas_client("etr_xyz"))

        # The button names the same entry as the canvas
        assert payload.entry_id == "etr_xyz"
        assert payload.event_id == "evt_abc"
        assert payload.canvas_id == "canvas_123"
        assert payload.event_type == "v2.canvas.userInteracted"

    def test_canvas_user_interacted_with_prefixed_button_id(self):
        """Test parsing canvas userInteracted event with prefixed buttonId format."""
        payload_dict = {
            "message": {
                "type": "v2.canvas.userInteracted",
                "id": "evt_def",
                "buttonId": "update-button-etr_abc123",  # Format: *-{entry_id}
                "canvasId": "canvas_456",
                "timestamp": "2025-10-02T12:00:00Z",
            },
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict, benchling=canvas_client("etr_abc123"))

        assert payload.entry_id == "etr_abc123"
        assert payload.event_id == "evt_def"
        assert payload.canvas_id == "canvas_456"
        assert payload.event_type == "v2.canvas.userInteracted"

    def test_generated_event_id_is_stable(self):
        """Without a message id, the generated event_id is the same on every read."""
        payload = Payload({"message": {"type": "v2.entry.updated.fields", "resourceId": "etr_1"}})

        assert payload.event_id == payload.event_id

    def test_entry_id_fallback_to_message_entry_id(self):
        """Test entry_id falls back to message.entryId if resourceId missing."""
        payload_dict = {
            "message": {
                "id": "evt_123",
                "entryId": "etr_fallback",
                "type": "v2.entry.created",
            },
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        assert payload.entry_id == "etr_fallback"

    def test_entry_id_fallback_to_payload_resource_id(self):
        """Test entry_id falls back to payload.resourceId."""
        payload_dict = {
            "message": {"id": "evt_123", "type": "v2.entry.created"},
            "resourceId": "etr_payload_level",
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        assert payload.entry_id == "etr_payload_level"

    def test_missing_entry_id_raises(self):
        """Test missing entry_id raises ValueError."""
        payload_dict = {
            "message": {"id": "evt_123", "type": "v2.entry.created"},
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        with pytest.raises(ValueError, match="entry_id is required"):
            _ = payload.entry_id

    def test_missing_canvas_id_returns_none(self):
        """Test missing canvas_id returns None."""
        payload_dict = {
            "message": {"id": "evt_123", "resourceId": "etr_123"},
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        assert payload.canvas_id is None

    def test_canvas_id_falls_back_to_context(self):
        """Test canvas_id falls back to top-level context for canvas initialization events."""
        payload_dict = {
            "message": {"id": "evt_123", "resourceId": "etr_123", "type": "v2.canvas.initialized"},
            "context": {"canvasId": "canvas_from_context"},
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        assert payload.canvas_id == "canvas_from_context"

    def test_missing_timestamp_returns_none(self):
        """Test missing timestamp returns None."""
        payload_dict = {
            "message": {"id": "evt_123", "resourceId": "etr_123"},
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        assert payload.timestamp is None

    def test_event_id_generation(self):
        """Test event_id is generated if not in payload."""
        payload_dict = {
            "message": {"resourceId": "etr_123"},
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        # Should generate a UUID
        assert payload.event_id is not None
        assert len(payload.event_id) > 0

    def test_webhook_data_returns_message(self):
        """Test webhook_data returns the message portion."""
        payload_dict = {
            "message": {
                "id": "evt_123",
                "resourceId": "etr_123",
                "type": "v2.entry.created",
                "extra_field": "extra_value",
            },
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        assert payload.webhook_data == payload_dict["message"]
        assert payload.webhook_data["extra_field"] == "extra_value"

    def test_raw_payload_returns_complete_payload(self):
        """Test raw_payload returns the complete original payload."""
        payload_dict = {
            "message": {"id": "evt_123", "resourceId": "etr_123"},
            "baseURL": "https://demo.benchling.com",
            "extra_top_level": "extra_value",
        }

        payload = Payload(payload_dict)

        assert payload.raw_payload == payload_dict
        assert payload.raw_payload["extra_top_level"] == "extra_value"

    def test_entry_id_from_canvas_resource_id(self):
        """Test entry_id is extracted from canvas resource_id when not in payload."""
        payload_dict = {
            "message": {
                "id": "evt_123",
                "type": "v2.canvas.created",
                "canvasId": "canvas_abc123",
            },
            "baseURL": "https://demo.benchling.com",
        }

        # Mock Benchling client and canvas response
        mock_benchling = Mock()
        mock_canvas = Mock()
        mock_canvas.resource_id = "etr_from_canvas"
        mock_benchling.apps.get_canvas_by_id.return_value = mock_canvas

        payload = Payload(payload_dict, benchling=mock_benchling)

        # Should fetch canvas and get resource_id
        assert payload.entry_id == "etr_from_canvas"
        mock_benchling.apps.get_canvas_by_id.assert_called_once_with("canvas_abc123")

    def test_entry_id_canvas_fetch_failure_raises(self):
        """Test entry_id raises ValueError when canvas fetch fails and no fallback exists."""
        payload_dict = {
            "message": {
                "id": "evt_123",
                "type": "v2.canvas.created",
                "canvasId": "canvas_abc123",
            },
            "baseURL": "https://demo.benchling.com",
        }

        # Mock Benchling client with failing canvas fetch
        mock_benchling = Mock()
        mock_benchling.apps.get_canvas_by_id.side_effect = Exception("Canvas not found")

        payload = Payload(payload_dict, benchling=mock_benchling)

        # Should raise ValueError since no entry_id can be extracted
        with pytest.raises(ValueError, match="entry_id is required"):
            _ = payload.entry_id
        mock_benchling.apps.get_canvas_by_id.assert_called_once_with("canvas_abc123")

    def test_entry_id_canvas_resource_id_takes_precedence(self):
        """Test that explicit resourceId takes precedence over canvas fetch."""
        payload_dict = {
            "message": {
                "id": "evt_123",
                "type": "v2.canvas.created",
                "resourceId": "etr_explicit",
                "canvasId": "canvas_abc123",
            },
            "baseURL": "https://demo.benchling.com",
        }

        # Mock Benchling client - should not be called
        mock_benchling = Mock()

        payload = Payload(payload_dict, benchling=mock_benchling)

        # Should use explicit resourceId, not fetch canvas
        assert payload.entry_id == "etr_explicit"
        mock_benchling.apps.get_canvas_by_id.assert_not_called()

    def test_canvas_user_interacted_with_pagination_button_id(self):
        """Test entry_id extraction from button_id with pagination format."""
        payload_dict = {
            "message": {
                "type": "v2.canvas.userInteracted",
                "id": "evt_pagination",
                "buttonId": "browse-files-etr_abc123-p0-s15",  # Format: {action}-{entry_id}-p{page}-s{size}
                "canvasId": "canvas_789",
                "timestamp": "2025-10-23T12:00:00Z",
            },
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict, benchling=canvas_client("etr_abc123"))

        assert payload.entry_id == "etr_abc123"
        assert payload.event_id == "evt_pagination"
        assert payload.canvas_id == "canvas_789"
        assert payload.event_type == "v2.canvas.userInteracted"


class TestCanvasClickEntry:
    """A click acts on the entry Benchling records for the clicked canvas."""

    @staticmethod
    def _click(button_id, **message):
        return {
            "message": {"type": "v2.canvas.userInteracted", "buttonId": button_id, "canvasId": "cnvs_a", **message},
            "baseURL": "https://demo.benchling.com",
        }

    def test_entry_comes_from_the_canvas_record(self):
        client = canvas_client("etr_a")
        payload = Payload(self._click("update-package-etr_a"), benchling=client)

        assert payload.entry_id == "etr_a"
        client.apps.get_canvas_by_id.assert_called_once_with("cnvs_a")

    def test_lookup_runs_once_per_payload(self):
        client = canvas_client("etr_a")
        payload = Payload(self._click("refresh-canvas-etr_a"), benchling=client)

        assert payload.entry_id == payload.entry_id == "etr_a"
        client.apps.get_canvas_by_id.assert_called_once()

    @pytest.mark.parametrize(
        "button_id",
        [
            "update-package-etr_b",
            "refresh-canvas-etr_b",
            "browse-files-etr_b-p0-s15",
            "view-metadata-etr_b-p0-s15",
            "next-page-related-etr_b-p1-s5",
            "browse-linked-etr_b-pkg-benchling--exp-001-p0-s15",
            "view-metadata-linked-etr_b-pkg-benchling--exp-001-bucket-other-p0-s15",
            "link-related-etr_b-pkg-MJSW4Y3INRUW4ZZPIVMFAMI",
            "browse-files-etr_b-linked-etr_a-pkg-foo-p0-s15",
        ],
    )
    def test_button_for_another_entry_is_refused(self, button_id):
        payload = Payload(self._click(button_id), benchling=canvas_client("etr_a"))

        with pytest.raises(ValueError, match="different entry"):
            _ = payload.entry_id

    def test_payload_resource_id_is_ignored_for_clicks(self):
        payload = Payload(self._click("update-package-etr_a", resourceId="etr_b"), benchling=canvas_client("etr_a"))

        assert payload.entry_id == "etr_a"

    @pytest.mark.parametrize("button_id", ["some-unknown-button", "etr_b", "unknown-etr_b"])
    def test_button_no_action_handles_uses_the_canvas_entry(self, button_id):
        """A button the dispatcher routes nowhere names no entry; the click acts on the canvas's own."""
        payload = Payload(self._click(button_id), benchling=canvas_client("etr_a"))

        assert payload.entry_id == "etr_a"

    @pytest.mark.parametrize(
        "button_id",
        ["update-package-garbage", "update-package-", "refresh-canvas-etr_a-extra", "browse-files-p0-s15"],
    )
    def test_handled_button_without_a_readable_entry_is_refused(self, button_id):
        payload = Payload(self._click(button_id), benchling=canvas_client("etr_a"))

        with pytest.raises(ValueError, match="readable entry"):
            _ = payload.entry_id

    def test_lookup_failure_is_refused(self):
        client = Mock()
        client.apps.get_canvas_by_id.side_effect = Exception("Benchling unavailable")
        payload = Payload(self._click("update-package-etr_a"), benchling=client)

        with pytest.raises(ValueError, match="canvas"):
            _ = payload.entry_id

    def test_canvas_without_a_resource_is_refused(self):
        payload = Payload(self._click("update-package-etr_a"), benchling=canvas_client(None))

        with pytest.raises(ValueError, match="canvas"):
            _ = payload.entry_id

    def test_click_without_a_benchling_client_is_refused(self):
        payload = Payload(self._click("update-package-etr_a"))

        with pytest.raises(ValueError, match="canvas"):
            _ = payload.entry_id

    def test_click_without_a_canvas_id_is_refused(self):
        raw = self._click("update-package-etr_a")
        del raw["message"]["canvasId"]
        payload = Payload(raw, benchling=canvas_client("etr_a"))

        with pytest.raises(ValueError, match="canvas"):
            _ = payload.entry_id


class TestCanvasOwnership:
    """A lookup Benchling answered is final; one it couldn't answer is never taken as a mismatch."""

    @staticmethod
    def _error(status_code):
        from benchling_sdk.errors import BenchlingError

        return BenchlingError(status_code, {}, None, None, None)

    def _client(self, side_effect=None, resource_id="etr_a"):
        client = Mock()
        if side_effect is not None:
            client.apps.get_canvas_by_id.side_effect = side_effect
        else:
            client.apps.get_canvas_by_id.return_value = Mock(resource_id=resource_id)
        return client

    def test_match(self):
        assert canvas_ownership(self._client(), "cnvs_a", "etr_a") is CanvasOwnership.MATCH

    @pytest.mark.parametrize("resource_id", ["etr_b", None, ""])
    def test_answered_mismatch(self, resource_id):
        client = self._client(resource_id=resource_id)
        assert canvas_ownership(client, "cnvs_a", "etr_a") is CanvasOwnership.MISMATCH

    @pytest.mark.parametrize("status_code", [400, 403, 404])
    def test_client_error_is_an_answer(self, status_code):
        client = self._client(side_effect=self._error(status_code))
        assert canvas_ownership(client, "cnvs_a", "etr_a") is CanvasOwnership.MISMATCH

    @pytest.mark.parametrize(
        "failure",
        [
            "429",
            "500",
            "503",
            requests.exceptions.Timeout("t"),
            requests.exceptions.ConnectionError("c"),
            RuntimeError("x"),
        ],
    )
    def test_unanswered_lookup_is_unknown(self, failure):
        side_effect = self._error(int(failure)) if isinstance(failure, str) else failure
        client = self._client(side_effect=side_effect)
        assert canvas_ownership(client, "cnvs_a", "etr_a") is CanvasOwnership.UNKNOWN
        with pytest.raises(CanvasLookupError):
            read_canvas_entry_id(client, "cnvs_a")
