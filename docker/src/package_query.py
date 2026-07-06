"""Package query utilities using direct Athena database access.

This module provides an alternative to PackageSearcher that queries
the Athena database directly instead of using Elasticsearch via quilt3.search().

Responsibilities:
- Query Athena's {bucket}_packages-view (parquet-backed) or Iceberg manifest tables
- Search for packages by metadata key-value pairs
- Return Package instances matching the search criteria
- Use RoleManager for cross-account Athena access

Requires:
- QUILT_DATABASE environment variable with Athena database name
- QUILT_USER_BUCKET environment variable for the registry (bucket)
- QUILT_WRITE_ROLE_ARN environment variable for cross-account access (optional)
- AWS credentials configured for Athena access

For Iceberg-backed bucketless search (v0.19.0+):
- QUILT_ICEBERG_DATABASE environment variable with Iceberg Glue database name
  When set, bucketless mode uses a single Iceberg query instead of fanning out
  concurrent Athena queries.
"""

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import TYPE_CHECKING, Any, Dict, List, Optional

import structlog

from src.auth.role_manager import RoleManager
from src.packages import Package

if TYPE_CHECKING:
    from .config import Config

logger = structlog.get_logger(__name__)

DEFAULT_BUCKETLESS_SEARCH_WORKERS = 12

# Suffix for the per-bucket Iceberg package_manifest table.
_ICEBERG_MANIFEST_SUFFIX = "_package_manifest"

# Suffix for the per-bucket parquet-backed packages-view.
_PACKAGES_VIEW_SUFFIX = "_packages-view"

_METADATA_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class PackageQuery:
    """Query Athena database for packages by metadata.

    This class provides direct SQL queries against Athena tables as an alternative
    to Elasticsearch-based search. It queries the {bucket}_packages-view to find
    packages matching metadata criteria.

    The Athena database contains a packages view per bucket:
    - {bucket}_packages-view: Contains pkg_name, timestamp, message, user_meta

    When an Iceberg database is configured and no specific bucket is set (bucketless),
    it uses Iceberg manifest tables for faster, single-query search instead of
    concurrent fanout.
    """

    def __init__(
        self,
        bucket: str,
        catalog_url: str,
        database: Optional[str] = None,
        region: Optional[str] = None,
        workgroup: Optional[str] = None,
        config: Optional["Config"] = None,
        iceberg_database: Optional[str] = None,
    ):
        """Initialize Athena query client.

        Args:
            bucket: S3 bucket name (used as registry in Athena tables)
            catalog_url: Quilt catalog URL (without https:// prefix)
            database: Athena database name (defaults to QUILT_DATABASE env var)
            region: AWS region (defaults to AWS_REGION env var or us-east-1)
            workgroup: Athena workgroup name (defaults to ATHENA_USER_WORKGROUP env var, then 'primary')
                Query results are managed automatically by the workgroup's AWS-managed configuration.
            config: Optional Config instance for reading configuration (v0.8.0+)
                If provided, will use config.athena_user_workgroup as fallback before env vars.
            iceberg_database: Optional Iceberg Glue database name (v0.19.0+)
                When set and bucket is empty (bucketless), uses Iceberg manifest tables
                for single-query search instead of concurrent fanout across _packages-view
                tables. Overrides config.quilt_iceberg_database if provided.
        """
        self.bucket = bucket
        self.catalog_url = catalog_url
        self.database = database or os.getenv("QUILT_DATABASE")
        self.region = region or os.getenv("AWS_REGION", "us-east-1")
        self.logger = structlog.get_logger(__name__)
        self.config = config

        if not self.database:
            raise ValueError("database parameter or QUILT_DATABASE environment variable required")

        # Iceberg database for bucketless optimized search
        self.iceberg_database = (
            iceberg_database
            or (config.quilt_iceberg_database if config else "")
            or os.getenv("QUILT_ICEBERG_DATABASE", "")
        )

        # Initialize RoleManager for cross-account access
        role_arn = None
        if config and config.quilt_write_role_arn:
            role_arn = config.quilt_write_role_arn
        self.role_manager = RoleManager(role_arn=role_arn, region=self.region)

        # Initialize Athena client with role assumption
        athena_session = self.role_manager._get_or_create_session(
            self.role_manager.role_arn,
            self.role_manager._session,
            self.role_manager._expires_at,
        )[0]
        self.athena = athena_session.client("athena")

        # Determine Athena workgroup
        # Priority: parameter > config.athena_user_workgroup > ATHENA_USER_WORKGROUP env var > 'primary'
        if workgroup:
            self.workgroup = workgroup
        elif config and config.athena_user_workgroup:
            self.workgroup = config.athena_user_workgroup
        else:
            self.workgroup = os.getenv("ATHENA_USER_WORKGROUP", "primary")

        # Note: AWS-managed workgroups handle query results automatically
        # No need to specify output location - workgroup configuration takes precedence

        # Lazily initialized Glue client (for listing Iceberg tables)
        self._glue = None

        self.logger.info(
            "Initialized PackageQuery",
            database=self.database,
            iceberg_database=self.iceberg_database or "(not configured)",
            bucket=bucket,
            catalog=catalog_url,
            region=self.region,
            workgroup=self.workgroup,
        )

    def _execute_query(self, query: str, timeout: int = 30) -> List[Dict[str, Any]]:
        """Execute an Athena query and return results.

        Args:
            query: SQL query string
            timeout: Maximum time to wait for query completion (seconds)

        Returns:
            List of result rows as dictionaries

        Raises:
            TimeoutError: If query doesn't complete within timeout
            RuntimeError: If query fails
        """
        self.logger.debug("Executing Athena query", query=query, workgroup=self.workgroup)

        # Start query execution with workgroup
        # Note: When workgroup has AWS-managed results, do NOT specify ResultConfiguration
        # The workgroup handles query results location automatically
        response = self.athena.start_query_execution(
            QueryString=query,
            QueryExecutionContext={"Database": self.database},
            WorkGroup=self.workgroup,
        )

        query_execution_id = response["QueryExecutionId"]
        self.logger.debug("Query started", execution_id=query_execution_id, workgroup=self.workgroup)

        # Wait for query to complete
        start_time = time.time()
        while True:
            if time.time() - start_time > timeout:
                raise TimeoutError(f"Query timeout after {timeout}s: {query_execution_id}")

            status = self.athena.get_query_execution(QueryExecutionId=query_execution_id)
            state = status["QueryExecution"]["Status"]["State"]

            if state == "SUCCEEDED":
                break
            elif state in ["FAILED", "CANCELLED"]:
                error_msg = status["QueryExecution"]["Status"].get("StateChangeReason", "Unknown error")
                raise RuntimeError(f"Query failed: {error_msg}")

            time.sleep(0.5)

        # Get results
        results = self.athena.get_query_results(QueryExecutionId=query_execution_id)
        self.logger.debug(
            "Query succeeded", execution_id=query_execution_id, row_count=len(results["ResultSet"]["Rows"])
        )

        # Parse results into list of dicts
        rows = results["ResultSet"]["Rows"]
        if not rows:
            return []

        # Extract column names from header row
        headers = [col.get("VarCharValue", "") for col in rows[0]["Data"]]

        # Convert data rows to dictionaries
        data_rows = []
        for row in rows[1:]:  # Skip header row
            row_dict = {}
            for i, cell in enumerate(row["Data"]):
                value = cell.get("VarCharValue")
                row_dict[headers[i]] = value
            data_rows.append(row_dict)

        return data_rows

    def _validate_metadata_key(self, key: str) -> str:
        """Validate a metadata key before using it as a SQL identifier."""
        if not _METADATA_KEY_RE.match(key):
            raise ValueError(
                f"Invalid metadata key '{key}'. Iceberg metadata keys must be SQL-safe identifiers "
                "matching [A-Za-z_][A-Za-z0-9_]*."
            )
        return key

    def _parse_user_meta(self, raw_meta: Optional[str], *, pkg_name: str, key: str, value: str) -> Dict[str, Any]:
        """Parse metadata returned from Athena, falling back to the matched key/value."""
        if not raw_meta:
            return {key: value}

        try:
            parsed = json.loads(raw_meta)
            if isinstance(parsed, dict):
                return parsed
            self.logger.warning(
                "Athena metadata JSON was not an object",
                pkg_name=pkg_name,
                metadata_type=type(parsed).__name__,
            )
        except json.JSONDecodeError:
            self.logger.warning("Failed to parse user_meta JSON", pkg_name=pkg_name)

        return {key: value}

    def _format_aws_error(self, error: Exception) -> str:
        """Return an actionable error message for common AWS query failures."""
        error_msg = str(error)
        response = getattr(error, "response", None)
        operation = getattr(error, "operation_name", "") or ""
        code = ""
        if isinstance(response, dict):
            code = response.get("Error", {}).get("Code", "")
            operation = operation or response.get("ResponseMetadata", {}).get("OperationName", "")

        lowered = error_msg.lower()
        access_denied = (
            "accessdenied" in lowered
            or "access denied" in lowered
            or "not authorized" in lowered
            or code in {"AccessDenied", "AccessDeniedException", "UnauthorizedOperation"}
        )

        if not access_denied:
            return error_msg

        if operation.lower() == "gettables" or "get_tables" in lowered or "glue" in lowered:
            return (
                "AWS Glue access denied. Please check IAM permissions for "
                f"glue:GetTables on Iceberg database '{self.iceberg_database or '(not configured)'}'."
            )

        if operation.lower() in {"startqueryexecution", "getqueryexecution", "getqueryresults"} or "athena" in lowered:
            return (
                "AWS Athena access denied. Please check IAM permissions for "
                f"athena query execution on workgroup '{self.workgroup}'."
            )

        return (
            "AWS access denied while searching for linked packages. Please check task role "
            f"permissions for Athena workgroup '{self.workgroup}' and Iceberg database "
            f"'{self.iceberg_database or '(not configured)'}'."
        )

    # ------------------------------------------------------------------
    # Parquet-backed _packages-view search (legacy, for non-Iceberg deployments)
    # ------------------------------------------------------------------

    def _list_package_view_buckets(self) -> List[str]:
        query = f"""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = '{self.database}'
            AND table_name LIKE '%\\_packages-view' ESCAPE '\\'
        """
        rows = self._execute_query(query)
        buckets: List[str] = []
        for row in rows:
            table_name = row.get("table_name") or row.get("TABLE_NAME")
            if isinstance(table_name, str) and table_name.endswith(_PACKAGES_VIEW_SUFFIX):
                buckets.append(table_name[: -len(_PACKAGES_VIEW_SUFFIX)])
        return sorted(set(buckets))

    def _find_unique_packages_in_bucket(
        self,
        bucket: str,
        key: str,
        value: str,
        timeout: int = 30,
    ) -> Dict[str, Any]:
        self.logger.info(
            "Searching for packages by metadata",
            key=key,
            value=value,
            bucket=bucket,
        )

        view_name = f'"{self.database}"."{bucket}_packages-view"'

        query = f"""
        SELECT pkg_name, timestamp, message, user_meta
        FROM {view_name}
        WHERE json_extract_scalar(user_meta, '$.{key}') = '{value}'
            AND timestamp = 'latest'
        LIMIT 100
        """

        rows = self._execute_query(query, timeout=timeout)

        self.logger.info(
            "Query completed",
            row_count=len(rows),
            key=key,
            value=value,
            bucket=bucket,
        )

        package_info: Dict[str, Dict[str, Any]] = {}

        for row in rows:
            pkg_name = row["pkg_name"]
            user_meta_str = row.get("user_meta", "{}")

            user_meta = self._parse_user_meta(user_meta_str, pkg_name=pkg_name, key=key, value=value)

            if pkg_name not in package_info:
                package_info[pkg_name] = {
                    "bucket": bucket,
                    "versions": [],
                    "metadata": user_meta,
                    "timestamp": row.get("timestamp"),
                    "message": row.get("message"),
                }

        packages = [
            Package(
                catalog_base_url=self.catalog_url,
                bucket=info["bucket"],
                package_name=name,
            )
            for name, info in sorted(package_info.items())
        ]

        return {
            "packages": packages,
            "results": {
                "rows": rows,
                "package_info": package_info,
            },
        }

    def _bucketless_worker_count(self, bucket_count: int) -> int:
        configured = os.getenv("BUCKETLESS_SEARCH_WORKERS")
        if configured:
            try:
                worker_count = int(configured)
            except ValueError:
                self.logger.warning("Ignoring invalid BUCKETLESS_SEARCH_WORKERS value", value=configured)
                worker_count = DEFAULT_BUCKETLESS_SEARCH_WORKERS
        else:
            worker_count = DEFAULT_BUCKETLESS_SEARCH_WORKERS

        return max(1, min(worker_count, bucket_count))

    def _find_unique_packages_in_all_buckets(self, key: str, value: str) -> Dict[str, Any]:
        buckets = self._list_package_view_buckets()
        all_packages: List[Package] = []
        rows: List[Dict[str, Any]] = []
        package_info: Dict[str, Dict[str, Any]] = {}
        errors: Dict[str, str] = {}

        if not buckets:
            return {
                "packages": all_packages,
                "results": {
                    "rows": rows,
                    "package_info": package_info,
                    "errors": errors,
                },
            }

        workers = self._bucketless_worker_count(len(buckets))
        self.logger.info("Searching package views concurrently", bucket_count=len(buckets), workers=workers)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self._find_unique_packages_in_bucket, bucket, key, value, 10): bucket
                for bucket in buckets
            }
            for future in as_completed(futures):
                bucket = futures[future]
                try:
                    bucket_result = future.result()
                except Exception as exc:
                    errors[bucket] = str(exc)
                    self.logger.warning("Bucket package lookup failed", bucket=bucket, error=str(exc))
                    continue

                all_packages.extend(bucket_result["packages"])
                rows.extend(bucket_result["results"]["rows"])
                for name, info in bucket_result["results"]["package_info"].items():
                    package_info[f"{info['bucket']}/{name}"] = info

        return {
            "packages": sorted(all_packages, key=lambda p: (p.bucket, p.package_name)),
            "results": {
                "rows": rows,
                "package_info": package_info,
                "errors": errors,
            },
        }

    # ------------------------------------------------------------------
    # Iceberg-backed search (v0.19.0+: single-query, no fanout)
    # ------------------------------------------------------------------

    def _glue_client(self):
        """Lazily initialize a Glue client from the assumed-role session."""
        if self._glue is None:
            session = self.role_manager._get_or_create_session(
                self.role_manager.role_arn,
                self.role_manager._session,
                self.role_manager._expires_at,
            )[0]
            self._glue = session.client("glue", region_name=self.region)
        return self._glue

    def _list_iceberg_manifest_buckets(self) -> List[str]:
        """List buckets with Iceberg package_manifest tables via Glue API.

        Uses the Glue get_tables API (not Athena information_schema) since
        the Iceberg tables live in a different Glue database than the main
        Athena query context.

        Returns:
            Sorted list of bucket names (without the '_package_manifest' suffix).
        """
        glue = self._glue_client()
        buckets: List[str] = []
        next_token: Optional[str] = None

        while True:
            kwargs: Dict[str, Any] = {"DatabaseName": self.iceberg_database}
            if next_token:
                kwargs["NextToken"] = next_token

            response = glue.get_tables(**kwargs)
            for table in response.get("TableList", []):
                name = table.get("Name", "")
                if name.endswith(_ICEBERG_MANIFEST_SUFFIX):
                    buckets.append(name[: -len(_ICEBERG_MANIFEST_SUFFIX)])

            next_token = response.get("NextToken")
            if not next_token:
                break

        return sorted(set(buckets))

    def _build_iceberg_union_query(self, buckets: List[str], key: str, value: str) -> str:
        """Build a single UNION ALL query across Iceberg tables for all buckets.

        Joins package_revision ↔ package_manifest on top_hash, filtered to
        'latest' tag via package_tag, and filters on metadata.{key} = '{value}'.
        STRUCT field access is schema-native — no json_extract_scalar needed.

        The metadata column in Iceberg is a native Athena STRUCT, so accessing
        a field by name is faster than json_extract_scalar on a raw JSON string.

        Args:
            buckets: List of bucket names to search
            key: Metadata key to filter on (used as STRUCT field name)
            value: Metadata value to match

        Returns:
            Complete SQL query string with one UNION ALL branch per bucket.
        """
        escaped_value = value.replace("'", "''")
        idb = self.iceberg_database
        branches: List[str] = []
        for b in buckets:
            branch = f"""
            SELECT
                r.pkg_name,
                r.timestamp,
                m.message,
                json_format(CAST(m.metadata AS JSON)) AS user_meta,
                '{b}' AS _src_bucket
            FROM "{idb}"."{b}_package_revision" r
            JOIN "{idb}"."{b}_package_manifest" m ON r.top_hash = m.top_hash
            JOIN "{idb}"."{b}_package_tag" t
                ON r.pkg_name = t.pkg_name
                AND r.top_hash = t.top_hash
                AND t.tag_name = 'latest'
            WHERE m.metadata.{key} = '{escaped_value}'
            """
            branches.append(branch)

        return "\nUNION ALL\n".join(branches)

    def _find_unique_packages_in_iceberg(self, key: str, value: str) -> Dict[str, Any]:
        """Search for packages across all Iceberg-managed buckets using a single query.

        Replaces the concurrent fanout with one Athena query using UNION ALL
        across all buckets' Iceberg manifest tables.

        Returns:
            Same structure as _find_unique_packages_in_all_buckets()
        """
        buckets = self._list_iceberg_manifest_buckets()

        if not buckets:
            self.logger.info("No Iceberg manifest tables found", iceberg_database=self.iceberg_database)
            return {
                "packages": [],
                "results": {
                    "rows": [],
                    "package_info": {},
                    "errors": {},
                },
            }

        self.logger.info(
            "Searching Iceberg manifests with single query",
            bucket_count=len(buckets),
            iceberg_database=self.iceberg_database,
            key=key,
            value=value,
        )

        query = self._build_iceberg_union_query(buckets, key, value)
        rows = self._execute_query(query, timeout=60)

        self.logger.info("Iceberg query completed", row_count=len(rows))

        package_info: Dict[str, Dict[str, Any]] = {}
        errors: Dict[str, str] = {}

        for row in rows:
            bucket = row.get("_src_bucket", "")
            pkg_name = row["pkg_name"]
            user_meta_str = row.get("user_meta", "{}")

            user_meta = self._parse_user_meta(user_meta_str, pkg_name=pkg_name, key=key, value=value)

            composite_key = f"{bucket}/{pkg_name}"
            if composite_key not in package_info:
                package_info[composite_key] = {
                    "bucket": bucket,
                    "pkg_name": pkg_name,
                    "versions": [],
                    "metadata": user_meta,
                    "timestamp": row.get("timestamp"),
                    "message": row.get("message"),
                }

        packages = [
            Package(
                catalog_base_url=self.catalog_url,
                bucket=info["bucket"],
                package_name=info["pkg_name"],
            )
            for info in sorted(package_info.values(), key=lambda i: (i["bucket"], i["pkg_name"]))
        ]

        return {
            "packages": sorted(packages, key=lambda p: (p.bucket, p.package_name)),
            "results": {
                "rows": rows,
                "package_info": package_info,
                "errors": errors,
            },
        }

    def find_unique_packages(self, key: str, value: str) -> Dict[str, Any]:
        """Find unique packages matching metadata key-value pair.

        Queries the {bucket}_packages-view for packages with user_meta containing
        the specified key-value pair using json_extract_scalar.

        When in bucketless mode (bucket is empty) and an Iceberg database is
        configured, uses a single-query Iceberg UNION ALL instead of concurrent
        fanout across _packages-view tables.

        Args:
            key: Metadata key to search for (e.g., "entry_id", "id", "display_id")
            value: Metadata value to search for (e.g., "etr_EK1AQMQiQn", "EXP25000076")

        Returns:
            Dict with:
                - packages: List of Package instances (from packages.py)
                - results: Dict with raw query results for debugging
                    - rows: List of matching rows from database
                    - package_info: Dict mapping package names to version info

        Example:
            >>> query = PackageQuery("my-bucket", "catalog.example.com")
            >>> result = query.find_unique_packages("entry_id", "etr_123")
            >>> packages = result["packages"]
            >>> for pkg in packages:
            ...     print(f"{pkg.package_name}: {pkg.catalog_url}")
        """
        try:
            self._validate_metadata_key(key)

            self.logger.info(
                "Searching for packages by metadata",
                key=key,
                value=value,
                bucket=self.bucket or "(bucketless)",
                iceberg_database=self.iceberg_database or "(not configured)",
            )

            # Bucketless with Iceberg: single-query path (fastest)
            if not self.bucket and self.iceberg_database:
                result = self._find_unique_packages_in_iceberg(key, value)
            # Bucketless without Iceberg: concurrent fanout (legacy fallback)
            elif not self.bucket:
                result = self._find_unique_packages_in_all_buckets(key, value)
            # Specific bucket: direct single-bucket query
            else:
                result = self._find_unique_packages_in_bucket(self.bucket, key, value)

            self.logger.info(
                "Found unique packages",
                package_count=len(result["packages"]),
                packages=[f"{p.bucket}/{p.package_name}" for p in result["packages"]],
            )

            return result

        except Exception as e:
            error_msg = self._format_aws_error(e)

            self.logger.error(
                "Query failed",
                key=key,
                value=value,
                error=error_msg,
                error_type=type(e).__name__,
            )
            raise RuntimeError(error_msg) from e
