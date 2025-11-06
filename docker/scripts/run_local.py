#!/usr/bin/env uv run python3
"""
Local development script for testing Benchling webhooks with real AWS credentials.

Usage:
    python scripts/run_local.py           # Normal mode
    python scripts/run_local.py --verbose # Verbose logging
    python scripts/run_local.py --test    # Start server, run tests, then exit

This script pulls credentials from AWS Secrets Manager using configuration
stored in ~/.config/benchling-webhook/default.json
"""

import json
import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import boto3
from botocore.exceptions import BotoCoreError, ClientError

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from xdg_config import XDGConfig

# Log file configuration
LOG_DIR = Path(__file__).parent.parent / ".scratch"
LOG_FILE = LOG_DIR / "benchling_webhook.log"


def load_credentials_from_aws():
    """Load credentials from AWS Secrets Manager using XDG configuration.

    Returns:
        dict: Environment variables to set for the Flask app

    Raises:
        FileNotFoundError: If XDG config does not exist
        ValueError: If required configuration keys are missing
        ClientError: If AWS Secrets Manager access fails
    """
    # Load XDG configuration
    try:
        xdg = XDGConfig()
        config = xdg.load_complete_config()
    except FileNotFoundError as e:
        print(f"❌ XDG configuration not found: {e}")
        print("💡 Run 'make install' to set up configuration")
        raise

    # Extract config sections (v0.7.0+ nested structure)
    benchling_config = config.get("benchling", {})
    quilt_config = config.get("quilt", {})
    deployment_config = config.get("deployment", {})
    packages_config = config.get("packages", {})

    # Extract region from config (v0.7.0+ structure)
    aws_region = (
        quilt_config.get("region")
        or deployment_config.get("region")
        or config.get("awsRegion")  # Legacy
        or config.get("cdkRegion")  # Legacy
        or "us-east-1"  # Default to us-east-1
    )

    # Check if secrets are embedded in config (testing) or in AWS Secrets Manager (production)
    benchling_client_secret = benchling_config.get("clientSecret")
    benchling_secret_arn = benchling_config.get("secretArn") or config.get("benchlingSecretArn")
    quilt_stack_arn = quilt_config.get("stackArn") or config.get("quiltStackArn")

    # Validate required config
    if not quilt_stack_arn:
        raise ValueError("quilt.stackArn not found in XDG config.\n" "Run 'make install' to configure Quilt stack.")

    # Handle two scenarios:
    # 1. Testing/local dev with embedded secrets (clientSecret present)
    # 2. Production with AWS Secrets Manager (secretArn present)
    env_vars = {
        "AWS_REGION": aws_region,
        "FLASK_ENV": "development",
        "FLASK_DEBUG": "true",
    }

    if benchling_client_secret:
        # Scenario 1: Embedded secrets (testing/local dev)
        print(f"🔧 Using embedded configuration (testing mode)...")
        print(f"   Region: {aws_region}")
        print(f"   Benchling Tenant: {benchling_config.get('tenant')}")
        print(f"   Quilt Stack ARN: {quilt_stack_arn}")

        # Set environment variables directly from config
        env_vars.update(
            {
                "BENCHLING_TENANT": benchling_config.get("tenant", ""),
                "BENCHLING_CLIENT_ID": benchling_config.get("clientId", ""),
                "BENCHLING_CLIENT_SECRET": benchling_client_secret,
                "BENCHLING_APP_DEFINITION_ID": benchling_config.get("appDefinitionId", ""),
                "QUILT_STACK_ARN": quilt_stack_arn,
                "QUILT_CATALOG": quilt_config.get("catalog", ""),
                "QUILT_BUCKET": quilt_config.get("bucket", ""),
                "QUILT_DATABASE": quilt_config.get("database", ""),
                "QUILT_QUEUE_ARN": quilt_config.get("queueArn", ""),
                "PACKAGES_BUCKET": packages_config.get("bucket", ""),
                "PACKAGES_PREFIX": packages_config.get("prefix", "benchling"),
                "METADATA_KEY": packages_config.get("metadataKey", "experiment_id"),
            }
        )

        print(f"✅ Successfully loaded configuration from XDG profile")

    elif benchling_secret_arn:
        # Scenario 2: AWS Secrets Manager (production)
        print(f"🔐 Loading credentials from AWS Secrets Manager...")
        print(f"   Region: {aws_region}")
        print(f"   Benchling Secret ARN: {benchling_secret_arn}")
        print(f"   Quilt Stack ARN: {quilt_stack_arn}")

        # Create Secrets Manager client
        try:
            secrets_client = boto3.client("secretsmanager", region_name=aws_region)
        except Exception as e:
            print(f"❌ Failed to create AWS Secrets Manager client: {e}")
            print("💡 Check your AWS credentials with 'aws sts get-caller-identity'")
            raise

        # Retrieve secret from Secrets Manager
        try:
            response = secrets_client.get_secret_value(SecretId=benchling_secret_arn)
            secret_string = response["SecretString"]
            secrets = json.loads(secret_string)
        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            if error_code == "ResourceNotFoundException":
                print(f"❌ Secret not found: {benchling_secret_arn}")
                print("💡 Verify the secret exists in AWS Secrets Manager")
            elif error_code == "AccessDeniedException":
                print(f"❌ Access denied to secret: {benchling_secret_arn}")
                print("💡 Check your IAM permissions for Secrets Manager")
            else:
                print(f"❌ Failed to retrieve secret: {e}")
            raise
        except json.JSONDecodeError as e:
            print(f"❌ Secret contains invalid JSON: {e}")
            raise

        print(f"✅ Successfully loaded {len(secrets)} configuration parameters from AWS")

        # Map secret values to environment variables
        # The ConfigResolver in production expects QuiltStackARN and BenchlingSecret
        # to be the actual ARN/name, not the resolved values
        env_vars.update(
            {
                "QuiltStackARN": quilt_stack_arn,
                "BenchlingSecret": benchling_secret_arn,
            }
        )

    else:
        raise ValueError(
            "Neither benchling.clientSecret nor benchling.secretArn found in XDG config.\n"
            "Run 'make install' to configure secrets or add clientSecret for testing."
        )

    return env_vars


def get_test_env_vars():
    """Get additional environment variables for test mode.

    Returns:
        dict: Additional environment variables for testing
    """
    return {
        "BENCHLING_TEST_MODE": "true",
    }


# Set up environment variables from AWS before importing Flask app
try:
    env_vars = load_credentials_from_aws()
    for key, value in env_vars.items():
        os.environ[key] = str(value)
except Exception as e:
    print(f"\n❌ Failed to load credentials: {e}")
    print("\nCannot start server without valid AWS credentials.")
    sys.exit(1)

# Import Flask app after setting environment variables
from src.app import create_app


def run_server(verbose=False):
    """Run the Flask server with real AWS credentials."""
    # Create and run the Flask app
    app = create_app()

    print("✅ Server starting with real AWS credentials")
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
        use_reloader=False,  # Disable reloader to avoid credential re-load issues
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

        # Apply test-specific environment variables
        test_env = get_test_env_vars()
        for key, value in test_env.items():
            os.environ[key] = str(value)
        print("🔓 Webhook verification disabled for local testing")
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

            print("🚀 Starting Benchling webhook server with VERBOSE LOGGING and real AWS credentials...")
            print(f"📋 Logs will be written to: {LOG_FILE}")
        else:
            print("🚀 Starting Benchling webhook server with real AWS credentials...")

        print("📍 This will run on http://localhost:5001")
        print("🔗 Use ngrok to expose: ngrok http 5001")
        print()

        # Run server normally
        run_server(verbose)
