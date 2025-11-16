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
                        stackName: STACK_NAME, // Still check BenchlingWebhookStack for metadata
                        integratedMode: true,
                        quiltStackName: match[1], // But use Quilt stack name for logs
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
    },
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
    } catch (error) {
        const err = error as { status?: number };
        if (err.status !== 130) {
            // Ignore Ctrl+C exit (status 130)
            throw new Error(
                "Error fetching logs. Make sure:\n" +
                "1. The stack is deployed\n" +
                "2. AWS CLI is configured with proper credentials\n" +
                "3. You have CloudWatch Logs read permissions",
            );
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
        // Get AWS region and deployment info from profile
        const deploymentInfo = getDeploymentInfo(profile, xdg);
        if (!deploymentInfo) {
            const errorMsg = `Could not determine AWS region for profile '${profile}'. Make sure the profile is configured correctly.`;
            console.error(chalk.red(`\n❌ ${errorMsg}\n`));
            return { success: false, error: errorMsg };
        }

        const { region, integratedMode, quiltStackName } = deploymentInfo;

        // For integrated mode, use Quilt stack name; for standalone use BenchlingWebhookStack
        const logGroupName = integratedMode && quiltStackName ? quiltStackName : "BenchlingWebhookStack";

        console.log("================================================================================");
        console.log("Benchling Webhook Logs");
        console.log("================================================================================");
        console.log(`Profile:   ${profile}`);
        console.log(`Stage:     ${stage}`);
        console.log(`Region:    ${region}`);
        console.log(`Mode:      ${integratedMode ? "Integrated" : "Standalone"}`);
        console.log(`Log Group: ${logGroupName}`);
        console.log("================================================================================");
        console.log("");

        // Tail the log group
        tailLogs(logGroupName, region, {
            awsProfile,
            since,
            filter,
            follow,
            tail,
        });

        return { success: true };
    } catch (error) {
        const errorMsg = (error as Error).message;
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }
}
