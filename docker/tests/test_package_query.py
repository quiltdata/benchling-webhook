"""Tests for package_query module."""

from unittest.mock import Mock, patch

import pytest

from src.package_query import PackageQuery
from src.packages import Package


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

    @patch("src.package_query.RoleManager")
    def test_init(self, mock_role_manager_class):
        """Test PackageQuery initialization."""
        # Mock AWS clients
        mock_athena = Mock()

        # Mock RoleManager to return a session that creates the mock Athena client
        mock_role_manager = Mock()
        mock_session = Mock()
        mock_session.client.return_value = mock_athena
        mock_role_manager._get_or_create_session.return_value = (mock_session, None)
        mock_role_manager.role_arn = None
        mock_role_manager._session = None
        mock_role_manager._expires_at = None
        mock_role_manager_class.return_value = mock_role_manager

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

    @patch("src.package_query.RoleManager")
    @patch("src.package_query.os.getenv")
    def test_init_without_database_raises(self, mock_getenv, mock_role_manager_class):
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

    @patch("src.package_query.RoleManager")
    def test_find_unique_packages_returns_package_instances(self, mock_role_manager_class):
        """Test that find_unique_packages returns Package instances."""
        # Mock AWS clients
        mock_athena = Mock()

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

        # Mock RoleManager to return a session that creates the mock Athena client
        mock_role_manager = Mock()
        mock_session = Mock()
        mock_session.client.return_value = mock_athena
        mock_role_manager._get_or_create_session.return_value = (mock_session, None)
        mock_role_manager.role_arn = None
        mock_role_manager._session = None
        mock_role_manager._expires_at = None
        mock_role_manager_class.return_value = mock_role_manager

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

    @patch("src.package_query.RoleManager")
    def test_find_unique_packages_bucketless_searches_all_package_views(self, mock_role_manager_class):
        """Bucketless PackageQuery searches every discovered package view."""
        mock_athena = Mock()

        mock_role_manager = Mock()
        mock_session = Mock()
        mock_session.client.return_value = mock_athena
        mock_role_manager._get_or_create_session.return_value = (mock_session, None)
        mock_role_manager.role_arn = None
        mock_role_manager._session = None
        mock_role_manager._expires_at = None
        mock_role_manager_class.return_value = mock_role_manager

        query = PackageQuery(bucket="", catalog_url="catalog.example.com", database="test_db")
        query._list_package_view_buckets = Mock(return_value=["bucket-a", "bucket-b"])
        query._find_unique_packages_in_bucket = Mock(
            side_effect=lambda bucket, _key, _value, _timeout=30: {
                "packages": [Package("catalog.example.com", bucket, f"benchling/pkg-{bucket[-1]}")],
                "results": {
                    "rows": [{"pkg_name": f"benchling/pkg-{bucket[-1]}"}],
                    "package_info": {
                        f"benchling/pkg-{bucket[-1]}": {
                            "bucket": bucket,
                            "versions": [],
                            "metadata": {"experiment_id": "EXP-1"},
                            "timestamp": "latest",
                            "message": bucket[-1].upper(),
                        }
                    },
                },
            }
        )

        result = query.find_unique_packages("experiment_id", "EXP-1")

        assert [(pkg.bucket, pkg.package_name) for pkg in result["packages"]] == [
            ("bucket-a", "benchling/pkg-a"),
            ("bucket-b", "benchling/pkg-b"),
        ]
        query._list_package_view_buckets.assert_called_once()
        assert query._find_unique_packages_in_bucket.call_count == 2

    @patch("src.package_query.RoleManager")
    def test_find_unique_packages_bucketless_continues_after_bucket_error(self, mock_role_manager_class):
        """Bucketless PackageQuery returns accessible matches even when some bucket views fail."""
        mock_athena = Mock()
        mock_role_manager = Mock()
        mock_session = Mock()
        mock_session.client.return_value = mock_athena
        mock_role_manager._get_or_create_session.return_value = (mock_session, None)
        mock_role_manager.role_arn = None
        mock_role_manager._session = None
        mock_role_manager._expires_at = None
        mock_role_manager_class.return_value = mock_role_manager

        query = PackageQuery(bucket="", catalog_url="catalog.example.com", database="test_db")
        query._list_package_view_buckets = Mock(return_value=["bucket-a", "bucket-b"])

        def search_bucket(bucket, _key, _value, _timeout=30):
            if bucket == "bucket-a":
                raise RuntimeError("Access denied")
            return {
                "packages": [Package("catalog.example.com", "bucket-b", "benchling/pkg-b")],
                "results": {
                    "rows": [{"pkg_name": "benchling/pkg-b"}],
                    "package_info": {
                        "benchling/pkg-b": {
                            "bucket": "bucket-b",
                            "versions": [],
                            "metadata": {"experiment_id": "EXP-1"},
                            "timestamp": "latest",
                            "message": "B",
                        }
                    },
                },
            }

        query._find_unique_packages_in_bucket = Mock(side_effect=search_bucket)

        result = query.find_unique_packages("experiment_id", "EXP-1")

        assert [(pkg.bucket, pkg.package_name) for pkg in result["packages"]] == [("bucket-b", "benchling/pkg-b")]
        assert result["results"]["errors"] == {"bucket-a": "Access denied"}


class TestPackageQueryIceberg:
    """Tests for Iceberg-backed bucketless search path."""

    @patch("src.package_query.RoleManager")
    def test_iceberg_query_taken_when_configured(self, mock_role_manager_class):
        """Bucketless + iceberg_database uses Iceberg path, not fanout."""
        mock_athena = Mock()
        mock_glue = Mock()

        mock_role_manager = Mock()
        mock_session = Mock()
        mock_session.client.side_effect = lambda service, **kw: {
            "athena": mock_athena,
            "glue": mock_glue,
        }[service]
        mock_role_manager._get_or_create_session.return_value = (mock_session, None)
        mock_role_manager.role_arn = None
        mock_role_manager._session = None
        mock_role_manager._expires_at = None
        mock_role_manager_class.return_value = mock_role_manager

        query = PackageQuery(
            bucket="",
            catalog_url="catalog.example.com",
            database="test_db",
            region="us-west-2",
            iceberg_database="iceberg_db",
        )

        # Mock the Iceberg methods so we don't need real Glue data
        query._list_iceberg_manifest_buckets = Mock(return_value=["bucket-a", "bucket-b"])
        query._execute_query = Mock(
            return_value=[
                {
                    "pkg_name": "benchling/pkg-a",
                    "timestamp": "latest",
                    "message": "A",
                    "user_meta": '{"experiment_id": "EXP-1"}',
                    "_src_bucket": "bucket-a",
                },
                {
                    "pkg_name": "benchling/pkg-b",
                    "timestamp": "latest",
                    "message": "B",
                    "user_meta": '{"experiment_id": "EXP-1"}',
                    "_src_bucket": "bucket-b",
                },
            ]
        )

        result = query.find_unique_packages("experiment_id", "EXP-1")

        assert [(pkg.bucket, pkg.package_name) for pkg in result["packages"]] == [
            ("bucket-a", "benchling/pkg-a"),
            ("bucket-b", "benchling/pkg-b"),
        ]
        query._list_iceberg_manifest_buckets.assert_called_once()
        assert query._execute_query.call_count == 1  # single query, not fanout

    @patch("src.package_query.RoleManager")
    def test_iceberg_skipped_when_not_configured(self, mock_role_manager_class):
        """Bucketless without iceberg_database falls back to fanout."""
        mock_athena = Mock()

        mock_role_manager = Mock()
        mock_session = Mock()
        mock_session.client.return_value = mock_athena
        mock_role_manager._get_or_create_session.return_value = (mock_session, None)
        mock_role_manager.role_arn = None
        mock_role_manager._session = None
        mock_role_manager._expires_at = None
        mock_role_manager_class.return_value = mock_role_manager

        query = PackageQuery(
            bucket="",
            catalog_url="catalog.example.com",
            database="test_db",
            region="us-west-2",
        )
        # Should use fanout path
        query._list_package_view_buckets = Mock(return_value=[])
        query._find_unique_packages_in_bucket = Mock(return_value={"packages": [], "results": {}})

        result = query.find_unique_packages("experiment_id", "EXP-1")

        query._list_package_view_buckets.assert_called_once()
        assert query._find_unique_packages_in_bucket.call_count == 0  # no buckets to search
        assert result["packages"] == []

    @patch("src.package_query.RoleManager")
    def test_single_bucket_taken_when_bucket_set(self, mock_role_manager_class):
        """When bucket is set, single-bucket path is used even with iceberg_database."""
        mock_athena = Mock()

        mock_role_manager = Mock()
        mock_session = Mock()
        mock_session.client.return_value = mock_athena
        mock_role_manager._get_or_create_session.return_value = (mock_session, None)
        mock_role_manager.role_arn = None
        mock_role_manager._session = None
        mock_role_manager._expires_at = None
        mock_role_manager_class.return_value = mock_role_manager

        query = PackageQuery(
            bucket="my-bucket",
            catalog_url="catalog.example.com",
            database="test_db",
            region="us-west-2",
            iceberg_database="iceberg_db",
        )
        query._find_unique_packages_in_bucket = Mock(
            return_value={
                "packages": [Package("catalog.example.com", "my-bucket", "benchling/pkg")],
                "results": {},
            }
        )

        result = query.find_unique_packages("experiment_id", "EXP-1")

        query._find_unique_packages_in_bucket.assert_called_once_with("my-bucket", "experiment_id", "EXP-1")
        assert len(result["packages"]) == 1

    @patch("src.package_query.RoleManager")
    def test_iceberg_empty_when_no_tables_found(self, mock_role_manager_class):
        """Iceberg path returns empty when no manifest tables exist."""
        mock_athena = Mock()
        mock_glue = Mock()

        mock_role_manager = Mock()
        mock_session = Mock()
        mock_session.client.side_effect = lambda service, **kw: {
            "athena": mock_athena,
            "glue": mock_glue,
        }[service]
        mock_role_manager._get_or_create_session.return_value = (mock_session, None)
        mock_role_manager.role_arn = None
        mock_role_manager._session = None
        mock_role_manager._expires_at = None
        mock_role_manager_class.return_value = mock_role_manager

        query = PackageQuery(
            bucket="",
            catalog_url="catalog.example.com",
            database="test_db",
            region="us-west-2",
            iceberg_database="iceberg_db",
        )

        # Mock Glue to return no matching tables
        mock_glue.get_tables.return_value = {
            "TableList": [
                {"Name": "bucket_a_some_other_table"},
                {"Name": "bucket_a_package_revision"},
            ]
        }

        result = query.find_unique_packages("experiment_id", "EXP-1")

        assert result["packages"] == []
        assert not result["results"]["errors"]

    @patch("src.package_query.RoleManager")
    def test_iceberg_build_union_query(self, mock_role_manager_class):
        """Iceberg UNION ALL query has correct structure."""
        mock_athena = Mock()
        mock_role_manager = Mock()
        mock_session = Mock()
        mock_session.client.return_value = mock_athena
        mock_role_manager._get_or_create_session.return_value = (mock_session, None)
        mock_role_manager.role_arn = None
        mock_role_manager._session = None
        mock_role_manager._expires_at = None
        mock_role_manager_class.return_value = mock_role_manager

        query = PackageQuery(
            bucket="",
            catalog_url="catalog.example.com",
            database="test_db",
            region="us-west-2",
            iceberg_database="iceberg_db",
        )

        sql = query._build_iceberg_union_query(
            ["bucket-a", "bucket-b"],
            "experiment_id",
            "EXP-1",
        )

        # Should reference Iceberg database
        assert '"iceberg_db".' in sql
        # Should have UNION ALL
        assert "UNION ALL" in sql
        # Should reference both buckets
        assert "bucket-a" in sql
        assert "bucket-b" in sql
        # Should access metadata as STRUCT
        assert "metadata.experiment_id" in sql
        # Should have _src_bucket alias
        assert "_src_bucket" in sql
        # Should filter on 'latest' tag
        assert "tag_name = 'latest'" in sql
        # Should join package_revision + package_manifest + package_tag
        assert "package_revision" in sql
        assert "package_manifest" in sql
        assert "package_tag" in sql

    @patch("src.package_query.RoleManager")
    def test_iceberg_with_multiple_matches_per_bucket(self, mock_role_manager_class):
        """Iceberg path handles multiple packages from same bucket."""
        mock_athena = Mock()
        mock_glue = Mock()

        mock_role_manager = Mock()
        mock_session = Mock()
        mock_session.client.side_effect = lambda service, **kw: {
            "athena": mock_athena,
            "glue": mock_glue,
        }[service]
        mock_role_manager._get_or_create_session.return_value = (mock_session, None)
        mock_role_manager.role_arn = None
        mock_role_manager._session = None
        mock_role_manager._expires_at = None
        mock_role_manager_class.return_value = mock_role_manager

        query = PackageQuery(
            bucket="",
            catalog_url="catalog.example.com",
            database="test_db",
            region="us-west-2",
            iceberg_database="iceberg_db",
        )

        mock_glue.get_tables.return_value = {
            "TableList": [
                {"Name": "bucket_a_package_manifest"},
            ]
        }

        query._execute_query = Mock(
            return_value=[
                {
                    "pkg_name": "benchling/pkg-1",
                    "timestamp": "latest",
                    "message": "v1",
                    "user_meta": '{"experiment_id": "EXP-1"}',
                    "_src_bucket": "bucket-a",
                },
                {
                    "pkg_name": "benchling/pkg-2",
                    "timestamp": "latest",
                    "message": "v2",
                    "user_meta": '{"experiment_id": "EXP-1"}',
                    "_src_bucket": "bucket-a",
                },
            ]
        )

        result = query.find_unique_packages("experiment_id", "EXP-1")

        assert len(result["packages"]) == 2
        assert [(p.bucket, p.package_name) for p in result["packages"]] == [
            ("bucket-a", "benchling/pkg-1"),
            ("bucket-a", "benchling/pkg-2"),
        ]
