# Test Local Errors Analysis

## Date

2025-11-08

## Command Executed

```bash
npm run test:local
```

## Test Results Summary

- **Total tests**: 7
- **Passed**: 3
- **Failed**: 4
- **Exit code**: 1 (failure)

## Test Breakdown

### ✅ Passed Tests (3/7)

1. **Health Check** (`/health`)
   - Status: 200 OK
   - Response: Service is healthy in "legacy-mode"
   - Config version: v0.5.x
   - Service version: 0.7.4

2. **Readiness Check** (`/health/ready`)
   - Status: 503 Service Unavailable (expected)
   - Error properly reported: Missing required environment variables

3. **Liveness Check** (`/health/live`)
   - Status: 200 OK
   - Response: Service is alive

### ❌ Failed Tests (4/7)

All webhook endpoint tests failed with identical error:

1. **v2.canvas.userInteracted** (POST `/canvas`)
2. **v2.canvas.created** (POST `/canvas`)
3. **v2.entry.created** (POST `/event`)
4. **v2.entry.updated.fields** (POST `/event`)

**Common Failure Pattern:**

- Response Status: **503 Service Unavailable**
- Error Message: `"Service not configured"`
- Details: Missing required environment variables: `QuiltStackARN` and `BenchlingSecret`

## Root Cause Analysis

### Primary Issue: Configuration Mode Mismatch

The application has two configuration modes, and there's a mismatch between what the test runner provides and what the Flask application expects:

#### 1. Test Runner Setup ([run_local.py:125-133](docker/scripts/run_local.py#L125-L133))

```python
env_vars = {
    "QuiltStackARN": quilt_stack_arn,
    "BenchlingSecret": benchling_secret_arn,
    "AWS_REGION": aws_region,
    "FLASK_ENV": "development",
    "FLASK_DEBUG": "true",
}
```

The test runner:

- ✅ Loads credentials from AWS Secrets Manager using XDG config
- ✅ Sets `QuiltStackARN` and `BenchlingSecret` environment variables
- ✅ Successfully prints: "Successfully loaded 11 configuration parameters from AWS"
- ✅ The server starts and health checks pass

#### 2. Flask Application Initialization ([config.py:46-58](docker/src/config.py#L46-L58))

```python
quilt_stack_arn = os.getenv("QuiltStackARN")
benchling_secret = os.getenv("BenchlingSecret")

if not quilt_stack_arn or not benchling_secret:
    raise ValueError(
        "Missing required environment variables: QuiltStackARN and BenchlingSecret\n"
        "\n"
        "Secrets-only mode requires exactly 2 environment variables:\n"
        "  - QuiltStackARN: CloudFormation stack ARN (e.g., arn:aws:cloudformation:...)\n"
        "  - BenchlingSecret: Secrets Manager secret name (e.g., benchling-webhook-prod)\n"
        "\n"
        "All other configuration is automatically resolved from AWS.\n"
    )
```

The Flask app:

- ❌ Cannot see `QuiltStackARN` or `BenchlingSecret` when processing webhook requests
- ❌ Returns 503 error for all webhook endpoints
- ❌ The `Config.__post_init__()` method fails to initialize

### Why This Happens

**Thread/Process Boundary Issue:**

The environment variables are set in the **parent process** ([run_local.py:172-174](docker/scripts/run_local.py#L172-L174)):

```python
for key, value in env_vars.items():
    os.environ[key] = str(value)
```

But when the Flask app initializes, specifically when `Config()` is instantiated in [app.py:55](docker/src/app.py#L55):

```python
config = get_config()
```

The `Config.__post_init__()` method is called, which checks for these environment variables. However, there appears to be a timing or scope issue where:

1. The environment variables ARE available initially (health checks pass)
2. But they become unavailable when handling webhook requests (readiness check fails, webhooks fail)

### Evidence

From the test output:

```log
✅ /health: 200 - {'config_source': 'legacy-mode', 'config_version': 'v0.5.x', 'service': 'benchling-webhook', 'status': 'healthy', 'version': '0.7.4'}
```

The health endpoint reports "legacy-mode", which suggests the environment variables are NOT being detected even during initial startup. Looking at [app.py:79-89](docker/src/app.py#L79-L89):

```python
quilt_stack_arn = os.getenv("QuiltStackARN")
benchling_secret = os.getenv("BenchlingSecret")

if quilt_stack_arn and benchling_secret:
    config_source = "secrets-only-mode"
    config_version = "v1.0.0"
    config_parameters = 10
else:
    config_source = "legacy-mode"
    config_version = "v0.5.x"
    config_parameters = None
```

### Secondary Issue: Readiness Probe Logic

The readiness check at [app.py:104-119](docker/src/app.py#L104-L119) returns 503 because:

```python
@app.route("/health/ready", methods=["GET"])
def readiness():
    """Readiness probe for orchestration."""
    try:
        # Check Python orchestration components
        if not entry_packager:
            raise Exception("EntryPackager not initialized")
        return jsonify(
            {
                "status": "ready",
                "orchestration": "python",
            }
        )
    except Exception as e:
        logger.error("Readiness check failed", error=str(e))
        return jsonify({"status": "not ready", "error": str(e)}), 503
```

However, the `entry_packager` was initialized in the `try` block above ([app.py:54-73](docker/src/app.py#L54-L73)), which means:

- If `Config()` raises an exception during initialization, `entry_packager` is never created
- The readiness check correctly reports the service as "not ready"

## Possible Causes

### 1. **Environment Variable Inheritance in Docker** (Most Likely)

The test script runs **inside** a Docker container via `make test-local`, which calls:

```bash
uv run python scripts/run_local.py --test
```

The environment variables are set in the Python process, but when Flask spawns the web server, those environment variables might not be properly inherited.

### 2. **Import Order Issue**

Looking at [run_local.py:170-181](docker/scripts/run_local.py#L170-L181):

```python
# Set up environment variables from AWS before importing Flask app
try:
    env_vars = load_credentials_from_aws(profile=args.profile)
    for key, value in env_vars.items():
        os.environ[key] = str(value)
except Exception as e:
    print(f"\n❌ Failed to load credentials: {e}")
    print("\nCannot start server without valid AWS credentials.")
    sys.exit(1)

# Import Flask app after setting environment variables
from src.app import create_app
```

The script intentionally sets environment variables BEFORE importing the Flask app. However, when `create_app()` is called, it creates a new `Config()` instance which runs `__post_init__()`.

### 3. **Config Singleton Pattern Missing**

Currently, `get_config()` creates a **new** `Config()` instance every time ([config.py:95-96](docker/src/config.py#L95-L96)):

```python
def get_config() -> Config:
    return Config()
```

This means every request could potentially re-read environment variables. If the environment variables are not properly set in the web server's environment, subsequent requests will fail.

## Verification Steps Taken

From the test output, we can confirm:

1. ✅ **AWS credentials work**: Successfully loaded 11 configuration parameters
2. ✅ **Server starts**: Health endpoint responds
3. ✅ **Liveness works**: Basic Flask routing is functional
4. ❌ **Configuration fails**: Environment variables not visible to Config initialization
5. ❌ **Webhooks fail**: All webhook endpoints return 503

## Recommended Fixes

### Fix 1: Pass Environment Variables to Docker Container

The Makefile target `test-local` should pass the required environment variables to the Docker container:

```makefile
test-local: check-xdg health-local
    @echo "Running local server tests (auto-start/stop)..."
    # Load XDG config and export required variables before running tests
    docker run --rm \
        -e QuiltStackARN=$QUILT_STACK_ARN \
        -e BenchlingSecret=$BENCHLING_SECRET \
        -e AWS_REGION=$AWS_REGION \
        -v ~/.aws:/home/appuser/.aws:ro \
        benchling-webhook \
        uv run python scripts/run_local.py --test
```

### Fix 2: Use Config Singleton Pattern

Modify [config.py:95-96](docker/src/config.py#L95-L96) to cache the configuration:

```python
_config_instance = None

def get_config() -> Config:
    global _config_instance
    if _config_instance is None:
        _config_instance = Config()
    return _config_instance
```

This ensures configuration is resolved once and reused across requests.

### Fix 3: Improve Error Handling in Test Mode

Modify the test runner to validate that environment variables are visible to the Flask app before running tests.

### Fix 4: Check Flask Development Server Settings

The Flask development server is started with `use_reloader=False` ([run_local.py:201](docker/scripts/run_local.py#L201)), but there might still be environment isolation issues.

## Next Steps

1. Investigate why environment variables set in `run_local.py` are not visible to the Flask application
2. Add debugging output to print environment variables at key points:
   - After setting in `run_local.py`
   - During `create_app()` initialization
   - During `Config.__post_init__()` execution
3. Consider whether the Docker containerization is adding an extra layer of process isolation
4. Test running the Flask app directly without Docker to isolate the issue

## Related Files

- [docker/scripts/run_local.py](docker/scripts/run_local.py) - Test runner that sets environment variables
- [docker/src/config.py](docker/src/config.py) - Configuration class that requires environment variables
- [docker/src/app.py](docker/src/app.py) - Flask application initialization
- [docker/Makefile](docker/Makefile) - Make targets for running tests
- [package.json](package.json) - NPM scripts including `test:local`

## Configuration Files Referenced

- XDG Config Directory: `~/.config/benchling-webhook/{profile}/`
- Config File: `~/.config/benchling-webhook/{profile}/config.json`
- Profile Used: `dev` (default for test script)
