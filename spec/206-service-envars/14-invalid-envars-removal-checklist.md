# Invalid Environment Variables Removal Checklist

**Date**: 2025-11-17
**Issue**: Despite repeated requests, invalid environment variables keep getting added back
**Root Cause**: The service-envars mechanism (v0.8.0+) only passes AWS service environment variables and BenchlingSecret. Package configuration (PACKAGE_BUCKET, PACKAGE_PREFIX, PACKAGE_METADATA_KEY, WEBHOOK_ALLOW_LIST) should NOT be passed as environment variables in the Docker execution chain.

---

## EXECUTIVE SUMMARY

### Files That Need Changes

1. ✅ **bin/xdg-launch.ts:247** - Remove PACKAGE_BUCKET from validation
2. ❌ **docker/docker-compose.yml:26-33, 75-82** - Remove invalid environment variables from both services
3. ❌ **docker/src/config.py:67-71, 81, 152** - Remove environment variable fallbacks and validation
4. ❌ **lib/fargate-service.ts:294-301** - Remove invalid environment variables from Fargate task
5. ❌ **test/integration/xdg-launch-pure-functions.test.ts:66-68** - Remove test expectations for invalid variables

### Total Impact

- **5 files** need changes
- **~20 lines** to remove/modify
- **Estimated time**: 30 minutes to 1 hour
- **Risk**: LOW (localized changes, well-defined scope)

### What Gets Removed

```typescript
// ❌ REMOVE THESE from all files
PACKAGE_BUCKET
PACKAGE_PREFIX
PACKAGE_METADATA_KEY
WEBHOOK_ALLOW_LIST  // The allowlist itself, NOT the boolean flag
```

### What Stays

```typescript
// ✅ KEEP THESE
QUILT_WEB_HOST
ATHENA_USER_DATABASE
ATHENA_USER_WORKGROUP
ATHENA_RESULTS_BUCKET
ICEBERG_DATABASE
ICEBERG_WORKGROUP
PACKAGER_SQS_URL
AWS_REGION
BenchlingSecret  // Just the secret name
ENABLE_WEBHOOK_VERIFICATION  // Boolean flag for dev/test override
FLASK_ENV
LOG_LEVEL
```

---

## CRITICAL PRINCIPLE

The NEW service-envars mechanism (v0.8.0+):

1. **ADDS** environment variables for AWS services (QUILT_WEB_HOST, ATHENA_USER_DATABASE, PACKAGER_SQS_URL, etc.)
2. **ONLY PASSES** the BenchlingSecret name (NOT ARN, just the secret name)
3. **DOES NOT PASS** package configuration as environment variables

### Invalid Environment Variables (MUST NOT BE PASSED)

These variables are ONLY used in the setup wizard and stored in XDG config. They should NEVER be passed to the Docker container or Flask application:

```typescript
// ❌ INVALID - DO NOT PASS THESE TO DOCKER/FLASK
PACKAGE_BUCKET: config.packages.bucket,
PACKAGE_PREFIX: config.packages.prefix,
PACKAGE_METADATA_KEY: config.packages.metadataKey,
WEBHOOK_ALLOW_LIST: config.security?.webhookAllowList || "",
```

### Why These Are Invalid

1. **Package configuration** (bucket, prefix, metadata_key) is stored in **AWS Secrets Manager** and fetched by the Flask app at runtime
2. **Security configuration** (webhook_allow_list) is also stored in **AWS Secrets Manager**
3. The Docker container should **only receive**:
   - AWS service endpoints (QUILT_WEB_HOST, ATHENA_USER_DATABASE, PACKAGER_SQS_URL)
   - AWS region
   - BenchlingSecret name (for fetching the rest from Secrets Manager)
   - Optional service configuration (ATHENA_USER_WORKGROUP, ATHENA_RESULTS_BUCKET, etc.)

---

## COMPLETE REMOVAL CHECKLIST

### 1. bin/xdg-launch.ts

**File**: [bin/xdg-launch.ts](../../bin/xdg-launch.ts)

#### Issues Found

**Line 247**: Invalid validation requirement
```typescript
// ❌ INVALID - PACKAGE_BUCKET should NOT be required here
const required = [
    "QUILT_WEB_HOST",
    "ATHENA_USER_DATABASE",
    "PACKAGER_SQS_URL",
    "AWS_REGION",
    "BenchlingSecret",
    "PACKAGE_BUCKET",  // ❌ REMOVE THIS
];
```

**Action Required**:
- [ ] Remove `"PACKAGE_BUCKET"` from the `required` array in `validateConfig()`
- [ ] The validation should ONLY check AWS service endpoints and BenchlingSecret

**Correct Code**:
```typescript
// ✅ CORRECT - Only validate AWS service endpoints
const required = [
    "QUILT_WEB_HOST",
    "ATHENA_USER_DATABASE",
    "PACKAGER_SQS_URL",
    "AWS_REGION",
    "BenchlingSecret",
];
```

**NOTE**: `buildEnvVars()` in xdg-launch.ts is CORRECT - it does NOT pass PACKAGE_BUCKET, PACKAGE_PREFIX, or PACKAGE_METADATA_KEY. Only the validation is wrong.

---

### 2. docker/docker-compose.yml

**File**: [docker/docker-compose.yml](../../docker/docker-compose.yml)

#### Issues Found (app service - lines 26-33)

```yaml
# ❌ INVALID - Package Storage section should NOT exist
# Package Storage
- PACKAGE_BUCKET=${PACKAGE_BUCKET}
- PACKAGE_PREFIX=${PACKAGE_PREFIX:-benchling}
- PACKAGE_METADATA_KEY=${PACKAGE_METADATA_KEY:-experiment_id}

# Security Configuration
- ENABLE_WEBHOOK_VERIFICATION=${ENABLE_WEBHOOK_VERIFICATION:-true}
- WEBHOOK_ALLOW_LIST=${WEBHOOK_ALLOW_LIST:-}
```

**Action Required**:
- [ ] Remove ALL lines 26-33 from the `app` service environment section
- [ ] The `app` service should ONLY have:
  - Flask Configuration
  - AWS Configuration
  - Quilt Services (v0.8.0+ service-specific)
  - BenchlingSecret

**Correct Code**:
```yaml
services:
  app:
    build: .
    ports:
      - "5003:5000"
    environment:
      # Flask Configuration
      - FLASK_ENV=production
      - LOG_LEVEL=${LOG_LEVEL:-INFO}

      # AWS Configuration
      - AWS_REGION=${AWS_REGION:-us-east-2}

      # Quilt Services (v0.8.0+ service-specific)
      - QUILT_WEB_HOST=${QUILT_WEB_HOST}
      - ATHENA_USER_DATABASE=${ATHENA_USER_DATABASE}
      - ATHENA_USER_WORKGROUP=${ATHENA_USER_WORKGROUP:-primary}
      - ATHENA_RESULTS_BUCKET=${ATHENA_RESULTS_BUCKET:-}
      - ICEBERG_DATABASE=${ICEBERG_DATABASE:-}
      - ICEBERG_WORKGROUP=${ICEBERG_WORKGROUP:-}
      - PACKAGER_SQS_URL=${PACKAGER_SQS_URL}

      # Benchling Configuration (credentials from Secrets Manager)
      - BenchlingSecret=${BenchlingSecret}
    volumes:
      - ~/.aws:/home/appuser/.aws:ro
    restart: unless-stopped
    # ... rest unchanged
```

#### Issues Found (app-dev service - lines 75-82)

**Same issue in app-dev service** - lines 75-82

**Action Required**:
- [ ] Remove ALL lines 75-82 from the `app-dev` service environment section

**Correct Code**:
```yaml
  app-dev:
    build: .
    profiles: ["dev"]
    ports:
      - "5002:5000"
    environment:
      # Flask Configuration
      - FLASK_ENV=development
      - LOG_LEVEL=${LOG_LEVEL:-DEBUG}

      # AWS Configuration
      - AWS_REGION=${AWS_REGION:-us-east-2}

      # Quilt Services (v0.8.0+ service-specific)
      - QUILT_WEB_HOST=${QUILT_WEB_HOST}
      - ATHENA_USER_DATABASE=${ATHENA_USER_DATABASE}
      - ATHENA_USER_WORKGROUP=${ATHENA_USER_WORKGROUP:-primary}
      - ATHENA_RESULTS_BUCKET=${ATHENA_RESULTS_BUCKET:-}
      - ICEBERG_DATABASE=${ICEBERG_DATABASE:-}
      - ICEBERG_WORKGROUP=${ICEBERG_WORKGROUP:-}
      - PACKAGER_SQS_URL=${PACKAGER_SQS_URL}

      # Benchling Configuration (credentials from Secrets Manager)
      - BenchlingSecret=${BenchlingSecret}

      # Security Configuration (dev mode - disable verification for testing)
      - ENABLE_WEBHOOK_VERIFICATION=${ENABLE_WEBHOOK_VERIFICATION:-false}

      # Test Mode
      - BENCHLING_TEST_MODE=${BENCHLING_TEST_MODE:-false}
    volumes:
      - ~/.aws:/home/appuser/.aws:ro
      - ./src:/app/src
      - ./pyproject.toml:/app/pyproject.toml
      - ./uv.lock:/app/uv.lock
    command: ["sh", "-c", "uv sync --all-extras --frozen && uv run python -m src.app"]
```

**NOTE**: We KEEP `ENABLE_WEBHOOK_VERIFICATION` in app-dev because it's a runtime flag for testing. We REMOVE `WEBHOOK_ALLOW_LIST` because the allowlist itself comes from Secrets Manager.

---

### 3. docker/src/config.py

**File**: [docker/src/config.py](../../docker/src/config.py)

#### Analysis

**Lines 67-71**: These lines read PACKAGE_BUCKET, PACKAGE_PREFIX, PACKAGE_METADATA_KEY from environment
```python
self.s3_bucket_name = os.getenv("PACKAGE_BUCKET", "")
self.s3_prefix = os.getenv("PACKAGE_PREFIX", "benchling")
self.package_key = os.getenv("PACKAGE_METADATA_KEY", "experiment_id")
```

**Lines 124-136**: These lines override from Secrets Manager (CORRECT behavior)
```python
# Secret can override package configuration
if secret_data.pkg_prefix:
    self.s3_prefix = secret_data.pkg_prefix
    self.pkg_prefix = secret_data.pkg_prefix
if secret_data.pkg_key:
    self.package_key = secret_data.pkg_key
if secret_data.user_bucket:
    self.s3_bucket_name = secret_data.user_bucket
```

**Lines 78-81**: These lines read security config from environment
```python
enable_verification = os.getenv("ENABLE_WEBHOOK_VERIFICATION", "true").lower()
self.enable_webhook_verification = enable_verification in ("true", "1", "yes")
self.webhook_allow_list = os.getenv("WEBHOOK_ALLOW_LIST", "")
```

**Lines 135-136**: These lines override from Secrets Manager (CORRECT behavior)
```python
# Secret can override security configuration
self.enable_webhook_verification = secret_data.enable_webhook_verification
self.webhook_allow_list = secret_data.webhook_allow_list
```

#### Action Required

**Option A: Remove Environment Variable Fallbacks (RECOMMENDED)**

The cleanest approach: Package and security config ONLY comes from Secrets Manager.

- [ ] Remove lines 67-71 (PACKAGE_BUCKET, PACKAGE_PREFIX, PACKAGE_METADATA_KEY fallbacks)
- [ ] Remove line 81 (WEBHOOK_ALLOW_LIST fallback)
- [ ] Keep line 79-80 (ENABLE_WEBHOOK_VERIFICATION) for dev/test override
- [ ] Update validation to remove PACKAGE_BUCKET requirement (line 152)

**Correct Code**:
```python
def __post_init__(self):
    """Initialize configuration from environment variables and Secrets Manager."""

    # Read Quilt service environment variables (NO CLOUDFORMATION!)
    self.quilt_catalog = os.getenv("QUILT_WEB_HOST", "")
    self.quilt_database = os.getenv("ATHENA_USER_DATABASE", "")
    self.queue_url = os.getenv("PACKAGER_SQS_URL", "")
    self.aws_region = os.getenv("AWS_REGION", "")

    # Package configuration - initialized to defaults, will be set from Secrets Manager
    self.s3_bucket_name = ""
    self.s3_prefix = "benchling"
    self.package_key = "experiment_id"
    self.pkg_prefix = "benchling"

    # Flask configuration
    self.flask_env = os.getenv("FLASK_ENV", "production")
    self.log_level = os.getenv("LOG_LEVEL", "INFO")

    # Security configuration - ENABLE_WEBHOOK_VERIFICATION can be overridden for testing
    enable_verification = os.getenv("ENABLE_WEBHOOK_VERIFICATION", "true").lower()
    self.enable_webhook_verification = enable_verification in ("true", "1", "yes")
    self.webhook_allow_list = ""  # Will be set from Secrets Manager

    # Test mode override: disable webhook verification for local integration tests
    test_mode = os.getenv("BENCHLING_TEST_MODE", "").lower() in ("true", "1", "yes")
    if test_mode:
        self.enable_webhook_verification = False
        self.webhook_allow_list = ""

    # Fetch Benchling credentials from Secrets Manager
    benchling_secret = os.getenv("BenchlingSecret")
    if not benchling_secret:
        raise ValueError(
            "Missing required environment variable: BenchlingSecret\n"
            # ... rest of error message unchanged
        )

    # Fetch secret from Secrets Manager
    sm_client = boto3.client("secretsmanager", region_name=self.aws_region)
    secret_data = resolve_and_fetch_secret(sm_client, self.aws_region, benchling_secret)

    # Set Benchling configuration from secret
    self.benchling_tenant = secret_data.tenant
    self.benchling_client_id = secret_data.client_id
    self.benchling_client_secret = secret_data.client_secret
    self.benchling_app_definition_id = secret_data.app_definition_id

    # Set package/security config from secret (NOT environment variables!)
    if not test_mode:
        # Package configuration ALWAYS comes from secret
        self.s3_bucket_name = secret_data.user_bucket
        self.s3_prefix = secret_data.pkg_prefix or "benchling"
        self.pkg_prefix = self.s3_prefix
        self.package_key = secret_data.pkg_key or "experiment_id"

        # Security configuration ALWAYS comes from secret
        self.enable_webhook_verification = secret_data.enable_webhook_verification
        self.webhook_allow_list = secret_data.webhook_allow_list

        # Log level from secret
        if secret_data.log_level:
            self.log_level = secret_data.log_level

    # Validate required fields
    self._validate()

def _validate(self):
    """Validate required configuration fields."""
    required = {
        "QUILT_WEB_HOST": self.quilt_catalog,
        "ATHENA_USER_DATABASE": self.quilt_database,
        "PACKAGER_SQS_URL": self.queue_url,
        "AWS_REGION": self.aws_region,
        # ❌ REMOVE THIS LINE - package bucket comes from Secrets Manager
        # "PACKAGE_BUCKET": self.s3_bucket_name,
        "benchling_tenant": self.benchling_tenant,
        "benchling_client_id": self.benchling_client_id,
        "benchling_client_secret": self.benchling_client_secret,
        "benchling_app_definition_id": self.benchling_app_definition_id,
    }

    missing = [key for key, value in required.items() if not value]

    if missing:
        raise ValueError(
            f"Missing required configuration: {', '.join(missing)}\n"
            "\n"
            "Required environment variables:\n"
            "  - QUILT_WEB_HOST: Quilt catalog URL (e.g., https://example.quiltdata.com)\n"
            "  - ATHENA_USER_DATABASE: Athena database name\n"
            "  - PACKAGER_SQS_URL: SQS queue URL\n"
            "  - AWS_REGION: AWS region (e.g., us-east-1)\n"
            # ❌ REMOVE THIS LINE
            # "  - PACKAGE_BUCKET: S3 bucket for package storage\n"
            "  - BenchlingSecret: Secrets Manager secret name\n"
            "\n"
            "Package configuration comes from AWS Secrets Manager.\n"
            "\n"
            "For local development, use:\n"
            "  npm run test:local\n"
            "\n"
            "For production deployment, these are set automatically by CDK.\n"
        )
```

**Option B: Keep Environment Variables as Fallbacks (NOT RECOMMENDED)**

If we keep environment variable fallbacks, we should at least add comments explaining they are fallbacks only and Secrets Manager takes precedence.

This option is NOT RECOMMENDED because it continues the pattern of passing unnecessary environment variables.

---

### 4. docker/src/config_schema.py

**File**: [docker/src/config_schema.py](../../docker/src/config_schema.py)

#### Analysis

This file defines the BenchlingSecret schema (lines 165-204). It is CORRECT.

**Line 182**: `webhook_allow_list` field in BenchlingSecret schema
```python
webhook_allow_list: str = Field("", description="Comma-separated IP allowlist")
```

**Action Required**: NONE - This is CORRECT. The schema defines what's stored in Secrets Manager.

---

### 5. lib/fargate-service.ts

**File**: [lib/fargate-service.ts](../../lib/fargate-service.ts)

#### Issues Found

**Lines 294-301**: Invalid environment variables passed to Fargate task
```typescript
// ❌ INVALID - Package Storage section (lines 294-297)
PACKAGE_BUCKET: config.packages.bucket,
PACKAGE_PREFIX: config.packages.prefix,
PACKAGE_METADATA_KEY: config.packages.metadataKey,

// ❌ INVALID - Security Configuration (lines 300-301)
ENABLE_WEBHOOK_VERIFICATION: String(config.security?.enableVerification !== false),
WEBHOOK_ALLOW_LIST: config.security?.webhookAllowList || "",
```

**Action Required**:
- [ ] Remove lines 294-301 (Package Storage and WEBHOOK_ALLOW_LIST)
- [ ] Keep ENABLE_WEBHOOK_VERIFICATION if used for dev/test override (but NOT WEBHOOK_ALLOW_LIST)
- [ ] Update the comment on line 276 to reflect the correct behavior

**Correct Code**:
```typescript
// Build environment variables using new config structure
// v1.0.0+: Explicit service parameters eliminate runtime CloudFormation calls
// CRITICAL: These must match bin/xdg-launch.ts:buildEnvVars() exactly (lines 182-229)
// Package configuration comes from AWS Secrets Manager, NOT environment variables
const environmentVars: { [key: string]: string } = {
    // AWS Configuration
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,

    // Quilt Services (v0.8.0+ service-specific - NO MORE STACK ARN!)
    QUILT_WEB_HOST: props.quiltWebHost,
    ATHENA_USER_DATABASE: props.athenaUserDatabase,
    ATHENA_USER_WORKGROUP: props.athenaUserWorkgroup || "primary",
    ATHENA_RESULTS_BUCKET: props.athenaResultsBucket || "",
    ICEBERG_DATABASE: props.icebergDatabase || "",
    ICEBERG_WORKGROUP: props.icebergWorkgroup || "",
    PACKAGER_SQS_URL: props.packagerQueueUrl,

    // Benchling Configuration (credentials from Secrets Manager, NOT environment)
    BenchlingSecret: this.extractSecretName(props.benchlingSecret),

    // Security Configuration (verification can be disabled for dev/test)
    ENABLE_WEBHOOK_VERIFICATION: String(config.security?.enableVerification !== false),

    // Application Configuration
    FLASK_ENV: "production",
    LOG_LEVEL: props.logLevel || config.logging?.level || "INFO",
};
```

**Note**: We keep `ENABLE_WEBHOOK_VERIFICATION` as a boolean flag for dev/test override, but remove `WEBHOOK_ALLOW_LIST` since the actual allowlist comes from Secrets Manager.

---

### 6. docker/tests/conftest.py

**File**: [docker/tests/conftest.py](../../docker/tests/conftest.py)

#### Analysis

**Lines 68-79**: Mock ResolvedConfig includes all package/security config
```python
# Runtime Configuration (Secret - all 10 parameters)
benchling_tenant="test-tenant",
benchling_client_id="test-client-id",
benchling_client_secret="test-client-secret",
benchling_app_definition_id="test-app-id",
pkg_prefix="benchling",
pkg_key="experiment_id",
user_bucket="test-bucket",
log_level="INFO",
enable_webhook_verification=True,
webhook_allow_list="",
```

**Action Required**: NONE - This is CORRECT for testing. The mock simulates what comes from Secrets Manager.

---

### 7. test/integration/xdg-launch-pure-functions.test.ts

**File**: [test/integration/xdg-launch-pure-functions.test.ts](../../test/integration/xdg-launch-pure-functions.test.ts)

#### Issues Found

**Lines 66-68**: Test expects PACKAGE_BUCKET, PACKAGE_PREFIX, PACKAGE_METADATA_KEY in environment variables
```typescript
// ❌ INVALID - These tests expect package config in environment variables
expect(envVars.PACKAGE_BUCKET).toBe(defaultConfig.packages.bucket);
expect(envVars.PACKAGE_PREFIX).toBe(defaultConfig.packages.prefix);
expect(envVars.PACKAGE_METADATA_KEY).toBe(defaultConfig.packages.metadataKey);
```

**Action Required**:
- [ ] Remove lines 65-68 (package storage configuration expectations)
- [ ] These variables should NOT be in the environment variables returned by buildEnvVars()

**Correct Code**:
```typescript
// Verify Benchling configuration
// Note: In v0.8.0+, only BenchlingSecret (secret name) is set, not ARN or tenant
// Tenant and credentials are fetched from Secrets Manager at runtime
expect(envVars.BenchlingSecret).toBeTruthy();
expect(typeof envVars.BenchlingSecret).toBe("string");

// Package configuration comes from Secrets Manager, NOT environment variables
// (removed lines 65-68)

// Verify native mode-specific variables
expect(envVars.FLASK_ENV).toBe("development");
```

**Similar Issues**: Lines 66-68 are duplicated in other test cases (lines 82-98, 100-115, etc.). All tests that expect these variables should be updated.

---

## EXECUTION CHAIN ANALYSIS

### npm run test:local Execution Flow

```
npm run test:local
  ↓
npm run launch -- --mode docker-dev --profile dev --test
  ↓
ts-node bin/xdg-launch.ts --mode docker-dev --profile dev --test
  ↓
xdg-launch.ts:
  1. loadProfile("dev") - reads ~/.config/benchling-webhook/dev/config.json
  2. buildEnvVars() - builds environment variables
     ✅ CORRECT: Does NOT include PACKAGE_BUCKET, PACKAGE_PREFIX, PACKAGE_METADATA_KEY, WEBHOOK_ALLOW_LIST
     ✅ ONLY includes: QUILT_WEB_HOST, ATHENA_USER_DATABASE, PACKAGER_SQS_URL, BenchlingSecret, etc.
  3. validateConfig() - validates environment variables
     ❌ INVALID: Requires PACKAGE_BUCKET (line 247)
  4. launchDockerDev() - spawns docker-compose
  ↓
docker-compose --profile dev up app-dev
  ↓
docker-compose.yml (app-dev service):
  ❌ INVALID: Lines 75-82 pass PACKAGE_BUCKET, PACKAGE_PREFIX, PACKAGE_METADATA_KEY, WEBHOOK_ALLOW_LIST
  ↓
Flask app starts (docker/src/app.py)
  ↓
Config.__post_init__() (docker/src/config.py)
  ❌ INVALID: Lines 67-71 read PACKAGE_BUCKET, PACKAGE_PREFIX, PACKAGE_METADATA_KEY from environment
  ❌ INVALID: Line 81 reads WEBHOOK_ALLOW_LIST from environment
  ✅ CORRECT: Lines 124-136 override from Secrets Manager
  ❌ INVALID: Line 152 validates PACKAGE_BUCKET is present
  ↓
Flask app running
  ↓
test_webhook.py sends test requests
```

### Summary of Invalid Steps

1. **bin/xdg-launch.ts:247** - Validates PACKAGE_BUCKET (should NOT be required)
2. **docker/docker-compose.yml:26-33, 75-82** - Passes invalid environment variables
3. **docker/src/config.py:67-71, 81** - Reads invalid environment variables as fallbacks
4. **docker/src/config.py:152** - Validates PACKAGE_BUCKET is present

---

## TESTING REQUIREMENTS

After making these changes, the following tests should still pass:

1. **Unit Tests**: `npm run test:python`
   - All mocked tests should continue to work
   - conftest.py mocks are CORRECT

2. **Local Integration Tests**: `npm run test:local`
   - Should work WITHOUT passing PACKAGE_BUCKET, etc. as environment variables
   - Config should be fetched from Secrets Manager

3. **Native Tests**: `npm run test:native`
   - Should work WITHOUT passing PACKAGE_BUCKET, etc. as environment variables

4. **Deployed Tests**: `npm run test:dev`, `npm run test:prod`
   - Should work (already working correctly via CDK)

---

## VERIFICATION CHECKLIST

After making all changes:

- [ ] Run `npm run test` - all unit tests pass
- [ ] Run `npm run test:local` - local Docker integration tests pass
- [ ] Run `npm run test:native` - native Flask tests pass
- [ ] Run `npm run test:dev` - deployed dev stack tests pass
- [ ] Verify no PACKAGE_BUCKET, PACKAGE_PREFIX, PACKAGE_METADATA_KEY, WEBHOOK_ALLOW_LIST in:
  - [ ] bin/xdg-launch.ts (except as read from config for logging)
  - [ ] docker/docker-compose.yml (app and app-dev services)
  - [ ] docker/src/config.py (except in Secrets Manager override section)
  - [ ] lib/fargate-service.ts (Fargate task environment)

---

## RATIONALE

### Why This Matters

1. **Single Source of Truth**: Package and security configuration should come from Secrets Manager, not environment variables
2. **Security**: Sensitive configuration (webhook allowlist) should not be passed as environment variables
3. **Consistency**: Same configuration mechanism in local dev, Docker, and production deployments
4. **Maintainability**: Less environment variable plumbing reduces complexity and bugs

### What Goes Where

| Configuration | Source | Destination |
|---------------|--------|-------------|
| AWS Service Endpoints | XDG Config → Environment Variables | Flask App |
| BenchlingSecret Name | XDG Config → Environment Variables | Flask App |
| Benchling Credentials | Secrets Manager | Flask App (fetched at runtime) |
| Package Config (bucket, prefix, key) | Secrets Manager | Flask App (fetched at runtime) |
| Security Config (allowlist) | Secrets Manager | Flask App (fetched at runtime) |
| ENABLE_WEBHOOK_VERIFICATION flag | Environment Variables | Flask App (for dev/test override) |

---

## PRIORITY

**CRITICAL**: This must be fixed to prevent configuration drift and security issues.

**Estimated Effort**: 30 minutes to 1 hour

**Risk**: LOW - Changes are localized and well-defined. All tests should continue to pass.
