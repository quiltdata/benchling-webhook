# NPX Missing Script Fix Specification

## Issue #221 - Phase 4: Fix Missing `setup:sync-secrets` Script in NPX Context

**Status:** Specification
**Date:** 2025-11-13
**Issue:** When running `npx @quiltdata/benchling-webhook@0.7.4`, the deploy command fails during secret verification with:
```
Command failed: npm run setup:sync-secrets -- --profile default
npm error Missing script: "setup:sync-secrets"
```

---

## Problem Analysis

### Root Cause

The `deploy.ts` command at line 212 executes:
```typescript
execSync(`npm run setup:sync-secrets -- --profile ${options.profileName}`, {
    stdio: "pipe",
    encoding: "utf-8",
    env: {
        ...process.env,
        AWS_REGION: deployRegion,
    },
});
```

**Why this fails in NPX context:**

1. **Package Script Invocation**: When using `npx @quiltdata/benchling-webhook`, the CLI is executed from the installed package in `node_modules/.bin/`
2. **CWD Mismatch**: The `npm run` command looks for scripts in the `package.json` of the **current working directory** (user's project), not the installed package
3. **User Project Context**: The user's project directory doesn't have the `setup:sync-secrets` script - it only exists in the **package** being executed
4. **Script Location**: The `setup:sync-secrets` script is defined in `@quiltdata/benchling-webhook/package.json` at line 36

### Error Flow

```
npx @quiltdata/benchling-webhook
  → Runs bin/cli.ts (from package)
    → installCommand()
      → setupWizardCommand() ✓ (works - uses TypeScript imports)
        → syncSecretsToAWS() ✓ (works - uses TypeScript imports)
      → deployCommand()
        → execSync('npm run setup:sync-secrets ...') ✗ (FAILS)
          → npm looks for script in CWD's package.json
          → User's package.json doesn't have this script
          → Error: Missing script: "setup:sync-secrets"
```

### Why Setup Wizard Works but Deploy Fails

| Component | How It's Called | Result |
| ----------- | ---------------- | -------- |
| Setup Wizard | Direct TypeScript import: `import { syncSecretsToAWS } from './sync-secrets'` | ✓ Works |
| Deploy Command | Shell command: `execSync('npm run setup:sync-secrets ...')` | ✗ Fails |

**Key Insight**: The setup wizard correctly imports and calls `syncSecretsToAWS()` directly, but the deploy command tries to invoke it via npm script, which breaks in NPX context.

---

## Solution Design

### Option 1: Direct TypeScript Import (RECOMMENDED)

**Change**: Replace the shell `execSync('npm run setup:sync-secrets ...')` with direct TypeScript function call.

#### Implementation

**File**: `bin/commands/deploy.ts`

**Before** (lines 209-240):
```typescript
// Verify secrets exist in AWS Secrets Manager
spinner.start("Verifying Benchling secrets in AWS Secrets Manager...");
try {
    // Run sync-secrets without --force to verify/create but not update existing secrets
    const syncOutput = execSync(`npm run setup:sync-secrets -- --profile ${options.profileName}`, {
        stdio: "pipe",
        encoding: "utf-8",
        env: {
            ...process.env,
            AWS_REGION: deployRegion,
        },
    });

    // Parse output to determine action (created/verified/skipped)
    let message = "verified";
    if (syncOutput.includes("Secret created:")) {
        message = "created and verified";
    } else if (syncOutput.includes("Secret already exists:")) {
        message = "verified";
    }

    spinner.succeed(`Secrets ${message}: '${benchlingSecret}'`);
} catch (error) {
    spinner.fail("Failed to verify secrets");
    console.log();
    console.error(chalk.red((error as Error).message));
    console.log();
    console.log(chalk.yellow("To sync secrets manually, run:"));
    console.log(chalk.cyan(`  npm run setup:sync-secrets -- --profile ${options.profileName} --region ${deployRegion}`));
    console.log(chalk.yellow("To force update existing secrets, add --force flag"));
    console.log();
    process.exit(1);
}
```

**After**:
```typescript
import { syncSecretsToAWS, SyncResult } from "./sync-secrets";

// ... later in deploy() function ...

// Verify secrets exist in AWS Secrets Manager
spinner.start("Verifying Benchling secrets in AWS Secrets Manager...");
try {
    // Sync secrets directly - creates/verifies without updating existing secrets
    const results: SyncResult[] = await syncSecretsToAWS({
        profile: options.profileName,
        region: deployRegion,
        force: false, // Don't update existing secrets
    });

    // Determine action from results
    let message = "verified";
    if (results.length > 0) {
        const action = results[0].action;
        if (action === "created") {
            message = "created and verified";
        } else if (action === "skipped") {
            message = "verified (existing)";
        } else if (action === "updated") {
            message = "verified and updated";
        }
    }

    spinner.succeed(`Secrets ${message}: '${benchlingSecret}'`);
} catch (error) {
    spinner.fail("Failed to verify secrets");
    console.log();
    console.error(chalk.red((error as Error).message));
    console.log();
    console.log(chalk.yellow("To sync secrets manually, run:"));
    console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook setup`));
    console.log(chalk.cyan(`  # Or with custom profile:`));
    console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook setup --profile ${options.profileName}`));
    console.log();
    process.exit(1);
}
```

#### Benefits
- ✅ **NPX Compatible**: Works in both local development and NPX contexts
- ✅ **No Shell Dependencies**: Pure TypeScript, no shell execution
- ✅ **Type Safe**: Full TypeScript type checking
- ✅ **Consistent**: Matches how setup wizard already works
- ✅ **Better Error Messages**: Can provide structured error handling
- ✅ **Output Control**: Direct control over console output (no stdout parsing needed)

#### Drawbacks
- None - this is strictly better than shell execution

---

### Option 2: Use ts-node with Absolute Path (NOT RECOMMENDED)

**Change**: Execute sync-secrets.ts directly with ts-node using absolute path resolution.

```typescript
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const syncSecretsPath = join(__dirname, 'sync-secrets.ts');

execSync(`npx ts-node "${syncSecretsPath}" --profile ${options.profileName} --region ${deployRegion}`, {
    stdio: "pipe",
    encoding: "utf-8",
});
```

#### Benefits
- Maintains separation between processes
- Works in NPX context

#### Drawbacks
- ❌ Requires ts-node to be available (might not be in production)
- ❌ More complex path resolution
- ❌ Slower (spawns new process)
- ❌ Still relies on shell execution
- ❌ Still requires parsing stdout for results

---

### Option 3: Add Script Resolution Logic (OVER-ENGINEERED)

**Change**: Detect context and resolve script location dynamically.

```typescript
function getPackageScriptPath(scriptName: string): string {
    const packageRoot = execSync('npm root', { encoding: 'utf-8' }).trim();
    return join(packageRoot, '@quiltdata/benchling-webhook');
}

execSync(`cd "${getPackageScriptPath('setup:sync-secrets')}" && npm run setup:sync-secrets -- --profile ${options.profileName}`, ...);
```

#### Benefits
- Maintains npm script usage

#### Drawbacks
- ❌ Over-engineered
- ❌ Fragile (depends on npm root working correctly)
- ❌ Still requires shell execution
- ❌ Complex error handling

---

## Recommended Solution: Option 1

### Implementation Steps

1. **Update `bin/commands/deploy.ts`**:
   - Add import for `syncSecretsToAWS` and `SyncResult` types
   - Replace `execSync('npm run setup:sync-secrets ...)` with direct function call
   - Update error message to suggest NPX-compatible commands
   - Remove stdout parsing logic (use returned results instead)

2. **Update `bin/commands/sync-secrets.ts`** (if needed):
   - Export `SyncResult` type (already exported)
   - Ensure `syncSecretsToAWS()` function is properly exported (already is)

3. **Test in both contexts**:
   - Local development: `npm run deploy:dev`
   - NPX context: `npx @quiltdata/benchling-webhook --yes`

### Code Changes

#### File: `bin/commands/deploy.ts`

**Lines 1-14** - Add import:
```typescript
import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { prompt } from "enquirer";
import { maskArn } from "../../lib/utils/config";
import {
    parseStackArn,
    ConfigResolverError,
} from "../../lib/utils/config-resolver";
import { checkCdkBootstrap } from "../benchling-webhook";
import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig } from "../../lib/types/config";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { syncSecretsToAWS } from "./sync-secrets"; // ADD THIS LINE
```

**Lines 208-240** - Replace secret verification:
```typescript
// Verify secrets exist in AWS Secrets Manager
spinner.start("Verifying Benchling secrets in AWS Secrets Manager...");
try {
    // Sync secrets directly - creates/verifies without updating existing secrets
    const results = await syncSecretsToAWS({
        profile: options.profileName,
        region: deployRegion,
        force: false, // Don't update existing secrets
    });

    // Determine action from results
    let message = "verified";
    if (results.length > 0) {
        const action = results[0].action;
        if (action === "created") {
            message = "created and verified";
        } else if (action === "skipped") {
            message = "verified (existing)";
        } else if (action === "updated") {
            message = "verified and updated";
        }
    }

    spinner.succeed(`Secrets ${message}`);
} catch (error) {
    spinner.fail("Failed to verify secrets");
    console.log();
    console.error(chalk.red((error as Error).message));
    console.log();
    console.log(chalk.yellow("To sync secrets manually, run:"));
    console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook setup`));
    if (options.profileName !== "default") {
        console.log(chalk.cyan(`  # Or with custom profile:`));
        console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook setup --profile ${options.profileName}`));
    }
    console.log();
    process.exit(1);
}
```

### Testing Strategy

#### Unit Tests

**File**: `test/deploy-command.test.ts` (create if doesn't exist)

```typescript
import { syncSecretsToAWS } from "../bin/commands/sync-secrets";
import { deployCommand } from "../bin/commands/deploy";

jest.mock("../bin/commands/sync-secrets");

describe("Deploy Command - Secret Verification", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should call syncSecretsToAWS directly instead of npm script", async () => {
        const mockSyncSecrets = syncSecretsToAWS as jest.MockedFunction<typeof syncSecretsToAWS>;
        mockSyncSecrets.mockResolvedValue([
            {
                secretName: "test-secret",
                secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                action: "skipped",
                message: "Secret already exists",
            },
        ]);

        // ... rest of test setup ...

        await deployCommand({
            profile: "default",
            yes: true,
            // ... other options
        });

        expect(mockSyncSecrets).toHaveBeenCalledWith({
            profile: "default",
            region: expect.any(String),
            force: false,
        });
    });

    it("should handle secret creation action", async () => {
        const mockSyncSecrets = syncSecretsToAWS as jest.MockedFunction<typeof syncSecretsToAWS>;
        mockSyncSecrets.mockResolvedValue([
            {
                secretName: "test-secret",
                secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                action: "created",
                message: "Secret created successfully",
            },
        ]);

        // Verify spinner shows "created and verified" message
    });

    it("should show NPX-compatible error message on failure", async () => {
        const mockSyncSecrets = syncSecretsToAWS as jest.MockedFunction<typeof syncSecretsToAWS>;
        mockSyncSecrets.mockRejectedValue(new Error("Failed to sync secrets"));

        // Verify error message suggests: npx @quiltdata/benchling-webhook setup
    });
});
```

#### Integration Tests

**Test Case 1: NPX Context**
```bash
# Clean test environment
rm -rf ~/.config/benchling-webhook/test-profile

# Run NPX command
npx @quiltdata/benchling-webhook --yes --profile test-profile

# Expected: Should complete without "Missing script" error
# Expected: Secrets should be created/verified
# Expected: Deployment should proceed
```

**Test Case 2: Local Development Context**
```bash
# From repo root
npm run deploy:dev -- --profile test-profile --yes

# Expected: Should complete without errors
# Expected: Same behavior as NPX context
```

**Test Case 3: Existing Secrets**
```bash
# Create secrets first
npx @quiltdata/benchling-webhook setup --profile existing-profile

# Then deploy
npx @quiltdata/benchling-webhook deploy --profile existing-profile --yes

# Expected: Should skip secret creation
# Expected: Should show "verified (existing)" message
```

---

## Side Effects & Considerations

### Console Output Changes

**Before** (parsing stdout):
- Relied on parsing console output: "Secret created:", "Secret already exists:"
- No structured result object

**After** (using return value):
- Direct access to structured `SyncResult` objects
- More reliable action detection
- Better error handling

### Error Messages

Update all references to `npm run setup:sync-secrets` in error messages to use NPX-compatible commands:

**Current**:
```
To sync secrets manually, run:
  npm run setup:sync-secrets -- --profile default --region us-east-1
```

**Updated**:
```
To sync secrets manually, run:
  npx @quiltdata/benchling-webhook setup

Or with custom profile:
  npx @quiltdata/benchling-webhook setup --profile default
```

### Documentation Updates

Update these files to reflect the change:

1. **README.md**: Ensure deployment examples don't reference npm scripts
2. **MIGRATION.md**: Note that secret verification is now seamless
3. **spec/npx-ux/**: Update any references to manual secret syncing
4. **Error messages**: All references to `npm run setup:sync-secrets`

---

## Acceptance Criteria

### Must Have

- [ ] NPX command completes without "Missing script" error
- [ ] Secret verification works in both NPX and local dev contexts
- [ ] Error messages suggest NPX-compatible commands
- [ ] Existing secrets are properly detected (action: "skipped")
- [ ] New secrets are properly created (action: "created")
- [ ] Secret updates work with --force flag
- [ ] Unit tests cover the new direct function call approach
- [ ] Integration tests pass in NPX context

### Nice to Have

- [ ] Performance improvement from avoiding shell execution
- [ ] Better progress messages during secret sync
- [ ] Structured logging for secret operations

---

## Rollout Plan

### Phase 1: Implementation
1. Update `bin/commands/deploy.ts` with direct import approach
2. Update error messages to use NPX-compatible commands
3. Add unit tests for new behavior

### Phase 2: Testing
1. Run existing test suite
2. Test NPX context manually
3. Test local development context
4. Test with existing secrets
5. Test with missing secrets

### Phase 3: Documentation
1. Update README.md
2. Update error messages throughout codebase
3. Update spec documentation
4. Add inline comments explaining NPX compatibility

### Phase 4: Release
1. Bump version to 0.7.5
2. Update CHANGELOG.md
3. Publish to npm
4. Test published package: `npx @quiltdata/benchling-webhook@latest --yes`

---

## Related Issues

- **Issue #221**: Next Steps Generator (parent issue)
- **NPX UX Issues**: General NPX usability improvements
- **Secret Management**: v0.7.0 secret sync architecture

---

## References

- [bin/commands/deploy.ts](../../bin/commands/deploy.ts) - Deploy command implementation
- [bin/commands/sync-secrets.ts](../../bin/commands/sync-secrets.ts) - Secret sync implementation
- [bin/commands/install.ts](../../bin/commands/install.ts) - Install command (works correctly)
- [bin/commands/setup-wizard.ts](../../bin/commands/setup-wizard.ts) - Setup wizard (works correctly)
- [package.json](../../package.json) - NPM scripts definition

---

## Conclusion

**Recommended Action**: Implement Option 1 (Direct TypeScript Import)

This is the cleanest, most maintainable, and most reliable solution. It:
- Fixes the NPX compatibility issue completely
- Improves type safety and error handling
- Matches the existing pattern used by `setup-wizard.ts`
- Eliminates unnecessary shell execution
- Provides better control over console output
- Is easier to test and debug

The change is minimal (adding one import and replacing ~30 lines) but provides significant improvements to reliability and maintainability.
