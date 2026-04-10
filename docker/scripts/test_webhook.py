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
import time
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
    from xdg_config import XDGConfig  # type: ignore

    try:
        xdg = XDGConfig(profile=profile)
        config = xdg.load_complete_config()
        test_entry_id = config.get("benchling", {}).get("testEntryId")

        if not test_entry_id:
            print(f"⚠️  Warning: No testEntryId found in profile '{profile}'")
            print("   Using fallback entry ID from test-events/entry.json")
            # Fallback: extract from entry.json
            entry_path = Path(__file__).parent.parent.parent / "test-events" / "entry.json"
            if entry_path.exists():
                with open(entry_path) as f:
                    entry_data = json.load(f)
                    test_entry_id = entry_data.get("entry", {}).get("id")

        return test_entry_id
    except FileNotFoundError:
        print(f"⚠️  Warning: Profile '{profile}' not found")
        print("   Using fallback entry ID from test-events/entry.json")
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
        "v2.entry.updated.reviewRecord": "entry-review-record.json",
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


def check_webhook_verification(server_url):
    """Check if webhook verification is enabled via /config endpoint."""
    try:
        response = requests.get(f"{server_url}/config", timeout=10)
        if response.status_code == 200:
            data = response.json()
            enabled = data.get("security", {}).get("webhook_verification_enabled")
            if enabled is not None:
                return bool(enabled)
            # Fall back to parameters section
            return bool(data.get("parameters", {}).get("enable_webhook_verification"))
    except Exception:
        pass
    return None


def warmup_post(server_url, rounds=4):
    """Send warm-up POST requests to prime VPC Link / NLB connections.

    The NLB round-robins across targets. One target may have stale VPC Link
    connections causing 29s+ delays. Sending multiple warm-up POSTs ensures
    both NLB targets have active connections.
    """
    print("🔥 Warming up POST connections...")
    ok = 0
    for i in range(1, rounds + 1):
        try:
            response = requests.post(
                f"{server_url}/health",
                json={},
                timeout=30,
            )
            print(f"   Warm-up {i}: {response.status_code}")
            if response.status_code < 500:
                ok += 1
        except requests.exceptions.RequestException as e:
            print(f"   Warm-up {i}: {e}")
    print(f"   {ok}/{rounds} warm-up requests succeeded")
    return ok > 0


def _print_response(response, verification_expected=False):
    """Print response with appropriate status indicator."""
    is_success = 200 <= response.status_code < 300
    if verification_expected and response.status_code == 403:
        # 403 is expected when webhook verification is enabled and we can't sign
        is_success = True
    status_icon = "✅" if is_success else "❌"
    print(f"{status_icon} Response Status: {response.status_code}")
    print(f"📄 Response Body: {response.text}")


def test_webhook(server_url, event_type, payload, verification_enabled=False):
    """Send a test webhook to the server."""
    endpoint = determine_endpoint(event_type)
    webhook_url = f"{server_url}{endpoint}"

    print(f"\n🧪 Testing {event_type}...")
    print(f"📡 Sending to: {webhook_url}")
    print(f"📦 Payload: {json.dumps(payload, indent=2)}\n")

    # Retry on 504 (NLB round-robins across targets; one target may have
    # stale VPC Link connections causing 29s gateway timeouts)
    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            response = requests.post(
                webhook_url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=30,
            )

            if response.status_code == 504 and attempt < max_attempts:
                wait = 10 * attempt  # 10s, 20s — let NLB connections settle
                print(f"   ⏳ 504 Gateway Timeout (attempt {attempt}/{max_attempts}), retrying in {wait}s...")
                time.sleep(wait)
                continue

            if verification_enabled and response.status_code == 403:
                _print_response(response, verification_expected=True)
                print("   (403 expected: webhook verification enabled, test requests are unsigned)")
                return True

            _print_response(response)
            return 200 <= response.status_code < 300

        except requests.exceptions.RequestException as e:
            if attempt < max_attempts:
                print(f"   ⏳ Error (attempt {attempt}/{max_attempts}): {e}, retrying...")
                continue
            print(f"❌ Error: {e}")
            return False

    return False


def wait_for_ready(server_url, max_wait=120, interval=10):
    """Wait for /health to return 200, retrying on errors or non-200 responses."""
    deadline = time.time() + max_wait
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        try:
            response = requests.get(f"{server_url}/health", timeout=5)
            if response.status_code == 200:
                if attempt > 1:
                    print(f"✅ Health endpoint ready after {attempt} attempt(s)")
                return True
            remaining = int(deadline - time.time())
            print(f"⏳ /health returned {response.status_code}, retrying in {interval}s... ({remaining}s remaining)")
        except Exception as e:
            remaining = int(deadline - time.time())
            print(f"⏳ /health unreachable ({e}), retrying in {interval}s... ({remaining}s remaining)")
        time.sleep(interval)
    print(f"❌ Health endpoint not ready after {max_wait}s")
    return False


def test_health_endpoints(server_url="http://localhost:5001"):
    """Test all health endpoints."""
    endpoints = ["/health", "/health/ready", "/health/live"]
    results = []

    for endpoint in endpoints:
        try:
            response = requests.get(f"{server_url}{endpoint}", timeout=5)

            # Validate status code: /health/ready can be 503 (not ready), others should be 200
            expected_codes = [200] if endpoint != "/health/ready" else [200, 503]
            is_success = response.status_code in expected_codes

            status_icon = "✅" if is_success else "❌"

            # Try to parse JSON response
            try:
                response_data = response.json()
                print(f"{status_icon} {endpoint}: {response.status_code} - {response_data}")
            except json.JSONDecodeError:
                print(f"{status_icon} {endpoint}: {response.status_code} - {response.text}")

            results.append((endpoint, is_success))
        except Exception as e:
            print(f"❌ {endpoint}: {e}")
            results.append((endpoint, False))

    return results


if __name__ == "__main__":
    server_url = "http://localhost:5001"
    health_only = False
    profile = "dev"
    wait_secs = 0

    # Parse arguments
    for i, arg in enumerate(sys.argv[1:]):
        if arg.startswith("http"):
            server_url = arg
        elif arg == "--health-only":
            health_only = True
        elif arg == "--profile":
            if i + 1 < len(sys.argv[1:]):
                profile = sys.argv[i + 2]
        elif arg.startswith("--wait="):
            wait_secs = int(arg.split("=", 1)[1])

    print(f"🔧 Testing server: {server_url}")
    print(f"📋 Profile: {profile}")
    if health_only:
        print("🏥 Health check mode (skipping webhook tests)")
    print()

    # Wait for service to be ready (useful after fresh deployments)
    if wait_secs > 0:
        print(f"⏱️  Waiting up to {wait_secs}s for service to be ready...")
        if not wait_for_ready(server_url, max_wait=wait_secs):
            sys.exit(1)
        print()

    # Track all test results
    all_results = []

    # Test health endpoints first
    print("=== Health Check Tests ===")
    health_results = test_health_endpoints(server_url)
    all_results.extend(health_results)
    print()

    if not health_only:
        # Warm up POST connections (VPC Link / NLB can 504 on first POSTs)
        warmup_post(server_url)
        print()

        # Check if webhook verification is enabled
        verification_enabled = check_webhook_verification(server_url)
        if verification_enabled:
            print("🔒 Webhook verification: ENABLED")
            print("   Test requests are unsigned - 403 responses are expected and count as PASS")
            print("   (Only Benchling can sign webhooks with the correct HMAC keys)")
        elif verification_enabled is False:
            print("🔓 Webhook verification: DISABLED")
        else:
            print("⚠️  Webhook verification: UNKNOWN (could not query /config)")
        print()

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
                success = test_webhook(
                    server_url,
                    event_type,
                    payload,
                    verification_enabled=bool(verification_enabled),
                )
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
