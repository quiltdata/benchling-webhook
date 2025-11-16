#!/usr/bin/env node
/**
 * Install Command - Setup + Deploy Orchestration
 *
 * Implements the default CLI workflow that chains setup wizard and deployment.
 * Users can opt out of deployment via --setup-only flag or skip confirmation via --yes.
 *
 * @module commands/install
 */

import inquirer from "inquirer";
import chalk from "chalk";
import { setupWizardCommand, SetupWizardResult } from "./setup-wizard";
import { deployCommand } from "./deploy";
import { generateNextSteps } from "../../lib/next-steps-generator";

/**
 * Phase titles for the install command
 * This is the single source of truth for install phase headers
 */
const PHASE_TITLES = {
    setup: "Configuration Setup",
    deployment: "Deployment",
};

/**
 * Prints a phase header for the install command
 * Uses distinct visual style from wizard steps (double borders, cyan color)
 * @param phaseNumber - The phase number
 * @param title - The phase title
 */
function printPhaseHeader(phaseNumber: number, title: string): void {
    console.log(chalk.blue("\n═══════════════════════════════════════════════════════════"));
    console.log(chalk.bold.cyan(`  PHASE ${phaseNumber}: ${title}`));
    console.log(chalk.blue("═══════════════════════════════════════════════════════════\n"));
}

/**
 * Options for install command
 */
export interface InstallCommandOptions {
    /**
     * Configuration profile name
     * @default "default"
     */
    profile?: string;

    /**
     * Base profile to inherit from
     */
    inheritFrom?: string;

    /**
     * AWS credentials profile
     */
    awsProfile?: string;

    /**
     * AWS region
     */
    awsRegion?: string;

    /**
     * Skip deployment step (setup only)
     */
    setupOnly?: boolean;

    /**
     * Skip confirmation prompts (auto-deploy)
     */
    yes?: boolean;

}

/**
 * Install command - orchestrates setup → deploy workflow
 *
 * This is the default CLI command that provides a seamless installation experience:
 * 1. Runs setup wizard to configure the application
 * 2. Prompts user to deploy (unless --yes or --setup-only)
 * 3. Executes deployment if confirmed
 * 4. Displays appropriate next steps
 *
 * @param options - Install command options
 * @throws Error if setup fails or deployment fails
 */
export async function installCommand(options: InstallCommandOptions = {}): Promise<void> {
    const {
        profile = "default",
        inheritFrom,
        awsProfile,
        awsRegion,
        setupOnly = false,
        yes = false,
    } = options;

    // Validate flags
    validateFlags({ setupOnly, yes });

    // Phase 1: Run setup wizard
    printPhaseHeader(1, PHASE_TITLES.setup);

    let setupResult: SetupWizardResult;

    try {
        setupResult = await setupWizardCommand({
            profile,
            inheritFrom,
            awsProfile,
            awsRegion,
            yes: yes,
            isPartOfInstall: true, // Suppress next steps from setup wizard
        });
    } catch (error) {
        const err = error as Error;
        console.error(chalk.red(`\n✗ Setup failed: ${err.message}`));
        throw error;
    }

    // Check setup success
    if (!setupResult.success) {
        throw new Error("Setup failed. Please check the errors above and try again.");
    }

    // Check if integrated stack mode - no deployment needed
    const isIntegratedMode = setupResult.config.integratedStack === true;

    if (isIntegratedMode) {
        // Integrated mode already displayed complete message in phase6
        // Just return early without additional output
        return;
    }

    console.log(chalk.green("\n✓ Setup complete!\n"));

    // Step 2: Determine if we should deploy
    if (setupOnly) {
        // User explicitly requested setup only
        console.log(chalk.blue("═══════════════════════════════════════════════════════════\n"));
        console.log(chalk.yellow("Deployment skipped (--setup-only flag).\n"));

        // Show next steps for manual deployment
        const nextSteps = generateNextSteps({
            profile: setupResult.profile,
            stage: determineStage(setupResult.profile),
            skipDeployment: true,
        });
        console.log(nextSteps);
        console.log();

        return;
    }

    // Step 3: Prompt for deployment (unless --yes)
    let shouldDeploy = yes;

    if (!yes && !yes) {
        printPhaseHeader(2, PHASE_TITLES.deployment);

        const answers = await inquirer.prompt([
            {
                type: "confirm",
                name: "shouldDeploy",
                message: "Deploy to AWS now?",
                default: true,
            },
        ]);

        shouldDeploy = answers.shouldDeploy;
    }

    if (!shouldDeploy) {
        // User declined deployment
        console.log(chalk.blue("\n═══════════════════════════════════════════════════════════\n"));
        console.log(chalk.yellow("Deployment skipped.\n"));

        // Show next steps for manual deployment
        const nextSteps = generateNextSteps({
            profile: setupResult.profile,
            stage: determineStage(setupResult.profile),
            skipDeployment: true,
        });
        console.log(nextSteps);
        console.log();

        return;
    }

    // Step 4: Execute deployment
    printPhaseHeader(2, PHASE_TITLES.deployment);
    console.log("Deploying to AWS... This may take 5-10 minutes.\n");

    const stage = determineStage(setupResult.profile);

    try {
        await deployCommand({
            profile: setupResult.profile,
            stage,
            yes: true, // Skip deploy command's own confirmation
        });

        // Step 5: Show success message and next steps
        console.log(chalk.blue("\n═══════════════════════════════════════════════════════════\n"));
        console.log(chalk.green.bold("✓ Installation Complete!\n"));

        // Note: Deploy command shows its own outputs and next steps
        // We don't need to duplicate that here
    } catch (error) {
        const err = error as Error;
        console.error(chalk.red(`\n✗ Deployment failed: ${err.message}`));

        // Show recovery next steps
        console.log(chalk.blue("\n═══════════════════════════════════════════════════════════\n"));
        console.log(chalk.yellow("Setup was successful, but deployment failed.\n"));

        const nextSteps = generateNextSteps({
            profile: setupResult.profile,
            stage,
            deployment: {
                success: false,
                error: err.message,
            },
        });
        console.log(nextSteps);
        console.log();

        throw error;
    }
}

/**
 * Determine deployment stage from profile name
 *
 * @param profile - Profile name
 * @returns Deployment stage (dev or prod)
 */
function determineStage(profile: string): "dev" | "prod" {
    if (profile === "dev") {
        return "dev";
    }
    // Default and all other profiles deploy to prod
    return "prod";
}

/**
 * Validate flag combinations
 *
 * @param options - Options to validate
 * @throws Error if invalid flag combination
 */
function validateFlags(options: { setupOnly: boolean; yes: boolean }): void {
    if (options.setupOnly && options.yes) {
        throw new Error(
            "Cannot use both --setup-only and --yes flags. " +
                "Use --setup-only to skip deployment, or --yes to auto-deploy.",
        );
    }
}
