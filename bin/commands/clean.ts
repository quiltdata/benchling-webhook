/**
 * Clean Command - Remove Configuration Profile
 *
 * Deletes a configuration profile and all associated data including:
 * - Profile configuration (~/.config/benchling-webhook/{profile}/config.json)
 * - Deployment tracking (~/.config/benchling-webhook/{profile}/deployments.json)
 * - Profile directory
 *
 * IMPORTANT: This command does NOT destroy AWS resources. To destroy the deployed
 * CloudFormation stack, use the 'destroy' command first.
 *
 * @module bin/commands/clean
 */

import chalk from "chalk";
import { XDGConfig } from "../../lib/xdg-config";
import type { XDGBase } from "../../lib/xdg-base";
import inquirer from "inquirer";

interface CleanOptions {
    profile?: string;
    yes?: boolean;
    xdg?: XDGBase; // For testing
}

/**
 * Clean command: Remove a configuration profile
 *
 * @param options - Command options
 */
export async function cleanCommand(options: CleanOptions): Promise<void> {
    const xdg = options.xdg || new XDGConfig();
    const profile = options.profile || "default";

    // Check if profile exists
    if (!xdg.profileExists(profile)) {
        console.log(chalk.yellow(`Profile '${profile}' does not exist.`));
        console.log();
        console.log(chalk.dim("Available profiles:"));
        const profiles = xdg.listProfiles();
        if (profiles.length === 0) {
            console.log(chalk.dim("  (none)"));
        } else {
            profiles.forEach((p) => {
                console.log(chalk.dim(`  - ${p}`));
            });
        }
        return;
    }

    // Load profile to check for active deployments
    let hasDeployments = false;
    let activeStages: string[] = [];

    try {
        xdg.readProfile(profile); // Verify profile can be read
        const deployments = xdg.getDeployments(profile);
        if (deployments && deployments.active) {
            activeStages = Object.keys(deployments.active);
            hasDeployments = activeStages.length > 0;
        }
    } catch (error) {
        console.log(chalk.yellow(`Warning: Could not read profile '${profile}' details: ${(error as Error).message}`));
    }

    // Show warning about active deployments
    if (hasDeployments) {
        console.log();
        console.log(chalk.yellow.bold("⚠️  WARNING: Active Deployments Detected"));
        console.log();
        console.log(chalk.yellow(`The profile '${profile}' has active deployments for the following stages:`));
        activeStages.forEach((stage) => {
            console.log(chalk.yellow(`  - ${stage}`));
        });
        console.log();
        console.log(chalk.yellow("This command will ONLY remove the local configuration."));
        console.log(chalk.yellow("AWS resources (CloudFormation stacks, etc.) will NOT be destroyed."));
        console.log();
        console.log(chalk.cyan("To destroy AWS resources first, run:"));
        activeStages.forEach((stage) => {
            console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook destroy --profile ${profile} --stage ${stage}`));
        });
        console.log();
    }

    // Confirm deletion
    if (!options.yes) {
        console.log();
        console.log(chalk.bold(`About to delete profile: ${profile}`));
        console.log();
        console.log(chalk.dim("This will remove:"));
        console.log(chalk.dim(`  - Configuration: ~/.config/benchling-webhook/${profile}/config.json`));
        console.log(chalk.dim(`  - Deployment tracking: ~/.config/benchling-webhook/${profile}/deployments.json`));
        console.log(chalk.dim(`  - Profile directory: ~/.config/benchling-webhook/${profile}/`));
        console.log();

        const response = await inquirer.prompt([
            {
                type: "confirm",
                name: "confirmed",
                message: `Are you sure you want to delete profile '${profile}'?`,
                default: false,
            },
        ]);

        if (!response.confirmed) {
            console.log(chalk.yellow("Operation cancelled."));
            return;
        }
    }

    // Delete the profile
    try {
        xdg.deleteProfile(profile);
        console.log();
        console.log(chalk.green(`✓ Profile '${profile}' deleted successfully.`));
        console.log();
    } catch (error) {
        throw new Error(`Failed to delete profile '${profile}': ${(error as Error).message}`);
    }
}
