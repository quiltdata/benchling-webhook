import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { prompt } from "enquirer";
import { maskArn } from "../../lib/utils/config";
import {
    parseStackArn,
    ConfigResolverError,
} from "../../lib/utils/config-resolver";
import { checkCdkBootstrap } from "../benchling-webhook";
import { XDGConfig } from "../../lib/xdg-config";
import { generateSecretName } from "../../lib/utils/secrets";
import { existsSync } from "fs";

export async function deployCommand(options: { yes?: boolean; bootstrapCheck?: boolean; requireApproval?: string; quiltStackArn?: string; benchlingSecret?: string; imageTag?: string; region?: string; envFile?: string }): Promise<void> {
    console.log(
        boxen(chalk.bold("Benchling Webhook Deployment"), {
            padding: 1,
            borderColor: "blue",
            borderStyle: "round",
        }),
    );
    console.log();

    // Try to read from XDG config first
    const xdg = new XDGConfig();
    let xdgConfig: Record<string, unknown> | null = null;

    try {
        if (existsSync(xdg.getPaths().userConfig)) {
            xdgConfig = xdg.readConfig("user");
            console.log(chalk.dim("✓ Loaded configuration from XDG config\n"));
        }
    } catch (error) {
        console.log(chalk.yellow(`⚠  Could not load XDG config: ${(error as Error).message}`));
        console.log(chalk.dim("  Falling back to CLI options and environment variables\n"));
    }

    // Get required parameters with priority: CLI options > XDG config > environment variables
    const quiltStackArn = options.quiltStackArn ||
                         (xdgConfig?.quiltStackArn as string) ||
                         process.env.QUILT_STACK_ARN;

    // Generate secret name from XDG config if available
    let xdgSecretName: string | undefined;
    if (xdgConfig) {
        const profile = (xdgConfig.profile as string) || "default";
        const tenant = xdgConfig.benchlingTenant as string;
        if (tenant) {
            xdgSecretName = generateSecretName(profile, tenant);
            console.log(chalk.dim(`  Generated secret name: ${xdgSecretName}\n`));
        } else {
            console.log(chalk.yellow("  ⚠  XDG config missing benchlingTenant field"));
            console.log(chalk.dim("    Secret name will use default or CLI option\n"));
        }
    }

    // Resolve secret name from various sources
    const benchlingSecret = options.benchlingSecret ||
                           xdgSecretName ||
                           (xdgConfig?.benchlingSecret as string) ||
                           process.env.BENCHLING_SECRET;

    // Get image tag from options or XDG config
    const imageTag = options.imageTag ||
                    (xdgConfig?.imageTag as string) ||
                    "latest";

    // Validate required parameters
    const missingParams: string[] = [];
    if (!quiltStackArn) missingParams.push("--quilt-stack-arn");
    if (!benchlingSecret) missingParams.push("--benchling-secret");

    if (missingParams.length > 0) {
        console.error(chalk.red.bold("❌ Missing Required Parameters\n"));
        missingParams.forEach(param => {
            console.error(chalk.red(`  ${param} is required`));
        });
        console.log();
        console.log(chalk.yellow("Options:"));
        console.log("  1. Provide via CLI:");
        console.log(chalk.cyan("     npx @quiltdata/benchling-webhook deploy \\"));
        console.log(chalk.cyan("       --quilt-stack-arn <arn> \\"));
        console.log(chalk.cyan("       --benchling-secret <name>"));
        console.log();
        console.log("  2. Set in XDG config:");
        console.log(chalk.cyan("     npm run setup"));
        console.log();
        console.log(chalk.yellow("Example:"));
        console.log(chalk.cyan("  npx @quiltdata/benchling-webhook deploy \\"));
        console.log(chalk.cyan("    --quilt-stack-arn \"arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc123\" \\"));
        console.log(chalk.cyan("    --benchling-secret \"quiltdata/benchling-webhook/default/my-tenant\""));
        console.log();
        process.exit(1);
    }

    // Deploy (both parameters validated above)
    return await deploy(quiltStackArn!, benchlingSecret!, { ...options, imageTag });
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

    // Sync secrets to ensure they're up-to-date (force update)
    spinner.start("Syncing Benchling secrets to AWS Secrets Manager...");
    try {
        // Run sync-secrets with --force to ensure secrets are up-to-date
        execSync("npm run setup:sync-secrets -- --force", {
            stdio: "pipe",
            encoding: "utf-8",
            env: {
                ...process.env,
                AWS_REGION: deployRegion,
            },
        });

        spinner.succeed(`Secrets synced to '${benchlingSecret}'`);
    } catch (error) {
        spinner.fail("Failed to sync secrets");
        console.log();
        console.error(chalk.red((error as Error).message));
        console.log();
        console.log(chalk.yellow("To sync secrets manually, run:"));
        console.log(chalk.cyan(`  npm run setup:sync-secrets -- --force --region ${deployRegion}`));
        console.log();
        process.exit(1);
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
                QUILT_STACK_ARN: quiltStackArn,
                BENCHLING_SECRET: benchlingSecret,
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
