# Phase 8: Action Plan - What to Do Next

**Status**: Phase 8 is 90% complete
**Next Step**: Execute cleanup and validation
**Timeline**: 1-2 hours to complete

---

## Quick Start

```bash
# From project root directory:

# 1. Run validation to see current state
./scripts/phase8-validation.sh

# 2. Run cleanup to remove legacy code
./scripts/phase8-cleanup.sh

# 3. Remove outdated TODO comments manually (see below)

# 4. Validate everything passes
./scripts/phase8-validation.sh

# 5. Run local integration tests
npm run test:local

# 6. Ready for merge!
```

---

## Detailed Action Items

### Action 1: Remove Legacy File (5 minutes)

**File**: `lib/xdg-config-legacy.ts`

**Why**: This is a backup file from Phase 2 refactoring. It's not imported anywhere and serves no purpose.

**Command**:
```bash
git rm lib/xdg-config-legacy.ts
git commit -m "chore: remove legacy xdg-config backup file

- Delete lib/xdg-config-legacy.ts (not imported anywhere)
- File was Phase 2 backup, no longer needed
- Part of Phase 8 cleanup for v0.7.0 release

Related: #176, #189"
```

**Validation**: Run `./scripts/phase8-validation.sh` - should now pass "legacy file removed" check

---

### Action 2: Remove Outdated TODO Comments (10 minutes)

Three files have TODO comments claiming work needs to be done that's already complete. These are misleading.

#### File 1: `bin/commands/sync-secrets.ts`

**Lines to Remove**: 5-8
```typescript
/**
 * WARNING: This file needs significant refactoring for v0.7.0
 * TODO: Update to use ProfileConfig instead of UserConfig/DerivedConfig
 * TODO: Remove references to BaseConfig
 * TODO: Update to use readProfile/writeProfile instead of readProfileConfig/writeProfileConfig
 */
```

**Reality**: File already uses `ProfileConfig`, `readProfile()`, and `writeProfile()`. TODOs are outdated.

**Action**: Delete lines 5-8, keep only the description starting at line 10

#### File 2: `bin/commands/config-profiles.ts`

**Lines to Remove**: 5-8
```typescript
/**
 * WARNING: This file needs refactoring for v0.7.0
 * TODO: Update to use ProfileConfig instead of UserConfig/DerivedConfig/DeploymentConfig
 * TODO: Remove references to BaseConfig and loadProfile
 * TODO: Update to use new readProfile API
 */
```

**Reality**: File already uses `ProfileConfig` and `readProfile()`. TODOs are outdated.

**Action**: Delete lines 5-8, keep only the description starting at line 10

#### File 3: `bin/benchling-webhook.ts`

**Lines to Review**: 78-79, 128

First, verify the function is actually unused:
```bash
grep -r "createStack\|legacyConfigToProfileConfig" \
  --include="*.ts" --include="*.js" \
  --exclude="**/benchling-webhook.ts" \
  --exclude-dir=node_modules --exclude-dir=dist .
```

If no results (function is unused), remove:
- `legacyConfigToProfileConfig()` function (lines 81-123)
- `createStack()` function (lines 130-150)

If function IS used, update the TODO comment to reflect current status.

**Commit**:
```bash
git add bin/commands/sync-secrets.ts bin/commands/config-profiles.ts bin/benchling-webhook.ts
git commit -m "chore: remove outdated TODO comments from v0.7.0 refactored files

- Remove misleading TODOs claiming work needed that's already done
- sync-secrets.ts already uses ProfileConfig and readProfile()
- config-profiles.ts already uses ProfileConfig and readProfile()
- [Optional] Remove unused createStack() if verified unused

All files have been refactored for v0.7.0 in earlier phases.

Related: #176, #189"
```

---

### Action 3: Run Manual Testing (30-60 minutes)

See `PHASE8-FINAL-VALIDATION-REPORT.md` Section 2 for complete checklist.

**Critical Tests**:

1. **Fresh Install**
   ```bash
   # Backup existing config
   mv ~/.config/benchling-webhook ~/.config/benchling-webhook.backup

   # Run setup
   npm run setup

   # Verify created
   ls -la ~/.config/benchling-webhook/default/config.json
   cat ~/.config/benchling-webhook/default/config.json | jq '._metadata.version'
   # Should show: "0.7.0"

   # Restore backup if needed
   # mv ~/.config/benchling-webhook.backup ~/.config/benchling-webhook
   ```

2. **Multi-Profile Setup**
   ```bash
   # Create dev profile
   npm run setup:profile dev -- --inherit-from default

   # Verify inheritance
   cat ~/.config/benchling-webhook/dev/config.json | jq '._inherits'
   # Should show: "default"
   ```

3. **Health Check**
   ```bash
   npm run setup:health
   # Should validate all profiles successfully
   ```

4. **Local Integration Tests**
   ```bash
   npm run test:local
   # Should pass all integration tests
   ```

---

### Action 4: Final Validation (5 minutes)

```bash
# Run validation script
./scripts/phase8-validation.sh

# Expected output:
# ✅ All validation checks passed!
# Ready for:
#   - Manual testing (see PHASE8-FINAL-VALIDATION-REPORT.md)
#   - PR review and approval
#   - Merge to main
```

---

## Checklist

Use this checklist to track progress:

- [ ] **Step 1**: Run initial validation (`./scripts/phase8-validation.sh`)
- [ ] **Step 2**: Remove legacy file (`git rm lib/xdg-config-legacy.ts`)
- [ ] **Step 3**: Remove outdated TODOs in `sync-secrets.ts`
- [ ] **Step 4**: Remove outdated TODOs in `config-profiles.ts`
- [ ] **Step 5**: Review and remove unused code in `benchling-webhook.ts`
- [ ] **Step 6**: Commit changes
- [ ] **Step 7**: Run validation again (should pass all checks)
- [ ] **Step 8**: Run `npm run test` (should pass)
- [ ] **Step 9**: Run `npm run test:local` (should pass)
- [ ] **Step 10**: Complete manual testing checklist
- [ ] **Step 11**: Push to GitHub
- [ ] **Step 12**: Request PR review
- [ ] **Step 13**: Merge PR #189
- [ ] **Step 14**: Tag v0.7.0 release
- [ ] **Step 15**: Deploy to production

---

## Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| **Immediate** (Today) | | |
| Remove legacy file | 5 min | ⏳ Pending |
| Remove outdated TODOs | 10 min | ⏳ Pending |
| Commit changes | 5 min | ⏳ Pending |
| Run validation | 5 min | ⏳ Pending |
| **Short-term** (This Week) | | |
| Manual testing | 30-60 min | ⏳ Pending |
| Local integration tests | 10 min | ⏳ Pending |
| PR review and approval | 1-2 hours | ⏳ Pending |
| Merge to main | 5 min | ⏳ Pending |
| **Release** (Next Week) | | |
| Tag v0.7.0 | 5 min | ⏳ Pending |
| Deploy to production | 30 min | ⏳ Pending |
| Publish npm package | 10 min | ⏳ Pending |
| Update documentation | 30 min | ⏳ Pending |

**Total Estimated Time**: 2-3 hours of active work

---

## What Can Go Wrong?

### Risk 1: Tests Fail After Cleanup
**Mitigation**: Run `npm run test` after each change
**Fix**: Revert the specific commit that broke tests

### Risk 2: Manual Tests Reveal Issues
**Mitigation**: Test in a sandbox environment first
**Fix**: Address issues before merging

### Risk 3: Integration Tests Fail
**Mitigation**: Run `npm run test:local` before requesting review
**Fix**: Debug specific test failures

### Risk 4: Production Deployment Issues
**Mitigation**: Deploy to dev environment first
**Fix**: Rollback to v0.6.x if critical issues found

---

## Success Criteria

✅ **All automated tests pass**
- `npm run test` - TypeScript + Python unit tests
- `npm run test:local` - Docker integration tests
- `./scripts/phase8-validation.sh` - Phase 8 validation

✅ **All manual tests pass**
- Fresh install workflow
- Multi-profile setup
- Profile inheritance
- Health checks

✅ **Code quality**
- No legacy files remain
- No misleading comments
- TypeScript compiles cleanly
- Linting passes

✅ **Documentation complete**
- CHANGELOG.md updated
- MIGRATION.md accurate
- README.md reflects v0.7.0
- CLAUDE.md updated

✅ **CI/CD passing**
- GitHub Actions CI passing
- All checks green on PR #189

---

## Quick Reference Commands

```bash
# Validation
./scripts/phase8-validation.sh

# Cleanup
./scripts/phase8-cleanup.sh

# Remove legacy file
git rm lib/xdg-config-legacy.ts

# Run tests
npm run test
npm run test:local

# Check CI status
gh pr view

# Check file changes
git status
git diff

# Commit
git add -A
git commit -m "chore: Phase 8 cleanup for v0.7.0"

# Push
git push origin 176-multi-environment-implementation
```

---

## Questions?

See detailed analysis in `PHASE8-FINAL-VALIDATION-REPORT.md`

**Key Documents**:
- `PHASE8-FINAL-VALIDATION-REPORT.md` - Comprehensive analysis
- `PHASE8-ACTION-PLAN.md` - This file (quick reference)
- `spec/189-multi/02-todo.md` - Original implementation plan
- `MIGRATION.md` - User migration guide
- `CHANGELOG.md` - Release notes

---

**Ready to Start?** Run `./scripts/phase8-validation.sh` to see current state!
