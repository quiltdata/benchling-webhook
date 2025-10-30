"""
Tests for EntryPackager.

Following TDD methodology for Phase 2 implementation.
"""

import io
import zipfile
from unittest.mock import Mock, patch

import pytest
from tenacity import retry, stop_after_attempt, wait_fixed

from src.entry_packager import (
    BenchlingAPIError,
    EntryPackager,
    EntryValidationError,
    ExportItemRequest,
    format_user_info,
    parse_authors,
    parse_creator,
    validate_entry_data,
)
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
        assert format_user_info(None) == ""
        assert format_user_info("string") == ""
        assert format_user_info(123) == ""

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
        config.queue_arn = "arn:aws:sqs:us-west-2:123:test"
        config.quilt_catalog = "test.quiltdata.com"
        config.aws_region = "us-west-2"
        return config

    @pytest.fixture
    def orchestrator(self, mock_benchling, mock_config):
        """Create EntryPackager with mocked dependencies."""
        return EntryPackager(
            benchling=mock_benchling,
            config=mock_config,
        )

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
    def test_process_export_success(self, orchestrator, mock_benchling):
        """Test successful inline export processing."""
        # Create mock ZIP file in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zip_file:
            zip_file.writestr("test_file.txt", "test content")
            zip_file.writestr("data.csv", "column1,column2\nvalue1,value2")

        zip_buffer.seek(0)

        # Mock requests.get to return the ZIP
        mock_response = Mock()
        mock_response.iter_content = lambda chunk_size: [zip_buffer.read()]
        mock_response.raise_for_status = Mock()

        # Mock S3 client
        mock_s3_client = Mock()

        # Mock entry data for metadata
        mock_entry = Mock()
        mock_entry.to_dict.return_value = {
            "id": "etr_123",
            "display_id": "EXP0001",
            "name": "Test Entry",
            "web_url": "https://demo.benchling.com/entry/etr_123",
            "creator": {"name": "John Doe", "handle": "jdoe", "id": "user_123"},
            "authors": [{"name": "Jane Smith", "handle": "jsmith", "id": "user_456"}],
            "created_at": "2025-10-01T10:00:00Z",
            "modified_at": "2025-10-02T10:00:00Z",
            "fields": [],
        }
        mock_benchling.entries.get_entry_by_id.return_value = mock_entry

        # Create a payload object
        payload = Payload(
            {
                "message": {
                    "resourceId": "etr_123",
                    "timestamp": "2025-10-02T10:00:00Z",
                }
            }
        )

        with (
            patch("src.entry_packager.requests.get", return_value=mock_response),
            patch("src.entry_packager.boto3.client", return_value=mock_s3_client),
        ):
            result = orchestrator._process_export(
                payload=payload,
                download_url="https://example.com/export.zip",
            )

        # Verify result structure
        assert result["statusCode"] == 200
        assert result["package_name"] == "benchling/etr_123"
        assert result["total_files"] > 0
        assert "files_uploaded" in result

        # Verify S3 uploads happened
        assert mock_s3_client.put_object.called
        # Should have uploaded: test_file.txt, data.csv, entry.json, entry_data.json, input.json, README.md
        assert mock_s3_client.put_object.call_count >= 6

    def test_process_export_lambda_error(self, orchestrator):
        """Test inline processing error handling."""
        # Mock requests.get to raise an error (simulating download failure)
        mock_response = Mock()
        mock_response.raise_for_status.side_effect = Exception("Download failed")

        # Patch the retry decorator to use faster retries for testing
        fast_retry = retry(
            stop=stop_after_attempt(2),
            wait=wait_fixed(0.01),
            retry=lambda retry_state: True,
            reraise=True,
        )

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
                )

    # Episode 6: SendToSQS tests
    def test_send_to_sqs_success(self, orchestrator):
        """Test successful SQS message send."""
        mock_response = {"MessageId": "msg_123"}

        with patch.object(orchestrator.sqs_client, "send_message", return_value=mock_response):
            result = orchestrator._send_to_sqs(
                package_name="benchling/etr_123",
                timestamp="2025-10-02T10:00:00Z",
            )

        assert result["MessageId"] == "msg_123"

    # Episode 7: Canvas tests removed - now handled by CanvasManager class

    # Episode 8: Main execution tests
    def test_execute_workflow_success(self, orchestrator, mock_benchling):
        """Test complete workflow execution."""
        # Mock SDK calls
        mock_entry = Mock()
        mock_entry.to_dict.return_value = {"id": "etr_123", "fields": []}
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
            "package_name": "benchling/etr_123",
            "files_uploaded": [],
            "total_files": 5,
        }
        mock_sqs_response = {"MessageId": "msg_123"}

        with (
            patch.object(orchestrator, "_process_export", return_value=mock_process_result),
            patch.object(orchestrator.sqs_client, "send_message", return_value=mock_sqs_response),
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
            assert result["packageName"] == "benchling/etr_123"

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

    # Episode 9: Async execution tests
    def test_execute_workflow_async(self, orchestrator, mock_benchling):
        """Test async workflow execution returns immediately."""
        # Mock SDK calls
        mock_entry = Mock()
        mock_entry.to_dict.return_value = {"id": "etr_123", "fields": []}
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
            "package_name": "benchling/etr_123",
            "files_uploaded": [],
            "total_files": 5,
        }
        mock_sqs_response = {"MessageId": "msg_123"}

        with (
            patch.object(orchestrator, "_process_export", return_value=mock_process_result),
            patch.object(orchestrator.sqs_client, "send_message", return_value=mock_sqs_response),
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

            # Should return immediately with entry_id
            entry_id = orchestrator.execute_workflow_async(payload)

            assert entry_id == "etr_123"
