"""UI block creation utilities for Canvas.

This module provides reusable functions for creating Benchling Canvas UI blocks
(buttons, markdown, sections) and converting them to dictionary format.
"""

from typing import Any, Dict, List

from benchling_api_client.v2.stable.models.button_ui_block import ButtonUiBlock
from benchling_api_client.v2.stable.models.button_ui_block_type import ButtonUiBlockType
from benchling_api_client.v2.stable.models.button_ui_block_update import ButtonUiBlockUpdate
from benchling_api_client.v2.stable.models.markdown_ui_block_type import MarkdownUiBlockType
from benchling_api_client.v2.stable.models.markdown_ui_block_update import MarkdownUiBlockUpdate
from benchling_api_client.v2.stable.models.section_ui_block_type import SectionUiBlockType
from benchling_api_client.v2.stable.models.section_ui_block_update import SectionUiBlockUpdate

from .packages import Package
from .pagination import PageState, encode_package_name


def create_markdown_block(content: str, block_id: str = "md1") -> MarkdownUiBlockUpdate:
    """Create a markdown UI block.

    Args:
        content: Markdown content string
        block_id: Unique block identifier

    Returns:
        MarkdownUiBlockUpdate instance
    """
    return MarkdownUiBlockUpdate(
        type=MarkdownUiBlockType.MARKDOWN,  # type: ignore
        value=content,  # type: ignore
        id=block_id,  # type: ignore
    )


def create_button_block(button_id: str, text: str, enabled: bool = True) -> ButtonUiBlockUpdate:
    """Create a button UI block.

    Args:
        button_id: Unique button identifier
        text: Button text
        enabled: Whether button is enabled

    Returns:
        ButtonUiBlockUpdate instance
    """
    return ButtonUiBlockUpdate(
        id=button_id,  # type: ignore
        type=ButtonUiBlockType.BUTTON,  # type: ignore
        text=text,  # type: ignore
        enabled=enabled,  # type: ignore
    )


def create_button(button_id: str, text: str, enabled: bool = True) -> ButtonUiBlock:
    """Create a ButtonUiBlock (for use in sections).

    Args:
        button_id: Unique button identifier
        text: Button text
        enabled: Whether button is enabled

    Returns:
        ButtonUiBlock instance
    """
    return ButtonUiBlock(
        id=button_id,  # type: ignore
        type=ButtonUiBlockType.BUTTON,  # type: ignore
        text=text,  # type: ignore
        enabled=enabled,  # type: ignore
    )


def create_section(section_id: str, buttons: List[ButtonUiBlock]) -> SectionUiBlockUpdate:
    """Create a section UI block containing buttons.

    Args:
        section_id: Unique section identifier
        buttons: List of ButtonUiBlock instances

    Returns:
        SectionUiBlockUpdate instance with horizontal button layout
    """
    return SectionUiBlockUpdate(
        id=section_id,  # type: ignore
        type=SectionUiBlockType.SECTION,  # type: ignore
        children=buttons,  # type: ignore
    )


def create_main_navigation_buttons(entry_id: str) -> List:
    """Create main view navigation buttons (Browse Package, Update Package).

    Args:
        entry_id: Entry identifier for button IDs

    Returns:
        List containing section with navigation buttons
    """
    buttons = [
        create_button(
            button_id=f"browse-files-{entry_id}-p0-s15",
            text="Browse Package",
            enabled=True,
        ),
        create_button(
            button_id=f"update-package-{entry_id}",
            text="Update Package",
            enabled=True,
        ),
    ]

    return [create_section("button-section-main", buttons)]


def create_browser_navigation_buttons(entry_id: str, page_state: PageState) -> List:
    """Create browser view navigation buttons (Prev, Next, Back, Metadata).

    Args:
        entry_id: Entry identifier for button IDs
        page_state: Current pagination state

    Returns:
        List containing section with navigation buttons
    """
    prev_page = page_state.page_number - 1 if page_state.has_previous else 0
    next_page = page_state.page_number + 1 if page_state.has_next else page_state.page_number

    buttons = [
        create_button(
            button_id=f"prev-page-{entry_id}-p{prev_page}-s{page_state.page_size}",
            text="← Previous",
            enabled=page_state.has_previous,
        ),
        create_button(
            button_id=f"next-page-{entry_id}-p{next_page}-s{page_state.page_size}",
            text="Next →",
            enabled=page_state.has_next,
        ),
        create_button(
            button_id=f"back-to-package-{entry_id}",
            text="Back to Package",
            enabled=True,
        ),
        create_button(
            button_id=f"view-metadata-{entry_id}-p{page_state.page_number}-s{page_state.page_size}",
            text="View Metadata",
            enabled=True,
        ),
    ]

    return [create_section("button-section-browser", buttons)]


def create_metadata_navigation_buttons(entry_id: str, page_state: PageState) -> List:
    """Create metadata view navigation buttons (Back to Browser, Back to Package).

    Args:
        entry_id: Entry identifier for button IDs
        page_state: Current pagination state (for preserving context)

    Returns:
        List containing section with navigation buttons
    """
    buttons = [
        create_button(
            button_id=f"browse-files-{entry_id}-p{page_state.page_number}-s{page_state.page_size}",
            text="Back to Browser",
            enabled=True,
        ),
        create_button(
            button_id=f"back-to-package-{entry_id}",
            text="Back to Package",
            enabled=True,
        ),
    ]

    return [create_section("button-section-metadata", buttons)]


def create_linked_package_browse_buttons(entry_id: str, packages: List[Package]) -> List:
    """Create Browse buttons for linked packages.

    Creates a horizontal row of Browse buttons below the Linked Packages section.
    Each button opens the Package Entry Browser for that linked package.

    Args:
        entry_id: The current entry ID (for context/logging)
        packages: List of linked Package objects to create buttons for

    Returns:
        List of block dictionaries (empty if no packages)

    Example button ID: browse-linked-etr_abc123-pkg-benchling--exp-001-p0-s15
    """
    if not packages:
        return []

    buttons = []
    for pkg in packages:
        # Encode package name for button ID (replace / with --)
        encoded_pkg_name = encode_package_name(pkg.package_name)

        # Create button ID with default pagination (page 0, size 15)
        button_id = f"browse-linked-{entry_id}-pkg-{encoded_pkg_name}-p0-s15"

        # Create Browse button
        button = create_button(button_id, pkg.package_name)
        buttons.append(button)

    # Create a section with all browse buttons in horizontal layout
    section = create_section("button-section-linked-packages", buttons)

    return [section]


def blocks_to_dict(blocks: List) -> List[Dict[str, Any]]:
    """Convert block objects to dict format for JSON response.

    Args:
        blocks: List of block instances (MarkdownUiBlockUpdate, ButtonUiBlockUpdate, SectionUiBlockUpdate)

    Returns:
        List of dictionaries representing the blocks
    """
    blocks_dict = []
    for block in blocks:
        if isinstance(block, MarkdownUiBlockUpdate):
            blocks_dict.append(
                {
                    "type": "MARKDOWN",
                    "id": block.id,
                    "value": block.value,
                }
            )
        elif isinstance(block, ButtonUiBlockUpdate):
            blocks_dict.append(
                {
                    "type": "BUTTON",
                    "id": block.id,
                    "text": block.text,
                    "enabled": block.enabled,
                }
            )
        elif isinstance(block, SectionUiBlockUpdate):
            # Convert section with button children
            children_dict = []
            for child in block.children:
                if isinstance(child, ButtonUiBlock):
                    children_dict.append(
                        {
                            "type": "BUTTON",
                            "id": child.id,
                            "text": child.text,
                            "enabled": child.enabled,
                        }
                    )
            blocks_dict.append(
                {
                    "type": "SECTION",
                    "id": block.id,
                    "children": children_dict,
                }
            )
    return blocks_dict
