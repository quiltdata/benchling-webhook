# npm Scripts Implementation Summary

**Issue**: #156 - Fix npm scripts to orchestrate all tests
**Date**: 2025-11-02
**Status**: PARTIAL - npm scripts fixed, Docker Makefile still needs XDG/Secrets Manager integration

---

## What Was Done ✅

### 1. Fixed npm Scripts in package.json

**Line 35**: `lint` - Now runs BOTH TypeScript and Python linting
```json
"lint": "eslint . --ext .ts --fix && make -C docker lint"
```

**Line 40**: `release` - Now pushes Docker image after release
```json
"release": "npm run test && node bin/release.js && make -C docker push-ci"
```

**Line 45**: `test:python` - Replaced placeholder with real Python unit tests
```json
"test:python": "make -C docker test-unit"
```

**Line 46**: `test:local` - NEW - Build and test local ARM Docker
```json
"test:local": "make -C docker build && make -C docker test-local"
```

**Line 47**: `test:remote` - NEW - Deploy dev stack and test ECR image
```json
"test:remote": "npm run release:dev && make -C docker test-ecr"
```

### 2. Verified Tests Work

✅ **Unit Tests**: All 264 Python tests pass
```bash
$ npm run test:python
============================= test session starts ==============================
...
======================= 264 passed, 4 warnings in 23.15s =======================
```

✅ **Full Test Suite**: TypeScript + Python tests pass
```bash
$ npm run test
> npm run typecheck && npm run test-ts && npm run test:python
✅ All tests pass
```

---

## What Still Needs to Be Done ❌

### Critical Issue: Docker Makefile Uses `.env` Instead of XDG + Secrets Manager

**The Problem**:
- Issue #156 requirement: "pulls credentials from AWS Secrets Manager"
- Current Docker Makefile: Still reads from `.env` file
- This violates the core principle of moving away from `.env` to XDG config

**Example from docker/Makefile:78**:
```makefile
check-env:
	@if [ ! -f ../.env ]; then \
		cp ../env.template ../.env; \
```

**Example from docker/Makefile:104**:
```makefile
test-benchling: check-env
	uv run python scripts/test_benchling.py
```

### What Needs to Happen

#### 1. Docker Makefile Must Read from XDG Config

**Current Flow** (WRONG):
```
npm run test:local
  → make -C docker test-local
    → check-env (looks for .env)
      → Fails if .env doesn't exist
```

**Required Flow** (CORRECT):
```
npm run test:local
  → make -C docker test-local
    → Read ~/.config/benchling-webhook/default.json
      → Extract BenchlingSecretArn
      → Pull actual secrets from AWS Secrets Manager at runtime
      → Run integration tests with real credentials
```

#### 2. Update Docker Makefile Targets

**Targets that need XDG integration**:
- `check-env` → Should check XDG config exists, not `.env`
- `test-local` → Should pass XDG config path to Python
- `test-integration` → Should read secrets from AWS Secrets Manager
- `test-benchling` → Should use Secrets Manager credentials
- `run-dev` → Should mount XDG config into Docker container

**Example of what needs to change**:
```makefile
# BEFORE (current - WRONG)
check-env:
	@if [ ! -f ../.env ]; then \
		cp ../env.template ../.env; \
		exit 1; \
	fi

# AFTER (required - CORRECT)
check-xdg:
	@if [ ! -f ~/.config/benchling-webhook/default.json ]; then \
		echo "❌ XDG config not found. Run: npm run config:install"; \
		exit 1; \
	fi
```

#### 3. Python Scripts Must Read from XDG

**Files that need updates**:
- `docker/scripts/test_integration.py` - Read config from XDG
- `docker/scripts/test_benchling.py` - Use Secrets Manager
- `docker/scripts/run_local.py` - Remove mock mode, use real config
- `docker/src/config.py` - Already supports Secrets Manager ✅

**Example pattern needed**:
```python
import json
from pathlib import Path

def load_xdg_config():
    config_path = Path.home() / ".config" / "benchling-webhook" / "default.json"
    if not config_path.exists():
        raise FileNotFoundError(
            "XDG config not found. Run: npm run config:install"
        )
    return json.loads(config_path.read_text())

def get_secrets_from_aws(secret_arn):
    # Use boto3 to fetch from Secrets Manager
    client = boto3.client('secretsmanager')
    response = client.get_secret_value(SecretId=secret_arn)
    return json.loads(response['SecretString'])
```

---

## Testing Requirements from Spec

### AC3: Testing Tiers (from spec/156c-secrets-config/01-requirements.md:101-103)

**1. `npm run test`** ✅ DONE
- Runs TypeScript linters
- Runs Python linters
- Runs mocked unit tests (no external dependencies)

**2. `npm run test:local`** ⚠️ INCOMPLETE
- ✅ Builds Docker image
- ❌ Should pull credentials from AWS Secrets Manager (currently uses .env)
- ❌ Should run Flask webhook with real Benchling payloads

**3. `npm run test:remote`** ⚠️ INCOMPLETE
- ❌ Should build dev Docker image
- ❌ Should push to ECR
- ❌ Should deploy dev stack
- ❌ Should execute remote integration tests

---

## User Workflow (How It Should Work)

### Step 1: Install and Configure
```bash
npm install
npm run config:install  # Creates ~/.config/benchling-webhook/default.json
                        # Prompts for Benchling credentials
                        # Syncs to AWS Secrets Manager
                        # Stores SecretArn in XDG config
```

### Step 2: Run Tests
```bash
# Unit tests (no AWS needed)
npm run test

# Local Docker integration (reads from Secrets Manager)
npm run test:local

# Remote stack integration (CI only)
npm run test:remote
```

### Step 3: Deploy
```bash
npm run release  # Deploys production stack
```

---

## Action Items

### HIGH PRIORITY (Blocking Issue #156 completion)

1. **Update Docker Makefile** - Replace `.env` checks with XDG config checks
2. **Update Python test scripts** - Read from XDG config + Secrets Manager
3. **Remove `run_local.py` mock mode** - Use real Secrets Manager
4. **Document XDG requirement** - Update CLAUDE.md with new workflow

### MEDIUM PRIORITY (Nice to have)

5. **Fix TypeScript lint errors** - Clean up unused variables
6. **Add `postinstall` hook** - Auto-run `make -C docker install`
7. **Update CLAUDE.md** - Document new npm scripts

### LOW PRIORITY (Future)

8. **Create top-level Makefile** - Optional wrapper for non-Node users
9. **Add GitHub Actions workflow** - Test all three tiers in CI
10. **Version tagging** - Implement `npm run tag` properly

---

## Summary

**What Works**:
- ✅ npm scripts correctly orchestrate TypeScript + Python
- ✅ Unit tests (mocked, no external deps) work perfectly
- ✅ XDG configuration infrastructure exists
- ✅ Secrets Manager integration exists in Python code

**What's Broken**:
- ❌ Docker Makefile still uses `.env` instead of XDG
- ❌ `test:local` and `test:remote` can't run without `.env`
- ❌ Integration tests don't use Secrets Manager

**Root Cause**:
The npm layer (Node/TypeScript) has been updated for XDG + Secrets Manager, but the Docker layer (Python/Makefile) hasn't been updated yet. They're out of sync.

**Fix Required**:
Update Docker Makefile and Python test scripts to read from XDG config and pull secrets from AWS Secrets Manager instead of reading from `.env` files.

---

## Document Control

**Version**: 1.0
**Author**: Configuration Team
**Status**: Implementation In Progress
**Next Steps**: Update Docker Makefile for XDG + Secrets Manager
