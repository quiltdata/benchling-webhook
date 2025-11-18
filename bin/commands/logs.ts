#!/usr/bin/env node
/**
 * Logs Command
 *
 * View CloudWatch logs for deployed Benchling webhook integration.
 * Supports ECS container logs, API Gateway access logs, and execution logs.
 *
 * @module commands/logs
 */

import chalk from "chalk";
import ora from "ora";
import {
    CloudWatchLogsClient,
    FilterLogEventsCommand,
    type FilteredLogEvent,
} from "@aws-sdk/client-cloudwatch-logs";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { fromIni } from "@aws-sdk/credential-providers";
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
    timer?: string | number;
    limit?: number;
}

export interface LogsResult {
    success: boolean;
    error?: string;
    logGroups?: LogGroupInfo[];
}

export interface LogGroupInfo {
    name: string;
    displayName: string;
    entries: FilteredLogEvent[];
}

/**
 * Get AWS region and deployment info from profile configuration
 */
function getDeploymentInfo(
    profile: string,
    configStorage: XDGBase,
): { region: string; stackName: string; integratedMode: boolean; quiltStackName?: string } | null {
    try {
        const config = configStorage.readProfile(profile);
        if (config.deployment?.region) {
            const region = config.deployment.region;
            const integratedMode = config.integratedStack || false;

            // For integrated mode, extract Quilt stack name from ARN
            if (integratedMode && config.quilt?.stackArn) {
                const match = config.quilt.stackArn.match(/stack\/([^/]+)\//);
                if (match) {
                    return {
                        region,
                        stackName: STACK_NAME,
                        integratedMode: true,
                        quiltStackName: match[1],
                    };
                }
            }

            // For standalone mode, use BenchlingWebhookStack
            return {
                region,
                stackName: STACK_NAME,
                integratedMode: false,
            };
        }
    } catch (error) {
        // Profile not found or invalid
        console.warn(chalk.yellow(`⚠️  Could not read profile '${profile}': ${(error as Error).message}`));
    }
    return null;
}

/**
 * Parse time range string (e.g., "5m", "1h", "2d") to milliseconds
 */
function parseTimeRange(since: string): number {
    const match = since.match(/^(\d+)([mhd])$/);
    if (!match) {
        throw new Error(`Invalid time format: ${since}. Use format like "5m", "1h", or "2d"`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
    case "m":
        return value * 60 * 1000;
    case "h":
        return value * 60 * 60 * 1000;
    case "d":
        return value * 24 * 60 * 60 * 1000;
    default:
        throw new Error(`Invalid time unit: ${unit}`);
    }
}

/**
 * Format milliseconds to human-readable time range string
 */
function formatTimeRange(ms: number): string {
    const minutes = ms / (60 * 1000);
    const hours = minutes / 60;
    const days = hours / 24;

    if (days >= 1) {
        return `${Math.round(days)}d`;
    } else if (hours >= 1) {
        return `${Math.round(hours)}h`;
    } else {
        return `${Math.round(minutes)}m`;
    }
}

/**
 * Double the time range, capping at 7 days
 */
function expandTimeRange(currentSince: string): string {
    const currentMs = parseTimeRange(currentSince);
    const doubledMs = currentMs * 2;
    const maxMs = 7 * 24 * 60 * 60 * 1000; // 7 days

    if (doubledMs >= maxMs) {
        return "7d";
    }

    return formatTimeRange(doubledMs);
}

/**
 * Parse timer value (string or number) and returns interval in milliseconds
 * Returns null if timer is disabled (0 or non-numeric string)
 */
function parseTimerValue(timer?: string | number): number | null {
    if (timer === undefined) return 10000; // Default 10 seconds

    const numValue = typeof timer === "string" ? parseFloat(timer) : timer;

    // If NaN or 0, disable timer
    if (isNaN(numValue) || numValue === 0) {
        return null;
    }

    // Return milliseconds
    return numValue * 1000;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clear screen and move cursor to top
 */
function clearScreen(): void {
    process.stdout.write("\x1b[2J\x1b[H");
}

/**
 * Get log group names from CloudFormation stack outputs or ECS services
 */
async function getLogGroupsFromStack(
    stackName: string,
    region: string,
    integratedMode: boolean,
    awsProfile?: string,
): Promise<{ ecsLogGroup?: string; apiLogGroup?: string; apiExecLogGroup?: string }> {
    try {
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        // For integrated mode, discover log groups from ECS services
        if (integratedMode) {
            const { CloudFormationClient: CF, DescribeStackResourcesCommand } = await import("@aws-sdk/client-cloudformation");
            const { ECSClient, DescribeServicesCommand, DescribeTaskDefinitionCommand } = await import("@aws-sdk/client-ecs");

            const cfClient = new CF(clientConfig);
            const ecsClient = new ECSClient(clientConfig);

            // Find ECS resources in stack
            const resourcesCommand = new DescribeStackResourcesCommand({
                StackName: stackName,
            });
            const resourcesResponse = await cfClient.send(resourcesCommand);

            const ecsServices = resourcesResponse.StackResources?.filter(
                (r) => r.ResourceType === "AWS::ECS::Service",
            ) || [];

            if (ecsServices.length === 0) {
                return {};
            }

            // Find the benchling service specifically
            const benchlingService = ecsServices.find((s) =>
                s.LogicalResourceId?.toLowerCase().includes("benchling") &&
                !s.LogicalResourceId?.toLowerCase().includes("bulk") &&
                !s.LogicalResourceId?.toLowerCase().includes("scanner"),
            );

            if (!benchlingService?.PhysicalResourceId) {
                return {};
            }

            // Get cluster name
            const clusterResource = resourcesResponse.StackResources?.find(
                (r) => r.ResourceType === "AWS::ECS::Cluster",
            );
            const clusterName = clusterResource?.PhysicalResourceId || stackName;

            // Describe the service to get task definition
            const servicesCommand = new DescribeServicesCommand({
                cluster: clusterName,
                services: [benchlingService.PhysicalResourceId],
            });
            const servicesResponse = await ecsClient.send(servicesCommand);

            const service = servicesResponse.services?.[0];
            const taskDefArn = service?.deployments?.[0]?.taskDefinition;

            if (!taskDefArn) {
                return {};
            }

            // Get task definition to extract log group
            const taskDefCommand = new DescribeTaskDefinitionCommand({
                taskDefinition: taskDefArn,
            });
            const taskDefResponse = await ecsClient.send(taskDefCommand);

            const logConfig = taskDefResponse.taskDefinition?.containerDefinitions?.[0]?.logConfiguration;
            if (logConfig?.logDriver === "awslogs") {
                return {
                    ecsLogGroup: logConfig.options?.["awslogs-group"],
                };
            }

            return {};
        }

        // For standalone mode, use stack outputs
        const cfClient = new CloudFormationClient(clientConfig);
        const command = new DescribeStacksCommand({ StackName: stackName });
        const response = await cfClient.send(command);
        const stack = response.Stacks?.[0];

        if (!stack) {
            return {};
        }

        const outputs = stack.Outputs || [];
        return {
            ecsLogGroup: outputs.find((o) => o.OutputKey === "EcsLogGroup")?.OutputValue,
            apiLogGroup: outputs.find((o) => o.OutputKey === "ApiGatewayLogGroup")?.OutputValue,
            apiExecLogGroup: outputs.find((o) => o.OutputKey === "ApiGatewayExecutionLogGroup")?.OutputValue,
        };
    } catch (error) {
        console.warn(chalk.dim(`Could not retrieve log groups from stack: ${(error as Error).message}`));
        return {};
    }
}

/**
 * Fetch logs from a single log group
 */
async function fetchLogsFromGroup(
    logGroupName: string,
    region: string,
    since: string,
    limit: number,
    filterPattern?: string,
    awsProfile?: string,
): Promise<FilteredLogEvent[]> {
    try {
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }
        const logsClient = new CloudWatchLogsClient(clientConfig);

        const startTime = Date.now() - parseTimeRange(since);

        const command = new FilterLogEventsCommand({
            logGroupName,
            startTime,
            filterPattern,
            limit,
        });

        const response = await logsClient.send(command);
        return response.events || [];
    } catch (error) {
        console.warn(chalk.dim(`Could not fetch logs from ${logGroupName}: ${(error as Error).message}`));
        return [];
    }
}

/**
 * Display logs in organized sections
 */
function displayLogs(
    logGroups: LogGroupInfo[],
    profile: string,
    region: string,
    since: string,
    limit: number,
    expanded?: boolean,
): void {
    const now = new Date();
    const timeStr = now.toLocaleString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    console.log(chalk.bold(`\nLogs for Profile: ${profile} @ ${timeStr} (${timezone})\n`));
    console.log(chalk.dim("─".repeat(80)));
    console.log(`${chalk.bold("Region:")} ${chalk.cyan(region)}  ${chalk.bold("Time Range:")} ${chalk.cyan(`Last ${since}`)}${expanded ? chalk.yellow(" (auto-expanded)") : ""}`);
    console.log(`${chalk.bold("Showing:")} ${chalk.cyan(`Last ~${limit} entries per log group`)}`);
    console.log(chalk.dim("─".repeat(80)));
    console.log("");

    // Display each log group in its own section
    for (const logGroup of logGroups) {
        console.log(chalk.bold(`${logGroup.displayName}:`));
        console.log(chalk.dim(`  Log Group: ${logGroup.name}`));

        if (logGroup.entries.length === 0) {
            console.log(chalk.dim("  No log entries found\n"));
            continue;
        }

        console.log(chalk.dim(`  Showing ${logGroup.entries.length} entries:\n`));

        // Display log entries
        for (const entry of logGroup.entries) {
            if (!entry.timestamp || !entry.message) continue;

            const timestamp = new Date(entry.timestamp);
            const timeDisplay = timestamp.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            });

            // Color code by log level if detectable
            let message = entry.message.trim();
            let messageColor = chalk.white;

            if (message.includes("ERROR") || message.includes("CRITICAL")) {
                messageColor = chalk.red;
            } else if (message.includes("WARNING") || message.includes("WARN")) {
                messageColor = chalk.yellow;
            } else if (message.includes("INFO")) {
                messageColor = chalk.cyan;
            } else if (message.includes("DEBUG")) {
                messageColor = chalk.dim;
            }

            console.log(`  ${chalk.dim(timeDisplay)} ${messageColor(message)}`);
        }

        console.log("");
    }

    console.log(chalk.dim("─".repeat(80)));
}


/**
 * Fetch logs from all relevant log groups
 */
async function fetchAllLogs(
    stackName: string,
    region: string,
    since: string,
    limit: number,
    type: string,
    integratedMode: boolean,
    filterPattern?: string,
    awsProfile?: string,
): Promise<LogGroupInfo[]> {
    // Get log groups from stack
    const logGroups = await getLogGroupsFromStack(stackName, region, integratedMode, awsProfile);

    const result: LogGroupInfo[] = [];

    // Determine which log groups to query based on type
    const typesToQuery = type === "all" ? ["ecs", "api", "api-exec"] : [type];

    for (const logType of typesToQuery) {
        let logGroupName: string | undefined;
        let displayName: string;

        switch (logType) {
        case "ecs":
            logGroupName = logGroups.ecsLogGroup;
            displayName = "ECS Container Logs";
            break;
        case "api":
            logGroupName = logGroups.apiLogGroup;
            displayName = "API Gateway Access Logs";
            break;
        case "api-exec":
            logGroupName = logGroups.apiExecLogGroup;
            displayName = "API Gateway Execution Logs";
            break;
        default:
            continue;
        }

        if (!logGroupName) {
            // Don't warn on first attempt, we'll handle it at the result level
            continue;
        }

        // Fetch logs from this group
        const entries = await fetchLogsFromGroup(
            logGroupName,
            region,
            since,
            limit,
            filterPattern,
            awsProfile,
        );

        // Sort by timestamp descending (most recent first) and limit
        const sortedEntries = entries
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, limit);

        result.push({
            name: logGroupName,
            displayName,
            entries: sortedEntries,
        });
    }

    return result;
}

/**
 * Logs command implementation
 */
export async function logsCommand(options: LogsCommandOptions = {}): Promise<LogsResult> {
    const {
        profile = "default",
        awsProfile,
        type = "all",
        since = "5m",
        filter,
        follow = false,
        timer,
        limit = 5,
        configStorage,
    } = options;

    // Validate log type
    if (!["ecs", "api", "api-exec", "all"].includes(type)) {
        const errorMsg = "Invalid log type. Must be 'ecs', 'api', 'api-exec', or 'all'";
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }

    // Validate follow mode (not supported with new implementation)
    if (follow) {
        const errorMsg = "Follow mode (--follow) is not supported. Use --timer to auto-refresh logs.";
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        console.log(chalk.dim("Example: benchling-webhook logs --timer 5\n"));
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
        // Get AWS region and deployment info from profile
        const deploymentInfo = getDeploymentInfo(profile, xdg);
        if (!deploymentInfo) {
            const errorMsg = `Could not determine AWS region for profile '${profile}'. Make sure the profile is configured correctly.`;
            console.error(chalk.red(`\n❌ ${errorMsg}\n`));
            return { success: false, error: errorMsg };
        }

        const { region, integratedMode, quiltStackName } = deploymentInfo;

        // For integrated mode, use Quilt stack name; for standalone use BenchlingWebhookStack
        const stackName = integratedMode && quiltStackName ? quiltStackName : STACK_NAME;

        // Parse timer value
        const refreshInterval = parseTimerValue(timer);

        // Setup Ctrl+C handler for graceful exit
        let shouldExit = false;
        const exitHandler = (): void => {
            shouldExit = true;
            console.log(chalk.dim("\n\n⚠️  Interrupted by user. Exiting...\n"));
            process.exit(0);
        };
        process.on("SIGINT", exitHandler);

        let result: LogsResult = { success: true };
        let isFirstRun = true;
        let currentSince = since;
        let wasExpanded = false;

        // Watch loop
        while (true) {
            // Clear screen on subsequent runs
            if (!isFirstRun && refreshInterval) {
                clearScreen();
            }

            // Fetch logs from all relevant log groups
            const logGroups = await fetchAllLogs(
                stackName,
                region,
                currentSince,
                limit,
                type,
                integratedMode,
                filter,
                awsProfile,
            );

            // Check if any log group has entries
            const totalEntries = logGroups.reduce((sum, lg) => sum + lg.entries.length, 0);
            const hasLogs = totalEntries > 0;
            const hasLogGroups = logGroups.length > 0;

            // If no log groups found at all, show error and exit
            if (!hasLogGroups) {
                console.error(chalk.red("\n❌ No log groups found in stack outputs."));
                console.log(chalk.dim("   This could mean:"));
                console.log(chalk.dim("   - The stack hasn't been deployed yet"));
                console.log(chalk.dim("   - Log groups haven't been created"));
                console.log(chalk.dim(`   - Stack name might be incorrect: ${stackName}\n`));

                // Don't loop if there are no log groups
                if (!refreshInterval) {
                    break;
                }

                // Wait before retrying
                const totalSeconds = Math.floor(refreshInterval / 1000);
                const spinner = ora({
                    text: chalk.dim(`⟳ Retrying in ${totalSeconds} second${totalSeconds !== 1 ? "s" : ""}... (Ctrl+C to exit)`),
                    color: "gray",
                }).start();

                for (let i = totalSeconds; i > 0; i--) {
                    spinner.text = chalk.dim(`⟳ Retrying in ${i} second${i !== 1 ? "s" : ""}... (Ctrl+C to exit)`);
                    await sleep(1000);
                    if (shouldExit) break;
                }

                spinner.stop();

                if (shouldExit) {
                    break;
                }

                isFirstRun = false;
                continue;
            }

            // Smart expansion: if no logs found and not at max, expand time window
            if (!hasLogs && currentSince !== "7d") {
                const nextSince = expandTimeRange(currentSince);
                console.log(chalk.yellow(`⚠️  No logs found in last ${currentSince}. Expanding to ${nextSince}...\n`));
                currentSince = nextSince;
                wasExpanded = true;

                // Small delay before retry
                await sleep(500);
                continue;
            }

            // Display logs
            displayLogs(logGroups, profile, region, currentSince, limit, wasExpanded);

            result.logGroups = logGroups;

            // If no logs found at max range, show helpful message
            if (!hasLogs && currentSince === "7d") {
                console.log(chalk.yellow("\n💡 No logs found in the last 7 days."));
                console.log(chalk.dim("   This could mean:"));
                console.log(chalk.dim("   - The service hasn't received any requests"));
                console.log(chalk.dim("   - Logging is not configured correctly"));
                console.log(chalk.dim("   - No activity has occurred in this time period\n"));
            }

            // Reset expansion flag if we found logs
            if (hasLogs) {
                wasExpanded = false;
            }

            // Check if we should exit (no timer)
            if (!refreshInterval) {
                break;
            }

            // Show countdown with live updates
            const totalSeconds = Math.floor(refreshInterval / 1000);
            const spinner = ora({
                text: chalk.dim(`⟳ Refreshing in ${totalSeconds} second${totalSeconds !== 1 ? "s" : ""}... (Ctrl+C to exit)`),
                color: "gray",
            }).start();

            for (let i = totalSeconds; i > 0; i--) {
                spinner.text = chalk.dim(`⟳ Refreshing in ${i} second${i !== 1 ? "s" : ""}... (Ctrl+C to exit)`);
                await sleep(1000);
                if (shouldExit) break;
            }

            spinner.stop();

            if (shouldExit) {
                break;
            }

            isFirstRun = false;
        }

        // Clean up handler
        process.off("SIGINT", exitHandler);

        return result;
    } catch (error) {
        const errorMsg = (error as Error).message;
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }
}
