# Setup Flow Architecture Breakdown

## Date: 2025-11-07

## The Catastrophic Problem

The setup wizard is **fundamentally broken** because it searches for CloudFormation stacks in the **wrong region**.

### What Happened

User runs: `npm run setup -- --profile bench`

**Expected behavior:**
1. Find catalog URL: `https://bench.dev.quilttest.com` (from quilt3 CLI)
2. Fetch `https://bench.dev.quilttest.com/config.json`
3. Extract region: `us-east-2` from config.json
4. Search for CloudFormation stacks in `us-east-2`
5. Find `quilt-bench` stack (or similar) in `us-east-2`

**Actual broken behavior:**
1. Find catalog URL: `https://bench.dev.quilttest.com` (from quilt3 CLI) ✓
2. **SKIP fetching config.json** ❌
3. **Default to `us-east-1`** ❌
4. Search for CloudFormation stacks in `us-east-1` ❌
5. Find `quilt-staging` stack (WRONG STACK, WRONG REGION) ❌

## The Correct Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Identify Catalog                                    │
│   - Check quilt3 CLI: `quilt3 config`                       │
│   - Or prompt user for catalog URL                          │
│                                                              │
│   Result: catalog URL (e.g., https://bench.dev.quilttest.com)│
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: Fetch config.json from Catalog                      │
│   - Fetch: {catalogUrl}/config.json                         │
│   - Extract: config.region                                  │
│   - Extract: config.apiGatewayEndpoint                      │
│                                                              │
│   Result: region="us-east-2" (THE CORRECT REGION)           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Find CloudFormation Stack in THAT REGION            │
│   - Search in config.region (NOT us-east-1!)                │
│   - Use API Gateway ID to find stack                        │
│   - Or list all Quilt stacks (with QuiltWebHost output)     │
│   - Match by catalog URL                                    │
│                                                              │
│   Result: stack ARN, outputs, parameters                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 4: Extract Configuration from Stack                    │
│   - QUEUE_URL                                                │
│   - QUILT_DATABASE                                           │
│   - All other stack outputs                                  │
└─────────────────────────────────────────────────────────────┘
```

## The Files Involved

### 1. `lib/utils/stack-inference.ts` (OLD, CORRECT)
- **Has**: `inferStackConfig(catalogUrl)` - THE CORRECT FUNCTION
  - Fetches config.json
  - Gets region from config.json
  - Searches for stack in that region
- **Has**: `fetchJson()` - to fetch config.json
- **Has**: `isQuiltStack()`, `findAllQuiltStacks()` - correct stack detection
- Uses CLI commands (`aws cloudformation ...`)

### 2. `bin/commands/infer-quilt-config.ts` (NEW, BROKEN)
- **Missing**: Does NOT fetch config.json!
- **Missing**: Does NOT get region from catalog!
- **Has**: `inferQuiltConfig()` - THE BROKEN FUNCTION
  - Gets catalog URL from quilt3 CLI ✓
  - **THEN IGNORES IT and defaults to us-east-1** ❌
  - Searches wrong region ❌
- Uses AWS SDK v3 (not CLI commands)

### 3. `bin/commands/setup-wizard.ts` (USING THE WRONG FUNCTION)
- Line 24: `import { inferQuiltConfig } from "../commands/infer-quilt-config"`
  - **SHOULD BE**: `import { inferStackConfig } from "../../lib/utils/stack-inference"`
- Line 654: `awsRegion = "us-east-1"` - hardcoded default
- Line 690: Calls `inferQuiltConfig()` - THE BROKEN ONE

## The Recent "Fix" That Made It Worse

**What I just did (WRONG):**
```typescript
// If no region specified, search common regions
const regionsToSearch = region ? [region] : ["us-east-1", "us-east-2", "us-west-2"];
let allStacks: QuiltStackInfo[] = [];

for (const searchRegion of regionsToSearch) {
    const regionStacks = await findQuiltStacks(searchRegion, profile);
    allStacks = allStacks.concat(regionStacks);
}
```

**Why this is TERRIBLE:**
- Searches multiple regions blindly
- Finds stacks in wrong regions
- Doesn't match catalog to stack
- Slow (3x API calls)
- User gets presented with wrong stacks
- **DOES NOT SOLVE THE ROOT PROBLEM**

## The Root Cause

The setup wizard was refactored to use AWS SDK v3 instead of CLI commands, creating `infer-quilt-config.ts`. But this new version **lost the critical config.json fetching logic** that was in `stack-inference.ts`.

## The Correct Fix

### Option A: Use the Old Function (Quick Fix)
1. Change `setup-wizard.ts` to import `inferStackConfig` from `stack-inference.ts`
2. Adapt the return types if needed
3. This function already does everything correctly

### Option B: Fix the New Function (Better Long-term)
1. Add config.json fetching to `infer-quilt-config.ts`:
   ```typescript
   // Step 1.5: If we have a catalog URL, fetch its config.json to get region
   if (quilt3Config?.catalogUrl && !region) {
       const configUrl = quilt3Config.catalogUrl.replace(/\/$/, "") + "/config.json";
       const catalogConfig = await fetchJson(configUrl);
       const catalogRegion = catalogConfig.region;
       console.log(`Found catalog region from config.json: ${catalogRegion}`);
       // Use THIS region for stack search
   }
   ```
2. Only search in that specific region
3. Match stack by catalog URL

## Action Items

1. **REVERT** the multi-region search fix (lines 235-244 in `infer-quilt-config.ts`)
2. **ADD** config.json fetching to `infer-quilt-config.ts`
3. **ENSURE** region from config.json is used for stack search
4. **TEST** with `bench` profile (should find stack in us-east-2, not us-east-1)

## Why This Matters

- **Wrong region** → **Wrong stack** → **Wrong configuration**
- User deploys webhook to wrong AWS account/region
- Webhook points to wrong Quilt catalog
- Data corruption potential
- Complete system failure

## Test Case

```bash
# Should find quilt-bench or similar stack in us-east-2
npm run setup -- --profile bench

# Expected output:
# Found catalog: https://bench.dev.quilttest.com
# Fetching config.json...
# Region from config: us-east-2
# Searching for stacks in us-east-2...
# Found stack: quilt-bench (or tf-dev-bench)
```

## Lesson Learned

**NEVER skip fetching config.json when you have a catalog URL.**

The catalog's config.json contains the **source of truth** for:
- Region
- API Gateway endpoint
- Service bucket
- Analytics bucket
- All critical configuration

This is not optional. This is the foundation of the entire setup process.
