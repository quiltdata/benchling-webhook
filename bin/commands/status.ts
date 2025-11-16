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
 * Status command implementation
 */
export async function statusCommand(options: StatusCommandOptions = {}): Promise<StatusResult> {
    const {
        profile = "default",
        awsProfile,
        configStorage,
    } = options;

    const xdg = configStorage || new XDGConfig();

    console.log(chalk.bold(`\nStack Status for Profile: ${profile}\n`));
    console.log(chalk.dim("─".repeat(80)));

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

    console.log(`Stack: ${chalk.cyan(stackArn.match(/stack\/([^/]+)\//)?.[1] || stackArn)}`);
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

    console.log(chalk.bold("BenchlingIntegration:"));
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
