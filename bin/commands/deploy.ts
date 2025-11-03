import { execSync, spawnSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { prompt } from "enquirer";
import { SecretsManagerClient, DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { maskArn } from "../../lib/utils/config";
import {
    parseStackArn,
    ConfigResolverError,
} from "../../lib/utils/config-resolver";
import { checkCdkBootstrap } from "../benchling-webhook";

export async function deployCommand(options: { yes?: boolean; bootstrapCheck?: boolean; requireApproval?: string; quiltStackArn?: string; benchlingSecret?: string; imageTag?: string; region?: string; envFile?: string }): Promise<void> {
    console.log(
        boxen(chalk.bold("Benchling Webhook Deployment"), {
            padding: 1,
            borderColor: "blue",
            borderStyle: "round",
        }),
    );
    console.log();

    // Get required parameters
    const quiltStackArn = options.quiltStackArn || process.env.QUILT_STACK_ARN;
    // Use default secret name if not provided
    const benchlingSecret = options.benchlingSecret || process.env.BENCHLING_SECRET || "@quiltdata/benchling-webhook";

    // Validate required parameter
    if (!quiltStackArn) {
        console.error(chalk.red.bold("❌ Missing Required Parameter\n"));
        console.error(chalk.red("  --quilt-stack-arn is required"));
        console.log();
        console.log(chalk.yellow("Usage:"));
        console.log(chalk.cyan("  npx @quiltdata/benchling-webhook deploy --quilt-stack-arn <arn>"));
        console.log();
        console.log(chalk.yellow("Example:"));
        console.log(chalk.cyan("  npx @quiltdata/benchling-webhook deploy \\"));
        console.log(chalk.cyan("    --quilt-stack-arn \"arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc123\""));
        console.log();
        process.exit(1);
    }

    // Deploy
    return await deploy(quiltStackArn, benchlingSecret, options);
}

/**
 * Check if a secret exists in AWS Secrets Manager
 */
async function checkSecretExists(secretName: string, region: string): Promise<boolean> {
    try {
        const client = new SecretsManagerClient({ region });
        await client.send(new DescribeSecretCommand({ SecretId: secretName }));
        return true;
    } catch (error: unknown) {
        if (error && typeof error === "object" && "name" in error && error.name === "ResourceNotFoundException") {
            return false;
        }
        // For other errors (e.g., permission issues), throw them
        throw error;
    }
}

/**
 * Run npm run config to create the secret
 */
function runConfigCommand(secretName: string, region: string, envFile: string = ".env"): boolean {
    console.log();
    console.log(chalk.yellow("📝 Secret not found. Running configuration setup..."));
    console.log();

    const result = spawnSync(
        "npm",
        ["run", "config", "--", "--secret-name", secretName, "--region", region, "--env-file", envFile],
        {
            stdio: "inherit",
            shell: true,
        },
    );

    if (result.status !== 0) {
        console.log();
        console.log(chalk.red("❌ Failed to create secret. Please run:"));
        console.log(chalk.cyan(`   npm run config -- --secret-name ${secretName} --region ${region}`));
        console.log();
        return false;
    }

    console.log();
    return true;
}

/**
 * Deploy the Benchling webhook stack
 */
async function deploy(
    quiltStackArn: string,
    benchlingSecret: string,
    options: { yes?: boolean; bootstrapCheck?: boolean; requireApproval?: string; imageTag?: string; region?: string; envFile?: string },
): Promise<void> {
    const spinner = ora("Validating parameters...").start();

    // Parse stack ARN to extract region/account
    let parsed;
    try {
        parsed = parseStackArn(quiltStackArn);
        spinner.succeed("Stack ARN validated");
    } catch (error) {
        spinner.fail("Invalid Stack ARN");
        console.log();
        if (error instanceof ConfigResolverError) {
            console.error(error.format());
        } else {
            console.error(chalk.red((error as Error).message));
        }
        console.log();
        console.log(chalk.yellow("Expected format:"));
        console.log("  arn:aws:cloudformation:region:account:stack/name/id");
        console.log();
        console.log(chalk.yellow("Example:"));
        console.log("  arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123");
        process.exit(1);
    }

    // Use region from stack ARN, but allow override from CLI
    const deployRegion = options.region || parsed.region;
    const deployAccount = parsed.account;

    // Check if secret exists, create if needed
    spinner.start("Checking if Benchling secret exists...");
    try {
        const secretExists = await checkSecretExists(benchlingSecret, deployRegion);

        if (!secretExists) {
            spinner.info(`Secret '${benchlingSecret}' not found`);

            // Ask user if they want to create it
            const response: { createSecret: boolean } = await prompt({
                type: "confirm",
                name: "createSecret",
                message: `Would you like to create the secret '${benchlingSecret}' now using your .env file?`,
                initial: true,
            });

            if (response.createSecret) {
                const created = runConfigCommand(benchlingSecret, deployRegion, options.envFile || ".env");
                if (!created) {
                    process.exit(1);
                }
                spinner.succeed(`Secret '${benchlingSecret}' created successfully`);
            } else {
                spinner.fail("Secret is required for deployment");
                console.log();
                console.log(chalk.yellow("To create the secret manually, run:"));
                console.log(chalk.cyan(`  npm run config -- --secret-name ${benchlingSecret} --region ${deployRegion}`));
                console.log();
                process.exit(1);
            }
        } else {
            spinner.succeed(`Secret '${benchlingSecret}' exists`);
        }
    } catch (error) {
        spinner.warn("Could not verify secret existence (will attempt deployment anyway)");
        console.log(chalk.dim(`  ${(error as Error).message}`));
    }

    // Check CDK bootstrap
    if (options.bootstrapCheck !== false) {
        spinner.start("Checking CDK bootstrap status...");

        const bootstrapStatus = await checkCdkBootstrap(deployAccount, deployRegion);

        if (!bootstrapStatus.bootstrapped) {
            spinner.fail("CDK is not bootstrapped");
            console.log();
            console.error(chalk.red.bold("❌ CDK Bootstrap Error\n"));
            console.error(bootstrapStatus.message);
            console.log();
            console.log("To bootstrap CDK, run:");
            console.log(chalk.cyan(`  ${bootstrapStatus.command}`));
            console.log();
            console.log(chalk.dim("What is CDK bootstrap?"));
            console.log(chalk.dim("  It creates necessary AWS resources (S3 bucket, IAM roles) that CDK"));
            console.log(chalk.dim("  needs to deploy CloudFormation stacks. This is a one-time setup per"));
            console.log(chalk.dim("  AWS account/region combination."));
            console.log();
            process.exit(1);
        }

        if (bootstrapStatus.warning) {
            spinner.warn(`CDK bootstrap: ${bootstrapStatus.warning}`);
        } else {
            spinner.succeed(`CDK is bootstrapped (${bootstrapStatus.status})`);
        }
    }

    // Display deployment plan
    console.log();
    console.log(chalk.bold("Deployment Plan"));
    console.log(chalk.gray("─".repeat(80)));
    console.log(`  ${chalk.bold("Stack:")}                     BenchlingWebhookStack`);
    console.log(`  ${chalk.bold("Account:")}                   ${deployAccount}`);
    console.log(`  ${chalk.bold("Region:")}                    ${deployRegion}`);
    console.log();
    console.log(chalk.bold("  Stack Parameters:"));
    console.log(`    ${chalk.bold("Quilt Stack ARN:")}         ${maskArn(quiltStackArn)}`);
    console.log(`    ${chalk.bold("Benchling Secret:")}        ${benchlingSecret}`);
    console.log(`    ${chalk.bold("Docker Image Tag:")}        ${options.imageTag || "latest"}`);
    console.log();
    console.log(chalk.dim("  ℹ️  All other configuration will be resolved from AWS at runtime"));
    console.log(chalk.gray("─".repeat(80)));
    console.log();

    // Confirm (unless --yes)
    if (!options.yes) {
        const response: { proceed: boolean } = await prompt({
            type: "confirm",
            name: "proceed",
            message: "Proceed with deployment?",
            initial: true,
        });

        if (!response.proceed) {
            console.log(chalk.yellow("Deployment cancelled"));
            process.exit(0);
        }
        console.log();
    }

    // Deploy using CDK CLI
    spinner.start("Deploying to AWS (this may take a few minutes)...");
    spinner.stop();
    console.log();

    try {
        // Build CloudFormation parameters
        const parameters = [
            `QuiltStackARN=${quiltStackArn}`,
            `BenchlingSecret=${benchlingSecret}`,
            `ImageTag=${options.imageTag || "latest"}`,
        ];

        const parametersArg = parameters.map(p => `--parameters ${p}`).join(" ");
        const cdkCommand = `npx cdk deploy --require-approval ${options.requireApproval || "never"} ${parametersArg}`;

        execSync(cdkCommand, {
            stdio: "inherit",
            env: {
                ...process.env,
                CDK_DEFAULT_ACCOUNT: deployAccount,
                CDK_DEFAULT_REGION: deployRegion,
            },
        });

        console.log();
        spinner.succeed("Stack deployed successfully");

        // Get stack outputs
        spinner.start("Retrieving stack outputs...");
        let webhookUrl = "";
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { CloudFormationClient, DescribeStacksCommand } = require("@aws-sdk/client-cloudformation");
            const cloudformation = new CloudFormationClient({
                region: deployRegion,
            });

            const command = new DescribeStacksCommand({
                StackName: "BenchlingWebhookStack",
            });
            const response = await cloudformation.send(command);

            if (response.Stacks && response.Stacks.length > 0) {
                const stack = response.Stacks[0];
                const output = stack.Outputs?.find((o: { OutputKey?: string }) => o.OutputKey === "WebhookEndpoint");
                webhookUrl = output?.OutputValue || "";
            }
            spinner.succeed("Stack outputs retrieved");
        } catch {
            spinner.warn("Could not retrieve stack outputs");
        }

        // Test the webhook endpoint
        if (webhookUrl) {
            console.log();
            spinner.start("Testing webhook endpoint...");
            try {
                const testCmd = `curl -s -w "\\n%{http_code}" "${webhookUrl}/health"`;
                const testResult = execSync(testCmd, { encoding: "utf-8", timeout: 10000 });
                const lines = testResult.trim().split("\n");
                const statusCode = lines[lines.length - 1];

                if (statusCode === "200") {
                    spinner.succeed("Webhook health check passed");
                } else {
                    spinner.warn(`Webhook returned HTTP ${statusCode}`);
                }
            } catch {
                spinner.warn("Could not test webhook endpoint");
            }
        }

        // Success message
        console.log();
        console.log(
            boxen(
                `${chalk.green.bold("✓ Deployment completed successfully!")}\n\n` +
                `Stack:  ${chalk.cyan("BenchlingWebhookStack")}\n` +
                `Region: ${chalk.cyan(deployRegion)}\n` +
                (webhookUrl ? `Webhook URL: ${chalk.cyan(webhookUrl)}\n\n` : "\n") +
                `${chalk.bold("Next steps:")}\n` +
                "  1. Set the webhook URL in your Benchling app settings:\n" +
                `     ${chalk.cyan(webhookUrl || "<WEBHOOK_URL>")}\n\n` +
                "  2. Test the integration by creating a Quilt package in Benchling\n\n" +
                `${chalk.dim("For more info: https://github.com/quiltdata/benchling-webhook#readme")}`,
                { padding: 1, borderColor: "green", borderStyle: "round" },
            ),
        );
    } catch (error) {
        spinner.fail("Deployment failed");
        console.error();
        console.error(chalk.red((error as Error).message));
        process.exit(1);
    }
}
