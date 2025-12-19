# Phase 1 Checklist: Dockerfile Rework Implementation

**Reference**: 05-phase1-design.md, 06-phase1-episodes.md
**Phase**: 1 of 1
**Date**: 2025-11-06
**GitHub Issue**: #194

## Checklist Instructions

- Use `[x]` to mark completed tasks
- Use `[ ]` for pending tasks
- Update after each episode completion
- Commit checklist updates with episode commits
- All tasks must be completed before PR review

## Pre-Implementation Setup

### Environment Preparation

- [ ] Verify Docker installed and working
- [ ] Verify docker build permissions
- [ ] Verify access to Amazon Linux 2023 base image
- [ ] Verify make command available
- [ ] Create spec directory structure

### Repository State

- [ ] On branch: 194-rework-dockerfile
- [ ] Git status clean
- [ ] All existing tests passing on current code
- [ ] Current Dockerfile builds successfully

## Episode 1: Research and Baseline Measurement

### Research Tasks

- [ ] Pull Amazon Linux 2023 base image
- [ ] Identify exact SHA256 hash for base image
- [ ] Verify Python 3.11 available on AL2023
- [ ] Check Python version: `docker run public.ecr.aws/amazonlinux/amazonlinux:2023 bash -c "dnf list available | grep python3"`
- [ ] Document base image hash in research notes

### Baseline Measurements

- [ ] Build current Dockerfile: `docker build -t benchling-webhook:baseline docker/`
- [ ] Measure current image size: `docker images benchling-webhook:baseline`
- [ ] Record size in MB: __________ MB
- [ ] Measure build time: `time docker build -t benchling-webhook:baseline docker/`
- [ ] Record build time: __________ seconds
- [ ] Count layers: `docker history benchling-webhook:baseline | wc -l`
- [ ] Record layer count: __________ layers

### Documentation

- [ ] Create research notes file: `spec/194-rework-dockerfile/research-notes.md`
- [ ] Document base image hash with verification command
- [ ] Document Python version findings
- [ ] Document baseline metrics
- [ ] Document system dependency requirements

### Validation

- [ ] Research notes complete
- [ ] All baseline metrics recorded
- [ ] Base image hash identified and verified
- [ ] Python 3.11 availability confirmed

### Commit

- [ ] Stage research notes file
- [ ] Commit with message from Episode 1
- [ ] Push to remote

## Episode 2: Backup Current Dockerfile

### Backup Creation

- [ ] Copy Dockerfile: `cp docker/Dockerfile docker/Dockerfile.backup-python-slim`
- [ ] Verify backup identical to original: `diff docker/Dockerfile docker/Dockerfile.backup-python-slim`
- [ ] Test backup builds: `docker build -f docker/Dockerfile.backup-python-slim -t benchling-webhook:backup docker/`

### Documentation

- [ ] Add comment to backup file explaining purpose
- [ ] Note backup location in commit message

### Validation

- [ ] Backup file exists at `docker/Dockerfile.backup-python-slim`
- [ ] Backup file builds successfully
- [ ] Backup file identical to original

### Commit

- [ ] Stage backup file
- [ ] Commit with message from Episode 2
- [ ] Push to remote

## Episode 3: Create Builder Stage with Amazon Linux 2023

### Base Image Configuration

- [ ] Replace FROM line with: `FROM public.ecr.aws/amazonlinux/amazonlinux:2023@sha256:${HASH} AS builder`
- [ ] Insert actual SHA256 hash from research
- [ ] Add comment above FROM explaining hash and verification
- [ ] Add comment explaining builder stage purpose

### System Dependencies

- [ ] Add RUN command to install Python 3.11
- [ ] Add RUN command to install python3.11-devel
- [ ] Add RUN command to install python3.11-pip
- [ ] Add RUN command to install gcc
- [ ] Add RUN command to install make
- [ ] Combine into single RUN command with && and line continuations
- [ ] Add `dnf clean all` to minimize layer size
- [ ] Add comments explaining dependency purposes

### Build Testing

- [ ] Build builder stage only: `docker build --target builder -t benchling-builder docker/`
- [ ] Verify Python version: `docker run benchling-builder python3.11 --version`
- [ ] Expected output: Python 3.11.x
- [ ] Verify gcc available: `docker run benchling-builder gcc --version`
- [ ] Verify make available: `docker run benchling-builder make --version`
- [ ] Verify no errors in build output

### Validation

- [ ] Builder stage builds without errors
- [ ] Python 3.11 installed and accessible
- [ ] Build tools (gcc, make) available
- [ ] Base image uses Amazon Linux 2023
- [ ] Base image hash documented in comments

### Commit

- [ ] Stage Dockerfile changes
- [ ] Run `make -C docker lint` (if available)
- [ ] Commit with message from Episode 3
- [ ] Push to remote

## Episode 4: Install uv in Builder Stage

### uv Installation

- [ ] Add RUN command to download uv install script
- [ ] Use: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- [ ] Add command to source cargo env: `. $HOME/.cargo/env`
- [ ] Add comment explaining uv installation method
- [ ] Add comment noting uv is builder-only

### Build Testing

- [ ] Build builder stage: `docker build --target builder -t benchling-builder docker/`
- [ ] Verify uv installed: `docker run benchling-builder bash -c ". ~/.cargo/env && uv --version"`
- [ ] Expected output: uv version number
- [ ] Verify no errors in build output

### Validation

- [ ] uv installs successfully
- [ ] uv command accessible with cargo env
- [ ] uv version displays correctly
- [ ] Builder stage builds without errors

### Commit

- [ ] Stage Dockerfile changes
- [ ] Commit with message from Episode 4
- [ ] Push to remote

## Episode 5: Install Dependencies in Builder Stage

### Dependency File Setup

- [ ] Add WORKDIR /app before COPY commands
- [ ] Add COPY command for pyproject.toml
- [ ] Add COPY command for uv.lock
- [ ] Add comment about layer caching strategy

### Dependency Installation

- [ ] Add RUN command: `. $HOME/.cargo/env && uv sync --frozen --no-dev`
- [ ] Add comment explaining --frozen flag (lockfile compliance)
- [ ] Add comment explaining --no-dev flag (production only)
- [ ] Verify command creates .venv directory

### Build Testing

- [ ] Build builder stage: `docker build --target builder -t benchling-builder docker/`
- [ ] Verify .venv exists: `docker run benchling-builder ls -la /app/.venv`
- [ ] Verify .venv/bin exists: `docker run benchling-builder ls /app/.venv/bin/ | grep python`
- [ ] Verify site-packages exists: `docker run benchling-builder ls /app/.venv/lib/python3.11/site-packages/`
- [ ] Test key import (flask): `docker run benchling-builder bash -c ". /app/.venv/bin/activate && python -c 'import flask; print(\"Flask OK\")'"`
- [ ] Test key import (boto3): `docker run benchling-builder bash -c ". /app/.venv/bin/activate && python -c 'import boto3; print(\"Boto3 OK\")'"`
- [ ] Test key import (structlog): `docker run benchling-builder bash -c ". /app/.venv/bin/activate && python -c 'import structlog; print(\"Structlog OK\")'"`

### Validation

- [ ] Dependencies install without errors
- [ ] .venv directory created with correct structure
- [ ] Key dependencies importable
- [ ] No development dependencies included
- [ ] Lockfile used without modification (--frozen)

### Commit

- [ ] Stage Dockerfile changes
- [ ] Commit with message from Episode 5
- [ ] Push to remote

## Episode 6: Copy Application Source in Builder Stage

### Source Code Copy

- [ ] Add COPY command for src/ directory
- [ ] Use: `COPY src/ ./src/`
- [ ] Add comment about layer caching (source changes frequently)
- [ ] Place COPY after dependency installation for optimal caching

### Build Testing

- [ ] Build builder stage: `docker build --target builder -t benchling-builder docker/`
- [ ] Verify src directory exists: `docker run benchling-builder ls -la /app/src/`
- [ ] Verify key files present: `docker run benchling-builder ls /app/src/ | grep app.py`
- [ ] Verify app.py readable: `docker run benchling-builder head -1 /app/src/app.py`

### Validation

- [ ] src/ directory copied successfully
- [ ] All application files present
- [ ] Files readable in container
- [ ] Builder stage complete

### Commit

- [ ] Stage Dockerfile changes
- [ ] Commit with message from Episode 6
- [ ] Push to remote

## Episode 7: Create Runtime Stage Base

### Runtime Stage Definition

- [ ] Add new FROM line with same AL2023 base and hash (no AS label)
- [ ] Use exact same base image as builder
- [ ] Add comment explaining runtime stage purpose
- [ ] Add comment noting minimal dependencies

### Runtime Dependencies

- [ ] Add RUN command to install python3.11 (runtime only, no -devel)
- [ ] Add RUN command to install curl (for health checks)
- [ ] Combine into single RUN command
- [ ] Add `dnf clean all` to minimize size
- [ ] Add comment explaining curl is for HEALTHCHECK
- [ ] Verify no build tools installed

### Build Testing

- [ ] Build full image (both stages): `docker build -t benchling-webhook:test docker/`
- [ ] Verify Python in runtime: `docker run benchling-webhook:test python3.11 --version`
- [ ] Verify curl in runtime: `docker run benchling-webhook:test curl --version`
- [ ] Verify no gcc in runtime: `docker run benchling-webhook:test gcc --version 2>&1 | grep "command not found"`
- [ ] Verify no make in runtime: `docker run benchling-webhook:test make --version 2>&1 | grep "command not found"`

### Validation

- [ ] Runtime stage defined correctly
- [ ] Python 3.11 runtime installed
- [ ] curl installed for health checks
- [ ] No build tools in runtime stage
- [ ] Package cache cleaned

### Commit

- [ ] Stage Dockerfile changes
- [ ] Commit with message from Episode 7
- [ ] Push to remote

## Episode 8: Create Non-Root User in Runtime

### User Configuration

- [ ] Add RUN command: `groupadd -r appuser`
- [ ] Add RUN command: `useradd -r -g appuser -u 1000 appuser`
- [ ] Combine into single RUN command with &&
- [ ] Add comment explaining security requirement
- [ ] Add comment noting UID 1000 for compatibility

### Directory Creation

- [ ] Create /app directory: `mkdir -p /app`
- [ ] Create /home/appuser directory: `mkdir -p /home/appuser`
- [ ] Combine with user creation command

### Build Testing

- [ ] Build image: `docker build -t benchling-webhook:test docker/`
- [ ] Verify user exists: `docker run benchling-webhook:test id appuser`
- [ ] Verify UID is 1000: `docker run benchling-webhook:test id -u appuser`
- [ ] Expected output: 1000
- [ ] Verify directories exist: `docker run benchling-webhook:test ls -ld /app /home/appuser`

### Validation

- [ ] appuser group created
- [ ] appuser user created with UID 1000
- [ ] /app directory exists
- [ ] /home/appuser directory exists
- [ ] No errors during build

### Commit

- [ ] Stage Dockerfile changes
- [ ] Commit with message from Episode 8
- [ ] Push to remote

## Episode 9: Copy Application Artifacts to Runtime

### Artifact Copy Setup

- [ ] Add WORKDIR /app directive
- [ ] Add COPY --from=builder for .venv: `COPY --from=builder /app/.venv /app/.venv`
- [ ] Add COPY --from=builder for src/: `COPY --from=builder /app/src /app/src`
- [ ] Add COPY --from=builder for pyproject.toml: `COPY --from=builder /app/pyproject.toml /app/`
- [ ] Add comments explaining artifact selection
- [ ] Add comment noting no build artifacts copied

### Build Testing

- [ ] Build image: `docker build -t benchling-webhook:test docker/`
- [ ] Verify .venv copied: `docker run benchling-webhook:test ls -la /app/.venv`
- [ ] Verify .venv/bin has python: `docker run benchling-webhook:test ls /app/.venv/bin/ | grep python`
- [ ] Verify src/ copied: `docker run benchling-webhook:test ls -la /app/src/`
- [ ] Verify pyproject.toml copied: `docker run benchling-webhook:test ls /app/ | grep pyproject.toml`

### Validation

- [ ] .venv copied from builder successfully
- [ ] src/ directory copied completely
- [ ] pyproject.toml copied
- [ ] All files accessible
- [ ] No unnecessary files copied

### Commit

- [ ] Stage Dockerfile changes
- [ ] Commit with message from Episode 9
- [ ] Push to remote

## Episode 10: Configure Permissions in Runtime

### Permission Setup

- [ ] Add RUN command: `chown -R appuser:appuser /app`
- [ ] Add RUN command: `chown -R appuser:appuser /home/appuser`
- [ ] Combine into single RUN command with &&
- [ ] Add USER appuser directive after permission setup
- [ ] Add comment explaining least privilege principle

### Build Testing

- [ ] Build image: `docker build -t benchling-webhook:test docker/`
- [ ] Verify /app ownership: `docker run benchling-webhook:test ls -la /app`
- [ ] Check owner is appuser: `docker run benchling-webhook:test stat -c '%U' /app`
- [ ] Expected output: appuser
- [ ] Verify running user: `docker run benchling-webhook:test whoami`
- [ ] Expected output: appuser
- [ ] Verify can read files: `docker run benchling-webhook:test head -1 /app/src/app.py`

### Validation

- [ ] /app owned by appuser:appuser
- [ ] /home/appuser owned by appuser:appuser
- [ ] Container runs as appuser (non-root)
- [ ] appuser can read application files
- [ ] Proper permissions enforced

### Commit

- [ ] Stage Dockerfile changes
- [ ] Commit with message from Episode 10
- [ ] Push to remote

## Episode 11: Configure Environment Variables

### Environment Configuration

- [ ] Add ENV directive for PATH: `ENV PATH="/app/.venv/bin:$PATH"`
- [ ] Add ENV directive for PYTHONPATH: `ENV PYTHONPATH="/app"`
- [ ] Add ENV directive for FLASK_APP: `ENV FLASK_APP="src.app"`
- [ ] Combine into single ENV command or separate for clarity
- [ ] Add comment explaining virtual environment activation
- [ ] Add comment noting no uv wrapper needed

### Build Testing

- [ ] Build image: `docker build -t benchling-webhook:test docker/`
- [ ] Verify PATH: `docker run benchling-webhook:test bash -c 'echo $PATH'`
- [ ] Verify contains /app/.venv/bin first
- [ ] Verify PYTHONPATH: `docker run benchling-webhook:test bash -c 'echo $PYTHONPATH'`
- [ ] Expected output includes /app
- [ ] Verify which python: `docker run benchling-webhook:test which python`
- [ ] Expected output: /app/.venv/bin/python
- [ ] Test import: `docker run benchling-webhook:test python -c "import src.app; print('Import OK')"`

### Validation

- [ ] PATH includes /app/.venv/bin as first entry
- [ ] PYTHONPATH set to /app
- [ ] FLASK_APP set to src.app
- [ ] Python uses venv python
- [ ] Application imports work

### Commit

- [ ] Stage Dockerfile changes
- [ ] Commit with message from Episode 11
- [ ] Push to remote

## Episode 12: Update CMD to Direct Python Execution

### CMD Configuration

- [ ] Replace CMD with: `CMD ["python", "-m", "src.app"]`
- [ ] Remove any previous `uv run` command
- [ ] Add comment explaining direct execution
- [ ] Add comment noting read-only filesystem compatibility

### Build Testing

- [ ] Build image: `docker build -t benchling-webhook:test docker/`
- [ ] Start container: `docker run -d -p 5000:5000 --name test-cmd benchling-webhook:test`
- [ ] Wait for startup: `sleep 15`
- [ ] Check if running: `docker ps | grep test-cmd`
- [ ] Test health endpoint: `curl http://localhost:5000/health`
- [ ] Expected: 200 OK with JSON response
- [ ] Check logs: `docker logs test-cmd`
- [ ] Verify "Running on" message present
- [ ] Verify no "Read-only file system" errors
- [ ] Cleanup: `docker rm -f test-cmd`

### Validation

- [ ] CMD uses direct Python execution
- [ ] Application starts successfully
- [ ] No uv-related errors in logs
- [ ] No filesystem write errors
- [ ] Health endpoint responds
- [ ] Application ready to serve

### Commit

- [ ] Stage Dockerfile changes
- [ ] Commit with message from Episode 12
- [ ] Push to remote

## Episode 13: Add EXPOSE and HEALTHCHECK

### Port Configuration

- [ ] Add EXPOSE 5000 directive
- [ ] Add comment explaining Flask default port

### Health Check Configuration

- [ ] Add HEALTHCHECK directive
- [ ] Set --interval=30s
- [ ] Set --timeout=10s
- [ ] Set --start-period=5s
- [ ] Set --retries=3
- [ ] Set CMD: `curl -f http://localhost:5000/health || exit 1`
- [ ] Add comment explaining ECS health check compatibility
- [ ] Add comment noting curl requirement

### Build Testing

- [ ] Build image: `docker build -t benchling-webhook:test docker/`
- [ ] Start container: `docker run -d -p 5000:5000 --name test-health benchling-webhook:test`
- [ ] Wait for health check: `sleep 40`
- [ ] Check health status: `docker inspect test-health --format='{{.State.Health.Status}}'`
- [ ] Expected: healthy
- [ ] Verify health check command: `docker exec test-health curl -f http://localhost:5000/health`
- [ ] Expected: 200 OK
- [ ] Cleanup: `docker rm -f test-health`

### Validation

- [ ] Port 5000 exposed
- [ ] HEALTHCHECK configured correctly
- [ ] Health check timing appropriate for ECS
- [ ] Health check passes after start period
- [ ] curl command works in container

### Commit

- [ ] Stage Dockerfile changes
- [ ] Commit with message from Episode 13
- [ ] Push to remote

## Episode 14: Add Inline Documentation

### Documentation Requirements

- [ ] Add header comment block explaining Dockerfile purpose
- [ ] Document multi-stage build strategy
- [ ] Document base image hash with verification command
- [ ] Add update instructions for base image hash
- [ ] Document builder stage purpose and contents
- [ ] Document runtime stage purpose and contents
- [ ] Explain all non-obvious dependency choices
- [ ] Document security decisions (non-root user)
- [ ] Document performance optimizations (layer caching)
- [ ] Add comments for each major section

### Specific Comments Required

- [ ] Comment explaining why Amazon Linux 2023
- [ ] Comment explaining hash pinning for reproducibility
- [ ] Comment explaining gcc/make needed for native extensions
- [ ] Comment explaining uv builder-only installation
- [ ] Comment explaining --frozen and --no-dev flags
- [ ] Comment explaining layer caching strategy for COPY commands
- [ ] Comment explaining minimal runtime dependencies
- [ ] Comment explaining virtual environment activation via PATH
- [ ] Comment explaining direct Python execution (no uv run)
- [ ] Comment explaining read-only filesystem compatibility

### Documentation Review

- [ ] Read through entire Dockerfile
- [ ] Verify all comments accurate
- [ ] Verify comments explain "why" not just "what"
- [ ] Verify hash update process clearly documented
- [ ] Verify security rationale explained

### Validation

- [ ] All stages documented
- [ ] Base image hash documented with verification
- [ ] All major decisions explained
- [ ] Security choices documented
- [ ] Performance optimizations noted
- [ ] Comments clear and helpful

### Commit

- [ ] Stage Dockerfile changes
- [ ] Commit with message from Episode 14
- [ ] Push to remote

## Episode 15: Test Read-Only Filesystem Compatibility

### Read-Only Test Setup

- [ ] Build image: `docker build -t benchling-webhook:test docker/`
- [ ] Prepare test command with --read-only flag

### Read-Only Testing

- [ ] Start container: `docker run -d -p 5000:5000 --read-only --name test-ro benchling-webhook:test`
- [ ] Wait for startup: `sleep 15`
- [ ] Verify container running: `docker ps | grep test-ro`
- [ ] Test /health endpoint: `curl http://localhost:5000/health`
- [ ] Expected: 200 OK
- [ ] Test /health/ready endpoint: `curl http://localhost:5000/health/ready`
- [ ] Expected: 200 OK
- [ ] Test /health/live endpoint: `curl http://localhost:5000/health/live`
- [ ] Expected: 200 OK

### Log Analysis

- [ ] Get full logs: `docker logs test-ro > /tmp/ro-test-logs.txt`
- [ ] Check for "Read-only file system" errors: `docker logs test-ro 2>&1 | grep -i "read-only"`
- [ ] Expected: No matches
- [ ] Check for "error" messages: `docker logs test-ro 2>&1 | grep -i "error"`
- [ ] Verify no filesystem-related errors
- [ ] Check for "warning" messages: `docker logs test-ro 2>&1 | grep -i "warning"`
- [ ] Verify no cache directory warnings

### Extended Testing

- [ ] Keep container running for 2 minutes
- [ ] Test health endpoints multiple times
- [ ] Verify consistent responses
- [ ] Verify no errors accumulate
- [ ] Cleanup: `docker rm -f test-ro`

### Documentation

- [ ] Document test results in research notes
- [ ] Note any issues found and resolved
- [ ] Confirm read-only filesystem compatibility

### Validation

- [ ] Container starts with --read-only flag
- [ ] No filesystem write errors in logs
- [ ] All health endpoints respond correctly
- [ ] Application runs stably in read-only mode
- [ ] No uv cache creation attempts

### Commit

- [ ] Stage any documentation changes
- [ ] Commit with message from Episode 15
- [ ] Push to remote

## Episode 16: Measure and Document Image Size Reduction

### Size Comparison Setup

- [ ] Build old image: `docker build -f docker/Dockerfile.backup-python-slim -t benchling-webhook:old docker/`
- [ ] Build new image: `docker build -t benchling-webhook:new docker/`
- [ ] Ensure both builds complete successfully

### Size Measurements

- [ ] List images: `docker images | grep benchling-webhook`
- [ ] Record old image size: __________ MB
- [ ] Record new image size: __________ MB
- [ ] Calculate reduction: __________ MB (__________ %)
- [ ] Verify reduction meets 30%+ target

### Layer Analysis

- [ ] Old image layers: `docker history benchling-webhook:old | wc -l`
- [ ] Record old layer count: __________
- [ ] New image layers: `docker history benchling-webhook:new | wc -l`
- [ ] Record new layer count: __________
- [ ] Compare layer counts

### Detailed Analysis

- [ ] Run docker history on old image: `docker history benchling-webhook:old`
- [ ] Run docker history on new image: `docker history benchling-webhook:new`
- [ ] Identify largest layers in each
- [ ] Document size differences

### Optional Deep Dive

- [ ] If dive tool available: `dive benchling-webhook:new`
- [ ] Inspect for unnecessary files
- [ ] Verify no build artifacts in final image
- [ ] Verify only production dependencies

### Documentation

- [ ] Update research notes with measurements
- [ ] Document size reduction percentage
- [ ] Document layer count improvements
- [ ] Note any optimization opportunities found

### Validation

- [ ] New image at least 30% smaller
- [ ] Size measurements documented
- [ ] Layer analysis complete
- [ ] Meets success criteria from specifications

### Commit

- [ ] Stage documentation changes
- [ ] Commit with message from Episode 16
- [ ] Push to remote

## Episode 17: Run Complete Test Suite

### Test Environment Setup

- [ ] Navigate to docker directory: `cd docker`
- [ ] Ensure latest image built: `make build`
- [ ] Verify build completes: Build succeeded

### Unit Tests

- [ ] Run unit tests: `make test-unit`
- [ ] Verify all tests pass
- [ ] Record test count: __________ tests passed
- [ ] Record any failures: __________
- [ ] If failures, debug and fix

### Linting

- [ ] Run Python linting: `make lint`
- [ ] Verify no linting errors
- [ ] Check flake8 output
- [ ] Check black output
- [ ] Check isort output
- [ ] Fix any linting issues

### Dockerfile Linting

- [ ] Run hadolint: `hadolint docker/Dockerfile`
- [ ] Verify no errors or warnings
- [ ] Fix any issues found
- [ ] Re-run until clean

### Coverage Check

- [ ] If coverage available: `make test-unit` with coverage
- [ ] Check coverage percentage
- [ ] Expected: >= 85%
- [ ] Record coverage: ___________%

### Integration Tests

- [ ] If integration tests exist: `make test-integration`
- [ ] Verify all pass
- [ ] Record results

### Make Target Validation

- [ ] Test make build: `make build` ✓
- [ ] Test make test-unit: `make test-unit` ✓
- [ ] Test make lint: `make lint` ✓
- [ ] Test make test-local: `make test-local` (if available)
- [ ] Verify all targets work with new Dockerfile

### Documentation

- [ ] Document test results
- [ ] Note any test updates made
- [ ] Record coverage metrics
- [ ] Confirm no regressions

### Validation

- [ ] All unit tests pass
- [ ] Linting passes (Python + Dockerfile)
- [ ] Test coverage >= 85%
- [ ] No regressions introduced
- [ ] All make targets functional

### Commit

- [ ] Stage any test fixes or updates
- [ ] Commit with message from Episode 17
- [ ] Push to remote

## Episode 18: Final Integration Validation

### Production Image Build

- [ ] Build with production tag: `docker build -t 712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:test docker/`
- [ ] Verify build succeeds
- [ ] Record final image size: __________ MB

### Production-Like Testing

- [ ] Start container with production config:
```bash
docker run -d -p 5000:5000 \
  --read-only \
  -e LOG_LEVEL=INFO \
  -e FLASK_ENV=production \
  --name prod-final \
  712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:test
```
- [ ] Container starts successfully

### Startup Timing

- [ ] Monitor logs: `docker logs -f prod-final`
- [ ] Record time to "Running on" message: __________ seconds
- [ ] Verify < 30 seconds (requirement)
- [ ] Note actual startup time in documentation

### Health Check Validation

- [ ] Test /health: `curl http://localhost:5000/health`
- [ ] Verify 200 OK and JSON response
- [ ] Verify response includes "status": "healthy"
- [ ] Test /health/ready: `curl http://localhost:5000/health/ready`
- [ ] Verify 200 OK
- [ ] Test /health/live: `curl http://localhost:5000/health/live`
- [ ] Verify 200 OK
- [ ] Test /health/secrets: `curl http://localhost:5000/health/secrets`
- [ ] Verify appropriate response

### Logging Validation

- [ ] Get full logs: `docker logs prod-final`
- [ ] Verify JSON format in production mode
- [ ] Verify no error messages
- [ ] Verify no filesystem errors
- [ ] Verify proper log levels
- [ ] Verify CloudWatch-compatible output

### Extended Stability Test

- [ ] Leave container running for 5 minutes
- [ ] Test health endpoints every minute
- [ ] Verify consistent responses
- [ ] Monitor logs for issues
- [ ] Check resource usage (memory, CPU) if tools available

### Final Cleanup

- [ ] Stop container: `docker rm -f prod-final`
- [ ] Clean up test images: `docker image prune -f`

### Acceptance Criteria Validation

- [ ] **US-1**: Base image is Amazon Linux 2023 with SHA256 hash ✓
- [ ] **US-2**: Multi-stage build with no build artifacts in final image ✓
- [ ] **US-2**: Image size reduced by 30%+ ✓
- [ ] **US-3**: Application starts without uv wrapper ✓
- [ ] **US-3**: No "Read-only file system" errors ✓
- [ ] **US-3**: Works with read-only filesystem ✓
- [ ] **US-4**: Follows patterns from reference implementation ✓
- [ ] **US-4**: Security patterns maintained (non-root user) ✓
- [ ] **US-4**: Health checks work correctly ✓

### Success Criteria Validation

- [ ] Reproducibility: Base image hash pinned and documented ✓
- [ ] Size Optimization: Image size reduced by 30%+ ✓
- [ ] Runtime Stability: No filesystem errors ✓
- [ ] Build Success: Image builds successfully ✓
- [ ] Deployment Success: Ready for ECS deployment ✓
- [ ] Test Coverage: All tests pass with >= 85% coverage ✓
- [ ] Documentation: Dockerfile fully documented ✓

### Final Documentation

- [ ] Update research notes with final results
- [ ] Document all metrics achieved
- [ ] Note any issues encountered and resolved
- [ ] Confirm all acceptance criteria met

### Validation

- [ ] Production image builds successfully
- [ ] Startup time < 30 seconds
- [ ] All health checks pass
- [ ] Logging works correctly
- [ ] All acceptance criteria met
- [ ] Ready for ECR push and deployment

### Commit

- [ ] Stage final documentation updates
- [ ] Stage checklist with all items completed
- [ ] Commit with message from Episode 18
- [ ] Push to remote

## Post-Implementation Review

### Quality Gates Summary

#### Build Quality

- [ ] Dockerfile passes hadolint ✓
- [ ] Image builds without errors ✓
- [ ] Build time < 10 minutes ✓
- [ ] Layer caching effective ✓
- [ ] No high/critical vulnerabilities ✓

#### Runtime Quality

- [ ] Container starts < 30 seconds ✓
- [ ] All health endpoints respond ✓
- [ ] No filesystem errors ✓
- [ ] Application processes requests ✓
- [ ] Works with read-only filesystem ✓

#### Size Quality

- [ ] Image size reduced by 30%+ ✓
- [ ] No build artifacts in final image ✓
- [ ] Only production dependencies ✓
- [ ] Layer optimization effective ✓

#### Compatibility Quality

- [ ] All unit tests pass ✓
- [ ] Integration tests pass ✓
- [ ] Local make targets work ✓
- [ ] Ready for ECS deployment ✓
- [ ] No breaking changes ✓

### Final Metrics

| Metric | Baseline | Final | Change |
| -------- | ---------- | ------- | -------- |
| Image Size | _____ MB | _____ MB | _____ % |
| Build Time | _____ sec | _____ sec | _____ % |
| Layer Count | _____ | _____ | _____ |
| Startup Time | _____ sec | _____ sec | _____ |
| Test Coverage | _____ % | _____ % | _____ |

### Checklist Status

- [ ] All episodes completed (18/18)
- [ ] All tests passing
- [ ] All quality gates met
- [ ] All acceptance criteria validated
- [ ] Documentation complete
- [ ] Ready for PR review

### PR Preparation

- [ ] Squash commits if requested
- [ ] Update PR description with results
- [ ] Link to spec documents
- [ ] Include before/after metrics
- [ ] Describe testing performed
- [ ] Note any follow-up items

## Sign-Off

**Implementation Complete**: [ ]

**Ready for Human Review**: [ ]

**Date Completed**: __________

**Final Notes**:
___________________________________________________________________
___________________________________________________________________
___________________________________________________________________
