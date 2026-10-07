"""
Tests for EntryPackager.

Following TDD methodology for Phase 2 implementation.
"""

import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Any
from unittest.mock import Mock, patch

import pytest
from botocore.exceptions import ClientError

from src.entry_packager import (
    BenchlingAPIError,
    DateTimeEncoder,
    EntryPackager,
    EntryValidationError,
    ExportItemRequest,
    format_user_info,
    normalize_field_key,
    normalize_fields,
    parse_authors,
    parse_creator,
    validate_entry_data,
)
from src.package_naming import MissingPlaceholderError
from src.packages import Package
from src.payload import Payload


class TestValidationHelpers:
    """Test validation helper functions."""

    def test_validate_entry_data_success(self):
        """Test successful validation with all required fields."""
        entry_data = {
            "display_id": "ELN-123",
            "name": "Test Entry",
            "web_url": "https://demo.benchling.com/entry/etr_123",
            "created_at": "2025-10-01T10:00:00Z",
            "modified_at": "2025-10-02T10:00:00Z",
        }

        result = validate_entry_data(entry_data, "etr_123")

        assert result["display_id"] == "ELN-123"
        assert result["name"] == "Test Entry"
        assert result["web_url"] == "https://demo.benchling.com/entry/etr_123"
        assert result["created_at"] == "2025-10-01T10:00:00Z"
        assert result["modified_at"] == "2025-10-02T10:00:00Z"

    def test_validate_entry_data_missing_field(self):
        """Test validation fails with missing required field."""
        entry_data = {
            "display_id": "ELN-123",
            "name": "Test Entry",
            # Missing web_url, created_at, modified_at
        }

        with pytest.raises(EntryValidationError) as exc_info:
            validate_entry_data(entry_data, "etr_123")

        error_msg = str(exc_info.value)
        assert "Missing required fields" in error_msg
        assert "web_url" in error_msg
        assert "created_at" in error_msg
        assert "modified_at" in error_msg
        assert "etr_123" in error_msg

    def test_validate_entry_data_all_missing(self):
        """Test validation fails with all fields missing."""
        entry_data = {}

        with pytest.raises(EntryValidationError) as exc_info:
            validate_entry_data(entry_data, "etr_123")

        error_msg = str(exc_info.value)
        assert "display_id" in error_msg
        assert "name" in error_msg
        assert "web_url" in error_msg

    def test_format_user_info_complete(self):
        """Test formatting complete user info."""
        user_data = {"name": "John Doe", "handle": "jdoe", "id": "user_123"}

        result = format_user_info(user_data)

        assert result == "John Doe <jdoe@user_123>"

    def test_format_user_info_missing_name(self):
        """Test formatting user info without name returns empty string."""
        user_data = {"handle": "jdoe", "id": "user_123"}

        result = format_user_info(user_data)

        assert result == ""

    def test_format_user_info_partial_data(self):
        """Test formatting user info with partial data."""
        user_data = {"name": "John Doe", "handle": "jdoe"}

        result = format_user_info(user_data)

        # Should still work with missing id
        assert result == "John Doe <jdoe@>"

    def test_format_user_info_not_dict(self):
        """Test formatting non-dict user info returns empty string."""
        assert format_user_info(None) == ""  # type: ignore[arg-type]
        assert format_user_info("string") == ""  # type: ignore[arg-type]
        assert format_user_info(123) == ""  # type: ignore[arg-type]

    def test_parse_creator_success(self):
        """Test parsing creator from entry data."""
        entry_data = {"creator": {"name": "John Doe", "handle": "jdoe", "id": "user_123"}}

        result = parse_creator(entry_data)

        assert result == "John Doe <jdoe@user_123>"

    def test_parse_creator_missing(self):
        """Test parsing creator when not present."""
        entry_data = {}

        result = parse_creator(entry_data)

        assert result == ""

    def test_parse_creator_invalid(self):
        """Test parsing creator with invalid data."""
        entry_data = {"creator": "not a dict"}

        result = parse_creator(entry_data)

        assert result == ""

    def test_parse_authors_success(self):
        """Test parsing authors list from entry data."""
        entry_data = {
            "authors": [
                {"name": "John Doe", "handle": "jdoe", "id": "user_123"},
                {"name": "Jane Smith", "handle": "jsmith", "id": "user_456"},
            ]
        }

        result = parse_authors(entry_data)

        assert len(result) == 2
        assert result[0] == "John Doe <jdoe@user_123>"
        assert result[1] == "Jane Smith <jsmith@user_456>"

    def test_parse_authors_empty_list(self):
        """Test parsing empty authors list."""
        entry_data = {"authors": []}

        result = parse_authors(entry_data)

        assert result == []

    def test_parse_authors_missing(self):
        """Test parsing authors when not present."""
        entry_data = {}

        result = parse_authors(entry_data)

        assert result == []

    def test_parse_authors_invalid_items(self):
        """Test parsing authors with invalid items."""
        entry_data = {"authors": [{"name": "John Doe", "handle": "jdoe", "id": "user_123"}, "not a dict", None]}

        result = parse_authors(entry_data)

        # Should only include valid author
        assert len(result) == 1
        assert result[0] == "John Doe <jdoe@user_123>"

    def test_parse_authors_missing_names(self):
        """Test parsing authors with missing names."""
        entry_data = {
            "authors": [
                {"name": "John Doe", "handle": "jdoe", "id": "user_123"},
                {"handle": "noname", "id": "user_456"},  # Missing name
            ]
        }

        result = parse_authors(entry_data)

        # Should only include author with name
        assert len(result) == 1
        assert result[0] == "John Doe <jdoe@user_123>"


class TestFieldNormalization:
    """Entry fields are re-keyed by snake_case display name for entry.json (#409)."""

    @pytest.mark.parametrize(
        "name, key",
        [
            ("Project", "project"),
            ("Experiment Type", "experiment_type"),
            ("ELN-ID #", "eln_id"),
            ("  Run   Date (UTC) ", "run_date_utc"),
            ("pH", "ph"),
            ("Step 2", "step_2"),
            ("###", ""),
        ],
    )
    def test_normalize_field_key(self, name, key):
        assert normalize_field_key(name) == key

    def test_keeps_display_name_and_values(self):
        fields = {
            "Experiment Type": {
                "value": "Assay",
                "displayValue": "Assay",
                "type": "dropdown",
                "isMulti": False,
                "textValue": "Assay",
            }
        }

        result = normalize_fields(fields)

        assert result == {
            "experiment_type": {
                "name": "Experiment Type",
                "value": "Assay",
                "displayValue": "Assay",
                "type": "dropdown",
                "isMulti": False,
                "textValue": "Assay",
            }
        }
        # The raw map is not mutated (entry_data.json stays raw).
        assert "name" not in fields["Experiment Type"]

    def test_collision_suffixes_later_fields(self):
        with patch("src.entry_packager.logger") as mock_logger:
            result = normalize_fields(
                {"Project": {"value": "A"}, "project": {"value": "B"}, "PROJECT!": {"value": "C"}}
            )

        assert result == {
            "project": {"name": "Project", "value": "A"},
            "project_2": {"name": "project", "value": "B"},
            "project_3": {"name": "PROJECT!", "value": "C"},
        }
        assert mock_logger.warning.call_count == 2
        first = mock_logger.warning.call_args_list[0].kwargs
        assert first["kept"] == "Project"
        assert first["renamed"] == "project"

    def test_suffix_skips_a_key_already_taken(self):
        result = normalize_fields({"Project": {"value": "A"}, "Project 2": {"value": "B"}, "project": {"value": "C"}})

        assert list(result) == ["project", "project_2", "project_3"]
        assert result["project_3"]["name"] == "project"

    def test_empty_key_is_skipped_with_warning(self):
        with patch("src.entry_packager.logger") as mock_logger:
            result = normalize_fields({"###": {"value": "x"}, "Project": {"value": "A"}})

        assert result == {"project": {"name": "Project", "value": "A"}}
        mock_logger.warning.assert_called_once()
        assert mock_logger.warning.call_args.kwargs["field_name"] == "###"

    def test_accepts_list_of_field_objects(self):
        result = normalize_fields([{"name": "Experiment Type", "value": "Assay"}, "junk", {"value": "no name"}])

        assert result == {"experiment_type": {"name": "Experiment Type", "value": "Assay"}}

    @pytest.mark.parametrize("fields", [None, {}, [], "not-a-map"])
    def test_missing_or_invalid_is_empty(self, fields):
        assert normalize_fields(fields) == {}


class TestPayload:
    """Test Payload parsing."""

    def test_from_webhook_payload_basic(self):
        """Test Payload creation from webhook payload."""
        payload_dict = {
            "message": {
                "type": "v2.entry.updated.fields",
                "id": "evt_123",
                "resourceId": "etr_456",
                "entryId": "etr_456",
                "canvasId": "canvas_789",
                "timestamp": "2025-10-02T10:00:00Z",
            },
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        assert payload.entry_id == "etr_456"
        assert payload.event_id == "evt_123"
        assert payload.base_url == "https://demo.benchling.com"
        assert payload.canvas_id == "canvas_789"
        assert payload.timestamp == "2025-10-02T10:00:00Z"

    def test_from_webhook_payload_missing_canvas(self):
        """Test Payload with missing canvas ID."""
        payload_dict = {
            "message": {"id": "evt_123", "resourceId": "etr_456"},
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        assert payload.entry_id == "etr_456"
        assert payload.canvas_id is None

    def test_from_webhook_payload_uses_entry_id_fallback(self):
        """Test Payload uses entryId if resourceId missing."""
        payload_dict = {
            "message": {"id": "evt_123", "entryId": "etr_789"},
            "baseURL": "https://demo.benchling.com",
        }

        payload = Payload(payload_dict)

        assert payload.entry_id == "etr_789"


class TestEntryPackager:
    """Test EntryPackager class."""

    @pytest.fixture
    def mock_benchling(self):
        """Create mock Benchling SDK client."""
        mock = Mock()
        mock.url = "https://demo.benchling.com"
        mock.entries = Mock()
        mock.exports = Mock()
        mock.tasks = Mock()
        mock.apps = Mock()
        return mock

    @pytest.fixture
    def mock_config(self):
        """Create mock config."""
        config = Mock()
        config.s3_bucket_name = "test-bucket"
        config.s3_prefix = "benchling"
        config.queue_url = "J3456789012/test"
        config.quilt_catalog = "test.quiltdata.com"
        config.aws_region = "us-west-2"
        config.workflow = ""
        config.quilt_write_role_arn = ""
        return config

    @pytest.fixture
    def orchestrator(self, mock_benchling, mock_config):
        """Create EntryPackager with mocked dependencies."""
        packager = EntryPackager(
            benchling=mock_benchling,
            config=mock_config,
        )
        packager.role_manager.get_s3_client = Mock(return_value=Mock())
        return packager

    def test_orchestrator_initialization(self, orchestrator):
        """Test EntryPackager initializes correctly."""
        assert orchestrator.benchling is not None
        assert orchestrator.config is not None
        assert orchestrator.sqs_client is not None
        assert orchestrator.logger is not None

    def test_fetch_entry_data_success(self, orchestrator, mock_benchling):
        """Test successful entry data fetch."""
        # Setup mocks
        mock_entry = Mock()
        mock_entry.to_dict.return_value = {"id": "etr_123", "name": "Test Entry", "fields": []}
        mock_benchling.entries.get_entry_by_id.return_value = mock_entry

        # Execute
        result = orchestrator._fetch_entry_data("etr_123")

        # Verify
        assert result["id"] == "etr_123"
        assert result["name"] == "Test Entry"

    def test_fetch_entry_data_graphql_failure_continues(self, orchestrator, mock_benchling):
        """Test workflow continues if entry fetch succeeds."""
        mock_entry = Mock()
        mock_entry.to_dict.return_value = {"id": "etr_123", "name": "Test Entry", "fields": []}
        mock_benchling.entries.get_entry_by_id.return_value = mock_entry

        result = orchestrator._fetch_entry_data("etr_123")

        assert result["id"] == "etr_123"

    def test_fetch_entry_data_rest_failure_raises(self, orchestrator, mock_benchling):
        """Test API failure raises exception."""
        # SDK call fails
        mock_benchling.entries.get_entry_by_id.side_effect = Exception("API error")

        # Should raise
        with pytest.raises(BenchlingAPIError, match="Failed to fetch entry"):
            orchestrator._fetch_entry_data("etr_123")

    # Episode 3: InitiateExport tests
    def test_initiate_export_success(self, orchestrator, mock_benchling):
        """Test successful export initiation."""
        mock_export_result = Mock()
        mock_export_result.task_id = "task_456"
        mock_benchling.exports.export.return_value = mock_export_result

        result = orchestrator._initiate_export("etr_123")

        assert result["id"] == "task_456"
        # Verify the export was called with an ExportItemRequest object
        assert mock_benchling.exports.export.call_count == 1
        call_args = mock_benchling.exports.export.call_args[0]
        assert len(call_args) == 1
        assert isinstance(call_args[0], ExportItemRequest)

    def test_initiate_export_missing_task_id(self, orchestrator, mock_benchling):
        """Test export initiation with missing task ID."""
        # Missing task ID in response
        mock_export_result = Mock()
        mock_export_result.task_id = None
        mock_benchling.exports.export.return_value = mock_export_result

        with pytest.raises(BenchlingAPIError, match="task ID not found"):
            orchestrator._initiate_export("etr_123")

    # Episode 4: PollExportStatus tests
    def test_poll_export_status_success_immediate(self, orchestrator, mock_benchling):
        """Test export polling when status is immediately SUCCEEDED."""
        mock_task = Mock()
        mock_task.id = "task_123"
        mock_task.status = Mock()
        mock_task.status.value = "SUCCEEDED"
        mock_task.response = Mock()
        mock_task.response.get = Mock(return_value="https://example.com/export.zip")
        mock_benchling.tasks.get_by_id.return_value = mock_task

        result = orchestrator._poll_export_status("task_123")

        assert result["status"] == "SUCCEEDED"
        assert result["downloadURL"] == "https://example.com/export.zip"

    def test_poll_export_status_success_after_polling(self, orchestrator, mock_benchling):
        """Test export polling when status changes from RUNNING to SUCCEEDED."""
        # First call: RUNNING, then SUCCEEDED
        mock_task_running = Mock()
        mock_task_running.id = "task_123"
        mock_task_running.status = Mock()
        mock_task_running.status.value = "RUNNING"
        mock_task_running.response = None

        mock_task_success = Mock()
        mock_task_success.id = "task_123"
        mock_task_success.status = Mock()
        mock_task_success.status.value = "SUCCEEDED"
        mock_task_success.response = Mock()
        mock_task_success.response.get = Mock(return_value="https://example.com/export.zip")

        mock_benchling.tasks.get_by_id.side_effect = [mock_task_running, mock_task_success]

        # Mock time.sleep to speed up test
        with patch("time.sleep"):
            result = orchestrator._poll_export_status("task_123", poll_interval=1)

        assert result["status"] == "SUCCEEDED"
        assert mock_benchling.tasks.get_by_id.call_count == 2

    def test_poll_export_status_timeout(self, orchestrator, mock_benchling):
        """Test export polling timeout after max attempts."""
        # Always return RUNNING
        mock_task = Mock()
        mock_task.id = "task_123"
        mock_task.status = Mock()
        mock_task.status.value = "RUNNING"
        mock_task.response = None
        mock_benchling.tasks.get_by_id.return_value = mock_task

        with patch("time.sleep"):
            with pytest.raises(TimeoutError, match="did not complete"):
                orchestrator._poll_export_status("task_123", max_attempts=3, poll_interval=1)

    def test_poll_export_status_failed(self, orchestrator, mock_benchling):
        """Test export polling when export fails."""
        mock_task = Mock()
        mock_task.id = "task_123"
        mock_task.status = Mock()
        mock_task.status.value = "FAILED"
        mock_task.response = None
        mock_benchling.tasks.get_by_id.return_value = mock_task

        with pytest.raises(BenchlingAPIError, match="Export failed"):
            orchestrator._poll_export_status("task_123")

    # Episode 5: ProcessExport tests
    def test_process_export_lambda_error(self, orchestrator, mock_benchling):
        """Test inline processing error handling."""
        # Mock entry data for the initial fetch
        mock_entry = Mock()
        mock_entry.to_dict.return_value = {
            "id": "etr_123",
            "display_id": "EXP0001",
            "name": "Test Entry",
            "web_url": "https://demo.benchling.com/entry/etr_123",
            "created_at": "2025-10-01T10:00:00Z",
            "modified_at": "2025-10-02T10:00:00Z",
            "fields": [],
        }
        mock_benchling.entries.get_entry_by_id.return_value = mock_entry

        # Mock requests.get to raise an error (simulating download failure)
        mock_response = Mock()
        mock_response.raise_for_status.side_effect = Exception("Download failed")

        # Create a payload object
        payload = Payload(
            {
                "message": {
                    "resourceId": "etr_123",
                    "timestamp": "2025-10-02T10:00:00Z",
                }
            }
        )

        # Replace the decorator temporarily
        original_process = orchestrator._process_export.__wrapped__  # Get unwrapped function
        with patch("src.entry_packager.requests.get", return_value=mock_response):
            with pytest.raises(Exception, match="Download failed"):
                # Call the unwrapped function directly to avoid retry delay
                original_process(
                    orchestrator,
                    payload=payload,
                    download_url="https://example.com/export.zip",
                    package_name="benchling/ELN-123",
                )

    # Episode 6: SendToSQS tests
    @staticmethod
    def _payload_with(
        event_type: str = "v2.entry.created",
        timestamp: str | None = "2025-10-02T10:00:00Z",
    ) -> Payload:
        message: dict = {"id": "evt_1", "resourceId": "etr_456", "type": event_type}
        if timestamp is not None:
            message["timestamp"] = timestamp
        return Payload({"message": message, "baseURL": "https://demo.benchling.com"})

    def test_send_to_sqs_success(self, orchestrator):
        """Test successful SQS message send."""
        mock_response = {"MessageId": "msg_123"}

        with patch.object(orchestrator.sqs_client, "send_message", return_value=mock_response):
            result = orchestrator._send_to_sqs(
                package_name="benchling/EXP0001",  # Now uses display_id
                payload=self._payload_with(),
            )

        assert result["MessageId"] == "msg_123"

    def test_send_to_sqs_commit_message_includes_event_type_and_timestamp(self, orchestrator):
        """Commit message embeds the event type so revisions are self-describing."""
        mock_response = {"MessageId": "msg_123"}

        with patch.object(orchestrator.sqs_client, "send_message", return_value=mock_response) as send_mock:
            orchestrator._send_to_sqs(
                package_name="benchling/EXP0001",
                payload=self._payload_with(
                    event_type="v2.entry.updated.reviewRecord",
                    timestamp="2026-04-15T14:25:03Z",
                ),
            )

        message_body = json.loads(send_mock.call_args.kwargs["MessageBody"])
        assert message_body["commit_message"] == ("Benchling v2.entry.updated.reviewRecord at 2026-04-15T14:25:03Z")

    def test_send_to_sqs_commit_message_drops_timestamp_when_missing(self, orchestrator):
        """Missing timestamp must not produce a trailing ' at ' suffix."""
        mock_response = {"MessageId": "msg_123"}

        with patch.object(orchestrator.sqs_client, "send_message", return_value=mock_response) as send_mock:
            orchestrator._send_to_sqs(
                package_name="benchling/EXP0001",
                payload=self._payload_with(event_type="v2.entry.created", timestamp=None),
            )

        message_body = json.loads(send_mock.call_args.kwargs["MessageBody"])
        assert message_body["commit_message"] == "Benchling v2.entry.created"

    def test_send_to_sqs_includes_workflow_when_configured(self, orchestrator):
        """Test workflow is forwarded to the Quilt package creation payload."""
        orchestrator.config.workflow = "custom-workflow"
        mock_response = {"MessageId": "msg_123"}

        with patch.object(orchestrator.sqs_client, "send_message", return_value=mock_response) as send_mock:
            orchestrator._send_to_sqs(
                package_name="benchling/EXP0001",
                payload=self._payload_with(),
            )

        message_body = json.loads(send_mock.call_args.kwargs["MessageBody"])
        assert message_body["workflow"] == "custom-workflow"

    def test_send_to_sqs_omits_workflow_when_not_configured(self, orchestrator):
        """Test workflow is omitted when no custom workflow is configured."""
        orchestrator.config.workflow = ""
        mock_response = {"MessageId": "msg_123"}

        with patch.object(orchestrator.sqs_client, "send_message", return_value=mock_response) as send_mock:
            orchestrator._send_to_sqs(
                package_name="benchling/EXP0001",
                payload=self._payload_with(),
            )

        message_body = json.loads(send_mock.call_args.kwargs["MessageBody"])
        assert "workflow" not in message_body

    # Episode 7: Canvas tests removed - now handled by CanvasManager class

    # Episode 8: Main execution tests
    def test_execute_workflow_success(self, orchestrator, mock_benchling):
        """Test complete workflow execution."""
        # Mock SDK calls
        mock_entry = Mock()
        mock_entry.to_dict.return_value = {
            "id": "etr_123",
            "display_id": "EXP0001",
            "fields": [],
        }
        mock_benchling.entries.get_entry_by_id.return_value = mock_entry

        mock_export_result = Mock()
        mock_export_result.task_id = "task_123"
        mock_benchling.exports.export.return_value = mock_export_result

        mock_task = Mock()
        mock_task.id = "task_123"
        mock_task.status = Mock()
        mock_task.status.value = "SUCCEEDED"
        mock_task.response = Mock()
        mock_task.response.get = Mock(return_value="https://example.com/export.zip")
        mock_benchling.tasks.get_by_id.return_value = mock_task

        # Mock _process_export (inline processing)
        mock_process_result = {
            "statusCode": 200,
            "package_name": "benchling/EXP0001",  # Now uses display_id
            "files_uploaded": [],
            "total_files": 5,
        }
        mock_sqs_response = {"MessageId": "msg_123"}

        with (
            patch.object(orchestrator, "_process_export", return_value=mock_process_result),
            patch.object(orchestrator.sqs_client, "send_message", return_value=mock_sqs_response),
            patch.object(orchestrator, "_is_sealed", return_value=False),
        ):
            payload = Payload(
                {
                    "message": {
                        "id": "evt_456",
                        "resourceId": "etr_123",
                        "timestamp": "2025-10-02T10:00:00Z",
                    },
                    "baseURL": "https://demo.benchling.com",
                }
            )

            result = orchestrator.execute_workflow(payload)

            # Verify result structure
            assert result["status"] == "SUCCESS"
            assert result["packageName"] == "benchling/EXP0001"  # Now uses display_id

    def test_execute_workflow_rejected_by_workflow_is_not_queued(self, orchestrator, mock_benchling):
        """A package the bucket's workflow would reject is recorded, not sent to the packager."""
        mock_entry = Mock()
        mock_entry.to_dict.return_value = {"id": "etr_123", "display_id": "EXP0001", "fields": []}
        mock_benchling.entries.get_entry_by_id.return_value = mock_entry
        mock_benchling.exports.export.return_value = Mock(task_id="task_123")
        mock_task = Mock(id="task_123")
        mock_task.status.value = "SUCCEEDED"
        mock_task.response.get = Mock(return_value="https://example.com/export.zip")
        mock_benchling.tasks.get_by_id.return_value = mock_task
        s3_client = orchestrator.role_manager.get_s3_client()
        s3_client.get_object.return_value = {"Body": io.BytesIO(b'{"display_id": "EXP0001"}')}
        orchestrator._is_sealed = Mock(return_value=False)

        with (
            patch.object(orchestrator, "_process_export", return_value={"files_uploaded": []}),
            patch.object(orchestrator.sqs_client, "send_message") as send,
            patch("src.entry_packager.check_workflow", return_value="Metadata failed validation") as check,
        ):
            payload = Payload({"message": {"id": "evt_456", "resourceId": "etr_123"}})
            result = orchestrator.execute_workflow(payload)

        assert result["status"] == "REJECTED"
        assert result["message"] == "Metadata failed validation"
        send.assert_not_called()
        assert check.call_args.args[5] == {"display_id": "EXP0001"}
        status = json.loads(s3_client.put_object.call_args.kwargs["Body"])
        assert s3_client.put_object.call_args.kwargs["Key"] == "benchling/EXP0001.packaging_status.json"
        assert status["state"] == "rejected"

    def test_execute_workflow_failure_marks_failed(self, orchestrator, mock_benchling):
        """Test failed execution raises exception."""
        # Mock entry fetch to fail
        mock_benchling.entries.get_entry_by_id.side_effect = Exception("API error")

        payload = Payload(
            {
                "message": {
                    "id": "evt_456",
                    "resourceId": "etr_123",
                    "timestamp": "2025-10-02T10:00:00Z",
                },
                "baseURL": "https://demo.benchling.com",
            }
        )

        with pytest.raises(BenchlingAPIError):
            orchestrator.execute_workflow(payload)

    def test_create_metadata_files_dict_format(self, orchestrator):
        """Test that files metadata is a dictionary with filename as key."""
        uploaded_files = [
            {"filename": "file1.txt", "s3_key": "benchling/EXP-001/file1.txt", "size": 100},
            {"filename": "file2.csv", "s3_key": "benchling/EXP-001/file2.csv", "size": 200},
            {"filename": "data.json", "s3_key": "benchling/EXP-001/data.json", "size": 300},
        ]

        entry_data = {
            "id": "etr_123",
            "display_id": "EXP-001",
            "name": "Test Entry",
            "web_url": "https://demo.benchling.com/entry/etr_123",
            "creator": {"name": "John Doe", "handle": "jdoe", "id": "user_123"},
            "authors": [{"name": "Jane Smith", "handle": "jsmith", "id": "user_456"}],
            "created_at": "2025-10-01T10:00:00Z",
            "modified_at": "2025-10-02T10:00:00Z",
        }

        result = orchestrator._create_metadata_files(
            package_name="benchling/EXP-001",  # Now uses display_id
            entry_id="etr_123",
            timestamp="2025-10-02T10:00:00Z",
            base_url="https://demo.benchling.com",
            webhook_data={},
            uploaded_files=uploaded_files,
            download_url="https://example.com/export.zip",
            entry_data=entry_data,
        )

        # Verify entry.json has files as dictionary
        entry_json = result["entry.json"]
        assert isinstance(entry_json["files"], dict)
        assert "file1.txt" in entry_json["files"]
        assert "file2.csv" in entry_json["files"]
        assert "data.json" in entry_json["files"]

        # Verify dictionary values contain file metadata (without redundant filename)
        assert entry_json["files"]["file1.txt"]["s3_key"] == "benchling/EXP-001/file1.txt"  # Now uses display_id
        assert entry_json["files"]["file1.txt"]["size"] == 100
        assert entry_json["files"]["file2.csv"]["size"] == 200
        assert entry_json["files"]["data.json"]["size"] == 300

        # Verify filename is NOT redundantly stored in the metadata (it's already the key)
        assert "filename" not in entry_json["files"]["file1.txt"]
        assert "filename" not in entry_json["files"]["file2.csv"]
        assert "filename" not in entry_json["files"]["data.json"]

    def test_create_metadata_files_includes_links_json(self, orchestrator):
        """links.json captures raw discovery; entry.json.links is the searchable view."""
        entry_data = {
            "id": "etr_123",
            "display_id": "EXP-001",
            "name": "Test Entry",
            "web_url": "https://demo.benchling.com/entry/etr_123",
            "created_at": "2025-10-01T10:00:00Z",
            "modified_at": "2025-10-02T10:00:00Z",
            "days": [
                {
                    "notes": [
                        {
                            "type": "text",
                            "links": [
                                {
                                    "id": "bfi_1",
                                    "type": "custom_entity",
                                    "webURL": "https://demo.benchling.com/benchling/f/lib_1-reg/bfi-1-qb-2743-1/edit",
                                },
                                {"id": "axdash_1", "type": "sql_dashboard", "webURL": "u2"},
                            ],
                        }
                    ]
                }
            ],
        }

        result = orchestrator._create_metadata_files(
            package_name="benchling/EXP-001",
            entry_id="etr_123",
            timestamp="2025-10-02T10:00:00Z",
            base_url="https://demo.benchling.com",
            webhook_data={},
            uploaded_files=[],
            download_url="https://example.com/export.zip",
            entry_data=entry_data,
        )

        # Raw discovery file (no references.json anymore).
        assert "references.json" not in result
        links_file = result["links.json"]
        assert links_file["schema_version"] == 2
        assert [e["id"] for e in links_file["entities"]] == ["bfi_1"]  # dashboard filtered out
        assert {link["type"] for link in links_file["links"]} == {"custom_entity", "sql_dashboard"}
        assert all(set(link) == {"id", "type", "web_url"} for link in links_file["links"])

        # Searchable, curated view promoted into entry.json metadata.
        meta_links = result["entry.json"]["links"]
        assert all(set(link) == {"type", "id", "name", "slug"} for link in meta_links)
        by_id = {link["id"]: link for link in meta_links}
        # slug parsed from webURL; name left None (mock client returns no real name).
        assert by_id["bfi_1"]["slug"] == "qb-2743-1"
        assert by_id["bfi_1"]["name"] is None

    def test_create_metadata_files_includes_normalized_fields(self, orchestrator):
        """entry.json carries the entry's fields and customFields under snake_case keys."""
        modified = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)
        entry_data = {
            "id": "etr_123",
            "display_id": "EXP-001",
            "name": "Test Entry",
            "web_url": "https://demo.benchling.com/entry/etr_123",
            "created_at": "2025-10-01T10:00:00Z",
            "modified_at": "2025-10-02T10:00:00Z",
            "fields": {
                "Project": {
                    "value": "VIR-0001",
                    "displayValue": "VIR-0001",
                    "type": "text",
                    "isMulti": False,
                    "textValue": "VIR-0001",
                },
                "Experiment Type": {
                    "value": "Assay",
                    "displayValue": "Assay",
                    "type": "dropdown",
                    "isMulti": False,
                    "textValue": "Assay",
                },
                "Run Date": {"value": modified, "type": "datetime"},
            },
            "customFields": {"Instrument": {"value": "HPLC-02"}, "ELN-ID #": {"value": "42"}},
        }

        result = orchestrator._create_metadata_files(
            package_name="benchling/EXP-001",
            entry_id="etr_123",
            timestamp="2025-10-02T10:00:00Z",
            base_url="https://demo.benchling.com",
            webhook_data={},
            uploaded_files=[],
            download_url="https://example.com/export.zip",
            entry_data=entry_data,
        )

        entry_json = result["entry.json"]
        assert entry_json["fields"]["project"] == {
            "name": "Project",
            "value": "VIR-0001",
            "displayValue": "VIR-0001",
            "type": "text",
            "isMulti": False,
            "textValue": "VIR-0001",
        }
        assert entry_json["fields"]["experiment_type"]["name"] == "Experiment Type"
        assert entry_json["fields"]["experiment_type"]["value"] == "Assay"
        assert entry_json["customFields"] == {
            "instrument": {"name": "Instrument", "value": "HPLC-02"},
            "eln_id": {"name": "ELN-ID #", "value": "42"},
        }
        # Serializes the way process_export uploads it (dates via DateTimeEncoder).
        dumped = json.loads(json.dumps(entry_json, cls=DateTimeEncoder))
        assert dumped["fields"]["run_date"]["value"] == modified.isoformat()
        # entry_data.json keeps the raw, display-name-keyed maps.
        assert set(result["entry_data.json"]["fields"]) == {"Project", "Experiment Type", "Run Date"}
        assert "name" not in result["entry_data.json"]["customFields"]["Instrument"]

    def test_create_metadata_files_writes_empty_fields_when_absent(self, orchestrator):
        """entry.json always has fields and customFields, {} when the entry has none."""
        result = orchestrator._create_metadata_files(
            package_name="benchling/EXP-001",
            entry_id="etr_123",
            timestamp="2025-10-02T10:00:00Z",
            base_url="https://demo.benchling.com",
            webhook_data={},
            uploaded_files=[],
            download_url="https://example.com/export.zip",
            entry_data={
                "id": "etr_123",
                "display_id": "EXP-001",
                "name": "Test Entry",
                "web_url": "https://demo.benchling.com/entry/etr_123",
                "created_at": "2025-10-01T10:00:00Z",
                "modified_at": "2025-10-02T10:00:00Z",
            },
        )

        assert result["entry.json"]["fields"] == {}
        assert result["entry.json"]["customFields"] == {}

    def test_create_metadata_files_includes_canvas_id_when_present(self, orchestrator):
        """Test entry.json stores canvas_id for canvas-initiated exports."""
        result = orchestrator._create_metadata_files(
            package_name="benchling/EXP-001",
            entry_id="etr_123",
            timestamp="2025-10-02T10:00:00Z",
            base_url="https://demo.benchling.com",
            webhook_data={},
            uploaded_files=[],
            download_url="https://example.com/export.zip",
            entry_data={
                "id": "etr_123",
                "display_id": "EXP-001",
                "name": "Test Entry",
                "web_url": "https://demo.benchling.com/entry/etr_123",
                "created_at": "2025-10-01T10:00:00Z",
                "modified_at": "2025-10-02T10:00:00Z",
            },
            canvas_id="canvas_123",
        )

        assert result["entry.json"]["canvas_id"] == "canvas_123"

    def test_create_metadata_files_omits_canvas_id_when_missing(self, orchestrator):
        """Test entry.json does not emit a null canvas_id field."""
        result = orchestrator._create_metadata_files(
            package_name="benchling/EXP-001",
            entry_id="etr_123",
            timestamp="2025-10-02T10:00:00Z",
            base_url="https://demo.benchling.com",
            webhook_data={},
            uploaded_files=[],
            download_url="https://example.com/export.zip",
            entry_data={
                "id": "etr_123",
                "display_id": "EXP-001",
                "name": "Test Entry",
                "web_url": "https://demo.benchling.com/entry/etr_123",
                "created_at": "2025-10-01T10:00:00Z",
                "modified_at": "2025-10-02T10:00:00Z",
            },
        )

        assert "canvas_id" not in result["entry.json"]

    def test_process_export_preserves_existing_canvas_id(self, orchestrator, mock_benchling):
        """Test entry events preserve a previously stored canvas_id from entry.json."""
        mock_entry = Mock()
        mock_entry.to_dict.return_value = {
            "id": "etr_123",
            "display_id": "EXP0001",
            "name": "Test Entry",
            "web_url": "https://demo.benchling.com/entry/etr_123",
            "created_at": "2025-10-01T10:00:00Z",
            "modified_at": "2025-10-02T10:00:00Z",
            "fields": [],
        }
        mock_benchling.entries.get_entry_by_id.return_value = mock_entry

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as archive:
            archive.writestr("export.csv", "hello")
        zip_buffer.seek(0)

        mock_response = Mock()
        mock_response.iter_content.return_value = [zip_buffer.getvalue()]
        mock_response.raise_for_status.return_value = None

        s3_client = Mock()

        # Entry events read canvas_id from any existing entry.json. FIFO
        # sequencing on entry_id guarantees the prior canvas-event write is
        # visible before this entry-event workflow runs.
        def mock_get_object(**kwargs):
            key = kwargs.get("Key", "")
            if key.endswith("/entry.json"):
                return {"Body": io.BytesIO(json.dumps({"canvas_id": "canvas_preserved"}).encode("utf-8"))}
            raise s3_client.exceptions.NoSuchKey({"Error": {"Code": "NoSuchKey"}}, "GetObject")

        s3_client.get_object.side_effect = mock_get_object

        payload = Payload(
            {
                "message": {
                    "resourceId": "etr_123",
                    "timestamp": "2025-10-02T10:00:00Z",
                    "type": "v2.entry.updated.fields",
                },
                "baseURL": "https://demo.benchling.com",
            }
        )

        original_process = orchestrator._process_export.__wrapped__
        with (
            patch("src.entry_packager.requests.get", return_value=mock_response),
            patch.object(orchestrator.role_manager, "get_s3_client", return_value=s3_client),
        ):
            result = original_process(
                orchestrator,
                payload=payload,
                download_url="https://example.com/export.zip",
                package_name="benchling/EXP0001",
            )

        assert result["statusCode"] == 200
        written_entry_json = None
        for call in s3_client.put_object.call_args_list:
            if call.kwargs["Key"] == "benchling/EXP0001/entry.json":
                written_entry_json = json.loads(call.kwargs["Body"].decode("utf-8"))
                break

        assert written_entry_json is not None
        assert written_entry_json["canvas_id"] == "canvas_preserved"

    def test_execute_workflow_fills_prefix_placeholder(self, orchestrator, mock_benchling, mock_config):
        """Test a pkg_prefix placeholder names the package from the fetched entry."""
        mock_config.s3_prefix = "{creator.handle}"
        mock_benchling.entries.get_entry_by_id.return_value.to_dict.return_value = {
            "id": "etr_123",
            "display_id": "EXP0001",
            "creator": {"handle": "jdoe", "name": "J Doe", "id": "ent_1"},
        }
        orchestrator._initiate_export = Mock(return_value={"id": "task_1"})
        orchestrator._poll_export_status = Mock(return_value={"downloadURL": "https://example.com/export.zip"})
        orchestrator._process_export = Mock(return_value={})
        orchestrator._send_to_sqs = Mock(return_value={"MessageId": "msg_1"})
        orchestrator._redraw_canvas = Mock()
        orchestrator._is_sealed = Mock(return_value=False)

        result = orchestrator.execute_workflow(Payload({"message": {"resourceId": "etr_123"}}))

        assert result["packageName"] == "jdoe/EXP0001"
        orchestrator._is_sealed.assert_called_once_with("jdoe/EXP0001")
        assert orchestrator._process_export.call_args.args[2] == "jdoe/EXP0001"
        assert orchestrator._send_to_sqs.call_args.args[0] == "jdoe/EXP0001"

    def test_execute_workflow_fails_when_placeholder_has_no_value(self, orchestrator, mock_benchling, mock_config):
        """Test a missing placeholder value fails packaging before anything is exported."""
        mock_config.s3_prefix = "{creator.handle}"
        mock_benchling.entries.get_entry_by_id.return_value.to_dict.return_value = {
            "id": "etr_123",
            "display_id": "EXP0001",
        }
        orchestrator._initiate_export = Mock()

        orchestrator._redraw_canvas = Mock()
        payload = Payload({"message": {"resourceId": "etr_123", "canvasId": "cnvs_1"}})

        with pytest.raises(MissingPlaceholderError):
            orchestrator.execute_workflow(payload)

        orchestrator._initiate_export.assert_not_called()
        # Replaces the "Updating..." canvas with one that explains the failure.
        orchestrator._redraw_canvas.assert_called_once_with(payload, None)

    def test_redraw_canvas_without_package_name_uses_payload_canvas_only(self, orchestrator):
        """Without a package name there is no entry.json to read a canvas_id from."""
        with patch.object(orchestrator.role_manager, "get_s3_client") as get_s3_client:
            orchestrator._redraw_canvas(Payload({"message": {"resourceId": "etr_123"}}), None)

        get_s3_client.assert_not_called()

    def test_process_export_keeps_the_workflow_package_name(self, orchestrator, mock_benchling, mock_config):
        """Test uploads use the name execute_workflow resolved, even if the handle changed mid-export."""
        mock_config.s3_prefix = "{creator.handle}"
        mock_benchling.entries.get_entry_by_id.return_value.to_dict.return_value = {
            "id": "etr_123",
            "display_id": "EXP0001",
            "name": "Test Entry",
            "web_url": "https://demo.benchling.com/entry/etr_123",
            "created_at": "2025-10-01T10:00:00Z",
            "modified_at": "2025-10-02T10:00:00Z",
            # Renamed since execute_workflow resolved jdoe/EXP0001.
            "creator": {"handle": "jsmith", "name": "J Doe", "id": "ent_1"},
            "fields": [],
        }
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as archive:
            archive.writestr("export.csv", "hello")
        mock_response = Mock()
        mock_response.iter_content.return_value = [zip_buffer.getvalue()]
        s3_client = Mock()
        s3_client.get_object.side_effect = ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")

        payload = Payload({"message": {"resourceId": "etr_123", "canvasId": "cnvs_1"}})
        with (
            patch("src.entry_packager.requests.get", return_value=mock_response),
            patch.object(orchestrator.role_manager, "get_s3_client", return_value=s3_client),
        ):
            result = orchestrator._process_export.__wrapped__(
                orchestrator,
                payload=payload,
                download_url="https://example.com/export.zip",
                package_name="jdoe/EXP0001",
            )

        assert result["package_name"] == "jdoe/EXP0001"
        keys = {call.kwargs["Key"] for call in s3_client.put_object.call_args_list}
        assert {"jdoe/EXP0001/export.csv", "jdoe/EXP0001/entry.json"} <= keys


# Shape of the review-accepted webhook delivered for an entry in April 2026.
REVIEW_ACCEPTED_EVENT = {
    "baseURL": "https://example.benchling.com",
    "message": {
        "id": "evt_coYeepNKIpIi",
        "type": "v2.entry.updated.reviewRecord",
        "resourceId": "etr_cQjoaEdURo",
        "createdAt": "2026-04-16T00:28:41.650775+00:00",
        "updates": ["reviewRecord.status"],
        "deprecated": False,
        "schema": None,
    },
}


def _seal_puts(s3_client: Any) -> list:
    """Bodies written to the seal; the packaging status is written with put_object too."""
    return [
        c.kwargs["Body"]
        for c in s3_client.put_object.call_args_list
        if c.kwargs["Key"].endswith("/linked_packages.json")
    ]


def _workflow_packager(review_status) -> Any:
    config = Mock()
    config.s3_bucket_name = "test-bucket"
    config.s3_prefix = "benchling"
    config.quilt_catalog = "test.quiltdata.com"
    config.package_key = "experiment_id"
    config.aws_region = "us-east-1"
    config.quilt_write_role_arn = ""
    config.workflow = ""
    benchling = Mock()
    benchling.entries.get_entry_by_id.return_value.to_dict.return_value = {
        "id": "etr_cQjoaEdURo",
        "display_id": "EXP26000008",
        "reviewRecord": {"comment": "", "status": review_status},
    }
    packager = EntryPackager(benchling=benchling, config=config)
    packager._initiate_export = Mock(return_value={"id": "task_1"})
    packager._poll_export_status = Mock(return_value={"downloadURL": "https://example.com/export.zip"})
    packager._process_export = Mock(return_value={})
    packager._send_to_sqs = Mock(return_value={"MessageId": "msg_1"})
    packager._redraw_canvas = Mock()
    packager._is_sealed = Mock(return_value=True)
    return packager


def _s3_without_seal() -> Mock:
    s3_client = Mock()
    s3_client.get_object.side_effect = ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
    return s3_client


def _s3_with_seal(event_id: str) -> Mock:
    seal = json.dumps({"event_id": event_id}).encode()

    def get_object(Bucket: str, Key: str, **_: Any) -> dict:
        if Key.endswith("/linked_packages.json"):
            return {"Body": io.BytesIO(seal)}
        raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")

    s3_client = Mock()
    s3_client.get_object.side_effect = get_object
    return s3_client


@patch("src.entry_packager.PackageQuery")
def test_review_accepted_seals_linked_packages(mock_query_class):
    packager = _workflow_packager("ACCEPTED")
    linked = Package("test.quiltdata.com", "lab-bucket", "lab/data", top_hash="abc123")
    primary = Package("test.quiltdata.com", "test-bucket", "benchling/EXP26000008", top_hash="b07c91cf")
    mock_query_class.return_value.find_unique_packages.return_value = {"packages": [linked, primary]}
    s3_client = _s3_without_seal()

    with patch.object(packager.role_manager, "get_s3_client", return_value=s3_client):
        result = packager.execute_workflow(Payload(REVIEW_ACCEPTED_EVENT))

    assert result["status"] == "SUCCESS"
    packager._is_sealed.assert_not_called()  # an existing seal never blocks a reseal
    mock_query_class.return_value.find_unique_packages.assert_called_once_with(
        key="experiment_id", value="EXP26000008", array_key="eln_entry", pinned=True
    )
    put = next(
        c.kwargs for c in s3_client.put_object.call_args_list if c.kwargs["Key"].endswith("/linked_packages.json")
    )
    assert put["Key"] == "benchling/EXP26000008/linked_packages.json"
    assert json.loads(put["Body"]) == {
        "event_id": "evt_coYeepNKIpIi",
        "accepted_at": "2026-04-16T00:28:41.650775+00:00",
        "linked_packages": [
            {
                "bucket": "lab-bucket",
                "name": "lab/data",
                "top_hash": "abc123",
                "catalog_url": "https://test.quiltdata.com/b/lab-bucket/packages/lab/data/tree/abc123",
                "quilt_uri": "quilt+s3://lab-bucket#package=lab/data@abc123",
            }
        ],
    }
    packager._send_to_sqs.assert_called_once()


@patch("src.entry_packager.PackageQuery")
def test_review_accepted_pushes_unsealed_when_search_fails(mock_query_class):
    packager = _workflow_packager("ACCEPTED")
    mock_query_class.return_value.find_unique_packages.side_effect = RuntimeError("Athena down")
    s3_client = _s3_without_seal()

    with patch.object(packager.role_manager, "get_s3_client", return_value=s3_client):
        result = packager.execute_workflow(Payload(REVIEW_ACCEPTED_EVENT))

    assert result["status"] == "SUCCESS"
    assert not [c for c in s3_client.put_object.call_args_list if c.kwargs["Key"].endswith("/linked_packages.json")]
    s3_client.delete_object.assert_called_once_with(
        Bucket="test-bucket", Key="benchling/EXP26000008/linked_packages.json"
    )
    packager._send_to_sqs.assert_called_once()


@patch("src.entry_packager.PackageQuery")
def test_redelivered_acceptance_keeps_its_staged_seal(mock_query_class):
    packager = _workflow_packager("ACCEPTED")
    s3_client = _s3_with_seal("evt_coYeepNKIpIi")

    with patch.object(packager.role_manager, "get_s3_client", return_value=s3_client):
        result = packager.execute_workflow(Payload(REVIEW_ACCEPTED_EVENT))

    assert result["status"] == "SUCCESS"
    mock_query_class.return_value.find_unique_packages.assert_not_called()
    assert not _seal_puts(s3_client)
    s3_client.delete_object.assert_not_called()
    packager._send_to_sqs.assert_called_once()


@patch("src.entry_packager.PackageQuery")
def test_new_acceptance_reseals_over_an_earlier_seal(mock_query_class):
    packager = _workflow_packager("ACCEPTED")
    mock_query_class.return_value.find_unique_packages.return_value = {"packages": []}
    s3_client = _s3_with_seal("evt_earlier")

    with patch.object(packager.role_manager, "get_s3_client", return_value=s3_client):
        packager.execute_workflow(Payload(REVIEW_ACCEPTED_EVENT))

    assert json.loads(_seal_puts(s3_client)[-1])["event_id"] == "evt_coYeepNKIpIi"


@pytest.mark.parametrize(
    "event_type, review_status",
    [("v2.entry.updated.fields", "ACCEPTED"), ("v2.entry.updated.reviewRecord", "ACCEPTANCE_SNAPSHOT_IN_PROGRESS")],
)
def test_sealed_package_refuses_other_events_but_redraws(event_type, review_status):
    packager = _workflow_packager(review_status)
    event = json.loads(json.dumps(REVIEW_ACCEPTED_EVENT))
    event["message"]["type"] = event_type

    result = packager.execute_workflow(Payload(event))

    assert result["status"] == "SEALED"
    packager._initiate_export.assert_not_called()
    packager._send_to_sqs.assert_not_called()
    packager._redraw_canvas.assert_called_once()


@patch("src.entry_packager.check_workflow", return_value="Metadata failed validation")
def test_rejection_on_an_accepted_entry_records_accepted_whatever_the_event(_check):
    """A fields event on an accepted (locked) entry still can't offer Update Package."""
    packager = _workflow_packager("ACCEPTED")
    packager._is_sealed.return_value = False
    event = json.loads(json.dumps(REVIEW_ACCEPTED_EVENT))
    event["message"]["type"] = "v2.entry.updated.fields"
    s3_client = Mock()
    s3_client.get_object.return_value = {"Body": io.BytesIO(b"{}")}

    with patch.object(packager.role_manager, "get_s3_client", return_value=s3_client):
        result = packager.execute_workflow(Payload(event))

    assert result["status"] == "REJECTED"
    assert json.loads(s3_client.put_object.call_args.kwargs["Body"])["accepted"] is True
    assert _check.call_args.kwargs["adds"] == ()  # no seal is staged for a fields event


@patch("src.entry_packager.check_workflow", return_value="Metadata failed validation")
@patch("src.entry_packager.PackageQuery")
def test_rejected_acceptance_stages_no_seal(mock_query_class, _check):
    """The pre-check runs before staging a seal, so a rejection never strands or drops one."""
    packager = _workflow_packager("ACCEPTED")
    s3_client = Mock()
    s3_client.get_object.return_value = {"Body": io.BytesIO(b"{}")}

    with patch.object(packager.role_manager, "get_s3_client", return_value=s3_client):
        result = packager.execute_workflow(Payload(REVIEW_ACCEPTED_EVENT))

    assert result["status"] == "REJECTED"
    packager._send_to_sqs.assert_not_called()
    mock_query_class.return_value.find_unique_packages.assert_not_called()
    assert not _seal_puts(s3_client)
    s3_client.delete_object.assert_not_called()
    status = json.loads(s3_client.put_object.call_args.kwargs["Body"])
    assert status["state"] == "rejected" and status["accepted"] is True
    assert _check.call_args.kwargs["adds"] == ("linked_packages.json",)


@pytest.mark.parametrize("review_status", [None, "IN_PROGRESS", "NEEDS_REVIEW", "RETRACTED", "REJECTED"])
def test_reopened_review_unseals_and_pushes(review_status):
    packager = _workflow_packager(review_status)
    s3_client = Mock()

    with patch.object(packager.role_manager, "get_s3_client", return_value=s3_client):
        result = packager.execute_workflow(Payload(REVIEW_ACCEPTED_EVENT))

    assert result["status"] == "SUCCESS"
    s3_client.delete_object.assert_called_once_with(
        Bucket="test-bucket", Key="benchling/EXP26000008/linked_packages.json"
    )
    assert not _seal_puts(s3_client)
    packager._initiate_export.assert_called_once()
    packager._send_to_sqs.assert_called_once()


def test_reopened_review_of_unsealed_package_deletes_nothing():
    packager = _workflow_packager("IN_PROGRESS")
    packager._is_sealed.return_value = False
    s3_client = Mock()

    with patch.object(packager.role_manager, "get_s3_client", return_value=s3_client):
        result = packager.execute_workflow(Payload(REVIEW_ACCEPTED_EVENT))

    assert result["status"] == "SUCCESS"
    s3_client.delete_object.assert_not_called()
    packager._send_to_sqs.assert_called_once()


def test_is_sealed_reads_the_source_prefix():
    packager = _workflow_packager("ACCEPTED")
    s3_client = Mock()
    with patch.object(packager.role_manager, "get_s3_client", return_value=s3_client):
        assert EntryPackager._is_sealed(packager, "benchling/EXP1") is True
        s3_client.head_object.assert_called_once_with(Bucket="test-bucket", Key="benchling/EXP1/linked_packages.json")

        s3_client.head_object.side_effect = ClientError({"Error": {"Code": "404"}}, "HeadObject")
        assert EntryPackager._is_sealed(packager, "benchling/EXP1") is False

        s3_client.head_object.side_effect = ClientError({"Error": {"Code": "403"}}, "HeadObject")
        with pytest.raises(ClientError):
            EntryPackager._is_sealed(packager, "benchling/EXP1")
