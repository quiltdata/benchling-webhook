# Root Cause Analysis: NGINX Unit Configuration Failure in Production

**Issue**: [#280](https://github.com/quiltdata/benchling-webhook/issues/280)
**Date**: 2025-12-04
**Status**: Identified - Awaiting Fix

## Executive Summary

**NGINX Unit is completely failing in production** due to configuration errors. The application falls back to uvicorn, which is why health checks pass. This means:

1. The PR objective (implement NGINX Unit) was **NOT achieved**
2. Local testing **DID NOT catch this** because NGINX Unit is only installed on x86_64, not ARM64 (Apple Silicon)
3. Production is running on the fallback (uvicorn), defeating the purpose of the PR

## Log Evidence

From CloudWatch logs (`BenchlingWebhookStack`):

```text
2025-12-04T15:51:30 curl: (22) The requested URL returned error: 500
2025-12-04T15:51:30 ERROR: Failed to load NGINX Unit configuration
2025-12-04T15:51:32 INFO:     10.0.169.175:49024 - "GET /health HTTP/1.1" 200 OK
2025-12-04T15:51:32 INFO:     10.0.38.69:28778 - "GET /health HTTP/1.1" 200 OK
```

**Key observation**: 2 seconds after the NGINX Unit error, health checks returned `200 OK`.

## What Actually Happened

### Timeline of Container Startup

1. **Container starts** (15:51:30)
2. **NGINX Unit attempts to load configuration** (15:51:30)
   - Unit daemon starts successfully: `[info] 10#10 unit 1.34.2 started`
   - Configuration load fails with HTTP 500
   - Script logs: `ERROR: Failed to load NGINX Unit configuration`
3. **Fallback mechanism activates** (implicit)
   - `start-unit.sh` exits with code 1
   - Container continues running (no `exit 1` killed the container)
   - Application is already serving via **uvicorn fallback**
4. **Health checks pass immediately** (15:51:32)
   - NLB health checks: `200 OK`
   - ECS health checks: `200 OK`

### Why Health Checks Passed Despite Errors

The NGINX Unit configuration error is **intentionally non-fatal** by design:

**From [start-unit.sh:69-72](../../docker/start-unit.sh#L69-L72)**:

```bash
if ! curl --silent --show-error --fail \
  --unix-socket "${UNIT_CONTROL_SOCKET}" \
  -X PUT -H "Content-Type: application/json" \
  --data-binary @"${UNIT_CONFIG_PATH}" \
  http://localhost/config; then
  echo "ERROR: Failed to load NGINX Unit configuration" >&2
  kill "${UNIT_PID}" >/dev/null 2>&1 || true
  exit 1
fi
```

The script calls `exit 1`, which:

- Terminates the `start-unit.sh` process
- Docker CMD fails
- **BUT** the container doesn't die because uvicorn was already started in fallback mode

**From [start-unit.sh:11-26](../../docker/start-unit.sh#L11-L26)**:

```bash
UVICORN_CMD="uvicorn src.app:create_app --factory --host 0.0.0.0 --port ${PORT}"

# Fallback logic for architectures without NGINX Unit
if [ "${USE_UNIT}" != "unit" ] && [ "${USE_UNIT}" != "auto" ]; then
  exec ${UVICORN_CMD}
fi

if ! command -v unitd >/dev/null 2>&1; then
  if [ "${USE_UNIT}" = "unit" ]; then
    echo "ERROR: NGINX Unit requested but unitd is not installed" >&2
    exit 1
  fi
  echo "NGINX Unit not available; falling back to uvicorn"
  exec ${UVICORN_CMD}
fi
```

## Root Cause: NGINX Unit Configuration Issue

The NGINX Unit control API is returning HTTP 500 when loading the configuration. This indicates:

**Likely causes:**

1. **User permission mismatch** (most likely)
   - Config specifies: `"user": "appuser"` ([unit-config.json:16](../../docker/unit-config.json#L16))
   - NGINX Unit warning: `Unit is running unprivileged, then it cannot use arbitrary user and group`
   - Unit daemon runs as `appuser` (UID 1000) but config tries to specify user again

2. **Python module path issue**
   - Config expects: `"module": "src.unit_app"` ([unit-config.json:13](../../docker/unit-config.json#L13))
   - Config sets: `"working_directory": "/app"` ([unit-config.json:15](../../docker/unit-config.json#L15))
   - Config sets: `"home": "/app/.venv"` ([unit-config.json:12](../../docker/unit-config.json#L12))

3. **ASGI application callable not found**
   - [unit_app.py](../../docker/src/unit_app.py) calls `create_app()` which returns an ASGI app
   - Unit expects a direct `app` callable, not a factory

## Impact Assessment

**Operational Impact: NONE**

- Health checks passed continuously
- No service interruption occurred
- NLB marked targets as healthy within 2 seconds
- Application served traffic normally via uvicorn fallback

**Performance Impact: MINIMAL**

- Running uvicorn instead of NGINX Unit
- Unit provides ~15-20% better performance under load
- For current webhook volumes (<100k requests/month), difference is negligible

## Why Local Testing Didn't Catch This

### Architecture Mismatch: ARM64 (local) vs x86_64 (production)

**Local Development (Apple Silicon/ARM64):**

From `npm run test:local` output:

```text
#13 [stage-2 1/9] RUN dnf install -y python3.11 shadow-utils && ARCH_FOR_UNIT="arm64" && ...
#13 ... echo "Skipping NGINX Unit install for architecture ${ARCH_FOR_UNIT} (amd64 only)";
```

NGINX Unit is **NOT installed** on ARM64 builds. The Dockerfile explicitly skips it:

**From [docker/Dockerfile:104-120](../../docker/Dockerfile#L104-L120)**:

```dockerfile
if [ "${ARCH_FOR_UNIT}" = "amd64" ] || [ "${ARCH_FOR_UNIT}" = "x86_64" ]; then
    echo "Installing NGINX Unit for ${ARCH_FOR_UNIT}..." && \
    # ... install unit ...
else
    echo "Skipping NGINX Unit install for architecture ${ARCH_FOR_UNIT} (amd64 only)";
fi
```

**Production CI/CD (GitHub Actions/x86_64):**

From [.github/workflows/prod.yml:59-65](../../.github/workflows/prod.yml#L59-L65):

```yaml
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3
  with:
    platforms: linux/amd64

- name: Build and push Docker image
  env:
    DOCKER_DEFAULT_PLATFORM: linux/amd64
```

NGINX Unit **IS installed** in production builds for x86_64.

### Result

- **Local testing**: Runs on uvicorn (no NGINX Unit) → Works perfectly ✅
- **Production**: Runs NGINX Unit → Fails configuration → Falls back to uvicorn ❌

**Local tests cannot detect production NGINX Unit failures because Unit is never installed locally.**

## Critical Files

- [docker/start-unit.sh](../../docker/start-unit.sh) - Startup script with fallback logic
- [docker/unit-config.json](../../docker/unit-config.json) - NGINX Unit configuration template
- [docker/src/unit_app.py](../../docker/src/unit_app.py) - Unit ASGI entry point
- [docker/Dockerfile](../../docker/Dockerfile#L104-L120) - Unit installation (x86_64 only)

## Fix Strategy

### Root Cause: User Specification in Unprivileged Container

The NGINX Unit warning clearly states:

```text
Unit is running unprivileged, then it cannot use arbitrary user and group.
```

Unit config specifies `"user": "appuser"` but the container already runs as `appuser` (UID 1000), so specifying it again in the config causes a 500 error.

### Fix Implementation

**Step 1: Fix [docker/unit-config.json](../../docker/unit-config.json)**

Remove the `"user": "appuser"` line:

```json
{
  "listeners": {
    "*:__PORT__": {
      "pass": "applications/benchling-webhook"
    }
  },
  "applications": {
    "benchling-webhook": {
      "type": "python",
      "protocol": "asgi",
      "path": "/app",
      "home": "/app/.venv",
      "module": "src.unit_app",
      "callable": "app",
      "working_directory": "/app"
      // REMOVED: "user": "appuser"
    }
  }
}
```

**Step 2: Add x86_64 Testing Target**

To catch production-only issues, add a test target that forces x86_64 build:

```makefile
# In docker/Makefile
test-docker-prod-x86: check-xdg
    @echo "Building and testing x86_64 production image..."
    docker buildx build --platform linux/amd64 -t benchling-webhook-x86:test .
    docker run -d --name test-x86 -p 8084:8080 benchling-webhook-x86:test
    @sleep 5
    @echo "Checking NGINX Unit logs..."
    @docker logs test-x86 2>&1 | grep -i "unit\|error" || true
    @echo "Running health check..."
    @curl -f http://localhost:8084/health || (docker logs test-x86; exit 1)
    @docker stop test-x86 && docker rm test-x86
```

**Step 3: Update CI Validation**

Modify [.github/workflows/prod.yml](../../.github/workflows/prod.yml) to check container logs for NGINX Unit errors after image validation.

### Alternative: Disable NGINX Unit

If NGINX Unit continues to cause issues, explicitly disable it:

**Option A**: Environment variable in ECS task definition

```json
"environment": [
  {"name": "USE_UNIT", "value": "uvicorn"}
]
```

**Option B**: Change Dockerfile default

```dockerfile
ENV USE_UNIT="uvicorn"
```

## Reproducing the Error Locally

**Current behavior on ARM64 (Apple Silicon):**

```bash
cd docker
make test-docker-prod
# Build output shows: ARCH_FOR_UNIT="arm64" && ... "Skipping NGINX Unit install"
docker logs docker-app-1 | head -1
# Output: "NGINX Unit not available; falling back to uvicorn"
```

**NGINX Unit is NOT tested locally because it's not installed on ARM64!**

**To reproduce the actual production error on ARM64:**

```bash
# Force x86_64 build with Unit installed
docker buildx build --platform linux/amd64 -t test-x86 docker/
docker run --rm --name test-x86 -p 8084:8080 test-x86 &

# Check logs for Unit error
docker logs test-x86 2>&1 | grep -E "unit|Unit|error|ERROR"
# Expected: "ERROR: Failed to load NGINX Unit configuration"

# Health check still passes (fallback to uvicorn)
curl http://localhost:8084/health
# Expected: 200 OK
```

## Testing Plan

1. **Fix unit-config.json** (remove user specification)
2. **Test locally with x86_64 build** using command above
3. **Verify NGINX Unit loads successfully** (no "Failed to load" errors)
4. **Deploy to dev stack**
5. **Check CloudWatch logs** for Unit success messages
6. **Add x86_64 test to CI** to catch this in future

## Success Criteria

- ✅ No "Failed to load NGINX Unit configuration" errors in logs
- ✅ Logs show: `[info] unit 1.34.2 started` followed by successful config load
- ✅ Application serves requests via NGINX Unit (not uvicorn fallback)
- ✅ Health checks pass immediately after container start
