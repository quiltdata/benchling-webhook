# Phase 1 Episodes: Atomic Change Units

**Reference**: 05-phase1-design.md
**Phase**: 1 of 1
**Date**: 2025-11-06

## Episode Structure

Each episode represents a single, testable, committable change that advances the implementation. Episodes follow TDD/BDD cycles:

1. **Red**: Write tests that define expected behavior (tests fail)
2. **Green**: Implement minimum code to pass tests
3. **Refactor**: Improve code while keeping tests green
4. **Commit**: Commit and push completed episode

## Episode 1: Research and Baseline Measurement

**Goal**: Establish baseline metrics and gather required information

**Tasks**:
1. Measure current Docker image size
2. Measure current build time
3. Document current layer count
4. Identify Amazon Linux 2023 base image hash
5. Verify Python 3.11 availability on AL2023
6. Document findings in research notes

**Testing Approach**:
- Manual measurement and documentation
- Shell scripts to automate measurements
- Save baseline data for comparison

**Success Criteria**:
- Baseline metrics documented
- AL2023 Python version confirmed
- Base image hash identified
- Research notes created

**Deliverables**:
- `spec/194-rework-dockerfile/research-notes.md`
- Baseline metrics recorded
- Base image hash documented

**Commit Message**:
```
docs: baseline measurements and research for issue #194

- Measure current image size and build time
- Identify Amazon Linux 2023 base image hash
- Confirm Python 3.11 availability
- Document findings for Dockerfile rework

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 1
```

## Episode 2: Backup Current Dockerfile

**Goal**: Preserve current working Dockerfile for comparison and rollback

**Tasks**:
1. Copy current Dockerfile to backup file
2. Add documentation comment about backup purpose
3. Commit backup before making changes

**Testing Approach**:
- Verify backup file exists
- Confirm backup file is identical to original
- Test that backup builds successfully

**Success Criteria**:
- Backup file created at `docker/Dockerfile.backup-python-slim`
- Backup file builds successfully
- Backup documented in commit message

**Deliverables**:
- `docker/Dockerfile.backup-python-slim`

**Commit Message**:
```
chore: backup current Dockerfile before rework

Create backup of working python:3.14-slim Dockerfile before
implementing Amazon Linux 2023 multi-stage build for issue #194.

Backup enables:
- Easy comparison with new approach
- Quick rollback if needed
- Documentation of migration path

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 2
```

## Episode 3: Create Multi-Stage Structure with Builder Stage

**Goal**: Establish multi-stage build with Amazon Linux 2023 builder stage

**Tasks**:
1. Replace base image with AL2023 and SHA256 hash
2. Add builder stage label
3. Install Python 3.11 and development dependencies
4. Add inline comments explaining choices

**Testing Approach**:
- Build builder stage only: `docker build --target builder -t test-builder docker/`
- Verify Python 3.11 installed
- Verify build tools available
- Confirm image builds without errors

**Success Criteria**:
- Builder stage defined with AL2023 base
- Base image includes SHA256 hash
- Python 3.11 installed successfully
- Build tools (gcc, make) available
- Stage builds without errors

**Deliverables**:
- Updated `docker/Dockerfile` with builder stage
- Builder stage builds successfully

**Test Commands**:
```bash
# Test builder stage
docker build --target builder -t benchling-builder docker/

# Verify Python version
docker run benchling-builder python3.11 --version

# Verify build tools
docker run benchling-builder gcc --version
docker run benchling-builder make --version
```

**Commit Message**:
```
feat: add Amazon Linux 2023 builder stage with hash pinning

- Use AL2023 with SHA256 hash for reproducibility
- Install Python 3.11 and development dependencies
- Add build tools (gcc, make) for native extensions
- Document base image hash and update process

Addresses US-1 (reproducible base image) from issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 3
```

## Episode 4: Install uv in Builder Stage

**Goal**: Add uv package manager to builder stage

**Tasks**:
1. Install uv using official curl script
2. Configure uv in PATH
3. Add comments explaining installation method
4. Test uv availability

**Testing Approach**:
- Build builder stage
- Verify uv command available
- Test uv version command
- Confirm uv can create virtual environments

**Success Criteria**:
- uv installed successfully in builder
- uv command accessible
- uv version displays correctly
- Builder stage builds without errors

**Deliverables**:
- Updated builder stage with uv installation

**Test Commands**:
```bash
# Build and test uv
docker build --target builder -t benchling-builder docker/
docker run benchling-builder bash -c ". ~/.cargo/env && uv --version"
```

**Commit Message**:
```
feat: install uv package manager in builder stage

- Use official uv installation script
- Configure PATH for uv access
- Document installation method
- Verify uv functionality

Part of multi-stage build for issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 4
```

## Episode 5: Install Dependencies in Builder Stage

**Goal**: Copy dependency files and install Python dependencies

**Tasks**:
1. Set WORKDIR to /app
2. Copy pyproject.toml and uv.lock
3. Run `uv sync --frozen --no-dev`
4. Verify .venv created correctly
5. Add layer caching comments

**Testing Approach**:
- Build builder stage
- Verify .venv directory exists
- Verify dependencies installed
- Test import of key packages
- Confirm lockfile used without modification

**Success Criteria**:
- pyproject.toml and uv.lock copied
- Dependencies installed in .venv
- No development dependencies included
- Lockfile respected (frozen)
- Builder stage builds successfully

**Deliverables**:
- Updated builder stage with dependency installation

**Test Commands**:
```bash
# Build builder stage
docker build --target builder -t benchling-builder docker/

# Verify .venv exists
docker run benchling-builder ls -la /app/.venv

# Verify dependencies installed
docker run benchling-builder ls /app/.venv/lib/python3.11/site-packages/

# Test key imports
docker run benchling-builder bash -c ". /app/.venv/bin/activate && python -c 'import flask; import boto3; import structlog; print(\"Dependencies OK\")'"
```

**Commit Message**:
```
feat: install Python dependencies in builder stage

- Copy pyproject.toml and uv.lock
- Use uv sync --frozen --no-dev for reproducibility
- Create virtual environment with production dependencies
- Optimize layer caching by separating dependency files

Part of multi-stage build for issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 5
```

## Episode 6: Copy Application Source in Builder Stage

**Goal**: Copy application source code to complete builder stage

**Tasks**:
1. Copy src/ directory to builder
2. Add comment about layer caching strategy
3. Verify application files present

**Testing Approach**:
- Build builder stage
- Verify src/ directory exists
- Verify all application files present
- Test that application code is accessible

**Success Criteria**:
- src/ directory copied to /app/src/
- All application files present
- Builder stage complete and builds successfully

**Deliverables**:
- Complete builder stage with application source

**Test Commands**:
```bash
# Build builder stage
docker build --target builder -t benchling-builder docker/

# Verify source directory
docker run benchling-builder ls -la /app/src/

# Verify key files
docker run benchling-builder ls /app/src/ | grep -E "app\.py|config\.py"
```

**Commit Message**:
```
feat: copy application source to builder stage

- Copy src/ directory to builder
- Complete builder stage with all build artifacts
- Optimize layer caching by copying source last

Builder stage now complete for issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 6
```

## Episode 7: Create Runtime Stage Base

**Goal**: Start runtime stage with minimal AL2023 base

**Tasks**:
1. Add runtime stage with same AL2023 base + hash
2. Install Python 3.11 runtime (no dev packages)
3. Install curl for health checks
4. Add comments explaining minimal dependencies
5. Clean dnf cache

**Testing Approach**:
- Build full image (both stages)
- Verify runtime stage is minimal
- Verify Python available
- Verify curl available
- Check image size reduction

**Success Criteria**:
- Runtime stage defined with AL2023 base
- Python 3.11 runtime installed
- curl installed for health checks
- No build tools in runtime
- dnf cache cleaned

**Deliverables**:
- Runtime stage base configuration

**Test Commands**:
```bash
# Build full image
docker build -t benchling-webhook:test docker/

# Verify Python in runtime
docker run benchling-webhook:test python3.11 --version

# Verify curl in runtime
docker run benchling-webhook:test curl --version

# Verify no build tools
docker run benchling-webhook:test gcc --version 2>&1 | grep "not found"
```

**Commit Message**:
```
feat: create minimal runtime stage

- Use AL2023 base with same hash as builder
- Install Python 3.11 runtime only (no dev packages)
- Install curl for health checks
- Clean package manager cache
- Minimal dependencies for security

Addresses US-2 (optimized image size) from issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 7
```

## Episode 8: Create Non-Root User in Runtime

**Goal**: Add appuser user/group configuration in runtime stage

**Tasks**:
1. Create appuser group
2. Create appuser user (UID 1000)
3. Create /app and /home/appuser directories
4. Add security comment

**Testing Approach**:
- Build image
- Verify user exists
- Verify UID is 1000
- Verify directories created
- Test user can access directories

**Success Criteria**:
- appuser group created
- appuser user created with UID 1000
- Directories exist and accessible
- Security best practices maintained

**Deliverables**:
- Runtime stage with non-root user

**Test Commands**:
```bash
# Build image
docker build -t benchling-webhook:test docker/

# Verify user
docker run benchling-webhook:test id appuser

# Verify UID
docker run benchling-webhook:test id -u appuser | grep 1000

# Verify directories
docker run benchling-webhook:test ls -ld /app /home/appuser
```

**Commit Message**:
```
feat: configure non-root user in runtime stage

- Create appuser group and user (UID 1000)
- Create necessary directories
- Maintain security best practices
- Prepare for permission configuration

Security compliance for issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 8
```

## Episode 9: Copy Application Artifacts to Runtime

**Goal**: Copy venv and source from builder to runtime

**Tasks**:
1. Set WORKDIR to /app
2. Copy .venv from builder stage
3. Copy src/ from builder stage
4. Copy pyproject.toml from builder stage
5. Add comments about artifact selection

**Testing Approach**:
- Build image
- Verify .venv copied correctly
- Verify src/ directory present
- Test Python can import application
- Verify dependencies available

**Success Criteria**:
- .venv copied from builder
- src/ directory copied
- pyproject.toml copied
- All artifacts accessible
- No unnecessary files copied

**Deliverables**:
- Runtime stage with application artifacts

**Test Commands**:
```bash
# Build image
docker build -t benchling-webhook:test docker/

# Verify .venv
docker run benchling-webhook:test ls -la /app/.venv

# Verify src
docker run benchling-webhook:test ls -la /app/src/

# Test imports
docker run benchling-webhook:test \
  bash -c "PATH=/app/.venv/bin:\$PATH python -c 'import src.app; print(\"Import OK\")'"
```

**Commit Message**:
```
feat: copy application artifacts to runtime stage

- Copy .venv from builder (complete dependencies)
- Copy src/ directory from builder
- Copy pyproject.toml for metadata
- Minimize runtime image content

Part of multi-stage build for issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 9
```

## Episode 10: Configure Permissions in Runtime

**Goal**: Set proper ownership for non-root user

**Tasks**:
1. Set ownership of /app to appuser:appuser
2. Set ownership of /home/appuser to appuser:appuser
3. Add comment about permission strategy
4. Switch to USER appuser

**Testing Approach**:
- Build image
- Verify ownership correct
- Verify appuser can read files
- Verify container runs as appuser
- Test write permissions (should be limited)

**Success Criteria**:
- All /app files owned by appuser
- /home/appuser owned by appuser
- Container runs as non-root
- Proper permissions enforced

**Deliverables**:
- Runtime stage with proper permissions

**Test Commands**:
```bash
# Build image
docker build -t benchling-webhook:test docker/

# Verify ownership
docker run benchling-webhook:test ls -la /app

# Verify running user
docker run benchling-webhook:test whoami | grep appuser

# Verify can read application
docker run benchling-webhook:test cat /app/src/app.py | head -1
```

**Commit Message**:
```
feat: configure permissions for non-root execution

- Set ownership of /app to appuser
- Set ownership of /home/appuser to appuser
- Switch to USER appuser
- Enforce least privilege principle

Security configuration for issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 10
```

## Episode 11: Configure Environment Variables

**Goal**: Set environment variables for Python execution

**Tasks**:
1. Set PATH to include .venv/bin
2. Set PYTHONPATH to /app
3. Set FLASK_APP to src.app
4. Add comments explaining activation strategy
5. Document environment configuration

**Testing Approach**:
- Build image
- Verify PATH includes .venv/bin
- Verify PYTHONPATH set correctly
- Test Python can import application
- Verify Flask app can be found

**Success Criteria**:
- PATH includes /app/.venv/bin first
- PYTHONPATH set to /app
- FLASK_APP set to src.app
- Environment variables accessible
- Python can find dependencies

**Deliverables**:
- Runtime environment configuration

**Test Commands**:
```bash
# Build image
docker build -t benchling-webhook:test docker/

# Verify PATH
docker run benchling-webhook:test bash -c 'echo $PATH' | grep "/app/.venv/bin"

# Verify PYTHONPATH
docker run benchling-webhook:test bash -c 'echo $PYTHONPATH' | grep "/app"

# Verify which python
docker run benchling-webhook:test which python

# Test import
docker run benchling-webhook:test python -c "import src.app; print('OK')"
```

**Commit Message**:
```
feat: configure runtime environment variables

- Set PATH to activate virtual environment
- Set PYTHONPATH for module resolution
- Set FLASK_APP for application location
- Enable direct Python execution without wrapper

Addresses US-3 (stable runtime execution) from issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 11
```

## Episode 12: Update CMD to Direct Python Execution

**Goal**: Replace uv run with direct Python execution

**Tasks**:
1. Change CMD to use python -m src.app
2. Remove uv run wrapper
3. Add comment explaining change
4. Document read-only filesystem compatibility

**Testing Approach**:
- Build image
- Start container
- Verify application starts
- Check logs for errors
- Verify no filesystem write attempts
- Test health checks work

**Success Criteria**:
- CMD uses direct Python execution
- Application starts successfully
- No filesystem errors in logs
- Health checks respond
- Application processes requests

**Deliverables**:
- Updated CMD directive

**Test Commands**:
```bash
# Build image
docker build -t benchling-webhook:test docker/

# Start container
docker run -d -p 5000:5000 --name test-app benchling-webhook:test

# Wait for startup
sleep 10

# Check health
curl http://localhost:5000/health

# Check logs for errors
docker logs test-app 2>&1 | grep -i "error"

# Cleanup
docker rm -f test-app
```

**Commit Message**:
```
feat: use direct Python execution instead of uv run

- Change CMD to python -m src.app
- Remove uv wrapper to avoid cache directory issues
- Enable read-only filesystem compatibility
- Prevent "Read-only file system" errors

Addresses US-3 (stable runtime execution) from issue #194
Fixes production filesystem errors

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 12
```

## Episode 13: Add EXPOSE and HEALTHCHECK

**Goal**: Configure port exposure and health check

**Tasks**:
1. Add EXPOSE 5000 directive
2. Add HEALTHCHECK directive with curl
3. Configure health check timing parameters
4. Add comments explaining configuration

**Testing Approach**:
- Build image
- Start container
- Verify port exposed
- Verify health check runs
- Check health check timing
- Verify health check succeeds

**Success Criteria**:
- Port 5000 exposed
- HEALTHCHECK configured with curl
- Health check interval: 30s
- Health check timeout: 10s
- Start period: 5s
- Health check passes

**Deliverables**:
- Complete Dockerfile with health check

**Test Commands**:
```bash
# Build image
docker build -t benchling-webhook:test docker/

# Start container
docker run -d -p 5000:5000 --name test-health benchling-webhook:test

# Wait for health check
sleep 15

# Check health status
docker inspect test-health --format='{{.State.Health.Status}}'

# Verify health check command works
docker exec test-health curl -f http://localhost:5000/health

# Cleanup
docker rm -f test-health
```

**Commit Message**:
```
feat: configure port exposure and health check

- EXPOSE port 5000 for Flask application
- Add HEALTHCHECK with curl-based check
- Configure timing parameters for ECS compatibility
- Maintain existing health check behavior

Health check configuration for issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 13
```

## Episode 14: Add Inline Documentation

**Goal**: Add comprehensive comments to Dockerfile

**Tasks**:
1. Add header comment with overview
2. Document base image hash and verification
3. Explain builder stage purpose
4. Explain runtime stage purpose
5. Document all non-obvious choices
6. Add security and performance notes

**Testing Approach**:
- Review comments for clarity
- Verify comments match implementation
- Ensure hash update process documented
- Check all decisions explained

**Success Criteria**:
- All stages documented
- Base image hash documented with verification method
- All major decisions explained
- Security choices documented
- Performance optimizations noted

**Deliverables**:
- Fully documented Dockerfile

**Commit Message**:
```
docs: add comprehensive inline documentation to Dockerfile

- Document base image hash and verification process
- Explain multi-stage build strategy
- Document security decisions
- Explain performance optimizations
- Add hash update instructions

Documentation for issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 14
```

## Episode 15: Test Read-Only Filesystem Compatibility

**Goal**: Validate container works with read-only filesystem

**Tasks**:
1. Create test script for read-only validation
2. Run container with --read-only flag
3. Verify application starts
4. Check logs for filesystem errors
5. Test all health endpoints
6. Document validation results

**Testing Approach**:
- Start container with read-only root filesystem
- Monitor logs for any write attempts
- Test health endpoints
- Verify application functionality
- Confirm no errors occur

**Success Criteria**:
- Container starts with --read-only
- No filesystem errors in logs
- Health checks pass
- Application responds to requests
- No write attempts logged

**Deliverables**:
- Validation test results
- Documentation of compatibility

**Test Commands**:
```bash
# Build image
docker build -t benchling-webhook:test docker/

# Start with read-only filesystem
docker run -d -p 5000:5000 --read-only --name test-ro benchling-webhook:test

# Wait for startup
sleep 10

# Test health checks
curl http://localhost:5000/health
curl http://localhost:5000/health/ready
curl http://localhost:5000/health/live

# Check for filesystem errors
docker logs test-ro 2>&1 | grep -i "read-only"
docker logs test-ro 2>&1 | grep -i "error"

# Cleanup
docker rm -f test-ro
```

**Commit Message**:
```
test: validate read-only filesystem compatibility

- Test container with --read-only flag
- Verify no filesystem write attempts
- Confirm all health checks pass
- Document validation results

Validates US-3 from issue #194 - stable runtime execution

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 15
```

## Episode 16: Measure and Document Image Size Reduction

**Goal**: Compare new image with baseline measurements

**Tasks**:
1. Build both old and new images
2. Measure and compare image sizes
3. Calculate percentage reduction
4. Document layer counts
5. Analyze size improvements
6. Update research notes with results

**Testing Approach**:
- Build baseline image from backup
- Build new image
- Compare sizes with docker images
- Use docker history for layer analysis
- Use dive tool for detailed analysis (if available)

**Success Criteria**:
- New image at least 30% smaller
- Size comparison documented
- Layer analysis complete
- Results meet success criteria from specifications

**Deliverables**:
- Size comparison documentation
- Updated research notes

**Test Commands**:
```bash
# Build old image
docker build -f docker/Dockerfile.backup-python-slim -t benchling-webhook:old docker/

# Build new image
docker build -t benchling-webhook:new docker/

# Compare sizes
docker images | grep benchling-webhook

# Layer analysis
docker history benchling-webhook:old
docker history benchling-webhook:new

# Calculate reduction
# (Document in research notes)
```

**Commit Message**:
```
docs: measure and document image size reduction

- Compare old vs new image sizes
- Document layer counts and optimization
- Calculate percentage reduction
- Validate meets 30%+ target

Addresses US-2 (optimized image size) from issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 16
```

## Episode 17: Run Complete Test Suite

**Goal**: Validate all tests pass with new Docker image

**Tasks**:
1. Run unit tests with new image
2. Run integration tests (if applicable)
3. Run lint checks
4. Verify all tests pass
5. Document any test updates needed
6. Ensure test coverage maintained

**Testing Approach**:
- Run make test-unit
- Run make lint
- Check test output for failures
- Verify coverage metrics
- Document results

**Success Criteria**:
- All unit tests pass
- Linting passes
- Test coverage >= 85%
- No regressions introduced
- All make targets work

**Deliverables**:
- Test results documentation
- All tests passing

**Test Commands**:
```bash
# Run tests
cd docker
make build
make test-unit
make lint

# Check coverage (if available)
# Document results
```

**Commit Message**:
```
test: validate complete test suite with new Docker image

- Run all unit tests - PASS
- Run linting checks - PASS
- Verify test coverage maintained
- Confirm no regressions

Validates implementation for issue #194

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 17
```

## Episode 18: Final Integration Validation

**Goal**: Complete end-to-end validation of new Dockerfile

**Tasks**:
1. Build production-tagged image
2. Test all health endpoints
3. Verify startup timing < 30s
4. Test with production-like environment variables
5. Verify CloudWatch logging compatibility
6. Document final validation results
7. Update checklist with completion status

**Testing Approach**:
- Build with production tag format
- Start container with production configuration
- Run full integration test sequence
- Validate all acceptance criteria met
- Document results

**Success Criteria**:
- Production image builds successfully
- Startup time < 30 seconds
- All health checks pass
- Logging works correctly
- All acceptance criteria met
- Ready for ECR push

**Deliverables**:
- Final validation documentation
- Production-ready Docker image

**Test Commands**:
```bash
# Build production image
docker build -t 712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:test docker/

# Start with production config
docker run -d -p 5000:5000 \
  --read-only \
  -e LOG_LEVEL=INFO \
  -e FLASK_ENV=production \
  --name prod-test \
  712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:test

# Measure startup
docker logs -f prod-test | grep "Running on"

# Test health
curl http://localhost:5000/health
curl http://localhost:5000/health/ready

# Check logs
docker logs prod-test

# Cleanup
docker rm -f prod-test
```

**Commit Message**:
```
test: final integration validation for production readiness

- Build production-tagged image
- Validate startup timing < 30s
- Test all health endpoints
- Verify read-only filesystem compatibility
- Confirm CloudWatch logging works
- Validate all acceptance criteria met

Completes implementation for issue #194
Ready for ECR push and deployment

Ref: spec/194-rework-dockerfile/06-phase1-episodes.md Episode 18
```

## Episode Summary

| Episode | Goal | Deliverable | Testing |
| --------- | ------ | ------------- | --------- |
| 1 | Research | Baseline metrics, base image hash | Manual measurement |
| 2 | Backup | Dockerfile.backup-python-slim | Build test |
| 3 | Builder base | AL2023 builder stage | Stage build test |
| 4 | Builder uv | uv installation | uv command test |
| 5 | Builder deps | Dependency installation | Import test |
| 6 | Builder source | Application source copy | File presence test |
| 7 | Runtime base | Minimal runtime stage | Runtime build test |
| 8 | Runtime user | Non-root user config | User verification |
| 9 | Runtime artifacts | Copy venv and source | Import test |
| 10 | Runtime permissions | Ownership configuration | Permission test |
| 11 | Runtime env | Environment variables | ENV verification |
| 12 | Runtime CMD | Direct Python execution | Startup test |
| 13 | Runtime config | Port and health check | Health test |
| 14 | Documentation | Inline comments | Review |
| 15 | Read-only test | Filesystem compatibility | --read-only test |
| 16 | Size measurement | Size reduction metrics | Comparison |
| 17 | Test suite | All tests passing | make test |
| 18 | Final validation | Production readiness | Full integration |

## Next Steps

After completing episodes:
1. Create 07-phase1-checklist.md with detailed validation checklist
2. Execute episodes in order with TDD approach
3. Commit and push after each episode
4. Update checklist as episodes complete
5. Final validation before PR review
