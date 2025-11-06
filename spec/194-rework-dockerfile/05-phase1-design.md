# Phase 1 Design: Complete Dockerfile Rework

**Reference**: 03-specifications.md, 04-phases.md
**Phase**: 1 of 1
**Date**: 2025-11-06

## Design Overview

Implement a multi-stage Dockerfile that builds on Amazon Linux 2023, uses hash-pinned base images, separates build and runtime concerns, and executes the Flask application directly with Python (no uv wrapper).

## Technical Architecture

### Multi-Stage Build Structure

```
┌─────────────────────────────────────┐
│       BUILDER STAGE                 │
│  Amazon Linux 2023 (hashed)         │
│  ├─ Python 3.11+ runtime            │
│  ├─ System build dependencies       │
│  ├─ uv package manager              │
│  ├─ pyproject.toml + uv.lock        │
│  └─ .venv (complete with deps)      │
└─────────────────────────────────────┘
              │
              │ COPY artifacts
              ▼
┌─────────────────────────────────────┐
│       RUNTIME STAGE                 │
│  Amazon Linux 2023 (hashed)         │
│  ├─ Python 3.11+ runtime only       │
│  ├─ curl (health checks)            │
│  ├─ Non-root user (appuser)         │
│  ├─ Application source (/app/src)   │
│  ├─ .venv (copied from builder)     │
│  └─ Direct Python execution         │
└─────────────────────────────────────┘
```

## Design Decisions

### DD-1: Base Image Selection

**Decision**: Use `public.ecr.aws/amazonlinux/amazonlinux:2023` with SHA256 hash

**Rationale**:
- Official AWS-provided image
- Optimized for AWS services (ECS, Lambda)
- Long-term support (until 2028)
- Consistent with reference implementation
- Available in ECR Public Gallery

**Hash Discovery**:
```bash
# Pull latest and get digest
docker pull public.ecr.aws/amazonlinux/amazonlinux:2023
docker inspect public.ecr.aws/amazonlinux/amazonlinux:2023 | jq -r '.[0].RepoDigests[0]'
```

**Expected Format**:
```dockerfile
FROM public.ecr.aws/amazonlinux/amazonlinux:2023@sha256:abc123...
```

**Alternative Considered**: `python:3.11-slim`
**Rejected Because**: Not aligned with reference implementation, Debian-based instead of Amazon Linux

### DD-2: Python Version Selection

**Decision**: Use Python 3.11 from Amazon Linux 2023 repository

**Rationale**:
- pyproject.toml requires >= 3.11
- Amazon Linux 2023 provides Python 3.11 via dnf
- Stable and well-tested version
- All dependencies compatible with 3.11

**Installation Method**:
```dockerfile
RUN dnf install -y python3.11 python3.11-pip && \
    dnf clean all
```

**Alternative Considered**: Python 3.12 or 3.14
**Rejected Because**: May not be available in AL2023 repository, 3.11 meets all requirements

### DD-3: uv Installation Strategy

**Decision**: Install uv ONLY in builder stage via curl

**Rationale**:
- uv not needed at runtime
- Keeps runtime image minimal
- Follows reference implementation pattern
- Avoids runtime cache directory issues

**Installation Method** (in builder):
```dockerfile
# Install uv in builder stage
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    . $HOME/.cargo/env
```

**Alternative Considered**: Install via pip
**Rejected Because**: curl method is official uv installation approach

### DD-4: Virtual Environment Handling

**Decision**: Create venv in builder, copy entire .venv to runtime

**Rationale**:
- Preserves all compiled dependencies
- Avoids re-compilation in runtime stage
- Faster builds (no dependency resolution at runtime)
- Complete isolation from system Python

**Implementation**:
```dockerfile
# Builder stage
RUN uv sync --frozen --no-dev

# Runtime stage
COPY --from=builder /app/.venv /app/.venv
```

**Alternative Considered**: Use pip install in runtime
**Rejected Because**: Requires keeping package manager and build tools in runtime

### DD-5: Application Execution Method

**Decision**: Use direct Python execution with activated venv

**Rationale**:
- Eliminates uv runtime dependency
- No cache directory creation attempts
- Explicit Python path control
- Works in read-only filesystems

**Implementation**:
```dockerfile
# Activate venv by setting PATH
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app"

# Direct Python execution
CMD ["python", "-m", "src.app"]
```

**Alternative Considered**: Keep `uv run`
**Rejected Because**: Causes read-only filesystem errors in production

### DD-6: System Dependencies

**Decision**: Minimal runtime dependencies - Python 3.11, curl, glibc

**Rationale**:
- curl needed for HEALTHCHECK directive
- glibc needed for Python native extensions
- No build tools in runtime
- Minimal attack surface

**Builder Dependencies**:
```dockerfile
# Builder: Full build environment
RUN dnf install -y \
    python3.11 \
    python3.11-devel \
    python3.11-pip \
    gcc \
    make \
    && dnf clean all
```

**Runtime Dependencies**:
```dockerfile
# Runtime: Minimal environment
RUN dnf install -y \
    python3.11 \
    curl \
    && dnf clean all
```

### DD-7: User and Permissions

**Decision**: Maintain non-root user (appuser, UID 1000) with minimal permissions

**Rationale**:
- Security best practice
- ECS security compliance
- Consistent with current implementation
- Principle of least privilege

**Implementation**:
```dockerfile
# Create user
RUN groupadd -r appuser && \
    useradd -r -g appuser -u 1000 appuser

# Set ownership
RUN chown -R appuser:appuser /app

# Switch to non-root
USER appuser
```

### DD-8: Health Check Configuration

**Decision**: Keep curl-based HEALTHCHECK directive

**Rationale**:
- Works reliably
- curl available in runtime
- ECS compatible
- Existing proven approach

**Implementation**:
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1
```

**Alternative Considered**: Python-based health check script
**Rejected Because**: curl is simpler and reliable

## Implementation Strategy

### Stage 1: Builder Stage Construction

**Purpose**: Create complete build environment with all dependencies

**Key Components**:
1. Amazon Linux 2023 base with hash
2. Python 3.11 with development headers
3. Build tools (gcc, make)
4. uv package manager
5. Python virtual environment with dependencies

**Layer Optimization**:
```dockerfile
# Layer 1: Base system packages (cache-friendly)
FROM public.ecr.aws/amazonlinux/amazonlinux:2023@sha256:xxx AS builder
RUN dnf install -y python3.11 python3.11-devel python3.11-pip gcc make && \
    dnf clean all

# Layer 2: uv installation (cache-friendly)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    . $HOME/.cargo/env

# Layer 3: Dependency files (cache-friendly - changes rarely)
WORKDIR /app
COPY pyproject.toml uv.lock ./

# Layer 4: Dependencies (cache-friendly - changes rarely)
RUN . $HOME/.cargo/env && uv sync --frozen --no-dev

# Layer 5: Application code (changes frequently)
COPY src/ ./src/
```

### Stage 2: Runtime Stage Construction

**Purpose**: Create minimal runtime environment with only production needs

**Key Components**:
1. Amazon Linux 2023 base with hash (same as builder)
2. Python 3.11 runtime only
3. curl for health checks
4. Application code and venv
5. Non-root user configuration

**Layer Optimization**:
```dockerfile
# Layer 1: Base runtime (cache-friendly)
FROM public.ecr.aws/amazonlinux/amazonlinux:2023@sha256:xxx
RUN dnf install -y python3.11 curl && \
    dnf clean all

# Layer 2: User setup (cache-friendly)
RUN groupadd -r appuser && \
    useradd -r -g appuser -u 1000 appuser && \
    mkdir -p /app /home/appuser

# Layer 3: Application artifacts (changes with code)
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src
COPY --from=builder /app/pyproject.toml /app/

# Layer 4: Permissions (cache-friendly)
RUN chown -R appuser:appuser /app /home/appuser

# Layer 5: Runtime configuration
USER appuser
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app" \
    FLASK_APP="src.app"
```

## Integration Points Validation

### IP-1: ECS Fargate Compatibility

**Validation Approach**:
- Test with read-only root filesystem
- Verify no write attempts to /app or /home
- Confirm port 5000 exposed and listening
- Test health checks respond within 30s
- Verify logs go to stdout/stderr

**Test Command**:
```bash
docker run -d -p 5000:5000 --read-only \
  -e LOG_LEVEL=INFO \
  --name ecs-test \
  benchling-webhook:test

# Wait for startup
sleep 10

# Test health check
curl -f http://localhost:5000/health

# Check logs for errors
docker logs ecs-test 2>&1 | grep -i "error\|read-only"

# Cleanup
docker rm -f ecs-test
```

### IP-2: CDK Stack Compatibility

**Validation Approach**:
- Image URI format unchanged
- Port exposure unchanged
- Environment variables unchanged
- Health check configuration unchanged

**No CDK Changes Required**: Image is drop-in replacement

### IP-3: Local Development Workflow

**Validation Approach**:
- Test all make targets
- Verify build process
- Run unit tests
- Run lint checks

**Test Commands**:
```bash
cd docker
make build        # Should build successfully
make test-unit    # Should run tests in container
make lint         # Should pass linting
```

### IP-4: CI/CD Pipeline Compatibility

**Validation Approach**:
- Build in CI environment
- Run tests in CI
- Push to ECR
- Verify image tags

**Expected Behavior**: No changes to CI workflow, new Dockerfile builds successfully

## Quality Gates Implementation

### QG-1: Build Quality Gates

**Hadolint Validation**:
```bash
hadolint docker/Dockerfile
```

**Expected Result**: No warnings or errors

**Build Timing**:
```bash
time docker build -t benchling-webhook:test docker/
```

**Expected Result**: Complete in < 10 minutes

**Security Scan**:
```bash
docker scan benchling-webhook:test
# OR
trivy image benchling-webhook:test
```

**Expected Result**: No high/critical vulnerabilities

### QG-2: Runtime Quality Gates

**Startup Timing**:
```bash
docker run -d -p 5000:5000 --name timing-test benchling-webhook:test
# Monitor logs for "Running on" message
docker logs -f timing-test
```

**Expected Result**: Ready within 30 seconds

**Health Check Validation**:
```bash
curl http://localhost:5000/health
curl http://localhost:5000/health/ready
curl http://localhost:5000/health/live
```

**Expected Result**: All return 200 OK

**Log Validation**:
```bash
docker logs timing-test 2>&1 | grep -i "error\|warning\|read-only"
```

**Expected Result**: No errors, especially no filesystem errors

### QG-3: Size Quality Gates

**Size Measurement**:
```bash
# Build old Dockerfile
docker build -f docker/Dockerfile.backup-python-slim -t benchling-webhook:old docker/

# Build new Dockerfile
docker build -t benchling-webhook:new docker/

# Compare sizes
docker images | grep benchling-webhook
```

**Expected Result**: New image is 30%+ smaller

**Layer Analysis**:
```bash
# Inspect layers
docker history benchling-webhook:new

# Deep dive (optional)
dive benchling-webhook:new
```

**Expected Result**: No unnecessary files, minimal layers

### QG-4: Compatibility Quality Gates

**Test Suite**:
```bash
make -C docker test-unit
```

**Expected Result**: All tests pass

**Lint Checks**:
```bash
make -C docker lint
```

**Expected Result**: No linting errors

**Functional Test**:
```bash
# Start container
docker run -d -p 5000:5000 --read-only --name func-test benchling-webhook:new

# Test endpoints
curl -X POST http://localhost:5000/event \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'

# Cleanup
docker rm -f func-test
```

**Expected Result**: Application responds (even if rejects invalid payload)

## Risk Mitigation Implementation

### Risk 1: Python Version Incompatibility

**Mitigation**:
```bash
# Test Python version availability first
docker run public.ecr.aws/amazonlinux/amazonlinux:2023 \
  bash -c "dnf list available | grep python3"

# Test pyproject.toml compatibility
docker run public.ecr.aws/amazonlinux/amazonlinux:2023 \
  bash -c "dnf install -y python3.11 && python3.11 --version"
```

### Risk 2: Virtual Environment Copy Issues

**Mitigation**:
```bash
# Test venv portability
docker build --target builder -t test-builder docker/
docker run test-builder ls -la /app/.venv/bin/
docker run test-builder /app/.venv/bin/python --version
```

### Risk 3: Missing Runtime Dependencies

**Mitigation**:
```bash
# Test for missing shared libraries
docker run benchling-webhook:test \
  bash -c "ldd /app/.venv/bin/python"

# Test imports
docker run benchling-webhook:test \
  python -c "import flask; import boto3; import structlog"
```

## Performance Considerations

### Build Caching Strategy

**Layer Ordering** (least to most frequently changed):
1. Base OS packages
2. Python installation
3. uv installation
4. pyproject.toml + uv.lock
5. Dependencies (uv sync)
6. Application source code

**Cache Optimization**:
- Separate dependency files from source code
- Install system packages in single RUN command
- Use `--mount=type=cache` for dnf (BuildKit)

### Image Size Optimization

**Techniques Applied**:
1. Multi-stage build (remove builder artifacts)
2. Single RUN commands with cleanup
3. Remove package manager caches (`dnf clean all`)
4. Copy only necessary files
5. Exclude test files and development tools

**Expected Savings**:
- Builder stage artifacts: ~200-300 MB
- uv installation: ~50-100 MB
- Build tools (gcc, make, headers): ~150-200 MB
- Total expected reduction: 30-50%

## Documentation Strategy

### Inline Dockerfile Comments

Required comments:
```dockerfile
# Base image: Amazon Linux 2023 (hash for reproducibility)
# Hash verification: docker pull public.ecr.aws/amazonlinux/amazonlinux:2023
# Update hash: docker inspect --format='{{index .RepoDigests 0}}' <image>
FROM public.ecr.aws/amazonlinux/amazonlinux:2023@sha256:xxx AS builder

# Install Python 3.11 and build dependencies
# gcc/make: Required for compiling native Python extensions
# python3.11-devel: Headers needed for extension compilation
RUN dnf install -y ...

# Install uv package manager (builder only)
# Using official installation script
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Copy dependency files (layer cache optimization)
COPY pyproject.toml uv.lock ./

# Install Python dependencies in virtual environment
# --frozen: Use lockfile without updating
# --no-dev: Exclude development dependencies
RUN uv sync --frozen --no-dev

# Runtime stage: Minimal Python environment
FROM public.ecr.aws/amazonlinux/amazonlinux:2023@sha256:xxx

# Install runtime dependencies only
# curl: Required for Docker HEALTHCHECK
RUN dnf install -y python3.11 curl && dnf clean all

# Activate virtual environment by setting PATH
# This allows direct Python execution without uv wrapper
ENV PATH="/app/.venv/bin:$PATH"

# Direct Python execution (no uv run)
# Avoids read-only filesystem errors in production
CMD ["python", "-m", "src.app"]
```

### Supporting Documentation

**README Section** (to add):
```markdown
## Docker Image

### Build
docker build -t benchling-webhook:latest docker/

### Run Locally
docker run -p 5000:5000 benchling-webhook:latest

### Base Image
Uses Amazon Linux 2023 with SHA256 hash pinning for reproducibility.
To update base image hash:
1. Pull latest: `docker pull public.ecr.aws/amazonlinux/amazonlinux:2023`
2. Get digest: `docker inspect --format='{{index .RepoDigests 0}}' ...`
3. Update Dockerfile FROM line with new hash
```

## Success Criteria Checklist

Implementation is complete when:

- [ ] Base image uses Amazon Linux 2023 with SHA256 hash
- [ ] Multi-stage build with separate builder and runtime
- [ ] Builder stage compiles all dependencies
- [ ] Runtime stage has minimal dependencies
- [ ] Application starts with direct Python execution
- [ ] No filesystem write errors in logs
- [ ] All health checks respond correctly
- [ ] Image size reduced by 30%+
- [ ] All unit tests pass
- [ ] Linting passes (hadolint + Python linters)
- [ ] Works with read-only filesystem
- [ ] Compatible with existing ECS deployment
- [ ] Documentation complete and accurate

## Next Steps

1. Create 06-phase1-episodes.md with atomic change units
2. Create 07-phase1-checklist.md with detailed validation tasks
3. Execute implementation following BDD approach
4. Validate each episode incrementally
5. Commit and push after each successful episode
