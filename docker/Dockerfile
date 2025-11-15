# ============================================================================
# Benchling Webhook Docker Image - Multi-Stage Build
# ============================================================================
#
# This Dockerfile implements a multi-stage build using Amazon Linux 2023 as
# the base image. The builder stage compiles dependencies and the runtime
# stage provides a minimal production environment.
#
# Base Image: Amazon Linux 2023 (dated tag with hash-pinning for reproducibility)
# Reference: https://github.com/quiltdata/benchling-webhook/issues/194
#
# Hash Verification:
#   docker pull public.ecr.aws/amazonlinux/amazonlinux:2023.9.20251027.0
#   docker inspect --format='{{index .RepoDigests 0}}' public.ecr.aws/amazonlinux/amazonlinux:2023.9.20251027.0
#
# To Update Hash:
#   1. Pull latest: docker pull public.ecr.aws/amazonlinux/amazonlinux:2023.9.YYYYMMDD.0
#   2. Get digest: docker inspect --format='{{index .RepoDigests 0}}' <image>
#   3. Update FROM line below with new SHA256 hash
#
# ============================================================================

# ============================================================================
# BASE STAGE: Shared base image for both builder and runtime stages
# ============================================================================
FROM public.ecr.aws/amazonlinux/amazonlinux:2023.9.20251027.0@sha256:5f408731c7de2f2c313dbc2dc387b00791aa87c36dc2711caaa053d2991f178a AS base

# ============================================================================
# BUILDER STAGE: Compile dependencies and create virtual environment
# ============================================================================
#
# This stage contains build tools, compilers, and uv package manager.
# It creates a complete Python virtual environment with all production
# dependencies compiled for Amazon Linux 2023.
#
FROM base AS builder

# Accept VERSION as build argument (e.g., from git tag in CI)
# If not provided, version.py will fall back to pyproject.toml
ARG VERSION

# Install Python 3.13 and build dependencies
# - python3.13: Python interpreter
# - python3.13-devel: Headers needed for compiling native extensions
# - python3.13-pip: Package installer for Python
# - gcc: C compiler for native extensions (e.g., cryptography, lxml)
# - make: Build automation tool
# - tar, gzip: Required by uv installer script
RUN dnf install -y \
    python3.13 \
    python3.13-devel \
    python3.13-pip \
    gcc \
    make \
    tar \
    gzip \
    && dnf clean all

# Install uv package manager (builder stage only)
# Using official installation script from astral.sh
# uv is faster than pip and provides better dependency resolution
# This is only needed during build, not at runtime
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Set working directory for application
WORKDIR /app

# Copy dependency files first (layer caching optimization)
# These files change less frequently than source code, so Docker can
# cache this layer and subsequent dependency installation
COPY pyproject.toml uv.lock ./

# Install Python dependencies in virtual environment
# - --frozen: Use lockfile without updating (reproducible builds)
# - --no-dev: Exclude development dependencies (pytest, black, etc.)
# Creates .venv directory with all production dependencies
RUN $HOME/.local/bin/uv sync --frozen --no-dev

# Copy application source code
# Placed after dependency installation for optimal layer caching
# (source code changes more frequently than dependencies)
COPY src/ ./src/

# ============================================================================
# RUNTIME STAGE: Minimal production environment
# ============================================================================
#
# This stage contains only Python runtime and the application.
# Build tools, compilers, and uv are NOT included.
# This significantly reduces image size and attack surface.
#
FROM base

# Install minimal runtime dependencies
# - python3.13: Python runtime (no -devel headers)
# - shadow-utils: Provides useradd/groupadd for creating non-root user
# Note: curl-minimal is already present in base image and sufficient for HEALTHCHECK
RUN dnf install -y \
    python3.13 \
    shadow-utils \
    && dnf clean all

# Create non-root user for security (principle of least privilege)
# - UID 1000: Standard non-root user ID
# - appuser: Consistent with existing deployment configuration
RUN groupadd -r appuser && \
    useradd -r -g appuser -u 1000 appuser && \
    mkdir -p /app /home/appuser

# Set working directory
WORKDIR /app

# Copy application artifacts from builder stage
# - .venv: Complete Python virtual environment with dependencies
# - src: Application source code
# - pyproject.toml: Project metadata (for reference)
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src
COPY --from=builder /app/pyproject.toml /app/

# Set ownership for non-root user
# Ensures appuser can read application files
RUN chown -R appuser:appuser /app /home/appuser

# Switch to non-root user
# All subsequent commands and container runtime use this user
USER appuser

# Pass VERSION build arg to runtime stage
ARG VERSION

# Configure environment for Python execution
# - PATH: Prepend .venv/bin to activate virtual environment
#   This allows direct Python execution without uv wrapper
# - PYTHONPATH: Ensure Python can find application modules
# - FLASK_APP: Flask application entry point
# - BUILD_VERSION: Git tag version from CI (overrides pyproject.toml version)
# - UV_NO_CACHE: Disable UV cache to prevent read-only filesystem errors
# - UV_CACHE_DIR: Set cache to /tmp (writable) as fallback if UV is invoked
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app" \
    FLASK_APP="src.app" \
    BUILD_VERSION="${VERSION}" \
    UV_NO_CACHE="1" \
    UV_CACHE_DIR="/tmp/.uv-cache"

# Expose application port
# Flask default port for HTTP traffic
EXPOSE 5000

# Configure health check for container orchestration
# - interval: Check every 30 seconds
# - timeout: Fail if check takes longer than 10 seconds
# - start-period: Wait 5 seconds before first check (app startup)
# - retries: Mark unhealthy after 3 consecutive failures
# Compatible with ECS Fargate health check requirements
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Start application with direct Python execution
# Using python -m src.app instead of uv run to avoid:
# - Read-only filesystem errors (uv tries to create cache directory)
# - Runtime environment modification attempts
# - Unnecessary uv dependency at runtime
#
# Virtual environment is activated via PATH, so Python finds all dependencies
CMD ["python", "-m", "src.app"]
