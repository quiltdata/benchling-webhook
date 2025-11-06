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
import { ProfileConfig } from "../../lib/types/config";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";

/**
 * Deploy command for v0.7.0 configuration architecture
 *
 * Uses new profile-based configuration with deployment tracking.
 * Supports independent --profile and --stage options.
 *
 * @module commands/deploy
 * @version 0.7.0
 */
export async function deployCommand(options: {
    yes?: boolean;
    bootstrapCheck?: boolean;
    requireApproval?: string;
    profile?: string;           // Profile name (default: "default")
    stage?: "dev" | "prod";     // API Gateway stage (independent of profile)
    quiltStackArn?: string;
    benchlingSecret?: string;
    imageTag?: string;
    region?: string;
    envFile?: string;
}): Promise<void> {
    console.log(
        boxen(chalk.bold("Benchling Webhook Deployment"), {
            padding: 1,
            borderColor: "blue",
            borderStyle: "round",
        }),
    );
    console.log();

    // Determine profile name (default: "default")
    const profileName = options.profile || "default";

    // Determine stage (default: "prod")
    const stage = options.stage || "prod";

    // Load configuration from profile
    const xdg = new XDGConfig();
    let config: ProfileConfig;

    try {
        // Use readProfileWithInheritance to support profile inheritance
        config = xdg.readProfileWithInheritance(profileName);
        console.log(chalk.dim(`✓ Loaded configuration from profile: ${profileName}\n`));
    } catch (error) {
        console.error(chalk.red.bold("❌ Configuration Error\n"));
        console.error(chalk.red((error as Error).message));
        console.log();
        console.log(chalk.yellow("Run setup wizard to create configuration:"));
        console.log(chalk.cyan("  npm run setup"));
        console.log();
        process.exit(1);
    }

    // Get required parameters with priority: CLI options > Profile config
    const quiltStackArn = options.quiltStackArn || config.quilt.stackArn;
    const benchlingSecret = options.benchlingSecret || config.benchling.secretArn;
    const imageTag = options.imageTag || config.deployment.imageTag || "latest";

    // Validate required parameters
    const missingParams: string[] = [];
    if (!quiltStackArn) missingParams.push("quiltStackArn (in profile or --quilt-stack-arn)");
    if (!benchlingSecret) missingParams.push("benchlingSecret (in profile or --benchling-secret)");

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
        console.log(chalk.cyan("       --benchling-secret <arn>"));
        console.log();
        console.log("  2. Update profile configuration:");
        console.log(chalk.cyan("     npm run setup"));
        console.log();
        process.exit(1);
    }

    // Deploy (both parameters validated above)
    return await deploy(quiltStackArn!, benchlingSecret!, {
        ...options,
        imageTag,
        profileName,
        stage,
    });
}

/**
 * Deploy the Benchling webhook stack
 */
async function deploy(
    quiltStackArn: string,
    benchlingSecret: string,
    options: {
        yes?: boolean;
        bootstrapCheck?: boolean;
        requireApproval?: string;
        stage: "dev" | "prod";
        profileName: string;
        imageTag: string;
        region?: string;
        envFile?: string;
    },
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
        execSync(`npm run setup:sync-secrets -- --force --profile ${options.profileName}`, {
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
        console.log(chalk.cyan(`  npm run setup:sync-secrets -- --force --profile ${options.profileName} --region ${deployRegion}`));
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
    console.log(`  ${chalk.bold("Stage:")}                     ${options.stage}`);
    console.log(`  ${chalk.bold("Profile:")}                   ${options.profileName}`);
    console.log();
    console.log(chalk.bold("  Stack Parameters:"));
    console.log(`    ${chalk.bold("Quilt Stack ARN:")}         ${maskArn(quiltStackArn)}`);
    console.log(`    ${chalk.bold("Benchling Secret:")}        ${benchlingSecret}`);
    console.log(`    ${chalk.bold("Docker Image Tag:")}        ${options.imageTag}`);
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
            `BenchlingSecretARN=${benchlingSecret}`,
            `ImageTag=${options.imageTag}`,
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
                    // Remove trailing slash to avoid double slashes in test URLs
                    const cleanEndpoint = webhookUrl.replace(/\/$/, "");

                    // Record deployment in profile
                    const xdg = new XDGConfig();
                    xdg.recordDeployment(options.profileName, {
                        stage: options.stage,
                        timestamp: new Date().toISOString(),
                        imageTag: options.imageTag,
                        endpoint: cleanEndpoint,
                        stackName: stackName,
                        region: deployRegion,
                        deployedBy: process.env.USER || process.env.USERNAME,
                    });

                    console.log(`✅ Recorded deployment to profile '${options.profileName}' stage '${options.stage}'`);

                    // Run stage-specific tests
                    console.log();
                    console.log(`Running ${options.stage} integration tests...`);
                    try {
                        const testCommand = options.stage === "dev" ? "npm run test:dev" : "npm run test:prod";
                        execSync(testCommand, {
                            stdio: "inherit",
                            cwd: process.cwd(),
                        });
                        console.log();
                        console.log(`✅ ${options.stage.charAt(0).toUpperCase() + options.stage.slice(1)} deployment and tests completed successfully!`);
                    } catch {
                        console.error();
                        console.error(`❌ ${options.stage.charAt(0).toUpperCase() + options.stage.slice(1)} tests failed!`);
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
                            `Stage:  ${chalk.cyan(options.stage)}\n` +
                            `Profile: ${chalk.cyan(options.profileName)}\n` +
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
