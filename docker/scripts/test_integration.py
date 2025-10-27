#!/usr/bin/env python3
"""
Integration test script for Benchling-Quilt webhook integration.
Tests the 4 webhook events defined in app-manifest.yaml.
"""

import json
import sys
import time
from pathlib import Path
from typing import Optional

import requests


class IntegrationTest:
    """Data-driven integration tests for Benchling webhook events."""

    # Map event types to their test data files and expected endpoints/status codes
    MANIFEST_EVENTS = [
        {
            "name": "v2.canvas.userInteracted",
            "file": "../test-events/canvas-interaction.json",
            "endpoint": "/canvas",
            "expected_status": 202,
        },
        {
            "name": "v2.canvas.created",
            "file": "../test-events/canvas-created.json",
            "endpoint": "/canvas",
            "expected_status": 202,
        },
        {
            "name": "v2.entry.created",
            "file": "../test-events/entry-created.json",
            "endpoint": "/event",
            "expected_status": 200,
        },
        {
            "name": "v2.entry.updated.fields",
            "file": "../test-events/entry-updated.json",
            "endpoint": "/event",
            "expected_status": 200,
        },
    ]

    def __init__(self, base_url: str = "http://localhost:5000", entry_id: Optional[str] = None, verbose: bool = False):
        self.base_url = base_url
        self.entry_id = entry_id
        self.verbose = verbose

    def wait_for_health(self, max_attempts: int = 12, interval: int = 5) -> bool:
        """Wait for service to become healthy."""
        print(f"Waiting for service at {self.base_url} to become ready...")

        for attempt in range(1, max_attempts + 1):
            try:
                response = requests.get(f"{self.base_url}/health", timeout=5)
                if response.status_code == 200:
                    print(f"✅ Service is ready! (attempt {attempt}/{max_attempts})")
                    return True
            except requests.exceptions.RequestException:
                pass

            if attempt < max_attempts:
                print(f"Waiting... ({attempt}/{max_attempts})")
                time.sleep(interval)

        print(f"❌ Service failed to become ready after {max_attempts * interval} seconds")
        return False

    def test_health_endpoints(self) -> bool:
        """Test all health check endpoints."""
        print("Testing health endpoints...")

        endpoints = ["/health", "/health/live", "/health/ready"]
        for endpoint in endpoints:
            try:
                response = requests.get(f"{self.base_url}{endpoint}", timeout=5)
                if response.status_code not in [200, 503]:  # 503 acceptable for ready endpoint
                    print(f"❌ {endpoint}: HTTP {response.status_code}")
                    return False
                print(f"✅ {endpoint}: {response.json().get('status', 'OK')}")
            except Exception as e:
                print(f"❌ {endpoint}: {str(e)}")
                return False

        return True

    def test_manifest_event(self, event_config: dict) -> bool:
        """Test a single manifest event using its configuration."""
        event_name = event_config["name"]
        test_file = Path(event_config["file"])
        endpoint = event_config["endpoint"]
        expected_status = event_config["expected_status"]

        print(f"\nTesting {event_name}...")

        # Load test data
        if not test_file.exists():
            print(f"❌ Test data file not found: {test_file}")
            return False

        try:
            with open(test_file, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception as e:
            print(f"❌ Failed to load test data: {str(e)}")
            return False

        # Override entry ID if provided
        if self.entry_id:
            if "message" in payload and "resourceId" in payload["message"]:
                payload["message"]["resourceId"] = self.entry_id
            if "message" in payload and "entryId" in payload["message"]:
                payload["message"]["entryId"] = self.entry_id
            print(f"Using test entry ID: {self.entry_id}")

        if self.verbose:
            print(f"Payload: {json.dumps(payload, indent=2)}")

        # Send webhook
        try:
            response = requests.post(
                f"{self.base_url}{endpoint}",
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=10,
            )

            if self.verbose:
                print(f"Response status: {response.status_code}")
                print(f"Response body: {response.text}")

            if response.status_code != expected_status:
                print(f"❌ {event_name} failed: HTTP {response.status_code} (expected {expected_status})")
                print(f"Response: {response.text}")
                return False

            result = response.json()
            print(f"✅ {event_name}: {result.get('status')}")
            return True

        except Exception as e:
            print(f"❌ {event_name} test failed: {str(e)}")
            return False

    def test_error_handling(self) -> bool:
        """Test error handling paths."""
        print("\nTesting error handling...")

        # Test 404
        try:
            response = requests.get(f"{self.base_url}/nonexistent", timeout=5)
            if response.status_code != 404:
                print(f"❌ Expected 404, got {response.status_code}")
                return False
            print("✅ 404 handler works")
        except Exception as e:
            print(f"❌ 404 test failed: {str(e)}")
            return False

        # Test invalid JSON
        try:
            response = requests.post(
                f"{self.base_url}/event",
                data="invalid json",
                headers={"Content-Type": "application/json"},
                timeout=5,
            )
            if response.status_code not in [400, 500]:
                print(f"❌ Invalid JSON: expected 400/500, got {response.status_code}")
                return False
            print("✅ Invalid JSON handled")
        except Exception as e:
            print(f"❌ Invalid JSON test failed: {str(e)}")
            return False

        # Test unknown event type
        try:
            response = requests.post(
                f"{self.base_url}/event",
                json={
                    "channel": "events",
                    "message": {"type": "v2.unknown.event"},
                    "baseURL": "https://test.benchling.com",
                },
                timeout=5,
            )
            if response.status_code != 200:
                print(f"❌ Unknown event: expected 200, got {response.status_code}")
                return False
            data = response.json()
            if "ignored" not in data.get("status", ""):
                print(f"❌ Expected ignored status, got {data}")
                return False
            print("✅ Unknown event handled")
            return True
        except Exception as e:
            print(f"❌ Unknown event test failed: {str(e)}")
            return False

    def run_all_tests(self) -> bool:
        """Run all integration tests."""
        print("�� Starting Benchling-Quilt Integration Tests")
        print(f"Testing {len(self.MANIFEST_EVENTS)} events from app-manifest.yaml")
        print("=" * 50)

        results = []

        # Test health endpoints
        print(f"\n{'='*50}")
        results.append(("Health endpoints", self.test_health_endpoints()))

        # Test each manifest event
        for event_config in self.MANIFEST_EVENTS:
            print(f"\n{'='*50}")
            success = self.test_manifest_event(event_config)
            results.append((event_config["name"], success))

        # Test error handling
        print(f"\n{'='*50}")
        results.append(("Error handling", self.test_error_handling()))

        # Print summary
        print("\n" + "=" * 50)
        passed = sum(1 for _, success in results if success)
        total = len(results)
        print(f"📊 SUMMARY: {passed}/{total} tests passed")

        if passed == total:
            print("✅ All tests passed!")
            return True
        else:
            print(f"❌ {total - passed} test(s) failed")
            for name, success in results:
                if not success:
                    print(f"  • {name}")
            return False


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run Benchling-Quilt integration tests")
    parser.add_argument(
        "--url",
        default="http://localhost:5000",
        help="Base URL of the webhook service (default: http://localhost:5000)",
    )
    parser.add_argument(
        "--entry-id",
        help="Benchling entry ID to use for testing (overrides test data file)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        default=True,
        help="Show verbose output including payloads and responses (default: True)",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress verbose output",
    )
    parser.add_argument(
        "--wait-for-health",
        action="store_true",
        help="Wait for service to become healthy before running tests",
    )
    parser.add_argument(
        "--wait-attempts",
        type=int,
        default=12,
        help="Maximum attempts to wait for health (default: 12)",
    )
    parser.add_argument(
        "--wait-interval",
        type=int,
        default=5,
        help="Seconds between health check attempts (default: 5)",
    )

    args = parser.parse_args()

    verbose = args.verbose and not args.quiet
    tester = IntegrationTest(args.url, entry_id=args.entry_id, verbose=verbose)

    # Wait for health if requested
    if args.wait_for_health:
        if not tester.wait_for_health(max_attempts=args.wait_attempts, interval=args.wait_interval):
            print("\n❌ Service did not become healthy in time")
            sys.exit(1)
        print()  # Add blank line before tests

    success = tester.run_all_tests()

    sys.exit(0 if success else 1)
