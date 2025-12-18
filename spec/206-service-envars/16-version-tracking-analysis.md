# BENCHLING_WEBHOOK_VERSION Tracking Analysis

**Date**: 2025-11-17
**Question**: Is the Canvas version display feature present and properly populated?
**Answer**: ✅ PARTIALLY - Feature exists but is NOT properly integrated

---

## EXECUTIVE SUMMARY

The webhook version tracking feature **EXISTS** but has **TWO SEPARATE MECHANISMS** that are **NOT PROPERLY CONNECTED**:

### Mechanism 1: BUILD_VERSION (Docker build-time) ✅
- **Purpose**: Embed version in Docker image at build time
- **Source**: Git tag (in CI) → Docker `ARG VERSION` → `ENV BUILD_VERSION`
- **Used by**: `docker/src/version.py:get_version()` → `__version__`
- **Status**: ✅ WORKING (Dockerfile line 144)

### Mechanism 2: BENCHLING_WEBHOOK_VERSION (runtime environment) ❌
- **Purpose**: Display version in health endpoint
- **Source**: Environment variable (should be set by CDK/docker-compose)
- **Used by**: `docker/src/app.py:84` health endpoint
- **Status**: ❌ NOT PASSED - Defaults to hardcoded "0.7.3"

### The Problem

**These two mechanisms are NOT connected!**

1. Docker build embeds version as `BUILD_VERSION` → read by `version.py`
2. Flask app reads `BENCHLING_WEBHOOK_VERSION` → displayed in `/health`
3. **They don't talk to each other!**

---

## DETAILED TRACKING

### 1. Version Source: Docker Build

**File**: [docker/Dockerfile](../../docker/Dockerfile)

**Lines 40, 130, 144**: Version is passed as build argument and stored as ENV

```dockerfile
# Line 40: Accept VERSION as build argument
ARG VERSION

# Line 130: Pass VERSION to runtime stage
ARG VERSION

# Line 144: Store VERSION as BUILD_VERSION environment variable
BUILD_VERSION="${VERSION}"
```

**How it works**:
```bash
# CI builds with git tag
docker build --build-arg VERSION=0.8.0 -t benchling-webhook:0.8.0 .

# Inside container:
# BUILD_VERSION=0.8.0
```

**Status**: ✅ WORKING

---

### 2. Version Reader: version.py

**File**: [docker/src/version.py](../../docker/src/version.py)

**Lines 8-35**: Reads version with fallback chain

```python
def get_version() -> str:
    """
    Read version from BUILD_VERSION environment variable or pyproject.toml.

    Priority:
    1. BUILD_VERSION environment variable (set by Docker build from git tag in CI)
    2. pyproject.toml project.version
    3. "unknown" as fallback
    """
    # Check for BUILD_VERSION environment variable first
    if build_version := os.getenv("BUILD_VERSION"):
        return build_version

    # Fall back to pyproject.toml
    try:
        pyproject_path = Path(__file__).parent.parent / "pyproject.toml"
        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)
            return data.get("project", {}).get("version", "unknown")
    except Exception:
        return "unknown"

__version__ = get_version()
```

**Fallback chain**:
1. `BUILD_VERSION` env var (from Docker build)
2. `pyproject.toml` (in development)
3. `"unknown"` (last resort)

**Status**: ✅ WORKING

---

### 3. Version Display: app.py Health Endpoint

**File**: [docker/src/app.py](../../docker/src/app.py)

**Line 84**: Health endpoint reads DIFFERENT environment variable

```python
@app.route("/health", methods=["GET"])
def health():
    """Basic health check - returns 200 if app is running."""
    # Get version from environment (set by CDK) or package default
    app_version = os.getenv("BENCHLING_WEBHOOK_VERSION", "0.7.3")

    response = {
        "status": "healthy",
        "service": "benchling-webhook",
        "version": app_version,  # ❌ Uses BENCHLING_WEBHOOK_VERSION, not BUILD_VERSION!
    }

    return jsonify(response)
```

**The Problem**:
- Reads `BENCHLING_WEBHOOK_VERSION` (NOT `BUILD_VERSION`)
- Defaults to hardcoded `"0.7.3"` if not set
- Does NOT use `version.py:__version__`

**Status**: ❌ BROKEN (wrong environment variable, hardcoded fallback)

---

### 4. Version Propagation: CDK/docker-compose

#### bin/xdg-launch.ts ❌

**File**: [bin/xdg-launch.ts](../../bin/xdg-launch.ts)

**Status**: ❌ NOT PASSED - No mention of BENCHLING_WEBHOOK_VERSION

```typescript
// Lines 182-229: buildEnvVars()
function buildEnvVars(config: ProfileConfig, mode: LaunchMode, options: LaunchOptions): EnvVars {
    const envVars: EnvVars = {
        // ... other envars
        // ❌ MISSING: BENCHLING_WEBHOOK_VERSION
    };
    return envVars;
}
```

#### docker/docker-compose.yml ❌

**File**: [docker/docker-compose.yml](../../docker/docker-compose.yml)

**Status**: ❌ NOT PASSED - No mention of BENCHLING_WEBHOOK_VERSION

```yaml
services:
  app:
    environment:
      # ... other envars
      # ❌ MISSING: BENCHLING_WEBHOOK_VERSION
```

#### lib/fargate-service.ts ❌

**File**: [lib/fargate-service.ts](../../lib/fargate-service.ts)

**Status**: ❌ NOT PASSED - No mention of BENCHLING_WEBHOOK_VERSION

**Historical Note**: Old specs mention this should be passed:
```typescript
// From spec/206-service-envars/06-phase1-design.md:409
BENCHLING_WEBHOOK_VERSION: props.stackVersion || props.imageTag || "latest",
```

But this is NOT in the current code!

---

## IMPACT ANALYSIS

### Current Behavior

When you call `/health`:

```bash
curl http://localhost:5000/health
```

**Response**:
```json
{
  "status": "healthy",
  "service": "benchling-webhook",
  "version": "0.7.3"  // ❌ HARDCODED, WRONG!
}
```

### Expected Behavior

**Response should be**:
```json
{
  "status": "healthy",
  "service": "benchling-webhook",
  "version": "0.8.0"  // ✅ From BUILD_VERSION or package version
}
```

---

## ROOT CAUSE

**app.py uses the WRONG approach**:

1. ❌ **Wrong**: Reads `BENCHLING_WEBHOOK_VERSION` from environment
2. ❌ **Wrong**: Hardcoded default `"0.7.3"`
3. ✅ **Right**: Should use `version.py:__version__`

**Why this exists**:

The code has TWO version mechanisms because:
- `version.py` was created to read `BUILD_VERSION` from Docker
- `app.py` was written earlier to read `BENCHLING_WEBHOOK_VERSION` from CDK
- They were never unified!

---

## SOLUTION OPTIONS

### Option A: Use version.py (RECOMMENDED)

**Change app.py to use the existing version module**:

```python
# docker/src/app.py
from src.version import __version__

@app.route("/health", methods=["GET"])
def health():
    """Basic health check - returns 200 if app is running."""
    response = {
        "status": "healthy",
        "service": "benchling-webhook",
        "version": __version__,  # ✅ Use version from version.py
    }
    return jsonify(response)
```

**Pros**:
- ✅ Single source of truth (`version.py`)
- ✅ Works in all environments (Docker, native, dev)
- ✅ No environment variable needed
- ✅ Proper fallback chain (BUILD_VERSION → pyproject.toml → "unknown")

**Cons**:
- None

**Status**: ✅ RECOMMENDED - This is the cleanest solution

---

### Option B: Pass BENCHLING_WEBHOOK_VERSION

**Add the environment variable to all deployment paths**:

1. **bin/xdg-launch.ts**: Add to `buildEnvVars()`
2. **docker/docker-compose.yml**: Add to both services
3. **lib/fargate-service.ts**: Add to task definition

```typescript
// bin/xdg-launch.ts:buildEnvVars()
BENCHLING_WEBHOOK_VERSION: config.deployment.imageTag || "latest",
```

**Pros**:
- ✅ Keeps existing app.py logic

**Cons**:
- ❌ Adds unnecessary environment variable
- ❌ Duplicates version information (BUILD_VERSION + BENCHLING_WEBHOOK_VERSION)
- ❌ More complex (need to pass version through multiple layers)
- ❌ Still has hardcoded default

**Status**: ❌ NOT RECOMMENDED - Adds complexity

---

### Option C: Hybrid (Use version.py + remove hardcoded default)

**Use version.py but keep environment variable as override**:

```python
# docker/src/app.py
from src.version import __version__

@app.route("/health", methods=["GET"])
def health():
    """Basic health check - returns 200 if app is running."""
    # Allow BENCHLING_WEBHOOK_VERSION to override for special cases
    app_version = os.getenv("BENCHLING_WEBHOOK_VERSION", __version__)

    response = {
        "status": "healthy",
        "service": "benchling-webhook",
        "version": app_version,
    }
    return jsonify(response)
```

**Pros**:
- ✅ Uses version.py by default
- ✅ Allows environment override if needed

**Cons**:
- ❌ Still has two mechanisms
- ❌ Why would you need to override?

**Status**: ⚠️ ACCEPTABLE but unnecessarily complex

---

## RECOMMENDATION

**Use Option A**: Change `app.py` to import and use `version.py:__version__`

### Implementation Steps

1. **Edit docker/src/app.py**:
   - Import `__version__` from `src.version`
   - Replace `os.getenv("BENCHLING_WEBHOOK_VERSION", "0.7.3")` with `__version__`
   - Remove hardcoded default

2. **Test**:
   - Build Docker image with `--build-arg VERSION=0.8.0`
   - Verify `/health` endpoint returns correct version
   - Test in development (should read from pyproject.toml)

3. **No other changes needed**:
   - No environment variable to pass
   - No changes to xdg-launch.ts
   - No changes to docker-compose.yml
   - No changes to fargate-service.ts

---

## FILE LOCATIONS

| File | Line | Purpose | Status |
| ------ | ------ | --------- | -------- |
| [docker/Dockerfile](../../docker/Dockerfile) | 40, 130, 144 | Accept VERSION arg, set BUILD_VERSION | ✅ Working |
| [docker/src/version.py](../../docker/src/version.py) | 8-35 | Read version from BUILD_VERSION or pyproject.toml | ✅ Working |
| [docker/src/app.py](../../docker/src/app.py) | 84 | Display version in /health endpoint | ❌ Uses wrong variable |
| [bin/xdg-launch.ts](../../bin/xdg-launch.ts) | - | Should pass BENCHLING_WEBHOOK_VERSION | ❌ Not passing |
| [docker/docker-compose.yml](../../docker/docker-compose.yml) | - | Should pass BENCHLING_WEBHOOK_VERSION | ❌ Not passing |
| [lib/fargate-service.ts](../../lib/fargate-service.ts) | - | Should pass BENCHLING_WEBHOOK_VERSION | ❌ Not passing |

---

## TESTING CHECKLIST

After implementing Option A:

- [ ] Build Docker image: `docker build --build-arg VERSION=0.8.0 -t test:latest docker/`
- [ ] Run container: `docker run -p 5000:5000 test:latest`
- [ ] Test health endpoint: `curl http://localhost:5000/health`
- [ ] Verify version is "0.8.0" (not "0.7.3")
- [ ] Test in development (no BUILD_VERSION): Should read from pyproject.toml
- [ ] Test in production deployment: Should read from BUILD_VERSION set by CI

---

## RELATED ISSUES

This is related to:
- [14-invalid-envars-removal-checklist.md](./14-invalid-envars-removal-checklist.md) - Removing invalid envars
- [15-new-envars-propagation-audit.md](./15-new-envars-propagation-audit.md) - Ensuring new envars are propagated

**Note**: BENCHLING_WEBHOOK_VERSION is NOT in either checklist because it should be REMOVED entirely (Option A).

---

## PRIORITY

**MEDIUM**: The feature exists and works (via BUILD_VERSION), but the health endpoint shows the wrong version.

**Impact**:
- **Functionality**: ❌ Health endpoint shows wrong version
- **User Experience**: ❌ Confusing (shows "0.7.3" when actual version is "0.8.0")
- **Debugging**: ❌ Harder to identify deployed version
- **Canvas Display**: ❌ If Canvas uses /health, it shows wrong version

**Estimated Effort**: 5-10 minutes (change 3 lines in app.py)

**Risk**: LOW - Simple import change, well-tested version.py module

---

## CONCLUSION

✅ **Version tracking EXISTS** via `version.py` and `BUILD_VERSION`

❌ **Health endpoint is BROKEN** - uses wrong environment variable and hardcoded default

✅ **SOLUTION**: Import and use `version.py:__version__` in `app.py`
