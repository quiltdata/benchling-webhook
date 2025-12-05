# Fix Specification: NGINX Unit Configuration and Testing Architecture

**Issue**: [#280](https://github.com/quiltdata/benchling-webhook/issues/280)
**Date**: 2025-12-04
**Status**: Specification - Ready for Implementation
**Depends On**: [01-failure.md](./01-failure.md)

## Problem Statement

Two critical issues prevent NGINX Unit from working correctly:

1. **Configuration Error**: Unit config specifies `"user": "appuser"` when running unprivileged, causing HTTP 500 on config load
2. **Testing Gap**: NGINX Unit is only installed on x86_64, so local ARM64 testing never exercises production code paths

## Solution Architecture

### Core Principle: Always Install, Explicitly Disable

**Current (broken):**
- NGINX Unit conditionally installed based on architecture
- Production failures invisible during local development
- Silent fallbacks mask configuration errors

**New (correct):**
- NGINX Unit ALWAYS installed (both ARM64 and x86_64)
- NGINX Unit REQUIRED by default (fail fast on errors)
- Explicit `DISABLE_NGINX=true` env var to opt-out
- Dev environments set `DISABLE_NGINX=true` for fast reload workflow
- Production uses NGINX Unit by default (no env var needed)

## Changes Required

### 1. Unit Configuration Fix

**File**: `docker/unit-config.json`

**Problem**:
```json
{
  "user": "appuser"  // ← Causes HTTP 500 in unprivileged container
}
```

**Solution**: Remove the `"user"` field entirely

**Rationale**: Container already runs as `appuser` (UID 1000). NGINX Unit running unprivileged cannot override user/group. The field is redundant and causes configuration rejection.

**Verification**: Unit config loads successfully without HTTP 500 errors

---

### 2. Dockerfile Installation Logic

**File**: `docker/Dockerfile:104-120`

**Current**: Architecture-conditional installation
```dockerfile
if [ "${ARCH_FOR_UNIT}" = "amd64" ] || [ "${ARCH_FOR_UNIT}" = "x86_64" ]; then
    # Install Unit
else
    echo "Skipping NGINX Unit install for architecture ${ARCH_FOR_UNIT} (amd64 only)";
fi
```

**New**: Unconditional installation
```dockerfile
# Install NGINX Unit for all architectures
echo "Installing NGINX Unit for ${ARCH_FOR_UNIT}..."
# ... repo setup and install ...
```

**Rationale**:
- ARM64 packages are available from nginx.org
- Local testing must exercise production code paths
- Architecture differences should not change installed components

**Impact**: Docker image size increases ~10MB on ARM64, but enables correct testing

---

### 3. Startup Script Simplification

**File**: `docker/start-unit.sh`

**Current Behavior**:
- Multiple fallback paths (architecture check, Unit missing, config failure)
- Silent failures mask production issues
- Complex conditional logic

**New Behavior**:
- Single explicit opt-out: `DISABLE_NGINX=true`
- Unit config failure = container failure (fail fast)
- No silent fallbacks

**Logic Flow**:

```text
1. If DISABLE_NGINX=true → exec uvicorn (explicit opt-out)
2. If unitd not found → ERROR + exit 1 (should never happen)
3. If config load fails → ERROR + exit 1 (fail fast)
4. Otherwise → run Unit daemon (production path)
```

**Environment Variable**:
- Name: `DISABLE_NGINX`
- Type: Boolean (`true` = disable, unset/`false` = enable)
- Default: Unset (NGINX Unit enabled)
- Dev override: `DISABLE_NGINX=true`

**Removed Logic**:
- `USE_UNIT` env var (replaced by `DISABLE_NGINX`)
- Architecture detection fallback
- "Unit not available; falling back to uvicorn" path
- Config failure fallback to uvicorn

**Error Handling**:
- Unit not installed: **FATAL** (should never occur after Dockerfile fix)
- Config load failure: **FATAL** (forces fixing configuration errors)
- Startup timeout: **FATAL** (existing behavior, no change)

---

### 4. Development Environment Configuration

**File**: `docker-compose.yml`

**Change**: Add `DISABLE_NGINX=true` to dev service

**Purpose**:
- Dev uses uvicorn for hot-reload workflow
- Explicit declaration of runtime choice
- Does not affect production (no env var = Unit enabled)

**Example**:
```yaml
services:
  app:
    environment:
      - DISABLE_NGINX=true
```

---

### 5. CI/CD Validation

**File**: `.github/workflows/prod.yml`

**Enhancement**: Add post-build validation step

**Check**: Container logs must NOT contain NGINX Unit errors

**Failure Condition**: If production image logs show Unit config failure

**Purpose**: Catch configuration regressions before deployment

---

## Migration Path

### Immediate (Fix Configuration)

1. Remove `"user": "appuser"` from `unit-config.json`
2. Deploy and verify Unit loads successfully

### Phase 2 (Fix Testing)

1. Update Dockerfile to always install NGINX Unit
2. Simplify `start-unit.sh` with `DISABLE_NGINX` env var
3. Add `DISABLE_NGINX=true` to `docker-compose.yml`
4. Update CI to validate container logs

### Phase 3 (Verify)

1. Local test with x86_64 build: `make test-docker-prod-x86`
2. Deploy to dev stack
3. Verify CloudWatch logs show Unit success
4. Deploy to prod stack
5. Monitor production for 24 hours

---

## Success Criteria

### Configuration Fix
- ✅ Unit config loads without HTTP 500 errors
- ✅ Logs show: `[info] unit 1.34.2 started`
- ✅ No "Failed to load NGINX Unit configuration" errors
- ✅ Application serves requests via NGINX Unit

### Testing Architecture
- ✅ NGINX Unit installed on both ARM64 and x86_64 builds
- ✅ Local testing (ARM64 and x86_64) exercises NGINX Unit by default
- ✅ Dev environment uses uvicorn via `DISABLE_NGINX=true`
- ✅ Production uses NGINX Unit by default (no env var)
- ✅ CI validates NGINX Unit starts successfully

### Operational
- ✅ No silent fallbacks (fail fast on errors)
- ✅ Explicit opt-out mechanism for dev workflows
- ✅ Local testing exercises production code path
- ✅ Configuration errors caught before production deployment

---

## Verification Plan

### Local Testing

```bash
# Test dev mode (uvicorn with hot reload)
cd docker
docker-compose up
# Expected: Logs show "DISABLE_NGINX=true; starting uvicorn directly"

# Test production mode (NGINX Unit, any architecture)
make test-docker-prod
# Expected: Logs show "[info] unit 1.34.2 started"
# Expected: No errors in logs
# Expected: Health check returns 200 OK
```

### Production Testing

```bash
# Deploy to dev stack
npm run deploy:dev

# Check CloudWatch logs
npx ts-node scripts/check-logs.ts --profile default --type=ecs --tail=50

# Expected log messages:
# - "[info] 10#10 unit 1.34.2 started"
# - Successful config load (no 500 errors)
# - No "Failed to load" or "falling back" messages

# Verify endpoint responds
curl https://<api-gateway-url>/dev/health
# Expected: 200 OK
```

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| ARM64 Unit packages unavailable | Build failure | Verify nginx.org supports ARM64 before implementation |
| Dev hot-reload broken | Developer productivity | Test `DISABLE_NGINX=true` thoroughly in docker-compose |
| Production Unit still fails | Service degradation | Deploy to dev first; validate logs before prod |
| Docker image size increase | Deployment time | Acceptable tradeoff (~10MB) for correct testing |

---

## Non-Goals

- Performance tuning of NGINX Unit (separate effort)
- Alternative ASGI servers (hypercorn, daphne, etc.)
- Multi-stage rollout (all-or-nothing deployment)
- Backward compatibility with `USE_UNIT` env var (breaking change acceptable)

---

## Open Questions

- **Q**: Do nginx.org packages support ARM64?
  - **A**: Verify before implementation; if not, consider alternative installation method

- **Q**: Should we support `DISABLE_NGINX=false` explicitly or just unset?
  - **A**: Unset is sufficient; boolean check simplifies to `[ "${DISABLE_NGINX}" = "true" ]`

- **Q**: What about Windows containers?
  - **A**: Out of scope; project targets Linux only

---

## References

- [01-failure.md](./01-failure.md) - Root cause analysis
- [NGINX Unit Configuration](https://unit.nginx.org/configuration/#python)
- [Docker Dockerfile best practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
