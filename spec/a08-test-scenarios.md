# Test Scenarios Specification

**Status:** Active
**Version:** 0.10.0
**Last Updated:** 2025-12-24

## Overview

This specification documents the comprehensive test infrastructure across TypeScript (CDK/CLI) and Python (FastAPI webhook processor). Tests are organized into multiple layers and execution modes to support different development workflows.

## Quick Reference

### Test Execution Matrix

| Test Command | TS | Py | Docker | AWS | CI Dep | Duration | Use Case |
|--------------|----|----|--------|-----|--------|----------|----------|
| `npm run test:unit` | ✅ | ❌ | ❌ | ❌ | ❌ | ~10s | Fast pre-commit |
| `npm run test:python` | ❌ | ✅ | ❌ | ❌ | ❌ | ~5s | Python unit tests |
| `npm test` | ✅ | ✅ | ❌ | ❌ | ❌ | ~20s | Full pre-commit |
| `npm run test:ci` | ✅ | ❌ | ❌ | ❌ | ❌ | ~15s | CI pipeline |
| `npm run test:integration` | ✅ | ❌ | ❌ | ✅ | ❌ | ~2m | TypeScript e2e |
| `make test-integration` | ❌ | ✅ | ✅ | ✅ | ❌ | ~3m | Python e2e |
| `npm run test:native` | ❌ | ✅ | ❌ | ✅ | ❌ | ~30s | Fast iteration |
| `npm run test:local` | ❌ | ✅ | ✅ | ✅ | ❌ | ~45s | Docker dev |
| `npm run test:local:prod` | ❌ | ✅ | ✅ | ✅ | ❌ | ~60s | Docker prod |
| `npm run test:dev` | ❌ | ✅ | ❌ | ✅ | ✅ | ~5m | Deploy + test |
| `npm run test:prod` | ❌ | ✅ | ❌ | ✅ | ✅ | ~10s | Health only |
| `make test-ecr` | ❌ | ✅ | ✅ | ✅ | ✅ | ~90s | ECR validation |

**Legend:** CI Dep = Requires CI to have built Docker image

### Common Workflows

```bash
# Pre-commit (fast)
npm run test:unit && npm run test:python

# Pre-commit (thorough)
npm test

# PR validation
npm test && npm run test:integration && npm run test:local

# Pre-release (requires CI build)
npm test && npm run test:integration && npm run test:local:prod && npm run test:dev
```

## Critical Dependencies

### Docker Image Build Chain

**IMPORTANT:** All deployments pull from a **centralized ECR repository**:

- ECR Account: `712023778557` (quiltdata AWS account)
- ECR Region: `us-east-1`
- Repository: `quiltdata/benchling`
- Full URI: `712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:latest`

This is **HARDCODED** in:

- [lib/benchling-webhook-stack.ts:230-233](lib/benchling-webhook-stack.ts#L230-L233)
- [bin/commands/deploy.ts:568-571](bin/commands/deploy.ts#L568-L571)

### CI/CD Build Pipeline

```text
Git Tag → CI Build → ECR Push → Local Deploy → Test
```

**Detailed Flow:**

1. **Create Git Tag** (triggers CI build)

   ```bash
   npm run version:tag:dev
   # Creates tag: v0.10.0-{timestamp}Z
   ```

2. **CI Workflow** (`.github/workflows/prod.yml`)
   - Triggered by: Push to `main` branch when `docker/**` files change
   - Builds Docker image (linux/amd64)
   - Pushes TWO tags to ECR:
     - `{git-sha}` (immutable)
     - `latest` (mutable)
   - Validates image architecture
   - Tests degraded startup

3. **Local Deployment** (depends on CI)

   ```bash
   npm run deploy:dev -- --profile default
   # Pulls from: 712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:latest
   ```

4. **Test Deployed Stack**

   ```bash
   npm run test:dev
   # Tests the deployed infrastructure
   ```

### Cross-Tool Dependencies (npm ↔ Makefile)

The test infrastructure spans both npm scripts and Makefile targets:

```text
npm (TypeScript/Node)  ↔  Makefile (Python/Docker)
─────────────────────────────────────────────────
npm test               →  make -C docker test-unit
npm run test:python    →  make -C docker test-unit
npm run test:local     →  xdg-launch (Docker build) → webhook tests
npm run test:native    →  xdg-launch (native) → make test-native
npm run test:dev       →  make -C docker test-deployed-dev
npm run test:prod      →  make -C docker test-deployed-prod
```

**Key Circular Dependencies:**

- `make test-native` → `npm run test:native` → `xdg-launch.ts` → `make kill`
- `make test-deployed-dev` → May trigger `npm run deploy:dev` → Uses CDK (TypeScript)

### Makefile Internal Dependencies

```text
test-integration
├── test-benchling (validates Benchling credentials)
└── docker-compose up -d app-dev
    └── scripts/test_integration.py

test-deployed-dev
├── check-xdg (validates profile config exists)
├── Auto-deploy logic (if sources newer than deployment)
│   └── cd .. && npm run deploy:dev
└── test-deployed-dev-direct
    └── scripts/test_webhook.py (health checks only)

test-deployed-prod
├── check-xdg
└── scripts/test_webhook.py (health checks only)

test-ecr
├── check-xdg
├── docker-ecr-login (AWS authentication)
├── run-ecr (pull and start container)
└── scripts/test_webhook.py
```

## Test Categories

### Unit Tests (No External Dependencies)

**TypeScript Unit Tests:**

```bash
npm run test:unit                          # All TypeScript tests (excludes integration/)
npx jest test/lib/config-loader.test.ts   # Specific test file
```

- **Coverage:** Configuration, stack transforms, deployment state, CLI parsing, utilities
- **Runs:** Jest with 50% CPU cores, excludes `test/integration/`
- **When:** Pre-commit, rapid iteration, CI pipeline

**Python Unit Tests:**

```bash
npm run test:python                        # Via npm
cd docker && make test-unit                # Via Makefile
```

- **Coverage:** Webhook validation, HMAC signatures, Benchling API, S3 operations, config
- **Runs:** `uv run --group dev pytest -v`
- **When:** Pre-commit, Python-only changes

### Integration Tests (Real Infrastructure)

**TypeScript Integration Tests:**

```bash
npm run test:integration                   # Full suite
npm run test:integration:verbose           # With verbose output
```

- **Coverage:** Full deployment lifecycle, multi-profile config, stack operations, AWS integration
- **Runs:** Jest sequentially (`--runInBand`), matches `test/integration/**/*.test.ts`
- **Requirements:** AWS credentials
- **When:** Before merging PRs, after config changes (~2-5 minutes)

**Python Integration Tests:**

```bash
cd docker && make test-integration
```

- **Coverage:** Real webhook processing, Benchling API, S3 packages, end-to-end flow
- **Requirements:**
  - Benchling OAuth credentials in Secrets Manager
  - `BENCHLING_TEST_ENTRY` environment variable
  - Docker daemon
- **When:** Before merging PRs, validating real integrations (~3 minutes)

### Local Development Tests

**Native FastAPI (No Docker):**

```bash
npm run test:native                        # Via npm (recommended)
cd docker && make test-native PROFILE=dev  # Via Makefile
```

- **Port:** 8080
- **When:** Fastest iteration, Python-only changes, debugging with breakpoints (~30s)

**Docker Dev (Hot-Reload):**

```bash
npm run test:local                         # Via npm (recommended)
cd docker && make test-docker-dev          # Via Makefile
```

- **Port:** 8082
- **Features:** Volume mounts, dev dependencies, fast rebuilds
- **When:** Docker-specific behavior, Dockerfile changes, pre-push (~45s)

**Docker Production:**

```bash
npm run test:local:prod                    # Via npm (recommended)
cd docker && make test-docker-prod         # Via Makefile
```

- **Port:** 8083
- **Features:** Production optimizations, Gunicorn, multi-stage build
- **When:** Production behavior validation, performance testing (~60s)

### Deployment Tests (CI Build Required)

**Test Dev Deployment:**

```bash
npm run test:dev                           # Via npm (recommended)
cd docker && make test-deployed-dev        # Via Makefile
```

- **Auto-Deploy Logic:** Deploys if no deployment exists OR Python sources newer than deployment
- **Skip Auto-Deploy:** `SKIP_AUTO_DEPLOY=1 make test-deployed-dev`
- **When:** Validating dev environment, after infrastructure changes (~5m)

**Test Prod Deployment:**

```bash
npm run test:prod                          # Via npm (recommended)
cd docker && make test-deployed-prod       # Via Makefile
```

- **Safety:** Health checks only (non-invasive), no auto-deployment
- **When:** Post-deployment validation, release verification (~10s)

**Test ECR Image:**

```bash
cd docker && make test-ecr
```

- **Flow:** Login → Pull from ECR → Run container → Test → Cleanup
- **When:** Validating published images, testing without local build (~90s)

### Specialized Tests

**Degraded Startup Test:**

```bash
npm run test:no-secret
cd docker && make test-no-secret
```

- **Purpose:** Validates graceful degradation when Benchling secret is missing
- **Tests:** Health endpoints (200 with warnings), webhook endpoint (503 with error)
- **When:** After secret management changes, validating error handling

**Benchling Credentials Test:**

```bash
cd docker && make test-benchling
```

- **Purpose:** Validates OAuth credentials in Secrets Manager
- **When:** After credential rotation, troubleshooting 401/403 errors

**Quilt Package Query Test:**

```bash
cd docker && make test-query
```

- **Purpose:** Tests Athena query execution and S3 package retrieval
- **When:** After Athena/S3 config changes, troubleshooting query errors

**Minimal Smoke Test:**

```bash
npm run test:minimal
```

- **Purpose:** Quick sanity check with subset of critical tests
- **When:** Pre-commit hooks, rapid iteration (<30s)

## Configuration Files

### Jest (package.json)

```json
{
  "test": "npm run lint && npm run build:typecheck && npm run test:ts && npm run test:python",
  "test:unit": "jest --testPathIgnorePatterns='/test/integration/' --maxWorkers=50%",
  "test:integration": "jest --testMatch='**/test/integration/**/*.test.ts' --runInBand"
}
```

### Pytest (docker/pyproject.toml)

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = [
    "unit: Unit tests",
    "integration: Integration tests",
    "slow: Slow running tests",
    "local: Tests that require AWS access"
]
```

### Makefile Targets (docker/Makefile)

- **Unit:** `test-unit` (pytest)
- **Integration:** `test-integration` (requires Benchling creds)
- **Deployment:** `test-deployed-dev`, `test-deployed-prod`
- **Local:** `test-native`, `test-docker-dev`, `test-docker-prod`
- **Specialized:** `test-no-secret`, `test-benchling`, `test-query`, `test-ecr`

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `No profile found` | Missing config | `npm run setup` |
| `403 Forbidden` | Invalid credentials | `make test-benchling` |
| `Connection refused` | Server not running | Check Docker/process: `docker ps` |
| `Timeout waiting for health` | Container failed | Check logs: `docker logs {container}` |
| `ECR authentication failed` | AWS credentials expired | Re-authenticate: `aws sso login` |
| `No dev endpoint found` | Stack not deployed | `npm run deploy:dev` |
| `Image not found in ECR` | CI hasn't run | Create git tag: `npm run version:tag:dev` |

## Performance Tips

1. **Parallel Execution:** Use `npm run test:unit` for faster feedback than full `npm test`
2. **Incremental Testing:** Use `npm run test:native` for Python-only changes (no Docker build)
3. **Skip Auto-Deploy:** Use `SKIP_AUTO_DEPLOY=1` when testing repeatedly against dev
4. **Docker Layer Caching:** Subsequent Docker builds are much faster due to layer caching

## Related Documentation

- [a01-config.md](a01-config.md) - Profile and configuration management
- [a02-agents.md](a02-agents.md) - Agent architecture and implementation
- [a05-deploy.md](a05-deploy.md) - Deployment process and workflows
- [a07-monitoring.md](a07-monitoring.md) - Observability and logging
