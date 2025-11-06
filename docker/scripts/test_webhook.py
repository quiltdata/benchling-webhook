#!/usr/bin/env python3
"""
Test script to send webhook payloads to your local server.
"""

import json
from datetime import datetime, timezone

import requests


def _get_timestamp():
    """Generate a fresh timestamp for test payloads."""
    return datetime.now(timezone.utc).isoformat() + "Z"


def _print_response(response):
    """Print response with appropriate status indicator."""
    is_success = 200 <= response.status_code < 300
    status_icon = "✅" if is_success else "❌"
    print(f"\n{status_icon} Response Status: {response.status_code}")
    print(f"📄 Response Body: {response.text}")


def _get_test_payloads():
    """Generate test webhook payloads with fresh timestamps."""
    return {
        "entry_created": {
            "channel": "events",
            "message": {
                "type": "v2.entry.created",
                "resourceId": "etr_12345678",
                "entryId": "etr_12345678",
                "timestamp": _get_timestamp(),
            },
            "baseURL": "https://your-tenant.benchling.com",
        },
        "entry_updated": {
            "channel": "events",
            "message": {
                "type": "v2.entry.updated.fields",
                "resourceId": "etr_12345678",
                "entryId": "etr_12345678",
                "timestamp": _get_timestamp(),
            },
            "baseURL": "https://your-tenant.benchling.com",
        },
    }


def _get_lifecycle_payloads():
    """Generate lifecycle event test payloads with fresh timestamps."""
    return {
        "app_installed": {
            "channel": "events",
            "message": {
                "type": "v2.app.installed",
                "installationId": "inst_12345678",
                "timestamp": _get_timestamp(),
            },
            "baseURL": "https://your-tenant.benchling.com",
        },
        "app_activate_requested": {
            "channel": "events",
            "message": {
                "type": "v2.app.activateRequested",
                "installationId": "inst_12345678",
                "timestamp": _get_timestamp(),
            },
            "baseURL": "https://your-tenant.benchling.com",
        },
        "app_deactivated": {
            "channel": "events",
            "message": {
                "type": "v2.app.deactivated",
                "installationId": "inst_12345678",
                "timestamp": _get_timestamp(),
            },
            "baseURL": "https://your-tenant.benchling.com",
        },
        "app_config_updated": {
            "channel": "events",
            "message": {
                "type": "v2-beta.app.configuration.updated",
                "installationId": "inst_12345678",
                "timestamp": _get_timestamp(),
            },
            "baseURL": "https://your-tenant.benchling.com",
        },
    }


# Canvas initialization test payloads
# Note: Canvas interactions (button clicks) are tested separately in test_app.py
CANVAS_PAYLOADS = {
    "canvas_init_with_entry": {
        "canvasId": "canvas_12345",
        "userId": "user_123",
        "context": {
            "entryId": "etr_12345678",
            "benchlingUrl": "https://your-tenant.benchling.com",
        },
    },
    "canvas_init_no_entry": {
        "canvasId": "canvas_67890",
        "userId": "user_123",
        "context": {
            "entryId": "etr_67890",  # Need an entry ID for canvas initialization
            "benchlingUrl": "https://your-tenant.benchling.com",
        },
    },
}


def test_webhook(server_url="http://localhost:5001", payload_type="entry_created"):
    """Send a test webhook to your server."""

    webhook_url = f"{server_url}/event"
    # Generate fresh payloads with current timestamps
    all_payloads = {**_get_test_payloads(), **_get_lifecycle_payloads()}
    payload = all_payloads[payload_type]

    print(f"🧪 Testing {payload_type} webhook...")
    print(f"📡 Sending to: {webhook_url}")
    print(f"📦 Payload: {json.dumps(payload, indent=2)}")

    try:
        response = requests.post(
            webhook_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )

        _print_response(response)

        if response.status_code == 200:
            response_data = response.json()
            return True
        else:
            return False

    except requests.exceptions.RequestException as e:
        print(f"❌ Error: {e}")
        return False


def test_canvas_endpoint(server_url="http://localhost:5001", payload_type="canvas_init_with_entry"):
    """Test Canvas initialization endpoint.

    Note: All canvas events (initialization and interactions) go to /canvas endpoint.
    Button interactions are tested separately in test_app.py with proper event payloads.
    """
    canvas_url = f"{server_url}/canvas"
    payload = CANVAS_PAYLOADS[payload_type]

    print(f"🎨 Testing Canvas Init ({payload_type})...")
    print(f"📡 Sending to: {canvas_url}")
    print(f"📦 Payload: {json.dumps(payload, indent=2)}")

    try:
        response = requests.post(
            canvas_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )

        _print_response(response)
        # Canvas endpoint returns 202 Accepted for async operations
        return response.status_code in [200, 202]

    except requests.exceptions.RequestException as e:
        print(f"❌ Error: {e}")
        return False


def test_lifecycle_endpoint(server_url="http://localhost:5001", payload_type="app_installed"):
    """Test lifecycle endpoints."""

    lifecycle_url = f"{server_url}/lifecycle"
    # Generate fresh payloads with current timestamps
    payload = _get_lifecycle_payloads()[payload_type]

    print(f"🔄 Testing Lifecycle ({payload_type})...")
    print(f"📡 Sending to: {lifecycle_url}")
    print(f"📦 Payload: {json.dumps(payload, indent=2)}")

    try:
        response = requests.post(
            lifecycle_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )

        _print_response(response)
        return response.status_code == 200

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
    import sys

    server_url = "http://localhost:5001"
    health_only = False

    # Parse arguments
    for arg in sys.argv[1:]:
        if arg.startswith("http"):
            server_url = arg
        elif arg == "--health-only":
            health_only = True

    print(f"🔧 Testing server: {server_url}")
    if health_only:
        print("🏥 Health check mode (skipping webhook/canvas/lifecycle tests)")
    print()

    # Track all test results
    all_results = []

    # Test health endpoints first
    print("=== Health Check Tests ===")
    health_results = test_health_endpoints(server_url)
    all_results.extend(health_results)
    print()

    if not health_only:
        # Test webhook endpoints
        print("=== Webhook Tests ===")
        for payload_type in _get_test_payloads():
            success = test_webhook(server_url, payload_type)
            all_results.append((f"webhook_{payload_type}", success))
            print("-" * 50)

        # Test Canvas endpoints
        print("\n=== Canvas Tests ===")
        for payload_type in CANVAS_PAYLOADS:
            success = test_canvas_endpoint(server_url, payload_type)
            all_results.append((f"canvas_{payload_type}", success))
            print("-" * 50)

        # Test Lifecycle endpoints
        print("\n=== Lifecycle Tests ===")
        for payload_type in _get_lifecycle_payloads():
            success = test_lifecycle_endpoint(server_url, payload_type)
            all_results.append((f"lifecycle_{payload_type}", success))
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
