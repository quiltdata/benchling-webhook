# Fix: Duplicate Catalog Prompt and Re-checking

**Date**: 2025-11-14
**Status**: ✅ FIXED
**Issue**: Phase 2 was re-checking quilt3 config after user entered catalog manually

---

## Problem

When user manually entered a catalog DNS in Phase 1, Phase 2 would:
1. Call `inferQuiltConfig()` without parameters
2. `inferQuiltConfig()` would re-check quilt3 CLI config
3. Find the WRONG catalog (from quilt3 config)
4. Prompt user AGAIN: "Is this the correct catalog?"

This resulted in:
- **Two catalog prompts** (Phase 1 and inside inferQuiltConfig)
- **Wrong catalog being used** (ignored user's manual entry)
- **Wrong BenchlingSecret** (from wrong catalog's stack)

---

## Root Cause

`inferQuiltConfig()` did not accept a `catalogDns` parameter, so it ALWAYS:
1. Checked quilt3 CLI config first
2. Used that catalog instead of the confirmed one
3. Prompted for confirmation even though user already chose

---

## Solution

### 1. Modified `inferQuiltConfig()` Function

**File**: `bin/commands/infer-quilt-config.ts`

Added optional `catalogDns` parameter:

```typescript
export async function inferQuiltConfig(options: {
    region?: string;
    profile?: string;
    interactive?: boolean;
    yes?: boolean;
    catalogDns?: string; // NEW: If provided, skip quilt3 check
}): Promise<InferenceResult>
```

**Behavior**:
- If `catalogDns` provided: Skip quilt3 check, use provided catalog
- If `catalogDns` NOT provided: Check quilt3 config (old behavior)

**Implementation**:
```typescript
if (catalogDns) {
    // Use the provided catalog DNS - skip quilt3 check
    console.log(`Using provided catalog: ${catalogDns}`);
    const catalogUrl = catalogDns.startsWith('http') ? catalogDns : `https://${catalogDns}`;
    result.catalog = catalogUrl;
    result.source = "provided";
    quilt3Config = { catalogUrl }; // For config.json fetch
} else {
    // Try quilt3 CLI command (old behavior)
    console.log("Checking quilt3 CLI configuration...");
    quilt3Config = getQuilt3Catalog();
    // ...
}
```

### 2. Disabled Interactive Prompts When Catalog Provided

**File**: `bin/commands/infer-quilt-config.ts`

Modified three confirmation prompts to NOT ask when `catalogDns` is provided:

```typescript
// Before: Always prompted
if (!yes && interactive) {
    // Ask user to confirm...
}

// After: Only prompt if catalog was NOT explicitly provided
if (!yes && interactive && !catalogDns) {
    // Ask user to confirm...
}
```

This prevents the double prompt issue.

### 3. Updated Phase 2 to Pass Catalog

**File**: `lib/wizard/phase2-stack-query.ts`

Now passes the confirmed catalog to `inferQuiltConfig()`:

```typescript
const inferenceResult = await inferQuiltConfig({
    region: awsRegion,
    profile: awsProfile,
    interactive: false, // Don't prompt - we already have the catalog
    yes: true, // Auto-confirm - we already got user's catalog choice
    catalogDns: catalogDns, // Pass the confirmed catalog
});
```

---

## Result

### Before Fix

```
Step 1: Catalog Discovery
Detected catalog: nightly.quilttest.com
✔ Is nightly.quilttest.com the correct catalog? No
✔ Enter catalog DNS name: bench.dev.quilttest.com

Step 2: Stack Query
Checking quilt3 CLI configuration...              ← ❌ RE-CHECKS quilt3
Found quilt3 CLI configuration: nightly.quilttest.com  ← ❌ IGNORES user input
Fetching catalog configuration from nightly.quilttest.com...  ← ❌ WRONG CATALOG
...
Is this the correct catalog? (y/n):               ← ❌ ASKS AGAIN
```

### After Fix

```
Step 1: Catalog Discovery
Detected catalog: nightly.quilttest.com
✔ Is nightly.quilttest.com the correct catalog? No
✔ Enter catalog DNS name: bench.dev.quilttest.com

Step 2: Stack Query
Using provided catalog: bench.dev.quilttest.com   ← ✅ USES CONFIRMED CATALOG
Fetching catalog configuration from https://bench.dev.quilttest.com...  ← ✅ CORRECT
Searching for Quilt CloudFormation stacks...
Found 1 Quilt stack(s):
Using stack: tf-dev-bench                         ← ✅ CORRECT STACK
✓ Found BenchlingSecret: arn:aws:secretsmanager:us-east-2:712023778557:secret:BenchlingSecret-...  ← ✅ CORRECT SECRET
```

---

## Files Changed

1. **bin/commands/infer-quilt-config.ts**
   - Added `catalogDns` parameter to function signature
   - Skip quilt3 check when `catalogDns` provided
   - Disable interactive prompts when `catalogDns` provided

2. **lib/wizard/phase2-stack-query.ts**
   - Pass `catalogDns` to `inferQuiltConfig()`
   - Set `interactive: false` and `yes: true` to prevent prompts

---

## Testing

### Manual Test

```bash
npm run setup -- --profile bench

# Expected flow:
# 1. Detects wrong catalog
# 2. User enters correct catalog
# 3. Phase 2 uses correct catalog (no re-check)
# 4. Finds correct stack
# 5. Finds correct BenchlingSecret
# 6. NO duplicate prompts
```

### Build Status

✅ TypeScript compilation successful

---

## Success Criteria

✅ Only ONE catalog confirmation prompt
✅ Phase 2 uses the confirmed catalog (no re-check)
✅ Correct stack is queried
✅ Correct BenchlingSecret is found
✅ No duplicate prompts
✅ TypeScript builds successfully

---

## Related Issues

This fix addresses part of the bugs from:
- `206-fix-setup-flow-bugs.md` - Issue #2 (duplicate prompts)
- `206-fix-setup-flow-bugs.md` - Issue #3 (doesn't re-query stack)
- `206-fix-setup-flow-bugs.md` - Issue #4 (wrong BenchlingSecret)
