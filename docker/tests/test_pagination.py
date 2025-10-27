"""Tests for pagination module."""

import pytest

from src.pagination import PageState, paginate_items, parse_button_id


class TestPageState:
    """Tests for PageState dataclass."""

    def test_page_state_properties(self):
        """Test PageState basic properties."""
        state = PageState(page_number=2, page_size=15, total_items=100)

        assert state.page_number == 2
        assert state.page_size == 15
        assert state.total_items == 100
        assert state.total_pages == 7  # ceil(100/15) = 7
        assert state.has_next is True
        assert state.has_previous is True

    def test_page_state_first_page(self):
        """Test PageState for first page."""
        state = PageState(page_number=0, page_size=15, total_items=100)

        assert state.has_previous is False
        assert state.has_next is True

    def test_page_state_last_page(self):
        """Test PageState for last page."""
        state = PageState(page_number=6, page_size=15, total_items=100)

        assert state.has_previous is True
        assert state.has_next is False

    def test_page_state_indices(self):
        """Test start_index, end_index, items_on_page."""
        # First page
        state = PageState(page_number=0, page_size=15, total_items=100)
        assert state.start_index == 0
        assert state.end_index == 15
        assert state.items_on_page == 15

        # Middle page
        state = PageState(page_number=3, page_size=15, total_items=100)
        assert state.start_index == 45
        assert state.end_index == 60
        assert state.items_on_page == 15

        # Last page (partial)
        state = PageState(page_number=6, page_size=15, total_items=100)
        assert state.start_index == 90
        assert state.end_index == 100
        assert state.items_on_page == 10

    def test_page_state_empty(self):
        """Test PageState with zero items."""
        state = PageState(page_number=0, page_size=15, total_items=0)

        assert state.total_pages == 0
        assert state.has_next is False
        assert state.has_previous is False
        assert state.start_index == 0
        assert state.end_index == 0
        assert state.items_on_page == 0

    def test_page_state_validation(self):
        """Test PageState validation."""
        # Negative page number
        with pytest.raises(ValueError, match="page_number must be >= 0"):
            PageState(page_number=-1, page_size=15, total_items=100)

        # Invalid page size
        with pytest.raises(ValueError, match="page_size must be >= 1"):
            PageState(page_number=0, page_size=0, total_items=100)

        # Negative total items
        with pytest.raises(ValueError, match="total_items must be >= 0"):
            PageState(page_number=0, page_size=15, total_items=-1)

    def test_page_state_to_button_suffix(self):
        """Test encoding pagination state to button suffix."""
        state = PageState(page_number=3, page_size=15, total_items=100)

        suffix = state.to_button_suffix()
        assert suffix == "p3-s15"

    def test_page_state_from_button_suffix(self):
        """Test decoding button suffix to PageState."""
        state = PageState.from_button_suffix("p3-s15", total_items=100)

        assert state.page_number == 3
        assert state.page_size == 15
        assert state.total_items == 100

    def test_page_state_from_button_suffix_invalid(self):
        """Test error handling for invalid button suffix."""
        with pytest.raises(ValueError, match="Invalid pagination suffix"):
            PageState.from_button_suffix("invalid", total_items=100)

        with pytest.raises(ValueError, match="Invalid pagination suffix"):
            PageState.from_button_suffix("p3", total_items=100)

    def test_page_state_clamp_page(self):
        """Test clamping page number to valid range."""
        # Page number too high
        state = PageState(page_number=10, page_size=15, total_items=100)
        clamped = state.clamp_page()

        assert clamped.page_number == 6  # Max valid page for 100 items
        assert clamped.page_size == 15
        assert clamped.total_items == 100

        # Page number negative (should be clamped to 0)
        state = PageState(page_number=0, page_size=15, total_items=100)
        clamped = state.clamp_page()
        assert clamped.page_number == 0

        # Empty list (0 items)
        state = PageState(page_number=5, page_size=15, total_items=0)
        clamped = state.clamp_page()
        assert clamped.page_number == 0


class TestPaginateItems:
    """Tests for paginate_items function."""

    def test_paginate_items_first_page(self):
        """Test paginating first page."""
        items = list(range(100))  # 0-99

        page_items, page_state = paginate_items(items, page_number=0, page_size=15)

        assert len(page_items) == 15
        assert page_items[0] == 0
        assert page_items[-1] == 14
        assert page_state.page_number == 0
        assert page_state.total_pages == 7

    def test_paginate_items_middle_page(self):
        """Test paginating middle page."""
        items = list(range(100))

        page_items, page_state = paginate_items(items, page_number=3, page_size=15)

        assert len(page_items) == 15
        assert page_items[0] == 45  # 3 * 15
        assert page_items[-1] == 59
        assert page_state.page_number == 3

    def test_paginate_items_last_page(self):
        """Test paginating last page (partial)."""
        items = list(range(100))

        page_items, page_state = paginate_items(items, page_number=6, page_size=15)

        assert len(page_items) == 10  # 100 - 90 = 10 items
        assert page_items[0] == 90
        assert page_items[-1] == 99
        assert page_state.page_number == 6
        assert page_state.has_next is False

    def test_paginate_items_empty_list(self):
        """Test paginating empty list."""
        items = []

        page_items, page_state = paginate_items(items, page_number=0, page_size=15)

        assert len(page_items) == 0
        assert page_state.total_pages == 0
        assert page_state.page_number == 0

    def test_paginate_items_clamping(self):
        """Test automatic page clamping."""
        items = list(range(30))

        # Request page beyond last page
        page_items, page_state = paginate_items(items, page_number=10, page_size=15)

        # Should clamp to last valid page (page 1, since 30 items / 15 = 2 pages)
        assert page_state.page_number == 1
        assert len(page_items) == 15
        assert page_items[0] == 15

    def test_paginate_items_exact_page_size(self):
        """Test when total items exactly equals page size."""
        items = list(range(15))

        page_items, page_state = paginate_items(items, page_number=0, page_size=15)

        assert len(page_items) == 15
        assert page_state.total_pages == 1
        assert page_state.has_next is False


class TestParseButtonId:
    """Tests for parse_button_id function."""

    def test_parse_button_id_with_pagination(self):
        """Test parsing button ID with pagination."""
        button_id = "browse-files-etr_abc123-p2-s15"

        action, entry_id, page_state = parse_button_id(button_id)

        assert action == "browse-files"
        assert entry_id == "etr_abc123"
        assert page_state is not None
        assert page_state.page_number == 2
        assert page_state.page_size == 15

    def test_parse_button_id_without_pagination(self):
        """Test parsing button ID without pagination."""
        button_id = "update-package-etr_abc123"

        action, entry_id, page_state = parse_button_id(button_id)

        assert action == "update-package"
        assert entry_id == "etr_abc123"
        assert page_state is None

    def test_parse_button_id_complex_action(self):
        """Test parsing button ID with multi-part action."""
        button_id = "next-page-etr_xyz789-p5-s20"

        action, entry_id, page_state = parse_button_id(button_id)

        assert action == "next-page"
        assert entry_id == "etr_xyz789"
        assert page_state.page_number == 5
        assert page_state.page_size == 20

    def test_parse_button_id_different_entry_types(self):
        """Test parsing button IDs with different entry type prefixes."""
        # Plate entry
        action, entry_id, page_state = parse_button_id("browse-files-plt_123-p0-s15")
        assert entry_id == "plt_123"

        # Sequence entry
        action, entry_id, page_state = parse_button_id("browse-files-seq_456-p0-s15")
        assert entry_id == "seq_456"

        # DNA sequence
        action, entry_id, page_state = parse_button_id("browse-files-dna_789-p0-s15")
        assert entry_id == "dna_789"

    def test_parse_button_id_invalid_format(self):
        """Test error handling for invalid button ID."""
        with pytest.raises(ValueError, match="Invalid button ID format"):
            parse_button_id("invalid")

    def test_parse_button_id_no_entry_id(self):
        """Test error handling when no entry ID found."""
        with pytest.raises(ValueError, match="No entry_id found"):
            parse_button_id("browse-files-invalid")

    def test_parse_button_id_back_to_package(self):
        """Test parsing back-to-package button."""
        button_id = "back-to-package-etr_abc123"

        action, entry_id, page_state = parse_button_id(button_id)

        assert action == "back-to-package"
        assert entry_id == "etr_abc123"
        assert page_state is None

    def test_parse_button_id_view_metadata(self):
        """Test parsing view-metadata button with preserved pagination."""
        button_id = "view-metadata-etr_abc123-p3-s15"

        action, entry_id, page_state = parse_button_id(button_id)

        assert action == "view-metadata"
        assert entry_id == "etr_abc123"
        assert page_state.page_number == 3
        assert page_state.page_size == 15
