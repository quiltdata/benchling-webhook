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
ARG TARGETARCH
FROM public.ecr.aws/amazonlinux/amazonlinux:2023.9.20251208.0@sha256:dc1dacae45ec346969d430237ddd1a282170ec9f322d4b3cf28ac8f1975070a1 AS base
ARG TARGETARCH

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

# Install Python 3.11 and build dependencies
# - python3.11: Python interpreter
# - python3.11-devel: Headers needed for compiling native extensions
# - python3.11-pip: Package installer for Python
# - gcc: C compiler for native extensions (e.g., cryptography, lxml)
# - make: Build automation tool
# - tar, gzip: Required by uv installer script
RUN dnf install -y \
    python3.11 \
    python3.11-devel \
    python3.11-pip \
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
RUN $HOME/.local/bin/uv sync --frozen --no-dev --python python3.11

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

ARG TARGETARCH

# Install minimal runtime dependencies
# - python3.11: Python runtime (no -devel headers)
# - shadow-utils: Provides useradd/groupadd for creating non-root user
RUN dnf install -y \
    python3.11 \
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
# - APP_ENV: Application environment indicator (influences logging format)
# - BUILD_VERSION: Git tag version from CI (overrides pyproject.toml version)
# - PORT: Application port (default 8080)
# - PYTHONUNBUFFERED: Flush logs immediately (required for container logging)
# - UV_NO_CACHE: Disable UV cache to prevent read-only filesystem errors
# - UV_CACHE_DIR: Set cache to /tmp (writable) as fallback if UV is invoked
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app" \
    APP_ENV="production" \
    BUILD_VERSION="${VERSION}" \
    PORT="8080" \
    PYTHONUNBUFFERED="1" \
    UV_NO_CACHE="1" \
    UV_CACHE_DIR="/tmp/.uv-cache"

# Expose application port
# Uses PORT env var for consistency with app.py
EXPOSE ${PORT}

# Configure health check for container orchestration
# - interval: Check every 30 seconds
# - timeout: Fail if check takes longer than 10 seconds
# - start-period: Wait 5 seconds before first check (app startup)
# - retries: Mark unhealthy after 3 consecutive failures
# Uses PORT env var for consistency with app.py runtime port configuration
# Compatible with ECS Fargate health check requirements
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Start application with Gunicorn + Uvicorn workers
# Note: Quote 'src.app:create_app()' to prevent shell from parsing parentheses as subshell operators
# Architecture:
# - --preload: Load app before forking workers (enables JWKS cache sharing)
# - --workers 2: Reduced from 4 (shared cache eliminates need for more workers)
# - --worker-tmp-dir /dev/shm: Use tmpfs for worker heartbeat files (read-only filesystem compatibility)
# Timeout Configuration:
# - --timeout 60: Worker timeout (allows JWKS fetch in VPC to complete)
# - --graceful-timeout 30: Graceful shutdown period for workers
# - --keep-alive 75: Keep connections alive to avoid recreation overhead
# - --log-level info: Log worker lifecycle events for debugging
# PORT Configuration:
# - Uses shell form to expand PORT environment variable (defaults to 8080 in ENV)
# - This allows runtime override (e.g., PORT=5001 in integrated deployments)
CMD sh -c "gunicorn 'src.app:create_app()' --preload -k uvicorn.workers.UvicornWorker --workers 2 --bind 0.0.0.0:${PORT} --worker-tmp-dir /dev/shm --timeout 60 --graceful-timeout 30 --keep-alive 75 --log-level info --access-logfile - --error-logfile -"
