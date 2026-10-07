"""Package naming for Benchling entries.

A notebook package is named ``{pkg_prefix}/{display_id}``. ``pkg_prefix`` may contain
``{dotted.path}`` placeholders that are filled from the Benchling entry, in the form
saved as ``entry_data.json`` (the SDK's ``to_dict()``). For example, ``{creator.handle}``
names each package under its creator's handle (``jdoe/EXP00000001``), and a prefix
without placeholders (default ``benchling``) is used as is.

The name is computed on every call and never stored. A placeholder with no value in
the entry raises ``MissingPlaceholderError``; there is no fallback prefix.
"""

import re
from typing import Any, Dict, List, Pattern

PLACEHOLDER_RE = re.compile(r"\{([^{}]+)\}")


class MissingPlaceholderError(ValueError):
    """Raised when a ``pkg_prefix`` placeholder has no value in the entry."""

    def __init__(self, placeholder: str, pkg_prefix: str, entry_id: Any):
        self.placeholder = placeholder
        self.pkg_prefix = pkg_prefix
        self.entry_id = entry_id
        super().__init__(
            f"pkg_prefix {pkg_prefix!r} needs {{{placeholder}}}, "
            f"but entry {entry_id or '(unknown)'} has no value for it"
        )


def prefix_placeholders(pkg_prefix: str) -> List[str]:
    """Return the dotted paths of the placeholders in ``pkg_prefix``."""
    return PLACEHOLDER_RE.findall(pkg_prefix)


def _entry_dict(entry: Any) -> Dict[str, Any]:
    """Return the entry as a dict, accepting either ``to_dict()`` output or an SDK ``Entry``."""
    if isinstance(entry, dict):
        return entry
    to_dict = getattr(entry, "to_dict", None)
    data = to_dict() if callable(to_dict) else None
    return data if isinstance(data, dict) else {}


def _lookup(data: Dict[str, Any], path: str) -> Any:
    value: Any = data
    for key in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def resolve_prefix(pkg_prefix: str, entry: Any) -> str:
    """Fill each ``{dotted.path}`` in ``pkg_prefix`` from the entry.

    Raises:
        MissingPlaceholderError: If a placeholder's value is missing, empty, or not a string.
    """
    if not prefix_placeholders(pkg_prefix):
        return pkg_prefix
    data = _entry_dict(entry)

    def fill(match: "re.Match[str]") -> str:
        value = _lookup(data, match.group(1))
        if not isinstance(value, str) or not value:
            raise MissingPlaceholderError(match.group(1), pkg_prefix, data.get("id"))
        return value

    return PLACEHOLDER_RE.sub(fill, pkg_prefix)


def entry_package_name(pkg_prefix: str, display_id: str, entry: Any) -> str:
    """Return the Quilt package name for an entry: ``{resolved pkg_prefix}/{display_id}``."""
    return f"{resolve_prefix(pkg_prefix, entry)}/{display_id}"


def prefix_pattern(pkg_prefix: str) -> Pattern[str]:
    """Return a regex matching package names under ``pkg_prefix``.

    Each placeholder matches one path segment; everything else matches literally, so a
    prefix without placeholders matches exactly the names that start with ``{pkg_prefix}/``.
    """
    parts = PLACEHOLDER_RE.split(pkg_prefix)
    # split() alternates literal text and placeholder paths: even indexes are literal.
    regex = "".join(re.escape(part) if i % 2 == 0 else "[^/]+" for i, part in enumerate(parts))
    return re.compile(f"{regex}/")
