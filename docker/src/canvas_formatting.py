"""Markdown formatting utilities for Canvas content generation.

This module provides reusable markdown formatting functions to reduce
code duplication across canvas views.
"""

import re
from typing import Any, Dict, List

from .packages import Package

# URL pattern for detecting URLs in text
URL_PATTERN = re.compile(
    r"(?<![\[\(])"  # Negative lookbehind: not preceded by [ or (
    r"(https?://[^\s\)>\]]+)"  # Match http:// or https:// followed by non-whitespace chars
    r"(?![\]\)])"  # Negative lookahead: not followed by ] or )
)


def linkify_urls(text: str) -> str:
    """Convert plain URLs in text to markdown links.

    Args:
        text: Text that may contain URLs

    Returns:
        Text with URLs converted to markdown link format [url](url)

    Example:
        >>> linkify_urls("Check https://example.com for more")
        'Check [https://example.com](https://example.com) for more'
    """

    # Avoid linkifying URLs that are already in markdown links or inside brackets
    def replace_url(match: re.Match) -> str:
        url = match.group(1)
        return f"[{url}]({url})"

    return URL_PATTERN.sub(replace_url, text)


def format_package_header(package_name: str, display_id: str, catalog_url: str, sync_url: str) -> str:
    """Format primary package header with action links.

    Args:
        package_name: Name of the package
        display_id: Entry display ID
        catalog_url: URL to catalog view
        sync_url: URL for sync action

    Returns:
        Formatted markdown string
    """
    return f"""## {display_id}

* Package: [{package_name}]({catalog_url}) [[🔄 sync]]({sync_url})
"""


def format_notice() -> str:
    """Format async processing notice.

    Returns:
        Formatted markdown string with horizontal rule and notice
    """
    return """
---
> **NOTE**: *Package will be created/updated asynchronously*
"""


def format_linked_packages(packages: List[Package]) -> str:
    """Format linked packages section.

    Args:
        packages: List of Package instances to display

    Returns:
        Formatted markdown string, or empty string if no packages
    """
    if not packages:
        return ""

    content = "\n### Linked Packages\n\n"
    for pkg in packages:
        content += f"* [{pkg.package_name}]({pkg.catalog_url}) [[🔄 sync]]({pkg.make_sync_url()})\n"
    return content


def format_file_list_header(package_name: str, page_num: int, total_pages: int) -> str:
    """Format file list header.

    Args:
        package_name: Name of the package
        page_num: Current page number (1-indexed for display)
        total_pages: Total number of pages

    Returns:
        Formatted markdown string
    """
    md = f"## Package Files - Page {page_num} of {total_pages}\n\n"
    md += f"**Package**: {package_name}\n\n"
    return md


def format_file_list_item(index: int, name: str, size_display: str, catalog_url: str, sync_url: str) -> str:
    """Format a single file list item.

    Args:
        index: Item number (1-indexed)
        name: File name
        size_display: Human-readable size
        catalog_url: URL to view file in catalog
        sync_url: URL to sync file

    Returns:
        Formatted markdown string
    """
    return f"{index}. [[👁️ view]]({catalog_url}) [[🔄 sync]]({sync_url}) **{name}** ({size_display})\n"


def format_file_list_footer(start_idx: int, end_idx: int, total_items: int) -> str:
    """Format file list footer with pagination info.

    Args:
        start_idx: Starting index (1-indexed for display)
        end_idx: Ending index (1-indexed for display)
        total_items: Total number of items

    Returns:
        Formatted markdown string
    """
    return f"---\n**Showing files {start_idx}-{end_idx} of {total_items}**\n"


def format_metadata_header(package_name: str) -> str:
    """Format metadata view header.

    Args:
        package_name: Name of the package

    Returns:
        Formatted markdown string
    """
    return f"## Package Metadata\n\n**Package**: {package_name}\n\n"


def format_empty_package(package_name: str) -> str:
    """Format empty package message.

    Args:
        package_name: Name of the package

    Returns:
        Formatted markdown string
    """
    return f"""## Package Is Empty

Package `{package_name}` exists but contains no files.

"""


def format_package_not_found(package_name: str) -> str:
    """Format package not found message.

    Args:
        package_name: Name of the package

    Returns:
        Formatted markdown string
    """
    return f"""## Package Not Created

Package `{package_name}` has not been created yet.

Click **Update Package** to create it.
"""


def format_error_loading_files(package_name: str, error: str) -> str:
    """Format error loading files message.

    Args:
        package_name: Name of the package
        error: Error message

    Returns:
        Formatted markdown string
    """
    return f"""## Error Loading Files

Unable to fetch files for package `{package_name}`.

Error: {error}

Please try again or contact support if the problem persists.
"""


def format_error_loading_metadata(package_name: str, error: str) -> str:
    """Format error loading metadata message.

    Args:
        package_name: Name of the package
        error: Error message

    Returns:
        Formatted markdown string
    """
    return f"""## Error Loading Metadata

Unable to fetch metadata for package `{package_name}`.

Error: {error}
"""


def format_error_notification(errors: List[str]) -> str:
    """Format error notification section to display at bottom of Canvas.

    Args:
        errors: List of error messages to display

    Returns:
        Formatted markdown string with error notification, or empty string if no errors
    """
    if not errors:
        return ""

    content = "\n---\n\n### ⚠️ Warnings\n\n"
    for error in errors:
        content += f"> {error}\n\n"
    return content


def dict_to_markdown_list(data: Dict[str, Any], indent_level: int = 0) -> str:
    """Convert a dictionary to markdown bulleted list with sublists.

    Args:
        data: Dictionary to convert
        indent_level: Current indentation level (for nested lists)

    Returns:
        Markdown bulleted list string
    """
    md = ""
    indent = "  " * indent_level

    for key, value in data.items():
        if isinstance(value, dict):
            # Nested dictionary: show key and recurse
            md += f"{indent}- **{key}**:\n"
            md += dict_to_markdown_list(value, indent_level + 1)
        elif isinstance(value, list):
            # List: show key and list items with indices
            md += f"{indent}- **{key}**:\n"
            for idx, item in enumerate(value, start=1):
                if isinstance(item, dict):
                    # List of dicts: add index and recurse for each
                    md += f"{indent}  {idx}.\n"
                    md += dict_to_markdown_list(item, indent_level + 2)
                else:
                    # Simple list item with index
                    md += f"{indent}  {idx}. {item}\n"
        elif value is None:
            md += f"{indent}- **{key}**: *null*\n"
        elif isinstance(value, bool):
            md += f"{indent}- **{key}**: {str(value).lower()}\n"
        elif isinstance(value, str):
            # Linkify URLs in string values
            linkified_value = linkify_urls(value)
            md += f"{indent}- **{key}**: {linkified_value}\n"
        else:
            md += f"{indent}- **{key}**: {value}\n"

    return md


def format_canvas_footer(version: str, quilt_host: str, bucket: str) -> str:
    """Format canvas footer with version and deployment information.

    Args:
        version: Application version
        quilt_host: Quilt catalog host
        bucket: S3 bucket name

    Returns:
        Formatted markdown string with footer information
    """
    return f"""
---
*Version: {version} | Quilt Host: {quilt_host} | Bucket: {bucket}*

> **Note**: This canvas displays integration metadata. For full package details and data access, visit the Quilt catalog.
"""
