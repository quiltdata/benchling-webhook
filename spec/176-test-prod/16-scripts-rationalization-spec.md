# Scripts Directory Rationalization Specification

**Date:** 2025-11-04
**Status:** Proposed
**Follows:** Script consolidation (#191)

## Problem Statement

After consolidating dev tools into `scripts/`, the directory now contains 9 files with inconsistent naming patterns and unclear organization:

```
scripts/
├── check-logs.ts              # "check-" prefix
├── config-health-check.ts     # "config-" prefix, compound name
├── dev-deploy.ts              # "dev-" prefix, legacy workflow
├── infer-quilt-config.ts      # "infer-" prefix, compound name
├── release-notes.sh           # Shell script, compound name
├── send-event.ts              # "send-" prefix
├── sync-secrets.ts            # "sync-" prefix
├── check-webhook-verification.ts  # "check-" prefix, compound name
└── version.ts                 # Simple name
```

**Issues:**
1. **Inconsistent naming**: 6 different verb prefixes (check, config, dev, infer, send, sync, test, version)
2. **Mixed purposes**: Release management, testing, setup utilities, deployment workflows
3. **No clear grouping**: Related scripts (config validation, secrets sync, Quilt inference) are mixed with unrelated ones
4. **Compound names**: `config-health-check`, `infer-quilt-config`, `check-webhook-verification` are verbose
5. **Legacy script**: `dev-deploy.ts` is superseded by CLI but kept for backward compatibility

## Goals

1. **Rationalize naming**: Consistent verb prefixes and clear hierarchies
2. **Group by purpose**: Setup, testing, release management, monitoring
3. **Simplify names**: Shorter, clearer names without redundancy
4. **Better discoverability**: Names should match npm script patterns

## Current Usage Analysis

### By npm Scripts

| Script | npm Command | Category | Used In |
| -------- | ------------- | ---------- | --------- |
| `version.ts` | `npm run version` | Release | Frequently |
| `check-logs.ts` | `npm run deploy:logs` | Monitoring | Frequently |
| `config-health-check.ts` | `npm run setup:health` | Setup | Occasionally |
| `infer-quilt-config.ts` | `npm run setup:infer` | Setup | Occasionally |
| `sync-secrets.ts` | `npm run setup:sync-secrets` | Setup | Occasionally |
| `release-notes.sh` | `npm run deploy:notes` | Release | CI only |
| `send-event.ts` | Direct call | Testing | Manual |
| `check-webhook-verification.ts` | Direct call | Testing | Manual |
| `dev-deploy.ts` | Legacy | Deployment | Deprecated |

### By Imports

| Script | Imported By | Purpose |
| -------- | ------------- | --------- |
| `infer-quilt-config.ts` | `bin/commands/setup-wizard.ts` | Setup utility |
| `sync-secrets.ts` | `bin/commands/setup-wizard.ts` | Setup utility |
| `config-health-check.ts` | None (standalone) | Validation tool |

### By Category

#### **Setup Utilities** (imported by CLI)
- `infer-quilt-config.ts` - Quilt stack detection (385 lines)
- `sync-secrets.ts` - AWS Secrets Manager sync (454 lines)
- `config-health-check.ts` - Configuration validation (697 lines)

#### **Release Management** (CI/CD)
- `version.ts` - Version bumping and git tagging (323 lines)
- `release-notes.sh` - GitHub release notes generation (60 lines)

#### **Monitoring & Debugging** (dev tools)
- `check-logs.ts` - CloudWatch log viewer (250 lines)
- `send-event.ts` - Test event sender (225 lines)
- `check-webhook-verification.ts` - Signature validation tests (155 lines)

#### **Legacy** (to be removed)
- `dev-deploy.ts` - Old dev deployment workflow (356 lines)

## Proposed Reorganization

### Option A: Flat Structure with Namespaced Prefixes

Keep flat structure but use consistent prefixes to group by purpose:

```
scripts/
├── setup-validate-config.ts   # Renamed from config-health-check.ts
├── setup-infer-quilt.ts        # Renamed from infer-quilt-config.ts
├── setup-sync-secrets.ts       # Renamed from sync-secrets.ts
├── logs-viewer.ts              # Renamed from check-logs.ts
├── test-send-event.ts          # Renamed from send-event.ts
├── check-webhook-verification.ts   # Renamed for clarity
├── release-version.ts          # Renamed from version.ts
└── release-notes.sh            # No change (already clear)
```

**Pros:**
- ✅ Clear grouping by prefix (setup-, logs-, test-, release-)
- ✅ No directory nesting (simpler imports)
- ✅ Easy to find related scripts (alphabetical sort groups them)

**Cons:**
- ❌ Longer file names
- ❌ Still somewhat verbose

### Option B: Hierarchical with Subdirectories

Organize into subdirectories by purpose:

```
scripts/
├── setup/
│   ├── validate-config.ts     # From config-health-check.ts
│   ├── infer-quilt.ts          # From infer-quilt-config.ts
│   └── sync-secrets.ts         # No rename needed
├── testing/
│   ├── send-event.ts           # No rename needed
│   └── invalid-signature.ts    # From check-webhook-verification.ts
├── monitoring/
│   └── logs-viewer.ts          # From check-logs.ts
└── release/
    ├── version.ts              # No rename needed
    └── notes.sh                # From release-notes.sh
```

**Pros:**
- ✅ Very clear organization
- ✅ Shorter individual file names
- ✅ Easy to find category of scripts

**Cons:**
- ❌ Requires updating all imports in CLI commands
- ❌ More complex npm script paths
- ❌ Deeper nesting

### Option C: Hybrid - Subdirectories for Libraries, Flat for Executables

Keep executable scripts flat, move imported utilities to `lib/`:

```
scripts/
├── lib/                        # Imported utilities (NOT executed directly)
│   ├── validate-config.ts      # From config-health-check.ts
│   ├── infer-quilt.ts          # From infer-quilt-config.ts
│   └── sync-secrets.ts         # No rename needed
├── logs.ts                     # From check-logs.ts (executable)
├── send-event.ts               # No change (executable)
├── test-signature.ts           # From check-webhook-verification.ts (executable)
├── version.ts                  # No change (executable)
└── release-notes.sh            # No change (executable)
```

**Pros:**
- ✅ Clear distinction: executables vs. libraries
- ✅ Simpler npm script paths (no subdirectories for executables)
- ✅ Shorter names for frequently-used scripts

**Cons:**
- ❌ `lib/` subdirectory might be confused with main `lib/`
- ❌ Less obvious grouping by purpose

## Recommended Approach: Option A (Namespaced Flat)

**Rationale:**
1. **Simplest migration**: No directory restructuring, only renames
2. **Clear grouping**: Prefixes make purpose obvious
3. **Easy npm scripts**: No path changes needed
4. **Good discoverability**: Alphabetical sort groups related scripts

### Detailed Renaming Plan

| Old Name | New Name | Reason |
| ---------- | ---------- | -------- |
| `config-health-check.ts` | `setup-validate-config.ts` | Matches `setup:*` npm script pattern |
| `infer-quilt-config.ts` | `setup-infer-quilt.ts` | Matches `setup:*` npm script pattern, shorter |
| `sync-secrets.ts` | `setup-sync-secrets.ts` | Matches `setup:*` npm script pattern |
| `check-logs.ts` | `logs-viewer.ts` | Clearer purpose (viewer vs. checker) |
| `send-event.ts` | `test-send-event.ts` | Matches testing purpose |
| `check-webhook-verification.ts` | No change | Already well-named |
| `version.ts` | `release-version.ts` | Matches `release` category |
| `release-notes.sh` | No change | Already well-named |
| `dev-deploy.ts` | **DELETE** | Legacy, replaced by CLI |

### Updated npm Scripts

```json
{
  "scripts": {
    "deploy:logs": "ts-node scripts/logs-viewer.ts",
    "deploy:notes": "bash scripts/release-notes.sh",
    "setup:health": "ts-node scripts/setup-validate-config.ts",
    "setup:infer": "ts-node scripts/setup-infer-quilt.ts",
    "setup:sync-secrets": "ts-node scripts/setup-sync-secrets.ts",
    "version": "ts-node scripts/release-version.ts",
    "version:tag": "ts-node scripts/release-version.ts tag",
    "version:tag:dev": "ts-node scripts/release-version.ts tag dev"
  }
}
```

### Updated Imports

**In `bin/commands/setup-wizard.ts`:**
```typescript
// Before
import { inferQuiltConfig, inferenceResultToDerivedConfig } from "../../scripts/infer-quilt-config";
import { syncSecretsToAWS } from "../../scripts/sync-secrets";

// After
import { inferQuiltConfig, inferenceResultToDerivedConfig } from "../../scripts/setup-infer-quilt";
import { syncSecretsToAWS } from "../../scripts/setup-sync-secrets";
```

## Alternative Names Considered

### For `config-health-check.ts`
- `validate-config.ts` - Too generic
- `config-validator.ts` - Noun form, inconsistent
- ✅ `setup-validate-config.ts` - Matches npm script `setup:health`

### For `infer-quilt-config.ts`
- `quilt-inference.ts` - Noun form
- `detect-quilt.ts` - Less specific
- ✅ `setup-infer-quilt.ts` - Shorter, matches npm script pattern

### For `check-logs.ts`
- `view-logs.ts` - Similar but "viewer" is clearer
- `logs.ts` - Too simple
- ✅ `logs-viewer.ts` - Clearest purpose

### For `version.ts`
- `bump-version.ts` - Doesn't cover tagging
- `manage-version.ts` - Too vague
- ✅ `release-version.ts` - Covers bumping and tagging, matches release category

## Implementation Plan

### Phase 1: Rename and Update (Week 1)

1. **Rename files** (use `git mv` to preserve history):
   ```bash
   git mv scripts/config-health-check.ts scripts/setup-validate-config.ts
   git mv scripts/infer-quilt-config.ts scripts/setup-infer-quilt.ts
   git mv scripts/sync-secrets.ts scripts/setup-sync-secrets.ts
   git mv scripts/check-logs.ts scripts/logs-viewer.ts
   git mv scripts/send-event.ts scripts/test-send-event.ts
   git mv scripts/version.ts scripts/release-version.ts
   ```

2. **Delete legacy script**:
   ```bash
   git rm scripts/dev-deploy.ts
   ```

3. **Update npm scripts** in `package.json`

4. **Update imports** in `bin/commands/setup-wizard.ts`

5. **Update test imports** (if any)

6. **Update documentation references**:
   - `AGENTS.md`
   - `spec/` references
   - `.github/workflows/` CI files

### Phase 2: Verify (Week 1)

1. Run typecheck: `npm run build:typecheck`
2. Test each npm script:
   - `npm run setup:health`
   - `npm run setup:infer -- --help`
   - `npm run version`
   - `npm run deploy:logs -- --help`
3. Verify git history preserved (check `git log --follow`)

### Phase 3: Update Documentation (Week 1)

1. Update all spec documents
2. Update AGENTS.md
3. Update any inline help text
4. Create migration note for contributors

## Benefits

1. ✅ **Consistent naming**: All scripts follow `category-action` pattern
2. ✅ **Better discoverability**: Alphabetical sorting groups related scripts
3. ✅ **Clear purpose**: Name indicates function without reading code
4. ✅ **npm script alignment**: Script names match npm command patterns
5. ✅ **Reduced confusion**: No more guessing which script does what
6. ✅ **Easier onboarding**: New contributors can navigate scripts folder easily

## Breaking Changes

### For Users
- **None** - npm scripts remain the same, only internal paths change

### For Developers
- Need to update any direct imports of renamed files
- CI workflows need path updates (if referencing directly)
- Documentation/comments need updates

## Success Criteria

- [ ] All scripts renamed consistently
- [ ] All npm scripts work without changes
- [ ] All imports updated and working
- [ ] TypeScript typecheck passes
- [ ] Git history preserved for all renamed files
- [ ] Documentation updated
- [ ] No broken references in codebase

## Future Considerations

### If `scripts/` Grows Beyond 15 Files

Consider Option B (subdirectories) when:
- More than 15 total scripts
- Multiple scripts per category (e.g., 5+ setup scripts)
- Clear category boundaries emerge

### Potential Future Organization

```
scripts/
├── setup/          # 10+ setup-related utilities
├── testing/        # 10+ test utilities
├── release/        # 5+ release scripts
└── monitoring/     # 5+ monitoring tools
```

But for now (9 files), **flat with prefixes is optimal**.

---

## Migration Checklist

- [ ] Rename all scripts using `git mv`
- [ ] Delete `dev-deploy.ts`
- [ ] Update `package.json` npm scripts
- [ ] Update imports in `bin/commands/setup-wizard.ts`
- [ ] Update test imports
- [ ] Update AGENTS.md
- [ ] Update spec/ references
- [ ] Update CI workflow references
- [ ] Run `npm run build:typecheck`
- [ ] Test all npm scripts
- [ ] Verify git history with `git log --follow`
- [ ] Commit changes
- [ ] Update PR description

---

## Questions & Answers

**Q: Why not organize by technology (TypeScript, Shell)?**
A: Purpose is more important than implementation language. A developer looking for "setup" scripts doesn't care if it's TS or Shell.

**Q: Why delete `dev-deploy.ts` instead of archiving?**
A: Git history preserves it. If truly needed later, it can be restored. Keeping dead code increases maintenance burden.

**Q: Should `release-notes.sh` become `release-notes.ts`?**
A: Not necessarily. Shell is fine for simple CI scripts. Rewriting to TS adds no value here.

**Q: What about the `bin/` scripts that are also dev tools?**
A: Those were already moved to `scripts/` in PR #192. This spec handles naming rationalization.

---

**End of Specification**
