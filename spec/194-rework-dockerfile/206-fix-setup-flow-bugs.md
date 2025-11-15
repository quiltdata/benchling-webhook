# Fix Setup Flow Bugs - Critical Issues

**Date**: 2025-11-14
**Priority**: 🔴 CRITICAL
**Status**: 🔴 Not Started

---

## Observed Issues from Test Run

### Test Command
```bash
npm run setup -- --profile bench
```

### Issue 1: Does NOT Ask to Confirm DNS BEFORE Getting Stack ❌

**What Happens**:
```
Inferring Quilt configuration from AWS...
Checking quilt3 CLI configuration...
Found quilt3 CLI configuration: https://nightly.quilttest.com
Fetching catalog configuration from https://nightly.quilttest.com...
✓ Found catalog region: us-east-1
Searching for Quilt CloudFormation stacks...
```

**Problem**: The code calls `inferQuiltConfig()` which queries AWS stacks BEFORE asking the user to confirm the catalog DNS.

**Required Behavior**:
1. Detect catalog DNS from quilt3 config
2. **ASK USER**: "Is nightly.quilttest.com the correct catalog?"
3. If NO: prompt for correct catalog DNS
4. **ONLY THEN** call `inferQuiltConfig()` with the confirmed catalog

**Fix Location**: `bin/commands/setup-wizard.ts` - Move catalog confirmation BEFORE `inferQuiltConfig()` call

---

### Issue 2: Asks the SAME Question TWICE ❌

**What Happens**:
```
Is this the correct catalog? (y/n): n
Will prompt for Quilt configuration manually.

╔═══════════════════════════════════════════════════════════╗
║   Benchling Webhook Configuration Wizard                 ║
╚═══════════════════════════════════════════════════════════╝

Step 1: Quilt Catalog Discovery

Detected catalog: nightly.quilttest.com

✔ Is nightly.quilttest.com the correct catalog? No
✔ Enter catalog DNS name: bench.dev.quilttest.com
```

**Problem**: Two separate prompts asking about catalog confirmation:
1. First prompt: "Is this the correct catalog? (y/n)"
2. Second prompt: "Is nightly.quilttest.com the correct catalog?"

**Required Behavior**:
- Only ONE catalog confirmation prompt
- Should be in Phase 1 (Catalog Discovery)
- Should happen BEFORE any AWS queries

**Fix Location**: Remove the duplicate prompt, keep only the Phase 1 prompt

---

### Issue 3: Does NOT Query Stack After Entering Real Catalog ❌

**What Happens**:
After user enters the correct catalog (`bench.dev.quilttest.com`), the wizard prompts for:
```
Step 2: Quilt Stack Configuration

✔ Quilt Stack ARN: arn:aws:cloudformation:us-east-2:712023778557:stack/tf-dev-bench/...
✔ Quilt Athena Database: userathenadatabase-2mh8qnxed5rb
✔ SQS Queue URL: https://sqs.us-east-2.amazonaws.com/712023778557/...
```

**Problem**: When user provides a different catalog DNS, the code should:
1. Query the stack for that catalog
2. Extract ALL parameters automatically
3. NOT prompt for stackArn, database, queueUrl (these should be queried)

**Required Behavior**:
- After user enters correct catalog DNS, call `inferQuiltConfig(catalogDns)` again
- Extract: stackArn, database, queueUrl, region, account, BenchlingSecret
- Do NOT prompt for parameters that can be queried

**Fix Location**: After manual catalog entry, must call `inferQuiltConfig()` with the new catalog DNS

---

### Issue 4: Does NOT Find the Correct BenchlingSecret ❌

**What Happens**:
```
✓ Found BenchlingSecret in Quilt stack: arn:aws:secretsmanager:us-east-2:712023778557:secret:quiltdata/benchling-webhook/bench/quilt-dtt-sNUKXB
```

**Expected**:
```
The correct BenchlingSecret should be: arn:aws:secretsmanager:us-east-2:712023778557:secret:BenchlingSecret-gOM1ChBg4MK4-SWOYDs
```

**Problem**: The code is finding the wrong secret. It should find the `BenchlingSecret` from the Quilt stack outputs, NOT a previously created standalone secret.

**Root Cause**:
- `inferQuiltConfig()` is NOT being called with the correct catalog after user enters it manually
- OR the stack query is not extracting the BenchlingSecret output correctly

**Required Behavior**:
- Query the CloudFormation stack for catalog `bench.dev.quilttest.com`
- Find the stack output named `BenchlingSecret`
- Should find: `arn:aws:secretsmanager:us-east-2:712023778557:secret:BenchlingSecret-gOM1ChBg4MK4-SWOYDs`

**Fix Location**:
- Ensure `inferQuiltConfig()` is called with correct catalog
- Verify stack output extraction in `infer-quilt-config.ts`

---

### Issue 5: STILL Tries to Deploy Standalone Stack ❌

**What Happens**:
```
✓ Setup complete!

═══════════════════════════════════════════════════════════

Step 2: Deployment

? Deploy to AWS now? (Y/n)
```

**Problem**: In INTEGRATED MODE (user said YES to using existing BenchlingSecret), the wizard should:
- Update the secret
- Save config with `integratedStack: true`
- **EXIT cleanly** - NO deployment prompt

But instead it's asking "Deploy to AWS now?"

**Required Behavior**:
- Integrated mode: NO deployment prompt
- Should exit with message about getting webhook URL from Quilt stack
- Only standalone mode should ask about deployment

**Fix Location**: Check the mode decision logic - ensure integrated mode path does NOT show deployment prompt

---

## Root Cause Analysis

### The Flow is Still Wrong

The current implementation has these problems:

1. **Catalog confirmation happens AFTER stack query** (should be BEFORE)
2. **Duplicate catalog prompts** (should be only ONE)
3. **Manual catalog entry doesn't re-query stack** (should call inferQuiltConfig again)
4. **Wrong secret ARN being used** (because stack wasn't re-queried with correct catalog)
5. **Integrated mode still prompts for deployment** (should exit cleanly)

### Correct Flow (MUST FOLLOW THIS EXACTLY)

```
1. Detect catalog DNS from quilt3 config
   ├─→ Found: "nightly.quilttest.com"
   └─→ ASK: "Is nightly.quilttest.com the correct catalog?"

2. If YES:
   ├─→ Use "nightly.quilttest.com"
   └─→ GO TO STEP 3

   If NO:
   ├─→ PROMPT: "Enter catalog DNS name:"
   ├─→ User enters: "bench.dev.quilttest.com"
   └─→ GO TO STEP 3

3. Query stack for confirmed catalog
   ├─→ Call: inferQuiltConfig(confirmedCatalogDns)
   ├─→ Extract: stackArn, database, queueUrl, region, account, BenchlingSecret
   └─→ GO TO STEP 4

4. Collect remaining parameters
   ├─→ Benchling credentials
   ├─→ Package settings
   └─→ Deployment config (only what wasn't queried)
   └─→ GO TO STEP 5

5. Validate ALL parameters
   └─→ GO TO STEP 6

6. Deployment mode decision
   ├─→ If BenchlingSecret exists:
   │   └─→ ASK: "Use existing BenchlingSecret from Quilt stack?"
   │
   └─→ If BenchlingSecret does NOT exist:
       └─→ Use standalone mode (no prompt needed)

7. Integrated Mode Path (user said YES)
   ├─→ Update BenchlingSecret ARN
   ├─→ Save config with integratedStack: true
   ├─→ Show success message
   └─→ EXIT (NO deployment prompt)

8. Standalone Mode Path (user said NO or no BenchlingSecret)
   ├─→ Create new secret
   ├─→ Save config with integratedStack: false
   ├─→ ASK: "Deploy to AWS now?"
   ├─→ If YES: deploy
   └─→ If NO: show manual instructions
```

---

## Required Fixes

### Fix 1: Move Catalog Confirmation BEFORE Stack Query

**File**: `bin/commands/setup-wizard.ts`

**Before** (WRONG):
```typescript
// Infer Quilt configuration
const quiltConfig = await inferQuiltConfig(); // ❌ Queries BEFORE asking user

// Ask user
const confirmCatalog = await inquirer.prompt(...); // ❌ Too late
```

**After** (CORRECT):
```typescript
// 1. Detect catalog from quilt3 config
const detectedCatalog = getQuilt3CatalogDns(); // Read from quilt3 config, don't query AWS

// 2. Ask user FIRST
const confirmCatalog = await inquirer.prompt({
  type: 'confirm',
  name: 'confirmed',
  message: `Is ${detectedCatalog} the correct catalog?`,
  default: true
});

let catalogDns = detectedCatalog;

// 3. If not confirmed, prompt for manual entry
if (!confirmCatalog.confirmed) {
  const manualCatalog = await inquirer.prompt({
    type: 'input',
    name: 'catalogDns',
    message: 'Enter catalog DNS name:',
    validate: (input) => input.length > 0
  });
  catalogDns = manualCatalog.catalogDns;
}

// 4. NOW query the stack with confirmed catalog
const quiltConfig = await inferQuiltConfig(catalogDns); // ✅ Query AFTER confirmation
```

---

### Fix 2: Remove Duplicate Catalog Prompt

**File**: `bin/commands/setup-wizard.ts`

Find and remove the FIRST catalog prompt (the one that happens before the wizard header).

Keep ONLY the Phase 1 prompt inside the wizard.

---

### Fix 3: Re-query Stack After Manual Catalog Entry

**File**: `bin/commands/setup-wizard.ts`

Ensure that after user manually enters a catalog DNS, the code calls `inferQuiltConfig(catalogDns)` to get the stack parameters.

---

### Fix 4: Fix BenchlingSecret Extraction

**File**: `bin/commands/infer-quilt-config.ts`

Verify that the stack output extraction is looking for the correct output name.

The Quilt stack has an output named `BenchlingSecret` (not `BenchlingSecretArn`).

```typescript
// Find BenchlingSecret output
const benchlingSecretOutput = outputs.find(
  (o) => o.OutputKey === 'BenchlingSecret' // ✅ Correct name
);

if (benchlingSecretOutput?.OutputValue) {
  result.BenchlingSecret = benchlingSecretOutput.OutputValue;
}
```

---

### Fix 5: Exit Cleanly in Integrated Mode

**File**: `bin/commands/setup-wizard.ts`

After integrated mode completes (secret updated, config saved), the code must:

```typescript
if (integratedMode) {
  // Update secret
  await syncSecretsToAWS(...);

  // Save config
  await configStorage.writeProfile(profile, config);

  // Show success message
  console.log('✓ Setup complete!');
  console.log('\nIntegrated mode: Your Quilt stack already has the webhook configured.');
  console.log('To get the webhook URL, run:');
  console.log(`  aws cloudformation describe-stacks --stack-name ${stackName} --query "Stacks[0].Outputs[?OutputKey=='WebhookUrl'].OutputValue" --output text`);

  // EXIT - do NOT continue to deployment
  return; // ✅ EXIT HERE
}

// Standalone mode continues here...
```

---

## Testing Requirements

### Manual Test Script

```bash
# Test 1: Integrated Mode with Wrong Initial Catalog
npm run setup -- --profile test-integrated

# Expected flow:
# 1. Detects wrong catalog
# 2. User declines
# 3. User enters correct catalog: bench.dev.quilttest.com
# 4. Queries stack for correct catalog
# 5. Finds BenchlingSecret: arn:...secret:BenchlingSecret-gOM1ChBg4MK4-SWOYDs
# 6. User says YES to using it
# 7. Updates secret
# 8. Saves config with integratedStack: true
# 9. Exits cleanly - NO deployment prompt

# Test 2: Standalone Mode
npm run setup -- --profile test-standalone

# Expected flow:
# 1. User confirms catalog or enters manual
# 2. Queries stack
# 3. No BenchlingSecret OR user says NO
# 4. Creates new secret: quiltdata/benchling-webhook/<profile>/<tenant>
# 5. Saves config with integratedStack: false
# 6. Asks: "Deploy to AWS now?"
# 7. User can choose yes or no
```

---

## Success Criteria

1. ✅ Catalog confirmation happens BEFORE any AWS queries
2. ✅ Only ONE catalog confirmation prompt (no duplicates)
3. ✅ Manual catalog entry triggers stack re-query
4. ✅ Correct BenchlingSecret ARN is found from stack outputs
5. ✅ Integrated mode exits cleanly without deployment prompt
6. ✅ Standalone mode prompts for deployment as expected

---

## Implementation Notes

**DO NOT** proceed with any other work until these bugs are fixed and tested.

These are critical user-facing bugs that make the setup wizard unusable.
