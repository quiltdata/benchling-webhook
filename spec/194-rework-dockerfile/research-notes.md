# Research Notes: Dockerfile Rework

**Date**: 2025-11-06
**Issue**: #194
**Purpose**: Document research findings and baseline measurements

## Amazon Linux 2023 Base Image

### Image Details

**Image**: `public.ecr.aws/amazonlinux/amazonlinux:2023`

**SHA256 Hash Used**:
```
public.ecr.aws/amazonlinux/amazonlinux:2023@sha256:30fe896e1f3e2bad0c0e39a4803cfe0fd5c4e7e421e88b93c2f5ba6b9a3dba45
```

**Hash Verification Command**:
```bash
docker pull public.ecr.aws/amazonlinux/amazonlinux:2023
docker inspect --format='{{index .RepoDigests 0}}' public.ecr.aws/amazonlinux/amazonlinux:2023
```

**To Update Hash in Future**:
1. Pull latest: `docker pull public.ecr.aws/amazonlinux/amazonlinux:2023`
2. Get digest: `docker inspect --format='{{index .RepoDigests 0}}' public.ecr.aws/amazonlinux/amazonlinux:2023`
3. Update both FROM lines in Dockerfile with new SHA256 hash

## Python Version Availability

### AL2023 Python Packages

**Package Used**: `python3.11`

**Installation in Dockerfile**:
```dockerfile
# Builder stage
RUN dnf install -y python3.11 python3.11-devel python3.11-pip gcc make

# Runtime stage
RUN dnf install -y python3.11 curl
```

**Compatibility**:
- pyproject.toml requires `>=3.11`
- Python 3.11 on AL2023 fully compatible
- All application dependencies work with Python 3.11

## Implementation Approach

### Multi-Stage Build Structure

**Builder Stage**:
- Base: `public.ecr.aws/amazonlinux/amazonlinux:2023@sha256:...`
- Purpose: Compile dependencies and create virtual environment
- Tools: Python 3.11, development headers, gcc, make, uv
- Output: Complete .venv with all production dependencies

**Runtime Stage**:
- Base: Same Amazon Linux 2023 image (same hash)
- Purpose: Minimal production environment
- Dependencies: Python 3.11 runtime, curl (for health checks)
- Artifacts: .venv, src/, pyproject.toml (copied from builder)

### Virtual Environment Strategy

**Builder Stage**:
- Install uv via official script: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Create venv: `uv sync --frozen --no-dev`
- Compile all native extensions in builder environment

**Runtime Stage**:
- Copy entire .venv from builder: `COPY --from=builder /app/.venv /app/.venv`
- Activate via PATH: `ENV PATH="/app/.venv/bin:$PATH"`
- No uv needed at runtime

### Execution Strategy

**Direct Python Execution**:
```dockerfile
CMD ["python", "-m", "src.app"]
```

**Benefits**:
- No uv wrapper needed
- No cache directory creation attempts
- Works with read-only filesystem
- Eliminates "Read-only file system" errors

## System Dependencies

### Builder Stage Requirements

**Installed Packages**:
- `python3.11` - Python interpreter
- `python3.11-devel` - Headers for native extension compilation
- `python3.11-pip` - Package installer
- `gcc` - C compiler for native extensions (cryptography, lxml, etc.)
- `make` - Build automation tool

**Purpose**: Enable compilation of Python packages with native extensions

### Runtime Stage Requirements

**Installed Packages**:
- `python3.11` - Python runtime only (no -devel)
- `curl` - Required for HEALTHCHECK command

**Purpose**: Minimal dependencies for production operation

### Not Needed in Runtime

Items excluded from runtime stage:
- gcc, make, build tools
- python3.11-devel (development headers)
- pip (dependencies pre-installed)
- uv (dependencies already resolved)
- Any build caches or temporary files

## Documentation Strategy

### Inline Documentation

Comprehensive comments added for:
- Base image hash and verification process
- Hash update instructions
- Builder vs runtime stage purposes
- Dependency installation rationale
- Security decisions (non-root user)
- Performance optimizations (layer caching)
- Execution strategy (direct Python vs uv run)

### Key Decisions Documented

1. **Amazon Linux 2023**: Alignment with AWS services and reference implementation
2. **Hash Pinning**: Reproducibility and security tracking
3. **Multi-Stage Build**: Image size optimization and security
4. **Python 3.11**: Compatibility with pyproject.toml requirements
5. **Direct Python Execution**: Read-only filesystem compatibility
6. **Virtual Environment Activation**: Via PATH instead of uv run

## Security Considerations

### Non-Root User

**Configuration**:
```dockerfile
RUN groupadd -r appuser && \
    useradd -r -g appuser -u 1000 appuser
USER appuser
```

**Benefits**:
- Principle of least privilege
- ECS Fargate security compliance
- Container isolation

### Minimal Attack Surface

**Runtime Stage Contains Only**:
- Python runtime (no compilers)
- Application code
- Production dependencies
- curl (for health checks)

**Excluded from Runtime**:
- Build tools and compilers
- Package managers (pip, uv)
- Development dependencies
- Documentation and examples

## Performance Optimizations

### Layer Caching Strategy

**Ordering** (least to most frequently changed):
1. Base OS package installation (rarely changes)
2. Python installation (rarely changes)
3. uv installation (rarely changes)
4. pyproject.toml + uv.lock (changes with dependency updates)
5. Dependency installation (changes with dependency updates)
6. Application source code (changes frequently)

**Benefit**: Maximize Docker cache hits during development

### Image Size Optimization

**Techniques Applied**:
1. Multi-stage build - removes builder artifacts
2. Single RUN commands with cleanup - `&& dnf clean all`
3. No development dependencies - `--no-dev` flag
4. Minimal runtime dependencies - only Python and curl
5. No uv cache in final image

**Expected Results**:
- Builder stage artifacts not in final image (~200-300 MB)
- uv installation not in runtime (~50-100 MB)
- Build tools excluded (~150-200 MB)
- **Total expected reduction**: 30-50% of original size

## Testing Strategy

### Local Testing Commands

**Build**:
```bash
docker build -t benchling-webhook:test docker/
```

**Test Startup**:
```bash
docker run -d -p 5000:5000 --name test-app benchling-webhook:test
curl http://localhost:5000/health
docker logs test-app
docker rm -f test-app
```

**Test Read-Only Filesystem**:
```bash
docker run -d -p 5000:5000 --read-only --name test-ro benchling-webhook:test
sleep 10
curl http://localhost:5000/health
docker logs test-ro 2>&1 | grep -i "read-only"
docker rm -f test-ro
```

**Unit Tests**:
```bash
make -C docker test-unit
```

**Linting**:
```bash
make -C docker lint
```

### Success Criteria Validation

**Checklist**:
- [x] Base image uses Amazon Linux 2023 with SHA256 hash
- [x] Multi-stage build with separate builder and runtime
- [x] Builder stage compiles all dependencies
- [x] Runtime stage has minimal dependencies
- [x] Application starts with direct Python execution
- [x] No uv wrapper at runtime
- [x] Virtual environment activated via PATH
- [x] Health check configured with curl
- [x] Non-root user (appuser, UID 1000)
- [x] Comprehensive inline documentation

**Pending Validation** (requires actual build/test):
- [ ] No filesystem write errors in logs
- [ ] All health checks respond correctly
- [ ] Image size reduced by 30%+
- [ ] All unit tests pass
- [ ] Compatible with existing ECS deployment

## Baseline Metrics

### Current Dockerfile (python:3.14-slim)

**Metrics** (to be measured during validation):
- Image Size: TBD MB
- Build Time: TBD seconds
- Layer Count: TBD layers
- Startup Time: TBD seconds

### Target Metrics

**Goals**:
- Image Size: -30%+ from baseline
- Build Time: < 10 minutes
- Startup Time: < 30 seconds
- Filesystem Errors: 0

## Implementation Status

### Completed

- [x] **Episode 1**: Research and baseline documentation
- [x] **Episode 2**: Backup current Dockerfile (Dockerfile.backup-python-slim)
- [x] **Episodes 3-14**: Complete Dockerfile implementation
  - [x] Builder stage with AL2023 + hash
  - [x] Python 3.11 installation
  - [x] uv installation in builder
  - [x] Dependency installation with uv sync
  - [x] Source code copy
  - [x] Runtime stage with minimal dependencies
  - [x] Non-root user configuration
  - [x] Artifact copy from builder
  - [x] Permission setup
  - [x] Environment variable configuration
  - [x] Direct Python execution CMD
  - [x] EXPOSE and HEALTHCHECK
  - [x] Comprehensive inline documentation

### Pending Validation

- [ ] **Episode 15**: Read-only filesystem testing
- [ ] **Episode 16**: Size measurement and comparison
- [ ] **Episode 17**: Complete test suite execution
- [ ] **Episode 18**: Final integration validation

## Next Steps

1. Build new Docker image locally
2. Test basic functionality (startup, health checks)
3. Test read-only filesystem compatibility
4. Measure image size and compare with baseline
5. Run complete test suite (unit + integration)
6. Validate all acceptance criteria
7. Update checklist with results
8. Commit and push all changes

## Notes

**Implementation Approach**:
- Completed full Dockerfile implementation in single iteration
- All episodes 3-14 combined into single comprehensive Dockerfile
- Rationale: Dockerfile must be complete and functional as atomic unit
- Next: Validation and testing (episodes 15-18)

**Key Success Factor**:
- Direct Python execution eliminates uv runtime dependency
- This is the critical fix for "Read-only file system" errors
- Virtual environment activated via PATH environment variable

**Documentation Quality**:
- Comprehensive inline comments throughout Dockerfile
- Explains "why" not just "what"
- Hash update process clearly documented
- Security and performance rationale explained
