"""Pagination management for Package Entry Browser."""

import math
import re
from dataclasses import dataclass
from typing import Any, List, Optional, Tuple

import structlog

logger = structlog.get_logger(__name__)


@dataclass
class PageState:
    """Encapsulates pagination state."""

    page_number: int  # 0-indexed
    page_size: int
    total_items: int

    def __post_init__(self):
        """Validate pagination state."""
        if self.page_number < 0:
            raise ValueError(f"page_number must be >= 0, got {self.page_number}")
        if self.page_size < 1:
            raise ValueError(f"page_size must be >= 1, got {self.page_size}")
        if self.total_items < 0:
            raise ValueError(f"total_items must be >= 0, got {self.total_items}")

    @property
    def total_pages(self) -> int:
        """Calculate total number of pages."""
        if self.total_items == 0:
            return 0
        return math.ceil(self.total_items / self.page_size)

    @property
    def has_next(self) -> bool:
        """Check if next page exists."""
        return self.page_number < self.total_pages - 1

    @property
    def has_previous(self) -> bool:
        """Check if previous page exists."""
        return self.page_number > 0

    @property
    def start_index(self) -> int:
        """Starting item index for current page (0-indexed)."""
        return self.page_number * self.page_size

    @property
    def end_index(self) -> int:
        """Ending item index for current page (exclusive)."""
        return min(self.start_index + self.page_size, self.total_items)

    @property
    def items_on_page(self) -> int:
        """Number of items on current page."""
        return self.end_index - self.start_index

    def to_button_suffix(self) -> str:
        """
        Encode pagination state as button ID suffix.

        Returns:
            Suffix string: "p{page}-s{size}"
            Example: "p0-s15"
        """
        return f"p{self.page_number}-s{self.page_size}"

    @staticmethod
    def from_button_suffix(suffix: str, total_items: int) -> "PageState":
        """
        Decode button ID suffix into PageState.

        Args:
            suffix: Button ID suffix (e.g., "p0-s15")
            total_items: Total number of items (needed for validation)

        Returns:
            PageState instance

        Raises:
            ValueError: If suffix is invalid
        """
        # Parse suffix: "p{page}-s{size}"
        match = re.match(r"p(\d+)-s(\d+)$", suffix)
        if not match:
            raise ValueError(f"Invalid pagination suffix: {suffix}")

        page_number = int(match.group(1))
        page_size = int(match.group(2))

        return PageState(
            page_number=page_number,
            page_size=page_size,
            total_items=total_items,
        )

    def clamp_page(self) -> "PageState":
        """
        Return new PageState with page_number clamped to valid range.

        Useful for handling invalid page numbers from button IDs.
        """
        if self.total_pages == 0:
            clamped_page = 0
        else:
            clamped_page = max(0, min(self.page_number, self.total_pages - 1))

        return PageState(
            page_number=clamped_page,
            page_size=self.page_size,
            total_items=self.total_items,
        )


def paginate_items(
    items: List[Any],
    page_number: int,
    page_size: int,
) -> Tuple[List[Any], PageState]:
    """
    Paginate a list of items.

    Args:
        items: List of items to paginate
        page_number: 0-indexed page number
        page_size: Items per page

    Returns:
        Tuple of (items_for_page, page_state)
    """
    logger.debug(
        "Paginating items",
        total_items=len(items),
        page_number=page_number,
        page_size=page_size,
    )

    page_state = PageState(
        page_number=page_number,
        page_size=page_size,
        total_items=len(items),
    )

    # Clamp page number to valid range
    page_state = page_state.clamp_page()

    # Extract items for this page
    items_for_page = items[page_state.start_index : page_state.end_index]

    logger.debug(
        "Pagination complete",
        items_on_page=len(items_for_page),
        total_pages=page_state.total_pages,
    )

    return items_for_page, page_state


def parse_button_id(button_id: str) -> Tuple[str, str, Optional[PageState]]:
    """
    Parse button ID into action, entry_id, and page state.

    Format: "{action}-{entry_id}-p{page}-s{size}"
    Example: "browse-files-etr_abc123-p0-s15"

    Args:
        button_id: Button ID string

    Returns:
        Tuple of (action, entry_id, page_state)
        For buttons without pagination, page_state will be None

    Raises:
        ValueError: If button_id format is invalid
    """
    # Split button ID
    parts = button_id.split("-")

    if len(parts) < 2:
        raise ValueError(f"Invalid button ID format: {button_id}")

    # Find entry_id (starts with known prefixes)
    entry_prefixes = ("etr_", "plt_", "seq_", "cus_", "dna_", "aa_", "rna_")
    entry_idx = None
    for i, part in enumerate(parts):
        if part.startswith(entry_prefixes):
            entry_idx = i
            break

    if entry_idx is None:
        raise ValueError(f"No entry_id found in button ID: {button_id}")

    # Extract components
    action = "-".join(parts[:entry_idx])
    entry_id = parts[entry_idx]

    # Check for pagination suffix
    remaining = "-".join(parts[entry_idx + 1 :])
    if remaining:
        # Try to parse as pagination suffix
        # Note: We need total_items to create PageState, so we'll create a partial state
        # The caller must update with total_items
        try:
            # Extract page and size
            match = re.search(r"p(\d+)-s(\d+)$", remaining)
            if match:
                page_number = int(match.group(1))
                page_size = int(match.group(2))
                # Create PageState with placeholder total_items (caller must update)
                page_state = PageState(page_number=page_number, page_size=page_size, total_items=0)
            else:
                page_state = None
        except Exception:
            page_state = None
    else:
        page_state = None

    logger.debug(
        "Parsed button ID",
        button_id=button_id,
        action=action,
        entry_id=entry_id,
        page_state=page_state,
    )

    return action, entry_id, page_state
