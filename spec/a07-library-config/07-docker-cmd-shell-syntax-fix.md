# A07-07: Docker CMD Shell Syntax Error Fix

**Status**: Planned
**Date**: 2025-12-18
**Related**: [A07-06 Multi-Stack Support](./06-multi-stack-support.md)

## Problem Summary

**Root Cause**: ECS deployment failed with exit code 2 due to shell syntax error in Docker CMD.

**Error from ECS logs**:

```sh
sh: -c: line 1: syntax error near unexpected token `('
sh: -c: line 1: `gunicorn src.app:create_app() --preload ...`
```

**Evidence**:

- ECS tasks failed with exit code 2: "Essential container in task exited"
- Circuit breaker triggered: "tasks failed to start"
- Deployment rolled back successfully to previous working version
- The shell cannot parse `create_app()` with parentheses in the CMD string

## The Bug

In [docker/Dockerfile:182](../../docker/Dockerfile#L182):

```dockerfile
CMD sh -c "gunicorn src.app:create_app() --preload ..."
```

**Problem**: When using `sh -c` with a string containing `()` parentheses, the shell interprets the parentheses as subshell operators, causing a syntax error.

## Solution Options

### Option A: Hardcode port (exec form)

```dockerfile
CMD ["gunicorn", "src.app:create_app()", "--preload", "-k", "uvicorn.workers.UvicornWorker", "--workers", "2", "--bind", "0.0.0.0:8080", ...]
```

**Pros**: Simple, direct, no shell required
**Cons**: Cannot override PORT at runtime (BREAKS multi-stack support)

**❌ REJECTED**: This Docker image is used by MULTIPLE stacks (webhook, integrated deployments) that may use different ports (8080, 5001, etc.). We CANNOT hardcode the port.

### Option B: Use entrypoint script

Create `entrypoint.sh`:

```bash
#!/bin/sh
exec gunicorn src.app:create_app() --preload ... --bind 0.0.0.0:${PORT} ...
```

**Pros**: Preserves PORT flexibility
**Cons**: Adds complexity, requires creating/maintaining script file

### Option C: Quote the factory function (RECOMMENDED)

```dockerfile
CMD sh -c "gunicorn 'src.app:create_app()' --preload ... --bind 0.0.0.0:${PORT} ..."
```

**Pros**:

- Minimal change (just add quotes)
- Preserves PORT flexibility for multi-stack support
- Maintains shell form for environment variable expansion

**Cons**: Still relies on shell parsing (but correctly quoted)

## Recommended Approach: Option C

### Rationale

1. **CRITICAL**: This Docker image is used by MULTIPLE stacks, not just this webhook stack
2. Other stacks (e.g., integrated deployments) may use PORT=5001 or other ports
3. We CANNOT hardcode the port - it must remain runtime-configurable via `${PORT}`
4. We must preserve shell form for environment variable expansion
5. Quoting `'src.app:create_app()'` prevents shell from interpreting parentheses as subshell operators

### Implementation

**File**: [docker/Dockerfile:182](../../docker/Dockerfile#L182)

**Change**: Add single quotes around `src.app:create_app()`

**Before**:

```dockerfile
CMD sh -c "gunicorn src.app:create_app() --preload -k uvicorn.workers.UvicornWorker --workers 2 --bind 0.0.0.0:${PORT} --worker-tmp-dir /dev/shm --timeout 60 --graceful-timeout 30 --keep-alive 75 --log-level info --access-logfile - --error-logfile -"
```

**After**:

```dockerfile
# Start application with Gunicorn + Uvicorn workers
# Note: Quote 'src.app:create_app()' to prevent shell from parsing parentheses as subshell operators
# Architecture:
# - --preload: Load app before forking workers (enables JWKS cache sharing)
# - --workers 2: Reduced from 4 (shared cache eliminates need for more workers)
# - --worker-tmp-dir /dev/shm: Use tmpfs for worker heartbeat files (read-only filesystem compatibility)
# Timeout Configuration:
# - --timeout 60: Worker timeout (allows JWKS fetch in VPC to complete)
# - --graceful-timeout 30: Graceful shutdown period for workers
# - --keep-alive 75: Keep connections alive to avoid recreation overhead
# - --log-level info: Log worker lifecycle events for debugging
# PORT Configuration:
# - Uses shell form to expand PORT environment variable (defaults to 8080 in ENV)
# - This allows runtime override (e.g., PORT=5001 in integrated deployments)
CMD sh -c "gunicorn 'src.app:create_app()' --preload -k uvicorn.workers.UvicornWorker --workers 2 --bind 0.0.0.0:${PORT} --worker-tmp-dir /dev/shm --timeout 60 --graceful-timeout 30 --keep-alive 75 --log-level info --access-logfile - --error-logfile -"
```

## Testing Plan

1. Build Docker image locally: `npm run docker:build:local`
2. Test locally: `npm run test:local`
3. Verify shell expansion works with different PORT values
4. Build and push dev image: `npm run version:tag:dev`
5. Wait for CI to build and push to ECR
6. Deploy to dev: `npm run deploy:dev -- --yes`
7. Verify deployment succeeds (no circuit breaker)
8. Check ECS logs confirm gunicorn starts correctly
9. Run integration tests: `npm run test:dev`

## Critical Question: Will Rebuilding Fix It?

**YES** - Both local and CI use the same Dockerfile source.

### Build Process Verification

**Local build**:

- Source: `docker/Dockerfile` in repository
- Command: `uv run python scripts/docker.py build --version <version>`
- Called by: `make push-local` → `docker-build-local`

**CI build** (`.github/workflows/prod.yml:63`):

- Source: Same `docker/Dockerfile` from checked-out repository
- Command: `make push-ci VERSION=${{ steps.git.outputs.GIT_SHA }}`
- Which calls: `uv run python scripts/docker.py push --version <SHA> --no-arch-suffix`

**Both use the exact same Dockerfile**, so once we fix line 182 and commit it:

1. CI will build from the fixed Dockerfile
2. The fix will be in the deployed image
3. The shell syntax error will be gone

## Why This Wasn't Caught

**The current main branch Dockerfile already has a bug** - it uses shell form with unquoted parentheses!

Looking at [docker/Dockerfile:182](../../docker/Dockerfile#L182) right now, it has:

```dockerfile
CMD sh -c "gunicorn src.app:create_app() --preload ..."
```

This is the EXACT code that's failing in production. So:

1. ❌ Main branch Dockerfile has the bug (shell form with unquoted parentheses)
2. ❌ Commit b1fa10f has the bug (introduced PORT variable with shell form)
3. ❌ Current ECR image has the bug (built from commit with shell form)
4. ✅ `npm run test:minimal` passes locally because... wait, why?

### Why Did npm run test:minimal Pass?

**OBSERVATION (2025-12-18)**: After rebuilding the Docker image with `make -C docker docker-build-local`, `npm run test:minimal` still **passes successfully** even though the Dockerfile has the unquoted `create_app()` bug.

**Investigation Results**:

1. ✅ No uncommitted changes in `docker/Dockerfile` - the bug is in the committed code
2. ✅ Fresh rebuild uses the buggy Dockerfile - confirmed with `docker inspect`
3. ✅ Can reproduce the error with synthetic test: `docker run ... sh -c "gunicorn src.app:create_app() ..."`
4. ❌ Cannot reproduce error using the Dockerfile's default CMD

> **HYPOTHESIS: Docker Double-Wrapping Masks the Bug Locally**

Docker's shell form CMD gets double-wrapped:

```dockerfile
# Dockerfile (line 182)
CMD sh -c "gunicorn src.app:create_app() ..."

# What Docker actually executes
["/bin/sh", "-c", "sh -c \"gunicorn src.app:create_app() ...\""]
```

The outer shell (`/bin/sh -c`) treats the inner `sh -c "..."` as a string argument and never actually parses the inner shell command. The parentheses in `create_app()` are never interpreted as subshell operators by the shell, so no syntax error occurs.

**Why ECS Fails But Local Works**:

- **Local Docker**: Double-wrapping prevents inner shell from parsing → accidentally works
- **ECS Task Definition**: May override CMD or use different entrypoint → inner shell actually executes → syntax error

**Evidence**:

```bash
# Using default CMD (works - double wrapped)
$ docker run -d benchling-webhook:0.9.7
✅ Container starts successfully

# Running shell command directly (fails - single shell layer)
$ docker run benchling-webhook:0.9.7 sh -c "gunicorn src.app:create_app() ..."
❌ sh: syntax error near unexpected token `('
```

**Conclusion**: The bug exists in the Dockerfile but is masked locally by Docker's double-wrapping behavior. ECS executes the command differently, exposing the bug in production. We cannot write a realistic local test that catches this without synthetic test scripts.

### The Real Issue

When we run `npm run version:tag:dev`:

1. Creates a git tag
2. Pushes to GitHub
3. CI checks out that exact commit
4. CI builds Docker image from that commit's Dockerfile
5. That Dockerfile has the shell syntax error

**So yes, once we fix the Dockerfile and push the fix, CI will build a working image.**

## Related Issues

### Environment Variables Not Related

The environment variables in [bin/commands/deploy.ts:635-672](../../bin/commands/deploy.ts#L635-L672) are NOT related to this failure. Those are CDK synthesis variables used to create CloudFormation parameters, not container runtime variables. The container failure happened before the application even started, so those variables were never accessed.

### Testing Limitation

**Important**: Due to Docker's double-wrapping behavior with shell form CMD, `npm run test:minimal` **cannot** catch this bug. The test will pass even with the buggy Dockerfile. This is a known limitation of local testing - the bug only manifests in ECS production environment.

The fix (quoting `'src.app:create_app()'`) is still necessary and correct, but we must rely on:

1. Code review to catch shell syntax issues in Dockerfile CMD
2. ECS deployment monitoring to detect startup failures
3. The documented fix in this spec

## Implementation Checklist

- [ ] Update [docker/Dockerfile:182](../../docker/Dockerfile#L182) with quoted `'src.app:create_app()'`
- [ ] Build and test locally with `npm run test:minimal`
- [ ] Test with PORT=8080 (default)
- [ ] Test with PORT=5001 (integrated deployment scenario)
- [ ] Commit fix with message: `fix(docker): quote create_app() to prevent shell parsing error`
- [ ] Tag and push dev version: `npm run version:tag:dev`
- [ ] Wait for CI to build and push to ECR
- [ ] Deploy to dev and verify
- [ ] Run integration tests
- [ ] Tag production release if dev tests pass

## Success Criteria

- [ ] Container starts successfully without exit code 2
- [ ] Gunicorn logs show "Booting worker with pid: X"
- [ ] Health checks pass
- [ ] ECS deployment completes without circuit breaker trigger
- [ ] Integration tests pass
- [ ] PORT environment variable expansion works for both 8080 and 5001
