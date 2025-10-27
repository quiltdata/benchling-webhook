"""
Tests for Payload class.
"""

from unittest.mock import Mock

import pytest

from src.payload import Payload


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

        payload = Payload(payload_dict)

        # For canvas userInteracted events, buttonId is the entry_id
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

        payload = Payload(payload_dict)

        # Should extract entry_id from after last dash
        assert payload.entry_id == "etr_abc123"
        assert payload.event_id == "evt_def"
        assert payload.canvas_id == "canvas_456"
        assert payload.event_type == "v2.canvas.userInteracted"

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

    def test_entry_id_canvas_fetch_failure_falls_back(self):
        """Test entry_id falls back to most_recent_entry when canvas fetch fails."""
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

        # Mock entries response
        mock_entry = Mock()
        mock_entry.id = "etr_fallback_123"
        mock_entries_iter = Mock()
        mock_entries_iter.first.return_value = mock_entry
        mock_benchling.entries.list_entries.return_value = mock_entries_iter

        payload = Payload(payload_dict, benchling=mock_benchling)

        # Should fall back to most recent entry
        assert payload.entry_id == "etr_fallback_123"
        mock_benchling.apps.get_canvas_by_id.assert_called_once_with("canvas_abc123")
        mock_benchling.entries.list_entries.assert_called_once()

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

        payload = Payload(payload_dict)

        # Should correctly extract entry_id from pagination button format
        assert payload.entry_id == "etr_abc123"
        assert payload.event_id == "evt_pagination"
        assert payload.canvas_id == "canvas_789"
        assert payload.event_type == "v2.canvas.userInteracted"
