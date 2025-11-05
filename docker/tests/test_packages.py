"""Tests for Package class and URL generation."""

import pytest

from src.packages import Package


class TestPackage:
    """Test suite for Package class URL generation."""

    @pytest.fixture
    def package(self):
        """Create a Package instance for testing."""
        return Package(
            catalog_base_url="nightly.quilttest.com", bucket="test-bucket", package_name="benchling/etr_123"
        )

    def test_catalog_url(self, package):
        """Test catalog_url generates correct Quilt catalog URL."""
        expected = "https://nightly.quilttest.com/b/test-bucket/packages/benchling/etr_123"
        assert package.catalog_url == expected

    def test_catalog_url_with_special_characters(self):
        """Test catalog_url with package names containing special characters."""
        package = Package(
            catalog_base_url="nightly.quilttest.com",
            bucket="my-bucket",
            package_name="benchling/project/experiment-001",
        )
        expected = "https://nightly.quilttest.com/b/my-bucket/packages/benchling/project/experiment-001"
        assert package.catalog_url == expected

    def test_upload_url_includes_revise_action(self, package):
        """Test upload_url includes ?action=revisePackage query parameter."""
        result = package.upload_url

        # Verify format includes the query parameter
        assert "?action=revisePackage" in result
        expected_url = (
            "https://nightly.quilttest.com/b/test-bucket/packages/benchling/etr_123?action=revisePackage"
        )
        assert result == expected_url

    def test_upload_url_format(self, package):
        """Test upload_url format matches expected pattern."""
        result = package.upload_url

        # Verify it starts with the catalog URL
        assert result.startswith(package.catalog_url)

        # Verify it ends with the action parameter
        assert result.endswith("?action=revisePackage")

    def test_upload_url_different_configurations(self):
        """Test upload_url with different catalog and bucket configurations."""
        test_cases = [
            {
                "catalog": "demo.quiltdata.com",
                "bucket": "quilt-benchling",
                "package": "benchling/EXP25000007",
                "expected": (
                    "https://demo.quiltdata.com/b/quilt-benchling/packages/"
                    "benchling/EXP25000007?action=revisePackage"
                ),
            },
            {
                "catalog": "catalog.example.com",
                "bucket": "my-test-bucket",
                "package": "benchling/test-entry",
                "expected": (
                    "https://catalog.example.com/b/my-test-bucket/packages/"
                    "benchling/test-entry?action=revisePackage"
                ),
            },
            {
                "catalog": "prod.quilt.com",
                "bucket": "production-data",
                "package": "org/project/etr_ABC123",
                "expected": (
                    "https://prod.quilt.com/b/production-data/packages/"
                    "org/project/etr_ABC123?action=revisePackage"
                ),
            },
        ]

        for case in test_cases:
            package = Package(catalog_base_url=case["catalog"], bucket=case["bucket"], package_name=case["package"])
            assert package.upload_url == case["expected"]

    def test_upload_url_is_property(self, package):
        """Test that upload_url is a property and not a method call."""
        # Should access as property, not call as method
        result = package.upload_url
        assert isinstance(result, str)
        assert "?action=revisePackage" in result

    def test_make_catalog_url_with_file_path(self, package):
        """Test make_catalog_url generates correct URL for files."""
        result = package.make_catalog_url("README.md")
        expected = "https://nightly.quilttest.com/b/test-bucket/packages/benchling/etr_123/tree/README.md"
        assert result == expected

    def test_make_catalog_url_with_nested_path(self, package):
        """Test make_catalog_url with nested file paths."""
        result = package.make_catalog_url("data/results.csv")
        # Forward slash should be encoded
        assert "/tree/data%2Fresults.csv" in result

    def test_make_catalog_url_special_characters(self, package):
        """Test make_catalog_url encodes special characters in file paths."""
        result = package.make_catalog_url("data/file name with spaces.txt")
        # Spaces should be encoded
        assert "%20" in result
        expected_url = (
            "https://nightly.quilttest.com/b/test-bucket/packages/benchling/etr_123/"
            "tree/data%2Ffile%20name%20with%20spaces.txt"
        )
        assert result == expected_url

    def test_make_sync_url_default(self, package):
        """Test make_sync_url with default parameters includes :latest."""
        result = package.make_sync_url()

        # Should include quilt+s3 protocol
        assert "quilt%2Bs3" in result

        # Should include :latest for version
        assert "%3Alatest" in result  # :latest encoded

        # Should include catalog parameter
        assert "catalog%3Dnightly.quilttest.com" in result

    def test_make_sync_url_with_path(self, package):
        """Test make_sync_url with path parameter."""
        result = package.make_sync_url(path="README.md")

        # Should include path parameter
        assert "path%3DREADME.md" in result or "path=README.md" in result

    def test_make_sync_url_with_version(self, package):
        """Test make_sync_url with version parameter."""
        version = "787d43acc36392140f56c4fb1e33310c6e0445d3ba332430c61a6674321defc1"
        result = package.make_sync_url(version=version)

        # Should include version hash
        assert version[:20] in result

        # Should not include :latest when version is specified
        assert ":latest" not in result

    def test_make_sync_url_with_path_and_version(self, package):
        """Test make_sync_url with both path and version."""
        version = "abc123"
        result = package.make_sync_url(path="data.csv", version=version)

        # Should include both parameters
        assert "path" in result or "path%3D" in result
        assert version in result

    def test_make_sync_url_returns_redirect_url(self, package):
        """Test that make_sync_url returns a redirect URL."""
        result = package.make_sync_url()

        # Should be a redirect URL
        assert result.startswith(f"https://{package.catalog_base_url}/redir/")

    def test_package_attributes(self, package):
        """Test that Package stores its initialization attributes."""
        assert package.catalog_base_url == "nightly.quilttest.com"
        assert package.bucket == "test-bucket"
        assert package.package_name == "benchling/etr_123"

    def test_upload_url_consistency(self, package):
        """Test that upload_url returns consistent results across multiple calls."""
        result1 = package.upload_url
        result2 = package.upload_url
        result3 = package.upload_url

        assert result1 == result2 == result3
        assert "?action=revisePackage" in result1


class TestPackageURLIntegration:
    """Integration tests for Package URL generation with realistic data."""

    def test_realistic_benchling_package(self):
        """Test with realistic Benchling entry ID and production-like configuration."""
        package = Package(
            catalog_base_url="demo.quiltdata.com", bucket="quilt-benchling", package_name="benchling/EXP25000007"
        )

        # Test all URL types
        catalog_url = package.catalog_url
        upload_url = package.upload_url
        sync_url = package.make_sync_url()
        file_url = package.make_catalog_url("README.md")

        # Verify all URLs use the same base
        assert all(
            url.startswith("https://demo.quiltdata.com") for url in [catalog_url, upload_url, sync_url, file_url]
        )

        # Verify upload_url has the correct action
        assert upload_url == f"{catalog_url}?action=revisePackage"

    def test_multiple_packages_different_urls(self):
        """Test that different packages generate different URLs."""
        package1 = Package("catalog.com", "bucket", "benchling/etr_001")
        package2 = Package("catalog.com", "bucket", "benchling/etr_002")
        package3 = Package("catalog.com", "bucket", "benchling/etr_003")

        urls = [pkg.upload_url for pkg in [package1, package2, package3]]

        # All should have the action parameter
        assert all("?action=revisePackage" in url for url in urls)

        # All should be unique
        assert len(set(urls)) == 3

    def test_display_id_format(self):
        """Test upload_url with display ID format (as per Task 1)."""
        # After Task 1, packages should use display IDs like EXP25000007
        package = Package(
            catalog_base_url="nightly.quilttest.com",
            bucket="test-bucket",
            package_name="benchling/EXP25000007",  # Display ID format
        )

        result = package.upload_url
        expected = "https://nightly.quilttest.com/b/test-bucket/packages/benchling/EXP25000007?action=revisePackage"

        assert result == expected
        assert "EXP25000007" in result
        assert "?action=revisePackage" in result
