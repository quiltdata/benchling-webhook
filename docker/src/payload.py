"""
Unified payload parsing for Benchling webhooks.

Handles parsing of webhook payloads for both entry packaging and canvas operations.
"""

import asyncio
import uuid
from typing import TYPE_CHECKING, Any, Dict, Optional

import structlog
from starlette.requests import Request

if TYPE_CHECKING:
    from benchling_sdk.benchling import Benchling

logger = structlog.get_logger(__name__)

CANVAS_INTERACTION_EVENT = "v2.canvas.userInteracted"


def canvas_entry_id(benchling: Optional["Benchling"], canvas_id: Optional[str]) -> Optional[str]:
    """Return the entry Benchling records for ``canvas_id``, or None if it can't be read."""
    if not benchling or not canvas_id:
        return None
    try:
        resource_id = benchling.apps.get_canvas_by_id(canvas_id).resource_id
    except Exception as exc:  # noqa: BLE001 - callers treat an unreadable canvas as unresolved
        logger.warning("Failed to read canvas", canvas_id=canvas_id, error=str(exc))
        return None
    return resource_id if isinstance(resource_id, str) and resource_id else None


def canvas_belongs_to_entry(benchling: Optional["Benchling"], canvas_id: str, entry_id: str) -> bool:
    """True when Benchling records ``canvas_id`` as ``entry_id``'s canvas.

    Callers skip a redraw when this is False, including when the canvas can't be read.
    """
    resolved = canvas_entry_id(benchling, canvas_id)
    if resolved == entry_id:
        return True
    logger.warning(
        "Skipping canvas redraw: canvas belongs to a different entry",
        canvas_id=canvas_id,
        entry_id=entry_id,
        canvas_entry_id=resolved,
    )
    return False


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
        self._event_id: Optional[str] = None

        logger.info(
            "Payload initialized",
            event_type=self._message.get("type"),
            has_canvas_id=bool(self._message.get("canvasId") or self._payload.get("context", {}).get("canvasId")),
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
        - Canvas userInteracted events: the entry Benchling records for the clicked
          canvas; a button rendered for a different entry is refused
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

        if event_type == CANVAS_INTERACTION_EVENT:
            entry_id = self._clicked_canvas_entry_id(button_id or "")
            self._cached_entry_id = entry_id
            return entry_id

        entry_id = self._message.get("resourceId") or self._message.get("entryId") or self._payload.get("resourceId")

        if entry_id:
            self._cached_entry_id = entry_id
            logger.info("Extracted entry_id from standard fields", entry_id=entry_id)
            return entry_id

        if not entry_id and self.canvas_id and self._benchling:
            logger.info("No entry_id in payload, fetching resource_id from canvas", canvas_id=self.canvas_id)
            entry_id = canvas_entry_id(self._benchling, self.canvas_id)
            if entry_id:
                logger.info("Retrieved entry_id from canvas resource_id", entry_id=entry_id, canvas_id=self.canvas_id)

        if not entry_id:
            logger.error(
                "Failed to extract entry_id from payload",
                event_type=event_type,
                message_keys=list(self._message.keys()),
            )
            raise ValueError("entry_id is required and could not be extracted from payload")

        self._cached_entry_id = entry_id
        return entry_id

    def _clicked_canvas_entry_id(self, button_id: str) -> str:
        """The entry a click acts on: the one Benchling records for the clicked canvas.

        The button ID also names an entry (the one it was rendered for). When it
        names a different one, the click is refused.
        """
        from .pagination import button_entry_id

        entry_id = canvas_entry_id(self._benchling, self.canvas_id)
        if not entry_id:
            logger.error("Could not resolve the clicked canvas's entry", canvas_id=self.canvas_id, button_id=button_id)
            raise ValueError("Could not resolve the entry for this canvas")

        button_entry = button_entry_id(button_id)
        if button_entry and button_entry != entry_id:
            logger.warning(
                "Refusing canvas action: button belongs to a different entry than the canvas",
                canvas_id=self.canvas_id,
                canvas_entry_id=entry_id,
                button_entry_id=button_entry,
                button_id=button_id,
            )
            raise ValueError("Canvas button belongs to a different entry than the canvas")

        logger.info("Resolved entry_id from canvas", entry_id=entry_id, canvas_id=self.canvas_id)
        return entry_id

    async def resolve_entry_id(self) -> str:
        """Resolve and cache ``entry_id`` from async code without blocking the event loop.

        Resolving may call Benchling's canvas API, a blocking request, so it runs
        in a worker thread. Later reads of ``entry_id`` use the cached value.
        Raises ValueError as ``entry_id`` does.
        """
        if self._cached_entry_id:
            return self._cached_entry_id
        return await asyncio.to_thread(lambda: self.entry_id)

    @property
    def event_id(self) -> str:
        """Extract event_id, or generate one the first time it is read; it is then stable."""
        event_id = self._event_id
        if event_id is None:
            event_id = self._event_id = self._message.get("id") or str(uuid.uuid4())
        return event_id

    @property
    def canvas_id(self) -> Optional[str]:
        """Extract canvas_id from payload."""
        return self._message.get("canvasId") or self._payload.get("context", {}).get("canvasId")

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
