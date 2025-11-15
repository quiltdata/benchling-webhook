# Issue #194: Rework Dockerfile

## Issue Context

**Note**: This document was created without direct access to GitHub issue #194. The context below is inferred from the current codebase analysis and branch name. Please verify against the actual issue and update as needed.

## Current Branch

- Branch: `194-rework-dockerfile`
- Status: Clean working directory
- Base: `main` branch

## Current Dockerfile Analysis

Location: `/Users/ernest/GitHub/benchling-webhook/docker/Dockerfile`

### Current Implementation

```dockerfile
FROM python:3.14-slim

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -u 1000 appuser

# Set working directory
WORKDIR /app

# Install system dependencies and uv
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

# Copy project files
COPY pyproject.toml uv.lock ./

# Install dependencies with uv
RUN uv sync --frozen --no-dev

# Copy application code
COPY src/ ./src/

# Create necessary directories and set permissions
RUN mkdir -p /home/appuser && \
    chown -R appuser:appuser /app /home/appuser

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Expose port
EXPOSE 5000

# Set environment variables
ENV FLASK_APP=src.app
ENV PYTHONPATH=/app

# Start the application
CMD ["uv", "run", "python", "-m", "src.app"]
```

## Potential Issues Identified

### 1. Python 3.14 Version

- Python 3.14 is not yet released (as of January 2025)
- CI workflow specifies Python 3.14 in `.github/workflows/ci.yaml`
- This may be a forward-looking choice or an error
- Project requirements in `docker/pyproject.toml` specify: `requires-python = ">=3.11"`
- Should verify the intended Python version

### 2. Dockerfile Optimization Opportunities

Based on Docker best practices, potential improvements:

#### Layer Optimization
- Multiple RUN commands could be consolidated
- apt-get update and install could be in fewer layers
- Installation of uv via pip could be optimized

#### Security Improvements
- Consider pinning uv version
- Consider using official uv installer instead of pip
- Verify USER switch timing

#### Build Efficiency
- Multi-stage builds not currently used
- Build cache optimization opportunities
- Consider using uv's direct install methods

#### Health Check
- Health check uses curl which is installed just for this purpose
- Could use Python-based health check instead

### 3. CI/CD Considerations

From `.github/workflows/ci.yaml`:
- CI uses `python:3.14` setup
- Uses official uv installer: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Docker builds for `linux/amd64` platform
- Images pushed to central ECR: `712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling`

## Inference: Likely Issue Scope

Based on the branch name "rework-dockerfile" and current implementation, issue #194 likely involves one or more of:

1. **Python version correction** - Fix Python 3.14 → 3.12 or 3.13 (released versions)
2. **Dockerfile optimization** - Improve build speed, layer caching, and image size
3. **Security enhancements** - Pin versions, use official installers, minimize attack surface
4. **Consistency** - Align Dockerfile with CI workflow patterns
5. **Best practices** - Apply current Docker/uv best practices

## Next Steps

1. Fetch actual GitHub issue #194 content using: `gh issue view 194`
2. Update this document with real issue requirements
3. Proceed with I RASP DECO workflow based on actual requirements

## Command to Fetch Issue

```bash
gh issue view 194 --json title,body,number,labels,assignees,milestone
```

---

**Generated**: 2025-11-06
**Status**: Awaiting issue verification
**Workflow Step**: Step 0 - Issue Context
