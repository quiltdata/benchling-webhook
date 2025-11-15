# PR 205 Conflict Resolution Plan

**Date:** 2025-11-13
**Branch:** 194-rework-dockerfile
**Merging:** origin/main

---

## Current Status

**CHANGELOG.md:** ✅ RESOLVED (committed separately)
**Remaining:** 20 files with conflicts

---

## Conflict Files by Category

### Category 1: Package Configuration (2 files)
- `package.json` - Version and dependency conflicts
- `docker/pyproject.toml` - Python dependencies

### Category 2: TypeScript CLI (4 files)
- `bin/cli.ts` - CLI structure
- `bin/commands/deploy.ts` - Deployment logic
- `bin/commands/setup-wizard.ts` - Setup flow
- `bin/commands/sync-secrets.ts` - Secret syncing

### Category 3: Python Application (3 files)
- `docker/src/app.py` - Main app
- `docker/src/config_resolver.py` - Config resolution
- `docker/src/xdg_config.py` - XDG handling

### Category 4: Docker/Build (2 files)
- `docker/Makefile` - Build commands
- `docker/app-manifest.yaml` - App manifest

### Category 5: Tests (5 files)
- `docker/scripts/test_webhook.py` - Webhook tests
- `docker/tests/test_app.py` - App tests
- `docker/tests/test_config_env_vars.py` - Config tests
- `test/integration/multi-profile.test.ts` - Multi-profile tests
- `test/sync-secrets.test.ts` - Secret sync tests

### Category 6: Lock Files (1 file)
- `docker/uv.lock` - Will regenerate after pyproject.toml

### Category 7: Deleted Files (2 files)
- `test/multi-environment-profile.test.ts` - Deleted in HEAD, modified in main
- `test/xdg-isolation.test.ts` - Deleted in HEAD, modified in main

---

## Resolution Strategy

### Phase 1: Package Configuration
1. **package.json** - Accept main version (0.7.7), merge scripts
2. **docker/pyproject.toml** - Merge dependencies from both

### Phase 2: Simple Merges
3. **docker/Makefile** - Merge commands from both
4. **docker/app-manifest.yaml** - Likely auto-merge

### Phase 3: Critical CLI Files
5. **bin/cli.ts** - Careful merge of CLI structure
6. **bin/commands/setup-wizard.ts** - Merge wizard improvements
7. **bin/commands/sync-secrets.ts** - Merge sync logic
8. **bin/commands/deploy.ts** - Merge deployment logic

### Phase 4: Python Application
9. **docker/src/app.py** - Merge application logic
10. **docker/src/config_resolver.py** - Merge config resolution
11. **docker/src/xdg_config.py** - Keep latest XDG handling

### Phase 5: Test Files
12. **docker/scripts/test_webhook.py** - Merge test improvements
13. **docker/tests/test_app.py** - Merge test updates
14. **docker/tests/test_config_env_vars.py** - Merge config tests
15. **test/integration/multi-profile.test.ts** - Merge integration tests
16. **test/sync-secrets.test.ts** - Merge sync tests

### Phase 6: Deleted Files
17. **test/multi-environment-profile.test.ts** - Accept deletion (was refactored)
18. **test/xdg-isolation.test.ts** - Accept deletion (was refactored)

### Phase 7: Lock File Regeneration
19. **docker/uv.lock** - Regenerate with `cd docker && uv lock`

### Phase 8: Final Validation
20. Run `npm test` to verify TypeScript
21. Run `cd docker && make test` to verify Python
22. Run `cd docker && make build` to verify Docker

---

## Resolution Decisions

### Key Principles
1. **Keep all functionality** - Don't lose features from either branch
2. **Prefer main for bug fixes** - Main has more recent bugfixes
3. **Keep feature branch for Dockerfile** - This is the core of our changes
4. **Merge wizard improvements** - Both branches improved setup wizard
5. **Test thoroughly** - Each category should be tested after resolution

### Specific Decisions

#### package.json
- Version: Use 0.7.7 from main (latest)
- Scripts: Merge any new scripts from both branches
- Dependencies: Keep latest versions from main

#### Dockerfile-related
- Keep all Dockerfile changes from feature branch (core feature)
- Keep any build script improvements from main

#### Setup Wizard
- Merge improvements from both branches
- Prefer main's bug fixes
- Keep feature branch's UX improvements

#### Secret Sync
- Merge auto-sync from feature branch
- Keep validation improvements from main

---

## Commit Strategy

After all conflicts resolved:

```bash
git add .
git commit -m "chore: resolve merge conflicts with main (releases 0.7.4-0.7.7)

Merged changes from main:
- Smart prompting and validation (0.7.7)
- NPX deployment fixes (0.7.6)
- Secret sync improvements (0.7.4)
- XDG config test isolation
- AWS/dependency updates

Retained 194-rework-dockerfile changes:
- Amazon Linux 2023 multi-stage Dockerfile
- Direct Python execution (no uv wrapper)
- Enhanced setup wizard with npm script suggestions
- Auto secret sync after setup
- Multi-stage build optimization

Conflict resolution:
- Combined CHANGELOG chronologically
- Merged setup wizard improvements from both branches
- Merged secret sync enhancements
- Kept latest test isolation fixes
- Regenerated uv.lock file

Fixes #194

🤖 Generated with Claude Code"
```

---

## Next Steps

1. ✅ CHANGELOG.md resolved
2. 🔄 Resolve package configuration (2 files)
3. ⏳ Resolve build files (2 files)
4. ⏳ Resolve CLI files (4 files) - MOST COMPLEX
5. ⏳ Resolve Python files (3 files)
6. ⏳ Resolve test files (5 files)
7. ⏳ Handle deleted files (2 files)
8. ⏳ Regenerate lock file (1 file)
9. ⏳ Test everything
10. ⏳ Commit and push

**Total Remaining:** 19 files + testing

---

**Status:** IN PROGRESS
**Last Updated:** 2025-11-13 23:55 PST
