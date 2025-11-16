#!/usr/bin/env node
/**
 * Stack Status Command
 *
 * Reports CloudFormation stack status and BenchlingIntegration parameter state
 * for a given configuration profile.
 *
 * @module commands/status
 */

import chalk from "chalk";
import { CloudFormationClient, DescribeStacksCommand, DescribeStackEventsCommand, DescribeStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import { ECSClient, DescribeServicesCommand } from "@aws-sdk/client-ecs";
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
    ecsServices?: Array<{
        serviceName: string;
        status: string;
        desiredCount: number;
        runningCount: number;
        pendingCount: number;
        rolloutState?: string;
    }>;
    stackEvents?: Array<{
        timestamp: Date;
        resourceId: string;
        status: string;
        reason?: string;
    }>;
}

/**
 * Gets stack status from CloudFormation
 */
async function getStackStatus(
    stackArn: string,
    region: string,
    awsProfile?: string,
): Promise<StatusResult> {
    try {
        // Extract stack name from ARN
        const stackNameMatch = stackArn.match(/stack\/([^/]+)\//);
        if (!stackNameMatch) {
            throw new Error(`Invalid stack ARN format: ${stackArn}`);
        }
        const stackName = stackNameMatch[1];

        // Configure AWS SDK client
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
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

        // Extract BenchlingIntegration parameter
        const param = stack.Parameters?.find((p) => p.ParameterKey === "BenchlingIntegration");
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
export function formatStackStatus(status: string): string {
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
 * Gets ECS service health information
 */
async function getEcsServiceHealth(
    stackName: string,
    region: string,
    awsProfile?: string,
): Promise<StatusResult["ecsServices"]> {
    try {
        // Configure AWS SDK clients
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        const cfClient = new CloudFormationClient(clientConfig);
        const ecsClient = new ECSClient(clientConfig);

        // Find ECS resources in stack
        const resourcesCommand = new DescribeStackResourcesCommand({
            StackName: stackName,
        });
        const resourcesResponse = await cfClient.send(resourcesCommand);

        const ecsServices = resourcesResponse.StackResources?.filter(
            (r) => r.ResourceType === "AWS::ECS::Service"
        ) || [];

        if (ecsServices.length === 0) {
            return undefined;
        }

        // Get cluster name (assuming all services use the same cluster)
        const clusterResource = resourcesResponse.StackResources?.find(
            (r) => r.ResourceType === "AWS::ECS::Cluster"
        );
        const clusterName = clusterResource?.PhysicalResourceId || stackName;

        // Describe all ECS services
        const serviceArns = ecsServices
            .map((s) => s.PhysicalResourceId)
            .filter((arn): arn is string => !!arn);

        if (serviceArns.length === 0) {
            return undefined;
        }

        const servicesCommand = new DescribeServicesCommand({
            cluster: clusterName,
            services: serviceArns,
        });
        const servicesResponse = await ecsClient.send(servicesCommand);

        return servicesResponse.services?.map((svc: { serviceName?: string; status?: string; desiredCount?: number; runningCount?: number; pendingCount?: number; deployments?: Array<{ rolloutState?: string }> }) => ({
            serviceName: svc.serviceName || "Unknown",
            status: svc.status || "UNKNOWN",
            desiredCount: svc.desiredCount || 0,
            runningCount: svc.runningCount || 0,
            pendingCount: svc.pendingCount || 0,
            rolloutState: svc.deployments?.[0]?.rolloutState,
        }));
    } catch (error) {
        // ECS health check is optional, don't fail the entire command
        console.error(chalk.dim(`  Could not retrieve ECS service health: ${(error as Error).message}`));
        return undefined;
    }
}

/**
 * Gets recent stack events
 */
async function getRecentStackEvents(
    stackName: string,
    region: string,
    awsProfile?: string,
    maxEvents = 10,
): Promise<StatusResult["stackEvents"]> {
    try {
        // Configure AWS SDK client
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }
        const client = new CloudFormationClient(clientConfig);

        const command = new DescribeStackEventsCommand({
            StackName: stackName,
        });
        const response = await client.send(command);

        return response.StackEvents?.slice(0, maxEvents).map((event) => ({
            timestamp: event.Timestamp || new Date(),
            resourceId: event.LogicalResourceId || "Unknown",
            status: event.ResourceStatus || "UNKNOWN",
            reason: event.ResourceStatusReason,
        }));
    } catch (error) {
        // Stack events are optional, don't fail the entire command
        console.error(chalk.dim(`  Could not retrieve stack events: ${(error as Error).message}`));
        return undefined;
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
    } = options;

    const xdg = configStorage || new XDGConfig();

    // Load configuration
    let config;
    try {
        config = xdg.readProfile(profile);
    } catch {
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
    const stackName = stackArn.match(/stack\/([^/]+)\//)?.[1] || stackArn;
    const result = await getStackStatus(stackArn, region, awsProfile);

    if (!result.success) {
        console.error(chalk.red(`❌ Failed to get stack status: ${result.error}\n`));
        return result;
    }

    // Get ECS service health and recent events in parallel
    const [ecsServices, stackEvents] = await Promise.all([
        getEcsServiceHealth(stackName, region, awsProfile),
        getRecentStackEvents(stackName, region, awsProfile, 3),
    ]);

    result.ecsServices = ecsServices;
    result.stackEvents = stackEvents;

    // Format last updated time in local timezone
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

    // Display header with last updated time
    console.log(chalk.bold(`\nStack Status for Profile: ${profile}${lastUpdatedStr}\n`));
    console.log(chalk.dim("─".repeat(80)));
    console.log(`${chalk.bold("Stack:")} ${chalk.cyan(stackName)}  ${chalk.bold("Region:")} ${chalk.cyan(region)}`);
    console.log(`${chalk.bold("Stack Status:")} ${formatStackStatus(result.stackStatus!)}  ${chalk.bold("BenchlingIntegration:")} ${result.benchlingIntegrationEnabled ? chalk.green("✓ Enabled") : chalk.yellow("⚠ Disabled")}`);
    console.log("");

    // Display ECS service health
    if (result.ecsServices && result.ecsServices.length > 0) {
        console.log(chalk.bold("ECS Services:"));
        for (const svc of result.ecsServices) {
            const statusIcon = svc.status === "ACTIVE" ? "✓" : "⚠";
            const statusColor = svc.status === "ACTIVE" ? chalk.green : chalk.yellow;
            const tasksMatch = svc.runningCount === svc.desiredCount;
            const tasksColor = tasksMatch ? chalk.green : chalk.yellow;

            console.log(`  ${statusColor(statusIcon)} ${chalk.cyan(svc.serviceName)}`);
            console.log(`    Status: ${statusColor(svc.status)}`);
            console.log(`    Tasks: ${tasksColor(`${svc.runningCount}/${svc.desiredCount} running`)}${svc.pendingCount > 0 ? chalk.dim(` (${svc.pendingCount} pending)`) : ""}`);

            if (svc.rolloutState) {
                if (svc.rolloutState === "COMPLETED") {
                    console.log(`    Rollout: ${chalk.green(svc.rolloutState)}`);
                } else if (svc.rolloutState === "FAILED") {
                    console.log(`    Rollout: ${chalk.red(svc.rolloutState)} ❌`);
                } else {
                    console.log(`    Rollout: ${chalk.yellow(svc.rolloutState)}`);
                }
            }
        }
        console.log("");
    }

    // Display recent stack events
    if (result.stackEvents && result.stackEvents.length > 0) {
        const now = new Date();
        console.log(chalk.bold("Recent Stack Events:"));
        console.log(chalk.dim(`  Current time: ${now.toISOString().replace("T", " ").substring(0, 19)} UTC\n`));

        for (const event of result.stackEvents) {
            // Calculate time delta
            const deltaMs = now.getTime() - event.timestamp.getTime();
            const deltaMinutes = Math.floor(deltaMs / 60000);
            const deltaHours = Math.floor(deltaMinutes / 60);
            const deltaDays = Math.floor(deltaHours / 24);

            let deltaStr: string;
            if (deltaDays > 0) {
                deltaStr = `${deltaDays}d ${deltaHours % 24}h ago`;
            } else if (deltaHours > 0) {
                deltaStr = `${deltaHours}h ${deltaMinutes % 60}m ago`;
            } else if (deltaMinutes > 0) {
                deltaStr = `${deltaMinutes}m ago`;
            } else {
                deltaStr = "just now";
            }

            const statusStr = formatStackStatus(event.status);
            console.log(`  ${chalk.dim(deltaStr.padEnd(15))} ${statusStr}`);
            console.log(`    ${chalk.cyan(event.resourceId)}`);
            if (event.reason && event.reason !== "None") {
                console.log(`    ${chalk.dim(event.reason)}`);
            }
        }
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
            console.log(chalk.yellow("  BenchlingIntegration is Disabled"));
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
