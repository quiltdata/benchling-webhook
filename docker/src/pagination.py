"""Pagination management for Package Entry Browser."""

import base64
import binascii
import math
import re
from dataclasses import dataclass
from typing import Any, List, Optional, Tuple

import structlog

logger = structlog.get_logger(__name__)

# S3 bucket naming rules: 3-63 chars, lowercase letters/digits/dots/hyphens,
# beginning and ending with a letter or digit. Used to disambiguate the optional
# "-bucket-" segment in linked-package button IDs from package names that happen
# to contain the literal substring "-bucket-".
_BUCKET_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")

# Benchling ID prefixes that mark the entry segment of a Canvas button ID.
ENTRY_ID_PREFIXES = ("etr_", "plt_", "seq_", "cus_", "dna_", "aa_", "rna_")


def encode_package_name(package_name: str) -> str:
    """Encode package name for button ID.

    Replaces '/' with '--' to avoid parsing issues in button IDs.

    Args:
        package_name: Package name like 'benchling/experiment-001'

    Returns:
        Encoded name like 'benchling--experiment-001'

    Examples:
        >>> encode_package_name('benchling/exp-001')
        'benchling--exp-001'
        >>> encode_package_name('benchling/exp--001')
        'benchling--exp----001'
    """
    return package_name.replace("/", "--")


def decode_package_name(encoded_name: str) -> str:
    """Decode package name from button ID.

    Replaces '--' with '/' to restore original package name.

    Args:
        encoded_name: Encoded name like 'benchling--experiment-001'

    Returns:
        Decoded name like 'benchling/experiment-001'

    Examples:
        >>> decode_package_name('benchling--exp-001')
        'benchling/exp-001'
        >>> decode_package_name('benchling--exp----001')
        'benchling/exp--001'
    """
    return encoded_name.replace("--", "/")


def encode_bucket_name(bucket_name: str) -> str:
    """Encode bucket name for button ID (identity function).

    S3 bucket names are restricted to lowercase letters, numbers, dots,
    and hyphens, so no encoding is needed — they embed safely in button IDs.

    Args:
        bucket_name: S3 bucket name (e.g., 'quiltdata-test')

    Returns:
        The bucket name unchanged.

    Examples:
        >>> encode_bucket_name('quiltdata-test')
        'quiltdata-test'
    """
    return bucket_name


def decode_bucket_name(encoded_name: str) -> str:
    """Decode bucket name from button ID (identity function).

    S3 bucket names are restricted to lowercase letters, numbers, dots,
    and hyphens, so no decoding is needed.

    Args:
        encoded_name: Bucket name from button ID (e.g., 'quiltdata-test')

    Returns:
        The name unchanged.

    Examples:
        >>> decode_bucket_name('quiltdata-test')
        'quiltdata-test'
    """
    return encoded_name


def parse_browse_linked_button_id_with_bucket(button_id: str) -> tuple[str, str, Optional[str], int, int]:
    """Parse linked package button ID.

    Supports multiple button formats:
    - browse-linked-{entry_id}-pkg-{encoded_pkg}[-bucket-{bucket_name}]-p{page}-s{size}
    - next-page-linked-{entry_id}-pkg-{encoded_pkg}[-bucket-{bucket_name}]-p{page}-s{size}
    - prev-page-linked-{entry_id}-pkg-{encoded_pkg}[-bucket-{bucket_name}]-p{page}-s{size}
    - view-metadata-linked-{entry_id}-pkg-{encoded_pkg}[-bucket-{bucket_name}]-p{page}-s{size}

    When a linked package belongs to a different bucket than the one configured for
    the webhook, the bucket name is embedded as an optional `-bucket-` segment.
    The bucket name segment is absent when the linked package is in the same bucket.

    Args:
        button_id: Button ID string to parse

    Returns:
        Tuple of (entry_id, package_name, bucket_name, page_number, page_size)
        bucket_name is None when no bucket segment was present.

    Raises:
        ValueError: If button ID format is invalid

    Examples:
        >>> parse_browse_linked_button_id_with_bucket('browse-linked-etr_123-pkg-benchling--exp-001-p0-s15')
        ('etr_123', 'benchling/exp-001', None, 0, 15)
        >>> parse_browse_linked_button_id_with_bucket('next-page-linked-etr_abc-pkg-foo--bar--baz-p2-s20')
        ('etr_abc', 'foo/bar/baz', None, 2, 20)
        >>> parse_browse_linked_button_id_with_bucket('browse-linked-etr_456-pkg-benchling--exp-002-bucket-quiltdata-test-p0-s10')
        ('etr_456', 'benchling/exp-002', 'quiltdata-test', 0, 10)
    """
    # Check if this is a linked package button (contains "-linked-" and "-pkg-")
    if "-linked-" not in button_id or "-pkg-" not in button_id:
        raise ValueError(f"Invalid browse-linked button ID: {button_id}")

    # Find the position after "-linked-" to extract the rest
    linked_pos = button_id.find("-linked-")
    if linked_pos == -1:
        raise ValueError(f"Invalid browse-linked button ID: {button_id}")

    # Remove everything before and including "-linked-"
    rest = button_id[linked_pos + len("-linked-") :]

    # Extract entry_id (everything before "-pkg-")
    if "-pkg-" not in rest:
        raise ValueError(f"Missing '-pkg-' separator in button ID: {button_id}")

    entry_id, rest = rest.split("-pkg-", 1)

    # Extract encoded package name (everything before last "-p")
    # Use rsplit to handle package names with "-p" in them
    if "-p" not in rest:
        raise ValueError(f"Missing '-p' separator in button ID: {button_id}")

    encoded_pkg, rest = rest.rsplit("-p", 1)

    encoded_bucket = None
    if "-bucket-" in encoded_pkg:
        candidate_pkg, candidate_bucket = encoded_pkg.rsplit("-bucket-", 1)
        # Only treat the trailing segment as a bucket when it is a valid S3 bucket
        # name; otherwise "-bucket-" is part of the package name itself and must
        # not be split off (which would corrupt both package and bucket names).
        if _BUCKET_NAME_RE.match(candidate_bucket):
            encoded_pkg, encoded_bucket = candidate_pkg, candidate_bucket

    package_name = decode_package_name(encoded_pkg)
    bucket_name = decode_bucket_name(encoded_bucket) if encoded_bucket else None

    # Extract page and size
    if "-s" not in rest:
        raise ValueError(f"Missing '-s' separator in button ID: {button_id}")

    page_str, size_str = rest.split("-s", 1)

    try:
        page_number = int(page_str)
        page_size = int(size_str)
    except ValueError as e:
        raise ValueError(f"Invalid page/size in button ID: {button_id}") from e

    return (entry_id, package_name, bucket_name, page_number, page_size)


def parse_browse_linked_button_id(button_id: str) -> tuple[str, str, int, int]:
    entry_id, package_name, _bucket_name, page_number, page_size = parse_browse_linked_button_id_with_bucket(button_id)
    return (entry_id, package_name, page_number, page_size)


def encode_related_button_value(value: str) -> str:
    """Encode a related-package button field reversibly without delimiter characters."""
    return base64.b32encode(value.encode("utf-8")).decode("ascii").rstrip("=")


def decode_related_button_value(encoded: str) -> str:
    """Decode a Base32 related-package button field."""
    padding = "=" * (-len(encoded) % 8)
    try:
        return base64.b32decode(encoded + padding, casefold=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise ValueError(f"Invalid related-package button encoding: {encoded}") from exc


def parse_related_package_button_id(button_id: str) -> tuple[str, str]:
    """Parse the entry ID and package name from a ``link-related`` Canvas button ID."""
    prefix = "link-related-"
    if not button_id.startswith(prefix) or "-pkg-" not in button_id:
        raise ValueError(f"Invalid link-related button ID: {button_id}")
    entry_id, encoded_package = button_id[len(prefix) :].split("-pkg-", 1)
    package_name = decode_related_button_value(encoded_package) if encoded_package else ""
    if not entry_id or not package_name:
        raise ValueError(f"Invalid link-related button ID: {button_id}")
    return entry_id, package_name


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
    entry_idx = None
    for i, part in enumerate(parts):
        if part.startswith(ENTRY_ID_PREFIXES):
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


# The Canvas button actions, in the order the /canvas dispatcher (app.py) matches them.
# More specific prefixes come first: "next-page-linked-" before "next-page-",
# "view-metadata-linked-" before "view-metadata-". The dispatcher and the click check
# both use this table, so the entry checked is the entry the dispatched handler reads.
CANVAS_BUTTON_ACTIONS: Tuple[Tuple[str, str], ...] = (
    ("browse-files-", "browse_files"),
    ("browse-linked-", "browse_linked"),
    ("view-related-", "view_related"),
    ("next-page-related-", "view_related"),
    ("prev-page-related-", "view_related"),
    ("link-related-", "link_related"),
    ("next-page-linked-", "page_navigation_linked"),
    ("prev-page-linked-", "page_navigation_linked"),
    ("next-page-", "page_navigation"),
    ("prev-page-", "page_navigation"),
    ("back-to-package-", "back_to_main"),
    ("view-metadata-linked-", "view_metadata_linked"),
    ("view-metadata-", "view_metadata"),
    ("refresh-canvas-", "refresh_canvas"),
    ("update-package-", "update_package"),
)


def canvas_button_action(button_id: str) -> Optional[str]:
    """The action the /canvas dispatcher routes ``button_id`` to, or None if it routes it nowhere."""
    for prefix, action in CANVAS_BUTTON_ACTIONS:
        if button_id.startswith(prefix):
            return action
    return None


def _entry_after_prefix(button_id: str, prefix: str) -> str:
    """Entry ID for buttons rendered as ``{prefix}{entry_id}`` with nothing after it."""
    entry_id = button_id[len(prefix) :]
    if not entry_id.startswith(ENTRY_ID_PREFIXES) or "-" in entry_id:
        raise ValueError(f"Invalid button ID: {button_id}")
    return entry_id


def _linked_button_entry(button_id: str) -> str:
    return parse_browse_linked_button_id_with_bucket(button_id)[0]


def _paged_button_entry(button_id: str) -> str:
    return parse_button_id(button_id)[1]


def _related_button_entry(button_id: str) -> str:
    return parse_related_package_button_id(button_id)[0]


# How each action's handler reads the entry from its button ID.
_BUTTON_ENTRY_PARSERS = {
    "browse_files": _paged_button_entry,
    "view_related": _paged_button_entry,
    "page_navigation": _paged_button_entry,
    "view_metadata": _paged_button_entry,
    "browse_linked": _linked_button_entry,
    "page_navigation_linked": _linked_button_entry,
    "view_metadata_linked": _linked_button_entry,
    "link_related": _related_button_entry,
    "back_to_main": lambda button_id: _entry_after_prefix(button_id, "back-to-package-"),
    "refresh_canvas": lambda button_id: _entry_after_prefix(button_id, "refresh-canvas-"),
    "update_package": lambda button_id: _entry_after_prefix(button_id, "update-package-"),
}


def button_entry_id(button_id: str) -> Optional[str]:
    """Return the entry a Canvas button was rendered for.

    The action is chosen by prefix, in the dispatcher's order, and the entry is read
    the way that action's handler reads it, so the result is the entry the handler acts on.

    Returns None for a button the dispatcher routes nowhere: such a click acts on the
    canvas's own entry. Raises ValueError for a routed button whose entry can't be read.
    """
    action = canvas_button_action(button_id or "")
    if action is None:
        return None
    return _BUTTON_ENTRY_PARSERS[action](button_id)
