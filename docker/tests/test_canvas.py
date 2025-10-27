"""Tests for CanvasManager."""

from unittest.mock import Mock
from urllib.parse import quote

import pytest

from src.canvas import CanvasManager
from src.config import Config
from src.payload import Payload


@pytest.mark.local
class TestCanvasManager:
    """Test suite for CanvasManager.

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

    def test_raw_sync_uri(self, canvas_manager):
        """Test raw_sync_uri returns unencoded quilt+s3:// URI with hash fragment format and :latest by default."""
        expected = "quilt+s3://test-bucket#package=benchling/test-entry:latest&catalog=test.quiltdata.com"
        assert canvas_manager.raw_sync_uri() == expected

    def test_sync_uri_encoding(self, canvas_manager):
        """Test sync_uri returns properly URL-encoded redirect URI."""
        # The raw URI should be URL-encoded and include :latest by default
        raw_uri = "quilt+s3://test-bucket#package=benchling/test-entry:latest&catalog=test.quiltdata.com"
        expected_encoded = quote(raw_uri, safe="")
        expected = f"https://test.quiltdata.com/redir/{expected_encoded}"

        assert canvas_manager.sync_uri() == expected

    def test_sync_uri_special_characters_encoded(self, canvas_manager):
        """Test that special characters in sync_uri are properly encoded."""
        result = canvas_manager.sync_uri()

        # Verify special characters are encoded
        assert "%2B" in result  # '+' should be encoded as %2B
        assert "%3A" in result  # ':' should be encoded as %3A
        assert "%2F" in result  # '/' should be encoded as %2F
        assert "%23" in result  # '#' should be encoded as %23
        assert "%3D" in result  # '=' should be encoded as %3D
        assert "%26" in result  # '&' should be encoded as %26

        # Verify the unencoded characters are NOT present in the encoded portion
        encoded_part = result.split("/redir/")[1]
        assert "+" not in encoded_part
        # Note: ':' and '/' will appear in the https:// prefix, so we check the encoded part only

    def test_sync_uri_no_recursion(self, canvas_manager):
        """Test that sync_uri doesn't cause infinite recursion."""
        # This should not raise RecursionError
        try:
            result = canvas_manager.sync_uri()
            assert result is not None
            assert result.startswith("https://")
        except RecursionError:
            pytest.fail("sync_uri caused infinite recursion")

    def test_catalog_url(self, canvas_manager):
        """Test catalog_url generates correct Quilt catalog URL."""
        expected = "https://test.quiltdata.com/b/test-bucket/packages/benchling/test-entry"
        assert canvas_manager.catalog_url == expected

    def test_package_name(self, canvas_manager, mock_payload, mock_config):
        """Test package_name calls payload.package_name with correct prefix."""
        package_name = canvas_manager.package_name
        mock_payload.package_name.assert_called_once_with(mock_config.s3_prefix)
        assert package_name == "benchling/test-entry"

    def test_markdown_content_includes_sync_uri(self, canvas_manager):
        """Test that markdown content includes the sync_uri link."""
        markdown = canvas_manager._make_markdown_content()

        # Verify the relevant URLs are present (don't check specific text which may change)
        assert canvas_manager.sync_uri() in markdown
        assert canvas_manager.catalog_url in markdown
        assert canvas_manager.upload_url() in markdown

    def test_sync_uri_different_bucket_names(self, mock_benchling, mock_config, mock_payload):
        """Test sync_uri with different bucket names containing special characters."""
        # Test with bucket name that has dashes
        mock_config.s3_bucket_name = "my-test-bucket"
        canvas_manager = CanvasManager(mock_benchling, mock_config, mock_payload)

        result = canvas_manager.sync_uri()
        assert "my-test-bucket" in canvas_manager.raw_sync_uri()
        assert quote("my-test-bucket", safe="") in result

    def test_sync_uri_different_package_names(self, mock_benchling, mock_config, mock_payload):
        """Test sync_uri with different package names."""
        # Test with package name that has slashes
        mock_payload.package_name.return_value = "benchling/project/experiment-001"
        canvas_manager = CanvasManager(mock_benchling, mock_config, mock_payload)

        result = canvas_manager.sync_uri()
        raw_uri = canvas_manager.raw_sync_uri()

        assert "benchling/project/experiment-001" in raw_uri
        # The slashes should be encoded in the sync_uri
        assert quote(raw_uri, safe="") in result

    def test_raw_sync_uri_with_path(self, canvas_manager):
        """Test raw_sync_uri with path parameter includes :latest by default."""
        result = canvas_manager.raw_sync_uri(path="README.md")
        expected = (
            "quilt+s3://test-bucket#package=benchling/test-entry:latest&path=README.md&catalog=test.quiltdata.com"
        )
        assert result == expected

    def test_raw_sync_uri_with_version(self, canvas_manager):
        """Test raw_sync_uri with version parameter."""
        version_hash = "787d43acc36392140f56c4fb1e33310c6e0445d3ba332430c61a6674321defc1"
        result = canvas_manager.raw_sync_uri(version=version_hash)
        expected = f"quilt+s3://test-bucket#package=benchling/test-entry@{version_hash}&catalog=test.quiltdata.com"
        assert result == expected

    def test_raw_sync_uri_with_path_and_version(self, canvas_manager):
        """Test raw_sync_uri with both path and version parameters."""
        version_hash = "787d43acc36392140f56c4fb1e33310c6e0445d3ba332430c61a6674321defc1"
        result = canvas_manager.raw_sync_uri(path="README.md", version=version_hash)
        expected = (
            f"quilt+s3://test-bucket#package=benchling/test-entry@{version_hash}"
            "&path=README.md&catalog=test.quiltdata.com"
        )
        assert result == expected

    def test_raw_sync_uri_full_example(self, mock_benchling, mock_config, mock_payload):
        """Test raw_sync_uri generates exact format from user example."""
        # Setup to match the example
        mock_config.s3_bucket_name = "quilt-example-bucket"
        mock_config.quilt_catalog = "nightly.quilttest.com"
        mock_payload.package_name.return_value = "benchdock/etr_EK1AQMQiQn"
        canvas_manager = CanvasManager(mock_benchling, mock_config, mock_payload)

        version_hash = "787d43acc36392140f56c4fb1e33310c6e0445d3ba332430c61a6674321defc1"
        result = canvas_manager.raw_sync_uri(path="README.md", version=version_hash)

        # This should match the exact format from the user's example
        expected = (
            "quilt+s3://quilt-example-bucket#"
            f"package=benchdock/etr_EK1AQMQiQn@{version_hash}&"
            "path=README.md&"
            "catalog=nightly.quilttest.com"
        )
        assert result == expected

    def test_sync_uri_with_path(self, canvas_manager):
        """Test sync_uri with path parameter returns properly encoded URI."""
        result = canvas_manager.sync_uri(path="README.md")
        raw_uri = canvas_manager.raw_sync_uri(path="README.md")

        assert quote(raw_uri, safe="") in result
        assert result.startswith("https://test.quiltdata.com/redir/")
        # Verify 'README.md' is encoded in the result
        assert "README" in result

    def test_sync_uri_with_version(self, canvas_manager):
        """Test sync_uri with version parameter returns properly encoded URI."""
        version_hash = "787d43acc36392140f56c4fb1e33310c6e0445d3ba332430c61a6674321defc1"
        result = canvas_manager.sync_uri(version=version_hash)
        raw_uri = canvas_manager.raw_sync_uri(version=version_hash)

        assert quote(raw_uri, safe="") in result
        assert result.startswith("https://test.quiltdata.com/redir/")
        # Verify version hash is encoded in the result
        assert version_hash[:10] in result

    def test_sync_uri_with_path_and_version(self, canvas_manager):
        """Test sync_uri with both path and version parameters."""
        version_hash = "787d43acc36392140f56c4fb1e33310c6e0445d3ba332430c61a6674321defc1"
        result = canvas_manager.sync_uri(path="README.md", version=version_hash)
        raw_uri = canvas_manager.raw_sync_uri(path="README.md", version=version_hash)

        assert quote(raw_uri, safe="") in result
        assert result.startswith("https://test.quiltdata.com/redir/")

    def test_sync_uri_encodes_path_special_characters(self, canvas_manager):
        """Test that special characters in path are properly encoded."""
        # Path with special characters
        result = canvas_manager.sync_uri(path="data/file name.csv")
        raw_uri = canvas_manager.raw_sync_uri(path="data/file name.csv")

        # The raw URI should contain the space
        assert "file name" in raw_uri

        # The sync URI should have the space encoded
        encoded_uri = quote(raw_uri, safe="")
        assert encoded_uri in result
        assert "file%20name" in result or "file+name" in result  # Space can be encoded as %20 or +

    def test_catalog_always_included(self, canvas_manager):
        """Test that catalog parameter is always included in raw_sync_uri."""
        # Test various combinations - catalog should always be present
        result_default = canvas_manager.raw_sync_uri()
        assert "&catalog=test.quiltdata.com" in result_default
        assert ":latest" in result_default  # Also verify :latest is present when no version specified

        result_with_path = canvas_manager.raw_sync_uri(path="test.txt")
        assert "&catalog=test.quiltdata.com" in result_with_path
        assert ":latest" in result_with_path

        result_with_version = canvas_manager.raw_sync_uri(version="abc123")
        assert "&catalog=test.quiltdata.com" in result_with_version
        assert "@abc123" in result_with_version  # Version should use @ not :

        result_with_both = canvas_manager.raw_sync_uri(path="test.txt", version="abc123")
        assert "&catalog=test.quiltdata.com" in result_with_both
        assert "@abc123" in result_with_both
