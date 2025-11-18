# Temporary Directory Error Analysis

**Date:** 2025-11-18
**Profile:** bench
**Stage:** prod
**Region:** us-east-2

## Problem Statement

The production deployment is failing with a temporary directory error when processing Benchling entry exports:

```
ERROR:src.entry_packager:2025-11-18T04:35:04.298664Z [error    ] Failed to process export
[src.entry_packager] entry_id=etr_SLRDoVozjZ
error="[Errno 2] No usable temporary directory found in ['/tmp', '/var/tmp', '/usr/tmp', '/app']"
```

This error occurs after the export completes successfully, when attempting to download and process the ZIP file.

## Root Cause Analysis

### Error Location

The error originates from `entry_packager.py:464`:

```python
with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as temp_file:
    for chunk in response.iter_content(chunk_size=8192):
        temp_file.write(chunk)
    zip_path = temp_file.name
```

### Python's `tempfile` Module Behavior

Python's `tempfile.NamedTemporaryFile()` searches for a writable temporary directory in this order:

1. `TMPDIR` environment variable
2. `/tmp`
3. `/var/tmp`
4. `/usr/tmp`
5. Current working directory (as last resort)

The error message indicates that **none of these directories are writable** for the `appuser` in the container.

### Container Configuration Analysis

From [docker/Dockerfile:103-128](docker/Dockerfile#L103-L128):

```dockerfile
# Create non-root user for security (principle of least privilege)
RUN groupadd -r appuser && \
    useradd -r -g appuser -u 1000 appuser && \
    mkdir -p /app /home/appuser

# Set ownership for non-root user
RUN chown -R appuser:appuser /app /home/appuser

# Switch to non-root user
USER appuser
```

**Key observations:**

1. Container runs as non-root `appuser` (UID 1000) for security
2. Only `/app` and `/home/appuser` have ownership set to `appuser:appuser`
3. Standard temporary directories (`/tmp`, `/var/tmp`, `/usr/tmp`) are owned by `root:root`
4. `appuser` has no write permission to standard temporary directories

### Why This Wasn't Caught in Testing

Looking at the test commands from `CLAUDE.md`:

- `npm run test:local` - Tests Docker dev container with hot-reload
- `npm run test:native` - Tests native Flask with **mocked AWS** (no Docker)
- `npm run test:dev` - Tests deployed dev stack

**The issue was likely missed because:**

1. **Local Docker testing** may not enforce the same strict permissions as ECS Fargate
2. **Native Flask testing** doesn't use Docker at all (no container restrictions)
3. **The error only occurs during ZIP processing**, which requires a real Benchling export
4. Most tests probably don't reach the export processing step with real S3 operations

## Secondary Issue: Athena Query Failure

Before the temporary directory error, there's an Athena query failure:

```
ERROR:src.package_query:2025-11-18T04:34:33.515407Z [error    ] Query failed
[src.package_query] error='Query failed: HIVE_FILESYSTEM_ERROR: Failed to list directory:
s3://quilt-ernest-staging/.quilt/packages'
```

This suggests the bucket `quilt-ernest-staging` either:

1. Doesn't exist
2. Has incorrect permissions
3. Has the wrong bucket structure (missing `.quilt/packages` directory)

However, this is a **non-critical warning** since the workflow continues after logging the error. The Canvas update succeeds despite not being able to link to existing packages.

## Impact Assessment

### Critical Path Blocked

The temporary directory error is **FATAL** to the workflow:

```
✅ Webhook received and verified
✅ Entry data fetched (display_id: EXP25000088)
✅ Export initiated (task_id: 7cb55d6a-3dc6-4330-9e6c-603ca9cf4c5c)
✅ Export completed (30 seconds polling)
❌ FAILED: Download and process export ZIP (no writable temp directory)
⛔ BLOCKED: Upload to S3
⛔ BLOCKED: Send message to SQS
⛔ BLOCKED: Quilt package creation
```

### User Experience Impact

From the user's perspective in Benchling:

1. User clicks "Update Package" button in Benchling Canvas
2. Canvas updates to show "Processing..." state
3. **Canvas is never updated to completion state** (because workflow crashes)
4. User is left with no feedback about the failure
5. No package is created in Quilt

## Configuration Gaps

### Missing Environment Variables

The Dockerfile sets several environment variables ([docker/Dockerfile:141-147](docker/Dockerfile#L141-L147)):

```dockerfile
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app" \
    FLASK_APP="src.app" \
    BUILD_VERSION="${VERSION}" \
    PORT="5000" \
    UV_NO_CACHE="1" \
    UV_CACHE_DIR="/tmp/.uv-cache"
```

**Notably absent:**

- `TMPDIR` - Not set (would control where `tempfile` creates files)
- `HOME` - Not explicitly set (defaults to `/home/appuser` but not enforced)

### File System Permissions

The Dockerfile creates writable directories:

- `/app` - Application code and virtual environment
- `/home/appuser` - User home directory

But Python's `tempfile` module doesn't check `HOME` by default—it expects `/tmp` to be writable.

## Solution Requirements

To fix this issue, we need to:

1. **Set `TMPDIR` environment variable** to point to a directory writable by `appuser`
2. **Create and set ownership** of that directory in the Dockerfile
3. **Test with real export processing** to ensure the fix works end-to-end

### Option 1: Use `/tmp` with Proper Ownership

```dockerfile
# Create writable /tmp directory for appuser
RUN mkdir -p /tmp && chown -R appuser:appuser /tmp

USER appuser

ENV TMPDIR="/tmp"
```

**Pros:**

- Follows Linux convention
- No changes needed to application code
- Other tools expect `/tmp` to be writable

**Cons:**

- May conflict with system expectations about `/tmp` ownership
- Could cause issues with multi-tenant container scenarios

### Option 2: Use `/app/tmp` (Application-Specific)

```dockerfile
# Create writable temp directory for appuser
RUN mkdir -p /app/tmp && chown -R appuser:appuser /app/tmp

USER appuser

ENV TMPDIR="/app/tmp"
```

**Pros:**

- Isolated from system temp directory
- Clear separation of concerns
- No risk of conflict with system tools

**Cons:**

- Non-standard location
- Requires explicit `TMPDIR` environment variable

### Option 3: Use `/home/appuser/tmp` (User Home)

```dockerfile
# Create writable temp directory in user home
RUN mkdir -p /home/appuser/tmp && chown -R appuser:appuser /home/appuser/tmp

USER appuser

ENV TMPDIR="/home/appuser/tmp"
```

**Pros:**

- Follows user directory conventions
- Already setting ownership of `/home/appuser`
- Isolated per-user (if multiple users existed)

**Cons:**

- Longer path
- May confuse developers expecting `/tmp`

## Recommended Solution

**Option 2: `/app/tmp`** is recommended because:

1. **Consistency with application structure** - All application files under `/app`
2. **Security isolation** - Temp files isolated to application directory
3. **No system conflicts** - Doesn't interfere with system `/tmp` expectations
4. **Explicit configuration** - `TMPDIR` makes the intent clear

### Implementation Plan

**Dockerfile changes:**

```dockerfile
# Create non-root user for security (principle of least privilege)
RUN groupadd -r appuser && \
    useradd -r -g appuser -u 1000 appuser && \
    mkdir -p /app /app/tmp /home/appuser

# Set working directory
WORKDIR /app

# Copy application artifacts from builder stage
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src
COPY --from=builder /app/pyproject.toml /app/

# Set ownership for non-root user
RUN chown -R appuser:appuser /app /home/appuser

# Switch to non-root user
USER appuser

# Configure environment for Python execution
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app" \
    FLASK_APP="src.app" \
    BUILD_VERSION="${VERSION}" \
    PORT="5000" \
    UV_NO_CACHE="1" \
    UV_CACHE_DIR="/tmp/.uv-cache" \
    TMPDIR="/app/tmp"
```

**No application code changes required** - `tempfile.NamedTemporaryFile()` automatically respects `TMPDIR`.

### Testing Strategy

After implementing the fix, test with:

```bash
# 1. Build updated Docker image
npm run docker:build:local

# 2. Test with real Benchling export processing
npm run test:dev -- --profile bench

# 3. Verify logs show successful ZIP download and processing
npm run setup -- logs --profile bench --type=ecs --tail=100

# 4. Check for successful package creation in S3
aws s3 ls s3://quilt-ernest-staging/benchdev/ --profile <profile>
```

## Additional Observations

### Successful Workflow Steps

Despite the failure, several steps completed successfully:

1. **Webhook routing** - API Gateway → ALB → Fargate (all working)
2. **Benchling API authentication** - OAuth token refresh working
3. **Export API** - Initiated export and polled status successfully
4. **Canvas updates** - Successfully updated Canvas UI (before processing step)

### Health Checks Working

Health check endpoints are functioning:

```
✅ /healthcheck - uWSGI health (ELB health checker)
✅ /health - Application health (Werkzeug/Flask)
✅ / - Root endpoint (basic connectivity)
```

All health checks returning 200 OK, so the service **appears healthy** to ECS despite the workflow failure.

### Logging Configuration Working

Structured logging with `structlog` is working well:

- Clear error messages with context
- Proper log levels (INFO, WARNING, ERROR)
- Helpful metadata (entry_id, task_id, package_name, etc.)
- Easy to trace workflow progression

## Next Steps

1. **Implement TMPDIR fix** in Dockerfile (add `/app/tmp` with ownership and set `TMPDIR`)
2. **Rebuild and deploy** to dev environment for testing
3. **Test with real export** to verify ZIP download/processing works
4. **Address Athena query issue** (investigate bucket permissions for `quilt-ernest-staging`)
5. **Add error recovery** in Canvas update (show failure state to user if workflow crashes)

## Related Files

- [docker/Dockerfile](docker/Dockerfile) - Container configuration
- [docker/src/entry_packager.py:464](docker/src/entry_packager.py#L464) - `tempfile.NamedTemporaryFile()` usage
- [docker/src/config.py](docker/src/config.py) - Environment variable configuration
- [spec/206-service-envars/](spec/206-service-envars/) - Service environment variables specification

## References

- Python `tempfile` module documentation: <https://docs.python.org/3/library/tempfile.html>
- Docker best practices for non-root users: <https://docs.docker.com/develop/develop-images/dockerfile_best-practices/#user>
- Amazon Linux 2023 container image: <https://github.com/amazonlinux/container-images>
