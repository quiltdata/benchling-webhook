# npm vs Makefile Analysis: What Actually Works?

**Issue**: #156 - Requested top-level Makefile
**Question**: Do npm scripts already do everything we need?
**Last Updated**: 2025-11-02
**Status**: Analysis Complete

---

## TL;DR: No, npm Scripts Are Incomplete

**The npm scripts exist but DON'T actually run Python/Docker tests**

Key Finding: `package.json:45` shows:
```json
"test:python": "echo 'Python tests placeholder'"
```

This means `npm run test` does **NOT** run Python unit tests - it just echoes a placeholder!

---

## Issue #156 Requirements Mapped to npm Scripts

### 1. `make install` → Does npm do this?

**Required**:
- Install Node + Python dependencies
- Create XDG folder
- Interactive prompts for configuration
- Validate credentials
- Sync to AWS Secrets Manager

**npm scripts**:
```bash
npm install                  # ✅ Node deps only
npm run config:install       # ✅ Interactive wizard (XDG + validation + secrets)
```

**Docker**:
```bash
make -C docker install       # ✅ Python deps (uv sync)
```

**VERDICT**: ❌ npm does NOT install Python dependencies
**Solution Needed**: `npm run install` should call `make -C docker install`

---

### 2. `make test` → Does npm do this?

**Required**:
- Run linters (npm + Python)
- Execute unit tests (TypeScript + Python)
- Confirm code quality

**npm scripts**:
```json
"test": "npm run typecheck && npm run test-ts && npm run test:python",
"test:python": "echo 'Python tests placeholder'",  // ❌ PLACEHOLDER!
"lint": "eslint . --ext .ts --fix"                 // ✅ TS only
```

**Docker**:
```bash
make -C docker lint          # ✅ Python linting (black + isort)
make -C docker test-unit     # ✅ Python unit tests (pytest)
```

**VERDICT**: ❌ npm does NOT run Python tests or linting
**Current Behavior**:
- `npm run test` → TypeScript only + placeholder echo
- `npm run lint` → TypeScript only

**What Actually Happens**:
```bash
$ npm run test
> npm run typecheck && npm run test-ts && npm run test:python
✅ TypeScript typechecks pass
✅ Jest tests pass
❌ "Python tests placeholder" (NOTHING RUNS!)
```

**Solution Needed**:
```json
"test": "npm run typecheck && npm run test-ts && npm run docker-test-unit",
"test:python": "make -C docker test-unit",
"lint": "eslint . --ext .ts --fix && make -C docker lint"
```

---

### 3. `make test-local` → Does npm do this?

**Required**:
- Build local Docker image
- Pull credentials from AWS
- Run integration tests with REAL Benchling payloads

**npm scripts**:
```json
"docker-test": "make -C docker test"  // ✅ Calls Docker Makefile
```

**Docker**:
```bash
make -C docker test-local    # ✅ Full integration with auto-start server
```

**VERDICT**: ⚠️ npm has `docker-test` but it calls `make -C docker test` (not `test-local`)

**Current Behavior**:
```bash
$ npm run docker-test
> make -C docker test
Runs: lint + test-unit + test-integration
```

**Solution Needed**:
```json
"test:local": "make -C docker test-local"
```

---

### 4. `make test-remote` → Does npm do this?

**Required**:
- Build and push dev image to ECR
- Deploy dev CDK stack
- Run remote integration tests
- Validate secrets, IAM, networking

**npm scripts**:
```json
"release:dev": "npm run test && node bin/release.js dev",  // ✅ Dev release
"docker-check": "make -C docker docker-validate"          // ✅ Docker validation
```

**Docker**:
```bash
make -C docker test-ecr      # ✅ Test ECR image locally
```

**VERDICT**: ⚠️ Partial - `npm run release:dev` deploys but doesn't run remote tests

**Solution Needed**:
```json
"test:remote": "npm run release:dev && make -C docker test-ecr"
```

---

### 5. `make release` → Does npm do this?

**Required**:
- Run full test suite
- Promote verified image to production
- Generate deploy.json artifact

**npm scripts**:
```json
"release": "npm run test && node bin/release.js"  // ✅ Production release
```

**VERDICT**: ⚠️ Calls release script but doesn't push Docker image

**Current Behavior**:
- `npm run release` → Tests + CDK deploy
- Does NOT push Docker image to ECR with `latest` tag

**Solution Needed**:
```json
"release": "npm run test && node bin/release.js && make -C docker push-ci"
```

---

### 6. `make tag` → Does npm do this?

**Required**:
- Create version tag
- Push to git
- Tag Docker image

**npm scripts**:
```json
"version": "node bin/version.js patch",
"version:patch": "npm run version -- patch"
```

**VERDICT**: ⚠️ Versions npm package but doesn't tag Docker image

**Solution Needed**:
- Update `bin/version.js` to also tag Docker image
- Add git push logic

---

## Summary: What's Actually Missing?

### Critical Gaps

1. **`test:python` is a placeholder** (line 45)
   - Should be: `"test:python": "make -C docker test-unit"`

2. **`lint` doesn't run Python linting**
   - Should be: `"lint": "eslint . --ext .ts --fix && make -C docker lint"`

3. **`release` doesn't push Docker image**
   - Should be: `"release": "npm run test && node bin/release.js && make -C docker push-ci"`

4. **No Python dependency installation**
   - Should add: `"postinstall": "make -C docker install"`

---

## Issue #156: Makefile vs npm

### What Issue #156 Actually Said

> "Use Makefile for top-level orchestration (no environment config)
> Use npm for implementation scripts (which read from XDG)"

**Interpretation**:
- **Makefile** = User-facing commands (simple, no config)
- **npm** = Implementation details (TypeScript scripts that read XDG)

### Why Makefile Might Still Be Needed

**Pros of Makefile**:
1. ✅ Language-agnostic (works without Node installed)
2. ✅ Standard in Python/Docker projects
3. ✅ Simpler mental model (`make test` vs `npm run test`)
4. ✅ No package.json pollution

**Pros of npm**:
1. ✅ Already works for TypeScript developers
2. ✅ Can call `make -C docker` commands
3. ✅ Package.json is already there
4. ✅ `npx @quiltdata/benchling-webhook` entry point

---

## Recommendation: Hybrid Approach

### Option A: Fix npm Scripts (Minimal Change)

**Update package.json**:
```json
{
  "scripts": {
    "postinstall": "make -C docker install || echo 'Skipping Python deps'",
    "test": "npm run lint && npm run typecheck && npm run test-ts && npm run test:python",
    "test:python": "make -C docker test-unit",
    "test:local": "make -C docker test-local",
    "test:remote": "npm run release:dev && make -C docker test-ecr",
    "lint": "eslint . --ext .ts --fix && make -C docker lint",
    "release": "npm run test && node bin/release.js && make -C docker push-ci"
  }
}
```

**Pros**:
- ✅ Fixes all gaps
- ✅ Works with `npx` entry point
- ✅ No breaking changes

**Cons**:
- ❌ Still violates issue #156 intent (Makefile for orchestration)
- ❌ Harder to understand for Python developers
- ❌ Requires Node to run Python tests

---

### Option B: Top-Level Makefile (Issue #156 Intent)

**Create `/Makefile`**:
```makefile
.PHONY: install test test-local test-remote release tag

install:
	npm install
	npm run config:install

test:
	npm run lint
	make -C docker lint
	npm run typecheck
	npm run test-ts
	make -C docker test-unit

test-local:
	make -C docker test-local

test-remote:
	npm run release:dev
	make -C docker test-ecr

release:
	npm run release

tag:
	npm run version:patch
	git push --follow-tags
```

**Pros**:
- ✅ Follows issue #156 exactly
- ✅ Clear separation of concerns
- ✅ Works without Node (for Python devs)
- ✅ Standard cross-language tool

**Cons**:
- ❌ Adds another file to maintain
- ❌ Duplication with npm scripts

---

### Option C: Comprehensive (Both)

Keep both Makefile and npm scripts:
- **Makefile**: User-facing workflow (install, test, release)
- **npm scripts**: Implementation + `npx` entry point

**Example**:
```bash
# Developers using repo
make test              # Runs everything

# Users installing via npx
npx @quiltdata/benchling-webhook
npm run config:install
```

---

## Final Recommendation

**Option A (Fix npm scripts)** is sufficient IF:
- We update CLAUDE.md to document `npm run` commands
- We accept that Python deps require Docker Makefile

**Option B (Top-level Makefile)** is required IF:
- We want language-agnostic commands
- We want to follow issue #156 literally
- We want Python developers to test without Node

**Minimum Required Changes**:
1. Fix `test:python` placeholder → `"make -C docker test-unit"`
2. Update `lint` to include Python → `"eslint . --ext .ts --fix && make -C docker lint"`
3. Update CLAUDE.md workflow docs

---

## Document Control

**Version**: 1.0
**Author**: Configuration Team
**Status**: Final Analysis
**Recommendation**: Fix npm scripts (Option A) + Update CLAUDE.md
