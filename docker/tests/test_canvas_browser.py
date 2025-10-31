"""Tests for Canvas browser functionality."""

from unittest.mock import Mock

import pytest

from src.canvas import CanvasManager
from src.config import Config
from src.package_files import PackageFile
from src.pagination import PageState
from src.payload import Payload


@pytest.mark.local
class TestCanvasBrowser:
    """Test suite for Canvas browser functionality.

    Note: These tests require AWS access (STS API) and are marked as local-only.
    They are excluded from CI runs.
    """

    @pytest.fixture
    def mock_config(self):
        """Create a mock config."""
        config = Mock(spec=Config)
        config.s3_bucket_name = "test-bucket"
        config.s3_prefix = "benchling"
        config.quilt_catalog = "test.quiltdata.com"
        config.quilt_database = "test-athena-db"
        config.package_key = "experiment_id"
        config.package_bucket_only = False
        return config

    @pytest.fixture
    def mock_payload(self):
        """Create a mock payload."""
        payload = Mock(spec=Payload)
        payload.entry_id = "etr_test123"
        payload.canvas_id = "canvas_test456"
        payload.package_name.return_value = "benchling/test-entry"
        return payload

    @pytest.fixture
    def mock_benchling(self):
        """Create a mock Benchling client."""
        return Mock()

    @pytest.fixture
    def canvas_manager(self, mock_benchling, mock_config, mock_payload):
        """Create a CanvasManager instance."""
        return CanvasManager(mock_benchling, mock_config, mock_payload)

    @pytest.fixture
    def sample_files(self):
        """Create sample PackageFile objects."""
        return [
            PackageFile(
                logical_key=f"data/file{i:02d}.csv",
                size=1024 * (i + 1),
                catalog_base_url="test.quiltdata.com",
                bucket="test-bucket",
                package_name="benchling/test-entry",
            )
            for i in range(30)
        ]

    def test_file_table_markdown(self, canvas_manager, sample_files):
        """Test file list markdown generation."""
        page_state = PageState(page_number=0, page_size=15, total_items=30)
        page_files = sample_files[:15]

        markdown = canvas_manager._make_file_table_markdown(page_files, page_state)

        assert "## Package Files - Page 1 of 2" in markdown
        assert "benchling/test-entry" in markdown
        # Check for compact single-line format with links at the beginning
        assert "1. [[👁️ view]]" in markdown
        assert "[[🔄 sync]]" in markdown
        assert "**file00.csv**" in markdown
        assert "Showing files 1-15 of 30" in markdown

    def test_file_table_markdown_empty(self, canvas_manager):
        """Test file table with no files."""
        page_state = PageState(page_number=0, page_size=15, total_items=0)

        markdown = canvas_manager._make_file_table_markdown([], page_state)

        assert "Package Files" in markdown
        assert "No files in this package" in markdown

    def test_file_table_markdown_escaping(self, canvas_manager):
        """Test markdown special character handling in filenames."""
        files = [
            PackageFile(
                logical_key="file|with|pipes.csv",
                size=1024,
                catalog_base_url="test.quiltdata.com",
                bucket="test-bucket",
                package_name="benchling/test-entry",
            ),
            PackageFile(
                logical_key="file[with]brackets.csv",
                size=2048,
                catalog_base_url="test.quiltdata.com",
                bucket="test-bucket",
                package_name="benchling/test-entry",
            ),
        ]
        page_state = PageState(page_number=0, page_size=15, total_items=2)

        markdown = canvas_manager._make_file_table_markdown(files, page_state)

        # Verify filenames appear in compact format with links at beginning
        assert "file|with|pipes.csv" in markdown
        assert "file[with]brackets.csv" in markdown
        assert "1. [[👁️ view]]" in markdown
        assert "2. [[👁️ view]]" in markdown
        assert "[[🔄 sync]]" in markdown

    def test_metadata_markdown(self, canvas_manager):
        """Test metadata markdown generation."""
        metadata = {
            "entry_id": "etr_123",
            "name": "Test Entry",
            "description": "Test description",
        }

        markdown = canvas_manager._make_metadata_markdown(metadata)

        assert "## Package Metadata" in markdown
        assert "benchling/test-entry" in markdown
        # Now uses bulleted list format instead of JSON
        assert "- **entry_id**: etr_123" in markdown
        assert "- **name**: Test Entry" in markdown
        assert "- **description**: Test description" in markdown

    def test_navigation_buttons_main(self, canvas_manager):
        """Test navigation buttons for main view."""
        result = canvas_manager._make_navigation_buttons("main")

        # Should return a list with one section containing buttons
        assert len(result) == 1
        section = result[0]
        assert section.id == "button-section-main"

        # Check the buttons within the section
        buttons = section.children
        assert len(buttons) == 2
        assert buttons[0].text == "Browse Package"
        assert buttons[0].id.startswith("browse-files-")
        assert buttons[1].text == "Update Package"

    def test_navigation_buttons_browser(self, canvas_manager):
        """Test navigation buttons for browser view."""
        page_state = PageState(page_number=2, page_size=15, total_items=100)

        result = canvas_manager._make_navigation_buttons("browser", page_state)

        # Should return a list with one section containing buttons
        assert len(result) == 1
        section = result[0]
        buttons = section.children

        assert len(buttons) == 4
        assert buttons[0].text == "← Previous"
        assert buttons[0].enabled is True  # Has previous
        assert buttons[1].text == "Next →"
        assert buttons[1].enabled is True  # Has next
        assert buttons[2].text == "Back to Package"
        assert buttons[3].text == "View Metadata"

    def test_navigation_buttons_browser_first_page(self, canvas_manager):
        """Test navigation buttons on first page."""
        page_state = PageState(page_number=0, page_size=15, total_items=100)

        result = canvas_manager._make_navigation_buttons("browser", page_state)

        # Get buttons from section
        buttons = result[0].children

        # Previous button should be disabled
        prev_button = buttons[0]
        assert prev_button.text == "← Previous"
        assert prev_button.enabled is False

    def test_navigation_buttons_browser_last_page(self, canvas_manager):
        """Test navigation buttons on last page."""
        page_state = PageState(page_number=6, page_size=15, total_items=100)

        result = canvas_manager._make_navigation_buttons("browser", page_state)

        # Get buttons from section
        buttons = result[0].children

        # Next button should be disabled
        next_button = buttons[1]
        assert next_button.text == "Next →"
        assert next_button.enabled is False

    def test_navigation_buttons_metadata(self, canvas_manager):
        """Test navigation buttons for metadata view."""
        page_state = PageState(page_number=2, page_size=15, total_items=0)

        result = canvas_manager._make_navigation_buttons("metadata", page_state)

        # Should return a list with one section containing buttons
        assert len(result) == 1
        section = result[0]
        buttons = section.children

        assert len(buttons) == 2
        assert buttons[0].text == "Back to Browser"
        assert buttons[1].text == "Back to Package"

    def test_navigation_buttons_requires_page_state(self, canvas_manager):
        """Test that browser/metadata contexts require page_state."""
        with pytest.raises(ValueError, match="page_state required"):
            canvas_manager._make_navigation_buttons("browser")

        with pytest.raises(ValueError, match="page_state required"):
            canvas_manager._make_navigation_buttons("metadata")

    def test_browser_response_normal(self, mock_benchling, mock_config, mock_payload, sample_files):
        """Test normal browser response with files."""
        # Create mock file fetcher with proper behavior
        mock_fetcher = Mock()
        mock_fetcher.get_package_files.return_value = sample_files

        # Create canvas manager with mocked file fetcher
        canvas_manager = CanvasManager(mock_benchling, mock_config, mock_payload, package_file_fetcher=mock_fetcher)

        response = canvas_manager.get_package_browser_response(page_number=0, page_size=15)

        assert "blocks" in response
        blocks = response["blocks"]
        assert len(blocks) > 0

        # Check markdown block
        markdown_block = blocks[0]
        assert markdown_block["type"] == "MARKDOWN"
        assert "Package Files" in markdown_block["value"]

        # Check buttons - now inside a section
        section_blocks = [b for b in blocks if b["type"] == "SECTION"]
        assert len(section_blocks) == 1
        button_blocks = section_blocks[0]["children"]
        assert len(button_blocks) == 4  # Previous, Next, Back, Metadata

    def test_browser_response_empty_package(self, mock_benchling, mock_config, mock_payload):
        """Test browser response for empty package."""
        # Create mock file fetcher that returns empty list
        mock_fetcher = Mock()
        mock_fetcher.get_package_files.return_value = []

        # Create canvas manager with mocked file fetcher
        canvas_manager = CanvasManager(mock_benchling, mock_config, mock_payload, package_file_fetcher=mock_fetcher)

        response = canvas_manager.get_package_browser_response()

        blocks = response["blocks"]
        markdown_block = blocks[0]

        assert "Package Is Empty" in markdown_block["value"]
        assert "no files" in markdown_block["value"].lower()

    def test_browser_response_package_not_found(self, mock_benchling, mock_config, mock_payload):
        """Test browser response when package doesn't exist."""
        # Create mock file fetcher that raises "does not exist" error
        mock_fetcher = Mock()
        mock_fetcher.get_package_files.side_effect = Exception("Package does not exist")

        # Create canvas manager with mocked file fetcher
        canvas_manager = CanvasManager(mock_benchling, mock_config, mock_payload, package_file_fetcher=mock_fetcher)

        response = canvas_manager.get_package_browser_response()

        blocks = response["blocks"]
        markdown_block = blocks[0]

        assert "Package Not Created" in markdown_block["value"]
        assert "Update Package" in markdown_block["value"]

        # Check for Update Package button
        button_blocks = [b for b in blocks if b["type"] == "BUTTON"]
        update_button = next(b for b in button_blocks if b["text"] == "Update Package")
        assert update_button is not None

    def test_browser_response_api_error(self, mock_benchling, mock_config, mock_payload):
        """Test browser response for API error."""
        # Create mock file fetcher that raises network error
        mock_fetcher = Mock()
        mock_fetcher.get_package_files.side_effect = Exception("Network error")

        # Create canvas manager with mocked file fetcher
        canvas_manager = CanvasManager(mock_benchling, mock_config, mock_payload, package_file_fetcher=mock_fetcher)

        response = canvas_manager.get_package_browser_response()

        blocks = response["blocks"]
        markdown_block = blocks[0]

        assert "Error Loading Files" in markdown_block["value"]
        assert "Network error" in markdown_block["value"]

        # Check for Retry button
        button_blocks = [b for b in blocks if b["type"] == "BUTTON"]
        retry_button = next(b for b in button_blocks if b["text"] == "Retry")
        assert retry_button is not None

    def test_metadata_response_normal(self, mock_benchling, mock_config, mock_payload):
        """Test normal metadata response."""
        # Create mock file fetcher with metadata
        mock_fetcher = Mock()
        mock_fetcher.get_package_metadata.return_value = {
            "entry_id": "etr_123",
            "name": "Test Entry",
        }

        # Create canvas manager with mocked file fetcher
        canvas_manager = CanvasManager(mock_benchling, mock_config, mock_payload, package_file_fetcher=mock_fetcher)

        response = canvas_manager.get_metadata_response(page_number=2, page_size=15)

        assert "blocks" in response
        blocks = response["blocks"]

        markdown_block = blocks[0]
        assert markdown_block["type"] == "MARKDOWN"
        assert "Package Metadata" in markdown_block["value"]
        assert "etr_123" in markdown_block["value"]

        # Check navigation buttons - now inside a section
        section_blocks = [b for b in blocks if b["type"] == "SECTION"]
        assert len(section_blocks) == 1
        button_blocks = section_blocks[0]["children"]
        assert len(button_blocks) == 2

    def test_metadata_response_error(self, mock_benchling, mock_config, mock_payload):
        """Test metadata response for error."""
        # Create mock file fetcher that raises error
        mock_fetcher = Mock()
        mock_fetcher.get_package_metadata.side_effect = Exception("Failed to fetch metadata")

        # Create canvas manager with mocked file fetcher
        canvas_manager = CanvasManager(mock_benchling, mock_config, mock_payload, package_file_fetcher=mock_fetcher)

        response = canvas_manager.get_metadata_response()

        blocks = response["blocks"]
        markdown_block = blocks[0]

        assert "Error Loading Metadata" in markdown_block["value"]
        assert "Failed to fetch metadata" in markdown_block["value"]

    def test_blocks_to_dict(self, canvas_manager):
        """Test conversion of block objects to dict format."""
        from benchling_api_client.v2.stable.models.button_ui_block_type import ButtonUiBlockType
        from benchling_api_client.v2.stable.models.button_ui_block_update import ButtonUiBlockUpdate
        from benchling_api_client.v2.stable.models.markdown_ui_block_type import MarkdownUiBlockType
        from benchling_api_client.v2.stable.models.markdown_ui_block_update import MarkdownUiBlockUpdate

        blocks = [
            MarkdownUiBlockUpdate(
                type=MarkdownUiBlockType.MARKDOWN,  # type: ignore
                value="Test markdown",  # type: ignore
                id="md1",  # type: ignore
            ),
            ButtonUiBlockUpdate(
                type=ButtonUiBlockType.BUTTON,  # type: ignore
                id="btn1",  # type: ignore
                text="Click me",  # type: ignore
                enabled=True,  # type: ignore
            ),
        ]

        from src.canvas_blocks import blocks_to_dict

        result = blocks_to_dict(blocks)

        assert len(result) == 2
        assert result[0]["type"] == "MARKDOWN"
        assert result[0]["id"] == "md1"
        assert result[0]["value"] == "Test markdown"
        assert result[1]["type"] == "BUTTON"
        assert result[1]["id"] == "btn1"
        assert result[1]["text"] == "Click me"
        assert result[1]["enabled"] is True

    def test_browser_response_pagination(self, mock_benchling, mock_config, mock_payload, sample_files):
        """Test browser response with different pages."""
        # Create mock file fetcher with sample files
        mock_fetcher = Mock()
        mock_fetcher.get_package_files.return_value = sample_files

        # Create canvas manager with mocked file fetcher
        canvas_manager = CanvasManager(mock_benchling, mock_config, mock_payload, package_file_fetcher=mock_fetcher)

        # Page 0
        response = canvas_manager.get_package_browser_response(page_number=0, page_size=10)
        markdown = response["blocks"][0]["value"]
        assert "Page 1 of 3" in markdown

        # Page 1
        response = canvas_manager.get_package_browser_response(page_number=1, page_size=10)
        markdown = response["blocks"][0]["value"]
        assert "Page 2 of 3" in markdown

        # Page 2 (last page)
        response = canvas_manager.get_package_browser_response(page_number=2, page_size=10)
        markdown = response["blocks"][0]["value"]
        assert "Page 3 of 3" in markdown
