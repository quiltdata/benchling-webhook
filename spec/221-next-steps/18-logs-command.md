# Specification: Logs Command for NPX Users

## Overview

This specification details the implementation of a `logs` command that allows NPX users to view CloudWatch logs without requiring access to the TypeScript source code via `npx ts-node scripts/check-logs.ts`.

## Problem Statement

Currently, users must run logs via the internal script:
```bash
npx ts-node scripts/check-logs.ts --profile sales --type=ecs
```

This approach has several critical issues:

1. **NPX users can't access it**: Published package doesn't include `scripts/` directory
2. **Requires ts-node**: External dependency on TypeScript runtime
3. **Not discoverable**: Not listed in `--help` output
4. **Inconsistent UX**: All other functionality uses CLI commands except logs
5. **BROKEN: Profile support doesn't work**: The `--profile` flag is parsed but **not actually used**. The script always uses the `default` AWS profile and doesn't read from profile configuration at all.

### Current Implementation Bugs

The existing `scripts/check-logs.ts` has the following bugs:

1. **Profile flag ignored**: Parses `--profile=sales` but displays "Profile: default" and uses default AWS credentials
2. **No profile config integration**: Doesn't read from `~/.config/benchling-webhook/{profile}/` at all
3. **Stage flag ignored**: Parses `--stage=dev` but doesn't use deployment tracking to find the correct stack
4. **Hardcoded stack name**: Always looks for `BenchlingWebhookStack` regardless of profile/stage configuration

**Evidence**:
```bash
# User runs with --profile=sales
npx ts-node scripts/check-logs.ts --profile sales

# Output shows:
Profile:   default    # ❌ Wrong! Should show "sales"
Stage:     prod       # ❌ May be wrong if user has dev deployment
```

This means the script is fundamentally broken for multi-profile workflows and **must** be replaced, not just wrapped.

## Goals

1. **NPX Compatibility**: Make logs accessible via `npx @quiltdata/benchling-webhook logs`
2. **Fix Profile Support**: Actually use the profile configuration and deployment tracking
3. **Fix Stage Support**: Use deployment tracking to find correct stack/region for stage
4. **Consistent UX**: Match command style and options of other CLI commands
5. **Discoverability**: Show in help output and command list

## Non-Goals

- Changing the underlying AWS CloudWatch Logs querying logic
- Adding new log filtering or formatting capabilities
- Real-time log streaming enhancements
- Log aggregation or analysis features

## User Stories

### Story 1: NPX User Viewing Logs

**As a** user who installed via NPX
**I want** to view logs using a CLI command
**So that** I don't need access to the source repository

**Acceptance Criteria:**

- Can run `npx @quiltdata/benchling-webhook logs --profile myprofile`
- Command works from any directory
- No dependency on ts-node or source code
- Shows ECS container logs by default

### Story 2: Viewing Different Log Types

**As a** developer debugging integration issues
**I want** to view different log types (ECS, API Gateway)
**So that** I can diagnose problems at different layers

**Acceptance Criteria:**

- `--type=ecs` shows ECS container logs (application)
- `--type=api` shows API Gateway access logs
- `--type=api-exec` shows API Gateway execution logs
- `--type=all` shows all log groups (default)

### Story 3: Following Logs in Real-time

**As a** developer testing the integration
**I want** to follow logs in real-time
**So that** I can see webhook events as they happen

**Acceptance Criteria:**

- `--follow` flag streams logs continuously
- Can be interrupted with Ctrl+C
- Only works with single log type (not `--type=all`)

### Story 4: Filtering and Searching Logs

**As a** support engineer investigating errors
**I want** to filter logs by pattern
**So that** I can quickly find relevant entries

**Acceptance Criteria:**

- `--filter=ERROR` shows only error messages
- `--filter=canvas` shows entries containing "canvas"
- `--since=1h` shows logs from last hour
- `--tail=50` limits to last 50 entries

### Story 5: Multi-Stage Deployments

**As a** team with dev/prod environments
**I want** to specify both profile and stage
**So that** I can view logs from the correct deployment

**Acceptance Criteria:**

- `--profile=sales --stage=dev` shows dev stage logs
- `--profile=sales --stage=prod` shows prod stage logs
- Defaults to `--stage=prod` if not specified

## Technical Design

### Architecture Overview

```
bin/cli.ts (CLI Entry Point)
└── bin/commands/logs.ts (NEW Command)
    ├── Uses XDGConfig to get profile configuration
    ├── Uses deployment tracking to find log groups
    └── Calls AWS CloudWatch Logs API
        ├── Via AWS CLI (existing approach)
        └── Or AWS SDK (future enhancement)

scripts/check-logs.ts (LEGACY)
└── Kept for backward compatibility
└── Can be deprecated in future version
```

### Component Changes

#### 1. New Logs Command

**New File**: `bin/commands/logs.ts`

**Purpose**: Wraps functionality from `scripts/check-logs.ts` into a proper CLI command

**Key Functions**:
- `logsCommand(options)` - Main command handler
- `getLogConfiguration(profile, stage)` - Get deployment and log group info
- `getStackOutputs(region, profile)` - Query CloudFormation for log groups
- `tailLogs(logGroup, options)` - Execute AWS logs tail command
- `showAllLogs(logGroups, options)` - Show logs from multiple sources

**Interface**:

```typescript
export interface LogsCommandOptions {
    /** Configuration profile name */
    profile?: string;
    /** Deployment stage (dev or prod) */
    stage?: string;
    /** AWS credentials profile */
    awsProfile?: string;
    /** Log type to view (ecs, api, api-exec, all) */
    type?: string;
    /** Time period to fetch logs (5m, 1h, 2d) */
    since?: string;
    /** Filter pattern for log entries */
    filter?: string;
    /** Follow logs in real-time */
    follow?: boolean;
    /** Number of lines to show (when not following) */
    tail?: number;
    /** Config storage implementation (for testing) */
    configStorage?: XDGBase;
}

export interface LogsResult {
    success: boolean;
    error?: string;
}
```

**Implementation Structure**:

```typescript
#!/usr/bin/env node
/**
 * Logs Command
 *
 * View CloudWatch logs for deployed Benchling webhook integration.
 * Supports ECS container logs, API Gateway access logs, and execution logs.
 *
 * @module commands/logs
 */

import { execSync } from "child_process";
import chalk from "chalk";
import { XDGConfig } from "../../lib/xdg-config";
import type { XDGBase } from "../../lib/xdg-base";

const STACK_NAME = "BenchlingWebhookStack";

export interface LogsCommandOptions {
    profile?: string;
    stage?: string;
    awsProfile?: string;
    type?: string;
    since?: string;
    filter?: string;
    follow?: boolean;
    tail?: number;
    configStorage?: XDGBase;
}

export interface LogsResult {
    success: boolean;
    error?: string;
}

interface StackOutput {
    OutputKey: string;
    OutputValue: string;
    Description?: string;
    ExportName?: string;
}

interface LogGroupDefinition {
    type: string;
    group: string | undefined;
}

/**
 * Get deployment configuration from profile
 */
function getDeploymentFromProfile(
    profile: string,
    stage: string,
    configStorage: XDGBase
): { region: string } | null {
    try {
        const deployment = configStorage.getActiveDeployment(profile, stage);
        if (deployment) {
            return { region: deployment.region };
        }
    } catch {
        // Deployment tracking not available
    }
    return null;
}

/**
 * Get AWS region from deployment tracking or environment
 */
function getAwsRegion(
    profile: string,
    stage: string,
    configStorage: XDGBase
): string {
    // Try deployment tracking
    const deployment = getDeploymentFromProfile(profile, stage, configStorage);
    if (deployment) {
        return deployment.region;
    }

    // Fall back to environment
    if (process.env.CDK_DEFAULT_REGION) {
        return process.env.CDK_DEFAULT_REGION;
    }
    if (process.env.AWS_REGION) {
        return process.env.AWS_REGION;
    }

    // Default
    console.warn(chalk.yellow("⚠️  No region found, defaulting to us-east-1"));
    return "us-east-1";
}

/**
 * Get CloudFormation stack outputs
 */
function getStackOutputs(
    region: string,
    awsProfile?: string
): StackOutput[] {
    try {
        const profileFlag = awsProfile ? `--profile ${awsProfile}` : "";
        const output = execSync(
            `aws cloudformation describe-stacks --stack-name ${STACK_NAME} --region ${region} ${profileFlag} --query 'Stacks[0].Outputs' --output json`,
            { encoding: "utf-8" }
        );
        return JSON.parse(output) as StackOutput[];
    } catch {
        throw new Error(
            `Could not get stack outputs for ${STACK_NAME}. ` +
            `Make sure the stack is deployed and AWS credentials are configured.`
        );
    }
}

/**
 * Get log group from stack outputs by type
 */
function getLogGroupFromOutputs(
    outputs: StackOutput[],
    logType: string
): string {
    let outputKey: string;
    if (logType === "ecs") {
        outputKey = "EcsLogGroup";
    } else if (logType === "api") {
        outputKey = "ApiGatewayLogGroup";
    } else if (logType === "api-exec") {
        outputKey = "ApiGatewayExecutionLogGroup";
    } else {
        throw new Error(`Invalid log type: ${logType}`);
    }

    const logGroupOutput = outputs.find((o) => o.OutputKey === outputKey);
    if (!logGroupOutput) {
        throw new Error(
            `Could not find ${outputKey} in stack outputs. ` +
            `Stack may need to be redeployed.`
        );
    }

    return logGroupOutput.OutputValue;
}

/**
 * Print stack information header
 */
function printStackInfo(
    outputs: StackOutput[],
    logType: string,
    profile: string,
    stage: string
): void {
    console.log("=".repeat(80));
    console.log("Benchling Webhook Logs");
    console.log("=".repeat(80));

    const clusterName = outputs.find((o) => o.OutputKey === "FargateServiceClusterNameCD3B109F");
    const serviceName = outputs.find((o) => o.OutputKey === "FargateServiceServiceName24CFD869");
    const webhookEndpoint = outputs.find((o) => o.OutputKey === "WebhookEndpoint");
    const version = outputs.find((o) => o.OutputKey === "StackVersion");
    const ecsLogGroup = outputs.find((o) => o.OutputKey === "EcsLogGroup");
    const apiLogGroup = outputs.find((o) => o.OutputKey === "ApiGatewayLogGroup");
    const apiExecLogGroup = outputs.find((o) => o.OutputKey === "ApiGatewayExecutionLogGroup");

    console.log(`Profile:   ${profile}`);
    console.log(`Stage:     ${stage}`);
    if (clusterName) console.log(`Cluster:   ${clusterName.OutputValue}`);
    if (serviceName) console.log(`Service:   ${serviceName.OutputValue}`);
    if (webhookEndpoint) console.log(`Endpoint:  ${webhookEndpoint.OutputValue}`);
    if (version) console.log(`Version:   ${version.OutputValue}`);

    console.log("");
    console.log("Log Groups:");
    if (ecsLogGroup) {
        console.log(`  ECS:         ${ecsLogGroup.OutputValue}${logType === "ecs" ? " (viewing)" : ""}`);
    }
    if (apiLogGroup) {
        console.log(`  API Access:  ${apiLogGroup.OutputValue}${logType === "api" ? " (viewing)" : ""}`);
    }
    if (apiExecLogGroup) {
        console.log(`  API Exec:    ${apiExecLogGroup.OutputValue}${logType === "api-exec" ? " (viewing)" : ""}`);
    }

    console.log("=".repeat(80));
    console.log("");
}

/**
 * Tail logs from a single log group
 */
function tailLogs(
    logGroup: string,
    region: string,
    options: {
        awsProfile?: string;
        since: string;
        filter?: string;
        follow: boolean;
        tail: number;
    }
): void {
    const profileFlag = options.awsProfile ? `--profile ${options.awsProfile}` : "";
    let command = `aws logs tail "${logGroup}"`;
    command += ` --region ${region}`;
    if (profileFlag) command += ` ${profileFlag}`;
    command += ` --since ${options.since}`;
    command += " --format short";

    if (options.filter) {
        command += ` --filter-pattern "${options.filter}"`;
    }

    if (options.follow) {
        command += " --follow";
        console.log("Following logs (Press Ctrl+C to stop)...\n");
    } else {
        command += ` | tail -${options.tail}`;
        console.log(`Showing last ${options.tail} log entries from the past ${options.since}...\n`);
    }

    try {
        execSync(command, { stdio: "inherit" });
    } catch (error: any) {
        if (error.status !== 130) {
            // Ignore Ctrl+C exit (status 130)
            throw new Error(
                "Error fetching logs. Make sure:\n" +
                "1. The stack is deployed\n" +
                "2. AWS CLI is configured with proper credentials\n" +
                "3. You have CloudWatch Logs read permissions"
            );
        }
    }
}

/**
 * Show logs from all log groups
 */
function showAllLogs(
    outputs: StackOutput[],
    region: string,
    options: {
        awsProfile?: string;
        since: string;
        filter?: string;
        tail: number;
    }
): void {
    console.log("Showing logs from all sources (most recent first):\n");

    const logGroupDefs: LogGroupDefinition[] = [
        { type: "ECS", group: outputs.find((o) => o.OutputKey === "EcsLogGroup")?.OutputValue },
        { type: "API-Access", group: outputs.find((o) => o.OutputKey === "ApiGatewayLogGroup")?.OutputValue },
        { type: "API-Exec", group: outputs.find((o) => o.OutputKey === "ApiGatewayExecutionLogGroup")?.OutputValue },
    ];

    // Warn about missing log groups
    const missingGroups = logGroupDefs.filter((lg) => !lg.group);
    if (missingGroups.length > 0) {
        console.log(chalk.yellow("⚠️  WARNING: Some log groups are not available:"));
        missingGroups.forEach(({ type }) => {
            console.log(chalk.yellow(`   - ${type}: Stack output not found (may need to redeploy)`));
        });
        console.log("");
    }

    const logGroups = logGroupDefs.filter((lg) => lg.group);

    for (const { type, group } of logGroups) {
        console.log(`\n${"=".repeat(80)}`);
        console.log(`${type}: ${group}`);
        console.log("=".repeat(80));

        const profileFlag = options.awsProfile ? `--profile ${options.awsProfile}` : "";
        let command = `aws logs tail "${group}"`;
        command += ` --region ${region}`;
        if (profileFlag) command += ` ${profileFlag}`;
        command += ` --since ${options.since}`;
        command += " --format short";
        if (options.filter) {
            command += ` --filter-pattern "${options.filter}"`;
        }
        command += ` 2>&1 | tail -${options.tail}`;

        try {
            const output = execSync(command, { encoding: "utf-8", shell: "/bin/bash" });
            if (output.trim()) {
                console.log(output);
            } else {
                console.log(chalk.dim(`(No logs in the last ${options.since})`));
            }
        } catch (error: any) {
            console.log(chalk.red(`Error reading ${type} logs: ${error.message}`));
        }
    }
}

/**
 * Logs command implementation
 */
export async function logsCommand(options: LogsCommandOptions = {}): Promise<LogsResult> {
    const {
        profile = "default",
        stage = "prod",
        awsProfile,
        type = "all",
        since = "5m",
        filter,
        follow = false,
        tail = 100,
        configStorage,
    } = options;

    // Validate log type
    if (!["ecs", "api", "api-exec", "all"].includes(type)) {
        const errorMsg = "Invalid log type. Must be 'ecs', 'api', 'api-exec', or 'all'";
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }

    // Validate follow with type=all
    if (follow && type === "all") {
        const errorMsg = "Cannot use --follow with --type=all. Please specify a specific log type.";
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }

    const xdg = configStorage || new XDGConfig();

    // Check profile exists
    if (!xdg.profileExists(profile)) {
        const errorMsg = `Profile '${profile}' not found. Run setup first.`;
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }

    try {
        // Get AWS region
        const region = getAwsRegion(profile, stage, xdg);

        // Get stack outputs
        const outputs = getStackOutputs(region, awsProfile);

        // Show info header
        printStackInfo(outputs, type, profile, stage);

        // Handle different log types
        if (type === "all") {
            showAllLogs(outputs, region, {
                awsProfile,
                since,
                filter,
                tail,
            });
        } else {
            const logGroup = getLogGroupFromOutputs(outputs, type);
            tailLogs(logGroup, region, {
                awsProfile,
                since,
                filter,
                follow,
                tail,
            });
        }

        return { success: true };
    } catch (error) {
        const errorMsg = (error as Error).message;
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }
}
```

#### 2. CLI Integration

**File**: `bin/cli.ts`

**Location**: After status command (around line 156)

**Add Command**:

```typescript
// Logs command
program
    .command("logs")
    .description("View CloudWatch logs from deployed webhook integration")
    .option("--profile <name>", "Configuration profile to use (default: default)")
    .option("--stage <name>", "Deployment stage: dev or prod (default: prod)")
    .option("--aws-profile <name>", "AWS credentials profile")
    .option(
        "--type <type>",
        "Log group to view: all (default), ecs, api, api-exec",
        "all"
    )
    .option(
        "--since <time>",
        "Time period to fetch logs (examples: 5m, 1h, 2d)",
        "5m"
    )
    .option("--filter <pattern>", "Filter logs by pattern (example: ERROR)")
    .option("--follow, -f", "Follow log output in real-time (not available with --type=all)")
    .option("--tail <n>", "Number of lines to show (default: 100, only without --follow)", "100")
    .addHelpText(
        "after",
        `

Log Types:
  all       All log groups (ECS, API Gateway access, API Gateway execution)
  ecs       ECS container logs (application logs)
  api       API Gateway access logs (request/response info)
  api-exec  API Gateway execution logs (detailed debugging)

Examples:
  View all logs from prod deployment:
    $ npx @quiltdata/benchling-webhook logs --profile sales

  View ECS logs from dev stage:
    $ npx @quiltdata/benchling-webhook logs --profile sales --stage dev --type ecs

  Follow ECS logs in real-time:
    $ npx @quiltdata/benchling-webhook logs --profile sales --type ecs --follow

  Filter for errors in last hour:
    $ npx @quiltdata/benchling-webhook logs --profile sales --since 1h --filter ERROR

  View API Gateway execution logs:
    $ npx @quiltdata/benchling-webhook logs --profile sales --type api-exec --tail 50

For more information: https://github.com/quiltdata/benchling-webhook#viewing-logs
`,
    )
    .action(async (options) => {
        try {
            await logsCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });
```

**Add Import** (at top):

```typescript
import { logsCommand } from "./commands/logs";
```

**Update Valid Commands List** (around line 316):

```typescript
const validCommands = [
    "deploy",
    "setup",
    "status",
    "logs",  // NEW
    "init",
    "validate",
    "test",
    "manifest",
    "setup-profile",
    "health-check",
    "config",
];
```

#### 3. Update Next Steps Messages

**File**: `lib/wizard/phase6-integrated-mode.ts`

**Location**: Line 201-202

**Current Code**:
```typescript
console.log(`  3. Monitor logs: npx ts-node scripts/check-logs.ts --profile ${setupResult.profile}\n`);
console.log(`  4. Monitor logs: npx ts-node scripts/check-logs.ts --profile ${profile}\n`);
```

**New Code**:
```typescript
console.log(chalk.cyan(`     npx @quiltdata/benchling-webhook logs --profile ${profile}`));
```

**Full Context** (lines 195-205):

```typescript
console.log(chalk.bold("Next steps:"));
console.log("  1. Monitor stack update:");
console.log(chalk.cyan(`     npx @quiltdata/benchling-webhook status --profile ${profile}`));
console.log("  2. Configure webhook URL in Benchling app settings");
console.log("     (Get the webhook URL from your Quilt stack outputs)");
console.log("  3. Test the webhook integration");
console.log("  4. Monitor logs:");
console.log(chalk.cyan(`     npx @quiltdata/benchling-webhook logs --profile ${profile}`));
console.log("");
```

**File**: `lib/next-steps-generator.ts`

**Search for similar patterns** and update all occurrences.

**File**: `bin/commands/install.ts`

**Search for similar patterns** and update all occurrences.

#### 4. scripts/check-logs.ts

**Decision**: Fix the bugs OR mark as deprecated

**Option A: Fix the script**
- Fix profile flag to actually use AWS profile credentials
- Fix to read from XDG config for profile/stage
- Fix to use deployment tracking to find correct stack
- Keep as alternative for internal development

**Option B: Deprecate immediately**
- Add deprecation notice pointing to new command
- Keep for backward compatibility only
- Remove in next major version

**Recommended: Option B** - The script is already broken, so there's no real "backward compatibility" to maintain. Users should migrate to the working command.

**Deprecation notice**:

```typescript
/**
 * @deprecated This script is BROKEN and does not properly support profiles
 *
 * Use `npx @quiltdata/benchling-webhook logs` instead
 *
 * Known issues in this script:
 * - --profile flag is parsed but ignored (always uses 'default')
 * - --stage flag doesn't use deployment tracking
 * - Hardcoded stack name doesn't work with profile configurations
 *
 * This script will be removed in v1.0.0
 */
```

## Implementation Plan

### Phase 1: Create Logs Command (4 hours)

1. Create `bin/commands/logs.ts`
2. Implement core functionality from `scripts/check-logs.ts`
3. Add proper TypeScript types and interfaces
4. Add error handling and user-friendly messages
5. Add validation for options

### Phase 2: CLI Integration (2 hours)

1. Add logs command to `bin/cli.ts`
2. Update valid commands list
3. Add help text and examples
4. Test command registration and option parsing

### Phase 3: Update Next Steps (2 hours)

1. Search for all references to `check-logs.ts`
2. Update `phase6-integrated-mode.ts`
3. Update `next-steps-generator.ts`
4. Update `install.ts` if applicable
5. Verify all next steps messages

### Phase 4: Testing (3 hours)

1. Unit tests for logs command
2. Integration tests with real profiles
3. Test all log types (ecs, api, api-exec, all)
4. Test follow mode
5. Test filtering and time ranges
6. Test error cases

### Phase 5: Documentation (2 hours)

1. Update README.md with logs command
2. Update help text in CLI
3. Add migration note for check-logs.ts users
4. Update troubleshooting guide

**Total Estimated Time**: 13 hours

## Testing Strategy

### Unit Tests

**New File**: `test/bin/commands/logs.test.ts`

```typescript
describe("logsCommand", () => {
    it("should show all logs by default");
    it("should show ECS logs with --type=ecs");
    it("should show API logs with --type=api");
    it("should show API execution logs with --type=api-exec");
    it("should reject invalid log types");
    it("should reject --follow with --type=all");
    it("should handle missing profiles");
    it("should handle missing stack");
    it("should handle missing log groups gracefully");
    it("should respect --since option");
    it("should respect --tail option");
    it("should respect --filter option");
});
```

### Integration Tests

```bash
# Test with real profile
npx @quiltdata/benchling-webhook logs --profile sales

# Test different log types
npx @quiltdata/benchling-webhook logs --profile sales --type ecs
npx @quiltdata/benchling-webhook logs --profile sales --type api
npx @quiltdata/benchling-webhook logs --profile sales --type api-exec

# Test filtering
npx @quiltdata/benchling-webhook logs --profile sales --filter ERROR

# Test time ranges
npx @quiltdata/benchling-webhook logs --profile sales --since 1h

# Test follow mode
npx @quiltdata/benchling-webhook logs --profile sales --type ecs --follow
```

### Manual Testing Checklist

- [ ] Command shows in `--help` output
- [ ] Default (all logs) works without options
- [ ] Each log type (ecs, api, api-exec) works individually
- [ ] Filter pattern works correctly
- [ ] Time ranges (5m, 1h, 2d) work correctly
- [ ] Tail limit works correctly
- [ ] Follow mode works and can be interrupted
- [ ] Error messages are clear and actionable
- [ ] Works with dev and prod stages
- [ ] Works with custom AWS profiles
- [ ] Handles missing log groups gracefully
- [ ] Shows helpful header with stack info

## Success Metrics

1. **NPX Compatibility**: 100% functional via NPX without ts-node
2. **Profile Support**: Actually works with `--profile` flag (unlike check-logs.ts)
3. **Stage Support**: Uses deployment tracking to find correct stack/region
4. **Discoverability**: Shows in `--help` and command list
5. **UX**: Clear, consistent with other commands
6. **Test Coverage**: >85% for new code

## Edge Cases & Error Handling

### Edge Case 1: Stack Not Deployed

**Scenario**: User tries to view logs but stack doesn't exist
**Handling**: Show friendly error with setup instructions

```
❌ Could not get stack outputs for BenchlingWebhookStack.
   Make sure the stack is deployed and AWS credentials are configured.

   To deploy: npx @quiltdata/benchling-webhook deploy --profile sales
```

### Edge Case 2: Missing Log Groups

**Scenario**: Old stack version without all log groups
**Handling**: Warn about missing groups but show available ones

```
⚠️  WARNING: Some log groups are not available:
   - API-Exec: Stack output not found (may need to redeploy)

Showing available logs...
```

### Edge Case 3: No Logs in Time Range

**Scenario**: No logs found for specified time period
**Handling**: Show message instead of empty output

```
(No logs in the last 5m)
```

### Edge Case 4: Invalid AWS Credentials

**Scenario**: AWS credentials expired or invalid
**Handling**: Show clear error with troubleshooting steps

```
❌ Error fetching logs. Make sure:
   1. The stack is deployed
   2. AWS CLI is configured with proper credentials
   3. You have CloudWatch Logs read permissions
```

### Edge Case 5: Follow Mode with All Logs

**Scenario**: User tries `--follow --type=all`
**Handling**: Reject with clear error

```
❌ Cannot use --follow with --type=all.
   Please specify a specific log type: ecs, api, or api-exec
```

## Backward Compatibility

- **check-logs.ts**: Deprecated (was already broken for profiles)
- **npm run logs**: Still works but should be updated to call new command
- **New command**: Additive, no breaking changes
- **Existing workflows**: May need updates if they relied on broken profile behavior
  - Any workflows using `--profile` were already broken
  - Workflows using default profile only will continue to work

## Migration Path

### For Users of check-logs.ts

**Old**:
```bash
npx ts-node scripts/check-logs.ts --profile sales --type ecs
```

**New**:
```bash
npx @quiltdata/benchling-webhook logs --profile sales --type ecs
```

**Migration Steps**:
1. Update documentation to reference new command
2. Add deprecation notice to check-logs.ts
3. Update internal scripts and workflows
4. Consider removing check-logs.ts in v1.0.0

## Security Considerations

- Uses existing AWS credentials (no new auth)
- Read-only CloudWatch Logs access required
- No sensitive data exposed beyond what's in logs
- Respects AWS IAM permissions
- No credential storage or caching

## Future Enhancements

1. **Log Parsing**: Parse and pretty-print JSON logs
2. **Error Highlighting**: Color-code error messages
3. **Log Search**: Full-text search across log groups
4. **Export**: Save logs to file for analysis
5. **Metrics**: Show log statistics (error rate, request count)
6. **AWS SDK**: Replace AWS CLI with direct SDK calls for better performance
7. **Live Updates**: Real-time log streaming with WebSockets

## Documentation Updates

### README.md

Add section after "Checking Integration Status":

```markdown
### Viewing Logs

View CloudWatch logs from your deployed webhook integration:

```bash
# View all logs (ECS + API Gateway)
npx @quiltdata/benchling-webhook logs --profile myprofile

# View only ECS container logs
npx @quiltdata/benchling-webhook logs --profile myprofile --type ecs

# Follow logs in real-time
npx @quiltdata/benchling-webhook logs --profile myprofile --type ecs --follow

# Filter for errors in the last hour
npx @quiltdata/benchling-webhook logs --profile myprofile --since 1h --filter ERROR
```

**Log Types**:
- `all` - All log groups (default)
- `ecs` - ECS container logs (application logs)
- `api` - API Gateway access logs (request/response)
- `api-exec` - API Gateway execution logs (detailed debugging)

**Options**:
- `--type` - Log group to view
- `--since` - Time period (5m, 1h, 2d)
- `--filter` - Filter by pattern
- `--follow` - Stream logs in real-time
- `--tail` - Number of lines to show
- `--stage` - Deployment stage (dev or prod)
```

### Help Text

Already included in CLI integration above.

## Rollout Plan

1. **Implementation**: 13 hours (see Implementation Plan)
2. **Code Review**: Review with team
3. **Testing**: Manual testing with real deployments
4. **Beta**: Test with 2-3 users on NPX version
5. **Release**: Include in next minor version (0.8.0)
6. **Communication**: Update docs and announce in changelog
7. **Monitor**: Track usage and error rates

## Appendix: Command Comparison

### Before (check-logs.ts)

```bash
# Requires source code access
npx ts-node scripts/check-logs.ts --profile sales --type=ecs --tail=50

# Not listed in help
npx @quiltdata/benchling-webhook --help
# (no logs command shown)

# Not discoverable
```

### After (logs command)

```bash
# Works from NPX
npx @quiltdata/benchling-webhook logs --profile sales --type ecs --tail 50

# Listed in help
npx @quiltdata/benchling-webhook --help
# logs    View CloudWatch logs from deployed webhook integration

# Discoverable and consistent
npx @quiltdata/benchling-webhook logs --help
```

### Feature Parity Matrix

| Feature | check-logs.ts | logs command | Status |
| --------- | --------------- | -------------- | -------- |
| ECS logs | ✅ | ✅ | Parity |
| API logs | ✅ | ✅ | Parity |
| API exec logs | ✅ | ✅ | Parity |
| All logs | ✅ | ✅ | Parity |
| Follow mode | ✅ | ✅ | Parity |
| Filter pattern | ✅ | ✅ | Parity |
| Time ranges | ✅ | ✅ | Parity |
| Tail limit | ✅ | ✅ | Parity |
| Profile support | ❌ **BROKEN** | ✅ | **FIXED** |
| Stage support | ❌ **BROKEN** | ✅ | **FIXED** |
| NPX compatible | ❌ | ✅ | **Improved** |
| Listed in help | ❌ | ✅ | **Improved** |
| Consistent UX | ⚠️ | ✅ | **Improved** |

**Note**: check-logs.ts parses `--profile` and `--stage` flags but doesn't actually use them correctly. The new command fixes these bugs.

---

**Document Status**: Ready for Implementation
**Last Updated**: 2025-11-15
**Author**: Claude (Sonnet 4.5)
**Related Issue**: Part of #221 (Next Steps Enhancement)
**Dependencies**: Spec 17 (Status Command)
