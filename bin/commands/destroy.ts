import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { prompt } from "enquirer";
import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig } from "../../lib/types/config";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";

/**
 * Destroy command for removing the BenchlingWebhookStack
 *
 * This command safely destroys the CloudFormation stack and optionally
 * cleans up the deployment tracking from the profile.
 *
 * @module commands/destroy
 * @version 0.9.0
 */
export async function destroyCommand(options: {
    yes?: boolean;
    profile?: string;
    stage?: "dev" | "prod";
    region?: string;
    keepTracking?: boolean;
}): Promise<void> {
    console.log(
        boxen(chalk.bold("Benchling Webhook Stack Destruction"), {
            padding: 1,
            borderColor: "red",
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
        config = xdg.readProfile(profileName);
    } catch (error) {
        console.error(chalk.red(`Error: Could not load profile '${profileName}'`));
        console.error(chalk.dim((error as Error).message));
        console.log();
        console.log(chalk.yellow("To create a profile, run:"));
        console.log(chalk.cyan(`  npm run setup -- --profile ${profileName}`));
        console.log();
        process.exit(1);
    }

    // Use region from config, but allow override from CLI
    const destroyRegion = options.region || config.deployment?.region || "us-east-1";

    // Check if stack exists
    const spinner = ora("Checking if stack exists...").start();
    let stackExists = false;
    let stackStatus = "";

    try {
        const cloudformation = new CloudFormationClient({ region: destroyRegion });
        const stackName = "BenchlingWebhookStack";

        const command = new DescribeStacksCommand({ StackName: stackName });
        const response = await cloudformation.send(command);

        if (response.Stacks && response.Stacks.length > 0) {
            stackExists = true;
            stackStatus = response.Stacks[0].StackStatus || "UNKNOWN";
            spinner.succeed(`Stack exists (status: ${stackStatus})`);
        } else {
            spinner.warn("Stack does not exist");
        }
    } catch (error: any) {
        if (error.name === "ValidationError" || error.message?.includes("does not exist")) {
            spinner.warn("Stack does not exist");
        } else {
            spinner.fail("Error checking stack");
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    }

    if (!stackExists) {
        console.log();
        console.log(chalk.yellow("Nothing to destroy - stack does not exist"));

        // Check if there's deployment tracking to clean up
        const deployments = xdg.getDeployments(profileName);
        const activeDeployment = deployments.active?.[stage];

        if (activeDeployment) {
            console.log();
            console.log(
                chalk.yellow(
                    `Found deployment tracking for profile '${profileName}' stage '${stage}'`,
                ),
            );

            if (options.yes || (await confirmCleanupTracking())) {
                xdg.clearDeployment(profileName, stage);
                console.log(
                    chalk.green(`✓ Cleared deployment tracking for '${profileName}' stage '${stage}'`),
                );
            }
        }

        console.log();
        return;
    }

    // Display destruction plan
    console.log();
    console.log(chalk.bold("Destruction Plan"));
    console.log(chalk.gray("─".repeat(80)));
    console.log(`  ${chalk.bold("Stack:")}        BenchlingWebhookStack`);
    console.log(`  ${chalk.bold("Region:")}       ${destroyRegion}`);
    console.log(`  ${chalk.bold("Stage:")}        ${stage}`);
    console.log(`  ${chalk.bold("Profile:")}      ${profileName}`);
    console.log(`  ${chalk.bold("Status:")}       ${stackStatus}`);
    console.log(chalk.gray("─".repeat(80)));
    console.log();

    // Confirm destruction
    if (!options.yes) {
        const confirmed = await confirmDestruction();
        if (!confirmed) {
            console.log();
            console.log(chalk.yellow("Destruction cancelled"));
            console.log();
            return;
        }
    }

    // Execute CDK destroy
    console.log();
    console.log(chalk.bold("Destroying stack..."));
    console.log(chalk.dim("This may take several minutes..."));
    console.log();

    try {
        const cdkCommand = [
            "cdk",
            "destroy",
            "BenchlingWebhookStack",
            "--force", // Skip confirmation since we already confirmed
            `--profile ${profileName}`,
            `--region ${destroyRegion}`,
        ].join(" ");

        execSync(cdkCommand, {
            stdio: "inherit",
            env: {
                ...process.env,
                AWS_REGION: destroyRegion,
            },
        });

        console.log();
        console.log(chalk.green.bold("✓ Stack destroyed successfully"));
        console.log();

        // Clean up deployment tracking unless --keep-tracking is set
        if (!options.keepTracking) {
            const deployments = xdg.getDeployments(profileName);
            const activeDeployment = deployments.active?.[stage];

            if (activeDeployment) {
                xdg.clearDeployment(profileName, stage);
                console.log(
                    chalk.green(`✓ Cleared deployment tracking for '${profileName}' stage '${stage}'`),
                );
            }
        }

        console.log();
        console.log(
            boxen(
                `${chalk.green.bold("✓ Destruction Complete!")}\n\n` +
                    `Stack:   ${chalk.cyan("BenchlingWebhookStack")}\n` +
                    `Region:  ${chalk.cyan(destroyRegion)}\n` +
                    `Stage:   ${chalk.cyan(stage)}\n` +
                    `Profile: ${chalk.cyan(profileName)}\n\n` +
                    `${chalk.bold("Next steps:")}\n` +
                    `  • To deploy a new stack: ${chalk.cyan(`npm run deploy:${stage} -- --profile ${profileName}`)}\n` +
                    `  • To update configuration: ${chalk.cyan(`npm run setup -- --profile ${profileName}`)}`,
                { padding: 1, borderColor: "green", borderStyle: "round" },
            ),
        );
        console.log();
    } catch (error) {
        console.log();
        console.error(chalk.red.bold("✗ Stack destruction failed"));
        console.log();
        console.error(chalk.red((error as Error).message));
        console.log();
        console.log(chalk.yellow("You may need to:"));
        console.log("  • Check AWS CloudFormation console for details");
        console.log("  • Manually delete resources that are blocking destruction");
        console.log("  • Retry after resolving any issues");
        console.log();
        process.exit(1);
    }
}

/**
 * Prompt user to confirm stack destruction
 */
async function confirmDestruction(): Promise<boolean> {
    console.log(
        boxen(
            `${chalk.red.bold("⚠ WARNING: This will permanently delete the stack")}\n\n` +
                `This action will:\n` +
                `  • Delete all AWS resources in the stack\n` +
                `  • Remove the API Gateway endpoint\n` +
                `  • Stop the ECS tasks\n` +
                `  • Delete VPC Link, Cloud Map, and other networking resources\n\n` +
                `${chalk.yellow("This action cannot be undone.")}`,
            { padding: 1, borderColor: "red", borderStyle: "double" },
        ),
    );
    console.log();

    const response = await prompt<{ confirm: boolean }>({
        type: "confirm",
        name: "confirm",
        message: "Are you sure you want to destroy the stack?",
        initial: false,
    });

    return response.confirm;
}

/**
 * Prompt user to confirm clearing deployment tracking
 */
async function confirmCleanupTracking(): Promise<boolean> {
    const response = await prompt<{ confirm: boolean }>({
        type: "confirm",
        name: "confirm",
        message: "Clear deployment tracking for this profile/stage?",
        initial: true,
    });

    return response.confirm;
}
