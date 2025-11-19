"""Test canvas footer block generation to verify the fix for AttributeError.

This test ensures that format_canvas_footer returns a string that is properly
wrapped in a MarkdownUiBlockUpdate before being added to the blocks list.
"""

from unittest.mock import Mock

import pytest
from benchling_api_client.v2.stable.models.markdown_ui_block_update import MarkdownUiBlockUpdate

from src.canvas import CanvasManager
from src.canvas_formatting import format_canvas_footer
from src.config import Config
from src.payload import Payload


class TestCanvasFooterBlocks:
    """Test that canvas footer is properly formatted as a block."""

    def test_format_canvas_footer_returns_string(self):
        """Verify format_canvas_footer returns a string, not a block."""
        footer = format_canvas_footer(version="0.8.4", quilt_host="test.com", bucket="test-bucket")

        assert isinstance(footer, str)
        assert "Package will be created/updated asynchronously" in footer
        assert "test-bucket@test.com" in footer
        assert "Rev 0.8.4" in footer

    def test_make_blocks_includes_footer_as_markdown_block(self, mock_config, mock_benchling):
        """Verify _make_blocks includes footer as MarkdownUiBlockUpdate."""
        # Mock payload
        mock_payload = Mock(spec=Payload)
        mock_payload.entry_id = "etr_test123"
        mock_payload.canvas_id = "cnvs_test123"
        mock_payload.display_id = "EXP25000088"
        mock_payload.package_name.return_value = "benchling/EXP25000088"

        # Mock entry
        mock_entry = Mock()
        mock_entry.display_id = "EXP25000088"
        mock_entry.id = "etr_test123"
        mock_benchling.entries.get_entry_by_id.return_value = mock_entry

        # Create canvas manager
        canvas_manager = CanvasManager(benchling=mock_benchling, config=mock_config, payload=mock_payload)

        # Generate blocks
        blocks = canvas_manager._make_blocks()

        # Verify all blocks have to_dict method (required for Benchling SDK)
        for i, block in enumerate(blocks):
            assert hasattr(block, "to_dict"), f"Block {i} ({type(block).__name__}) missing to_dict method"

        # Verify last block is the footer markdown block
        last_block = blocks[-1]
        assert isinstance(last_block, MarkdownUiBlockUpdate), f"Last block should be MarkdownUiBlockUpdate, got {type(last_block).__name__}"
        assert last_block.id == "md-footer"

        # Verify footer content
        footer_content = last_block.value
        assert "Package will be created/updated asynchronously" in footer_content
        assert mock_config.s3_bucket_name in footer_content
        assert mock_config.quilt_catalog in footer_content

    def test_blocks_to_dict_does_not_fail(self, mock_config, mock_benchling):
        """Verify blocks can be converted to dict for API calls."""
        from src.canvas_blocks import blocks_to_dict

        # Mock payload
        mock_payload = Mock(spec=Payload)
        mock_payload.entry_id = "etr_test123"
        mock_payload.canvas_id = "cnvs_test123"
        mock_payload.display_id = "EXP25000088"
        mock_payload.package_name.return_value = "benchling/EXP25000088"

        # Mock entry
        mock_entry = Mock()
        mock_entry.display_id = "EXP25000088"
        mock_entry.id = "etr_test123"
        mock_benchling.entries.get_entry_by_id.return_value = mock_entry

        # Create canvas manager
        canvas_manager = CanvasManager(benchling=mock_benchling, config=mock_config, payload=mock_payload)

        # Generate blocks
        blocks = canvas_manager._make_blocks()

        # This would raise AttributeError before the fix
        blocks_dict = blocks_to_dict(blocks)

        # Verify result is a list of dicts
        assert isinstance(blocks_dict, list)
        assert all(isinstance(block, dict) for block in blocks_dict)

        # Verify footer block is in the list
        footer_block_dict = blocks_dict[-1]
        assert footer_block_dict["type"] == "MARKDOWN"
        assert footer_block_dict["id"] == "md-footer"
        assert "Package will be created/updated asynchronously" in footer_block_dict["value"]

    def test_blocks_to_dict_rejects_invalid_blocks(self):
        """Verify blocks_to_dict raises TypeError for invalid block types."""
        from src.canvas_blocks import blocks_to_dict
        import pytest

        # Create a list with an invalid block (string instead of block object)
        invalid_blocks = ["this is a string, not a block"]

        # Should raise TypeError with helpful message
        with pytest.raises(TypeError) as exc_info:
            blocks_to_dict(invalid_blocks)

        assert "does not have a to_dict() method" in str(exc_info.value)
        assert "type: str" in str(exc_info.value)


@pytest.fixture
def mock_config():
    """Create a mock Config for testing."""
    mock = Mock(spec=Config)
    mock.s3_bucket_name = "test-bucket"
    mock.s3_prefix = "benchling"
    mock.quilt_catalog = "test.quiltdata.com"
    mock.quilt_database = "test-athena-db"
    mock.package_key = "experiment_id"
    mock.athena_results_bucket = "athena-results"
    mock.athena_user_workgroup = "test-workgroup"
    mock.region = "us-east-1"
    mock.quilt_role_arn = None
    return mock


@pytest.fixture
def mock_benchling():
    """Create a mock Benchling client for testing."""
    mock = Mock()
    return mock
