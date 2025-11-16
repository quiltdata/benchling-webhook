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
 * Get CloudFormation stack outputs
 */
function getStackOutputs(
    stackName: string,
    region: string,
    awsProfile?: string,
): StackOutput[] {
    try {
        const profileFlag = awsProfile ? `--profile ${awsProfile}` : "";
        const output = execSync(
            `aws cloudformation describe-stacks --stack-name ${stackName} --region ${region} ${profileFlag} --query 'Stacks[0].Outputs' --output json`,
            { encoding: "utf-8" },
        );
        return JSON.parse(output) as StackOutput[];
    } catch {
        throw new Error(
            `Could not get stack outputs for ${stackName}. ` +
            "Make sure the stack is deployed and AWS credentials are configured.",
        );
    }
}

/**
 * Get log group from stack outputs by type
 */
function getLogGroupFromOutputs(
    outputs: StackOutput[],
    logType: string,
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
            "Stack may need to be redeployed.",
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
    stage: string,
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
    } catch (error: any) {
        if (error.status !== 130) {
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
    },
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
