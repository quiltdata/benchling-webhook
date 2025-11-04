# CRITICAL: npm Packaging Architecture Flaw

**Date:** 2025-11-04
**Status:** 🚨 BLOCKING ISSUE
**Severity:** Critical - Breaks published package
**Discovered During:** Script consolidation follow-up review

---

## Problem Statement

**The current script consolidation (PR #192) has a critical architectural flaw that will break the published npm package.**

### The Issue

1. **CLI imports from `scripts/`**:
   ```typescript
   // bin/commands/setup-wizard.ts (PUBLISHED)
   import { inferQuiltConfig, inferenceResultToDerivedConfig } from "../../scripts/infer-quilt-config";
   import { syncSecretsToAWS } from "../../scripts/sync-secrets";
   ```

2. **`.npmignore` excludes `scripts/`**:
   ```
   # Development scripts and specs (NOT published)
   scripts/
   spec/
   ```

3. **Result**: The published CLI will fail because imported modules are missing.

---

## Root Cause Analysis

The consolidation mistakenly treated **ALL** scripts as "dev-only tools" when in reality:

| Script | Type | Used By | Should Publish? |
|--------|------|---------|-----------------|
| `infer-quilt-config.ts` | **Library** | `bin/commands/setup-wizard.ts` | ✅ YES |
| `sync-secrets.ts` | **Library** | `bin/commands/setup-wizard.ts` | ✅ YES |
| `config-health-check.ts` | **Library** | Exports class, has main() | ⚠️ HYBRID |
| `check-logs.ts` | **Executable** | npm script only | ❌ NO |
| `send-event.ts` | **Executable** | npm script only | ❌ NO |
| `test-invalid-signature.ts` | **Executable** | npm script only | ❌ NO |
| `version.ts` | **Executable** | npm script only | ❌ NO |
| `release-notes.sh` | **Executable** | npm script only | ❌ NO |
| `dev-deploy.ts` | **Executable** | npm script only (legacy) | ❌ NO |

### Exported Functions Analysis

```typescript
// scripts/infer-quilt-config.ts
export async function inferQuiltConfig(options: {...}): Promise<InferenceResult>
export function inferenceResultToDerivedConfig(result: InferenceResult): DerivedConfig

// scripts/sync-secrets.ts
export async function syncSecretsToAWS(options: SyncSecretsOptions): Promise<SyncResult[]>
export async function getSecretsFromAWS(options: {...}): Promise<string>
export async function validateSecretsAccess(options: {...}): Promise<boolean>

// scripts/config-health-check.ts
export class ConfigHealthChecker { ... }
export type { HealthStatus, HealthCheckResult }
```

**Only 3 scripts export functions/classes** - these are libraries, not executables!

---

## Impact Assessment

### If We Ship As-Is (PR #192)

```bash
npm install -g @quiltdata/benchling-webhook
benchling-webhook  # Run CLI

# Error:
Error: Cannot find module '../../scripts/infer-quilt-config'
```

**Result**: Published package is completely broken.

### Current PR #192 Status

- ✅ TypeScript compiles (because scripts/ exists in repo)
- ✅ Tests pass (because scripts/ exists in repo)
- ❌ Published package will fail (because scripts/ excluded by .npmignore)
- ❌ Nobody tested `npm pack` before shipping

---

## Solution Options

### Option 1: Move Libraries to `lib/` (RECOMMENDED)

Move imported utilities to `lib/` where they belong:

```
lib/
├── config/
│   └── health-checker.ts      # From scripts/config-health-check.ts (exports only)
├── setup/
│   ├── infer-quilt.ts          # From scripts/infer-quilt-config.ts (exports only)
│   └── sync-secrets.ts         # From scripts/sync-secrets.ts (exports only)
└── ...

scripts/
├── check-logs.ts               # Pure executable
├── send-event.ts               # Pure executable
├── test-invalid-signature.ts   # Pure executable
├── version.ts                  # Pure executable
└── release-notes.sh            # Pure executable
```

**Changes needed:**
```typescript
// bin/commands/setup-wizard.ts
import { inferQuiltConfig, inferenceResultToDerivedConfig } from "../../lib/setup/infer-quilt";
import { syncSecretsToAWS } from "../../lib/setup/sync-secrets";
```

**Standalone executables (with main()):**
```typescript
// scripts/check-logs.ts (calls lib if needed)
import { ... } from "../lib/...";
async function main() { ... }
if (require.main === module) { main(); }
```

**Benefits:**
- ✅ Clear separation: `lib/` = libraries (published), `scripts/` = executables (not published)
- ✅ Published package works correctly
- ✅ Standard Node.js convention (`lib/` for libraries)
- ✅ No confusion about what gets published

**Drawbacks:**
- Requires restructuring imports
- More directory nesting

---

### Option 2: Remove `scripts/` from `.npmignore`

Just publish everything:

```diff
# .npmignore
- scripts/
  spec/
```

**Benefits:**
- ✅ Minimal changes
- ✅ Works immediately

**Drawbacks:**
- ❌ Publishes 5 unnecessary executables (check-logs, send-event, etc.)
- ❌ Larger package size (~50KB extra)
- ❌ Confuses users (why are these scripts here?)
- ❌ Violates original intent (keep dev tools internal)

---

### Option 3: Inline Imports into `setup-wizard.ts`

Copy the exported functions directly into the CLI command:

```typescript
// bin/commands/setup-wizard.ts
// (paste 385 lines from infer-quilt-config.ts)
// (paste 454 lines from sync-secrets.ts)
```

**Benefits:**
- ✅ Self-contained, no external dependencies

**Drawbacks:**
- ❌ 839 lines of duplicated code
- ❌ Harder to test
- ❌ Violates DRY principle
- ❌ Makes file massive (1500+ lines)

---

### Option 4: Split Exports from Main Functions

Keep libraries in `scripts/` but with dual-purpose files:

```typescript
// scripts/infer-quilt-config.ts
export async function inferQuiltConfig(...) { ... }  // Published
async function main() { ... }  // Not published (only called if executed directly)
```

Then selectively include in `.npmignore`:

```
# .npmignore
scripts/check-logs.ts
scripts/send-event.ts
scripts/test-invalid-signature.ts
scripts/version.ts
scripts/release-notes.sh
scripts/dev-deploy.ts
# But NOT scripts/infer-quilt-config.ts or scripts/sync-secrets.ts
```

**Benefits:**
- ✅ Minimal restructuring
- ✅ Preserves current organization

**Drawbacks:**
- ❌ Confusing .npmignore (must list every file)
- ❌ Easy to forget to add new scripts
- ❌ Doesn't solve the "scripts/ is for dev tools" mental model

---

## Recommended Solution: Option 1 (Move to `lib/`)

### Implementation Plan

#### Phase 1: Extract Library Code

1. **Create new library structure**:
   ```bash
   mkdir -p lib/setup
   ```

2. **Move and refactor `infer-quilt-config.ts`**:
   ```bash
   # Extract exports to lib/setup/infer-quilt.ts (keep main() in scripts/)
   # OR move entire file and create thin wrapper in scripts/
   ```

3. **Move and refactor `sync-secrets.ts`**:
   ```bash
   # Extract exports to lib/setup/sync-secrets.ts (keep main() in scripts/)
   ```

4. **Handle `config-health-check.ts`**:
   ```bash
   # Extract ConfigHealthChecker class to lib/config/health-checker.ts
   # Keep CLI executable in scripts/config-health-check.ts
   ```

#### Phase 2: Update Imports

1. **Update `bin/commands/setup-wizard.ts`**:
   ```typescript
   import { inferQuiltConfig, inferenceResultToDerivedConfig } from "../../lib/setup/infer-quilt";
   import { syncSecretsToAWS } from "../../lib/setup/sync-secrets";
   ```

2. **Update test imports**:
   ```typescript
   // test/infer-quilt-config.test.ts
   import { inferQuiltConfig } from "../lib/setup/infer-quilt";
   ```

3. **Update npm scripts that call library functions directly**:
   - `npm run setup:infer` → needs a wrapper script in `scripts/`
   - `npm run setup:sync-secrets` → needs a wrapper script in `scripts/`

#### Phase 3: Create Wrapper Scripts

```typescript
// scripts/setup-infer-quilt.ts (new thin wrapper)
import { inferQuiltConfig } from "../lib/setup/infer-quilt";
async function main() {
  // Parse args and call inferQuiltConfig()
}
if (require.main === module) { main(); }
```

```typescript
// scripts/setup-sync-secrets.ts (new thin wrapper)
import { syncSecretsToAWS } from "../lib/setup/sync-secrets";
async function main() {
  // Parse args and call syncSecretsToAWS()
}
if (require.main === module) { main(); }
```

#### Phase 4: Verify Packaging

```bash
npm pack
tar -tzf *.tgz | grep -E "(lib/setup|scripts/)"
# Should see lib/setup/ but NOT scripts/
```

---

## Testing Checklist

- [ ] `npm run build:typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm pack` creates package
- [ ] Extract and verify: `tar -tzf *.tgz` shows `lib/` but not `scripts/`
- [ ] Test published package:
  ```bash
  npm install -g ./quiltdata-benchling-webhook-*.tgz
  benchling-webhook  # Should work
  ```
- [ ] All npm scripts still work:
  - [ ] `npm run setup:infer`
  - [ ] `npm run setup:sync-secrets`
  - [ ] `npm run setup:health`

---

## Why This Wasn't Caught Earlier

1. **No `npm pack` test** in CI or local workflow
2. **TypeScript compiles** because scripts/ exists in repo
3. **Tests pass** because scripts/ exists in repo
4. **Assumed all scripts were dev-only** without checking imports

---

## Recommended Next Steps

1. **BLOCK PR #192** until this is fixed
2. **Implement Option 1** (move libraries to `lib/`)
3. **Add `npm pack` test** to CI workflow
4. **Add packaging verification** to PR checklist

---

## Questions & Answers

**Q: Can we just remove `scripts/` from .npmignore?**
A: Yes, but it publishes unnecessary executables and violates the "dev tools only" principle.

**Q: Why not keep scripts/ and lib/ separate?**
A: Because `lib/` is the standard Node.js convention for libraries. `scripts/` should be executables only.

**Q: Will this break existing npm scripts?**
A: Only if we move the main() functions. We can keep thin wrappers in `scripts/` that import from `lib/`.

**Q: How much refactoring is needed?**
A: Moderate. We need to split 3 files (infer-quilt-config, sync-secrets, config-health-check) into library exports (lib/) and executable wrappers (scripts/).

---

**PRIORITY: CRITICAL - Must fix before merging PR #192**
