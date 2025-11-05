# Script Consolidation Proposal

**Date:** 2025-11-04
**Status:** Proposal
**Breaking Changes:** Yes (internal only, npm scripts unchanged)

## Overview

This proposal recommends consolidating the current three-directory script structure (`bin/`, `scripts/`, `docker/scripts/`) into a clearer, more maintainable organization. The consolidation prioritizes:

1. **Clear functional boundaries** (not arbitrary historical splits)
2. **Single entry point per purpose** (CLI, setup, testing)
3. **Language-appropriate separation** (TypeScript for CDK/AWS, Python for Flask app)
4. **Backward compatibility** (all npm scripts continue to work)

## Problems Being Solved

1. **Unclear boundaries:** `bin/` vs `scripts/` separation is arbitrary
2. **Duplicate functionality:** Setup/validation logic exists in multiple places
3. **Too many entry points:** 10+ different ways to invoke scripts
4. **Confusion for contributors:** Where should new scripts go?
5. **Overlapping concerns:** CLI commands vs. npm scripts vs. Makefile targets

## Proposed Structure

### Option A: Consolidated by Function (RECOMMENDED)

```
tools/                          # All automation tools (replaces bin/ + scripts/)
├── cli.ts                      # Main CLI entry point (published as bin)
├── commands/                   # CLI command implementations
│   ├── deploy.ts
│   ├── init.ts                 # Merges scripts/install-wizard.ts
│   ├── validate.ts             # Merges scripts/config-health-check.ts
│   ├── manifest.ts
│   ├── test.ts
│   └── sync-secrets.ts         # Promoted from scripts/
├── dev/                        # Development-only tools (NOT published)
│   ├── dev-deploy.ts           # Dev deployment workflow
│   ├── version.ts              # Version management
│   ├── check-logs.ts           # CloudWatch logs
│   └── send-event.ts           # Test event sender
└── lib/                        # Shared utilities
    ├── config/                 # Config management (XDG, secrets, etc.)
    ├── deploy/                 # Deployment helpers
    └── testing/                # Test utilities

docker/scripts/                 # Python test/dev tools (unchanged)
├── run_local.py
├── test_webhook.py
├── test_integration.py
├── test_benchling.py
├── test_query.py
├── docker.py
└── experiment_search_syntax.py
```

**Key Changes:**
- Merge `bin/` + `scripts/` → `tools/`
- Separate **publishable CLI** (`tools/commands/`) from **dev tools** (`tools/dev/`)
- Keep Python scripts separate (language boundary)
- All functionality accessible via CLI or npm scripts (no orphaned scripts)

**Benefits:**
- Clear separation: CLI commands vs. dev tools
- Single TypeScript directory
- No duplicate setup/validation logic
- Contributors know where to put new tools

### Option B: Published vs. Internal

```
cli/                            # Published CLI (becomes npm bin)
├── index.ts                    # Entry point
├── commands/                   # User-facing commands
│   ├── deploy.ts
│   ├── init.ts
│   ├── validate.ts
│   ├── manifest.ts
│   └── test.ts
└── lib/                        # CLI implementation

dev-tools/                      # Internal development tools
├── dev-deploy.ts
├── version.ts
├── check-logs.ts
├── send-event.ts
├── sync-secrets.ts
├── infer-quilt-config.ts
└── config-health-check.ts

docker/scripts/                 # Python tools (unchanged)
```

**Key Changes:**
- Explicit split: published vs. internal
- `cli/` ships in npm package
- `dev-tools/` stays in repo only

**Benefits:**
- Very clear what's public API
- Easy to exclude dev-tools from npm package
- Forces thinking about "user-facing" vs. "maintainer-facing"

**Drawbacks:**
- More directories
- Dev tools are still TypeScript scripts, not CLI commands

### Option C: Unified CLI (Maximum Consolidation)

```
cli/                            # Everything is a CLI command
├── index.ts                    # Main entry point
└── commands/
    ├── deploy.ts               # npx benchling-webhook deploy
    ├── deploy-dev.ts           # npx benchling-webhook deploy-dev
    ├── init.ts                 # npx benchling-webhook init
    ├── validate.ts             # npx benchling-webhook validate
    ├── manifest.ts             # npx benchling-webhook manifest
    ├── test.ts                 # npx benchling-webhook test
    ├── logs.ts                 # npx benchling-webhook logs
    ├── send-event.ts           # npx benchling-webhook send-event
    ├── sync-secrets.ts         # npx benchling-webhook sync-secrets
    ├── version.ts              # npx benchling-webhook version
    └── health.ts               # npx benchling-webhook health

docker/scripts/                 # Python tools (unchanged)
```

**Key Changes:**
- Everything is a CLI subcommand
- No more `ts-node bin/...` or `ts-node scripts/...` in npm scripts
- Unified interface: `benchling-webhook <command>`

**Benefits:**
- Single entry point for all tools
- Discoverable via `--help`
- No npm scripts needed (except for Python tools)
- Consistent UX

**Drawbacks:**
- More work to implement
- Some commands are dev-only (but still accessible)
- Compiled CLI is larger

## Detailed Migration Plan

### Phase 1: Consolidate Setup/Config (Week 1)

**Goal:** Eliminate redundancy between `scripts/` and `bin/commands/`

#### 1.1 Merge Init/Setup Logic

```
BEFORE:
scripts/install-wizard.ts     (789 lines)
bin/commands/init.ts          (unknown lines)
bin/commands/setup-wizard.ts  (called by cli.ts when no args)

AFTER:
tools/commands/init.ts        (merged implementation)
```

**Actions:**
1. Compare `install-wizard.ts` and `commands/init.ts`
2. Identify unique functionality in each
3. Merge into single `init.ts` command
4. Update `cli.ts` to call unified `init` command when no args
5. Update `npm run setup` → `ts-node tools/commands/init.ts`

#### 1.2 Merge Validation Logic

```
BEFORE:
scripts/config-health-check.ts  (697 lines)
bin/commands/validate.ts        (unknown lines)

AFTER:
tools/commands/validate.ts      (merged implementation)
```

**Actions:**
1. Compare both validation implementations
2. Keep comprehensive checks from `config-health-check.ts`
3. Merge into single `validate.ts` command
4. Update `npm run setup:health` → `ts-node tools/commands/validate.ts`

#### 1.3 Move Remaining Scripts

```
BEFORE:
scripts/sync-secrets.ts
scripts/infer-quilt-config.ts

AFTER:
tools/commands/sync-secrets.ts
tools/lib/config/infer-quilt-config.ts  (becomes internal lib)
```

**Actions:**
1. Move `sync-secrets.ts` to `tools/commands/` (it's a command)
2. Move `infer-quilt-config.ts` to `tools/lib/config/` (it's imported by init)
3. Update npm scripts
4. Delete `scripts/` directory

### Phase 2: Reorganize Dev Tools (Week 2)

**Goal:** Separate publishable CLI from dev-only tools

#### 2.1 Create Directory Structure

```
mkdir -p tools/commands tools/dev tools/lib
mv bin/cli.ts tools/
mv bin/commands/* tools/commands/
```

#### 2.2 Move Dev-Only Tools

```
BEFORE:
bin/dev-deploy.ts
bin/version.ts
bin/check-logs.ts
bin/send-event.ts
bin/check-webhook-verification.ts

AFTER:
tools/dev/deploy-dev.ts
tools/dev/version.ts
tools/dev/logs.ts
tools/dev/send-event.ts
tools/dev/check-webhook-verification.ts
```

**Actions:**
1. Move files to `tools/dev/`
2. Update npm scripts:
   - `deploy:dev` → `ts-node tools/dev/deploy-dev.ts`
   - `version` → `ts-node tools/dev/version.ts`
   - `deploy:logs` → `ts-node tools/dev/logs.ts`
3. Update package.json `bin` field → `./dist/tools/cli.js`

#### 2.3 Clean Up Unclear Files

Investigate and handle:
- `bin/benchling-webhook.ts` → Delete if legacy
- `bin/publish.ts` → Move to `.github/workflows/` if CI-only
- `bin/create-secret.ts` → Delete (replaced by sync-secrets)
- `bin/get-env.ts` → Move to `tools/lib/` or delete
- `bin/config-profiles.ts` → Move to `tools/lib/config/` or delete

#### 2.4 Delete `bin/` Directory

Once all files are moved, delete `bin/`

### Phase 3: Update Documentation (Week 2)

#### 3.1 Update CLAUDE.md

```markdown
## Code Organization

### TypeScript Tools & CLI

#### `tools/` — All TypeScript automation (replaces bin/ + scripts/)

- [tools/cli.ts](tools/cli.ts) - Main CLI entry point (`npx @quiltdata/benchling-webhook`)
- [tools/commands/](tools/commands/) - CLI command implementations (published)
- [tools/dev/](tools/dev/) - Development-only tools (not published)
- [tools/lib/](tools/lib/) - Shared utilities

#### `docker/scripts/` — Python test & development tools

- [docker/scripts/run_local.py](docker/scripts/run_local.py) - Local Flask dev server
- [docker/scripts/test_*.py](docker/scripts/) - Test suites
- [docker/scripts/docker.py](docker/scripts/docker.py) - Docker utilities
```

#### 3.2 Update README.md

Update any references to `bin/` or `scripts/` directories

#### 3.3 Create Migration Guide

For contributors with open PRs that touch `bin/` or `scripts/`

### Phase 4: Optional Enhancements

These are **optional** and can be done later:

#### 4.1 Unify Dev Tools as CLI Commands

Convert dev tools to CLI subcommands:
```bash
# BEFORE
npm run deploy:dev
npm run version:tag
npm run deploy:logs

# AFTER
npx benchling-webhook deploy-dev
npx benchling-webhook version tag
npx benchling-webhook logs
```

#### 4.2 Python CLI Wrapper

Create a Python CLI for Docker scripts:
```bash
# BEFORE
make test-local
make test-benchling

# AFTER
python -m benchling_webhook test-local
python -m benchling_webhook test-benchling
```

## Migration Checklist

### Pre-Migration
- [ ] Audit all files in `bin/`, `scripts/`, `docker/scripts/`
- [ ] Identify all callers (npm scripts, Makefile, CI/CD)
- [ ] Create test suite for npm scripts (ensure backward compatibility)

### Phase 1: Setup/Config Consolidation
- [ ] Compare `install-wizard.ts` vs. `commands/init.ts`
- [ ] Merge into unified `tools/commands/init.ts`
- [ ] Compare `config-health-check.ts` vs. `commands/validate.ts`
- [ ] Merge into unified `tools/commands/validate.ts`
- [ ] Move `sync-secrets.ts` → `tools/commands/`
- [ ] Move `infer-quilt-config.ts` → `tools/lib/config/`
- [ ] Update npm scripts to use new paths
- [ ] Test all `npm run setup*` commands
- [ ] Delete `scripts/` directory

### Phase 2: Dev Tools Reorganization
- [ ] Create `tools/commands/`, `tools/dev/`, `tools/lib/`
- [ ] Move `cli.ts` → `tools/cli.ts`
- [ ] Move `commands/*` → `tools/commands/`
- [ ] Move dev tools → `tools/dev/`
- [ ] Update package.json `bin` field
- [ ] Update npm scripts to use new paths
- [ ] Test all `npm run` commands
- [ ] Delete `bin/` directory

### Phase 3: Documentation
- [ ] Update CLAUDE.md
- [ ] Update README.md
- [ ] Create migration guide for contributors
- [ ] Update GitHub PR templates (if any)

### Post-Migration
- [ ] Run full test suite
- [ ] Test npm package build (`npm run build`)
- [ ] Test CLI installation (`npx @quiltdata/benchling-webhook`)
- [ ] Test all npm scripts
- [ ] Update CHANGELOG.md

## Backward Compatibility

### What Stays The Same

All user-facing interfaces remain unchanged:

```bash
# npm scripts (unchanged)
npm run setup
npm run setup:health
npm run setup:infer
npm run setup:sync-secrets
npm run deploy:dev
npm run deploy:prod
npm run version
npm run version:tag

# npx CLI (unchanged)
npx @quiltdata/benchling-webhook deploy
npx @quiltdata/benchling-webhook init
npx @quiltdata/benchling-webhook validate

# Makefile (unchanged)
make test-local
make test-integration
make run-dev
```

### What Changes (Internal Only)

Only the file paths change:

```bash
# BEFORE
ts-node scripts/install-wizard.ts
ts-node bin/dev-deploy.ts

# AFTER
ts-node tools/commands/init.ts
ts-node tools/dev/deploy-dev.ts
```

Users never call these directly, so it's not a breaking change.

## Risk Assessment

### Low Risk
- Moving files (automated with git mv)
- Updating npm script paths
- Documentation updates

### Medium Risk
- Merging `init.ts` and `install-wizard.ts` (may have subtle differences)
- Merging `validate.ts` and `config-health-check.ts` (may have subtle differences)
- Updating package.json `bin` field (test with `npm link`)

### High Risk
- Deleting files without confirming all callers are updated
- Breaking CI/CD pipelines that directly reference paths

### Mitigation Strategies

1. **Create comprehensive test suite** for npm scripts before migration
2. **Audit all callers** (grep for `bin/`, `scripts/` in codebase)
3. **Gradual rollout:** Phase 1 → test → Phase 2 → test
4. **Keep old structure temporarily** (don't delete directories immediately)
5. **Test npm package build** after each phase

## Success Criteria

### Immediate (Post-Migration)
- ✅ All npm scripts work unchanged
- ✅ All Makefile targets work unchanged
- ✅ `npx @quiltdata/benchling-webhook` CLI works unchanged
- ✅ npm package builds successfully
- ✅ No duplicate setup/validation logic

### Long-Term (After 1 Month)
- ✅ New contributors can easily find where to add scripts
- ✅ No confusion about `bin/` vs `scripts/` directory purpose
- ✅ Codebase is easier to navigate
- ✅ Fewer "where should this file go?" questions in PRs

## Recommendation

**Implement Option A (Consolidated by Function) in 2 phases:**

1. **Phase 1 (Week 1):** Consolidate setup/config logic (eliminate `scripts/` directory)
2. **Phase 2 (Week 2):** Reorganize dev tools (eliminate `bin/` directory, create `tools/`)

**Do NOT implement Phase 4 (optional enhancements) immediately.** Stabilize the new structure first.

**Timeline:** 2 weeks for core consolidation + 1 week for documentation and testing

## Open Questions

1. **What is `bin/benchling-webhook.ts`?** Is it legacy? Can we delete it?
2. **Is `bin/publish.ts` used?** Should it be in CI/CD workflows instead?
3. **Should dev tools be CLI commands or npm scripts?** (Current: npm scripts)
4. **Should we version this as a major bump?** (Probably not, since UX is unchanged)

## Next Steps

1. Review this proposal with maintainers
2. Answer open questions
3. Create GitHub issue for tracking
4. Execute Phase 1 migration
5. Test and stabilize
6. Execute Phase 2 migration
7. Update documentation

---

**End of Proposal**
