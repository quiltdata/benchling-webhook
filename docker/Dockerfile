# ============================================================================
# Benchling Webhook Docker Image - Multi-Stage Build
# ============================================================================
#
# This Dockerfile implements a multi-stage build using Amazon Linux 2023 as
# the base image. The builder stage compiles dependencies and the runtime
# stage provides a minimal production environment.
#
# Base Image: Amazon Linux 2023 (hash-pinned for reproducibility)
# Reference: https://github.com/quiltdata/benchling-webhook/issues/194
#
# Hash Verification:
#   docker pull public.ecr.aws/amazonlinux/amazonlinux:2023
#   docker inspect --format='{{index .RepoDigests 0}}' public.ecr.aws/amazonlinux/amazonlinux:2023
#
# To Update Hash:
#   1. Pull latest: docker pull public.ecr.aws/amazonlinux/amazonlinux:2023
#   2. Get digest: docker inspect --format='{{index .RepoDigests 0}}' <image>
#   3. Update FROM line below with new SHA256 hash
#
# ============================================================================

# ============================================================================
# BUILDER STAGE: Compile dependencies and create virtual environment
# ============================================================================
#
# This stage contains build tools, compilers, and uv package manager.
# It creates a complete Python virtual environment with all production
# dependencies compiled for Amazon Linux 2023.
#
FROM public.ecr.aws/amazonlinux/amazonlinux:2023@sha256:30fe896e1f3e2bad0c0e39a4803cfe0fd5c4e7e421e88b93c2f5ba6b9a3dba45 AS builder

# Install Python 3.11 and build dependencies
# - python3.11: Python interpreter
# - python3.11-devel: Headers needed for compiling native extensions
# - python3.11-pip: Package installer for Python
# - gcc: C compiler for native extensions (e.g., cryptography, lxml)
# - make: Build automation tool
RUN dnf install -y \
    python3.11 \
    python3.11-devel \
    python3.11-pip \
    gcc \
    make \
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
RUN . $HOME/.cargo/env && uv sync --frozen --no-dev

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
FROM public.ecr.aws/amazonlinux/amazonlinux:2023@sha256:30fe896e1f3e2bad0c0e39a4803cfe0fd5c4e7e421e88b93c2f5ba6b9a3dba45

# Install minimal runtime dependencies
# - python3.11: Python runtime (no -devel headers)
# - curl: Required for Docker HEALTHCHECK command
RUN dnf install -y \
    python3.11 \
    curl \
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

# Configure environment for Python execution
# - PATH: Prepend .venv/bin to activate virtual environment
#   This allows direct Python execution without uv wrapper
# - PYTHONPATH: Ensure Python can find application modules
# - FLASK_APP: Flask application entry point
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app" \
    FLASK_APP="src.app"

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
