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
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";

/**
 * Deployment configuration stored in ~/.config/benchling-webhook/deploy.json
 */
interface DeploymentConfig {
    dev?: EnvironmentConfig;
    prod?: EnvironmentConfig;
}

/**
 * Environment-specific deployment details
 */
interface EnvironmentConfig {
    endpoint: string;       // API Gateway webhook URL
    imageTag: string;       // Docker image tag deployed
    deployedAt: string;     // ISO 8601 timestamp
    stackName: string;      // CloudFormation stack name
    region?: string;        // AWS region (default: us-east-1)
}

/**
 * Store deployment configuration in XDG config directory
 * Uses atomic write pattern to prevent corruption
 */
function storeDeploymentConfig(
    environment: 'dev' | 'prod',
    config: EnvironmentConfig
): void {
    const configDir = join(homedir(), ".config", "benchling-webhook");
    const deployJsonPath = join(configDir, "deploy.json");

    // Read existing deploy.json or create new one
    let deployConfig: DeploymentConfig = {};
    if (existsSync(deployJsonPath)) {
        const content = readFileSync(deployJsonPath, "utf8");
        deployConfig = JSON.parse(content);
    }

    // Update environment section
    deployConfig[environment] = config;

    // Ensure config directory exists
    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
    }

    // Write deploy.json atomically
    const tempPath = `${deployJsonPath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(deployConfig, null, 2));

    // Atomic rename (platform-specific)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    if (process.platform === 'win32') {
        // Windows: create backup before rename
        if (existsSync(deployJsonPath)) {
            const backupPath = `${deployJsonPath}.backup`;
            if (existsSync(backupPath)) {
                fs.unlinkSync(backupPath);
            }
            fs.renameSync(deployJsonPath, backupPath);
        }
        fs.renameSync(tempPath, deployJsonPath);
    } else {
        // Unix: atomic rename with overwrite
        fs.renameSync(tempPath, deployJsonPath);
    }

    console.log(`✅ Stored deployment config in ${deployJsonPath}`);
    console.log(`   Environment: ${environment}`);
    console.log(`   Endpoint: ${config.endpoint}`);
}

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

        // After successful deployment, store endpoint and run tests
        console.log();
        console.log("Retrieving deployment endpoint...");

        try {
            const cloudformation = new CloudFormationClient({ region: deployRegion });
            const stackName = "BenchlingWebhookStack";

            const command = new DescribeStacksCommand({ StackName: stackName });
            const response = await cloudformation.send(command);

            if (response.Stacks && response.Stacks.length > 0) {
                const stack = response.Stacks[0];
                const endpointOutput = stack.Outputs?.find((o) => o.OutputKey === "WebhookEndpoint");
                const webhookUrl = endpointOutput?.OutputValue || "";

                if (webhookUrl) {
                    // Determine image tag
                    const imageTag = options.imageTag || "latest";

                    // Store prod deployment config
                    storeDeploymentConfig('prod', {
                        endpoint: webhookUrl,
                        imageTag: imageTag,
                        deployedAt: new Date().toISOString(),
                        stackName: stackName,
                        region: deployRegion,
                    });

                    // Run production tests
                    console.log();
                    console.log("Running production integration tests...");
                    try {
                        execSync("npm run test:prod", {
                            stdio: "inherit",
                            cwd: process.cwd()
                        });
                        console.log();
                        console.log("✅ Production deployment and tests completed successfully!");
                    } catch (testError) {
                        console.error();
                        console.error("❌ Production tests failed!");
                        console.error("   Deployment completed but tests did not pass.");
                        console.error("   Review test output above for details.");
                        process.exit(1);
                    }

                    // Success message with webhook URL
                    console.log();
                    console.log(
                        boxen(
                            `${chalk.green.bold("✓ Deployment and Testing Complete!")}\n\n` +
                            `Stack:  ${chalk.cyan("BenchlingWebhookStack")}\n` +
                            `Region: ${chalk.cyan(deployRegion)}\n` +
                            `Webhook URL: ${chalk.cyan(webhookUrl)}\n\n` +
                            `${chalk.bold("Next steps:")}\n` +
                            "  1. Set the webhook URL in your Benchling app settings:\n" +
                            `     ${chalk.cyan(webhookUrl)}\n\n` +
                            "  2. Test the integration by creating a Quilt package in Benchling\n\n" +
                            `${chalk.dim("For more info: https://github.com/quiltdata/benchling-webhook#readme")}`,
                            { padding: 1, borderColor: "green", borderStyle: "round" },
                        ),
                    );
                } else {
                    console.warn("⚠️  Could not retrieve WebhookEndpoint from stack outputs");
                    console.warn("   Skipping test execution");
                }
            }
        } catch (error) {
            console.warn(`⚠️  Could not retrieve/test deployment endpoint: ${(error as Error).message}`);
            console.warn("   Deployment succeeded but tests were skipped");
        }
    } catch (error) {
        spinner.fail("Deployment failed");
        console.error();
        console.error(chalk.red((error as Error).message));
        process.exit(1);
    }
}
