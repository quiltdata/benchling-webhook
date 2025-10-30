"""Tests for canvas_formatting module."""

import pytest

from src.canvas_formatting import dict_to_markdown_list, format_package_header, linkify_urls


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
            upload_url="https://catalog.com/upload",
        )

        # Display ID should be the heading
        assert "## EXP-001" in result
        # Package name should be in the details
        assert "benchling/etr_123" in result
        # URLs should be present
        assert "https://catalog.com/package" in result
        assert "https://catalog.com/sync" in result
        assert "https://catalog.com/upload" in result


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
