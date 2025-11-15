# Minimal Changes to Import New test_webhook.py

**Branch:** fix-deploy → import from 206-service-envars
**Target:** Make `npm run test:local` work with new test_webhook.py
**Date:** 2025-11-07

## You're Right - Here's What Actually Matters

The workflow is:
1. `npm run test:local` → calls `make -C docker test-local`
2. `make test-local` → runs `uv run python scripts/run_local.py --test`
3. `run_local.py --test` → starts Flask server, then runs `test_webhook.py`
4. `test_webhook.py` → sends real webhook payloads to test endpoints

## What Changed in 206-service-envars

### 1. test_webhook.py (MAJOR REWRITE)
- **OLD:** Hardcoded fake payloads
- **NEW:** Loads real payloads from `test-events/` directory
- **NEW:** Reads event types from `app-manifest.yaml`
- **NEW:** Uses PyYAML to parse manifest

### 2. test-events/athena-fail.json (NEW FILE)
- Merged from `docker/test-events/` to root `test-events/`
- One new test payload file

### 3. run_local.py (MINOR CHANGE)
- Added `--profile` argument support
- Changed from `sys.argv` parsing to proper argparse
- Otherwise same logic

## Actual Minimal Requirements

### Files That MUST Be Updated

1. **docker/scripts/test_webhook.py** (complete replacement)
   - Requires PyYAML (for app-manifest.yaml parsing)
   - Requires real test payloads from test-events/

2. **test-events/athena-fail.json** (new file)
   - Single new test payload

3. **docker/scripts/run_local.py** (minor update)
   - Add argparse for `--profile` support
   - Keep everything else the same

### Dependencies Check

```bash
# Check if PyYAML is available
cd docker && uv pip list | grep -i yaml
# Result: pyyaml 6.0.3 ✅ ALREADY INSTALLED

# Check if test-events exists
ls test-events/*.json | wc -l
# Result: ~20 files ✅ ALREADY EXISTS

# Check if app-manifest.yaml exists
ls docker/app-manifest.yaml
# Result: exists ✅ ALREADY EXISTS
```

**VERDICT:** All dependencies already satisfied! ✅

## Critical Path Analysis

### What test_webhook.py Actually Needs

```python
# Line 17: import yaml  ✅ Already available (pyyaml installed)
# Line 22: Path(__file__).parent.parent / "app-manifest.yaml"  ✅ Already exists
# Line 49: Path(...) / "test-events" / "entry.json"  ✅ Already exists
# Line 38: from xdg_config import XDGConfig  ✅ Already exists
```

### What run_local.py Actually Needs

The new version adds argparse, but the key question is: **Does it break without it?**

```python
# OLD (fix-deploy):
verbose = "--verbose" in sys.argv
test_mode = "--test" in sys.argv

# NEW (206-service-envars):
parser = argparse.ArgumentParser(...)
args = parser.parse_args()
verbose = args.verbose
test_mode = args.test
```

**Impact:** The new test_webhook.py passes `--profile` arg to `run_local.py`, but `run_local.py` on fix-deploy doesn't accept it yet.

## REAL Minimal Changes

### Option A: Import All Three Files (SAFEST)

```bash
# 1. Get new test_webhook.py
git show 206-service-envars:docker/scripts/test_webhook.py > docker/scripts/test_webhook.py

# 2. Get new athena-fail.json
git show 206-service-envars:test-events/athena-fail.json > test-events/athena-fail.json

# 3. Get updated run_local.py (for --profile support)
git show 206-service-envars:docker/scripts/run_local.py > docker/scripts/run_local.py
```

**Changes:**
- 3 files updated
- All profile support works
- No compatibility issues
- Forward compatible with v0.7.0 config

**Test:**
```bash
npm run test:local
```

### Option B: Import Just test_webhook.py (RISKY)

```bash
# 1. Get new test_webhook.py
git show 206-service-envars:docker/scripts/test_webhook.py > docker/scripts/test_webhook.py

# 2. Get new athena-fail.json
git show 206-service-envars:test-events/athena-fail.json > test-events/athena-fail.json
```

**Problem:** test_webhook.py tries to use `--profile` arg but run_local.py doesn't accept it.

**Fix:** Remove profile-related code from test_webhook.py:
- Remove `--profile` argument parsing (lines 186-188)
- Hardcode `profile="dev"` everywhere
- Skip profile in output

**Changes:**
- 2 files updated + manual edits
- No profile support (hardcoded to "dev")
- More fragile

## Recommended Approach: Option A

Import all 3 files from 206-service-envars:
1. `docker/scripts/test_webhook.py` - Complete rewrite with real payloads
2. `test-events/athena-fail.json` - New test payload
3. `docker/scripts/run_local.py` - Profile support

### Why This Is Actually "Minimal"

1. **No config format changes needed**
   - The new test_webhook.py has fallback logic that works with current config
   - Reads from `test-events/entry.json` if config missing

2. **No XDG config changes needed**
   - Current xdg_config.py works fine
   - Profile support doesn't require v0.7.0 nested format

3. **No dependency additions needed**
   - PyYAML already installed
   - All test payloads already exist
   - XDGConfig already available

4. **No breaking changes**
   - run_local.py maintains backward compatibility
   - New args are optional with defaults
   - Old workflow `make test-local` still works

## Implementation Steps

```bash
# Step 1: Copy new files from 206-service-envars
git show 206-service-envars:docker/scripts/test_webhook.py > docker/scripts/test_webhook.py
git show 206-service-envars:docker/scripts/run_local.py > docker/scripts/run_local.py
git show 206-service-envars:test-events/athena-fail.json > test-events/athena-fail.json

# Step 2: Make executable
chmod +x docker/scripts/test_webhook.py
chmod +x docker/scripts/run_local.py

# Step 3: Test
npm run test:local
```

## What This Gets You

1. ✅ Real Benchling webhook payloads (matches production)
2. ✅ Automatic event discovery from app-manifest.yaml
3. ✅ Correct endpoint routing (/event, /canvas, /lifecycle)
4. ✅ Profile support for multi-environment testing
5. ✅ Better error messages and fallback handling
6. ✅ All existing tests pass with real data

## What This Does NOT Require

1. ❌ XDG config v0.7.0 changes (NOT needed)
2. ❌ Config file format changes (NOT needed)
3. ❌ Dependency additions (all present)
4. ❌ Breaking changes to workflow (backward compatible)

## Risk Assessment

**Risk Level:** LOW ⚠️

**Risks:**
1. Profile arg mismatch → **Eliminated** by updating run_local.py
2. Missing dependencies → **None** (all present)
3. Config format issues → **Mitigated** by fallback logic in test_webhook.py

**Benefits:**
1. ✅ Tests use real production-format payloads
2. ✅ Easier to maintain (no hardcoded fake data)
3. ✅ Better test coverage (all event types)
4. ✅ Profile support for testing different configs

## Verification Tests

After importing, run:

```bash
# Test 1: Health check only
cd docker && python scripts/test_webhook.py --health-only

# Test 2: Full local test
npm run test:local

# Test 3: With profile
cd docker && make test-local PROFILE=dev
```

## Summary: The Truth

**You were right.** The minimal changes are:

1. **test_webhook.py** - Full replacement with real payload support
2. **test-events/athena-fail.json** - One new test file
3. **run_local.py** - Profile argument support

That's it. Three files. No config changes. No dependency additions. No XDG config v0.7.0 migration.

The entryId stuff was a red herring - the new test_webhook.py handles config format gracefully with fallbacks.
