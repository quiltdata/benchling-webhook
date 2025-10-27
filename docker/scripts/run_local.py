#!/usr/bin/env uv run python3
"""
Local development script with AWS mocking for testing Benchling webhooks
without requiring full AWS infrastructure.

Usage:
    python scripts/run_local.py           # Normal mode
    python scripts/run_local.py --verbose # Verbose logging
    python scripts/run_local.py --test    # Start server, run tests, then exit
"""

import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

# Log file configuration
LOG_DIR = Path(__file__).parent.parent / ".scratch"
LOG_FILE = LOG_DIR / "benchling_webhook.log"

# Set minimal required environment variables for local development
os.environ.setdefault("FLASK_ENV", "development")
os.environ.setdefault("FLASK_DEBUG", "true")
os.environ.setdefault("AWS_REGION", "us-west-2")
os.environ.setdefault("S3_BUCKET_NAME", "local-test-bucket")
os.environ.setdefault("PKG_PREFIX", "benchling")
os.environ.setdefault("QUILT_CATALOG", "test.quilttest.com")
os.environ.setdefault("SQS_QUEUE_URL", "https://sqs.us-west-2.amazonaws.com/123456789012/test-queue")
os.environ.setdefault("BENCHLING_TENANT", "test-tenant")
os.environ.setdefault("BENCHLING_CLIENT_ID", "test-client-id")
os.environ.setdefault("BENCHLING_CLIENT_SECRET", "test-client-secret")
os.environ.setdefault(
    "STEP_FUNCTION_ARN",
    "arn:aws:states:us-west-2:123456789012:stateMachine:TestProcessor",
)
os.environ.setdefault(
    "EVENTBRIDGE_CONNECTION_ARN",
    "arn:aws:events:us-west-2:123456789012:connection/test",
)
# Disable webhook verification for local testing (no need for BENCHLING_APP_DEFINITION_ID)
os.environ.setdefault("ENABLE_WEBHOOK_VERIFICATION", "false")

from src.app import create_app


def mock_step_functions_client():
    """Mock Step Functions client for local testing."""
    mock_client = MagicMock()

    # Mock successful execution start
    mock_client.start_execution.return_value = {
        "executionArn": "arn:aws:states:us-west-2:123456789012:execution:TestProcessor:test-execution-123"
    }

    # Mock state machine description for health check
    mock_client.describe_state_machine.return_value = {
        "stateMachineArn": "arn:aws:states:us-west-2:123456789012:stateMachine:TestProcessor",
        "name": "TestProcessor",
        "status": "ACTIVE",
    }

    # Mock execution status - using datetime objects instead of strings
    from datetime import datetime

    mock_client.describe_execution.return_value = {
        "executionArn": "arn:aws:states:us-west-2:123456789012:execution:TestProcessor:test-execution-123",
        "stateMachineArn": "arn:aws:states:us-west-2:123456789012:stateMachine:TestProcessor",
        "name": "test-execution-123",
        "status": "RUNNING",
        "startDate": datetime(2024, 1, 1, 12, 0, 0),
        "input": '{"test": "data"}',
    }

    return mock_client


def mock_benchling_client():
    """Mock Benchling SDK client for local testing."""
    mock_client = MagicMock()

    # Mock entry with display_id
    mock_entry = MagicMock()
    mock_entry.display_id = "TEST-001"
    mock_entry.id = "etr_12345678"
    mock_entry.name = "Test Entry"

    # Mock entries.get_entry_by_id to return our mock entry
    mock_client.entries.get_entry_by_id.return_value = mock_entry

    # Mock apps.update_canvas for canvas updates
    mock_client.apps.update_canvas.return_value = None

    return mock_client


def run_server(verbose=False):
    """Run the Flask server with AWS and Benchling mocking."""
    # Patch AWS clients and Benchling SDK to use mocks
    with (
        patch("boto3.client") as mock_boto3,
        patch("src.app.Benchling") as mock_benchling_class,
        patch("quilt3.search") as mock_quilt_search,
    ):

        # Mock quilt3.search to return empty results (no linked packages)
        mock_quilt_search.return_value = []

        if verbose:
            # Wrap mock client to log calls
            base_client = mock_step_functions_client()

            def log_start_execution(**kwargs):
                logging.debug("Mock Step Functions start_execution called with: %s", kwargs)
                return base_client.start_execution(**kwargs)

            def log_describe_state_machine(**kwargs):
                logging.debug("Mock Step Functions describe_state_machine called with: %s", kwargs)
                return base_client.describe_state_machine(**kwargs)

            def log_describe_execution(**kwargs):
                logging.debug("Mock Step Functions describe_execution called with: %s", kwargs)
                return base_client.describe_execution(**kwargs)

            base_client.start_execution.side_effect = log_start_execution
            base_client.describe_state_machine.side_effect = log_describe_state_machine
            base_client.describe_execution.side_effect = log_describe_execution

            mock_boto3.return_value = base_client
        else:
            mock_boto3.return_value = mock_step_functions_client()

        # Set up Benchling mock
        mock_benchling_class.return_value = mock_benchling_client()

        # Create and run the Flask app
        app = create_app()

        print("✅ Server starting with mocked AWS and Benchling services")
        print("📋 Available endpoints:")
        print("   POST /event - Webhook receiver")
        print("   GET  /health - Health check")
        print("   GET  /health/ready - Readiness probe")
        print("   GET  /health/live - Liveness probe")
        print()

        app.run(
            host="0.0.0.0",
            port=5001,
            debug=verbose,
            use_reloader=False,  # Disable reloader to avoid issues with patches
        )


def run_tests():
    """Run the webhook tests against the local server."""
    import requests

    server_url = "http://localhost:5001"

    # Wait for server to be ready
    max_retries = 30
    for i in range(max_retries):
        try:
            response = requests.get(f"{server_url}/health", timeout=2)
            if response.status_code == 200:
                print(f"✅ Server ready after {i+1} attempts")
                break
        except requests.exceptions.RequestException:
            if i == max_retries - 1:
                print("❌ Server failed to start within 30 seconds")
                return False
            time.sleep(1)
    else:
        return False

    # Run the test script
    print("\n🧪 Running webhook tests...")
    try:
        result = subprocess.run(
            [sys.executable, "scripts/test_webhook.py", server_url],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )

        # Print test output
        print(result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr)

        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print("❌ Tests timed out after 60 seconds")
        return False
    except Exception as e:
        print(f"❌ Error running tests: {e}")
        return False


if __name__ == "__main__":
    # Parse command line arguments
    verbose = "--verbose" in sys.argv
    test_mode = "--test" in sys.argv

    if test_mode:
        print("🚀 Starting Benchling webhook server in TEST MODE...")
        print("📍 Server will run on http://localhost:5001")
        print("🧪 Tests will run automatically and server will shutdown afterwards")
        print()

        # Set up minimal logging for test mode
        logging.basicConfig(level=logging.WARNING)

        # Start server in a separate thread
        server_thread = threading.Thread(target=run_server, args=(False,), daemon=True)
        server_thread.start()

        # Run tests
        test_success = run_tests()

        # Exit with appropriate code
        if test_success:
            print("\n✅ All tests passed! Server shutting down.")
            sys.exit(0)
        else:
            print("\n❌ Some tests failed. Server shutting down.")
            sys.exit(1)

    else:
        # Normal server mode
        if verbose:
            # Ensure log directory exists
            LOG_DIR.mkdir(parents=True, exist_ok=True)

            # Set up verbose logging
            logging.basicConfig(
                level=logging.DEBUG,
                format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
                handlers=[
                    logging.StreamHandler(),
                    logging.FileHandler(LOG_FILE),
                ],
            )
            logging.getLogger("src").setLevel(logging.DEBUG)
            logging.getLogger("werkzeug").setLevel(logging.DEBUG)
            logging.getLogger("urllib3").setLevel(logging.DEBUG)
            logging.getLogger("requests").setLevel(logging.DEBUG)

            print("🚀 Starting Benchling webhook server with VERBOSE LOGGING and AWS mocking...")
            print(f"📋 Logs will be written to: {LOG_FILE}")
        else:
            print("🚀 Starting Benchling webhook server with AWS mocking...")

        print("📍 This will run on http://localhost:5001")
        print("🔗 Use ngrok to expose: ngrok http 5001")
        print()

        # Run server normally
        run_server(verbose)
