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
FROM public.ecr.aws/amazonlinux/amazonlinux:2023.9.20251117.1@sha256:f5ca6cafc706233c641ad838e738047389943afd3585cb1df7eedfc4d9b1799d AS base
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
    && ARCH_FOR_UNIT="${TARGETARCH:-$(uname -m)}" && \
    if [ "${ARCH_FOR_UNIT}" = "amd64" ] || [ "${ARCH_FOR_UNIT}" = "x86_64" ]; then \
        echo "Installing NGINX Unit for ${ARCH_FOR_UNIT}..." && \
        printf '%s\n' \
          '[unit]' \
          'name=unit repo' \
          'baseurl=https://packages.nginx.org/unit/amzn/2023/$basearch/' \
          'gpgkey=https://unit.nginx.org/keys/nginx-keyring.gpg' \
          'gpgcheck=1' \
          'enabled=1' \
          > /etc/yum.repos.d/unit.repo \
        && dnf install -y unit unit-python311 \
        && rm -f /etc/yum.repos.d/unit.repo; \
    else \
        echo "Skipping NGINX Unit install for architecture ${ARCH_FOR_UNIT} (amd64 only)"; \
    fi \
    && dnf clean all

# Create non-root user for security (principle of least privilege)
# - UID 1000: Standard non-root user ID
# - appuser: Consistent with existing deployment configuration
RUN groupadd -r appuser && \
    useradd -r -g appuser -u 1000 appuser && \
    mkdir -p /app /home/appuser /app/unit

# Set working directory
WORKDIR /app

# Copy application artifacts from builder stage
# - .venv: Complete Python virtual environment with dependencies
# - src: Application source code
# - pyproject.toml: Project metadata (for reference)
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src
COPY --from=builder /app/pyproject.toml /app/
COPY unit-config.json /app/unit-config.json
COPY start-unit.sh /app/start-unit.sh

# Set ownership for non-root user
# Ensures appuser can read application files
RUN chown -R appuser:appuser /app /home/appuser && \
    chmod +x /app/start-unit.sh

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
    UV_CACHE_DIR="/tmp/.uv-cache" \
    UNIT_STATE_DIR="/app/unit" \
    UNIT_CONFIG_TEMPLATE="/app/unit-config.json" \
    UNIT_CONFIG_PATH="/app/unit/runtime-unit-config.json" \
    UNIT_CONTROL_SOCKET="/app/unit/control.sock" \
    USE_UNIT="auto"

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

# Start application with NGINX Unit (falls back to uvicorn if unavailable/disabled)
CMD ["/app/start-unit.sh"]
