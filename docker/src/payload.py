"""
Unified payload parsing for Benchling webhooks.

Handles parsing of webhook payloads for both entry packaging and canvas operations.
"""

import uuid
from typing import TYPE_CHECKING, Any, Dict, Optional

import structlog
from flask import Request

if TYPE_CHECKING:
    from benchling_sdk.benchling import Benchling

logger = structlog.get_logger(__name__)


class Payload:
    """Unified webhook payload parser for Benchling integration."""

    def __init__(
        self,
        payload: Dict[str, Any],
        benchling: Optional["Benchling"] = None,
        display_id: Optional[str] = None,
    ):
        """
        Initialize payload parser with raw payload dict.

        Args:
            payload: Raw webhook payload dict
            benchling: Optional Benchling client for fallback entry_id lookup
            display_id: Optional display_id for package naming (e.g., "PRT001")
        """
        logger.debug("Initializing Payload", payload_keys=list(payload.keys()))
        self._payload = payload
        self._message = self._payload.get("message", {})
        self._benchling = benchling
        self._cached_entry_id: Optional[str] = None
        self._display_id: Optional[str] = display_id

        logger.info(
            "Payload initialized",
            event_type=self._message.get("type"),
            has_canvas_id="canvasId" in self._message,
            has_resource_id="resourceId" in self._message,
            has_entry_id="entryId" in self._message,
            has_button_id="buttonId" in self._message,
        )

    @classmethod
    def from_request(
        cls,
        request: Request,
        benchling: Optional["Benchling"] = None,
    ) -> "Payload":
        """
        Create Payload from Flask Request object.

        Args:
            request: Flask Request object
            benchling: Optional Benchling client for fallback entry_id lookup

        Returns:
            Payload instance

        Raises:
            ValueError: If payload cannot be parsed from request
        """
        logger.debug("Creating Payload from Flask request")
        payload = request.get_json(force=False, silent=False)
        if payload is None:
            raise ValueError("No JSON payload provided in request")
        logger.debug("Payload parsed from Flask request", payload_keys=list(payload.keys()))
        return cls(payload, benchling)

    @staticmethod
    def get_most_recent_entry(benchling: "Benchling") -> Optional[str]:
        """
        Fetch the most recent entry from Benchling.

        Args:
            benchling: Benchling SDK client

        Returns:
            Most recent entry ID, or None if not found
        """
        try:
            entries_response = benchling.entries.list_entries()
            first_entry = entries_response.first()
            if first_entry:
                logger.info("Found most recent entry: %s", first_entry.id)
                return first_entry.id
            logger.warning("No entries found in Benchling")
            return None
        except Exception as e:
            logger.error("Failed to fetch entries: %s", str(e))
            return None

    @property
    def entry_id(self) -> str:
        """
        Extract entry_id from payload.

        Handles multiple event types:
        - Standard events: uses resourceId or entryId from message
        - Canvas userInteracted events: uses buttonId (which contains entry_id)
        - Canvas events: uses canvas API to get resource_id from canvas_id
        - Fallback: queries Benchling for most recent entry if client provided

        Returns:
            Entry ID

        Raises:
            ValueError: If entry_id cannot be extracted
        """
        # Return cached value if available
        if self._cached_entry_id:
            logger.debug("Using cached entry_id", entry_id=self._cached_entry_id)
            return self._cached_entry_id

        event_type = self._message.get("type")
        button_id = self._message.get("buttonId")

        logger.debug(
            "Extracting entry_id from payload",
            event_type=event_type,
            button_id=button_id,
            has_resource_id="resourceId" in self._message,
            has_canvas_id="canvasId" in self._message,
        )

        # For userInteracted events, button_id contains the entry_id
        # Supports formats:
        # - Simple: "etr_123" or "prefix-etr_123"
        # - With pagination: "action-etr_123-p0-s15"
        if event_type == "v2.canvas.userInteracted" and button_id:
            # Try to parse using pagination parser first (handles complex button IDs)
            if "-" in button_id:
                try:
                    from .pagination import parse_button_id

                    _, entry_id, _ = parse_button_id(button_id)
                    self._cached_entry_id = entry_id
                    logger.info("Extracted entry_id from button_id", button_id=button_id, entry_id=entry_id)
                    return entry_id
                except (ValueError, Exception) as e:
                    # Fallback to simple extraction if parsing fails
                    logger.debug(
                        "Failed to parse button_id with pagination parser, using fallback",
                        button_id=button_id,
                        error=str(e),
                    )
                    # Legacy format: extract last part after dash
                    entry_id = button_id.split("-")[-1]
                    self._cached_entry_id = entry_id
                    logger.info("Extracted entry_id from button_id (fallback)", button_id=button_id, entry_id=entry_id)
                    return entry_id
            # Direct entry_id (no prefix)
            self._cached_entry_id = button_id
            logger.info("Using button_id as entry_id", entry_id=button_id)
            return button_id

        # Standard extraction: resourceId or entryId from message, payload root, or context
        entry_id = (
            self._message.get("resourceId")
            or self._message.get("entryId")
            or self._payload.get("resourceId")
            or self._payload.get("context", {}).get("entryId")
        )

        if entry_id:
            self._cached_entry_id = entry_id
            logger.info("Extracted entry_id from standard fields", entry_id=entry_id)
            return entry_id

        # If no entry_id but we have canvas_id and Benchling client, get resource_id from canvas
        if not entry_id and self.canvas_id and self._benchling:
            logger.info("No entry_id in payload, fetching resource_id from canvas", canvas_id=self.canvas_id)
            try:
                canvas = self._benchling.apps.get_canvas_by_id(self.canvas_id)
                if canvas.resource_id:
                    entry_id = canvas.resource_id
                    self._cached_entry_id = entry_id
                    logger.info(
                        "Retrieved entry_id from canvas resource_id", entry_id=entry_id, canvas_id=self.canvas_id
                    )
            except Exception as e:
                logger.warning("Failed to fetch canvas", canvas_id=self.canvas_id, error=str(e))

        if not entry_id and self._benchling:
            # Fallback: fetch most recent entry
            logger.info("No entry_id in payload, attempting to fetch most recent entry")
            entry_id = self.get_most_recent_entry(self._benchling)
            if entry_id:
                self._cached_entry_id = entry_id
                logger.info("Using most recent entry as fallback", entry_id=entry_id)

        if not entry_id:
            logger.error(
                "Failed to extract entry_id from payload",
                event_type=event_type,
                message_keys=list(self._message.keys()),
            )
            raise ValueError("entry_id is required and could not be extracted from payload")

        self._cached_entry_id = entry_id
        return entry_id

    @property
    def event_id(self) -> str:
        """
        Extract or generate event_id.

        Returns:
            Event ID from payload, or generated UUID if not present
        """
        return self._message.get("id", str(uuid.uuid4()))

    @property
    def canvas_id(self) -> Optional[str]:
        """
        Extract canvas_id from payload.

        Returns:
            Canvas ID if present, None otherwise
        """
        return self._message.get("canvasId")

    @property
    def timestamp(self) -> Optional[str]:
        """
        Extract timestamp from payload.

        Returns:
            Timestamp if present, None otherwise
        """
        return self._message.get("timestamp")

    @property
    def event_type(self) -> str:
        """
        Extract event type from payload.

        Returns:
            Event type string
        """
        return self._message.get("type", "")

    @property
    def base_url(self) -> str:
        """
        Extract base URL from payload.

        Returns:
            Base URL for Benchling instance
        """
        return self._payload.get("baseURL", "")

    @property
    def webhook_data(self) -> Dict[str, Any]:
        """
        Get the webhook message data.

        Returns:
            Message portion of the payload
        """
        return self._message

    @property
    def raw_payload(self) -> Dict[str, Any]:
        """
        Get the raw payload.

        Returns:
            Complete original payload
        """
        return self._payload

    @property
    def display_id(self) -> Optional[str]:
        """
        Get the display_id if set.

        Returns:
            Display ID if available, None otherwise
        """
        return self._display_id

    def set_display_id(self, display_id: str) -> None:
        """
        Set the display_id for package naming.

        Args:
            display_id: Entry display ID (e.g., "PRT001")
        """
        self._display_id = display_id
        logger.info("Display ID set for package naming", display_id=display_id)

    def package_name(self, s3_prefix: str, use_display_id: bool = False) -> str:
        """
        Generate package name for the entry.

        Args:
            s3_prefix: S3 prefix for package (e.g., "benchling")
            use_display_id: If True and display_id is set, use display_id instead of entry_id

        Returns:
            Package name in format: {s3_prefix}/{display_id} or {s3_prefix}/{entry_id}
        """
        if use_display_id and self._display_id:
            return f"{s3_prefix}/{self._display_id}"
        return f"{s3_prefix}/{self.entry_id}"
