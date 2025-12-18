# Implementation Phases: Dockerfile Rework

**Reference**: 01-requirements.md, 02-analysis.md, 03-specifications.md
**Date**: 2025-11-06

## Phase Strategy

This implementation will be executed in a **single phase** due to the nature of Dockerfile changes - the Dockerfile must be complete and functional as a single unit. However, we will use incremental validation and testing to ensure each aspect works correctly before final integration.

The single-phase approach is justified because:
1. Dockerfile changes are atomic - cannot partially deploy a multi-stage build
2. ECS requires a complete, working Docker image
3. Build changes don't affect running deployments until explicitly deployed
4. Can validate locally before pushing to ECR
5. Rollback is simple - revert Dockerfile and rebuild previous version

## Phase 1: Complete Dockerfile Rework

**Goal**: Implement all requirements in a single, tested, production-ready Dockerfile

**Deliverables**:
- New Dockerfile with multi-stage build
- Amazon Linux 2023 base with hash pinning
- Direct Python execution (no uv run wrapper)
- Read-only filesystem compatibility
- Documentation updates
- Test validation

**Success Criteria**:
- ✓ Image builds successfully
- ✓ All tests pass (unit and integration)
- ✓ Image size reduced by 30%+
- ✓ Application starts without filesystem errors
- ✓ Health checks respond correctly
- ✓ Compatible with existing ECS deployment

**Dependencies**:
- None (can be developed and tested independently)

### Phase 1 Incremental Validation Approach

While implemented as a single phase, validation will be incremental:

#### Validation Stage 1: Base Image and Builder
- Establish Amazon Linux 2023 base with hash
- Create builder stage with uv and dependencies
- Verify dependencies install correctly
- Test virtual environment creation

#### Validation Stage 2: Runtime Stage
- Create minimal runtime stage
- Copy application and venv from builder
- Verify Python can find dependencies
- Test application imports

#### Validation Stage 3: Runtime Execution
- Modify CMD to use direct Python execution
- Test application startup
- Verify no filesystem write attempts
- Validate health checks work

#### Validation Stage 4: Full Integration
- Run complete test suite
- Measure image size reduction
- Test in local Docker environment
- Validate against all acceptance criteria

## Phase 1 Detailed Breakdown

### Sub-Phase 1.1: Research and Preparation

**Tasks**:
1. Fetch reference Dockerfile from quiltdata/quilt
2. Determine Python version available on Amazon Linux 2023
3. Identify Amazon Linux 2023 base image hash
4. Document system dependencies needed
5. Create research notes in spec directory

**Deliverables**:
- Research notes documenting findings
- Base image hash documented
- System dependency list

**Time Estimate**: 1 hour

### Sub-Phase 1.2: Builder Stage Implementation

**Tasks**:
1. Create new Dockerfile with multi-stage structure
2. Define builder stage with Amazon Linux 2023 + hash
3. Install Python and system build dependencies
4. Install uv in builder stage
5. Copy pyproject.toml and uv.lock
6. Run uv sync in builder stage
7. Verify virtual environment created correctly

**Deliverables**:
- Dockerfile with complete builder stage
- Build successfully completes builder stage

**Time Estimate**: 2 hours

**Validation**:
```bash
# Test builder stage only
docker build --target builder -t benchling-webhook-builder .
docker run benchling-webhook-builder python --version
docker run benchling-webhook-builder ls -la /app/.venv
```

### Sub-Phase 1.3: Runtime Stage Implementation

**Tasks**:
1. Define runtime stage with Amazon Linux 2023 + hash
2. Install minimal Python runtime
3. Install curl for health checks (if needed)
4. Create non-root user (appuser)
5. Copy application code from builder
6. Copy virtual environment from builder
7. Set proper permissions
8. Configure environment variables

**Deliverables**:
- Complete runtime stage definition
- Application code and venv in runtime stage

**Time Estimate**: 2 hours

**Validation**:
```bash
# Test full build
docker build -t benchling-webhook:test .
docker run benchling-webhook:test ls -la /app
docker run benchling-webhook:test python -c "import sys; print(sys.path)"
```

### Sub-Phase 1.4: Application Execution Configuration

**Tasks**:
1. Update CMD to use direct Python execution
2. Configure Python to use virtual environment
3. Set PYTHONPATH correctly
4. Test application import paths
5. Verify Flask app creation
6. Test health check endpoints

**Deliverables**:
- Working CMD that starts Flask app
- All health endpoints responding

**Time Estimate**: 1 hour

**Validation**:
```bash
# Test application startup
docker run -d -p 5000:5000 --name test-app benchling-webhook:test
sleep 5
curl http://localhost:5000/health
curl http://localhost:5000/health/ready
docker logs test-app
docker rm -f test-app
```

### Sub-Phase 1.5: Read-Only Filesystem Testing

**Tasks**:
1. Test container with read-only root filesystem
2. Identify any filesystem write attempts
3. Fix any remaining write operations
4. Verify no cache directory creation
5. Validate no errors in logs

**Deliverables**:
- Container runs successfully with read-only filesystem
- No filesystem errors in logs

**Time Estimate**: 1 hour

**Validation**:
```bash
# Test with read-only filesystem
docker run -d -p 5000:5000 --read-only --name test-ro benchling-webhook:test
sleep 5
curl http://localhost:5000/health
docker logs test-ro | grep -i "read-only"
docker rm -f test-ro
```

### Sub-Phase 1.6: Optimization and Documentation

**Tasks**:
1. Optimize layer ordering for cache efficiency
2. Add inline comments to Dockerfile
3. Document base image hash and verification
4. Measure and document image size reduction
5. Update any related documentation
6. Add Dockerfile best practices

**Deliverables**:
- Well-documented Dockerfile
- Performance metrics documented
- README updates (if needed)

**Time Estimate**: 1 hour

### Sub-Phase 1.7: Testing and Validation

**Tasks**:
1. Run full unit test suite
2. Run integration tests (if applicable)
3. Run linting (hadolint, flake8)
4. Measure build time
5. Measure image size
6. Validate against all acceptance criteria
7. Test local make targets

**Deliverables**:
- All tests passing
- All quality gates met
- Metrics documented

**Time Estimate**: 2 hours

**Validation**:
```bash
# Full test suite
make -C docker build
make -C docker test-unit
make -C docker lint

# Size comparison
docker images | grep benchling

# Quality checks
hadolint docker/Dockerfile
```

### Sub-Phase 1.8: Final Integration Testing

**Tasks**:
1. Build image with production tag
2. Test image pull from local registry
3. Validate image tagging scheme compatibility
4. Test with environment variables from ECS
5. Verify CloudWatch logging works
6. Validate health check timing
7. Test webhook processing (if possible locally)

**Deliverables**:
- Production-ready Docker image
- All integration tests passing
- Ready for ECR push and deployment

**Time Estimate**: 1 hour

**Validation**:
```bash
# Production-like test
docker build -t 712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:test .
docker run -d -p 5000:5000 \
  -e LOG_LEVEL=INFO \
  -e FLASK_ENV=production \
  --read-only \
  --name prod-test \
  712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:test

# Test health and logs
sleep 10
curl http://localhost:5000/health
docker logs prod-test
docker rm -f prod-test
```

## Pre-Factoring Opportunities

### PF-1: Backup Current Dockerfile

Before making changes, create backup:
```bash
cp docker/Dockerfile docker/Dockerfile.backup-python-slim
```

This enables:
- Easy comparison with old approach
- Quick rollback if needed
- Documentation of migration path

### PF-2: Measure Baseline Metrics

Before implementation, measure:
- Current image size: `docker images | grep benchling`
- Current build time: `time docker build -t benchling-webhook:baseline docker/`
- Current layer count: `docker history benchling-webhook:baseline`

This provides:
- Clear success metric targets
- Regression detection
- Performance comparison data

### PF-3: Create Test Fixtures

Prepare test environment:
- Sample environment variables
- Mock AWS credentials (for local testing)
- Test webhook payloads
- Health check test scripts

This enables:
- Faster validation cycles
- Consistent testing approach
- Automated validation

## Integration Testing Strategy

### Local Testing Sequence

1. **Build Test**:
   ```bash
   cd docker
   docker build -t benchling-webhook:test .
   ```

2. **Unit Test**:
   ```bash
   make test-unit
   ```

3. **Runtime Test**:
   ```bash
   docker run -d -p 5000:5000 --name test benchling-webhook:test
   curl http://localhost:5000/health
   docker rm -f test
   ```

4. **Read-Only Test**:
   ```bash
   docker run -d -p 5000:5000 --read-only --name test benchling-webhook:test
   curl http://localhost:5000/health
   docker logs test 2>&1 | grep -i error
   docker rm -f test
   ```

5. **Lint Test**:
   ```bash
   make lint
   hadolint Dockerfile
   ```

### CI/CD Integration

Existing CI pipeline should:
1. Build new Docker image
2. Run all tests
3. Push to ECR if tests pass
4. Tag with version or commit SHA

No changes to CI/CD expected, but validate:
- Build completes successfully
- All tests pass
- Image pushes to ECR
- Proper tags applied

### Deployment Testing

Dev environment deployment:
1. Push new image to ECR
2. Update ECS task definition
3. Deploy to dev environment
4. Monitor CloudWatch logs
5. Test webhook processing
6. Validate no filesystem errors
7. Check health check responses

## Rollback Strategy

If issues are discovered:

### Immediate Rollback (Emergency)

1. Revert to previous ECR image tag:
   ```bash
   aws ecs update-service \
     --cluster benchling-webhook-dev \
     --service benchling-webhook \
     --task-definition benchling-webhook:previous
   ```

2. Previous image remains in ECR
3. ECS rolls back to stable version
4. Investigate issues offline

### Dockerfile Rollback (Development)

1. Restore backup:
   ```bash
   cp docker/Dockerfile.backup-python-slim docker/Dockerfile
   ```

2. Rebuild with original Dockerfile
3. Fix issues
4. Retry implementation

## Success Criteria Summary

Phase 1 is complete when:

1. ✅ **Build Quality**:
   - Dockerfile passes hadolint
   - Image builds without errors
   - Build time < 10 minutes
   - All layers cached appropriately

2. ✅ **Runtime Quality**:
   - Container starts in < 30 seconds
   - All health endpoints respond
   - No filesystem errors in logs
   - Application processes requests

3. ✅ **Size Quality**:
   - Image size reduced by 30%+
   - No build artifacts in final image
   - Only production dependencies included

4. ✅ **Compatibility Quality**:
   - All unit tests pass
   - Integration tests pass
   - Local make targets work
   - Ready for ECS deployment

5. ✅ **Documentation Quality**:
   - Inline comments complete
   - Base image hash documented
   - README updated (if needed)
   - Metrics documented

## Timeline Estimate

| Sub-Phase | Duration | Cumulative |
| ----------- | ---------- | ------------ |
| 1.1 Research | 1 hour | 1 hour |
| 1.2 Builder | 2 hours | 3 hours |
| 1.3 Runtime | 2 hours | 5 hours |
| 1.4 Execution | 1 hour | 6 hours |
| 1.5 Read-Only | 1 hour | 7 hours |
| 1.6 Documentation | 1 hour | 8 hours |
| 1.7 Testing | 2 hours | 10 hours |
| 1.8 Integration | 1 hour | 11 hours |

**Total Estimate**: 11 hours (approximately 1.5 work days)

## Next Steps

Proceed to Phase 1 implementation:
1. Create `05-phase1-design.md` with detailed technical design
2. Create `06-phase1-episodes.md` with atomic change units
3. Create `07-phase1-checklist.md` with detailed validation tasks
4. Execute implementation with BDD approach
