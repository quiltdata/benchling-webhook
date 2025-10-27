"""Package query utilities using direct Athena database access.

This module provides an alternative to PackageSearcher that queries
the Athena database directly instead of using Elasticsearch via quilt3.search().

Responsibilities:
- Query Athena's {bucket}_packages-view
- Search for packages by metadata key-value pairs using json_extract_scalar
- Return Package instances matching the search criteria

Requires:
- QUILT_DATABASE environment variable with Athena database name
- S3_BUCKET_NAME environment variable for the registry (bucket)
- AWS credentials configured for Athena access
"""

import json
import os
import time
from typing import Any, Dict, List, Optional

import boto3
import structlog

from src.packages import Package

logger = structlog.get_logger(__name__)


class PackageQuery:
    """Query Athena database for packages by metadata.

    This class provides direct SQL queries against Athena tables as an alternative
    to Elasticsearch-based search. It queries the {bucket}_packages-view to find
    packages matching metadata criteria.

    The Athena database contains a packages view per bucket:
    - {bucket}_packages-view: Contains pkg_name, timestamp, message, user_meta
    """

    def __init__(
        self,
        bucket: str,
        catalog_url: str,
        database: Optional[str] = None,
        region: Optional[str] = None,
        athena_output_bucket: Optional[str] = None,
    ):
        """Initialize Athena query client.

        Args:
            bucket: S3 bucket name (used as registry in Athena tables)
            catalog_url: Quilt catalog URL (without https:// prefix)
            database: Athena database name (defaults to QUILT_DATABASE env var)
            region: AWS region (defaults to AWS_REGION env var or us-east-1)
            athena_output_bucket: S3 bucket for Athena query results
                (defaults to aws-athena-query-results-{account_id}-{region})
        """
        self.bucket = bucket
        self.catalog_url = catalog_url
        self.database = database or os.getenv("QUILT_DATABASE")
        self.region = region or os.getenv("AWS_REGION", "us-east-1")
        self.logger = structlog.get_logger(__name__)

        if not self.database:
            raise ValueError("database parameter or QUILT_DATABASE environment variable required")

        # Initialize Athena client
        self.athena = boto3.client("athena", region_name=self.region)

        # Determine Athena output location
        if athena_output_bucket:
            self.output_location = f"s3://{athena_output_bucket}/"
        else:
            # Get AWS account ID
            sts = boto3.client("sts", region_name=self.region)
            account_id = sts.get_caller_identity()["Account"]
            self.output_location = f"s3://aws-athena-query-results-{account_id}-{self.region}/"

        self.logger.info(
            "Initialized PackageQuery",
            database=self.database,
            bucket=bucket,
            catalog=catalog_url,
            region=self.region,
            output_location=self.output_location,
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
        self.logger.debug("Executing Athena query", query=query)

        # Start query execution
        response = self.athena.start_query_execution(
            QueryString=query,
            QueryExecutionContext={"Database": self.database},
            ResultConfiguration={"OutputLocation": self.output_location},
        )

        query_execution_id = response["QueryExecutionId"]
        self.logger.debug("Query started", execution_id=query_execution_id)

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

    def find_unique_packages(self, key: str, value: str) -> Dict[str, Any]:
        """Find unique packages matching metadata key-value pair.

        Queries the {bucket}_packages-view for packages with user_meta containing
        the specified key-value pair using json_extract_scalar.

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
        self.logger.info(
            "Searching for packages by metadata",
            key=key,
            value=value,
            bucket=self.bucket,
        )

        # Build the view name from bucket
        view_name = f'"{self.database}"."{self.bucket}_packages-view"'

        # Build SQL query using json_extract_scalar for proper JSON querying
        # Filter by timestamp = 'latest' to get only the most recent version
        query = f"""
        SELECT pkg_name, timestamp, message, user_meta
        FROM {view_name}
        WHERE json_extract_scalar(user_meta, '$.{key}') = '{value}'
            AND timestamp = 'latest'
        LIMIT 100
        """

        try:
            rows = self._execute_query(query)

            self.logger.info(
                "Query completed",
                row_count=len(rows),
                key=key,
                value=value,
            )

            # Group results by package name
            package_info: Dict[str, Dict[str, Any]] = {}

            for row in rows:
                pkg_name = row["pkg_name"]
                user_meta_str = row.get("user_meta", "{}")

                # Parse metadata to get additional info
                try:
                    user_meta = json.loads(user_meta_str) if user_meta_str else {}
                except json.JSONDecodeError:
                    self.logger.warning("Failed to parse user_meta JSON", pkg_name=pkg_name)
                    user_meta = {}

                # Add to package_info
                if pkg_name not in package_info:
                    package_info[pkg_name] = {
                        "bucket": self.bucket,
                        "versions": [],
                        "metadata": user_meta,
                        "timestamp": row.get("timestamp"),
                        "message": row.get("message"),
                    }

            # Create Package instances
            packages = [
                Package(
                    catalog_base_url=self.catalog_url,
                    bucket=info["bucket"],
                    package_name=name,
                )
                for name, info in sorted(package_info.items())
            ]

            self.logger.info(
                "Found unique packages",
                package_count=len(packages),
                packages=[p.package_name for p in packages],
            )

            return {
                "packages": packages,
                "results": {
                    "rows": rows,
                    "package_info": package_info,
                },
            }

        except Exception as e:
            error_msg = str(e)
            # Extract more helpful information from AWS errors
            if "AccessDeniedException" in error_msg or "not authorized" in error_msg.lower():
                error_msg = f"AWS Athena access denied. Please check IAM permissions for athena:StartQueryExecution on database '{self.database}'"

            self.logger.error(
                "Query failed",
                key=key,
                value=value,
                error=error_msg,
                error_type=type(e).__name__,
            )
            raise RuntimeError(error_msg) from e
