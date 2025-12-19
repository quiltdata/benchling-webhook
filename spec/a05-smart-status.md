# A05: Smart Status Command - Integrated vs Standalone Stack Detection

**Status**: Draft
**Author**: Claude Code
**Date**: 2025-11-25
**Related**: [CLAUDE.md](../CLAUDE.md), [lib/types/config.ts](../lib/types/config.ts)

## Problem Statement

The `status` command currently only works for **integrated stacks** where the Benchling webhook integration is embedded within the Quilt stack. It needs to be enhanced to detect and handle **standalone stacks** where a separate `BenchlingWebhookStack` exists.

## Background

### Stack Architecture

**`config.quilt.stackArn`**: ALWAYS points to the Quilt stack (the "host" stack containing SQS queue, Athena resources, etc.)

#### Integrated Stack (`integratedStack: true`)

- Benchling webhook integration is embedded IN the Quilt stack
- `config.quilt.stackArn` points to the Quilt stack (which is also the Benchling stack)
- Status command should check: **Quilt stack** (current behavior)
- Should check `BenchlingIntegration` CloudFormation parameter
- No separate `BenchlingWebhookStack` exists

#### Standalone Stack (`integratedStack: false`)

- Separate `BenchlingWebhookStack` CloudFormation stack is deployed
- `config.quilt.stackArn` points to the Quilt stack (the "host" providing services)
- Status command should check: **`BenchlingWebhookStack`** (not Quilt stack)
- Should NOT check `BenchlingIntegration` parameter (doesn't exist on webhook stack)
- Deployment info tracked in `~/.config/benchling-webhook/{profile}/deployments.json`

### Current Behavior

From [bin/commands/status.ts:880-890](../bin/commands/status.ts):

```typescript
// Extract stack info - if stackArn is present, status should work regardless of integratedStack flag
const stackArn = config.quilt.stackArn;
if (!stackArn) {
    return {
        success: false,
        error: "Quilt stack ARN not found in configuration...",
    };
}
const region = config.deployment.region;
const stackName = stackArn.match(/stack\/([^/]+)\//)?.[1] || stackArn;
```

The current implementation:

1. Always uses `config.quilt.stackArn` (points to Quilt stack)
2. Always checks for `BenchlingIntegration` parameter (line 126-127)
3. ✅ Works correctly for **integrated stacks** (status of Quilt stack)
4. ❌ Fails for **standalone stacks** (should check BenchlingWebhookStack, not Quilt stack)

## Solution Design

### Detection Strategy

Use the `integratedStack` flag from profile configuration ([lib/types/config.ts:93](../lib/types/config.ts)) to determine which stack to query:

```typescript
if (config.integratedStack === true) {
    // Query Quilt stack (config.quilt.stackArn)
    // Check BenchlingIntegration parameter
} else {
    // Query BenchlingWebhookStack
    // Do NOT check BenchlingIntegration parameter
    // Get stack info from deployments.json
}
```

### Stack Identification Interface

```typescript
interface StackIdentification {
    stackArn: string | null;      // Full ARN if available, null for standalone
    stackName: string;             // Stack name for CloudFormation queries
    region: string;                // AWS region
    mode: 'integrated' | 'standalone';
    hasDeployment: boolean;        // Whether deployment tracking exists
}
```

### Core Detection Function

```typescript
function identifyTargetStack(
    config: ProfileConfig,
    xdg: XDGConfig,
    profile: string
): StackIdentification {
    // Handle undefined integratedStack (legacy configs)
    let isIntegrated = config.integratedStack === true;

    if (config.integratedStack === undefined) {
        // Legacy config - default to integrated and warn
        console.warn(chalk.yellow(
            "⚠️  Configuration is missing 'integratedStack' field.\n" +
            "   Defaulting to integrated mode.\n" +
            "   Run 'npm run setup' to update configuration.\n"
        ));
        isIntegrated = true;
    }

    if (isIntegrated) {
        // Integrated: Query Quilt stack
        const stackArn = config.quilt.stackArn;
        if (!stackArn) {
            throw new Error(
                "Integrated mode requires quilt.stackArn in configuration.\n\n" +
                "Run setup to configure the Quilt stack ARN:\n" +
                `  npm run setup -- --profile ${profile}`
            );
        }

        const stackName = stackArn.match(/stack\/([^/]+)\//)?.[1] || stackArn;
        const region = config.deployment.region || config.quilt.region;

        return {
            stackArn,
            stackName,
            region,
            mode: 'integrated',
            hasDeployment: false,
        };
    } else {
        // Standalone: Query BenchlingWebhookStack from deployments
        const deployments = xdg.getDeployments(profile);

        // Find any active deployment (prefer prod, then dev, then any)
        const stages = ['prod', 'dev', ...Object.keys(deployments.active)];
        let activeDeployment = null;

        for (const stage of stages) {
            if (deployments.active[stage]) {
                activeDeployment = deployments.active[stage];
                break;
            }
        }

        if (!activeDeployment) {
            throw new Error(
                "No active deployments found for standalone stack.\n\n" +
                "This profile is configured for standalone mode but has no deployed stack.\n" +
                "Deploy the stack first with:\n" +
                `  npm run deploy -- --profile ${profile}`
            );
        }

        // Use deployment tracking info
        const stackName = activeDeployment.stackName;  // "BenchlingWebhookStack"
        const region = activeDeployment.region;

        return {
            stackArn: null,  // Will be resolved from CloudFormation query
            stackName,       // "BenchlingWebhookStack"
            region,
            mode: 'standalone',
            hasDeployment: true,
        };
    }
}
```

## Implementation Changes

### 1. Update Status Command Entry Point

**File**: [bin/commands/status.ts](../bin/commands/status.ts)
**Location**: Lines 856-890 (`statusCommand` function)

```typescript
export async function statusCommand(options: StatusCommandOptions = {}): Promise<StatusResult> {
    const {
        profile = "default",
        awsProfile,
        configStorage,
        timer,
        exit = true,
    } = options;

    const xdg = configStorage || new XDGConfig();

    // Load configuration
    let config;
    try {
        config = xdg.readProfile(profile);
    } catch {
        const errorMsg = `Profile '${profile}' not found. Run setup first.`;
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }

    // NEW: Identify target stack based on mode
    let stackIdentification: StackIdentification;
    try {
        stackIdentification = identifyTargetStack(config, xdg, profile);
    } catch (error) {
        const errorMsg = (error as Error).message;
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }

    const { stackName, region, mode } = stackIdentification;

    // Parse timer value
    const refreshInterval = parseTimerValue(timer);

    // ... continue with monitoring loop
```

### 2. Update Stack Status Query Function

**File**: [bin/commands/status.ts](../bin/commands/status.ts)
**Location**: Lines 94-156 (`getStackStatus` function)

**Changes**:

- Add `mode` parameter
- Only check `BenchlingIntegration` parameter when `mode === 'integrated'`

```typescript
async function getStackStatus(
    stackName: string,           // Stack name to query
    region: string,
    mode: 'integrated' | 'standalone',  // NEW
    awsProfile?: string,
): Promise<StatusResult> {
    try {
        // Configure AWS SDK client
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }
        const client = new CloudFormationClient(clientConfig);

        // Describe stack by name
        const command = new DescribeStacksCommand({
            StackName: stackName,
        });
        const response = await client.send(command);
        const stack = response.Stacks?.[0];

        if (!stack) {
            const helpText = mode === 'integrated'
                ? "Verify that the Quilt stack exists and is deployed."
                : "Verify that the BenchlingWebhookStack has been deployed. Run: npm run deploy";
            throw new Error(`Stack not found: ${stackName}\n\n${helpText}`);
        }

        // Extract BenchlingIntegration parameter (ONLY for integrated mode)
        let benchlingIntegrationEnabled: boolean | undefined;
        if (mode === 'integrated') {
            const param = stack.Parameters?.find((p) => p.ParameterKey === "BenchlingIntegration");
            benchlingIntegrationEnabled = param?.ParameterValue === "Enabled";
        }

        // Extract stack outputs (unchanged)
        const outputs = stack.Outputs || [];
        const stackOutputs = {
            benchlingUrl: outputs.find((o) => o.OutputKey === "BenchlingUrl")?.OutputValue,
            secretArn: outputs.find((o) =>
                o.OutputKey === "BenchlingSecretArn" ||
                o.OutputKey === "BenchlingClientSecretArn" ||
                o.OutputKey === "SecretArn"
            )?.OutputValue,
            dockerImage: outputs.find((o) =>
                o.OutputKey === "BenchlingDockerImage" ||
                o.OutputKey === "DockerImage"
            )?.OutputValue,
            ecsLogGroup: outputs.find((o) => o.OutputKey === "EcsLogGroup")?.OutputValue,
            apiGatewayLogGroup: outputs.find((o) => o.OutputKey === "ApiGatewayLogGroup")?.OutputValue,
        };

        return {
            success: true,
            stackStatus: stack.StackStatus,
            benchlingIntegrationEnabled,  // undefined for standalone
            lastUpdateTime: stack.LastUpdatedTime?.toISOString() || stack.CreationTime?.toISOString(),
            stackArn: stack.StackId,
            region,
            stackOutputs,
        };
    } catch (error) {
        return {
            success: false,
            error: (error as Error).message,
            stackArn: stackName,
            region,
        };
    }
}
```

### 3. Update Display Function

**File**: [bin/commands/status.ts](../bin/commands/status.ts)
**Location**: Line 589 (`displayStatusResult` function)

**Changes**:

- Add `mode` parameter
- Display mode label in header
- Only show `BenchlingIntegration` status for integrated stacks
- Only show action required message for integrated stacks

```typescript
function displayStatusResult(
    result: StatusResult,
    profile: string,
    mode: 'integrated' | 'standalone',  // NEW
    quiltConfig?: import("../../lib/types/config").QuiltConfig
): void {
    const stackName = result.stackArn?.match(/stack\/([^/]+)\//)?.[1] || result.stackArn || "Unknown";
    const region = result.region || "Unknown";

    // Format last updated time
    let lastUpdatedStr = "";
    if (result.lastUpdateTime) {
        const lastUpdated = new Date(result.lastUpdateTime);
        const timeStr = lastUpdated.toLocaleString("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        lastUpdatedStr = ` @ ${timeStr} (${timezone})`;
    }

    // Display header with mode indicator (NEW)
    const modeLabel = mode === 'integrated'
        ? chalk.blue('[Integrated]')
        : chalk.cyan('[Standalone]');

    console.log(chalk.bold(`\nStack Status for Profile: ${profile} ${modeLabel}${lastUpdatedStr}\n`));
    console.log(chalk.dim("─".repeat(80)));
    console.log(`${chalk.bold("Stack:")} ${chalk.cyan(stackName)}  ${chalk.bold("Region:")} ${chalk.cyan(region)}`);

    // Show stack status
    let statusLine = `${chalk.bold("Stack Status:")} ${formatStackStatus(result.stackStatus!)}`;

    // Only show BenchlingIntegration for integrated stacks (NEW)
    if (mode === 'integrated' && result.benchlingIntegrationEnabled !== undefined) {
        statusLine += `  ${chalk.bold("BenchlingIntegration:")} ${
            result.benchlingIntegrationEnabled
                ? chalk.green("✓ Enabled")
                : chalk.yellow("⚠ Disabled")
        }`;
    }

    console.log(statusLine);
    console.log("");

    // ... rest of display logic remains the same

    // Update action required section (around line 833-837)
    if (result.stackStatus?.includes("COMPLETE") && !result.stackStatus.includes("ROLLBACK")) {
        console.log(chalk.bold("Status:"));
        console.log(chalk.green("  ✓ Stack is up to date\n"));

        // Only show BenchlingIntegration warning for integrated stacks (NEW)
        if (mode === 'integrated' && !result.benchlingIntegrationEnabled) {
            console.log(chalk.bold("Action Required:"));
            console.log(chalk.yellow("  BenchlingIntegration is Disabled"));
            console.log(chalk.dim("  Enable it via CloudFormation console or re-run setup\n"));
        }
    } else if (result.stackStatus?.includes("FAILED") || result.stackStatus?.includes("ROLLBACK")) {
        // ... unchanged
    }

    // ... rest of display logic
}
```

### 4. Update Helper Functions

**File**: [bin/commands/status.ts](../bin/commands/status.ts)
**Location**: Line 554 (`fetchCompleteStatus` function)

```typescript
async function fetchCompleteStatus(
    stackName: string,
    region: string,
    mode: 'integrated' | 'standalone',  // NEW
    awsProfile?: string,
): Promise<StatusResult> {
    const result = await getStackStatus(stackName, region, mode, awsProfile);  // Pass mode

    if (!result.success) {
        return result;
    }

    // Get additional info in parallel (unchanged)
    const secretArn = result.stackOutputs?.secretArn;
    const [ecsServices, albTargetGroups, secretInfo, listenerRules, stackEvents] = await Promise.all([
        getEcsServiceHealth(stackName, region, awsProfile),
        getAlbTargetHealth(stackName, region, awsProfile),
        secretArn ? getSecretInfo(secretArn, region, awsProfile) : Promise.resolve(undefined),
        getListenerRules(stackName, region, awsProfile),
        getRecentStackEvents(stackName, region, awsProfile, 3),
    ]);

    result.ecsServices = ecsServices;
    result.albTargetGroups = albTargetGroups;
    result.secretInfo = secretInfo;
    result.listenerRules = listenerRules;
    result.stackEvents = stackEvents;

    return result;
}
```

### 5. Update Monitoring Loop

**File**: [bin/commands/status.ts](../bin/commands/status.ts)
**Location**: Around line 908 (monitoring loop in `statusCommand`)

```typescript
// Watch loop
while (true) {
    if (!isFirstRun && refreshInterval) {
        clearScreen();
    }

    // Fetch and display status (pass mode)
    result = await fetchCompleteStatus(stackName, region, mode, awsProfile);

    if (!result.success) {
        console.error(chalk.red(`❌ Failed to get stack status: ${result.error}\n`));
        return result;
    }

    displayStatusResult(result, profile, mode, config.quilt);  // Pass mode

    // Check if we should exit (no timer or user disabled it)
    if (!refreshInterval) {
        break;
    }

    // ... rest of monitoring loop (unchanged)
}
```

## Edge Cases

### Case 1: Legacy Configs Without `integratedStack` Field

**Behavior**: Default to integrated mode with warning

```typescript
if (config.integratedStack === undefined) {
    console.warn(chalk.yellow(
        "⚠️  Configuration is missing 'integratedStack' field.\n" +
        "   Defaulting to integrated mode.\n" +
        "   Run 'npm run setup' to update configuration.\n"
    ));
    isIntegrated = true;
}
```

### Case 2: No Deployments for Standalone Stack

**Behavior**: Clear error message with deployment instructions

```typescript
if (!activeDeployment) {
    throw new Error(
        "No active deployments found for standalone stack.\n\n" +
        "This profile is configured for standalone mode but has no deployed stack.\n" +
        "Deploy the stack first with:\n" +
        `  npm run deploy -- --profile ${profile}`
    );
}
```

### Case 3: Missing Stack ARN for Integrated Stack

**Behavior**: Clear error message with setup instructions

```typescript
if (!stackArn) {
    throw new Error(
        "Integrated mode requires quilt.stackArn in configuration.\n\n" +
        "Run setup to configure the Quilt stack ARN:\n" +
        `  npm run setup -- --profile ${profile}`
    );
}
```

### Case 4: Stack Not Found

**Behavior**: Mode-specific help text

```typescript
if (!stack) {
    const helpText = mode === 'integrated'
        ? "Verify that the Quilt stack exists and is deployed."
        : "Verify that the BenchlingWebhookStack has been deployed. Run: npm run deploy";
    throw new Error(`Stack not found: ${stackName}\n\n${helpText}`);
}
```

## Testing Strategy

### Unit Tests

Add to existing test file at `test/bin/commands/status.test.ts`:

1. **Test integrated stack detection**

   ```typescript
   it('should identify integrated stack correctly', () => {
       const config = { integratedStack: true, quilt: { stackArn: '...' }, ... };
       const result = identifyTargetStack(config, xdg, 'default');
       expect(result.mode).toBe('integrated');
       expect(result.stackName).toBe('QuiltStack');
   });
   ```

2. **Test standalone stack detection**

   ```typescript
   it('should identify standalone stack correctly', () => {
       const config = { integratedStack: false, ... };
       const deployments = { active: { dev: { stackName: 'BenchlingWebhookStack', ... } } };
       // Mock xdg.getDeployments() to return deployments
       const result = identifyTargetStack(config, xdg, 'default');
       expect(result.mode).toBe('standalone');
       expect(result.stackName).toBe('BenchlingWebhookStack');
   });
   ```

3. **Test legacy config handling**

   ```typescript
   it('should default to integrated for legacy configs', () => {
       const config = { /* no integratedStack field */ quilt: { stackArn: '...' }, ... };
       const result = identifyTargetStack(config, xdg, 'default');
       expect(result.mode).toBe('integrated');
   });
   ```

4. **Test error cases**

   ```typescript
   it('should throw error when standalone has no deployments', () => {
       const config = { integratedStack: false, ... };
       // Mock xdg.getDeployments() to return { active: {}, history: [] }
       expect(() => identifyTargetStack(config, xdg, 'default')).toThrow('No active deployments');
   });
   ```

### Manual Integration Tests

1. **Test integrated stack**

   ```bash
   npm run status -- --profile <integrated-profile>
   ```

   Expected output:
   - Header shows `[Integrated]` mode label
   - Stack name is the Quilt stack name
   - `BenchlingIntegration` status is shown
   - Action required shown if integration disabled

2. **Test standalone stack**

   ```bash
   npm run status -- --profile <standalone-profile>
   ```

   Expected output:
   - Header shows `[Standalone]` mode label
   - Stack name is `BenchlingWebhookStack`
   - `BenchlingIntegration` status is NOT shown
   - No action required message about integration

## Success Criteria

- ✅ Status command correctly identifies integrated stacks (queries Quilt stack)
- ✅ Status command correctly identifies standalone stacks (queries BenchlingWebhookStack)
- ✅ BenchlingIntegration parameter only shown/checked for integrated stacks
- ✅ Mode clearly indicated in status output with [Integrated] or [Standalone] label
- ✅ Helpful error messages for all edge cases
- ✅ Backward compatibility maintained for legacy configs
- ✅ No changes to existing integrated stack workflows
- ✅ All unit tests pass
- ✅ Manual testing confirms correct behavior for both modes

## Implementation Estimate

| Task | Time |
| ------ | ------ |
| Add `StackIdentification` interface and `identifyTargetStack` function | 45 min |
| Update `statusCommand` entry point | 20 min |
| Update `getStackStatus` function | 25 min |
| Update `displayStatusResult` function | 30 min |
| Update `fetchCompleteStatus` and monitoring loop | 20 min |
| Error handling and edge cases | 30 min |
| Unit tests | 45 min |
| Manual integration testing | 30 min |

**Total: ~3.5 hours**

## Files Modified

1. **`bin/commands/status.ts`** - Primary changes for detection and display logic
2. **`test/bin/commands/status.test.ts`** - Add unit tests for new functionality

## Dependencies

- Existing XDG configuration API ([lib/xdg-config.ts](../lib/xdg-config.ts))
- Deployment tracking structure ([lib/types/config.ts](../lib/types/config.ts))
- CloudFormation SDK ([aws-sdk/client-cloudformation](https://www.npmjs.com/package/@aws-sdk/client-cloudformation))

## References

- [CLAUDE.md](../CLAUDE.md) - Project documentation
- [lib/types/config.ts](../lib/types/config.ts) - Configuration type definitions
- [bin/commands/status.ts](../bin/commands/status.ts) - Current status command implementation
- [lib/xdg-config.ts](../lib/xdg-config.ts) - Configuration management API
