#!/usr/bin/env python3
"""
Test script to send webhook payloads to your local server.

This script:
1. Reads event types from app-manifest.yaml
2. Loads corresponding real event payloads from ../test-events/
3. Injects test entry ID from XDG config (benchling.testEntryId)
4. Sends payloads to the local server
"""

import json
import sys
from pathlib import Path

import requests
import yaml


def load_app_manifest():
    """Load app manifest to get subscribed event types."""
    manifest_path = Path(__file__).parent.parent / "app-manifest.yaml"
    with open(manifest_path) as f:
        manifest = yaml.safe_load(f)

    # Extract event types from subscriptions
    event_types = []
    for msg in manifest.get("subscriptions", {}).get("messages", []):
        event_types.append(msg["type"])

    return event_types


def load_test_entry_id(profile="dev"):
    """Load test entry ID from XDG config."""
    # Use XDGConfig to load the profile
    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
    from xdg_config import XDGConfig

    try:
        xdg = XDGConfig(profile=profile)
        config = xdg.load_complete_config()
        test_entry_id = config.get("benchling", {}).get("testEntryId")

        if not test_entry_id:
            print(f"⚠️  Warning: No testEntryId found in profile '{profile}'")
            print(f"   Using fallback entry ID from test-events/entry.json")
            # Fallback: extract from entry.json
            entry_path = Path(__file__).parent.parent.parent / "test-events" / "entry.json"
            if entry_path.exists():
                with open(entry_path) as f:
                    entry_data = json.load(f)
                    test_entry_id = entry_data.get("entry", {}).get("id")

        return test_entry_id
    except FileNotFoundError:
        print(f"⚠️  Warning: Profile '{profile}' not found")
        print(f"   Using fallback entry ID from test-events/entry.json")
        # Fallback: extract from entry.json
        entry_path = Path(__file__).parent.parent.parent / "test-events" / "entry.json"
        if entry_path.exists():
            with open(entry_path) as f:
                entry_data = json.load(f)
                return entry_data.get("entry", {}).get("id")
        return None


def map_event_type_to_file(event_type):
    """Map Benchling event types to test-events file names."""
    mapping = {
        "v2.entry.created": "entry-created.json",
        "v2.entry.updated.fields": "entry-updated.json",
        "v2.canvas.created": "canvas-created.json",
        "v2.canvas.initialized": "canvas-initialized.json",
        "v2.canvas.userInteracted": "canvas-interaction.json",
        "v2.app.installed": "app-installed.json",
        "v2.app.activateRequested": "app-activate-requested.json",
        "v2.app.deactivated": "app-deactivated.json",
        "v2-beta.app.configuration.updated": "app-config-updated.json",
    }
    return mapping.get(event_type)


def load_test_payload(event_type, test_entry_id=None):
    """Load test payload from test-events directory."""
    filename = map_event_type_to_file(event_type)
    if not filename:
        print(f"⚠️  No test file mapped for event type: {event_type}")
        return None

    # Load from root test-events directory
    test_events_dir = Path(__file__).parent.parent.parent / "test-events"
    filepath = test_events_dir / filename

    if not filepath.exists():
        print(f"⚠️  Test file not found: {filename}")
        return None

    with open(filepath) as f:
        payload = json.load(f)

    if not payload:
        print(f"⚠️  Test file not found: {filename}")
        return None

    # Inject test entry ID where appropriate
    if test_entry_id:
        # Update resourceId in message (for entry/canvas events)
        if "message" in payload and "resourceId" in payload["message"]:
            payload["message"]["resourceId"] = test_entry_id

        # Update entryId if present
        if "message" in payload and "entryId" in payload["message"]:
            payload["message"]["entryId"] = test_entry_id

    return payload


def determine_endpoint(event_type):
    """Determine which endpoint to send the event to."""
    if event_type.startswith("v2.canvas."):
        return "/canvas"
    elif event_type.startswith("v2.app.") or event_type.startswith("v2-beta.app."):
        return "/lifecycle"
    else:
        return "/event"


def _print_response(response):
    """Print response with appropriate status indicator."""
    is_success = 200 <= response.status_code < 300
    status_icon = "✅" if is_success else "❌"
    print(f"{status_icon} Response Status: {response.status_code}")
    print(f"📄 Response Body: {response.text}")


def test_webhook(server_url, event_type, payload):
    """Send a test webhook to the server."""
    endpoint = determine_endpoint(event_type)
    webhook_url = f"{server_url}{endpoint}"

    print(f"\n🧪 Testing {event_type}...")
    print(f"📡 Sending to: {webhook_url}")
    print(f"📦 Payload: {json.dumps(payload, indent=2)}\n")

    try:
        response = requests.post(
            webhook_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )

        _print_response(response)
        return 200 <= response.status_code < 300

    except requests.exceptions.RequestException as e:
        print(f"❌ Error: {e}")
        return False


def test_health_endpoints(server_url="http://localhost:5001"):
    """Test all health endpoints."""
    endpoints = ["/health", "/health/ready", "/health/live"]
    results = []

    for endpoint in endpoints:
        try:
            response = requests.get(f"{server_url}{endpoint}", timeout=5)
            print(f"✅ {endpoint}: {response.status_code} - {response.json()}")
            results.append((endpoint, True))
        except Exception as e:
            print(f"❌ {endpoint}: {e}")
            results.append((endpoint, False))

    return results


if __name__ == "__main__":
    server_url = "http://localhost:5001"
    health_only = False
    profile = "dev"

    # Parse arguments
    for i, arg in enumerate(sys.argv[1:]):
        if arg.startswith("http"):
            server_url = arg
        elif arg == "--health-only":
            health_only = True
        elif arg == "--profile":
            if i + 1 < len(sys.argv[1:]):
                profile = sys.argv[i + 2]

    print(f"🔧 Testing server: {server_url}")
    print(f"📋 Profile: {profile}")
    if health_only:
        print("🏥 Health check mode (skipping webhook tests)")
    print()

    # Track all test results
    all_results = []

    # Test health endpoints first
    print("=== Health Check Tests ===")
    health_results = test_health_endpoints(server_url)
    all_results.extend(health_results)
    print()

    if not health_only:
        # Load test entry ID from profile
        test_entry_id = load_test_entry_id(profile)
        if test_entry_id:
            print(f"📝 Using test entry ID: {test_entry_id}")
        else:
            print("⚠️  No test entry ID available - tests may fail")
        print()

        # Load event types from app-manifest.yaml
        try:
            event_types = load_app_manifest()
            print(f"📋 Found {len(event_types)} event types in app-manifest.yaml:")
            for event_type in event_types:
                print(f"   - {event_type}")
            print()
        except Exception as e:
            print(f"❌ Failed to load app-manifest.yaml: {e}")
            sys.exit(1)

        # Test each event type
        print("=== Webhook Tests ===")
        for event_type in event_types:
            payload = load_test_payload(event_type, test_entry_id)
            if payload:
                success = test_webhook(server_url, event_type, payload)
                all_results.append((event_type, success))
                print("-" * 50)
            else:
                print(f"⚠️  Skipping {event_type} - no test payload available")
                print("-" * 50)

    # Print summary
    print("\n" + "=" * 50)
    passed = sum(1 for _, success in all_results if success)
    total = len(all_results)
    print(f"📊 SUMMARY: {passed}/{total} tests passed")

    if passed == total:
        print("✅ All tests passed!")
        sys.exit(0)
    else:
        print(f"❌ {total - passed} test(s) failed")
        sys.exit(1)
