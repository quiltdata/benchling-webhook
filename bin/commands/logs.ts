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
import { discoverECSServiceLogGroups, discoverAPIGatewayLogGroups } from "../../lib/utils/ecs-service-discovery";
import { parseTimeRange, formatTimeRange, formatLocalDateTime, formatLocalTime, getLocalTimezone } from "../../lib/utils/time-format";
import { sleep, clearScreen, parseTimerValue } from "../../lib/utils/cli-helpers";
import { getEcsRolloutStatus } from "./status";

const STACK_NAME = "BenchlingWebhookStack";
const DEFAULT_LOG_LIMIT = 20; // Number of meaningful log entries to show per log group (after filtering health checks)
const FETCH_LIMIT = 100; // Fetch more logs to ensure we get meaningful entries after filtering

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
    includeHealth?: boolean;
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
): { region: string; stackName: string; integratedMode: boolean; quiltStackName?: string; webhookEndpoint?: string; catalogDns?: string; stackArn?: string } | null {
    try {
        const config = configStorage.readProfile(profile);
        if (config.deployment?.region) {
            const region = config.deployment.region;
            const integratedMode = config.integratedStack || false;

            // Get catalog DNS from config
            const catalogDns = config.quilt?.catalog;

            // Try to get webhook endpoint from deployment tracking
            let webhookEndpoint: string | undefined;
            const deployments = configStorage.getDeployments(profile);
            const stages = ["prod", "dev", ...Object.keys(deployments.active)];
            for (const stage of stages) {
                if (deployments.active[stage]?.endpoint) {
                    webhookEndpoint = deployments.active[stage].endpoint;
                    break;
                }
            }

            // For integrated mode, extract Quilt stack name from ARN
            if (integratedMode && config.quilt?.stackArn) {
                const match = config.quilt.stackArn.match(/stack\/([^/]+)\//);
                if (match) {
                    return {
                        region,
                        stackName: STACK_NAME,
                        integratedMode: true,
                        quiltStackName: match[1],
                        webhookEndpoint,
                        catalogDns,
                        stackArn: config.quilt.stackArn,
                    };
                }
            }

            // For standalone mode, use BenchlingWebhookStack
            return {
                region,
                stackName: STACK_NAME,
                integratedMode: false,
                webhookEndpoint,
                catalogDns,
            };
        }
    } catch (error) {
        // Profile not found or invalid
        console.warn(chalk.yellow(`⚠️  Could not read profile '${profile}': ${(error as Error).message}`));
    }
    return null;
}

/**
 * Query webhook URL from CloudFormation stack outputs (for integrated mode)
 */
async function queryWebhookEndpoint(
    stackArn: string,
    region: string,
    awsProfile?: string,
): Promise<string | undefined> {
    try {
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        const cfClient = new CloudFormationClient(clientConfig);
        const command = new DescribeStacksCommand({ StackName: stackArn });
        const response = await cfClient.send(command);
        const stack = response.Stacks?.[0];

        if (stack?.Outputs) {
            // Look for BenchlingWebhookEndpoint, WebhookEndpoint, or BenchlingUrl
            const webhookOutput = stack.Outputs.find(
                (o) => o.OutputKey === "BenchlingWebhookEndpoint" ||
                       o.OutputKey === "WebhookEndpoint" ||
                       o.OutputKey === "BenchlingUrl",
            );
            return webhookOutput?.OutputValue;
        }
    } catch (error) {
        console.warn(chalk.dim(`Could not query webhook URL from stack: ${(error as Error).message}`));
    }
    return undefined;
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
 * Get log group names from CloudFormation stack outputs or ECS services
 */
async function getLogGroupsFromStack(
    stackName: string,
    region: string,
    integratedMode: boolean,
    awsProfile?: string,
): Promise<Record<string, string>> {
    try {
        // For integrated mode, discover both ECS services and API Gateway logs
        if (integratedMode) {
            const [ecsLogGroups, apiGatewayLogGroups] = await Promise.all([
                discoverECSServiceLogGroups(stackName, region, awsProfile),
                discoverAPIGatewayLogGroups(stackName, region, awsProfile),
            ]);

            // Merge both log group collections
            return { ...ecsLogGroups, ...apiGatewayLogGroups };
        }

        // For standalone mode, use stack outputs
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        const cfClient = new CloudFormationClient(clientConfig);
        const command = new DescribeStacksCommand({ StackName: stackName });
        const response = await cfClient.send(command);
        const stack = response.Stacks?.[0];

        if (!stack) {
            return {};
        }

        const outputs = stack.Outputs || [];
        const logGroups: Record<string, string> = {};

        const ecsLogGroup = outputs.find((o) => o.OutputKey === "EcsLogGroup")?.OutputValue;
        const apiLogGroup = outputs.find((o) => o.OutputKey === "ApiGatewayLogGroup")?.OutputValue;
        const apiExecLogGroup = outputs.find((o) => o.OutputKey === "ApiGatewayExecutionLogGroup")?.OutputValue;
        const authorizerLogGroup = outputs.find((o) => o.OutputKey === "AuthorizerLogGroup")?.OutputValue;

        if (ecsLogGroup) logGroups["ecs"] = ecsLogGroup;
        if (apiLogGroup) logGroups["api"] = apiLogGroup;
        if (apiExecLogGroup) logGroups["api-exec"] = apiExecLogGroup;
        if (authorizerLogGroup) logGroups["authorizer"] = authorizerLogGroup;

        return logGroups;
    } catch (error) {
        console.warn(chalk.dim(`Could not retrieve log groups from stack: ${(error as Error).message}`));
        return {};
    }
}

/**
 * Check if a log message is a health check
 */
function isHealthCheck(message: string): boolean {
    const healthCheckPatterns = [
        /GET\s+\/health/i,
        /GET\s+\/healthcheck/i,
        /ELB-HealthChecker/i,
        /"GET\s+\/\s+HTTP/i, // Root path health checks
    ];
    return healthCheckPatterns.some((pattern) => pattern.test(message));
}

/**
 * Fetch logs from a single log group
 */
async function fetchLogsFromGroup(
    logGroupName: string,
    region: string,
    since: string,
    limit: number,
    includeHealth: boolean,
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

        // Fetch more logs than needed to account for filtering
        const fetchLimit = includeHealth ? limit : FETCH_LIMIT;

        const command = new FilterLogEventsCommand({
            logGroupName,
            startTime,
            filterPattern,
            limit: fetchLimit,
        });

        const response = await logsClient.send(command);
        let events = response.events || [];

        // Filter out health checks unless explicitly requested
        if (!includeHealth) {
            events = events.filter((event) => !isHealthCheck(event.message || ""));
        }

        return events;
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
    webhookEndpoint?: string,
    catalogDns?: string,
    expanded?: boolean,
    rolloutStatus?: string,
    stackArn?: string,
): void {
    const timeStr = formatLocalDateTime(new Date());
    const timezone = getLocalTimezone();

    console.log(chalk.bold(`\nLogs for Profile: ${profile} @ ${timeStr} (${timezone})\n`));
    console.log(chalk.dim("─".repeat(80)));

    // Compact header: Catalog DNS and Webhook URL on one line
    const dnsText = catalogDns ? `${chalk.bold("Catalog:")} ${chalk.cyan(catalogDns)}` : "";
    const webhookText = webhookEndpoint ? `${chalk.bold("Webhook:")} ${chalk.cyan(webhookEndpoint)}` : "";
    if (dnsText || webhookText) {
        console.log(`${dnsText}  ${webhookText}`.trim());
    }

    // Second line: Stack ARN (or Region), Time Range, Limit, and Rollout Status
    const rolloutText = rolloutStatus
        ? rolloutStatus === "COMPLETED"
            ? chalk.green("✓")
            : rolloutStatus === "FAILED"
                ? chalk.red("✗ FAILED")
                : chalk.yellow("⟳ " + rolloutStatus)
        : "";
    const expandedText = expanded ? chalk.yellow(" (auto-expanded)") : "";

    // Strip UUID from stack ARN for cleaner display
    // arn:aws:cloudformation:us-east-2:712023778557:stack/tf-dev-bench2/4c744610... -> arn:aws:cloudformation:us-east-2:712023778557:stack/tf-dev-bench2
    const cleanStackArn = stackArn ? stackArn.replace(/\/[a-f0-9-]{36}$/, "") : undefined;
    const stackText = cleanStackArn ? `${chalk.bold("Stack:")} ${chalk.cyan(cleanStackArn)}` : `${chalk.bold("Region:")} ${chalk.cyan(region)}`;

    console.log(
        `${stackText}  ` +
            `${chalk.bold("Range:")} ${chalk.cyan(`Last ${since}`)}${expandedText}  ` +
            `${chalk.bold("Tail:")} ${chalk.cyan(`~${limit}`)}${rolloutText ? `  ${chalk.bold("Status:")} ${rolloutText}` : ""}`,
    );
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

            const timeDisplay = formatLocalTime(entry.timestamp);
            let message = entry.message.trim();

            // Try to parse as JSON (API Gateway access logs are JSON formatted)
            let isJsonLog = false;
            let parsedLog: Record<string, unknown> | null = null;
            try {
                parsedLog = JSON.parse(message);
                isJsonLog = true;
            } catch {
                // Not JSON, treat as plain text
            }

            // Format JSON logs in a more readable way
            if (isJsonLog && parsedLog) {
                // API Gateway access log format
                const ip = parsedLog.ip as string | undefined;
                const httpMethod = parsedLog.httpMethod as string | undefined;
                const resourcePath = parsedLog.resourcePath as string | undefined;
                const status = parsedLog.status as number | undefined;
                const requestTime = parsedLog.requestTime as string | undefined;
                const responseLength = parsedLog.responseLength as number | undefined;
                const protocol = parsedLog.protocol as string | undefined;

                // Color code by status
                let statusColor = chalk.white;
                if (status) {
                    if (status >= 500) {
                        statusColor = chalk.red.bold;
                    } else if (status >= 400) {
                        statusColor = chalk.yellow;
                    } else if (status >= 300) {
                        statusColor = chalk.cyan;
                    } else if (status >= 200) {
                        statusColor = chalk.green;
                    }
                }

                // Build formatted log line
                const parts: string[] = [];
                if (ip) parts.push(chalk.dim(`IP: ${ip}`));
                if (httpMethod && resourcePath) parts.push(`${chalk.bold(httpMethod)} ${resourcePath}`);
                if (status) parts.push(`${statusColor(status.toString())}`);
                if (responseLength !== undefined) parts.push(chalk.dim(`${responseLength} bytes`));
                if (protocol) parts.push(chalk.dim(protocol));
                if (requestTime) parts.push(chalk.dim(`(${requestTime})`));

                console.log(`  ${chalk.dim(timeDisplay)} ${parts.join(" ")}`);
            } else {
                // Plain text log - color code by log level if detectable
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
    includeHealth: boolean,
    filterPattern?: string,
    awsProfile?: string,
): Promise<LogGroupInfo[]> {
    // Get log groups from stack
    const discoveredLogGroups = await getLogGroupsFromStack(stackName, region, integratedMode, awsProfile);

    const result: LogGroupInfo[] = [];

    // For integrated mode, query all discovered log groups
    if (integratedMode) {
        // Deduplicate log groups (multiple ECS services may share the same log group)
        const uniqueLogGroups = new Map<string, string>();
        for (const [serviceName, logGroupName] of Object.entries(discoveredLogGroups)) {
            // Keep the first service name for each unique log group
            if (!uniqueLogGroups.has(logGroupName)) {
                uniqueLogGroups.set(logGroupName, serviceName);
            }
        }

        // If type is specified and not "all", filter to only matching services
        const logGroupEntries = Array.from(uniqueLogGroups.entries()).map(([logGroupName, serviceName]) => [serviceName, logGroupName]);

        for (const [serviceName, logGroupName] of logGroupEntries) {
            // Determine log type
            let logType: "ecs" | "api-gateway" = "ecs";
            if (serviceName.includes("api-gateway")) {
                logType = "api-gateway";
            }

            // If type filter is specified, only show matching services
            if (type !== "all") {
                // For integrated mode:
                // - "ecs" type shows all ECS services
                // - "api" type shows API Gateway access logs
                // - "api-exec" type shows API Gateway execution logs
                if (type === "ecs" && logType !== "ecs") {
                    continue;
                }
                if ((type === "api" || type === "api-exec") && logType !== "api-gateway") {
                    continue;
                }
                // For API Gateway, further filter by access vs execution
                if (type === "api" && !serviceName.includes("access")) {
                    continue;
                }
                if (type === "api-exec" && !serviceName.includes("execution")) {
                    continue;
                }
            }

            // Fetch logs from this group
            const entries = await fetchLogsFromGroup(
                logGroupName,
                region,
                since,
                limit,
                includeHealth,
                filterPattern,
                awsProfile,
            );

            // Sort by timestamp descending (most recent first) and limit
            const sortedEntries = entries
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                .slice(0, limit);

            // Create friendly display name
            let displayName: string;
            if (logType === "api-gateway") {
                if (serviceName.includes("access")) {
                    displayName = "API Gateway Access Logs";
                } else if (serviceName.includes("execution")) {
                    displayName = "API Gateway Execution Logs";
                } else {
                    displayName = "API Gateway Logs";
                }
            } else {
                // ECS service - use log group name for shared log groups
                // If log group name looks like a simple identifier, use it directly
                if (logGroupName.includes("/") || logGroupName.startsWith("ecs-")) {
                    // Standard ECS log group format - extract friendly name from service
                    displayName = serviceName
                        .split("-")
                        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(" ");
                    displayName = `${displayName} (ECS)`;
                } else {
                    // Simple shared log group name - use it directly
                    displayName = `${logGroupName} (ECS)`;
                }
            }

            result.push({
                name: logGroupName,
                displayName,
                entries: sortedEntries,
            });
        }

        return result;
    }

    // For standalone mode, use the traditional type-based approach
    const typesToQuery = type === "all" ? ["ecs", "api", "api-exec", "authorizer"] : [type];

    for (const logType of typesToQuery) {
        const logGroupName = discoveredLogGroups[logType];

        if (!logGroupName) {
            // Don't warn on first attempt, we'll handle it at the result level
            continue;
        }

        let displayName: string;
        switch (logType) {
        case "ecs":
            displayName = "ECS Container Logs";
            break;
        case "api":
            displayName = "API Gateway Access Logs";
            break;
        case "api-exec":
            displayName = "API Gateway Execution Logs";
            break;
        case "authorizer":
            displayName = "Lambda Authorizer Logs";
            break;
        default:
            displayName = logType;
        }

        // Fetch logs from this group
        const entries = await fetchLogsFromGroup(
            logGroupName,
            region,
            since,
            limit,
            includeHealth,
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
        limit = DEFAULT_LOG_LIMIT,
        configStorage,
        includeHealth = false,
    } = options;

    // Validate log type
    if (!["ecs", "api", "api-exec", "authorizer", "all"].includes(type)) {
        const errorMsg = "Invalid log type. Must be 'ecs', 'api', 'api-exec', 'authorizer', or 'all'";
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

        let { region, integratedMode, quiltStackName, webhookEndpoint, catalogDns, stackArn } = deploymentInfo;

        // For integrated mode, query webhook URL from CloudFormation if not in deployments.json
        if (integratedMode && !webhookEndpoint && stackArn) {
            webhookEndpoint = await queryWebhookEndpoint(stackArn, region, awsProfile);

            // Cache the webhook URL in deployments.json for future lookups
            if (webhookEndpoint) {
                try {
                    xdg.recordDeployment(profile, {
                        stage: "prod",
                        endpoint: webhookEndpoint,
                        timestamp: new Date().toISOString(),
                        imageTag: "integrated", // Marker for integrated stack (no image deployment)
                        stackName: quiltStackName || "QuiltStack",
                        region,
                    });
                } catch (error) {
                    // Non-fatal - just means we'll query again next time
                    console.warn(chalk.dim(`Could not cache webhook URL: ${(error as Error).message}`));
                }
            }
        }

        // For integrated mode, use full stack ARN if available (for API Gateway discovery),
        // otherwise use extracted stack name; for standalone use BenchlingWebhookStack
        const stackName = integratedMode && stackArn ? stackArn :
            integratedMode && quiltStackName ? quiltStackName :
                STACK_NAME;

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
                includeHealth,
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

            // Fetch ECS rollout status (optional, non-blocking)
            let rolloutStatus: string | undefined;
            try {
                rolloutStatus = await getEcsRolloutStatus(
                    integratedMode && quiltStackName ? quiltStackName : STACK_NAME,
                    region,
                    awsProfile,
                );
            } catch {
                // Silently ignore errors - rollout status is optional
            }

            // Display logs
            displayLogs(logGroups, profile, region, currentSince, limit, webhookEndpoint, catalogDns, wasExpanded, rolloutStatus, stackArn);

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
