# Analysis: Current Docker Implementation

**Reference**: 01-requirements.md
**Date**: 2025-11-06

## Current Implementation Overview

### Dockerfile Structure (docker/Dockerfile)

The current Dockerfile follows a single-stage build pattern:

```dockerfile
FROM python:3.14-slim
```

**Key Components**:
1. Base image: python:3.14-slim (no hash pinning)
2. Non-root user creation (appuser:appuser, UID 1000)
3. Working directory: /app
4. System dependencies: curl (for health checks)
5. Python package manager: uv (installed via pip)
6. Dependency installation: `uv sync --frozen --no-dev`
7. Application startup: `CMD ["uv", "run", "python", "-m", "src.app"]`

### Current Architecture Patterns

#### Application Structure

- **Primary Language**: Python (requires >= 3.11)
- **Framework**: Flask 3.1.2
- **Entry Point**: `src.app:create_app()` (application factory pattern)
- **Health Checks**: Multiple endpoints (/health, /health/ready, /health/live, /health/secrets)
- **Port**: 5000 (Flask default)
- **Environment**: Configured via environment variables and AWS Secrets Manager

#### Deployment Context

- **Platform**: AWS ECS Fargate
- **Region**: us-east-1 (hardcoded for ECR)
- **ECR Repository**: 712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling
- **Image Tags**: Supports both version tags (0.7.3) and timestamped dev versions
- **Stack**: AWS CDK-managed (TypeScript)

#### Build Process

1. Install system dependencies (curl)
2. Install uv via pip
3. Copy pyproject.toml and uv.lock
4. Run `uv sync --frozen --no-dev`
5. Copy application source
6. Set permissions for non-root user
7. Configure health check via curl

### Current Code Idioms and Conventions

#### Python Application Conventions

- **Package Management**: uv with locked dependencies (uv.lock)
- **Project Structure**: src-layout (src/ directory for application code)
- **Logging**: structlog with JSON output in production
- **Testing**: pytest with coverage (target: 85%+)
- **Linting**: black, flake8, isort (configured in pyproject.toml)
- **Python Version Support**: 3.11+ (pyproject.toml specifies >=3.11)

#### Docker Conventions

- **User Management**: Non-root user (UID 1000) for security
- **Port Exposure**: EXPOSE 5000
- **Health Checks**: curl-based HEALTHCHECK directive
- **Environment Variables**:
  - FLASK_APP=src.app
  - PYTHONPATH=/app
  - LOG_LEVEL (configurable, default INFO)

#### Build Artifacts

- **Dependencies**: Installed in .venv (uv's default virtual environment)
- **Cache Location**: /home/appuser/.cache/uv (causing read-only errors)
- **Application Code**: Copied to /app/src/

### System Constraints and Limitations

#### Current Issues

1. **No Hash Pinning**: Base image `python:3.14-slim` has no SHA256 hash
   - Builds are non-reproducible
   - Security vulnerabilities cannot be tracked to specific base versions
   - Violates GitOps best practices

2. **Single-Stage Build**: No separation of build and runtime environments
   - Final image contains uv installation
   - uv cache remains in image (bloat)
   - Build tools and intermediate artifacts included
   - Larger image size than necessary

3. **Runtime uv Usage**: `CMD ["uv", "run", "python", "-m", "src.app"]`
   - uv attempts to manage virtual environment at runtime
   - Fails with "Read-only file system" error in production
   - Error message: `error: failed to create directory '/home/appuser/.cache/uv': Read-only file system (os error 30)`
   - Indicates uv is trying to update/modify the environment

4. **Base Image Mismatch**: Using Python slim instead of Amazon Linux 2023
   - Not aligned with AWS Lambda/ECS best practices
   - Different from reference implementation
   - May have different system library versions

#### Deployment Constraints

1. **ECS Fargate Environment**:
   - Read-only root filesystem (security best practice)
   - Limited writable volumes
   - Container must work without filesystem modifications
   - Health checks must complete within timeout periods

2. **ECR Configuration**:
   - Centralized ECR account (712023778557)
   - Fixed region (us-east-1)
   - Multi-account deployment model
   - Image must be accessible across AWS accounts

3. **CDK Stack Requirements**:
   - Image tag must be parameterizable
   - Supports both version tags and dev timestamps
   - Integration with CloudFormation parameters
   - Must work with existing FargateService construct

### Architectural Challenges

#### Challenge 1: Base Image Compatibility

**Current State**: python:3.14-slim (Debian-based)
**Target State**: amazonlinux:2023

**Considerations**:
- Python 3.14 may not be available on Amazon Linux 2023
- May need to use Python 3.11 or 3.12
- System package names differ (apt vs yum/dnf)
- Need to verify pyproject.toml compatibility

#### Challenge 2: Virtual Environment Activation

**Current State**: uv run manages environment
**Target State**: Direct Python execution with pre-activated venv

**Considerations**:
- Virtual environment must be activated in Dockerfile
- PATH must include .venv/bin
- Python must find installed packages
- No runtime modifications needed

#### Challenge 3: Multi-Stage Build Structure

**Current State**: Single stage with all tools
**Target State**: Separate builder and runtime stages

**Considerations**:
- Builder stage: uv, build tools, compilation
- Runtime stage: Only Python runtime and app
- Efficient artifact copying between stages
- Minimize final image layers

#### Challenge 4: Health Check Compatibility

**Current State**: curl-based health check
**Target State**: May need alternative (curl not in minimal base)

**Considerations**:
- Amazon Linux 2023 minimal base may not include curl
- Could use Python-based health check
- Or install curl explicitly in runtime stage
- Must maintain <30s health check response time

### Gap Analysis

#### Requirements vs Current State

| Requirement | Current State | Gap |
|------------|---------------|-----|
| Amazon Linux 2023 base | python:3.14-slim | Different base entirely |
| Hash pinning | No hash | Missing reproducibility |
| Multi-stage build | Single stage | Missing optimization |
| Direct Python execution | uv run wrapper | Runtime error source |
| Read-only filesystem support | Fails | Critical production issue |
| Reference alignment | Different structure | Pattern mismatch |

#### Technical Debt Identified

1. **Dependency Management**: uv installed globally via pip (should be in builder only)
2. **Cache Cleanup**: No explicit cache removal in Dockerfile
3. **Layer Optimization**: Not following Docker best practices for layer caching
4. **Documentation**: Minimal inline comments in Dockerfile
5. **Python Version**: Using 3.14 (very recent, may have compatibility issues)

### Design Considerations for Specifications

#### Critical Decisions Needed

1. **Python Version**: Determine highest Python version available on Amazon Linux 2023
2. **uv Location**: Keep in builder stage only, or minimal install in runtime?
3. **Health Check Method**: curl (requires installation) vs Python-based?
4. **Virtual Environment**: Copy entire .venv or use pip install in runtime?
5. **Base Image Hash**: How to document and update hash over time?

#### Integration Points

1. **CDK Stack**: Must update image tag but not break existing deployments
2. **CI/CD**: Build process must remain compatible with existing pipelines
3. **Testing**: Local testing with `make -C docker test-local` must work
4. **Deployment**: Existing deploy commands must continue to function

#### Performance Requirements

1. **Build Time**: Should not significantly increase build duration
2. **Image Size**: Target 30%+ reduction from current size
3. **Startup Time**: Must complete health check within 30s
4. **Runtime Performance**: No degradation from current performance

## Reference Implementation Analysis

Reference Dockerfile from quiltdata/quilt/lambdas/thumbnail/Dockerfile would provide:

- Amazon Linux 2023 base image patterns
- Multi-stage build structure
- Hash pinning approach
- Python installation on Amazon Linux
- Virtual environment activation patterns
- Minimal runtime dependencies

**Note**: Actual reference file should be reviewed for specific implementation patterns.

## Summary

The current Dockerfile implements a functional but non-optimal Docker build that:

1. ✅ **Works**: Successfully runs application in development
2. ❌ **Fails in production**: Read-only filesystem errors
3. ❌ **Non-reproducible**: No base image hash pinning
4. ❌ **Bloated**: Single-stage build includes build artifacts
5. ❌ **Misaligned**: Different base than reference implementation

The rework must maintain compatibility with existing deployment infrastructure while addressing all identified issues, particularly the critical read-only filesystem failure in production environments.
