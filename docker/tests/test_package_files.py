"""Tests for package_files module."""

import json
from unittest.mock import patch

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

    def test_get_files_empty_package(self, fetcher):
        """Test fetching files from empty package."""
        with patch.object(fetcher, "_load_manifest_data", return_value=({}, [])):
            files = fetcher.get_package_files("benchling/etr_123")

        assert len(files) == 0

    def test_get_files_single_file(self, fetcher):
        """Test fetching single file."""
        manifest = [
            {"logical_key": "README.md", "physical_keys": ["s3://test-bucket/README.md"], "size": 1024},
        ]

        with patch.object(fetcher, "_load_manifest_data", return_value=({}, manifest)):
            files = fetcher.get_package_files("benchling/etr_123")

        assert len(files) == 1
        assert files[0].logical_key == "README.md"
        assert files[0].size == 1024
        assert files[0].package_name == "benchling/etr_123"

    def test_get_files_multiple_files(self, fetcher):
        """Test fetching multiple files."""
        manifest = [
            {"logical_key": "README.md", "physical_keys": ["s3://bucket/README.md"], "size": 512},
            {"logical_key": "data/exp1.csv", "physical_keys": ["s3://bucket/data/exp1.csv"], "size": 2048},
            {"logical_key": "data/exp2.csv", "physical_keys": ["s3://bucket/data/exp2.csv"], "size": 4096},
        ]

        with patch.object(fetcher, "_load_manifest_data", return_value=({}, manifest)):
            files = fetcher.get_package_files("benchling/etr_123")

        assert len(files) == 3
        # Check sorting by logical_key
        assert files[0].logical_key == "README.md"
        assert files[1].logical_key == "data/exp1.csv"
        assert files[2].logical_key == "data/exp2.csv"

    def test_get_files_max_limit(self, fetcher):
        """Test respecting max_files limit."""
        manifest = [
            {"logical_key": f"file{i}.txt", "physical_keys": [f"s3://bucket/file{i}.txt"], "size": 100}
            for i in range(20)
        ]

        with patch.object(fetcher, "_load_manifest_data", return_value=({}, manifest)):
            files = fetcher.get_package_files("benchling/etr_123", max_files=10)

        assert len(files) == 10

    def test_get_files_skip_metadata(self, fetcher):
        """Test skipping .quilt/ metadata files."""
        manifest = [
            {"logical_key": "README.md", "physical_keys": ["s3://bucket/README.md"], "size": 512},
            {"logical_key": ".quilt/metadata.json", "physical_keys": ["s3://bucket/.quilt/metadata.json"], "size": 100},
            {"logical_key": "data/exp.csv", "physical_keys": ["s3://bucket/data/exp.csv"], "size": 2048},
        ]

        with patch.object(fetcher, "_load_manifest_data", return_value=({}, manifest)):
            files = fetcher.get_package_files("benchling/etr_123")

        assert len(files) == 2
        assert all(".quilt/" not in f.logical_key for f in files)

    def test_get_files_package_not_found(self, fetcher):
        """Test handling package not found error."""
        with patch.object(fetcher, "_load_manifest_data", side_effect=Exception("Package does not exist")):
            with pytest.raises(Exception, match="Package does not exist"):
                fetcher.get_package_files("benchling/nonexistent")

    def test_get_metadata_from_entry_json(self, fetcher):
        """Test fetching metadata from entry.json."""
        expected_metadata = {"entry_id": "etr_123", "name": "Test Entry"}

        manifest_meta = {"user_meta": {"fallback": True}}
        manifest_entries = [
            {
                "logical_key": "entry.json",
                "physical_keys": ["s3://bucket/path/to/entry.json"],
                "size": 42,
            },
        ]

        with patch.object(fetcher, "_load_manifest_data", return_value=(manifest_meta, manifest_entries)):
            with patch.object(
                fetcher,
                "_fetch_physical_key_bytes",
                return_value=json.dumps(expected_metadata).encode("utf-8"),
            ):
                metadata = fetcher.get_package_metadata("benchling/etr_123")

        assert metadata == expected_metadata

    def test_get_metadata_from_package(self, fetcher):
        """Test fetching metadata from manifest user_meta when entry.json doesn't exist."""
        expected_metadata = {"description": "Test package"}

        manifest_entries: list[dict] = []
        manifest_meta = {"user_meta": expected_metadata}

        with patch.object(fetcher, "_load_manifest_data", return_value=(manifest_meta, manifest_entries)):
            metadata = fetcher.get_package_metadata("benchling/etr_123")

        assert metadata == expected_metadata

    def test_get_metadata_package_not_found(self, fetcher):
        """Test handling package not found when fetching metadata."""
        with patch.object(fetcher, "_load_manifest_data", side_effect=Exception("Package does not exist")):
            with pytest.raises(Exception, match="Package does not exist"):
                fetcher.get_package_metadata("benchling/nonexistent")

    def test_get_files_entry_without_size(self, fetcher):
        """Test handling entries without size attribute."""
        manifest_entries = [
            {"logical_key": "file.txt", "physical_keys": ["s3://bucket/file.txt"], "meta": {}},
        ]

        with patch.object(fetcher, "_load_manifest_data", return_value=({}, manifest_entries)):
            files = fetcher.get_package_files("benchling/etr_123")

        assert len(files) == 1
        assert files[0].size == 0  # Default when size not available
