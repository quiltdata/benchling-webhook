"""
Entry packager for Benchling entries.

Exports Benchling entries, packages them with metadata, uploads to S3,
and queues them for Quilt package creation via SQS.
"""

import io
import json
import threading
import time
import zipfile
from datetime import datetime
from typing import Any, Dict, Optional

import boto3
import requests
import structlog
from benchling_sdk.benchling import Benchling
from benchling_sdk.models import ExportItemRequest

from .auth import RoleManager
from .config import get_config
from .payload import Payload
from .retry_utils import LAMBDA_INVOKE_RETRY, REST_API_RETRY

logger = structlog.get_logger(__name__)


class DateTimeEncoder(json.JSONEncoder):
    """Custom JSON encoder that converts datetime objects to ISO format strings."""

    def default(self, o):
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


# Custom exception for backward compatibility
class BenchlingAPIError(Exception):
    """Base exception for Benchling API errors."""

    pass


class EntryValidationError(ValueError):
    """Exception raised when entry data validation fails."""

    pass


def validate_entry_data(entry_data: Dict[str, Any], entry_id: str) -> Dict[str, Any]:
    """
    Validate entry data has required fields.

    Args:
        entry_data: Entry data dictionary from Benchling API
        entry_id: Entry ID for error messages

    Returns:
        Dictionary with validated required fields:
        - display_id: Human-readable entry identifier
        - name: Entry name
        - web_url: Benchling web URL
        - created_at: Creation timestamp
        - modified_at: Last modification timestamp

    Raises:
        EntryValidationError: If required fields are missing
    """
    required_fields = ["display_id", "name", "web_url", "created_at", "modified_at"]
    missing_fields = [field for field in required_fields if field not in entry_data]

    if missing_fields:
        raise EntryValidationError(
            f"Missing required fields in entry_data: {', '.join(missing_fields)}. " f"Entry ID: {entry_id}"
        )

    return {
        "display_id": entry_data["display_id"],
        "name": entry_data["name"],
        "web_url": entry_data["web_url"],
        "created_at": entry_data["created_at"],
        "modified_at": entry_data["modified_at"],
    }


def format_user_info(user_data: Dict[str, Any]) -> str:
    """
    Format user information from Benchling API data.

    Args:
        user_data: User data dictionary with name, handle, id fields

    Returns:
        Formatted string like "John Doe <jdoe@user_123>" or empty string if invalid
    """
    if not isinstance(user_data, dict):
        return ""

    name = user_data.get("name", "")
    handle = user_data.get("handle", "")
    user_id = user_data.get("id", "")

    if name:
        return f"{name} <{handle}@{user_id}>"
    return ""


def parse_creator(entry_data: Dict[str, Any]) -> str:
    """
    Parse creator information from entry data.

    Args:
        entry_data: Entry data dictionary from Benchling API

    Returns:
        Formatted creator string or empty string if not available
    """
    creator = entry_data.get("creator", {})
    return format_user_info(creator)


def parse_authors(entry_data: Dict[str, Any]) -> list[str]:
    """
    Parse authors list from entry data.

    Args:
        entry_data: Entry data dictionary from Benchling API

    Returns:
        List of formatted author strings
    """
    authors = entry_data.get("authors", [])
    authors_list = []

    if isinstance(authors, list):
        for author in authors:
            if isinstance(author, dict):
                author_str = format_user_info(author)
                if author_str:
                    authors_list.append(author_str)

    return authors_list


class EntryPackager:
    """
    Package Benchling entries for Quilt.

    Exports entries, packages them with metadata, uploads to S3,
    and queues for Quilt package creation.
    """

    def __init__(
        self,
        benchling: Benchling,
        config: Optional[Any] = None,
    ):
        """
        Initialize entry packager.

        Args:
            benchling: Benchling SDK client
            config: Application configuration (optional)
        """
        self.benchling = benchling
        self.config = config or get_config()
        self.logger = structlog.get_logger(__name__)

        # AWS clients (Lambda removed - now inline processing)
        self.sqs_client = boto3.client("sqs", region_name=self.config.aws_region)

        # Initialize RoleManager for cross-account S3 access
        self.role_manager = RoleManager(
            role_arn=self.config.quilt_write_role_arn or None,
            region=self.config.aws_region,
        )

    @REST_API_RETRY
    def _fetch_entry_data(self, entry_id: str) -> Dict[str, Any]:
        """
        Fetch entry data with fields and metadata.

        The SDK's to_dict() method doesn't include all fields, so we need to
        extract them from the entry object attributes and merge them into the dict.

        Required fields extracted:
        - display_id: Human-readable entry identifier (e.g., EXP00001234)
        - web_url: Benchling web URL for viewing
        - created_at: Entry creation timestamp
        - modified_at: Last modification timestamp

        Args:
            entry_id: Entry ID to fetch

        Returns:
            Complete entry data dictionary with all required fields

        Raises:
            BenchlingAPIError: If API request fails after retries
        """
        self.logger.info("Fetching entry data", entry_id=entry_id)

        try:
            # Get entry object via SDK
            entry = self.benchling.entries.get_entry_by_id(entry_id)

            # Start with to_dict() as base
            entry_data = entry.to_dict()

            # Extract missing fields from entry object attributes
            # These fields exist on the SDK object but aren't in to_dict()
            missing_fields = {
                "display_id": getattr(entry, "display_id", None),
                "web_url": getattr(entry, "web_url", None),
                "created_at": getattr(entry, "created_at", None),
                "modified_at": getattr(entry, "modified_at", None),
            }

            # Merge missing fields into entry_data
            for field, value in missing_fields.items():
                if value is not None and field not in entry_data:
                    entry_data[field] = value

            self.logger.info(
                "Entry data fetched successfully",
                entry_id=entry_id,
                has_display_id=bool(entry_data.get("display_id")),
                has_web_url=bool(entry_data.get("web_url")),
                has_fields=len(entry_data.get("fields", [])) > 0,
            )

            return entry_data

        except Exception as e:
            self.logger.error("Failed to fetch entry data", entry_id=entry_id, error=str(e))
            raise BenchlingAPIError(f"Failed to fetch entry: {e}") from e

    @REST_API_RETRY
    def _initiate_export(self, entry_id: str) -> Dict[str, Any]:
        """
        Initiate entry export task.

        Args:
            entry_id: Entry ID to export

        Returns:
            Export task data with task ID

        Raises:
            BenchlingAPIError: If export initiation fails after retries
        """
        self.logger.info("Initiating export", entry_id=entry_id)

        try:
            # Use SDK to initiate export with proper ExportItemRequest
            export_request = ExportItemRequest(entry_id)
            task = self.benchling.exports.export(export_request)

            task_id = getattr(task, "task_id", None)
            if not task_id:
                raise BenchlingAPIError("Export initiated but task ID not found in response")

            self.logger.info("Export task initiated", task_id=task_id)

            return {"id": task_id}

        except Exception as e:
            self.logger.error("Failed to initiate export", entry_id=entry_id, error=str(e))
            raise BenchlingAPIError(f"Failed to initiate export: {e}") from e

    def _poll_export_status(
        self,
        task_id: str,
        max_attempts: int = 60,
        poll_interval: int = 30,
    ) -> Dict[str, Any]:
        """
        Poll export task status until completion.

        Matches Step Functions behavior:
        - Poll every 30 seconds
        - Max 60 attempts (30 minutes total)
        - Handle RUNNING, QUEUED, SUCCEEDED, FAILED states

        Args:
            task_id: Export task ID
            max_attempts: Maximum polling attempts (default: 60)
            poll_interval: Seconds between polls (default: 30)

        Returns:
            Final task status with downloadURL

        Raises:
            TimeoutError: If export doesn't complete within max_attempts
            BenchlingAPIError: If export fails or status check fails
        """
        self.logger.info(
            "Starting export status polling",
            task_id=task_id,
            max_attempts=max_attempts,
            poll_interval=poll_interval,
        )

        for attempt in range(1, max_attempts + 1):
            try:
                status_data = self._check_export_status(task_id)
                status = status_data.get("status")

                self.logger.info(
                    "Export status check",
                    task_id=task_id,
                    attempt=attempt,
                    status=status,
                )

                if status == "SUCCEEDED":
                    download_url = status_data.get("downloadURL")
                    if not download_url:
                        raise BenchlingAPIError("Export succeeded but no downloadURL")

                    self.logger.info(
                        "Export completed successfully",
                        task_id=task_id,
                        attempts=attempt,
                    )
                    return status_data

                elif status == "FAILED":
                    error_msg = status_data.get("message", "Export failed")
                    self.logger.error("Export task failed", task_id=task_id, error=error_msg)
                    raise BenchlingAPIError(f"Export failed: {error_msg}")

                elif status in ["RUNNING", "QUEUED"]:
                    # Wait before next poll
                    if attempt < max_attempts:
                        self.logger.debug(
                            "Export still processing, waiting",
                            task_id=task_id,
                            status=status,
                            wait_seconds=poll_interval,
                        )
                        time.sleep(poll_interval)
                    continue

                else:
                    # Unknown status
                    self.logger.warning("Unknown export status", task_id=task_id, status=status)
                    raise BenchlingAPIError(f"Unknown export status: {status}")

            except BenchlingAPIError:
                # Re-raise API errors (already logged)
                raise
            except Exception as e:
                # Log unexpected errors
                self.logger.error(
                    "Unexpected error during export polling",
                    task_id=task_id,
                    attempt=attempt,
                    error=str(e),
                )
                if attempt == max_attempts:
                    raise
                time.sleep(poll_interval)

        # Max attempts reached
        raise TimeoutError(f"Export did not complete within {max_attempts * poll_interval} seconds")

    @REST_API_RETRY
    def _check_export_status(self, task_id: str) -> Dict[str, Any]:
        """
        Check export task status (with retry).

        Args:
            task_id: Export task ID

        Returns:
            Task status data

        Raises:
            BenchlingAPIError: If status check fails after retries
        """
        try:
            task = self.benchling.tasks.get_by_id(task_id)

            # Extract status
            status = getattr(task.status, "value", str(task.status)) if hasattr(task, "status") else "UNKNOWN"

            result = {"id": getattr(task, "id", task_id), "status": status}

            # Add download URL only if task succeeded
            # The response field is Unset until the task completes successfully
            if status == "SUCCEEDED":
                try:
                    response = task.response
                    # If we get here, response is set (not Unset)
                    # AsyncTaskResponse stores data in additional_properties dict
                    if response:
                        # Try dict-like access first (works for AsyncTaskResponse)
                        download_url = response.get("downloadURL")
                        if download_url:
                            result["downloadURL"] = download_url
                        else:
                            # Log for debugging
                            self.logger.warning(
                                "Task succeeded but no downloadURL in response",
                                task_id=task_id,
                                response_keys=(
                                    list(response.additional_properties.keys())
                                    if hasattr(response, "additional_properties")
                                    else "N/A"
                                ),
                            )
                except Exception as e:
                    # response is Unset or inaccessible - this shouldn't happen for SUCCEEDED tasks
                    self.logger.warning("Task succeeded but response is unavailable", task_id=task_id, error=str(e))

            return result
        except Exception as e:
            raise BenchlingAPIError(f"Failed to get task status: {e}") from e

    @LAMBDA_INVOKE_RETRY
    def _process_export(
        self,
        payload: Payload,
        download_url: str,
    ) -> Dict[str, Any]:
        """
        Process export files inline (download ZIP, extract, upload to S3).

        Args:
            payload: Parsed webhook payload
            download_url: Export download URL from task status

        Returns:
            Processing result with uploaded files

        Raises:
            Exception: If processing fails after retries
        """
        entry_id = payload.entry_id

        # Fetch entry data first to get display_id
        entry_data = self._fetch_entry_data(entry_id)
        display_id = entry_data.get("display_id", entry_id)

        # Set display_id on payload for package naming
        payload.set_display_id(display_id)
        package_name = payload.package_name(self.config.s3_prefix, use_display_id=True)

        self.logger.info(
            "Processing export inline", entry_id=entry_id, display_id=display_id, package_name=package_name
        )

        try:
            # Download the ZIP file
            self.logger.info("Downloading export ZIP", download_url=download_url)
            response = requests.get(download_url, stream=True, timeout=300)
            response.raise_for_status()

            # Stream ZIP content directly into memory buffer
            zip_buffer = io.BytesIO()
            for chunk in response.iter_content(chunk_size=8192):
                zip_buffer.write(chunk)
            zip_buffer.seek(0)  # Reset to beginning for reading

            # Initialize S3 client with role assumption
            s3_client = self.role_manager.get_s3_client()
            uploaded_files = []

            # Extract and upload files from ZIP
            self.logger.info("Extracting and uploading files from in-memory ZIP buffer")
            with zipfile.ZipFile(zip_buffer, "r") as zip_ref:
                for file_info in zip_ref.filelist:
                    if file_info.is_dir():
                        continue

                    # Extract file content
                    file_content = zip_ref.read(file_info.filename)

                    # Upload to S3
                    s3_key = f"{package_name}/{file_info.filename}"
                    s3_client.put_object(Bucket=self.config.s3_bucket_name, Key=s3_key, Body=file_content)

                    uploaded_files.append(
                        {
                            "filename": file_info.filename,
                            "s3_key": s3_key,
                            "size": len(file_content),
                        }
                    )

            # Create metadata files (entry_data already fetched above)
            metadata_files = self._create_metadata_files(
                package_name=package_name,
                entry_id=entry_id,
                timestamp=payload.timestamp or "",
                base_url=payload.base_url
                or getattr(self.benchling, "url", getattr(self.benchling, "base_url", "https://benchling.com")),
                webhook_data=payload.webhook_data,
                uploaded_files=uploaded_files,
                download_url=download_url,
                entry_data=entry_data,
            )

            # Upload metadata files
            for filename, content in metadata_files.items():
                s3_key = f"{package_name}/{filename}"
                body = (
                    content.encode("utf-8")
                    if isinstance(content, str)
                    else json.dumps(content, indent=2, cls=DateTimeEncoder).encode("utf-8")
                )
                s3_client.put_object(Bucket=self.config.s3_bucket_name, Key=s3_key, Body=body)
                uploaded_files.append(
                    {
                        "filename": filename,
                        "s3_key": s3_key,
                        "size": len(body),
                    }
                )

            self.logger.info(
                "Export processed successfully",
                entry_id=entry_id,
                package_name=package_name,
                files_uploaded=len(uploaded_files),
            )

            return {
                "statusCode": 200,
                "package_name": package_name,
                "files_uploaded": uploaded_files,
                "total_files": len(uploaded_files),
            }

        except Exception as e:
            self.logger.error("Failed to process export", entry_id=entry_id, error=str(e))
            raise

    def _create_metadata_files(
        self,
        package_name: str,
        entry_id: str,
        timestamp: str,
        base_url: str,
        webhook_data: Dict,
        uploaded_files: list,
        download_url: str,
        entry_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Create standardized metadata files.

        Args:
            package_name: Quilt package name
            entry_id: Benchling entry ID
            timestamp: Export timestamp
            base_url: Benchling base URL
            webhook_data: Original webhook payload
            uploaded_files: List of uploaded file info
            download_url: Export download URL
            entry_data: Complete entry data from Benchling API (includes display_id, name, etc.)
        """
        # Validate entry data and extract required fields
        validated_fields = validate_entry_data(entry_data, entry_id)
        display_id = validated_fields["display_id"]
        name = validated_fields["name"]
        web_url = validated_fields["web_url"]
        created_at = validated_fields["created_at"]
        modified_at = validated_fields["modified_at"]

        # Parse creator and authors using helper functions
        creator_str = parse_creator(entry_data)
        authors_list = parse_authors(entry_data)

        # entry.json - Benchling entry metadata with key fields extracted
        # Convert datetime objects to ISO format strings for JSON serialization
        created_at_str = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
        modified_at_str = modified_at.isoformat() if hasattr(modified_at, "isoformat") else str(modified_at)

        # Convert files list to dictionary with filename as key
        # Exclude redundant filename from value since it's already the key
        files_dict = {
            file_info["filename"]: {k: v for k, v in file_info.items() if k != "filename"}
            for file_info in uploaded_files
        }

        entry_json = {
            "package_name": package_name,
            "entry_id": entry_id,
            "display_id": display_id,
            "name": name,
            "web_url": web_url,
            "creator": creator_str,
            "authors": authors_list,
            "created_at": created_at_str,
            "modified_at": modified_at_str,
            "export_timestamp": timestamp,
            "benchling_base_url": base_url,
            "webhook_data": webhook_data,
            "files": files_dict,
        }

        # input.json - Processing metadata
        input_json = {
            "source": "benchling_webhook",
            "export_url": download_url,
            "processing_timestamp": timestamp,
            "package_metadata": {
                "name": package_name,
                "registry": self.config.s3_bucket_name,
                "total_files": len(uploaded_files),
            },
        }

        # README.md - Human-readable documentation
        # Build title with DisplayID first, followed by name
        if name:
            title = f"# {display_id} - {name}"
        else:
            title = f"# {display_id}"

        readme_content = f"""{title}

## Overview
This package contains data exported from Benchling entry `{display_id}`.
"""

        if web_url:
            readme_content += f"\n**View in Benchling**: {web_url}\n"

        readme_content += f"""
## Entry Information
- **Display ID**: {display_id}
- **Entry ID**: {entry_id}"""

        if name:
            readme_content += f"\n- **Name**: {name}"
        if creator_str:
            readme_content += f"\n- **Creator**: {creator_str}"
        if authors_list:
            readme_content += f"\n- **Authors**: {', '.join(authors_list)}"
        if created_at:
            readme_content += f"\n- **Created**: {created_at_str}"
        if modified_at:
            readme_content += f"\n- **Modified**: {modified_at_str}"

        readme_content += f"""

## Export Information
- **Export Timestamp**: {timestamp}
- **Benchling Base URL**: {base_url}
- **Total Files**: {len(uploaded_files)}

## Files Included
"""

        for file_info in uploaded_files:
            if file_info["filename"] not in ["entry.json", "entry_data.json", "input.json", "README.md"]:
                readme_content += f"- `{file_info['filename']}` ({file_info['size']} bytes)\n"

        readme_content += """
## Metadata Files
- `entry.json`: Key entry metadata (display_id, name, creator, authors, timestamps)
- `entry_data.json`: Complete entry data from Benchling API
- `input.json`: Export processing metadata
- `README.md`: This documentation file

## Usage
This package was created automatically by the Benchling-Quilt integration webhook system.
For questions about the data, refer to the original Benchling entry.
"""

        return {
            "entry.json": entry_json,
            "entry_data.json": entry_data,
            "input.json": input_json,
            "README.md": readme_content,
        }

    @REST_API_RETRY
    def _send_to_sqs(self, package_name: str, timestamp: str) -> Dict[str, Any]:
        """
        Send package creation message to Quilt SQS queue.

        Args:
            package_name: Quilt package name
            timestamp: Event timestamp for commit message

        Returns:
            SQS response with MessageId

        Raises:
            Exception: If SQS send fails after retries
        """
        self.logger.info("Sending message to Quilt queue", package_name=package_name)

        # Message body matching state-machine.json format
        message_body = {
            "source_prefix": f"s3://{self.config.s3_bucket_name}/{package_name}/",
            "registry": self.config.s3_bucket_name,
            "package_name": package_name,
            "metadata_uri": "entry.json",
            "commit_message": f"Benchling webhook payload - {timestamp}",
        }

        try:
            queue_url = self.config.queue_url
            if not queue_url:
                raise ValueError("Missing SQS queue URL in configuration")

            response = self.sqs_client.send_message(QueueUrl=queue_url, MessageBody=json.dumps(message_body))

            message_id = response.get("MessageId")

            self.logger.info(
                "Message sent to Quilt queue",
                package_name=package_name,
                message_id=message_id,
            )

            return response

        except Exception as e:
            self.logger.error("Failed to send message to SQS", package_name=package_name, error=str(e))
            raise

    def execute_workflow(self, payload: Payload) -> Dict[str, Any]:
        """
        Execute complete workflow for Benchling entry processing.

        This method orchestrates all workflow steps in sequence.

        Args:
            payload: Parsed webhook payload

        Returns:
            Workflow result with package information

        Raises:
            Exception: If any critical step fails (non-canvas steps)
        """
        entry_id = payload.entry_id

        self.logger.info(
            "Starting workflow execution",
            entry_id=entry_id,
        )

        try:
            # Step 1: Fetch entry data and set display_id
            entry_data = self._fetch_entry_data(entry_id)
            display_id = entry_data.get("display_id", entry_id)
            payload.set_display_id(display_id)
            self.logger.debug(
                "Entry data fetched",
                entry_id=entry_data.get("id"),
                display_id=display_id,
                entry_name=entry_data.get("name"),
            )

            # Step 2: Initiate export
            export_task = self._initiate_export(entry_id)
            task_id = export_task["id"]
            self.logger.debug(
                "Export initiated",
                entry_id=entry_id,
                task_id=task_id,
            )

            # Step 3: Poll export status
            export_status = self._poll_export_status(task_id)
            download_url = export_status["downloadURL"]
            self.logger.debug(
                "Export completed",
                task_id=task_id,
                download_url=download_url[:100] if download_url else None,
            )

            # Step 4: Process export
            process_result = self._process_export(
                payload,
                download_url,
            )
            package_name = payload.package_name(self.config.s3_prefix, use_display_id=True)
            self.logger.debug(
                "Export processed",
                entry_id=entry_id,
                package_name=package_name,
                files_count=len(process_result.get("uploaded_files", [])),
            )

            # Step 5: Send to Quilt queue
            sqs_result = self._send_to_sqs(package_name, payload.timestamp or "")
            self.logger.debug(
                "SQS message sent",
                message_id=sqs_result.get("MessageId"),
            )

            result = {
                "status": "SUCCESS",
                "packageName": package_name,
                "entryId": entry_id,
                "message": "Entry processing completed successfully",
            }

            self.logger.info(
                "Workflow completed successfully",
                entry_id=entry_id,
                package_name=package_name,
            )

            return result

        except Exception as e:
            error_message = str(e)
            error_cause = e.__class__.__name__

            self.logger.error(
                "Workflow failed",
                entry_id=entry_id,
                error=error_message,
                error_type=error_cause,
            )

            raise

    def execute_workflow_async(self, payload: Payload) -> str:
        """
        Execute workflow asynchronously in background thread.

        This prevents blocking the webhook response while workflow executes.

        Args:
            payload: Parsed webhook payload

        Returns:
            Task identifier (entry_id) for reference
        """
        entry_id = payload.entry_id
        # Note: display_id will be fetched and set during workflow execution
        # Use entry_id for initial logging, display_id-based package name will be used later
        package_name_preview = payload.package_name(self.config.s3_prefix, use_display_id=False)

        self.logger.info(
            "Package entries workflow scheduled",
            entry_id=entry_id,
            event_id=payload.event_id,
            event_type=payload.event_type,
            package_name_preview=package_name_preview,
        )

        # Execute workflow in background thread
        def background_execution():
            try:
                self.logger.info(
                    "Background workflow execution started",
                    entry_id=entry_id,
                    event_type=payload.event_type,
                )

                # Execute all workflow steps
                result = self.execute_workflow(payload)

                self.logger.info(
                    "Background workflow execution completed successfully",
                    entry_id=entry_id,
                    package_name=result.get("packageName"),
                    result_status=result.get("status"),
                )

            except Exception as e:
                error_message = str(e)
                error_cause = e.__class__.__name__

                self.logger.error(
                    "Background workflow execution failed",
                    entry_id=entry_id,
                    error=error_message,
                    error_type=error_cause,
                    exc_info=True,
                )

        thread = threading.Thread(target=background_execution, daemon=True)
        thread.start()

        self.logger.debug(
            "Background workflow thread started",
            entry_id=entry_id,
            thread_name=thread.name,
            thread_id=thread.ident,
        )

        return entry_id
