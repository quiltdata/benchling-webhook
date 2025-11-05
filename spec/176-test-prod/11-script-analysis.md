# Script Directory Analysis

**Date:** 2025-11-04
**Author:** Analysis by Claude
**Status:** Analysis Complete

## Executive Summary

The current codebase has **three separate script directories** (`bin/`, `scripts/`, `docker/scripts/`) with **significant functional overlap and unclear boundaries**. This analysis identifies the purpose, usage, and redundancies across all three directories, and provides recommendations for consolidation.

**Key Findings:**
- `bin/` contains 17 TypeScript files (CLI commands + dev tools)
- `scripts/` contains 4 TypeScript files (setup/config utilities)
- `docker/scripts/` contains 7 Python files (test/development utilities)
- Multiple files serve similar purposes across directories
- No clear architectural rationale for the separation
- UX is entirely through npm scripts, making the directory structure an implementation detail

## Directory Inventory

### `bin/` Directory (17 files)

#### CLI Framework (3 files)
| File | Purpose | Used By | Lines |
|------|---------|---------|-------|
| `cli.ts` | Main CLI entry point (Commander.js) | `npm run deploy:prod`, npx users | 130 |
| `benchling-webhook.ts` | Legacy CLI (deprecated?) | Unknown | ? |
| `commands/` | Sub-command implementations | `cli.ts` | - |

#### Command Implementations (6 files)
| File | Purpose | Used By | Lines |
|------|---------|---------|-------|
| `commands/deploy.ts` | Production deployment logic | `cli.ts deploy` | 100+ |
| `commands/init.ts` | Initialize configuration | `cli.ts init` | ? |
| `commands/manifest.ts` | Generate Benchling manifest | `cli.ts manifest` | ? |
| `commands/setup-wizard.ts` | Setup wizard command | `cli.ts` (no args) | ? |
| `commands/test.ts` | Test deployed endpoint | `cli.ts test` | ? |
| `commands/validate.ts` | Validate configuration | `cli.ts validate` | ? |

#### Development Tools (8 files)
| File | Purpose | Used By | Lines |
|------|---------|---------|-------|
| `dev-deploy.ts` | Dev deployment workflow | `npm run deploy:dev` | 356 |
| `version.ts` | Version management + git tagging | `npm run version`, `npm run version:tag` | 323 |
| `check-logs.ts` | CloudWatch log viewer | `npm run deploy:logs` | 250 |
| `send-event.ts` | Send test events to deployed endpoints | Manual use | 225 |
| `publish.ts` | NPM publishing script | ? | ? |
| `create-secret.ts` | AWS Secrets Manager operations | ? | ? |
| `get-env.ts` | Environment variable helper | ? | ? |
| `config-profiles.ts` | Profile management | ? | ? |
| `test-invalid-signature.ts` | Test invalid webhook signatures | Development/testing | ? |

### `scripts/` Directory (4 files)

All files are **setup/configuration utilities** run via `ts-node`:

| File | Purpose | Used By | Lines |
|------|---------|---------|-------|
| `install-wizard.ts` | Interactive setup wizard | `npm run setup` | 789 |
| `sync-secrets.ts` | Sync config to AWS Secrets Manager | `npm run setup:sync-secrets` | 454 |
| `infer-quilt-config.ts` | Auto-infer Quilt stack config | `npm run setup:infer` | 385 |
| `config-health-check.ts` | Validate configuration health | `npm run setup:health` | 697 |

**Total:** 2,325 lines of setup code

### `docker/scripts/` Directory (7 Python files)

All files are **Python test/development utilities**:

| File | Purpose | Used By | Lines |
|------|---------|---------|-------|
| `run_local.py` | Local Flask dev server | `make run-local` | ~200 |
| `test_webhook.py` | Webhook integration tests | `make test-*` | ~200 |
| `test_integration.py` | Full integration test suite | `make test-integration` | ~300 |
| `test_benchling.py` | Test Benchling OAuth credentials | `make test-benchling` | ~350 |
| `test_query.py` | Test Quilt Athena queries | `make test-query` | ~200 |
| `docker.py` | Docker build/push utilities | `make push-*` | ~800 |
| `experiment_search_syntax.py` | Benchling search syntax helpers | Imported by other scripts | ~150 |

**Total:** ~2,200 lines of Python test/dev code

## Functional Analysis

### By Purpose

#### 1. **Setup & Configuration** (6 files across 2 directories)

**`scripts/` (4 TypeScript files):**
- `install-wizard.ts` - Interactive setup
- `sync-secrets.ts` - AWS Secrets sync
- `infer-quilt-config.ts` - Quilt config inference
- `config-health-check.ts` - Config validation

**`bin/commands/` (2 TypeScript files):**
- `init.ts` - Initialize config (overlaps with `install-wizard.ts`?)
- `validate.ts` - Validate config (overlaps with `config-health-check.ts`?)

**Redundancy:** Likely overlap between:
- `commands/init.ts` ↔ `install-wizard.ts`
- `commands/validate.ts` ↔ `config-health-check.ts`

#### 2. **Deployment** (3 files, 1 directory)

**`bin/`:**
- `commands/deploy.ts` - Production deployment (npx/CLI users)
- `dev-deploy.ts` - Dev deployment workflow (git tag → CI → deploy)

**Clear separation:** Production vs. dev deployment workflows

#### 3. **Testing** (7 files across 2 directories)

**`docker/scripts/` (Python):**
- `test_webhook.py` - Webhook tests
- `test_integration.py` - Integration tests
- `test_benchling.py` - Benchling OAuth tests
- `test_query.py` - Quilt query tests

**`bin/commands/`:**
- `test.ts` - Test deployed endpoint
- `send-event.ts` - Send test events

**`bin/`:**
- `test-invalid-signature.ts` - Signature validation tests

**Observation:** Testing is split by language (Python for app tests, TypeScript for deployment tests)

#### 4. **Development Tools** (3 files)

**`bin/`:**
- `check-logs.ts` - CloudWatch logs
- `version.ts` - Version management
- `config-profiles.ts` - Profile management

**`docker/scripts/`:**
- `run_local.py` - Local dev server
- `docker.py` - Docker utilities

**Clear separation:** TypeScript for AWS/CDK tools, Python for Flask app development

#### 5. **Infrastructure/Build** (1 file)

**`docker/scripts/`:**
- `docker.py` - Docker build/push (used by Makefile)

### By Language

| Directory | Language | Purpose | Lines of Code |
|-----------|----------|---------|---------------|
| `bin/` | TypeScript | CLI + dev tools + deployment | ~2,000+ |
| `scripts/` | TypeScript | Setup & configuration | ~2,325 |
| `docker/scripts/` | Python | Testing + Flask dev | ~2,200 |

## npm Script Mapping

### Setup Commands
```json
"setup": "ts-node scripts/install-wizard.ts",
"setup:health": "ts-node scripts/config-health-check.ts",
"setup:infer": "ts-node scripts/infer-quilt-config.ts",
"setup:sync-secrets": "ts-node scripts/sync-secrets.ts"
```
**All use `scripts/`**

### Deployment Commands
```json
"deploy:dev": "npm run test && ts-node bin/dev-deploy.ts",
"deploy:prod": "ts-node bin/cli.ts deploy",
"deploy:logs": "ts-node bin/check-logs.ts"
```
**All use `bin/`**

### Version Commands
```json
"version": "ts-node bin/version.ts",
"version:tag": "ts-node bin/version.ts tag",
"version:tag:dev": "ts-node bin/version.ts tag dev"
```
**All use `bin/`**

### Test Commands
```json
"test:local": "make -C docker test-local",
"test:dev": "make -C docker test-deployed-dev",
"test:prod": "make -C docker test-deployed-prod"
```
**All delegate to `docker/Makefile`, which uses `docker/scripts/`**

## Redundancy Analysis

### Confirmed Overlaps

1. **Setup/Initialization:**
   - `scripts/install-wizard.ts` (789 lines)
   - `bin/commands/init.ts` (unknown lines)
   - `bin/commands/setup-wizard.ts` (called when CLI has no args)
   - **Verdict:** Likely duplicated setup logic

2. **Configuration Validation:**
   - `scripts/config-health-check.ts` (697 lines)
   - `bin/commands/validate.ts` (unknown lines)
   - **Verdict:** Likely duplicated validation logic

3. **Test Event Sending:**
   - `bin/send-event.ts` (225 lines) - TypeScript, for deployed endpoints
   - `docker/scripts/test_webhook.py` (~200 lines) - Python, for any endpoint
   - **Verdict:** Different languages, similar purpose (Python is more comprehensive)

### Unclear Purpose Files

Files in `bin/` with unknown usage:
- `benchling-webhook.ts` - May be legacy/deprecated
- `publish.ts` - Publishing script (CI/CD only?)
- `create-secret.ts` - Secret creation (replaced by `sync-secrets.ts`?)
- `get-env.ts` - Environment helper (used where?)
- `config-profiles.ts` - Profile management (used where?)

## Architecture Issues

### 1. **No Clear Separation of Concerns**

The current split appears arbitrary:
- `bin/` = "compiled tools that ship with npm package"
- `scripts/` = "development-time setup scripts"
- `docker/scripts/` = "Python application scripts"

However:
- `bin/` contains both **publishable CLI commands** (`cli.ts`) and **development tools** (`dev-deploy.ts`, `check-logs.ts`)
- `scripts/` contains **interactive wizards** that could be CLI commands
- Functionality overlaps across boundaries

### 2. **Language Mixing Without Rationale**

- **TypeScript files** exist in both `bin/` and `scripts/`
- **Python files** are isolated to `docker/scripts/`
- No clear reason why setup is TypeScript but testing is Python (historical accident?)

### 3. **npm vs. Makefile Command Duplication**

- npm scripts call `ts-node bin/...` or `ts-node scripts/...`
- Makefile calls `uv run python scripts/...`
- Both orchestrate the same tools, creating parallel command surfaces

### 4. **Unclear Entry Points**

- `cli.ts` is the published CLI entry point
- `install-wizard.ts` is also an entry point (via npm script)
- Many `bin/` scripts are standalone entry points
- Result: 10+ different entry points with no unified interface

## Recommendations Summary

### Critical Issues to Address

1. **Consolidate setup/config logic** - Merge `commands/init.ts`, `commands/validate.ts`, and `scripts/*` files
2. **Clarify script directories** - Establish clear boundaries by function, not by build artifact
3. **Reduce entry points** - Unify through CLI or establish clear conventions
4. **Document "publishable vs. internal" distinction** - Users should know what's public API vs. internal

### Questions for Maintainability

1. Should `bin/` contain only **publishable CLI commands**?
2. Should `scripts/` contain only **development-time automation**?
3. Should setup be **CLI commands** or **npm scripts**?
4. What belongs in Python vs. TypeScript?

See [12-consolidation-proposal.md](./12-consolidation-proposal.md) for detailed recommendations.

## Appendix: Complete File Listing

### `bin/` Files
```
bin/
├── cli.ts                      # Main CLI (Commander.js)
├── benchling-webhook.ts        # Legacy CLI?
├── commands/
│   ├── deploy.ts               # Deploy command
│   ├── init.ts                 # Init command
│   ├── manifest.ts             # Manifest command
│   ├── setup-wizard.ts         # Setup wizard command
│   ├── test.ts                 # Test command
│   └── validate.ts             # Validate command
├── dev-deploy.ts               # Dev deployment workflow
├── version.ts                  # Version management
├── check-logs.ts               # CloudWatch logs
├── send-event.ts               # Send test events
├── publish.ts                  # NPM publishing
├── create-secret.ts            # Secret creation
├── get-env.ts                  # Environment helper
├── config-profiles.ts          # Profile management
└── test-invalid-signature.ts   # Signature tests
```

### `scripts/` Files
```
scripts/
├── install-wizard.ts           # Interactive setup (789 lines)
├── sync-secrets.ts             # AWS Secrets sync (454 lines)
├── infer-quilt-config.ts       # Quilt config inference (385 lines)
└── config-health-check.ts      # Config validation (697 lines)
```

### `docker/scripts/` Files
```
docker/scripts/
├── run_local.py                # Local Flask server (~200 lines)
├── test_webhook.py             # Webhook tests (~200 lines)
├── test_integration.py         # Integration tests (~300 lines)
├── test_benchling.py           # Benchling OAuth tests (~350 lines)
├── test_query.py               # Quilt query tests (~200 lines)
├── docker.py                   # Docker utilities (~800 lines)
└── experiment_search_syntax.py # Benchling helpers (~150 lines)
```
