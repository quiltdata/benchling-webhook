# Script Consolidation - Revised Proposal

**Date:** 2025-11-04
**Status:** Revised based on team discussion
**Breaking Changes:** None (internal refactoring only)

---

## The Simple Vision

**`bin/` = User-facing CLI (published)**
**`scripts/` = Developer tools (not published)**
**`docker/scripts/` = Python application tools (separate domain)**

This is what it should have been all along.

---

## Current Mess

```
bin/                        # Mixed bag: CLI + dev tools
├── cli.ts                  ✅ CLI entry point
├── commands/
│   ├── deploy.ts           ✅ CLI command
│   ├── init.ts             ❓ Unknown purpose
│   ├── setup-wizard.ts     ✅ Thin wrapper → scripts/install-wizard.ts
│   └── validate.ts         ❓ Unknown purpose
├── dev-deploy.ts           ❌ Dev tool (wrong location)
├── version.ts              ❌ Dev tool (wrong location)
├── check-logs.ts           ❌ Dev tool (wrong location)
└── send-event.ts           ❌ Dev tool (wrong location)

scripts/                    # Setup utilities
├── install-wizard.ts       ✅ Real implementation (789 lines)
├── config-health-check.ts  ✅ Real implementation (697 lines)
├── sync-secrets.ts         ✅ Real implementation (454 lines)
└── infer-quilt-config.ts   ✅ Real implementation (385 lines)

docker/scripts/             # Python tools
└── ...                     ✅ Clear separation (language boundary)
```

**Problems:**
1. **CLI is incomplete** - setup logic lives in `scripts/`, not `bin/commands/`
2. **Dev tools in wrong place** - `bin/` contains non-CLI tools
3. **Duplicate entry points** - Both `npm run setup` and CLI run setup, but differently
4. **Poor testing** - Developers don't use the CLI they ship to users

---

## The Fix

### Principle 1: Developers Should Use What Users Use

```bash
# BEFORE
npm run setup  →  ts-node scripts/install-wizard.ts  (bypass CLI)

# AFTER
npm run setup  →  node dist/bin/cli.js  (use actual CLI)
```

**Benefits:**
- ✅ Developers test the real CLI
- ✅ Same UX for developers and users
- ✅ Fewer code paths to maintain
- ✅ Bugs are caught earlier

### Principle 2: Clear Separation of Concerns

```
bin/                        # Published CLI (users install this)
├── cli.ts                  # Entry point
└── commands/               # All CLI commands
    ├── setup-wizard.ts     # ← Merge install-wizard.ts here
    ├── deploy.ts           # Production deployment
    ├── validate.ts         # ← Merge config-health-check.ts here
    ├── sync-secrets.ts     # ← Move from scripts/
    └── ...

scripts/                    # Dev tools (NOT published)
├── dev-deploy.ts           # ← Move from bin/
├── version.ts              # ← Move from bin/
├── check-logs.ts           # ← Move from bin/
└── send-event.ts           # ← Move from bin/

docker/scripts/             # Python tools (unchanged)
```

**What ships in npm package:**
```
dist/
└── bin/                    # Only this directory ships
    ├── cli.js
    └── commands/
```

**What stays in repo only:**
```
dist/
└── scripts/                # Excluded via .npmignore
    ├── dev-deploy.js
    ├── version.js
    └── ...
```

---

## Migration Plan

### Phase 1: Consolidate CLI Commands (Week 1)

#### 1. Merge `install-wizard.ts` into `bin/commands/setup-wizard.ts`

**Current:**
```typescript
// bin/commands/setup-wizard.ts (thin wrapper)
import { runInstallWizard } from "../../scripts/install-wizard";

export async function setupWizardCommand() {
  await runInstallWizard({ ... });
}
```

**After:**
```typescript
// bin/commands/setup-wizard.ts (complete implementation)
export async function setupWizardCommand() {
  // All 789 lines of setup logic move here
  // (or stays in lib/ and gets imported)
}
```

#### 2. Update `npm run setup`

**Before:**
```json
{
  "scripts": {
    "setup": "ts-node scripts/install-wizard.ts"
  }
}
```

**After:**
```json
{
  "scripts": {
    "setup": "npm run build && node dist/bin/cli.js"
  }
}
```

Or for development (faster):
```json
{
  "scripts": {
    "setup": "ts-node bin/cli.ts",
    "setup:prod": "npm run build && node dist/bin/cli.js"
  }
}
```

#### 3. Consolidate Other Commands

**Merge `config-health-check.ts` → `bin/commands/validate.ts`**
- Move 697 lines of validation logic
- Or extract to `bin/lib/config-validator.ts` and import

**Move `sync-secrets.ts` → `bin/commands/sync-secrets.ts`**
- This is a CLI-worthy command
- Users might want to run it manually

**Handle `infer-quilt-config.ts`**
- This is imported by setup, not a standalone command
- Move to `bin/lib/config/infer-quilt-config.ts`

#### 4. Clean Up Duplicates

**Delete `bin/commands/init.ts`** (if it's redundant with setup-wizard)

Or if it's different:
- Keep both: `setup-wizard` (interactive) and `init` (non-interactive)
- Document the difference clearly

### Phase 2: Move Dev Tools (Week 1-2)

```bash
# Move files
git mv bin/dev-deploy.ts scripts/
git mv bin/version.ts scripts/
git mv bin/check-logs.ts scripts/
git mv bin/send-event.ts scripts/
git mv bin/test-invalid-signature.ts scripts/

# Update npm scripts
# deploy:dev → ts-node scripts/dev-deploy.ts
# version → ts-node scripts/version.ts
# etc.
```

### Phase 3: Configure Publishing (Week 2)

**Add to `.npmignore`:**
```
dist/scripts/
scripts/
```

Or use `package.json` `files` field:
```json
{
  "files": [
    "dist/bin/",
    "dist/lib/",
    "README.md",
    "LICENSE"
  ]
}
```

**Verify:**
```bash
npm pack --dry-run
# Should only include dist/bin/, not dist/scripts/
```

---

## File-by-File Decisions

### Files Moving to `bin/commands/` (CLI)

| Current Location | New Location | Reason |
|-----------------|--------------|--------|
| `scripts/install-wizard.ts` | `bin/commands/setup-wizard.ts` | Merge into CLI |
| `scripts/config-health-check.ts` | `bin/commands/validate.ts` | Merge into CLI |
| `scripts/sync-secrets.ts` | `bin/commands/sync-secrets.ts` | CLI command |

### Files Moving to `scripts/` (Dev Tools)

| Current Location | New Location | Reason |
|-----------------|--------------|--------|
| `bin/dev-deploy.ts` | `scripts/dev-deploy.ts` | Dev-only workflow |
| `bin/version.ts` | `scripts/version.ts` | Dev-only (release mgmt) |
| `bin/check-logs.ts` | `scripts/check-logs.ts` | Dev-only (monitoring) |
| `bin/send-event.ts` | `scripts/send-event.ts` | Dev-only (testing) |
| `bin/test-invalid-signature.ts` | `scripts/test-invalid-signature.ts` | Dev-only (testing) |

### Files Becoming Libraries

| Current Location | New Location | Reason |
|-----------------|--------------|--------|
| `scripts/infer-quilt-config.ts` | `bin/lib/config/infer-quilt-config.ts` | Imported by setup |

### Files to Investigate

| File | Question | Action |
|------|----------|--------|
| `bin/benchling-webhook.ts` | Legacy? | Delete if unused |
| `bin/publish.ts` | CI-only? | Move to `.github/workflows/` |
| `bin/create-secret.ts` | Replaced? | Delete if redundant |
| `bin/get-env.ts` | Used? | Move to `bin/lib/` or delete |
| `bin/config-profiles.ts` | Used? | Move to `bin/lib/` or delete |
| `bin/commands/init.ts` | Duplicate? | Delete or clarify vs. setup-wizard |

---

## Updated npm Scripts

```json
{
  "scripts": {
    "setup": "ts-node bin/cli.ts",
    "setup:prod": "npm run build && node dist/bin/cli.js",

    "deploy:dev": "ts-node scripts/dev-deploy.ts",
    "deploy:prod": "npm run build && node dist/bin/cli.js deploy",
    "deploy:logs": "ts-node scripts/check-logs.ts",

    "version": "ts-node scripts/version.ts",
    "version:tag": "ts-node scripts/version.ts tag",
    "version:tag:dev": "ts-node scripts/version.ts tag dev",

    "test:dev": "make -C docker test-deployed-dev",
    "test:prod": "make -C docker test-deployed-prod"
  }
}
```

---

## Verification Checklist

### Development Testing
- [ ] `npm run setup` works (runs CLI)
- [ ] `npm run setup:prod` works (runs built CLI)
- [ ] `npm run deploy:dev` works
- [ ] `npm run deploy:prod` works
- [ ] `npm run version` works
- [ ] All CLI commands work via `npx benchling-webhook <command>`

### Package Testing
- [ ] `npm pack` excludes `dist/scripts/`
- [ ] Published package size is reasonable
- [ ] `npx @quiltdata/benchling-webhook` works after install
- [ ] CLI help shows all commands

### User Testing
- [ ] First-time setup: `npx @quiltdata/benchling-webhook`
- [ ] Deployment: `npx @quiltdata/benchling-webhook deploy`
- [ ] Validation: `npx @quiltdata/benchling-webhook validate`

---

## Success Criteria

### Technical
- ✅ All CLI code in `bin/`
- ✅ All dev tools in `scripts/`
- ✅ No duplicate logic
- ✅ npm package only includes `bin/`
- ✅ `npm run setup` tests the real CLI

### User Experience
- ✅ No breaking changes (all npm scripts still work)
- ✅ CLI is complete and self-contained
- ✅ Clear distinction: user tools vs. dev tools
- ✅ Smaller npm package size

### Developer Experience
- ✅ Obvious where to add new CLI commands (`bin/commands/`)
- ✅ Obvious where to add dev tools (`scripts/`)
- ✅ Developers test what users use
- ✅ No confusion about what gets published

---

## Why This Is Better

### Before (Current Mess)
```bash
# Developer runs this
npm run setup
  ↓
ts-node scripts/install-wizard.ts  (bypasses CLI)

# User runs this
npx @quiltdata/benchling-webhook
  ↓
node dist/bin/cli.js
  ↓
bin/commands/setup-wizard.ts (thin wrapper)
  ↓
scripts/install-wizard.ts (real implementation)
```

**Problem:** Different code paths, poor testing, confusing structure

### After (Clear Vision)
```bash
# Developer runs this
npm run setup
  ↓
ts-node bin/cli.ts  (same as user)

# User runs this
npx @quiltdata/benchling-webhook
  ↓
node dist/bin/cli.js  (same as developer)
```

**Benefit:** One code path, better testing, clear structure

---

## Comparison to Original Proposal

| Aspect | Original (3 Options) | Revised (This Doc) |
|--------|---------------------|-------------------|
| Directory names | `tools/` (new) | `bin/` + `scripts/` (existing) |
| CLI implementation | Scattered | Consolidated in `bin/` |
| Setup entry point | `scripts/` | `bin/cli.ts` |
| Dev testing | Indirect | Direct (use CLI) |
| Complexity | High (3 options) | Low (1 clear path) |
| Breaking changes | Moderate | None |

**Why revised is better:**
- ✅ Uses existing directories (less churn)
- ✅ Developers test what users use (better quality)
- ✅ Simpler mental model (CLI vs. dev tools)
- ✅ No new conventions to learn

---

## Timeline

**Week 1:**
- Day 1-2: Merge `install-wizard.ts` → `bin/commands/setup-wizard.ts`
- Day 3: Merge `config-health-check.ts` → `bin/commands/validate.ts`
- Day 4: Move `sync-secrets.ts` → `bin/commands/`
- Day 5: Test all CLI commands

**Week 2:**
- Day 1: Move dev tools from `bin/` → `scripts/`
- Day 2: Update all npm scripts
- Day 3: Configure `.npmignore` / `package.json` files
- Day 4: Test `npm pack` and local install
- Day 5: Documentation updates

**Total: 2 weeks**

---

## Open Questions

1. **Should `npm run setup` run the built CLI or use `ts-node`?**
   - Option A: `ts-node bin/cli.ts` (faster, dev-only)
   - Option B: `npm run build && node dist/bin/cli.js` (slower, tests build)
   - Recommendation: **A for dev, B as `setup:prod`**

2. **What about `bin/commands/init.ts`?**
   - If duplicate: delete it
   - If different: keep and document the difference
   - Need to check what it does

3. **Should libraries stay in `bin/lib/` or move to `lib/`?**
   - `bin/lib/` = published with CLI (correct if CLI needs them)
   - `lib/` = repo-wide libraries (if shared with scripts/)
   - Recommendation: **`bin/lib/` for CLI-specific, `lib/` for shared**

---

## Next Steps

1. **Review this proposal** with team
2. **Answer open questions** (especially about `init.ts`)
3. **Start Week 1 migration** (consolidate CLI)
4. **Test thoroughly** before moving dev tools
5. **Update GitHub issue #190** with revised plan

---

## References

- **Previous analysis:** [11-script-analysis.md](./11-script-analysis.md)
- **Original proposal:** [12-consolidation-proposal.md](./12-consolidation-proposal.md)
- **GitHub issue:** [#190](https://github.com/quiltdata/benchling-webhook/issues/190)
