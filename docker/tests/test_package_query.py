"""Tests for package_query module."""

from unittest.mock import Mock, patch

import pytest

from src.package_query import PackageQuery


class TestPackageQueryImports:
    """Tests to ensure all imports work correctly."""

    def test_module_imports(self):
        """Test that the module can be imported without errors."""
        # This test will fail if there are import errors at module load time
        from src import package_query

        assert hasattr(package_query, "PackageQuery")

    def test_package_class_available(self):
        """Test that Package class is available for use."""
        from src.packages import Package

        # Verify Package is imported and available
        assert Package is not None


class TestPackageQuery:
    """Tests for PackageQuery class."""

    @patch("src.package_query.boto3")
    def test_init(self, mock_boto3):
        """Test PackageQuery initialization."""
        # Mock AWS clients
        mock_athena = Mock()
        mock_sts = Mock()
        mock_sts.get_caller_identity.return_value = {"Account": "123456789012"}

        mock_boto3.client.side_effect = lambda service, **kwargs: (mock_athena if service == "athena" else mock_sts)

        query = PackageQuery(
            bucket="test-bucket",
            catalog_url="catalog.example.com",
            database="test_db",
            region="us-west-2",
        )

        assert query.bucket == "test-bucket"
        assert query.catalog_url == "catalog.example.com"
        assert query.database == "test_db"
        assert query.region == "us-west-2"

    @patch("src.package_query.os.getenv")
    @patch("src.package_query.boto3")
    def test_init_without_database_raises(self, mock_boto3, mock_getenv):
        """Test that initialization without database raises ValueError."""
        # Mock os.getenv to return None for QUILT_DATABASE
        mock_getenv.side_effect = lambda key, default=None: (
            default if key == "QUILT_DATABASE" else ("us-east-1" if key == "AWS_REGION" else None)
        )

        with pytest.raises(ValueError, match="database parameter or QUILT_DATABASE"):
            PackageQuery(
                bucket="test-bucket",
                catalog_url="catalog.example.com",
            )

    @patch("src.package_query.boto3")
    def test_find_unique_packages_returns_package_instances(self, mock_boto3):
        """Test that find_unique_packages returns Package instances."""
        # Mock AWS clients
        mock_athena = Mock()
        mock_sts = Mock()
        mock_sts.get_caller_identity.return_value = {"Account": "123456789012"}

        # Mock query execution
        mock_athena.start_query_execution.return_value = {"QueryExecutionId": "test-query-id"}
        mock_athena.get_query_execution.return_value = {"QueryExecution": {"Status": {"State": "SUCCEEDED"}}}
        mock_athena.get_query_results.return_value = {
            "ResultSet": {
                "Rows": [
                    # Header row
                    {
                        "Data": [
                            {"VarCharValue": "pkg_name"},
                            {"VarCharValue": "timestamp"},
                            {"VarCharValue": "message"},
                            {"VarCharValue": "user_meta"},
                        ]
                    },
                    # Data row
                    {
                        "Data": [
                            {"VarCharValue": "benchling/etr_123"},
                            {"VarCharValue": "latest"},
                            {"VarCharValue": "Test package"},
                            {"VarCharValue": '{"entry_id": "etr_123"}'},
                        ]
                    },
                ]
            }
        }

        mock_boto3.client.side_effect = lambda service, **kwargs: (mock_athena if service == "athena" else mock_sts)

        query = PackageQuery(
            bucket="test-bucket",
            catalog_url="catalog.example.com",
            database="test_db",
        )

        result = query.find_unique_packages("entry_id", "etr_123")

        # Verify result structure
        assert "packages" in result
        assert "results" in result
        assert isinstance(result["packages"], list)
        assert len(result["packages"]) == 1

        # Verify Package instance
        package = result["packages"][0]
        assert package.package_name == "benchling/etr_123"
        assert package.bucket == "test-bucket"
        assert package.catalog_base_url == "catalog.example.com"
