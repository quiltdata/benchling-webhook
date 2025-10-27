"""Tests for package_files module."""

from unittest.mock import Mock, patch

import pytest

from src.package_files import PackageFile, PackageFileFetcher


class TestPackageFile:
    """Tests for PackageFile dataclass."""

    def test_package_file_properties(self):
        """Test PackageFile property methods."""
        file = PackageFile(
            logical_key="data/experiment.csv",
            size=1024,
            catalog_base_url="nightly.quilttest.com",
            bucket="test-bucket",
            package_name="benchling/etr_123",
        )

        assert file.name == "experiment.csv"
        assert file.size_display == "1.0 KB"
        assert "nightly.quilttest.com" in file.catalog_url
        assert "benchling/etr_123" in file.catalog_url
        assert "experiment.csv" in file.catalog_url
        # sync_url is URL-encoded, so check for encoded version
        assert "quilt" in file.sync_url.lower()
        assert "redir" in file.sync_url

    def test_package_file_name_no_path(self):
        """Test name property for file without path."""
        file = PackageFile(
            logical_key="README.md",
            size=512,
            catalog_base_url="nightly.quilttest.com",
            bucket="test-bucket",
            package_name="benchling/etr_123",
        )

        assert file.name == "README.md"

    def test_package_file_size_display(self):
        """Test human-readable size display."""
        # Test bytes
        file = PackageFile(
            logical_key="small.txt",
            size=512,
            catalog_base_url="nightly.quilttest.com",
            bucket="test-bucket",
            package_name="benchling/etr_123",
        )
        assert file.size_display == "512.0 B"

        # Test KB
        file.size = 1024
        assert file.size_display == "1.0 KB"

        # Test MB
        file.size = 1024 * 1024
        assert file.size_display == "1.0 MB"

        # Test GB
        file.size = 1024 * 1024 * 1024
        assert file.size_display == "1.0 GB"

    def test_package_file_catalog_url(self):
        """Test catalog URL generation."""
        file = PackageFile(
            logical_key="data/exp.csv",
            size=1024,
            catalog_base_url="nightly.quilttest.com",
            bucket="test-bucket",
            package_name="benchling/etr_123",
        )

        url = file.catalog_url
        assert "https://nightly.quilttest.com" in url
        assert "/b/test-bucket" in url
        assert "/packages/benchling/etr_123" in url
        assert "/tree/" in url

    def test_package_file_sync_url(self):
        """Test QuiltSync URL generation."""
        file = PackageFile(
            logical_key="data/exp.csv",
            size=1024,
            catalog_base_url="nightly.quilttest.com",
            bucket="test-bucket",
            package_name="benchling/etr_123",
        )

        url = file.sync_url
        assert "https://nightly.quilttest.com/redir/" in url
        assert "quilt" in url.lower()  # URL-encoded


class TestPackageFileFetcher:
    """Tests for PackageFileFetcher class."""

    @pytest.fixture
    def fetcher(self):
        """Create a PackageFileFetcher instance."""
        return PackageFileFetcher(
            catalog_url="nightly.quilttest.com",
            bucket="test-bucket",
        )

    @pytest.fixture
    def mock_package(self):
        """Create a mock quilt3 Package."""
        pkg = Mock()
        pkg.walk = Mock()
        pkg.meta = {"description": "Test package"}
        return pkg

    def test_get_files_empty_package(self, fetcher, mock_package):
        """Test fetching files from empty package."""
        mock_package.walk.return_value = []

        with patch("src.package_files.quilt3.Package.browse", return_value=mock_package):
            files = fetcher.get_package_files("benchling/etr_123")

        assert len(files) == 0

    def test_get_files_single_file(self, fetcher, mock_package):
        """Test fetching single file."""
        mock_entry = Mock()
        mock_entry.size = 1024

        mock_package.walk.return_value = [
            ("README.md", mock_entry),
        ]

        with patch("src.package_files.quilt3.Package.browse", return_value=mock_package):
            files = fetcher.get_package_files("benchling/etr_123")

        assert len(files) == 1
        assert files[0].logical_key == "README.md"
        assert files[0].size == 1024
        assert files[0].package_name == "benchling/etr_123"

    def test_get_files_multiple_files(self, fetcher, mock_package):
        """Test fetching multiple files."""
        mock_entries = [
            ("README.md", Mock(size=512)),
            ("data/exp1.csv", Mock(size=2048)),
            ("data/exp2.csv", Mock(size=4096)),
        ]

        mock_package.walk.return_value = mock_entries

        with patch("src.package_files.quilt3.Package.browse", return_value=mock_package):
            files = fetcher.get_package_files("benchling/etr_123")

        assert len(files) == 3
        # Check sorting by logical_key
        assert files[0].logical_key == "README.md"
        assert files[1].logical_key == "data/exp1.csv"
        assert files[2].logical_key == "data/exp2.csv"

    def test_get_files_max_limit(self, fetcher, mock_package):
        """Test respecting max_files limit."""
        mock_entries = [(f"file{i}.txt", Mock(size=100)) for i in range(20)]

        mock_package.walk.return_value = mock_entries

        with patch("src.package_files.quilt3.Package.browse", return_value=mock_package):
            files = fetcher.get_package_files("benchling/etr_123", max_files=10)

        assert len(files) == 10

    def test_get_files_skip_metadata(self, fetcher, mock_package):
        """Test skipping .quilt/ metadata files."""
        mock_entries = [
            ("README.md", Mock(size=512)),
            (".quilt/metadata.json", Mock(size=100)),
            ("data/exp.csv", Mock(size=2048)),
        ]

        mock_package.walk.return_value = mock_entries

        with patch("src.package_files.quilt3.Package.browse", return_value=mock_package):
            files = fetcher.get_package_files("benchling/etr_123")

        assert len(files) == 2
        assert all(".quilt/" not in f.logical_key for f in files)

    def test_get_files_package_not_found(self, fetcher):
        """Test handling package not found error."""
        with patch("src.package_files.quilt3.Package.browse", side_effect=Exception("Package does not exist")):
            with pytest.raises(Exception, match="Package does not exist"):
                fetcher.get_package_files("benchling/nonexistent")

    def test_get_metadata_from_entry_json(self, fetcher, mock_package):
        """Test fetching metadata from entry.json."""
        expected_metadata = {"entry_id": "etr_123", "name": "Test Entry"}

        # Mock the package to have entry.json
        mock_package.__contains__ = Mock(return_value=True)
        mock_package.__getitem__ = Mock(return_value=Mock(return_value=expected_metadata))

        with patch("src.package_files.quilt3.Package.browse", return_value=mock_package):
            metadata = fetcher.get_package_metadata("benchling/etr_123")

        assert metadata == expected_metadata

    def test_get_metadata_from_package(self, fetcher, mock_package):
        """Test fetching metadata from package.meta when entry.json doesn't exist."""
        expected_metadata = {"description": "Test package"}

        # Mock the package to NOT have entry.json
        mock_package.__contains__ = Mock(return_value=False)
        mock_package.meta = expected_metadata

        with patch("src.package_files.quilt3.Package.browse", return_value=mock_package):
            metadata = fetcher.get_package_metadata("benchling/etr_123")

        assert metadata == expected_metadata

    def test_get_metadata_package_not_found(self, fetcher):
        """Test handling package not found when fetching metadata."""
        with patch("src.package_files.quilt3.Package.browse", side_effect=Exception("Package does not exist")):
            with pytest.raises(Exception, match="Package does not exist"):
                fetcher.get_package_metadata("benchling/nonexistent")

    def test_get_files_entry_without_size(self, fetcher, mock_package):
        """Test handling entries without size attribute."""
        mock_entry = Mock(spec=[])  # No size attribute

        mock_package.walk.return_value = [
            ("file.txt", mock_entry),
        ]

        with patch("src.package_files.quilt3.Package.browse", return_value=mock_package):
            files = fetcher.get_package_files("benchling/etr_123")

        assert len(files) == 1
        assert files[0].size == 0  # Default when size not available
