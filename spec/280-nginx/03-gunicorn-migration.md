# Migration Specification: NGINX Unit → Gunicorn + Uvicorn Workers

**Issue**: [#280](https://github.com/quiltdata/benchling-webhook/issues/280)
**Date**: 2025-12-04
**Status**: Proposed
**Supersedes**: [02-nginx-config-fix.md](./02-nginx-config-fix.md)

## Executive Summary

**Decision**: Remove NGINX Unit entirely, migrate to Gunicorn + Uvicorn workers

**Rationale**:
1. NGINX Unit is **archived and unmaintained** as of October 2025
2. No ARM64 packages available for Amazon Linux 2023 (prevents local testing)
3. Gunicorn + Uvicorn is the industry-standard ASGI deployment pattern

## Critical Finding: NGINX Unit Status

**Official Status**: https://unit.nginx.org/
> "As of October 2025, NGINX Unit is archived and unmaintained"

**Evidence**:
- Latest version: 1.34.2 (released February 2025)
- No future updates or security patches planned
- ARM64 packages unavailable: `https://packages.nginx.org/unit/amzn/2023/aarch64/` returns 404
- Only x86_64 supported: `https://packages.nginx.org/unit/amzn/2023/x86_64/`

**Impact**:
- Security vulnerabilities will not be patched
- ARM64 Macs cannot run production-equivalent containers
- Local/production parity broken (different runtimes)

## Proposed Solution: Gunicorn + Uvicorn Workers

### Why This Stack?

**Production Standard**:
- ✅ Battle-tested: Used by FastAPI, Starlette, Django Channels
- ✅ Actively maintained: Both gunicorn and uvicorn under active development
- ✅ ASGI-native: Full async/await support via `uvicorn.workers.UvicornWorker`
- ✅ Multi-arch: Pure Python, works identically on ARM64 and x86_64
- ✅ Simple: Single process manager, no complex startup scripts
- ✅ ECS/Fargate optimized: Works perfectly behind NLB

**Architecture Fit**:
```
Internet → API Gateway → VPC Link → NLB → ECS Tasks (Gunicorn + Uvicorn workers)
                                                      ↑
                                            No NGINX needed in container
```

We already have NLB for load balancing. Adding NGINX inside containers provides no benefit.

### Alternatives Considered

| Option | Verdict | Reason |
|--------|---------|--------|
| Fix NGINX Unit | ❌ Rejected | Archived, no ARM64 support, security risk |
| Use nginx/unit Docker image | ❌ Rejected | Still unmaintained, ~200MB larger images |
| uWSGI + NGINX | ❌ Rejected | WSGI-focused, ASGI support experimental |
| NGINX + uvicorn | ❌ Rejected | Unnecessary complexity, NLB already balances |
| Gunicorn + uvicorn workers | ✅ **Selected** | Standard, maintained, simple |

## Implementation Plan

### Phase 1: Dependency Updates

**File**: [docker/pyproject.toml](../../docker/pyproject.toml)

**Add dependencies**:
```toml
[project.dependencies]
gunicorn = "^23.0.0"
uvicorn = {extras = ["standard"], version = "^0.34.0"}
```

**Notes**:
- `uvicorn[standard]` includes uvloop and httptools for performance
- Gunicorn 23.0.0+ has improved async worker handling

### Phase 2: Dockerfile Simplification

**File**: [docker/Dockerfile](../../docker/Dockerfile)

**Remove** (lines 105-123):
- NGINX Unit installation logic
- Architecture-conditional installation
- Unit repository configuration

**Remove** (lines 172-175):
- `UNIT_STATE_DIR`
- `UNIT_CONFIG_TEMPLATE`
- `UNIT_CONFIG_PATH`
- `UNIT_CONTROL_SOCKET`

**Update CMD**:
```dockerfile
# Start application with Gunicorn + Uvicorn workers
CMD ["gunicorn", "src.app:create_app", \
     "--factory", \
     "-k", "uvicorn.workers.UvicornWorker", \
     "--workers", "4", \
     "--bind", "0.0.0.0:8080", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
```

**Worker count calculation**:
- Default: 4 workers (good for 2 vCPU Fargate tasks)
- Formula: `min(4, (2 * CPU_cores) + 1)`
- Future: Make configurable via `GUNICORN_WORKERS` env var

### Phase 3: Remove NGINX Unit Files

**Delete**:
- [docker/unit-config.json](../../docker/unit-config.json) - NGINX Unit config
- [docker/start-unit.sh](../../docker/start-unit.sh) - Complex startup script
- [docker/src/unit_app.py](../../docker/src/unit_app.py) - If exists

**Rationale**: No longer needed with gunicorn

### Phase 4: Update Docker Compose

**File**: [docker/docker-compose.yml](../../docker/docker-compose.yml)

**Production service (`app`)**:
```yaml
services:
  app:
    # ... existing config ...
    command: ["gunicorn", "src.app:create_app", "--factory", "-k", "uvicorn.workers.UvicornWorker", "--workers", "2", "--bind", "0.0.0.0:8080"]
```

**Dev service (`app-dev`)**:
- Keep existing `uvicorn --reload` for hot-reload
- Remove `DISABLE_NGINX=true` env var (no longer relevant)

### Phase 5: Update CI/CD

**File**: [.github/workflows/prod.yml](../../.github/workflows/prod.yml)

**Remove** (lines 123-163):
- "Validate NGINX Unit configuration" step

**Update** (line 170):
- Change `"✅ NGINX Unit configuration validated"` to `"✅ Application starts successfully"`

**New validation logic**:
```yaml
- name: Validate application startup
  run: |
    # ... container startup ...
    if docker logs ${CONTAINER_ID} 2>&1 | grep -q "Booting worker with pid"; then
      echo "✅ Gunicorn started successfully"
    fi
```

### Phase 6: Documentation Updates

**Files to update**:
- [CLAUDE.md](../../CLAUDE.md)
- [README.md](../../README.md)

**Key changes**:
- Remove NGINX Unit references
- Document gunicorn as production runtime
- Update startup commands
- Remove `DISABLE_NGINX` env var documentation

**New sections**:
```markdown
## Production Runtime

- **Server**: Gunicorn 23.0.0 with Uvicorn workers
- **Workers**: 4 (configurable via GUNICORN_WORKERS)
- **Protocol**: ASGI (async/await support)
- **Port**: 8080

## Development Runtime

- **Server**: Uvicorn with --reload
- **Hot-reload**: Enabled for fast iteration
- **Port**: 8082 (docker-compose dev service)
```

## Migration Path

### Step 1: Update Dependencies
```bash
cd docker
# Add gunicorn to pyproject.toml
uv add gunicorn uvicorn[standard]
uv lock
```

### Step 2: Update Dockerfile
```bash
# Remove NGINX Unit installation (lines 105-123)
# Remove UNIT_* env vars (lines 172-175)
# Update CMD to use gunicorn
```

### Step 3: Test Locally (Both Architectures)
```bash
# Test ARM64 (local Mac)
docker build --platform linux/arm64 -t benchling-webhook:arm64 .
docker run -d --platform linux/arm64 -p 8084:8080 benchling-webhook:arm64
curl http://localhost:8084/health

# Test x86_64 (production target)
docker build --platform linux/amd64 -t benchling-webhook:amd64 .
docker run -d --platform linux/amd64 -p 8085:8080 benchling-webhook:amd64
curl http://localhost:8085/health
```

### Step 4: Deploy to Dev
```bash
npm run deploy:dev
```

**Monitor CloudWatch logs** for:
```
[INFO] Starting gunicorn 23.0.0
[INFO] Listening at: http://0.0.0.0:8080
[INFO] Using worker: uvicorn.workers.UvicornWorker
[INFO] Booting worker with pid: 10
[INFO] Application startup complete.
```

### Step 5: Verify Dev Stack
```bash
# Check health endpoint
curl https://<dev-api-gateway-url>/dev/health

# Monitor for 24 hours
npx ts-node scripts/check-logs.ts --profile default --type=ecs --tail=100
```

### Step 6: Deploy to Production
```bash
npm run deploy:prod -- --profile default --stage prod --yes
```

### Step 7: Monitor Production
- Watch CloudWatch logs for 48 hours
- Verify health checks pass
- Monitor error rates
- Check latency metrics

## Success Criteria

### Startup Logs
```
[2025-12-04 10:00:00 +0000] [10] [INFO] Starting gunicorn 23.0.0
[2025-12-04 10:00:00 +0000] [10] [INFO] Listening at: http://0.0.0.0:8080 (10)
[2025-12-04 10:00:00 +0000] [10] [INFO] Using worker: uvicorn.workers.UvicornWorker
[2025-12-04 10:00:01 +0000] [12] [INFO] Booting worker with pid: 12
[2025-12-04 10:00:01 +0000] [13] [INFO] Booting worker with pid: 13
[2025-12-04 10:00:01 +0000] [14] [INFO] Booting worker with pid: 14
[2025-12-04 10:00:01 +0000] [15] [INFO] Booting worker with pid: 15
[2025-12-04 10:00:01 +0000] [12] [INFO] Started server process [12]
[2025-12-04 10:00:01 +0000] [12] [INFO] Application startup complete.
```

### Functional Tests
- ✅ Health endpoint responds (200 OK)
- ✅ Webhook endpoint accepts requests
- ✅ HMAC signature verification works
- ✅ S3 uploads succeed
- ✅ SQS messages published
- ✅ No errors in CloudWatch logs

### Performance Tests
- ✅ Response time < 500ms (p95)
- ✅ No 5xx errors under load
- ✅ Memory usage stable
- ✅ CPU usage < 80%

### Operational Checks
- ✅ Container starts on both ARM64 and x86_64
- ✅ ECS health checks pass
- ✅ NLB target health green
- ✅ Graceful shutdown on SIGTERM
- ✅ Worker auto-restart on crash

## Rollback Plan

If issues arise, rollback to previous NGINX Unit version:

```bash
git revert <migration-commit>
npm run deploy:prod -- --profile default --stage prod --yes
```

**Note**: This brings back NGINX Unit issues but restores known behavior.

## Benefits of Migration

### Simplicity
- **Before**: Dockerfile (120 lines) + unit-config.json + start-unit.sh (75 lines) + DISABLE_NGINX logic
- **After**: Dockerfile (95 lines) + simple CMD

### Reliability
- **Before**: Archived software, no security patches, ARM64 incompatible
- **After**: Actively maintained, security updates, multi-arch

### Developer Experience
- **Before**: ARM64 Macs use uvicorn, x86_64 uses Unit (different runtimes)
- **After**: All architectures use gunicorn (local/prod parity)

### Maintainability
- **Before**: Complex startup script, conditional installation, JSON config
- **After**: Single CMD, standard Python deployment

### Future-Proof
- **Before**: Dependent on unmaintained software
- **After**: Standard ASGI stack with active community

## Non-Goals

- **Not changing**: API Gateway, VPC Link, NLB, ECS configuration
- **Not changing**: Environment variables (PORT, AWS_*, QUILT_*)
- **Not changing**: Health endpoints (/health, /health/ready, /health/live)
- **Not adding**: NGINX reverse proxy inside container (unnecessary with NLB)
- **Not changing**: Worker count algorithm (future enhancement)

## Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Regression in production | High | Low | Deploy to dev first, monitor 24h |
| Performance degradation | Medium | Low | Gunicorn is proven, used widely |
| Unknown dependencies on Unit | Medium | Very Low | Thorough testing in dev |
| Docker build failures | Low | Very Low | Test multi-arch locally first |

## Open Questions

None - all architectural decisions resolved.

## References

- [01-failure.md](./01-failure.md) - Root cause analysis
- [02-nginx-config-fix.md](./02-nginx-config-fix.md) - Original fix attempt (superseded)
- [NGINX Unit Status](https://unit.nginx.org/) - Archived software notice
- [Gunicorn Documentation](https://docs.gunicorn.org/)
- [Uvicorn Workers](https://www.uvicorn.org/deployment/#gunicorn)
- [FastAPI Deployment](https://fastapi.tiangolo.com/deployment/server-workers/)

## Approval

- [ ] Technical approval
- [ ] Security review
- [ ] Performance baseline established
- [ ] Rollback plan validated
- [ ] Monitoring dashboards updated

---

**Last Updated**: 2025-12-04
**Author**: Claude Code (via investigation)
**Status**: Awaiting approval
