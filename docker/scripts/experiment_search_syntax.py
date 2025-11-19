#!/usr/bin/env python3
"""
Experiment script to test different Elasticsearch query syntaxes for Quilt.

This script tests various field name patterns to find the correct syntax
for searching package metadata.

Reference: https://docs.quilt.bio/quilt-platform-catalog-user/search
"""

import os
import sys

import quilt3

# Add src to path for local imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from config import get_config  # type: ignore

# Known values to search for
ENTRY_ID = "etr_EK1AQMQiQn"
PACKAGE_NAME = "benchdock/etr_EK1AQMQiQn"


def test_query(description: str, query: str, limit: int = 5):
    """Test a single query and report results."""
    print(f"\n{'='*80}")
    print(f"Test: {description}")
    print(f"Query: {query}")
    print(f"{'='*80}")

    try:
        results = quilt3.search(query, limit=limit)
        print(f"✓ Success - Found {len(results)} result(s)")

        if results:
            for i, r in enumerate(results[:3], 1):  # Show first 3
                print(f"\n  Result {i}:")
                print(f"    Handle: {r.get('handle')}")
                print(f"    Metadata keys: {list(r.get('metadata', {}).keys())}")
                if "entry_id" in r.get("metadata", {}):
                    print(f"    entry_id: {r['metadata']['entry_id']}")

        return len(results) > 0

    except Exception as e:
        print(f"✗ Error: {type(e).__name__}: {e}")
        return False


def main():
    """Run all query experiments."""
    config = get_config()

    # Verify login
    logged_in = quilt3.logged_in()
    print(f"Logged into catalog: {logged_in}")
    print(f"Expected catalog: {config.quilt_catalog}")
    print(f"Bucket: {config.s3_bucket_name}")

    # Normalize URLs for comparison
    logged_in_normalized = logged_in.replace("https://", "").replace("http://", "") if logged_in else ""
    catalog_normalized = config.quilt_catalog.replace("https://", "").replace("http://", "")

    if logged_in_normalized != catalog_normalized:
        print(f"\n⚠️  WARNING: Catalog mismatch!")
        print(f"   Normalized logged in: {logged_in_normalized}")
        print(f"   Normalized expected: {catalog_normalized}")
        return

    print("\n" + "=" * 80)
    print("ELASTICSEARCH QUERY SYNTAX EXPERIMENTS")
    print("=" * 80)

    # Track successful queries
    successful = []

    # Test 1: Package name search
    if test_query("Search by package handle (simple)", PACKAGE_NAME):
        successful.append("Package name search (simple)")

    # Test 2: Wildcard package search
    if test_query("Search by package handle prefix with wildcard", "benchdock/*"):
        successful.append("Package prefix wildcard")

    # Test 3: entry_id bare field
    if test_query("Bare field: entry_id:value", f"entry_id:{ENTRY_ID}"):
        successful.append("entry_id:value")

    # Test 4: mnfst_metadata prefix
    if test_query("Manifest metadata: mnfst_metadata.entry_id:value", f"mnfst_metadata.entry_id:{ENTRY_ID}"):
        successful.append("mnfst_metadata.entry_id:value")

    # Test 5: metadata prefix
    if test_query("Metadata prefix: metadata.entry_id:value", f"metadata.entry_id:{ENTRY_ID}"):
        successful.append("metadata.entry_id:value")

    # Test 6: Quoted value
    if test_query('Quoted value: entry_id:"value"', f'entry_id:"{ENTRY_ID}"'):
        successful.append('entry_id:"value"')

    # Test 7: user_meta prefix (older Quilt versions)
    if test_query("User metadata: user_meta.entry_id:value", f"user_meta.entry_id:{ENTRY_ID}"):
        successful.append("user_meta.entry_id:value")

    # Test 8: Search in handle field
    if test_query("Handle search: handle:benchdock*", "handle:benchdock*"):
        successful.append("handle:benchdock*")

    # Test 9: Fuzzy search for entry ID
    if test_query("Fuzzy search: entry_id value only", ENTRY_ID):
        successful.append("Fuzzy search entry_id")

    # Test 10: Search in package_name metadata
    if test_query("Package name metadata: package_name:value", f"package_name:{PACKAGE_NAME}"):
        successful.append("package_name:value")

    # Test 11: Elasticsearch wildcard in value
    if test_query("Wildcard in value: entry_id:etr_*", "entry_id:etr_*"):
        successful.append("entry_id:etr_*")

    # Test 12: All metadata search
    if test_query("Search all fields with wildcard: *", "*"):
        successful.append("Wildcard * (all)")

    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY - SUCCESSFUL QUERY PATTERNS:")
    print("=" * 80)

    if successful:
        for i, pattern in enumerate(successful, 1):
            print(f"{i}. ✓ {pattern}")
    else:
        print("❌ No successful queries found!")
        print("\nDEBUGGING STEPS:")
        print("1. Verify you're logged into the correct catalog")
        print("2. Check that packages exist with: quilt3.Package.browse('benchdock/etr_EK1AQMQiQn')")
        print("3. Review Quilt catalog search documentation")
        print("4. Check if catalog has Elasticsearch indexing enabled")

    print("\n")


if __name__ == "__main__":
    main()
