#!/usr/bin/env python3
"""
BDD-style test for Benchling entry packaging workflow.

Tests user-facing behaviors:
- GIVEN a Benchling entry ID
- WHEN we fetch and package the entry
- THEN all required metadata is captured correctly

User Intent: Package a Benchling entry with complete metadata for Quilt
"""

import argparse
import os
import sys
from pathlib import Path

from benchling_sdk.auth.client_credentials_oauth2 import ClientCredentialsOAuth2
from benchling_sdk.benchling import Benchling
from dotenv import load_dotenv

# Import the classes and functions we're testing
sys.path.insert(0, str(Path(__file__).parent.parent))
from src.config import Config  # type: ignore
from src.entry_packager import EntryPackager  # type: ignore
from src.payload import Payload  # type: ignore


class BehaviorTest:
    """BDD-style behavior test for entry packaging."""

    def __init__(self, benchling: Benchling):
        self.benchling = benchling
        self.results = {"scenarios": [], "passed": 0, "failed": 0}

    def given_entry_id(self, entry_id: str):
        """GIVEN: We have a valid Benchling entry ID."""
        print(f"\n{'='*70}")
        print(f"SCENARIO: Package Benchling Entry for Quilt")
        print(f"{'='*70}\n")
        print(f"GIVEN: Entry ID '{entry_id}'")
        self.entry_id = entry_id
        return self

    def when_entry_is_fetched(self):
        """WHEN: We fetch the entry using the packager."""
        print(f"WHEN:  Fetching entry via EntryPackager...")

        try:
            # Create minimal test config (S3/SQS not used here)
            test_config = Config(
                s3_bucket_name="test-bucket",
                sqs_queue_url="https://sqs.us-east-2.amazonaws.com/test/queue",
                aws_region="us-east-2",
            )
            packager = EntryPackager(self.benchling, config=test_config)
            self.entry_data = packager._fetch_entry_data(self.entry_id)
            print(f"       ✅ Entry fetched successfully")
            return self
        except Exception as e:
            print(f"       ❌ Failed to fetch: {e}")
            self.entry_data = None
            raise

    def then_should_have_required_metadata(self):
        """THEN: The entry data should contain all required metadata fields."""
        print(f"THEN:  Entry data should contain required metadata fields\n")

        if not self.entry_data:
            self._record_failure("Entry data is None")
            return self

        # Required fields per user intent
        required_fields = {
            "display_id": "Human-readable entry identifier (e.g., EXP00001234)",
            "name": "Entry name/title",
            "web_url": "Benchling web URL for viewing",
            "created_at": "Entry creation timestamp",
            "modified_at": "Last modification timestamp",
            "id": "Benchling entry ID",
        }

        # Optional but important fields
        optional_fields = {
            "creator": "Entry creator information",
            "authors": "List of authors",
            "fields": "Custom entry fields",
        }

        print("Required Fields:")
        print("-" * 70)
        all_present = True

        for field, description in required_fields.items():
            value = self.entry_data.get(field)
            if value is not None:
                # Truncate long values for display
                display_value = str(value)[:50]
                if len(str(value)) > 50:
                    display_value += "..."
                print(f"  ✅ {field:15s} = {display_value}")
                print(f"     ({description})")
            else:
                print(f"  ❌ {field:15s} = MISSING")
                print(f"     ({description})")
                all_present = False

        print(f"\nOptional Fields:")
        print("-" * 70)

        for field, description in optional_fields.items():
            value = self.entry_data.get(field)
            if value is not None:
                if isinstance(value, (list, dict)):
                    display_value = f"{type(value).__name__} with {len(value)} items"
                else:
                    display_value = str(value)[:50]
                    if len(str(value)) > 50:
                        display_value += "..."
                print(f"  ✅ {field:15s} = {display_value}")
            else:
                print(f"  ⚠️  {field:15s} = Not present")

        print(f"\n{'='*70}")

        if all_present:
            self._record_success()
            print(f"✅ SCENARIO PASSED: All required fields present\n")
        else:
            self._record_failure("Missing required fields")
            print(f"❌ SCENARIO FAILED: Missing required fields\n")

        return self

    def then_display_id_should_be_human_readable(self):
        """THEN: The display_id should be human-readable, not an internal ID."""
        print(f"THEN:  display_id should be human-readable (not internal ID)\n")

        display_id = self.entry_data.get("display_id")
        entry_id = self.entry_data.get("id")

        if not display_id:
            self._record_failure("display_id is missing")
            print(f"  ❌ display_id is missing\n")
            return self

        if display_id == entry_id:
            self._record_failure(f"display_id '{display_id}' equals entry ID (should be human-readable)")
            print(f"  ❌ display_id '{display_id}' equals entry ID")
            print(f"     Expected: Human-readable format (e.g., EXP00001234, ELN-123)")
            print(f"     Got:      Internal ID format\n")
        else:
            self._record_success()
            print(f"  ✅ display_id '{display_id}' is distinct from entry ID")
            print(f"     Entry ID: {entry_id}")
            print(f"     This is human-readable ✓\n")

        return self

    def then_should_have_creator_and_authors(self):
        """THEN: Should have properly parsed creator and authors information."""
        print(f"THEN:  Should have creator and authors information\n")

        creator = self.entry_data.get("creator")
        authors = self.entry_data.get("authors")

        has_creator = creator and isinstance(creator, dict)
        has_authors = authors and isinstance(authors, list) and len(authors) > 0

        if has_creator:
            creator_name = creator.get("name", "N/A")
            print(f"  ✅ creator: {creator_name}")
            self._record_success()
        else:
            print(f"  ⚠️  creator: Not available or invalid format")

        if has_authors:
            print(f"  ✅ authors: {len(authors)} author(s)")
            for author in authors[:3]:  # Show first 3
                if isinstance(author, dict):
                    author_name = author.get("name", "N/A")
                    print(f"     - {author_name}")
            self._record_success()
        else:
            print(f"  ⚠️  authors: Not available or invalid format")

        print()
        return self

    def _record_success(self):
        """Record a successful assertion."""
        self.results["passed"] += 1

    def _record_failure(self, reason: str):
        """Record a failed assertion."""
        self.results["failed"] += 1
        self.results["scenarios"].append({"status": "FAILED", "reason": reason})

    def print_summary(self):
        """Print test summary."""
        print(f"\n{'='*70}")
        print(f"TEST SUMMARY")
        print(f"{'='*70}")
        print(f"Assertions Passed: {self.results['passed']}")
        print(f"Assertions Failed: {self.results['failed']}")

        if self.results["failed"] > 0:
            print(f"\n❌ OVERALL: FAILED")
            return False
        else:
            print(f"\n✅ OVERALL: PASSED")
            return True


def test_oauth_credentials(tenant: str, client_id: str, client_secret: str, entry_id: str = None) -> dict:
    """
    Test Benchling OAuth credentials and entry packaging behavior.

    Args:
        tenant: Benchling tenant name
        client_id: OAuth client ID
        client_secret: OAuth client secret
        entry_id: Optional specific entry ID to test

    Returns:
        Dictionary with test results
    """
    base_url = f"https://{tenant}.benchling.com"

    print(f"Testing Benchling Entry Packaging (BDD Style)")
    print(f"{'='*70}\n")
    print(f"Configuration:")
    print(f"  Tenant:     {tenant}")
    print(f"  Base URL:   {base_url}")
    print(f"  Client ID:  {client_id}")
    print(f"  Secret:     {'*' * (len(client_secret) - 4)}{client_secret[-4:]}")

    try:
        # Initialize SDK with OAuth
        print(f"\nInitializing Benchling SDK...")
        auth_method = ClientCredentialsOAuth2(
            client_id=client_id,
            client_secret=client_secret,
        )
        benchling = Benchling(url=base_url, auth_method=auth_method)
        print(f"✅ SDK initialized\n")

        # Verify API access
        print(f"Verifying API access...")
        entries_response = benchling.entries.list_entries()
        entries = list(entries_response)
        print(f"✅ API accessible ({len(entries)} entries found)\n")

        # Determine which entry to test
        test_entry_id = entry_id or os.environ.get("BENCHLING_TEST_ENTRY")

        if not test_entry_id:
            # Use most recent entry if none specified
            if entries:
                test_entry_id = Payload.get_most_recent_entry(benchling)
                if test_entry_id:
                    print(f"Using most recent entry: {test_entry_id}\n")
                else:
                    print(f"⚠️  No entries available for testing")
                    return {"success": False, "error": "No entries available"}
            else:
                print(f"❌ No entries found and no test entry specified")
                return {"success": False, "error": "No test entry available"}

        # Run BDD-style behavior tests
        test = BehaviorTest(benchling)

        try:
            (
                test.given_entry_id(test_entry_id)
                .when_entry_is_fetched()
                .then_should_have_required_metadata()
                .then_display_id_should_be_human_readable()
                .then_should_have_creator_and_authors()
            )

            success = test.print_summary()

            return {
                "success": success,
                "sdk_initialized": True,
                "api_access": True,
                "test_results": test.results,
            }

        except Exception as e:
            print(f"\n❌ Test execution failed: {e}")
            import traceback

            traceback.print_exc()

            return {
                "success": False,
                "sdk_initialized": True,
                "api_access": True,
                "test_error": str(e),
            }

    except Exception as e:
        print(f"❌ Setup failed: {e}")
        return {"success": False, "error": str(e)}


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Test Benchling entry packaging (BDD style)",
        epilog="""
Examples:
  # Test from .env file
  %(prog)s

  # Test specific entry
  %(prog)s --entry-id etr_abc123

  # Test with CLI credentials
  %(prog)s --tenant mycompany --client-id abc123 --client-secret xyz789
        """,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--env-file", default=".env", help="Path to .env file (default: .env)")
    parser.add_argument("--tenant", "-t", help="Benchling tenant name")
    parser.add_argument("--client-id", "-i", help="OAuth client ID")
    parser.add_argument("--client-secret", "-s", help="OAuth client secret")
    parser.add_argument("--entry-id", "-e", help="Specific entry ID to test")
    args = parser.parse_args()

    # Load environment variables (check if already set first, e.g., from Makefile)
    env_already_set = os.getenv("BENCHLING_TENANT") and os.getenv("BENCHLING_CLIENT_ID")

    if not env_already_set:
        env_path = Path(args.env_file)
        if env_path.exists():
            print(f"Loading credentials from: {env_path.absolute()}\n")
            load_dotenv(env_path)
        elif not (args.tenant and args.client_id and args.client_secret):
            print(f"❌ Error: .env file not found at {env_path}")
            print(f"   Provide credentials via CLI or create .env file")
            sys.exit(1)
    else:
        print(f"Using credentials from environment variables\n")

    # Get credentials (CLI overrides env)
    tenant = args.tenant or os.getenv("BENCHLING_TENANT")
    client_id = args.client_id or os.getenv("BENCHLING_CLIENT_ID")
    client_secret = args.client_secret or os.getenv("BENCHLING_CLIENT_SECRET")
    entry_id = args.entry_id or os.getenv("BENCHLING_TEST_ENTRY")

    # Validate credentials
    missing = []
    if not tenant:
        missing.append("tenant")
    if not client_id:
        missing.append("client_id")
    if not client_secret:
        missing.append("client_secret")

    if missing:
        print(f"❌ Error: Missing required credentials: {', '.join(missing)}")
        sys.exit(1)

    # Run tests
    result = test_oauth_credentials(tenant, client_id, client_secret, entry_id)

    # Exit with appropriate code
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
