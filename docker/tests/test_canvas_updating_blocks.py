"""Test the initial 'Updating...' canvas state.

The initial canvas shown to the user (before the background workflow runs)
should have the SAME layout as the final canvas — main nav buttons, a primary
package header, and the footer — but with an 'Updating...' status instead of
an 'Updated at' timestamp. Linked-package lookups are skipped so this stays
fast enough to run on the request thread.

These tests also print the generated blocks (as dicts) to stdout so the UX
can be eyeballed without a live Benchling canvas. Run with ``-s`` to see output:

    pytest docker/tests/test_canvas_updating_blocks.py -s
"""

import json
from unittest.mock import Mock

import pytest
from benchling_api_client.v2.stable.models.markdown_ui_block_update import MarkdownUiBlockUpdate
from benchling_api_client.v2.stable.models.section_ui_block_update import SectionUiBlockUpdate

from src.canvas import CanvasManager
from src.canvas_blocks import blocks_to_dict
from src.canvas_formatting import format_canvas_footer
from src.config import Config
from src.payload import Payload


@pytest.fixture
def mock_config():
    config = Mock(spec=Config)
    config.s3_bucket_name = "test-bucket"
    config.s3_prefix = "benchling"
    config.quilt_catalog = "test.quiltdata.com"
    config.quilt_database = "test-athena-db"
    config.package_key = "experiment_id"
    config.athena_user_workgroup = "test-workgroup"
    config.aws_region = "us-east-1"
    config.quilt_write_role_arn = None
    return config


@pytest.fixture
def mock_payload():
    payload = Mock(spec=Payload)
    payload.entry_id = "etr_test123"
    payload.canvas_id = "cnvs_test456"
    payload.display_id = "EXP25000088"
    payload.package_name.return_value = "benchling/EXP25000088"
    payload.set_display_id = Mock()
    return payload


@pytest.fixture
def mock_benchling():
    mock = Mock()
    mock_entry = Mock()
    mock_entry.id = "etr_test123"
    mock_entry.display_id = "EXP25000088"
    mock.entries.get_entry_by_id.return_value = mock_entry
    return mock


@pytest.fixture
def canvas_manager(mock_benchling, mock_config, mock_payload):
    return CanvasManager(benchling=mock_benchling, config=mock_config, payload=mock_payload)


def _dump_blocks(label: str, block_dicts: list) -> None:
    """Pretty-print a set of blocks so the UX can be eyeballed."""
    print(f"\n================ {label} ================")
    print(json.dumps(block_dicts, indent=2, default=str))
    print("=" * (len(label) + 34))


class TestUpdatingCanvasBlocks:
    """The initial canvas uses the same layout as the final view, with an 'Updating...' footer."""

    def test_footer_shows_updating_when_flag_set(self):
        footer = format_canvas_footer(
            version="0.17.1",
            quilt_host="test.com",
            bucket="test-bucket",
            is_updating=True,
        )
        assert "Updating..." in footer
        assert "Updated at" not in footer
        assert "Pending update" not in footer

    def test_footer_updating_overrides_updated_at(self):
        """If both are set, 'Updating...' wins — this is an in-progress state."""
        footer = format_canvas_footer(
            version="0.17.1",
            quilt_host="test.com",
            bucket="test-bucket",
            updated_at="2026-04-15 12:00 UTC",
            is_updating=True,
        )
        assert "Updating..." in footer
        assert "Updated at" not in footer

    def test_update_button_disabled_while_updating(self, canvas_manager):
        """During the 'Updating...' phase, the Update Package button must be
        disabled so a second click cannot spawn a concurrent export workflow.
        Browse Package stays enabled — on a re-export the previous package
        version is still valid."""
        updating = canvas_manager._make_blocks(is_updating=True)

        # The first block is the main-nav section with two buttons: [Browse, Update]
        nav_section = updating[0]
        browse_btn, update_btn = nav_section.children

        assert browse_btn.text == "Browse Package"
        assert browse_btn.enabled is True, "Browse stays enabled during updating"

        assert update_btn.text == "Update Package"
        assert update_btn.enabled is False, "Update is disabled during updating"

    def test_update_button_reenabled_on_final_canvas(self, canvas_manager):
        """When the background workflow delivers the real update, both buttons
        must be re-enabled."""
        canvas_manager._linked_packages = []
        canvas_manager._errors = []
        canvas_manager._package_query = Mock()
        canvas_manager._package_query.find_unique_packages.return_value = {"packages": []}

        final = canvas_manager._make_blocks(updated_at="2026-04-15 12:00 UTC")
        browse_btn, update_btn = final[0].children

        assert browse_btn.enabled is True
        assert update_btn.enabled is True, "Update is re-enabled once updated_at is set"

    def test_updating_blocks_match_regular_layout(self, canvas_manager):
        """The 'Updating...' canvas has the same block types in the same order
        as the final canvas: main-nav section → package header markdown → footer markdown.
        """
        updating = canvas_manager._make_blocks(is_updating=True)

        # Reset linked_packages cache so the "final" view is comparable
        canvas_manager._linked_packages = []
        canvas_manager._errors = []

        # Types in order
        assert isinstance(updating[0], SectionUiBlockUpdate), "first block is the main-nav button section"
        assert isinstance(updating[1], MarkdownUiBlockUpdate), "second block is the package header"
        assert updating[1].id == "md1"
        assert isinstance(updating[-1], MarkdownUiBlockUpdate), "last block is the footer"
        assert updating[-1].id == "md-footer"

        # Footer shows the Updating state
        assert "Updating..." in updating[-1].value
        assert "Updated at" not in updating[-1].value

        # Package header includes the display id and package name
        assert "EXP25000088" in updating[1].value
        assert "benchling/EXP25000088" in updating[1].value

    def test_updating_blocks_skip_linked_packages_query(self, canvas_manager):
        """The initial update must NOT run the Athena linked-packages query —
        that's slow and the data will be refreshed by the background workflow."""
        # If the query were run, this mock would be hit. It isn't injected, so the
        # test would blow up on the real PackageQuery construction. Instead we
        # assert that the method does not touch _package_query at all.
        canvas_manager._package_query = Mock()
        canvas_manager._package_query.find_unique_packages.side_effect = AssertionError(
            "find_unique_packages must not be called during an 'Updating...' render"
        )

        # Should not raise
        canvas_manager._make_blocks(is_updating=True)
        canvas_manager._package_query.find_unique_packages.assert_not_called()

    def test_print_updating_blocks_for_visual_review(self, canvas_manager, capsys):
        """Print the generated blocks so the user can eyeball the UX without
        a live Benchling canvas. Run with ``pytest -s`` to see the output."""
        updating_blocks = canvas_manager._make_blocks(is_updating=True)
        updating_dicts = blocks_to_dict(updating_blocks)

        _dump_blocks("INITIAL 'Updating...' CANVAS", updating_dicts)

        # Also render a simulated "final" canvas for side-by-side comparison
        canvas_manager._linked_packages = []
        canvas_manager._errors = []
        canvas_manager._package_query = Mock()
        canvas_manager._package_query.find_unique_packages.return_value = {"packages": []}

        final_blocks = canvas_manager._make_blocks(updated_at="2026-04-15 12:00 UTC")
        final_dicts = blocks_to_dict(final_blocks)
        _dump_blocks("FINAL 'Updated at ...' CANVAS", final_dicts)

        # Sanity: capsys is available so the test framework actually captured output
        captured = capsys.readouterr()
        assert "INITIAL 'Updating...' CANVAS" in captured.out
        assert "FINAL 'Updated at ...' CANVAS" in captured.out
        assert "Updating..." in captured.out
        assert "Updated at 2026-04-15 12:00 UTC" in captured.out
