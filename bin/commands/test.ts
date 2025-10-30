import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import type { ConfigOptions } from "../../lib/utils/config";

export async function testCommand(options: ConfigOptions & { url?: string }): Promise<void> {
    let webhookUrl = options.url;

    // If no URL provided, try to get it from CloudFormation stack outputs
    if (!webhookUrl) {
        const spinner = ora("Retrieving webhook URL from stack...").start();
        try {
            const cloudformation = new CloudFormationClient({});

            // Try to find the stack
            const command = new DescribeStacksCommand({
                StackName: "BenchlingWebhookStack",
            });
            const response = await cloudformation.send(command);

            if (response.Stacks && response.Stacks.length > 0) {
                const stack = response.Stacks[0];
                const output = stack.Outputs?.find(o => o.OutputKey === "WebhookEndpoint");

                if (output?.OutputValue) {
                    webhookUrl = output.OutputValue;
                    spinner.succeed(`Found webhook URL: ${chalk.cyan(webhookUrl)}`);
                } else {
                    spinner.fail("Could not find WebhookEndpoint in stack outputs");
                    console.log();
                    console.log(chalk.yellow("Usage: npx @quiltdata/benchling-webhook test --url <webhook-url>"));
                    process.exit(1);
                }
            } else {
                spinner.fail("Stack BenchlingWebhookStack not found");
                console.log();
                console.log(chalk.yellow("Make sure the stack is deployed, or provide a URL:"));
                console.log(chalk.cyan("  npx @quiltdata/benchling-webhook test --url <webhook-url>"));
                process.exit(1);
            }
        } catch (err) {
            spinner.fail("Could not retrieve stack outputs");
            console.log();
            console.log(chalk.red((err as Error).message));
            console.log();
            console.log(chalk.yellow("Make sure the stack is deployed, or provide a URL:"));
            console.log(chalk.cyan("  npx @quiltdata/benchling-webhook test --url <webhook-url>"));
            process.exit(1);
        }
    }

    // Test health endpoint
    console.log();
    const spinner = ora("Testing webhook health endpoint...").start();

    try {
        const healthUrl = `${webhookUrl}/health`;
        const result = execSync(`curl -s -w "\\n%{http_code}" "${healthUrl}"`, {
            encoding: "utf-8",
            timeout: 10000,
        });

        const lines = result.trim().split("\n");
        const statusCode = lines[lines.length - 1];
        const body = lines.slice(0, -1).join("\n");

        if (statusCode === "200") {
            spinner.succeed("Health check passed");
            console.log();
            console.log(chalk.green.bold("✓ Webhook is healthy!"));
            console.log();
            console.log(chalk.bold("Response:"));
            console.log(chalk.dim(body));
            console.log();
            console.log(chalk.bold("Next steps:"));
            console.log("  1. Ensure your Benchling app's webhook URL is set to:");
            console.log(`     ${chalk.cyan(webhookUrl)}`);
            console.log("  2. Test the integration by creating a Quilt package in Benchling");
            console.log();
        } else {
            spinner.fail(`Health check failed (HTTP ${statusCode})`);
            console.log();
            console.log(chalk.red.bold("✗ Webhook returned an error"));
            console.log();
            console.log(chalk.bold("Response:"));
            console.log(body);
            console.log();
            console.log(chalk.yellow("Troubleshooting:"));
            console.log("  1. Check CloudWatch logs for errors");
            console.log("  2. Verify the stack deployed successfully");
            console.log("  3. Ensure your AWS credentials are configured");
            process.exit(1);
        }
    } catch (error) {
        spinner.fail("Health check failed");
        console.log();
        console.log(chalk.red((error as Error).message));
        console.log();
        console.log(chalk.yellow("This might indicate:"));
        console.log("  - The webhook endpoint is not accessible");
        console.log("  - Network connectivity issues");
        console.log("  - The stack is not fully deployed yet");
        process.exit(1);
    }
}
