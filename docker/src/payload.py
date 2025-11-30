"""
Unified payload parsing for Benchling webhooks.

Handles parsing of webhook payloads for both entry packaging and canvas operations.
"""

import uuid
from typing import TYPE_CHECKING, Any, Dict, Optional

import structlog
from starlette.requests import Request

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
            benchling: Optional Benchling client for canvas resource_id lookup
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
    async def from_request(
        cls,
        request: Request,
        benchling: Optional["Benchling"] = None,
    ) -> "Payload":
        """
        Create Payload from a FastAPI Request object.

        Args:
            request: FastAPI Request object
            benchling: Optional Benchling client for canvas resource_id lookup

        Returns:
            Payload instance

        Raises:
            ValueError: If payload cannot be parsed from request
        """
        logger.debug("Creating Payload from request")
        try:
            payload = await request.json()
        except Exception as exc:
            logger.warning("Failed to parse JSON payload", error=str(exc))
            raise ValueError("No JSON payload provided in request") from exc

        if payload is None:
            raise ValueError("No JSON payload provided in request")

        if not isinstance(payload, dict):
            raise ValueError("Invalid JSON payload provided in request")

        logger.debug("Payload parsed from request", payload_keys=list(payload.keys()))
        return cls(payload, benchling)

    @property
    def entry_id(self) -> str:
        """
        Extract entry_id from payload.

        Handles multiple event types:
        - Standard events: uses resourceId or entryId from message
        - Canvas userInteracted events: uses buttonId (which contains entry_id)
        - Canvas events: uses canvas API to get resource_id from canvas_id

        Returns:
            Entry ID

        Raises:
            ValueError: If entry_id cannot be extracted
        """
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

        if event_type == "v2.canvas.userInteracted" and button_id:
            if "-" in button_id:
                try:
                    from .pagination import parse_button_id

                    _, entry_id, _ = parse_button_id(button_id)
                    self._cached_entry_id = entry_id
                    logger.info("Extracted entry_id from button_id", button_id=button_id, entry_id=entry_id)
                    return entry_id
                except (ValueError, Exception) as e:
                    logger.debug(
                        "Failed to parse button_id with pagination parser, using simple extraction",
                        button_id=button_id,
                        error=str(e),
                    )
                    entry_id = button_id.split("-")[-1]
                    self._cached_entry_id = entry_id
                    logger.info("Extracted entry_id from button_id (simple)", button_id=button_id, entry_id=entry_id)
                    return entry_id
            self._cached_entry_id = button_id
            logger.info("Using button_id as entry_id", entry_id=button_id)
            return button_id

        entry_id = self._message.get("resourceId") or self._message.get("entryId") or self._payload.get("resourceId")

        if entry_id:
            self._cached_entry_id = entry_id
            logger.info("Extracted entry_id from standard fields", entry_id=entry_id)
            return entry_id

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
        """Extract or generate event_id."""
        return self._message.get("id", str(uuid.uuid4()))

    @property
    def canvas_id(self) -> Optional[str]:
        """Extract canvas_id from payload."""
        return self._message.get("canvasId")

    @property
    def timestamp(self) -> Optional[str]:
        """Extract timestamp from payload."""
        return self._message.get("timestamp")

    @property
    def event_type(self) -> str:
        """Extract event type from payload."""
        return self._message.get("type", "")

    @property
    def base_url(self) -> str:
        """Extract base URL from payload."""
        return self._payload.get("baseURL", "")

    @property
    def webhook_data(self) -> Dict[str, Any]:
        """Get the webhook message data."""
        return self._message

    @property
    def raw_payload(self) -> Dict[str, Any]:
        """Get the raw payload."""
        return self._payload

    @property
    def display_id(self) -> Optional[str]:
        """Get the display_id if set."""
        return self._display_id

    def set_display_id(self, display_id: str) -> None:
        """Set the display_id for package naming."""
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
