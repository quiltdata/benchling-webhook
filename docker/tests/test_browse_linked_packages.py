"""Tests for browse linked packages functionality."""

import pytest

from src.canvas_blocks import create_linked_package_browse_buttons
from src.packages import Package
from src.pagination import decode_package_name, encode_package_name, parse_browse_linked_button_id


class TestPackageNameEncoding:
    """Test package name encoding/decoding for button IDs."""

    def test_encode_simple_package_name(self):
        """Test encoding a simple package name."""
        assert encode_package_name("benchling/experiment-001") == "benchling--experiment-001"

    def test_decode_simple_package_name(self):
        """Test decoding a simple package name."""
        assert decode_package_name("benchling--experiment-001") == "benchling/experiment-001"

    def test_encode_decode_roundtrip(self):
        """Test that encode/decode is reversible."""
        original = "benchling/exp-001"
        encoded = encode_package_name(original)
        decoded = decode_package_name(encoded)
        assert decoded == original

    def test_encode_package_with_dashes(self):
        """Test encoding package name with dashes."""
        # Note: The encoding is simple - just replaces / with --
        # So "exp--001" remains "exp--001" in the encoded form
        assert encode_package_name("benchling/exp--001") == "benchling--exp--001"

    def test_decode_package_with_dashes(self):
        """Test decoding package name with dashes.

        Note: Decoding is lossy if package names contain literal -- in them.
        The decoder replaces all -- with /, so exp----001 becomes exp//001.
        This is a limitation of the simple encoding scheme.
        """
        # This demonstrates the lossy nature of the encoding
        assert decode_package_name("benchling--exp----001") == "benchling/exp//001"

    def test_encode_package_with_underscores(self):
        """Test encoding package name with underscores."""
        assert encode_package_name("benchling/exp_001") == "benchling--exp_001"

    def test_encode_package_with_numbers(self):
        """Test encoding package name with numbers."""
        assert encode_package_name("benchling/experiment-123") == "benchling--experiment-123"

    def test_encode_multiple_slashes(self):
        """Test encoding package name with multiple slashes."""
        assert encode_package_name("benchling/sub/experiment") == "benchling--sub--experiment"

    def test_decode_multiple_double_dashes(self):
        """Test decoding package name with multiple double dashes."""
        assert decode_package_name("benchling--sub--experiment") == "benchling/sub/experiment"

    def test_encode_empty_string(self):
        """Test encoding empty string."""
        assert encode_package_name("") == ""

    def test_decode_empty_string(self):
        """Test decoding empty string."""
        assert decode_package_name("") == ""

    def test_encode_single_slash(self):
        """Test encoding package name with single slash at start."""
        assert encode_package_name("/experiment") == "--experiment"

    def test_encode_trailing_slash(self):
        """Test encoding package name with trailing slash."""
        assert encode_package_name("benchling/") == "benchling--"

    def test_roundtrip_complex_name(self):
        """Test roundtrip with complex package name without double dashes.

        Note: Package names with literal -- are not roundtrip-safe
        due to the simple encoding scheme.
        """
        original = "benchling/sub/exp_test_001"
        encoded = encode_package_name(original)
        decoded = decode_package_name(encoded)
        assert decoded == original
        assert encoded == "benchling--sub--exp_test_001"


class TestBrowseLinkedButtonIdParsing:
    """Test parsing of browse-linked button IDs."""

    def test_parse_standard_button_id(self):
        """Test parsing a standard browse-linked button ID."""
        button_id = "browse-linked-etr_abc123-pkg-benchling--exp-001-p0-s15"
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        assert entry_id == "etr_abc123"
        assert package_name == "benchling/exp-001"
        assert page == 0
        assert size == 15

    def test_parse_button_with_dashes_in_package(self):
        """Test parsing button ID with dashes in package name.

        Note: Due to the simple encoding scheme, package names with literal --
        in them will be decoded to / characters. This is a known limitation.
        """
        button_id = "browse-linked-etr_123-pkg-benchling--exp----001-p1-s20"
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        assert entry_id == "etr_123"
        # Double dash in encoded form becomes / in decoded form
        assert package_name == "benchling/exp//001"
        assert page == 1
        assert size == 20

    def test_parse_button_with_multiple_slashes(self):
        """Test parsing button ID with multiple slashes in package name."""
        button_id = "browse-linked-etr_xyz-pkg-foo--bar--baz-p2-s10"
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        assert entry_id == "etr_xyz"
        assert package_name == "foo/bar/baz"
        assert page == 2
        assert size == 10

    def test_parse_button_different_entry_prefixes(self):
        """Test parsing button IDs with different entry prefixes."""
        # Test with plt_ prefix
        button_id = "browse-linked-plt_123-pkg-test--pkg-p0-s15"
        entry_id, _, _, _ = parse_browse_linked_button_id(button_id)
        assert entry_id == "plt_123"

        # Test with seq_ prefix
        button_id = "browse-linked-seq_456-pkg-test--pkg-p0-s15"
        entry_id, _, _, _ = parse_browse_linked_button_id(button_id)
        assert entry_id == "seq_456"

        # Test with dna_ prefix
        button_id = "browse-linked-dna_789-pkg-test--pkg-p0-s15"
        entry_id, _, _, _ = parse_browse_linked_button_id(button_id)
        assert entry_id == "dna_789"

    def test_parse_button_with_underscores_in_package(self):
        """Test parsing button ID with underscores in package name."""
        button_id = "browse-linked-etr_123-pkg-benchling--exp_test_001-p0-s15"
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        assert entry_id == "etr_123"
        assert package_name == "benchling/exp_test_001"
        assert page == 0
        assert size == 15

    def test_parse_button_large_page_numbers(self):
        """Test parsing button ID with large page numbers."""
        button_id = "browse-linked-etr_abc-pkg-test--pkg-p9999-s100"
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        assert entry_id == "etr_abc"
        assert package_name == "test/pkg"
        assert page == 9999
        assert size == 100

    def test_parse_invalid_button_id_no_prefix(self):
        """Test parsing invalid button ID without browse-linked prefix."""
        with pytest.raises(ValueError, match="Invalid browse-linked button ID"):
            parse_browse_linked_button_id("invalid-button-id")

    def test_parse_invalid_button_id_wrong_prefix(self):
        """Test parsing invalid button ID with wrong prefix."""
        with pytest.raises(ValueError, match="Invalid browse-linked button ID"):
            parse_browse_linked_button_id("browse-files-etr_123-pkg-test--pkg-p0-s15")

    def test_parse_invalid_button_id_no_pkg_separator(self):
        """Test parsing invalid button ID without -pkg- separator."""
        with pytest.raises(ValueError, match="(Invalid browse-linked button ID|Missing '-pkg-' separator)"):
            parse_browse_linked_button_id("browse-linked-etr_123-benchling--exp-p0-s15")

    def test_parse_invalid_button_id_no_page(self):
        """Test parsing invalid button ID without page separator."""
        with pytest.raises(ValueError, match="Missing '-p' separator"):
            parse_browse_linked_button_id("browse-linked-etr_123-pkg-benchling--exp")

    def test_parse_invalid_button_id_no_size(self):
        """Test parsing invalid button ID without size separator."""
        with pytest.raises(ValueError, match="Missing '-s' separator"):
            parse_browse_linked_button_id("browse-linked-etr_123-pkg-benchling--exp-p0")

    def test_parse_invalid_button_id_bad_page_number(self):
        """Test parsing invalid button ID with non-numeric page."""
        with pytest.raises(ValueError, match="Invalid page/size"):
            parse_browse_linked_button_id("browse-linked-etr_123-pkg-test--pkg-pabc-s15")

    def test_parse_invalid_button_id_bad_size_number(self):
        """Test parsing invalid button ID with non-numeric size."""
        with pytest.raises(ValueError, match="Invalid page/size"):
            parse_browse_linked_button_id("browse-linked-etr_123-pkg-test--pkg-p0-sxyz")

    def test_parse_invalid_button_id_negative_page(self):
        """Test parsing button ID with negative page number.

        Note: The current parser doesn't validate negative numbers,
        it just parses them. This test documents current behavior.
        """
        # The parser successfully parses negative numbers
        button_id = "browse-linked-etr_123-pkg-test--pkg-p-1-s15"
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        assert entry_id == "etr_123"
        assert package_name == "test/pkg"
        assert page == -1  # Negative page is parsed but may be invalid
        assert size == 15

    def test_parse_invalid_button_id_zero_size(self):
        """Test parsing button ID with zero size."""
        # Parser should successfully parse and return 0
        button_id = "browse-linked-etr_123-pkg-test--pkg-p0-s0"
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        assert entry_id == "etr_123"
        assert package_name == "test/pkg"
        assert page == 0
        assert size == 0

    def test_parse_button_id_empty_package_name(self):
        """Test parsing button ID with empty encoded package name.

        When the package name between -pkg- and -p is empty,
        decoding results in an empty string, not a slash.
        """
        button_id = "browse-linked-etr_123-pkg--p0-s15"
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        assert entry_id == "etr_123"
        assert package_name == ""  # Empty string, not "/"
        assert page == 0
        assert size == 15

    def test_parse_next_page_linked_button_id(self):
        """Test parsing next-page-linked button ID."""
        button_id = "next-page-linked-etr_abc123-pkg-benchling--exp-001-p1-s15"
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        assert entry_id == "etr_abc123"
        assert package_name == "benchling/exp-001"
        assert page == 1
        assert size == 15

    def test_parse_prev_page_linked_button_id(self):
        """Test parsing prev-page-linked button ID."""
        button_id = "prev-page-linked-etr_xyz-pkg-foo--bar--baz-p0-s20"
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        assert entry_id == "etr_xyz"
        assert package_name == "foo/bar/baz"
        assert page == 0
        assert size == 20

    def test_parse_view_metadata_linked_button_id(self):
        """Test parsing view-metadata-linked button ID."""
        button_id = "view-metadata-linked-plt_123-pkg-test--package-p2-s10"
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        assert entry_id == "plt_123"
        assert package_name == "test/package"
        assert page == 2
        assert size == 10


class TestLinkedPackageBrowseButtons:
    """Test creation of linked package browse buttons."""

    def test_create_buttons_empty_list(self):
        """Test that empty package list returns empty button list."""
        buttons = create_linked_package_browse_buttons("etr_123", [])
        assert buttons == []

    def test_create_buttons_single_package(self):
        """Test creating browse buttons for single package."""
        pkg = Package(
            catalog_base_url="https://example.com",
            bucket="test-bucket",
            package_name="benchling/exp-001",
        )

        result = create_linked_package_browse_buttons("etr_123", [pkg])

        # Should return list with one section
        assert len(result) == 1
        assert result[0].type == "SECTION"
        assert result[0].id == "button-section-linked-packages"

        # Section should contain one button
        buttons = result[0].children
        assert len(buttons) == 1
        assert buttons[0].type == "BUTTON"
        assert buttons[0].text == "benchling/exp-001"
        assert buttons[0].id == "browse-linked-etr_123-pkg-benchling--exp-001-p0-s15"
        assert buttons[0].enabled is True

    def test_create_buttons_multiple_packages(self):
        """Test creating browse buttons for multiple packages."""
        packages = [
            Package("https://example.com", "test-bucket", "benchling/exp-001"),
            Package("https://example.com", "test-bucket", "benchling/exp-002"),
            Package("https://example.com", "test-bucket", "benchling/exp-003"),
        ]

        result = create_linked_package_browse_buttons("etr_abc", packages)

        # Should return list with one section
        assert len(result) == 1
        assert result[0].type == "SECTION"

        # Section should contain three buttons
        buttons = result[0].children
        assert len(buttons) == 3

        # Check button IDs
        assert buttons[0].id == "browse-linked-etr_abc-pkg-benchling--exp-001-p0-s15"
        assert buttons[1].id == "browse-linked-etr_abc-pkg-benchling--exp-002-p0-s15"
        assert buttons[2].id == "browse-linked-etr_abc-pkg-benchling--exp-003-p0-s15"

        # All buttons should be enabled
        assert all(btn.enabled is True for btn in buttons)

    def test_create_buttons_package_with_special_chars(self):
        """Test creating buttons for package with special characters in name.

        Note: The encoding simply replaces / with --, so package names
        with literal -- remain as-is in the encoding.
        """
        pkg = Package(
            catalog_base_url="https://example.com",
            bucket="test-bucket",
            package_name="benchling/exp--test_001",
        )

        result = create_linked_package_browse_buttons("etr_xyz", [pkg])

        buttons = result[0].children
        # exp--test_001 remains as exp--test_001 in encoding
        assert buttons[0].id == "browse-linked-etr_xyz-pkg-benchling--exp--test_001-p0-s15"

    def test_create_buttons_default_pagination(self):
        """Test that buttons use default pagination (page 0, size 15)."""
        pkg = Package("https://example.com", "test-bucket", "test/package")
        result = create_linked_package_browse_buttons("etr_123", [pkg])

        button_id = result[0].children[0].id
        assert button_id.endswith("-p0-s15")

    def test_create_buttons_multiple_slashes_in_package(self):
        """Test creating buttons for package with multiple slashes."""
        pkg = Package(
            catalog_base_url="https://example.com",
            bucket="test-bucket",
            package_name="benchling/sub/dir/experiment",
        )

        result = create_linked_package_browse_buttons("etr_999", [pkg])

        buttons = result[0].children
        assert buttons[0].id == "browse-linked-etr_999-pkg-benchling--sub--dir--experiment-p0-s15"

    def test_create_buttons_different_entry_types(self):
        """Test creating buttons for different entry type prefixes."""
        pkg = Package("https://example.com", "test-bucket", "test/pkg")

        # Test with plt_ entry
        result = create_linked_package_browse_buttons("plt_123", [pkg])
        assert result[0].children[0].id == "browse-linked-plt_123-pkg-test--pkg-p0-s15"

        # Test with seq_ entry
        result = create_linked_package_browse_buttons("seq_456", [pkg])
        assert result[0].children[0].id == "browse-linked-seq_456-pkg-test--pkg-p0-s15"

        # Test with dna_ entry
        result = create_linked_package_browse_buttons("dna_789", [pkg])
        assert result[0].children[0].id == "browse-linked-dna_789-pkg-test--pkg-p0-s15"

    def test_create_buttons_many_packages(self):
        """Test creating buttons for many packages."""
        packages = [Package("https://example.com", "bucket", f"benchling/exp-{i:03d}") for i in range(20)]

        result = create_linked_package_browse_buttons("etr_test", packages)

        # Should still be one section with all buttons
        assert len(result) == 1
        assert len(result[0].children) == 20

        # Verify all button IDs are unique
        button_ids = [btn.id for btn in result[0].children]
        assert len(button_ids) == len(set(button_ids))

    def test_create_buttons_preserves_package_order(self):
        """Test that button order matches package order."""
        packages = [
            Package("https://example.com", "bucket", "benchling/z-last"),
            Package("https://example.com", "bucket", "benchling/a-first"),
            Package("https://example.com", "bucket", "benchling/m-middle"),
        ]

        result = create_linked_package_browse_buttons("etr_order", packages)
        buttons = result[0].children

        # Order should match input, not alphabetical
        assert buttons[0].id == "browse-linked-etr_order-pkg-benchling--z-last-p0-s15"
        assert buttons[1].id == "browse-linked-etr_order-pkg-benchling--a-first-p0-s15"
        assert buttons[2].id == "browse-linked-etr_order-pkg-benchling--m-middle-p0-s15"

    def test_create_buttons_section_structure(self):
        """Test that section has correct structure."""
        pkg = Package("https://example.com", "bucket", "test/pkg")
        result = create_linked_package_browse_buttons("etr_123", [pkg])

        section = result[0]
        assert section.type == "SECTION"
        assert section.id == "button-section-linked-packages"
        assert hasattr(section, "children")
        assert isinstance(section.children, list)

    def test_create_buttons_button_properties(self):
        """Test that buttons have all required properties."""
        pkg = Package("https://example.com", "bucket", "test/pkg")
        result = create_linked_package_browse_buttons("etr_123", [pkg])

        button = result[0].children[0]
        assert hasattr(button, "type")
        assert hasattr(button, "id")
        assert hasattr(button, "text")
        assert hasattr(button, "enabled")
        assert button.type == "BUTTON"


class TestRoundtripIntegration:
    """Integration tests for encoding/parsing roundtrip."""

    def test_roundtrip_button_creation_and_parsing(self):
        """Test creating button and parsing it back."""
        # Create button
        pkg = Package("https://example.com", "bucket", "benchling/exp-001")
        result = create_linked_package_browse_buttons("etr_abc123", [pkg])
        button_id = result[0].children[0].id

        # Parse button ID
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        # Verify roundtrip
        assert entry_id == "etr_abc123"
        assert package_name == "benchling/exp-001"
        assert page == 0
        assert size == 15

    def test_roundtrip_complex_package_name(self):
        """Test roundtrip with complex package name.

        Note: Package names without literal -- are roundtrip-safe.
        """
        # Create button with complex package name (no literal --)
        pkg = Package("https://example.com", "bucket", "benchling/sub/exp_test_001")
        result = create_linked_package_browse_buttons("plt_xyz", [pkg])
        button_id = result[0].children[0].id

        # Parse button ID
        entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

        # Verify roundtrip
        assert entry_id == "plt_xyz"
        assert package_name == "benchling/sub/exp_test_001"
        assert page == 0
        assert size == 15

    def test_roundtrip_all_entry_types(self):
        """Test roundtrip with all supported entry types."""
        pkg = Package("https://example.com", "bucket", "test/package")
        entry_ids = ["etr_123", "plt_456", "seq_789", "dna_abc", "aa_def", "rna_ghi"]

        for entry_id in entry_ids:
            # Create and parse
            result = create_linked_package_browse_buttons(entry_id, [pkg])
            button_id = result[0].children[0].id
            parsed_entry_id, package_name, page, size = parse_browse_linked_button_id(button_id)

            # Verify roundtrip
            assert parsed_entry_id == entry_id
            assert package_name == "test/package"
            assert page == 0
            assert size == 15
