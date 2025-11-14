# Manual Stack Selection - BenchlingSecret Detection

## Problem Statement

When a user manually enters a Quilt stack ARN during setup (by rejecting the auto-detected stack), the system fails to query that manually entered stack for its BenchlingSecret output. This results in:

1. The wizard not detecting that the stack has an integrated BenchlingSecret
2. The wizard not offering the integrated vs standalone choice
3. The wizard using an old secretArn from previous config instead of the current stack's secret

## Current Behavior

### Scenario: User rejects auto-detected stack and enters different stack ARN

**Setup flow:**
1. Auto-inference finds `quilt-staging` stack (us-east-1)
2. User says "no" to confirmation prompt
3. Wizard prompts for manual entry
4. User enters `bench.dev.quilttest.com` catalog
5. User enters `arn:aws:cloudformation:us-east-2:....:stack/tf-dev-bench/...`
6. **BUG**: System does NOT query `tf-dev-bench` stack for BenchlingSecret
7. Wizard shows old secretArn from previous config: `quiltdata/benchling-webhook/bench/quilt-dtt`
8. This is WRONG - should show: `arn:aws:secretsmanager:us-east-2:...:secret:BenchlingSecret-...`

## Expected Behavior

### After user enters stack ARN manually:

1. User enters stack ARN in wizard prompt
2. **IMMEDIATELY after Quilt prompts complete**, before Benchling prompts:
   - Parse region from the entered ARN
   - Query CloudFormation DescribeStacks for that ARN
   - Check stack outputs for `BenchlingSecretArn` or `BenchlingSecret`
   - If found, store it in `config.benchling.secretArn`
3. When Benchling prompt section starts:
   - If secretArn was found, show the integrated/standalone choice prompt
   - Display the CORRECT secretArn from the newly selected stack

## Root Cause Analysis

### Location: `bin/commands/setup-wizard.ts`

#### Issue 1: Inference happens BEFORE wizard (lines 792-816)
```typescript
const inferenceResult = await inferQuiltConfig({...});
inferredBenchlingSecretArn = inferenceResult.benchlingSecretArn;
```

- This only captures secrets from stacks found during auto-inference
- When user manually enters a stack ARN, this inference has already completed
- The manually entered ARN is NOT queried

#### Issue 2: Existing config prioritization (lines 894-903)
```typescript
// WRONG: Prioritizes old config over fresh inference
secretArn: existingConfig?.benchling?.secretArn || inferredBenchlingSecretArn
```

- When re-running setup, old secretArn takes precedence
- Even if we query the new stack, old value wins

#### Issue 3: Post-wizard query is too late (lines 857-906)
```typescript
// This runs AFTER wizard completes
if (config.quilt?.stackArn && config.quilt.stackArn !== quiltConfig.stackArn) {
    // Query for BenchlingSecret
}
```

- The query happens after `runConfigWizard()` completes
- By then, the Benchling prompts have already run
- The detected secret is never used in the prompts

## Solution Design

### Fix Location: Inside `runConfigWizard` function

**After Quilt configuration prompts complete** (after line 477):

```typescript
config.quilt = {
    stackArn: quiltAnswers.stackArn,
    catalog: quiltAnswers.catalog,
    database: quiltAnswers.database,
    queueUrl: quiltAnswers.queueUrl,
    region: quiltRegion,
};

// NEW: Query manually entered stack for BenchlingSecret
if (quiltAnswers.stackArn) {
    console.log("\nQuerying stack for BenchlingSecret...");

    try {
        const { CloudFormationClient, DescribeStacksCommand } =
            await import("@aws-sdk/client-cloudformation");

        // Parse region from ARN
        const arnMatch = quiltAnswers.stackArn.match(
            /^arn:aws:cloudformation:([a-z0-9-]+):/
        );
        const stackRegion = arnMatch ? arnMatch[1] : quiltRegion;

        const cfnClient = new CloudFormationClient({ region: stackRegion });
        const response = await cfnClient.send(
            new DescribeStacksCommand({ StackName: quiltAnswers.stackArn })
        );

        const outputs = response.Stacks?.[0]?.Outputs || [];
        const secretOutput = outputs.find(
            o => o.OutputKey === "BenchlingSecretArn" ||
                 o.OutputKey === "BenchlingSecret"
        );

        if (secretOutput?.OutputValue) {
            console.log(chalk.green(
                `✓ Found BenchlingSecret: ${secretOutput.OutputValue}\n`
            ));

            // Update config with detected secret
            if (!config.benchling) {
                config.benchling = {} as any;
            }
            config.benchling.secretArn = secretOutput.OutputValue;
        } else {
            console.log(chalk.dim("  No BenchlingSecret in stack\n"));
        }
    } catch (error) {
        console.log(chalk.yellow(
            `⚠️  Could not query stack: ${(error as Error).message}\n`
        ));
    }
}

// NOW Benchling prompts will see the correct secretArn
console.log("\nStep 2: Benchling Configuration\n");
```

### Fix Priority Order

Also update line 894-903 to prefer fresh inference:

```typescript
// IMPORTANT: Prefer freshly inferred secret over existing config
if (inferredBenchlingSecretArn || existingConfig?.benchling?.secretArn) {
    (partialConfig as any).benchling = {
        ...existingConfig?.benchling,
        // Fresh inference takes precedence ✓
        secretArn: inferredBenchlingSecretArn || existingConfig?.benchling?.secretArn,
    };
}
```

**Note**: This fix is ALREADY applied in current code (line 901).

## Testing Scenarios

### Scenario 1: Accept auto-detected stack
1. Run `npm run setup -- --profile bench`
2. Auto-detects `quilt-staging` with BenchlingSecret
3. User confirms "yes"
4. **Expected**: Shows integrated/standalone prompt with correct secret ARN

### Scenario 2: Reject auto-detected, enter different stack
1. Run `npm run setup -- --profile bench`
2. Auto-detects `quilt-staging` (us-east-1)
3. User says "no"
4. User enters `bench.dev.quilttest.com`
5. User enters `arn:aws:cloudformation:us-east-2:...:stack/tf-dev-bench/...`
6. **Expected**:
   - System queries `tf-dev-bench` stack
   - Detects `BenchlingSecretArn` output
   - Shows integrated/standalone prompt with correct secret ARN from us-east-2

### Scenario 3: Stack without BenchlingSecret
1. User enters stack ARN that has no BenchlingSecret output
2. **Expected**:
   - System queries stack
   - Finds no BenchlingSecret
   - Does NOT show integrated/standalone prompt
   - Proceeds with standalone mode only

## Implementation Checklist

- [ ] Add CloudFormation query inside `runConfigWizard` after Quilt prompts
- [ ] Verify fresh inference takes precedence (already done at line 901)
- [ ] Remove redundant post-wizard query (lines 857-906) - now obsolete
- [ ] Test Scenario 1: Accept auto-detected stack
- [ ] Test Scenario 2: Reject and enter different stack
- [ ] Test Scenario 3: Stack without BenchlingSecret
- [ ] Update documentation with new flow

## Files to Modify

1. **`bin/commands/setup-wizard.ts`**
   - Add query logic after line 477 (after Quilt config assignment)
   - Remove lines 857-906 (redundant post-wizard query)

2. **`docs/integrated-stack-setup.md`**
   - Update to document manual stack entry flow
   - Add note about automatic re-querying when stack changes

## Success Criteria

✅ When user manually enters a different stack ARN:
- System automatically queries that stack for BenchlingSecret
- Correct secret ARN is shown in integrated/standalone prompt
- Old config values don't override fresh stack detection
- Flow works regardless of whether inference succeeded initially
