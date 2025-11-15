# Requirements: Rework Dockerfile

**GitHub Issue**: #194
**Branch**: 194-rework-dockerfile
**Date**: 2025-11-06

## Problem Statement

The current Dockerfile has several issues affecting reproducibility, security, and operational stability:

1. Uses a generic Python base image without hash pinning for reproducibility
2. Does not use multi-stage builds, leading to bloated images with build caches
3. Uses `uv run` to start the server, causing runtime errors when uv attempts to update the environment in read-only production filesystems
4. Does not follow best practices demonstrated in the Quilt project's reference implementation

## User Stories

### US-1: Reproducible Base Image
**As a** DevOps engineer
**I want** the Docker image to use Amazon Linux 2023 with hash pinning
**So that** builds are reproducible and security vulnerabilities can be tracked to specific base image versions

**Acceptance Criteria**:
- Base image is `amazonlinux:2023`
- Base image is specified with SHA256 hash for reproducibility
- Hash is documented and can be updated through a clear process

### US-2: Optimized Image Size
**As a** platform engineer
**I want** the Docker image to use multi-stage builds
**So that** the final image does not contain build caches, development tools, or unnecessary artifacts

**Acceptance Criteria**:
- Dockerfile uses multi-stage build pattern
- Builder stage contains uv and build dependencies
- Runtime stage contains only Python runtime and application code
- uv cache does not exist in the final image
- Final image size is reduced compared to current implementation

### US-3: Stable Runtime Execution
**As a** application developer
**I want** the application to start without uv attempting to modify the environment
**So that** the application runs reliably in read-only production environments

**Acceptance Criteria**:
- Application starts using Python directly, not through `uv run`
- No "Read-only file system" errors occur at runtime
- Application can run successfully with read-only filesystem at `/home/appuser/.cache`
- Virtual environment is properly activated and used at runtime

### US-4: Reference Implementation Alignment
**As a** engineering team member
**I want** the Dockerfile to follow patterns from the Quilt project reference
**So that** we maintain consistency across projects and leverage proven approaches

**Acceptance Criteria**:
- Dockerfile structure aligns with https://github.com/quiltdata/quilt/blob/master/lambdas/thumbnail/Dockerfile
- Best practices from reference implementation are adopted
- Security patterns (non-root user, minimal privileges) are maintained
- Health check and monitoring capabilities are preserved

## Success Criteria

1. **Reproducibility**: Base image hash is pinned and documented
2. **Size Optimization**: Final image size reduced by at least 30% through multi-stage build
3. **Runtime Stability**: No filesystem errors occur during application startup or operation
4. **Build Success**: Docker image builds successfully in CI/CD pipeline
5. **Deployment Success**: Image deploys successfully to ECS and runs without errors
6. **Test Coverage**: All existing tests pass with new Docker configuration
7. **Documentation**: Dockerfile includes clear comments explaining each stage and decision

## High-Level Implementation Approach

1. Adopt Amazon Linux 2023 as base image with hash pinning
2. Implement multi-stage build with separate builder and runtime stages
3. Install dependencies in builder stage using uv
4. Copy only necessary artifacts to runtime stage
5. Modify CMD to use Python directly instead of uv run
6. Ensure proper virtual environment activation in runtime stage
7. Validate health check compatibility with new configuration
8. Update any related documentation or CI/CD configurations

## Open Questions

1. **Q**: What is the current acceptable image size baseline?
   **A**: TBD - Need to measure current image size for comparison

2. **Q**: Are there specific Python version requirements for Amazon Linux 2023?
   **A**: TBD - Verify Python 3.14 availability or determine appropriate version

3. **Q**: Should we maintain compatibility with existing deployment scripts?
   **A**: TBD - Identify any deployment dependencies on current Dockerfile structure

4. **Q**: Are there specific security scanning requirements for the base image?
   **A**: TBD - Confirm if security scanning is part of CI/CD process

5. **Q**: What is the deployment target environment (ECS, Lambda, etc.)?
   **A**: ECS (based on project context)

## References

- GitHub Issue: #194
- Reference Dockerfile: https://github.com/quiltdata/quilt/blob/master/lambdas/thumbnail/Dockerfile
- Current Dockerfile: `/Users/ernest/GitHub/benchling-webhook/docker/Dockerfile`
