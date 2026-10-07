"""Tests for canvas_formatting module."""

from src.canvas_formatting import (
    dict_to_markdown_list,
    escape_markdown,
    format_crate_roles,
    format_linked_packages,
    format_package_header,
    linkify_urls,
)
from src.packages import Package


class TestLinkifyUrls:
    """Test suite for linkify_urls function."""

    def test_linkify_single_url(self):
        """Test linkifying a single URL in text."""
        text = "Check https://example.com for more info"
        expected = "Check [https://example.com](https://example.com) for more info"
        assert linkify_urls(text) == expected

    def test_linkify_multiple_urls(self):
        """Test linkifying multiple URLs in text."""
        text = "Visit https://example.com or http://test.org"
        expected = "Visit [https://example.com](https://example.com) or [http://test.org](http://test.org)"
        assert linkify_urls(text) == expected

    def test_linkify_url_with_path(self):
        """Test linkifying URL with path."""
        text = "See https://example.com/path/to/resource"
        expected = "See [https://example.com/path/to/resource](https://example.com/path/to/resource)"
        assert linkify_urls(text) == expected

    def test_linkify_url_with_query_params(self):
        """Test linkifying URL with query parameters."""
        text = "Check https://example.com?param=value&other=123"
        expected = "Check [https://example.com?param=value&other=123](https://example.com?param=value&other=123)"
        assert linkify_urls(text) == expected

    def test_linkify_no_urls(self):
        """Test text without URLs remains unchanged."""
        text = "This is plain text without any URLs"
        assert linkify_urls(text) == text

    def test_linkify_already_linked_url(self):
        """Test that already linked URLs are not double-linkified."""
        text = "[https://example.com](https://example.com)"
        # URL is already in markdown link format, should not be changed
        assert linkify_urls(text) == text

    def test_linkify_url_at_start(self):
        """Test linkifying URL at the start of text."""
        text = "https://example.com is a website"
        expected = "[https://example.com](https://example.com) is a website"
        assert linkify_urls(text) == expected

    def test_linkify_url_at_end(self):
        """Test linkifying URL at the end of text."""
        text = "Visit https://example.com"
        expected = "Visit [https://example.com](https://example.com)"
        assert linkify_urls(text) == expected


class TestFormatPackageHeader:
    """Test suite for format_package_header function."""

    def test_format_package_header_with_display_id(self):
        """Test that display_id is used as the heading."""
        result = format_package_header(
            package_name="benchling/etr_123",
            display_id="EXP-001",
            catalog_url="https://catalog.com/package",
            sync_url="https://catalog.com/sync",
        )

        # Display ID should be the heading
        assert "## EXP-001" in result
        # Package name should be in the details
        assert "benchling/etr_123" in result
        # URLs should be present
        assert "https://catalog.com/package" in result
        assert "https://catalog.com/sync" in result


class TestDictToMarkdownList:
    """Test suite for dict_to_markdown_list function."""

    def test_simple_dict(self):
        """Test converting a simple dictionary."""
        data = {"key1": "value1", "key2": "value2"}
        result = dict_to_markdown_list(data)
        assert "- **key1**: value1" in result
        assert "- **key2**: value2" in result

    def test_list_with_indices(self):
        """Test that lists get numbered indices."""
        data = {"items": ["first", "second", "third"]}
        result = dict_to_markdown_list(data)
        assert "- **items**:" in result
        assert "1. first" in result
        assert "2. second" in result
        assert "3. third" in result

    def test_list_of_dicts_with_indices(self):
        """Test that lists of dicts get numbered indices."""
        data = {"files": [{"name": "file1.txt", "size": 100}, {"name": "file2.txt", "size": 200}]}
        result = dict_to_markdown_list(data)
        assert "- **files**:" in result
        assert "1." in result
        assert "2." in result
        assert "**name**: file1.txt" in result
        assert "**name**: file2.txt" in result

    def test_nested_dict(self):
        """Test converting nested dictionary."""
        data = {"outer": {"inner": "value"}}
        result = dict_to_markdown_list(data)
        assert "- **outer**:" in result
        assert "**inner**: value" in result

    def test_url_linkification_in_values(self):
        """Test that URLs in string values are linkified."""
        data = {"web_url": "https://example.com/entry/123"}
        result = dict_to_markdown_list(data)
        assert "[https://example.com/entry/123](https://example.com/entry/123)" in result

    def test_null_value(self):
        """Test that null values are formatted correctly."""
        data = {"key": None}
        result = dict_to_markdown_list(data)
        assert "- **key**: *null*" in result

    def test_boolean_values(self):
        """Test that boolean values are formatted as lowercase."""
        data = {"flag1": True, "flag2": False}
        result = dict_to_markdown_list(data)
        assert "- **flag1**: true" in result
        assert "- **flag2**: false" in result


# Package metadata as the Quilt RO-Crate profile projects it (#401).
CRATE_META = {
    "package_name": "lab/crate",
    "creator": ["Jane Doe"],
    "producer": ["Assay Development", "Laboratory Operations"],
    "instrument": ["Plate Reader 1"],
    "instrument_id": ["INST-000456"],
    "eln_entry": ["EXP25000017"],
}


class TestFormatLinkedPackages:
    """Test suite for format_linked_packages function."""

    def test_empty_list(self):
        assert format_linked_packages([]) == ""

    def test_tagged_package_renders_link_only(self):
        """A package tagged with experiment_id renders exactly as before, even with list-valued role keys."""
        metadata = {"experiment_id": "EXP25000017", "creator": ["Lab team"], "instrument": ["Plate Reader 1"]}
        pkg = Package("catalog.example.com", "bucket", "lab/tagged", metadata=metadata)

        assert format_linked_packages([pkg]) == (
            "\n### Linked Packages\n\n" f"* [lab/tagged]({pkg.catalog_url}) [[🔄 sync]]({pkg.make_sync_url()})\n"
        )

    def test_package_without_metadata_renders_link_only(self):
        pkg = Package("catalog.example.com", "bucket", "lab/plain")

        assert pkg.metadata == {}
        assert format_linked_packages([pkg]) == (
            "\n### Linked Packages\n\n" f"* [lab/plain]({pkg.catalog_url}) [[🔄 sync]]({pkg.make_sync_url()})\n"
        )

    def test_crate_package_lists_roles_under_its_link(self):
        crate = Package("catalog.example.com", "bucket", "lab/crate", metadata=CRATE_META)
        tagged = Package("catalog.example.com", "bucket", "lab/tagged", metadata={"experiment_id": "EXP25000017"})

        assert format_linked_packages([crate, tagged]) == (
            "\n### Linked Packages\n\n"
            f"* [lab/crate]({crate.catalog_url}) [[🔄 sync]]({crate.make_sync_url()})\n"
            "  * **Creator**: Jane Doe\n"
            "  * **Producer**: Assay Development, Laboratory Operations\n"
            "  * **Instrument**: Plate Reader 1\n"
            "  * **Instrument ID**: INST-000456\n"
            f"* [lab/tagged]({tagged.catalog_url}) [[🔄 sync]]({tagged.make_sync_url()})\n"
        )


class TestFormatCrateRoles:
    """Test suite for format_crate_roles function."""

    def test_omits_roles_the_crate_does_not_express(self):
        assert format_crate_roles({"creator": ["Jane Doe"], "eln_entry": ["EXP25000017"]}) == (
            "  * **Creator**: Jane Doe\n"
        )

    def test_only_crate_packages_get_roles(self):
        """Roles are shown only when the metadata carries the profile's eln_entry list."""
        tagged = {"experiment_id": "EXP25000017", "creator": ["Lab team"]}

        assert format_crate_roles(tagged) == ""
        assert format_crate_roles({**tagged, "eln_entry": "EXP25000017"}) == ""
        assert format_crate_roles({**tagged, "eln_entry": ["EXP25000017"]}) == "  * **Creator**: Lab team\n"

    def test_skips_scalar_values(self):
        """A scalar role, like the creator string in a webhook package's entry.json, is not a crate role."""
        metadata = {"eln_entry": ["EXP25000017"], "creator": "Jane Doe <jane@example.com>", "authors": ["Jane Doe"]}

        assert format_crate_roles(metadata) == ""

    def test_skips_empty_and_non_string_values(self):
        metadata = {
            "eln_entry": ["EXP25000017"],
            "creator": [],
            "producer": ["", "  ", None, 7, {"name": "Lab"}],
            "instrument": ["Plate Reader 1"],
        }

        assert format_crate_roles(metadata) == "  * **Instrument**: Plate Reader 1\n"

    def test_collapses_whitespace_so_values_stay_in_their_bullet(self):
        metadata = {"eln_entry": ["EXP25000017"], "creator": ["Jane\n# Heading", "  John   Roe "]}

        assert format_crate_roles(metadata) == "  * **Creator**: Jane # Heading, John Roe\n"

    def test_escapes_markdown_so_values_cannot_inject_links(self):
        metadata = {
            "eln_entry": ["EXP25000017"],
            "creator": ["[Support](https://attacker.example)"],
            "producer": ["<img src=x>", r"a*b_c`d\e"],
        }

        assert format_crate_roles(metadata) == (
            r"  * **Creator**: \[Support\](https://attacker.example)" + "\n"
            r"  * **Producer**: \<img src=x\>, a\*b\_c\`d\\e" + "\n"
        )


class TestEscapeMarkdown:
    """Test suite for escape_markdown function."""

    def test_plain_names_are_unchanged(self):
        for name in ["Jane Doe", "Assay Development", "Plate Reader 1", "INST-000456", "O'Brien (Lab)"]:
            assert escape_markdown(name) == name

    def test_escapes_every_inline_markdown_character(self):
        assert escape_markdown(r"\`*_[]<>") == r"\\\`\*\_\[\]\<\>"


def test_format_package_unnamed_quotes_prefix_and_placeholder():
    from src.canvas_formatting import format_package_unnamed

    md = format_package_unnamed("EXP0001", "lab-`{creator.handle}`", "creator.handle")

    assert "**Entry**: EXP0001" in md
    assert "`lab-'{creator.handle}'`" in md
    assert "`creator.handle`" in md
