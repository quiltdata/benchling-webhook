# Script Consolidation and NPM Task Isolation

**Status:** In Progress
**Created:** 2025-11-04
**Issue:** #176 (test:prod cleanup)

## Problem Statement

Currently, the codebase has:

1. **Redundant npm scripts** - `npm run release` duplicates `release:tag` + broken Docker build
2. **Direct script calls** - CI and docs call scripts directly (e.g., `./bin/release-notes.sh`)
3. **Split versioning logic** - `bin/version.ts` and `bin/release.ts` are separate but related
4. **Inconsistent patterns** - Some operations use npm tasks, others call scripts directly

This violates the principle of **implementation isolation** - callers should use npm tasks, not know about script locations or implementations.

## Goals

1. **Remove redundant tasks** - Eliminate `npm run release` and `test:remote`
2. **Isolate implementation** - All script calls go through npm tasks
3. **Consolidate related scripts** - Merge `release.ts` into `version.ts`
4. **Canonical tasks** - Single source of truth for each operation

## Current State Analysis

### Script Inventory

| Script | Purpose | Callers | Status |
|--------|---------|---------|--------|
| `bin/version.ts` | Version bumping (patch/minor/major/sync) | `npm run version` | ✅ Keep |
| `bin/release.ts` | Create and push git tags | `npm run release:tag` | 🔄 Merge into version.ts |
| `bin/release-notes.sh` | Generate GitHub release notes | Direct call in CI | ⚠️ Needs npm task |
| `bin/cli.ts` | Main CLI (deploy, manifest, test) | `npm run deploy:prod` | ✅ Keep |
| `bin/dev-deploy.ts` | Dev deployment workflow | `npm run deploy:dev` | ✅ Keep |
| `bin/check-logs.ts` | CloudWatch log viewer | `npm run deploy:logs` | ✅ Keep |
| `bin/send-event.js` | Test event sender | Direct calls only | ⚠️ Consider npm task |

### NPM Scripts

**Before:**
```json
{
  "release": "npm run test && ts-node bin/release.ts && make -C docker push-ci",  // ❌ Removed (broken)
  "release:tag": "ts-node bin/release.ts",                                         // ❌ Removed
  "release:notes": "bash bin/release-notes.sh",                                    // ❌ Removed
  "test:remote": "npm run deploy:dev && make -C docker test-deployed-dev",        // ❌ Removed (redundant)
  "version": "ts-node bin/version.ts"                                              // ✅ Keep
}
```

**After (improved naming):**
```json
{
  "deploy:notes": "bash bin/release-notes.sh",      // ✅ Renamed from release:notes (better semantics)
  "version": "ts-node bin/version.ts",              // ✅ Keep
  "version:tag": "ts-node bin/release.ts",          // ✅ Renamed from release:tag (clearer hierarchy)
  "version:tag:dev": "ts-node bin/release.ts dev"   // ✅ New (explicit dev tagging)
}
```

### Direct Script Calls

#### `.github/workflows/ci.yaml:184`
```yaml
npm run deploy:notes -- "$VERSION" "$IMAGE_URI" "$IS_PRERELEASE" "$PACKAGE_NAME" > /tmp/release_notes.md
```
✅ **Fixed** - Now uses `npm run deploy:notes` (renamed from `release:notes`)

#### `bin/version.ts:147`
```typescript
console.log("To create a release tag, use: npm run version:tag");
```
⚠️ **Needs update** - Should reference `npm run version:tag` or `npm run version:tag:dev`

## Proposed Changes

### 1. Consolidate `release.ts` into `version.ts`

**New `bin/version.ts` commands:**

```bash
# Version management (existing)
npm run version              # Show all version files
npm run version patch        # Bump patch version
npm run version minor        # Bump minor version
npm run version major        # Bump major version
npm run version sync         # Sync versions across files

# Release tagging (new - merged from release.ts)
npm run version tag          # Create production release tag
npm run version tag dev      # Create dev release tag with timestamp
npm run version tag --no-push # Create tag but don't push
```

**Implementation:**
- Move `createGitTag()` from `release.ts` into `version.ts`
- Add `tag` command that accepts `dev` and `--no-push` options
- Delete `bin/release.ts`
- Update `package.json` to point `release:tag` → `version tag`

### 2. Remove Redundant Scripts

#### Remove `npm run release`
- **Why:** Builds Docker on wrong architecture (ARM64), dangerous
- **What it did:** Tests + tag + Docker build
- **Replacement:** Use `npm run release:tag` (canonical)

#### Remove `npm run test:remote`
- **Why:** Duplicate of `test:dev`
- **What it did:** Same as `test:dev`
- **Replacement:** Use `npm run test:dev`

### 3. Update NPM Scripts

**Completed (with improved naming):**

```json
{
  "deploy:notes": "bash bin/release-notes.sh",           // Renamed from release:notes
  "version": "ts-node bin/version.ts",
  "version:tag": "ts-node bin/release.ts",               // Renamed from release:tag
  "version:tag:dev": "ts-node bin/release.ts dev"        // New explicit dev task
}
```

### 4. Update All Callers

#### Documentation Updates

**CLAUDE.md:**
- ✅ Remove "Local Release (Alternative)" section
- ✅ Remove `test:remote` references
- Update version.ts documentation

**AGENTS.md:**
- Update bin/ section to reflect consolidation
- Update release workflow to use `version tag`

**README.md:**
- No changes needed (end-user focused)

#### Code Updates

**bin/version.ts:**
- Update help text: "To create a release tag, use: npm run version tag"
- Add tag command implementation

### 5. Ensure Implementation Isolation

**Principle:** All operations should go through npm tasks, not direct script calls.

**Audit checklist:**
- [x] CI uses `npm run release:notes` (not `./bin/release-notes.sh`)
- [ ] Documentation references npm tasks (not script paths)
- [ ] Scripts reference npm tasks (not other scripts directly)
- [ ] Makefile operations have corresponding npm tasks where needed

## Implementation Plan

### Phase 1: Consolidate Scripts ✅
1. [x] Remove `npm run release` from package.json
2. [x] Remove `npm run test:remote` from package.json
3. [x] Add `npm run deploy:notes` to package.json (renamed from `release:notes`)
4. [x] Add `npm run version:tag` to package.json (renamed from `release:tag`)
5. [x] Add `npm run version:tag:dev` to package.json (new)
6. [x] Update CI to use `npm run deploy:notes`
7. [x] Update CLAUDE.md to remove redundant sections
8. [x] Update CLAUDE.md to use `npm run version:tag`

### Phase 2: Merge release.ts into version.ts
1. [ ] Add `tag` command to version.ts
2. [ ] Copy `createGitTag()` from release.ts to version.ts
3. [ ] Update help text in version.ts
4. [ ] Test all tag scenarios (production, dev, --no-push)
5. [ ] Update `release:tag` in package.json to point to `version.ts tag`
6. [ ] Delete `bin/release.ts`

### Phase 3: Documentation Updates
1. [ ] Update CLAUDE.md version management section
2. [ ] Update AGENTS.md bin/ section
3. [ ] Update bin/version.ts help text
4. [ ] Update any remaining references to `release.ts`

### Phase 4: Verification
1. [ ] Run `npm run version` - should show versions
2. [ ] Run `npm run version tag --no-push` - should create tag without pushing
3. [ ] Run `npm run release:tag` - should create and push tag
4. [ ] Check CI workflow still works
5. [ ] Verify documentation is consistent

## Success Criteria

- [ ] No redundant npm scripts in package.json
- [ ] All CI operations use npm tasks (not direct script calls)
- [ ] Documentation only references npm tasks
- [ ] `bin/release.ts` deleted
- [ ] `bin/version.ts` handles both versioning and tagging
- [ ] All tests pass
- [ ] CI workflow succeeds

## Benefits

1. **Single source of truth** - One script for version-related operations
2. **Implementation isolation** - Callers use npm tasks, not script paths
3. **Better maintainability** - Fewer files, clearer responsibilities
4. **Safer releases** - No broken `npm run release` to accidentally use
5. **Consistent patterns** - npm tasks everywhere, not mixed with direct calls

## Breaking Changes

### For Users
- **None** - `npm run release:tag` still works (just calls different script internally)

### For Developers
- `npm run release` removed (was broken anyway)
- `npm run test:remote` removed (use `npm run test:dev`)
- `bin/release.ts` deleted (use `bin/version.ts tag`)

## Related Issues

- #176 - test:prod implementation
- Configuration cleanup and consolidation
