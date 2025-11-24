# Specification: Enable BenchlingWebhook Parameter in Integrated Mode

## Overview

This specification details the enhancement to the setup wizard's integrated mode (Phase 6) to check, report, and optionally enable the `BenchlingWebhook` CloudFormation parameter in the Quilt stack.

## Problem Statement

When users complete setup in integrated mode, the `BenchlingWebhook` parameter in the Quilt CloudFormation stack is typically set to `Disabled`. Users must manually:

1. Discover that the parameter needs to be enabled
2. Navigate to CloudFormation console
3. Update the stack parameter
4. Wait for stack update to complete

This creates friction and potential confusion in the integration workflow.

## Goals

1. **Automatic Detection**: Query and report `BenchlingWebhook` parameter status during setup
2. **Smart Prompting**: Offer to enable the parameter if currently disabled
3. **Non-blocking Updates**: Initiate stack update without blocking the wizard
4. **Status Monitoring**: Provide a reusable status command for monitoring stack updates

## Non-Goals

- Modifying standalone mode behavior (this is integrated mode only)
- Changing any other stack parameters
- Implementing automatic retry logic for failed stack updates
- Supporting other CloudFormation parameter modifications

## User Stories

### Story 1: First-time Setup with Disabled Parameter

**As a** new user setting up Benchling integration
**I want** the wizard to enable BenchlingWebhook automatically
**So that** I don't have to manually configure CloudFormation

**Acceptance Criteria:**

- Wizard detects `BenchlingWebhook=Disabled`
- Prompts user: "BenchlingWebhook is currently Disabled. Enable it now? (y/n)"
- On confirmation, updates the stack parameter
- Shows status command for monitoring

### Story 2: Non-interactive Setup (--yes flag)

**As a** CI/CD pipeline or automation script
**I want** `--yes` flag to automatically enable BenchlingWebhook
**So that** setup can complete without manual intervention

**Acceptance Criteria:**

- `--yes` flag skips confirmation prompt
- Automatically enables if disabled
- Shows status command for monitoring
- No blocking wait for completion

### Story 3: Checking Integration Status Later

**As a** user who completed setup
**I want** to check if the stack update completed
**So that** I know when the integration is fully active

**Acceptance Criteria:**

- Can run `npx @quiltdata/benchling-webhook status --profile <current profile>`
- Shows current BenchlingWebhook parameter value
- Shows stack status (UPDATE_IN_PROGRESS, UPDATE_COMPLETE, etc.)
- Shows last update timestamp

### Story 4: Already Enabled Parameter

**As a** user reconfiguring an existing integration
**I want** the wizard to skip enabling if already enabled
**So that** I don't trigger unnecessary stack updates

**Acceptance Criteria:**

- Wizard detects `BenchlingWebhook=Enabled`
- Reports "✓ BenchlingWebhook is already Enabled"
- Skips update and proceeds with setup
- No prompts or stack updates

## Technical Design

### Architecture Overview

```
Phase 2: Stack Query (MODIFIED)
├── Query CloudFormation stack
├── Extract Outputs (existing)
└── Extract Parameters (NEW)
    └── Store BenchlingWebhook value

Phase 6: Integrated Mode (ENHANCED)
├── Build configuration
├── Save configuration
├── Sync BenchlingSecret
├── Check BenchlingWebhook (NEW)
│   ├── Report current status
│   ├── Prompt if disabled (or auto with --yes)
│   └── Update stack parameter if confirmed
└── Show success with status command

New Command: status
├── Read profile config
├── Query stack status
└── Report BenchlingWebhook + stack state
```

### Component Changes

#### 1. Type Definitions Enhancement

**File**: `lib/wizard/types.ts`

```typescript
// Add to StackQueryResult interface (line 28-45)
export interface StackQueryResult {
    stackArn: string;
    catalog: string;
    database: string;
    queueUrl: string;
    region: string;
    account: string;
    benchlingSecretArn?: string;
    benchlingIntegrationEnabled?: boolean; // NEW: Extracted from stack parameters
    stackQuerySucceeded: boolean;
}

// Add new interface for stack update
export interface StackParameterUpdateOptions {
    stackArn: string;
    region: string;
    parameterKey: string;
    parameterValue: string;
    awsProfile?: string;
}
```

#### 2. Stack Query Enhancement

**File**: `bin/commands/infer-quilt-config.ts`

**Location**: Lines 128-158 (in `findQuiltStacks` function)

**Current Code**:

```typescript
// Extract outputs
for (const output of outputs) {
    const key = output.OutputKey || "";
    const value = output.OutputValue || "";
    // ... extract outputs
}
```

**New Code**:

```typescript
// Extract outputs
for (const output of outputs) {
    const key = output.OutputKey || "";
    const value = output.OutputValue || "";
    // ... existing output extraction
}

// Extract parameters (NEW)
const parameters = stackDetail.Parameters || [];
for (const param of parameters) {
    const key = param.ParameterKey || "";
    const value = param.ParameterValue || "";

    if (key === "BenchlingWebhook") {
        stackInfo.benchlingIntegrationEnabled = value === "Enabled";
    }
}
```

**Type Update**:

```typescript
// Line 30-39: QuiltStackInfo interface
interface QuiltStackInfo {
    stackName: string;
    stackArn: string;
    region: string;
    account?: string;
    database?: string;
    queueUrl?: string;
    catalogUrl?: string;
    benchlingSecretArn?: string;
    benchlingIntegrationEnabled?: boolean; // NEW
}
```

**Update Return Value** (line 407-410):

```typescript
if (selectedStack.benchlingIntegrationEnabled !== undefined) {
    result.benchlingIntegrationEnabled = selectedStack.benchlingIntegrationEnabled;
    console.log(`✓ BenchlingWebhook: ${selectedStack.benchlingIntegrationEnabled ? 'Enabled' : 'Disabled'}`);
}
```

#### 3. Phase 2 Stack Query Enhancement

**File**: `lib/wizard/phase2-stack-query.ts`

**Location**: Lines 94-103 (stack query result building)

**Add**:

```typescript
return {
    stackArn,
    catalog: normalizedConfirmed,
    database,
    queueUrl,
    region,
    account,
    benchlingSecretArn,
    benchlingIntegrationEnabled: inferenceResult.benchlingIntegrationEnabled, // NEW
    stackQuerySucceeded: true,
};
```

**Add Logging** (after line 91):

```typescript
if (inferenceResult.benchlingIntegrationEnabled !== undefined) {
    console.log(chalk.dim(`BenchlingWebhook: ${inferenceResult.benchlingIntegrationEnabled ? 'Enabled' : 'Disabled'}`));
}
```

#### 4. Stack Parameter Update Utility

**New File**: `lib/utils/stack-parameter-update.ts`

```typescript
/**
 * CloudFormation stack parameter update utility
 *
 * Provides safe parameter updates with UsePreviousValue for all other parameters
 *
 * @module utils/stack-parameter-update
 */

import { CloudFormationClient, UpdateStackCommand, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { fromIni } from "@aws-sdk/credential-providers";
import chalk from "chalk";

export interface StackParameterUpdateOptions {
    stackArn: string;
    region: string;
    parameterKey: string;
    parameterValue: string;
    awsProfile?: string;
}

export interface StackParameterUpdateResult {
    success: boolean;
    stackId?: string;
    error?: string;
}

/**
 * Updates a single CloudFormation stack parameter while preserving all others
 *
 * @param options - Update options
 * @returns Update result
 */
export async function updateStackParameter(
    options: StackParameterUpdateOptions
): Promise<StackParameterUpdateResult> {
    const { stackArn, region, parameterKey, parameterValue, awsProfile } = options;

    try {
        // Extract stack name from ARN
        // ARN format: arn:aws:cloudformation:REGION:ACCOUNT:stack/STACK_NAME/STACK_ID
        const stackNameMatch = stackArn.match(/stack\/([^\/]+)\//);
        if (!stackNameMatch) {
            throw new Error(`Invalid stack ARN format: ${stackArn}`);
        }
        const stackName = stackNameMatch[1];

        // Configure AWS SDK client
        const clientConfig: any = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }
        const client = new CloudFormationClient(clientConfig);

        // Get current stack parameters
        const describeCommand = new DescribeStacksCommand({
            StackName: stackName,
        });
        const describeResponse = await client.send(describeCommand);
        const stack = describeResponse.Stacks?.[0];

        if (!stack) {
            throw new Error(`Stack not found: ${stackName}`);
        }

        const currentParameters = stack.Parameters || [];

        // Build parameter list: update target parameter, preserve all others
        const parameters = currentParameters.map((param) => {
            if (param.ParameterKey === parameterKey) {
                return {
                    ParameterKey: parameterKey,
                    ParameterValue: parameterValue,
                };
            } else {
                return {
                    ParameterKey: param.ParameterKey!,
                    UsePreviousValue: true,
                };
            }
        });

        // Update stack
        const updateCommand = new UpdateStackCommand({
            StackName: stackName,
            Parameters: parameters,
            UsePreviousTemplate: true, // CRITICAL: Don't change template
            Capabilities: stack.Capabilities, // Preserve capabilities
        });

        const updateResponse = await client.send(updateCommand);

        return {
            success: true,
            stackId: updateResponse.StackId,
        };
    } catch (error) {
        const err = error as Error;
        // CloudFormation returns specific error if no updates are needed
        if (err.message?.includes("No updates are to be performed")) {
            return {
                success: true, // Not really an error
            };
        }
        return {
            success: false,
            error: err.message,
        };
    }
}

/**
 * Gets current value of a stack parameter
 *
 * @param stackArn - Stack ARN
 * @param region - AWS region
 * @param parameterKey - Parameter key to query
 * @param awsProfile - Optional AWS profile
 * @returns Parameter value or undefined if not found
 */
export async function getStackParameter(
    stackArn: string,
    region: string,
    parameterKey: string,
    awsProfile?: string
): Promise<string | undefined> {
    try {
        const stackNameMatch = stackArn.match(/stack\/([^\/]+)\//);
        if (!stackNameMatch) {
            throw new Error(`Invalid stack ARN format: ${stackArn}`);
        }
        const stackName = stackNameMatch[1];

        const clientConfig: any = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }
        const client = new CloudFormationClient(clientConfig);

        const describeCommand = new DescribeStacksCommand({
            StackName: stackName,
        });
        const describeResponse = await client.send(describeCommand);
        const stack = describeResponse.Stacks?.[0];

        if (!stack) {
            return undefined;
        }

        const param = stack.Parameters?.find((p) => p.ParameterKey === parameterKey);
        return param?.ParameterValue;
    } catch (error) {
        console.warn(chalk.yellow(`Warning: Could not get parameter ${parameterKey}: ${(error as Error).message}`));
        return undefined;
    }
}
```

#### 5. Phase 6 Integrated Mode Enhancement

**File**: `lib/wizard/phase6-integrated-mode.ts`

**Location**: After line 118 (after syncSecretsToAWS)

**Add**:

```typescript
// Step 3.5: Check and optionally enable BenchlingWebhook parameter
console.log("Checking BenchlingWebhook parameter...\n");

const benchlingIntegrationEnabled = stackQuery.benchlingIntegrationEnabled;

if (benchlingIntegrationEnabled === undefined) {
    console.log(chalk.yellow("⚠️  Could not determine BenchlingWebhook status"));
    console.log(chalk.dim("   You may need to enable it manually in CloudFormation\n"));
} else if (benchlingIntegrationEnabled) {
    console.log(chalk.green("✓ BenchlingWebhook is already Enabled\n"));
} else {
    // Parameter is disabled - offer to enable
    console.log(chalk.yellow("BenchlingWebhook is currently Disabled"));

    let shouldEnable = yes;
    if (!yes) {
        const { enable } = await inquirer.prompt([
            {
                type: "confirm",
                name: "enable",
                message: "Enable BenchlingWebhook now?",
                default: true,
            },
        ]);
        shouldEnable = enable;
    }

    if (shouldEnable) {
        console.log("\nEnabling BenchlingWebhook parameter...");

        const { updateStackParameter } = await import("../utils/stack-parameter-update");
        const updateResult = await updateStackParameter({
            stackArn: stackQuery.stackArn,
            region: config.deployment.region,
            parameterKey: "BenchlingWebhook",
            parameterValue: "Enabled",
            awsProfile,
        });

        if (updateResult.success) {
            console.log(chalk.green("✓ Stack update initiated"));
            console.log(chalk.dim("  The stack is now updating in the background\n"));
        } else {
            console.warn(chalk.yellow(`⚠️  Failed to enable BenchlingWebhook: ${updateResult.error}`));
            console.warn(chalk.yellow("   You can enable it manually in CloudFormation console\n"));
        }
    } else {
        console.log(chalk.dim("  Skipped - you can enable it later via CloudFormation console\n"));
    }
}
```

**Update Success Message** (line 120-133):

```typescript
// Step 4: Show success message with status monitoring command
console.log("╔═══════════════════════════════════════════════════════════╗");
console.log("║   Setup Complete!                                         ║");
console.log("╚═══════════════════════════════════════════════════════════╝\n");
console.log(chalk.bold("Integrated Stack Mode"));
console.log(chalk.dim("─".repeat(80)));
console.log(chalk.green("✓ BenchlingSecret updated in Quilt stack"));

// Show integration status
if (benchlingIntegrationEnabled === true) {
    console.log(chalk.green("✓ BenchlingWebhook is Enabled"));
} else if (benchlingIntegrationEnabled === false) {
    console.log(chalk.yellow("⚠ BenchlingWebhook update in progress"));
} else {
    console.log(chalk.dim("✓ BenchlingWebhook status unknown"));
}

console.log(chalk.dim("✓ No separate webhook deployment needed"));
console.log(chalk.dim("✓ Quilt stack will handle webhook events\n"));

console.log(chalk.bold("Next steps:"));
console.log("  1. Monitor stack update:");
console.log(chalk.cyan(`     npx @quiltdata/benchling-webhook status --profile ${profile}`));
console.log("  2. Configure webhook URL in Benchling app settings");
console.log("     (Get the webhook URL from your Quilt stack outputs)");
console.log("  3. Test the webhook integration");
console.log(`  4. Monitor logs: npx ts-node scripts/check-logs.ts --profile ${profile}\n`);
```

#### 6. New Status Command

**New File**: `bin/commands/status.ts`

```typescript
#!/usr/bin/env node
/**
 * Stack Status Command
 *
 * Reports CloudFormation stack status and BenchlingWebhook parameter state
 * for a given configuration profile.
 *
 * @module commands/status
 */

import chalk from "chalk";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { fromIni } from "@aws-sdk/credential-providers";
import { XDGConfig } from "../../lib/xdg-config";
import type { XDGBase } from "../../lib/xdg-base";

export interface StatusCommandOptions {
    /** Configuration profile name */
    profile?: string;
    /** AWS profile to use */
    awsProfile?: string;
    /** Config storage implementation (for testing) */
    configStorage?: XDGBase;
    /** Show detailed stack events */
    detailed?: boolean;
}

export interface StatusResult {
    success: boolean;
    stackStatus?: string;
    benchlingIntegrationEnabled?: boolean;
    lastUpdateTime?: string;
    stackArn?: string;
    region?: string;
    error?: string;
}

/**
 * Gets stack status from CloudFormation
 */
async function getStackStatus(
    stackArn: string,
    region: string,
    awsProfile?: string
): Promise<StatusResult> {
    try {
        // Extract stack name from ARN
        const stackNameMatch = stackArn.match(/stack\/([^\/]+)\//);
        if (!stackNameMatch) {
            throw new Error(`Invalid stack ARN format: ${stackArn}`);
        }
        const stackName = stackNameMatch[1];

        // Configure AWS SDK client
        const clientConfig: any = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }
        const client = new CloudFormationClient(clientConfig);

        // Describe stack
        const command = new DescribeStacksCommand({
            StackName: stackName,
        });
        const response = await client.send(command);
        const stack = response.Stacks?.[0];

        if (!stack) {
            throw new Error(`Stack not found: ${stackName}`);
        }

        // Extract BenchlingWebhook parameter
        const param = stack.Parameters?.find((p) => p.ParameterKey === "BenchlingWebhook");
        const benchlingIntegrationEnabled = param?.ParameterValue === "Enabled";

        return {
            success: true,
            stackStatus: stack.StackStatus,
            benchlingIntegrationEnabled,
            lastUpdateTime: stack.LastUpdatedTime?.toISOString() || stack.CreationTime?.toISOString(),
            stackArn,
            region,
        };
    } catch (error) {
        return {
            success: false,
            error: (error as Error).message,
            stackArn,
            region,
        };
    }
}

/**
 * Formats stack status with color coding
 */
function formatStackStatus(status: string): string {
    if (status.includes("COMPLETE") && !status.includes("ROLLBACK")) {
        return chalk.green(status);
    } else if (status.includes("IN_PROGRESS")) {
        return chalk.yellow(status);
    } else if (status.includes("FAILED") || status.includes("ROLLBACK")) {
        return chalk.red(status);
    } else {
        return chalk.dim(status);
    }
}

/**
 * Status command implementation
 */
export async function statusCommand(options: StatusCommandOptions = {}): Promise<StatusResult> {
    const {
        profile = "default",
        awsProfile,
        configStorage,
        detailed = false,
    } = options;

    const xdg = configStorage || new XDGConfig();

    console.log(chalk.bold(`\nStack Status for Profile: ${profile}\n`));
    console.log(chalk.dim("─".repeat(80)));

    // Load configuration
    let config;
    try {
        config = xdg.readProfile(profile);
    } catch (error) {
        const errorMsg = `Profile '${profile}' not found. Run setup first.`;
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return {
            success: false,
            error: errorMsg,
        };
    }

    // Check if integrated stack
    if (!config.integratedStack) {
        const errorMsg = "Status command is only available for integrated stack mode";
        console.log(chalk.yellow(`\n⚠️  ${errorMsg}\n`));
        console.log(chalk.dim("This profile is configured for standalone deployment."));
        console.log(chalk.dim("Use CloudFormation console to check webhook stack status.\n"));
        return {
            success: false,
            error: errorMsg,
        };
    }

    // Get stack status
    const stackArn = config.quilt.stackArn;
    const region = config.deployment.region;

    console.log(`Stack: ${chalk.cyan(stackArn.match(/stack\/([^\/]+)\//)?.[1] || stackArn)}`);
    console.log(`Region: ${chalk.cyan(region)}\n`);

    const result = await getStackStatus(stackArn, region, awsProfile);

    if (!result.success) {
        console.error(chalk.red(`❌ Failed to get stack status: ${result.error}\n`));
        return result;
    }

    // Display status
    console.log(chalk.bold("Stack Status:"));
    console.log(`  ${formatStackStatus(result.stackStatus!)}`);
    console.log("");

    console.log(chalk.bold("BenchlingWebhook:"));
    if (result.benchlingIntegrationEnabled) {
        console.log(chalk.green("  ✓ Enabled"));
    } else {
        console.log(chalk.yellow("  ⚠ Disabled"));
    }
    console.log("");

    if (result.lastUpdateTime) {
        console.log(chalk.bold("Last Updated:"));
        console.log(`  ${chalk.dim(result.lastUpdateTime)}`);
        console.log("");
    }

    // Show next steps based on status
    if (result.stackStatus?.includes("IN_PROGRESS")) {
        console.log(chalk.bold("Status:"));
        console.log(chalk.yellow("  ⏳ Stack update in progress..."));
        console.log(chalk.dim("  Run this command again in a few minutes to check progress\n"));
    } else if (result.stackStatus?.includes("COMPLETE") && !result.stackStatus.includes("ROLLBACK")) {
        console.log(chalk.bold("Status:"));
        console.log(chalk.green("  ✓ Stack is up to date\n"));

        if (!result.benchlingIntegrationEnabled) {
            console.log(chalk.bold("Action Required:"));
            console.log(chalk.yellow("  BenchlingWebhook is Disabled"));
            console.log(chalk.dim("  Enable it via CloudFormation console or re-run setup\n"));
        }
    } else if (result.stackStatus?.includes("FAILED") || result.stackStatus?.includes("ROLLBACK")) {
        console.log(chalk.bold("Status:"));
        console.log(chalk.red("  ❌ Stack update failed or rolled back"));
        console.log(chalk.dim("  Check CloudFormation console for detailed error messages\n"));
    }

    // CloudFormation console link
    const consoleUrl = `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/stackinfo?stackId=${encodeURIComponent(stackArn)}`;
    console.log(chalk.bold("CloudFormation Console:"));
    console.log(chalk.cyan(`  ${consoleUrl}\n`));

    console.log(chalk.dim("─".repeat(80)));

    return result;
}
```

#### 7. CLI Integration

**File**: `bin/cli.ts`

**Add Command** (after line 100, in the commands section):

```typescript
// Status command
program
    .command("status")
    .description("Check CloudFormation stack status and BenchlingWebhook parameter")
    .option("--profile <name>", "Configuration profile to check (default: default)")
    .option("--aws-profile <name>", "AWS credentials profile")
    .option("--detailed", "Show detailed stack events")
    .addHelpText("after", `

Examples:
  Check status of default profile:
    $ npx @quiltdata/benchling-webhook status

  Check status of specific profile:
    $ npx @quiltdata/benchling-webhook status --profile <current_profile>

  Check with detailed events:
    $ npx @quiltdata/benchling-webhook status --profile prod --detailed

Note: This command only works for integrated stack mode profiles.
`)
    .action(async (options) => {
        try {
            const { statusCommand } = await import("./commands/status");
            await statusCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });
```

**Add Import** (at top):

```typescript
import { statusCommand } from "./commands/status";
```

## Implementation Plan

### Phase 1: Stack Query Enhancement (2 hours)

1. Update `QuiltStackInfo` interface in `infer-quilt-config.ts`
2. Extract `BenchlingWebhook` parameter in `findQuiltStacks()`
3. Update `StackQueryResult` interface in `lib/wizard/types.ts`
4. Pass parameter through Phase 2 stack query
5. Add logging for parameter status

### Phase 2: Stack Parameter Update Utility (3 hours)

1. Create `lib/utils/stack-parameter-update.ts`
2. Implement `updateStackParameter()` function
3. Implement `getStackParameter()` function
4. Add error handling for "No updates" case
5. Write unit tests for parameter updates

### Phase 3: Phase 6 Enhancement (3 hours)

1. Add BenchlingWebhook check in `phase6-integrated-mode.ts`
2. Implement prompt logic (with --yes support)
3. Call `updateStackParameter()` on confirmation
4. Update success message with status command
5. Add proper error handling and warnings

### Phase 4: Status Command (4 hours)

1. Create `bin/commands/status.ts`
2. Implement stack status querying
3. Implement formatted output with color coding
4. Add integrated mode validation
5. Integrate with CLI in `bin/cli.ts`
6. Write tests for status command

### Phase 5: Testing & Documentation (3 hours)

1. Unit tests for stack parameter utilities
2. Integration tests for Phase 6 enhancement
3. Manual testing with real AWS stacks
4. Update README with status command
5. Update help text and examples

**Total Estimated Time**: 15 hours

## Testing Strategy

### Unit Tests

```typescript
// test/lib/utils/stack-parameter-update.test.ts
describe("updateStackParameter", () => {
    it("should update single parameter with UsePreviousValue for others");
    it("should handle 'No updates' error gracefully");
    it("should throw on invalid stack ARN");
    it("should preserve stack capabilities");
});

// test/lib/wizard/phase6-integrated-mode.test.ts
describe("Phase 6 with BenchlingWebhook", () => {
    it("should skip update if already enabled");
    it("should prompt if disabled in interactive mode");
    it("should auto-enable with --yes flag");
    it("should handle stack update failures gracefully");
});

// test/bin/commands/status.test.ts
describe("statusCommand", () => {
    it("should show stack status for integrated mode");
    it("should reject non-integrated profiles");
    it("should handle missing profiles");
    it("should format status with proper colors");
});
```

### Integration Tests

```bash
# Test with real 'bench' profile
npx ts-node bin/commands/setup-wizard.ts --profile bench --yes

# Verify status command
npx ts-node bin/cli.ts status --profile bench

# Test parameter already enabled case
# (bench profile should now have BenchlingWebhook=Enabled)
npx ts-node bin/commands/setup-wizard.ts --profile bench --yes
```

### Manual Testing Checklist

- [ ] Setup new integrated profile with disabled parameter
- [ ] Verify prompt appears in interactive mode
- [ ] Verify auto-enable with --yes flag
- [ ] Verify status command shows IN_PROGRESS during update
- [ ] Verify status command shows COMPLETE after update
- [ ] Re-run setup on same profile (should skip if enabled)
- [ ] Test status command with non-integrated profile (should warn)
- [ ] Test status command with missing profile (should error)

## Success Metrics

1. **Correctness**: 100% accurate parameter detection and updates
2. **UX**: Zero manual CloudFormation interactions needed
3. **Reliability**: Graceful handling of all error cases
4. **Performance**: Non-blocking updates (don't wait for completion)
5. **Test Coverage**: >90% for new code

## Edge Cases & Error Handling

### Edge Case 1: Stack Update Already in Progress

**Scenario**: User runs setup while previous update is still running
**Handling**: CloudFormation will reject with specific error - show friendly message

### Edge Case 2: Insufficient IAM Permissions

**Scenario**: User lacks `cloudformation:UpdateStack` permission
**Handling**: Show error with manual instructions for enabling via console

### Edge Case 3: Parameter Not Found

**Scenario**: Old Quilt stack version without BenchlingWebhook parameter
**Handling**: Show warning and skip feature gracefully

### Edge Case 4: Network Failure During Update

**Scenario**: AWS API call fails mid-update
**Handling**: Show error and recommend retry with status command

### Edge Case 5: User Cancels Prompt

**Scenario**: User says "no" to enabling parameter
**Handling**: Show instructions for enabling manually later

## Backward Compatibility

- No breaking changes to existing CLI behavior
- Status command is new (no conflicts)
- Phase 6 enhancement is additive (doesn't break existing flow)
- Stack query enhancement is transparent (just adds data)
- Works with existing profiles (reads integratedStack flag)

## Security Considerations

- Uses existing AWS credentials (no new auth)
- `UsePreviousValue` prevents accidental parameter changes
- `UsePreviousTemplate` prevents template modifications
- Preserves stack capabilities (no privilege escalation)
- Read-only status command (safe to run anytime)

## Future Enhancements

1. **Auto-polling**: Option to wait for stack update completion
2. **Webhook URL detection**: Show webhook URL from stack outputs
3. **Health check integration**: Verify webhook is responding
4. **Rollback detection**: Warn if stack rolled back
5. **Event streaming**: Show real-time CloudFormation events

## Documentation Updates

### README.md

Add section:

```markdown
## Integrated Mode: BenchlingWebhook Parameter

When using integrated mode (built-in Quilt stack webhook), the setup wizard will:

1. Check if `BenchlingWebhook` is enabled in your Quilt stack
2. Offer to enable it automatically if disabled
3. Provide a status command to monitor the stack update

### Checking Integration Status

```bash
npx @quiltdata/benchling-webhook status --profile myprofile
```

This shows:

- CloudFormation stack status
- BenchlingWebhook parameter state
- Last update timestamp
- Direct link to CloudFormation console

```

### Help Text

Update `bin/cli.ts` help text to mention status command in Quick Start section.

## Rollout Plan

1. **Merge to development branch**: Test with internal profiles
2. **Beta testing**: Test with 2-3 external users
3. **Collect feedback**: Iterate on UX and error messages
4. **Release**: Include in next minor version (0.8.0)
5. **Monitor**: Track status command usage and errors

## Appendix: CloudFormation Parameter Details

### Parameter Definition

```yaml
BenchlingWebhook:
  Type: String
  Default: Disabled
  AllowedValues:
    - Enabled
    - Disabled
  Description: Enable Benchling integration service for laboratory data management
```

### Stack Update API Call

```typescript
await cloudformation.send(new UpdateStackCommand({
    StackName: "tf-dev-bench",
    Parameters: [
        { ParameterKey: "BenchlingWebhook", ParameterValue: "Enabled" },
        { ParameterKey: "QuiltWebHost", UsePreviousValue: true },
        { ParameterKey: "VPC", UsePreviousValue: true },
        // ... all other parameters with UsePreviousValue
    ],
    UsePreviousTemplate: true,
    Capabilities: ["CAPABILITY_IAM"], // Preserve from current stack
}));
```

### Expected Stack Events

1. `UPDATE_IN_PROGRESS` - Stack update initiated
2. Resource updates (if any Lambda/service changes triggered)
3. `UPDATE_COMPLETE` - Stack update successful (~2-5 minutes)

---

**Document Status**: Ready for Implementation
**Last Updated**: 2025-11-15
**Author**: Claude (Sonnet 4.5)
**Related Issue**: Part of #221 (Next Steps Enhancement)
