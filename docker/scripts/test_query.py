#!/usr/bin/env python3
"""
Test script for Quilt package query functionality using Athena database.

This script queries packages by metadata key-value pairs using direct
Athena SQL queries instead of Elasticsearch via quilt3.search().
"""

import argparse
import json
import os
import sys

import structlog

# Add parent directory to path so we can import from src
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.package_query import PackageQuery  # noqa: E402
from src.xdg_config import XDGConfig  # noqa: E402

# Configure structured logging
structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer(),
    ]
)

logger = structlog.get_logger(__name__)


def print_debug_info(results):
    """Print debug information when no packages are found."""
    row_count = len(results.get("rows", []))

    print("\nDebug info:")
    print(f"  Database rows returned: {row_count}")

    if row_count > 0:
        print("\n  Sample metadata from results:")
        for i, row in enumerate(results.get("rows", [])[:3], 1):
            print(f"    Row {i}: {row.get('pkg_name', 'N/A')}")
            metadata = row.get("metadata", "{}")
            try:
                parsed = json.loads(metadata)
                print(f"      Metadata keys: {list(parsed.keys())}")
            except (json.JSONDecodeError, TypeError, AttributeError):
                print(f"      Metadata: {metadata[:100]}...")

        print("\n  ⚠️  Found database rows but they didn't match the key-value criteria.")
        print("     Check that the metadata contains the exact key-value pair.")


def print_packages_found(packages, results):
    """Print information about found packages."""
    print(f"\nFound {len(packages)} unique package(s):\n")
    for i, package in enumerate(packages, 1):
        print(f"{i}. {package.package_name}")
        print(f"   Bucket: {package.bucket}")
        print(f"   Catalog URL: {package.catalog_url}")

        # Show version info if available
        package_info = results.get("package_info", {})
        if package.package_name in package_info:
            info = package_info[package.package_name]
            versions = info.get("versions", [])
            tags = [v["tag"] for v in versions[:3]]
            print(f"   Tags: {', '.join(tags)}")
            if len(versions) > 3:
                print(f"   ... and {len(versions) - 3} more versions")

    print()


def main():
    """Main entry point for CLI."""
    parser = argparse.ArgumentParser(
        description="Query Athena database for Quilt packages by metadata",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Search by entry_id using XDG configuration (default profile)
  %(prog)s --key entry_id

  # Search using specific XDG profile
  %(prog)s --key entry_id --profile dev

  # Search by entry_id with custom value
  %(prog)s --key entry_id --value etr_123

  # Search by id (for nested metadata)
  %(prog)s --key id --value etr_fZ9XzOQV

  # Output as JSON
  %(prog)s --key entry_id --value etr_123 --json

Configuration Priority:
  1. CLI arguments (--bucket, --catalog, --database, --value)
  2. Environment variables (QUILT_USER_BUCKET, QUILT_CATALOG, QUILT_DATABASE, BENCHLING_TEST_ENTRY)
  3. XDG configuration (~/.config/benchling-webhook/default.json)

Environment Variables:
  QUILT_DATABASE      - Athena database name (required)
  QUILT_USER_BUCKET   - S3 bucket name for registry (required)
  QUILT_CATALOG       - Quilt catalog URL (required)
  BENCHLING_TEST_ENTRY - Default entry_id value for testing
  AWS_REGION          - AWS region (default: us-east-1)
        """,
    )

    parser.add_argument(
        "--key",
        type=str,
        default="entry_id",
        help="Metadata key to search (default: 'entry_id')",
    )

    parser.add_argument(
        "--value",
        type=str,
        help="Metadata value to search for (default: from BENCHLING_TEST_ENTRY env var)",
    )

    parser.add_argument(
        "--bucket",
        type=str,
        help="S3 bucket name (overrides QUILT_USER_BUCKET env var)",
    )

    parser.add_argument(
        "--catalog",
        type=str,
        help="Quilt catalog URL (overrides QUILT_CATALOG env var)",
    )

    parser.add_argument(
        "--database",
        type=str,
        help="Athena database name (overrides QUILT_DATABASE env var)",
    )

    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON",
    )

    parser.add_argument(
        "--profile",
        type=str,
        default="default",
        help="XDG configuration profile (default: default)",
    )

    args = parser.parse_args()

    # Load configuration with priority: CLI args > XDG config
    value = args.value
    bucket = args.bucket
    catalog_url = args.catalog
    database = args.database

    # If not provided via CLI, load from XDG config
    if not (bucket and catalog_url and database):
        try:
            logger.info("Loading configuration from XDG", profile=args.profile)
            xdg = XDGConfig(profile=args.profile)
            config = xdg.load_complete_config()

            # Map XDG config fields to variables (only if not already set)
            bucket = bucket or config.get("quiltUserBucket")
            catalog_url = catalog_url or config.get("quiltCatalog")
            database = database or config.get("quiltDatabase")
            value = value or config.get("benchlingTestEntry")

            logger.info("Loaded configuration from XDG", profile=args.profile)
        except FileNotFoundError as e:
            logger.error("XDG configuration not found", error=str(e), hint="Run 'npm run setup' to configure")
            sys.exit(1)
        except Exception as e:
            logger.error("Failed to load XDG configuration", error=str(e))
            sys.exit(1)

    # Get default value from fallback
    if not value:
        parser.error("Must provide --value or configure benchlingTestEntry in XDG config")

    # Validate required configuration
    if not bucket:
        logger.error("No bucket specified. Provide via --bucket or XDG config")
        sys.exit(1)

    if not catalog_url:
        logger.error("No catalog URL specified. Provide via --catalog or XDG config")
        sys.exit(1)

    if not database:
        logger.error("No database specified. Provide via --database or XDG config")
        sys.exit(1)

    logger.info(
        "Configuration loaded",
        catalog=catalog_url,
        bucket=bucket,
        database=database,
    )

    # Create query client
    query = PackageQuery(bucket, catalog_url, database=database)

    try:
        # Perform query (returns dict with packages and results)
        query_result = query.find_unique_packages(args.key, value)
        packages = query_result["packages"]
        results = query_result["results"]

        # Output results
        if args.json:
            # Extract package names for JSON output
            package_names = [pkg.package_name for pkg in packages]
            print(json.dumps(package_names, indent=2))
        elif not packages:
            print("\nNo packages found.")
            print_debug_info(results)
        else:
            print_packages_found(packages, results)

    except Exception as e:
        logger.error("Query failed", error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
