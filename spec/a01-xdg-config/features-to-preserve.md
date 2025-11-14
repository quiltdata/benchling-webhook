# XDG Config Features to Preserve During Merge

## Current State (fix/xdg-test-isolation branch)

### Key Features Already Implemented

1. **Test Isolation** (PR #210, #212 - merged to main)
   - Tests use in-memory mock storage instead of real XDG directories
   - `MockXDGConfig` class in [test/helpers/mock-xdg-config.ts](test/helpers/mock-xdg-config.ts)
   - Prevents tests from overwriting user config
   - All test files refactored to use dependency injection

2. **Abstract Base Class Pattern**
   - `XDGBase` abstract class for dependency injection
   - Concrete implementations: `XDGConfig` (real) and `MockXDGConfig` (tests)
   - Located in [lib/xdg-base.ts](lib/xdg-base.ts) and [lib/xdg-config.ts](lib/xdg-config.ts)

3. **Centralized Python CLI** (from XDG migration docs)
   - Single source of truth for XDG operations
   - Pydantic schemas with field aliasing (camelCase ↔ snake_case)
   - CLI commands: read, write, merge, validate, get, set, export, list
   - TypeScript wrapper for seamless integration

4. **Field Name Consistency**
   - Fixed mismatches between TypeScript and Python
   - Automatic aliasing in Pydantic models
   - Ensures secrets format consistency

## PR #209 Changes (partially extracted)

### Already Merged to Main
- Auto-sync secrets after setup wizard
- Improved setup wizard next steps (npm scripts)
- Deploy verifies secrets instead of force-updating

### Still on fix-deploy Branch
- Cleaned up `config_resolver.py`:
  - Removed obsolete QueueUrl/PackagerQueueArn fallback code
  - Only uses `PackagerQueueUrl` from CloudFormation outputs
  - Removed unused `QUEUE_ARN_REGEX` and `to_queue_url()` function
  - Added `queue_url` to success log output

## Main Branch Updates Not Yet in fix-deploy

PR #210: "Fix: Prevent tests from overwriting user XDG config"
- This is the main conflict - features were extracted from PR #209 and merged separately

## Merge Strategy

1. **Prioritize main**: Accept main's version for test isolation features
2. **Preserve**: Python config resolver cleanup (queue URL changes)
3. **Verify**: All tests pass after merge, especially XDG-related tests
4. **Check**: No regression in setup wizard, secrets sync, or deploy behavior
