# Engineering Specifications: Dockerfile Rework

**Reference**: 01-requirements.md, 02-analysis.md
**Date**: 2025-11-06

## Desired End State

A production-ready, reproducible Docker image that:

1. Uses Amazon Linux 2023 as base with SHA256 hash pinning
2. Implements multi-stage build (builder + runtime)
3. Starts application directly with Python (no uv wrapper)
4. Operates successfully in read-only filesystem environments
5. Maintains compatibility with existing ECS/CDK deployment infrastructure
6. Reduces final image size by 30%+ compared to current implementation

## Architectural Goals

### AG-1: Reproducible Builds

**Goal**: Every build with the same Dockerfile and source produces identical images

**Success Criteria**:
- Base image specified with SHA256 hash
- Hash documented in Dockerfile comments
- Hash update process documented
- Builds are deterministic and auditable

**Constraints**:
- Must use Amazon Linux 2023
- Hash must be verifiable against official AWS ECR
- Documentation must explain hash verification

### AG-2: Optimized Image Size

**Goal**: Minimize final image size through multi-stage build

**Success Criteria**:
- Builder stage contains all build tools (uv, compilers, headers)
- Runtime stage contains only application and runtime dependencies
- No build caches or artifacts in final image
- Final image size reduced by at least 30%

**Constraints**:
- Must preserve all application functionality
- Runtime dependencies must be complete
- Health checks must continue to work

### AG-3: Production-Ready Runtime

**Goal**: Application runs reliably in read-only production environments

**Success Criteria**:
- Application starts using direct Python execution
- No filesystem writes attempted during startup
- Virtual environment properly activated at build time
- No "Read-only file system" errors in logs

**Constraints**:
- Must work with ECS Fargate read-only root filesystem
- Flask application must start within 30s
- All health check endpoints must respond

### AG-4: Reference Implementation Alignment

**Goal**: Follow patterns from quiltdata/quilt reference implementation

**Success Criteria**:
- Amazon Linux 2023 base image
- Multi-stage build structure
- Python installation patterns aligned
- Security best practices maintained

**Constraints**:
- Must maintain compatibility with benchling-webhook application
- Cannot introduce breaking changes to deployment

## Design Principles

### DP-1: Separation of Concerns

Builder stage responsibilities:
- Install system build dependencies
- Install and configure uv
- Download and compile Python dependencies
- Create complete virtual environment
- Run any build-time tasks

Runtime stage responsibilities:
- Provide minimal Python runtime environment
- Host application code
- Execute application without modifications
- Respond to health checks

### DP-2: Minimal Runtime Dependencies

Runtime stage includes ONLY:
- Amazon Linux 2023 base with Python
- Application source code
- Python virtual environment (.venv) with dependencies
- Runtime system libraries (if needed)
- Health check tool (curl or Python-based)
- Non-root user configuration

Runtime stage excludes:
- uv package manager
- Build tools (gcc, make, headers)
- Development dependencies
- uv cache directories
- Temporary build artifacts

### DP-3: Security-First Approach

Security requirements:
- Non-root user (UID 1000, appuser)
- Minimal attack surface (small runtime image)
- No unnecessary packages or tools
- Read-only filesystem compatibility
- Principle of least privilege

### DP-4: Operational Compatibility

Compatibility requirements:
- Works with existing CDK stack configuration
- Compatible with ECR image tagging scheme
- Supports existing health check infrastructure
- Maintains current logging behavior
- No changes to application code required

## Integration Points

### IP-1: ECS Fargate Service

**Interface**: Docker image via ECR
**Contract**:
- Image URI: `712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:${TAG}`
- Port 5000 exposed and listening
- Health check at /health responds within 30s
- Application logs to stdout/stderr
- Environment variables passed from ECS task definition

**Validation**:
- Image pulls successfully from ECR
- Container starts without errors
- Health checks pass consistently
- Application processes webhooks correctly

### IP-2: CDK Stack Configuration

**Interface**: lib/benchling-webhook-stack.ts
**Contract**:
- Image tag parameterized (imageTagParam)
- No changes to FargateService construct required
- CloudFormation parameters unchanged
- Stack outputs remain consistent

**Validation**:
- CDK synth succeeds without errors
- Stack deploys without modifications
- All existing outputs present
- No breaking changes to stack resources

### IP-3: Local Development

**Interface**: docker/Makefile targets
**Contract**:
- `make build` builds image successfully
- `make test-local` runs tests in container
- `make test-unit` runs Python tests
- `make lint` runs linting tools

**Validation**:
- All existing make targets work
- Tests pass with same success rate
- Local development workflow unaffected

### IP-4: CI/CD Pipeline

**Interface**: GitHub Actions workflows
**Contract**:
- Docker build succeeds in CI
- Image pushes to ECR
- Tests run successfully
- Deployment proceeds without changes

**Validation**:
- CI pipeline completes successfully
- No new failures introduced
- Build time acceptable (<10 minutes)

## Quality Gates

### QG-1: Build Quality

**Criteria**:
- ✓ Dockerfile passes hadolint linting
- ✓ Image builds without errors or warnings
- ✓ Build completes in <10 minutes
- ✓ Layer caching works effectively
- ✓ No security vulnerabilities in base image (high/critical)

**Validation Method**:
- Run hadolint on Dockerfile
- Time docker build process
- Scan image with trivy or equivalent
- Verify layer cache hit rate

### QG-2: Runtime Quality

**Criteria**:
- ✓ Container starts in <30 seconds
- ✓ /health endpoint responds with 200 OK
- ✓ /health/ready endpoint responds with 200 OK
- ✓ Application logs show no errors
- ✓ No filesystem write errors in logs

**Validation Method**:
- Start container and measure startup time
- curl health endpoints
- Inspect logs for errors
- Test with read-only root filesystem

### QG-3: Size Quality

**Criteria**:
- ✓ Final image size reduced by 30%+ vs current
- ✓ No unnecessary files in final image
- ✓ Virtual environment contains only prod dependencies
- ✓ No build tools or uv cache in final image

**Validation Method**:
- Compare docker images ls sizes
- Inspect image layers with dive tool
- List files in final image
- Verify .venv contents

### QG-4: Compatibility Quality

**Criteria**:
- ✓ All existing tests pass
- ✓ Application behavior unchanged
- ✓ Health checks maintain same response format
- ✓ ECS deployment succeeds
- ✓ Webhook processing works correctly

**Validation Method**:
- Run full test suite (unit + integration)
- Deploy to dev environment
- Process test webhooks
- Verify CloudWatch logs

## Success Metrics

### Build Metrics

| Metric | Current Baseline | Target | Measurement |
|--------|-----------------|---------|-------------|
| Image size | TBD (measure current) | -30% | docker images ls |
| Build time | TBD (measure current) | No regression | time docker build |
| Layer count | TBD | Minimize | docker history |
| Build cache efficiency | TBD | >50% cache hits | docker build output |

### Runtime Metrics

| Metric | Current Baseline | Target | Measurement |
|--------|-----------------|---------|-------------|
| Startup time | <30s | <30s (maintain) | Container logs |
| Health check response | <10s | <10s (maintain) | curl timing |
| Memory usage | TBD | No regression | ECS metrics |
| Filesystem errors | >0 (current issue) | 0 | CloudWatch logs |

### Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test coverage | 85%+ | pytest --cov |
| Linting errors | 0 | flake8, black --check |
| Security vulnerabilities | 0 high/critical | trivy scan |
| Deployment success rate | 100% | ECS deployment status |

## Technical Uncertainties

### TU-1: Python Version on Amazon Linux 2023

**Question**: What is the latest Python version available on Amazon Linux 2023?

**Impact**: May need to downgrade from Python 3.14 to 3.11 or 3.12

**Resolution Strategy**:
- Check Amazon Linux 2023 package repository
- Verify pyproject.toml compatibility
- Test application with available Python version
- Update pyproject.toml if needed

### TU-2: System Dependencies

**Question**: What system libraries are needed at runtime?

**Impact**: Runtime stage must include all necessary shared libraries

**Resolution Strategy**:
- Run ldd on Python executable and key .so files
- Test minimal runtime environment
- Add missing system packages incrementally
- Document required packages

### TU-3: Virtual Environment Portability

**Question**: Can .venv be copied between stages with different base images?

**Impact**: May need to rebuild dependencies in runtime stage

**Resolution Strategy**:
- Test copying .venv from builder to runtime
- If fails, use pip install from builder artifacts
- Verify all native extensions work
- Document approach chosen

### TU-4: Health Check Tool

**Question**: Is curl available in Amazon Linux 2023 minimal base?

**Impact**: May need to install curl or use Python-based health check

**Resolution Strategy**:
- Check if curl is in minimal base
- If not, install curl package
- Alternative: Create Python health check script
- Test health check reliability

## Risk Assessment

### Risk 1: Base Image Incompatibility

**Probability**: Medium
**Impact**: High
**Mitigation**:
- Test with Amazon Linux 2023 early
- Identify missing dependencies before full migration
- Have rollback plan (keep current Dockerfile as Dockerfile.old)
- Validate in dev environment before prod

### Risk 2: Performance Degradation

**Probability**: Low
**Impact**: Medium
**Mitigation**:
- Benchmark before and after
- Monitor ECS metrics during deployment
- Run load tests in dev environment
- Keep performance requirements in quality gates

### Risk 3: Deployment Compatibility Issues

**Probability**: Low
**Impact**: High
**Mitigation**:
- No changes to exposed interfaces
- Test CDK deployment in dev first
- Validate with existing CDK stack version
- Document any new requirements

### Risk 4: Increased Build Time

**Probability**: Medium
**Impact**: Low
**Mitigation**:
- Optimize layer caching
- Use BuildKit features
- Parallelize where possible
- Monitor CI build times

## Documentation Requirements

### Dockerfile Documentation

Required inline comments:
- Base image hash and verification method
- Stage purposes (builder vs runtime)
- Non-obvious dependency choices
- Security decisions
- Performance optimizations

### Supporting Documentation

Required updates:
- README if build process changes
- CI/CD documentation if workflows change
- Deployment guide if new requirements
- Troubleshooting guide for common issues

## Non-Goals

This specification explicitly does NOT include:

- Changes to application code
- Changes to CDK infrastructure beyond necessary updates
- Migration to different package manager (staying with uv)
- Changes to deployment region or ECR configuration
- Updates to Python dependencies (unless required for compatibility)
- Changes to application architecture or behavior
- Performance optimizations beyond image size

## Approval Criteria

This specification is ready for implementation when:

1. ✓ All open questions in requirements (01-requirements.md) are resolved
2. ✓ All technical uncertainties (TU-1 through TU-4) have resolution strategies
3. ✓ Success metrics have baseline measurements
4. ✓ Risk mitigation strategies are in place
5. ✓ Integration points are validated against current codebase
6. ✓ Quality gates are agreed upon and measurable

## Next Steps

After approval, proceed to:
1. 04-phases.md - Break implementation into incremental phases
2. Define specific tasks and sequencing for each phase
3. Create detailed episode breakdowns for atomic changes
4. Execute implementation with BDD approach
