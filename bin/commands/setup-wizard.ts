#!/usr/bin/env node
/**
 * Interactive Configuration Wizard
 *
 * WARNING: This file needs significant refactoring for v0.7.0
 * TODO: Update to use new ProfileConfig structure instead of UserConfig
 * TODO: Remove references to BaseConfig and use ProfileConfig
 * TODO: Update to use readProfile/writeProfile instead of readProfileConfig/writeProfileConfig
 *
 * Guided configuration setup with comprehensive validation:
 * - Benchling tenant and OAuth credentials
 * - S3 bucket access verification
 * - Quilt API connectivity testing
 * - AWS Secrets Manager integration
 *
 * Supports both interactive and --yes (non-interactive) modes.
 *
 * @module commands/setup-wizard
 */

import chalk from "chalk";
import { ProfileConfig, ProfileName } from "../../lib/types/config";

/**
 * Wizard configuration options
 */
interface WizardOptions {
    profile?: ProfileName;
    nonInteractive?: boolean;
    skipValidation?: boolean;
    awsProfile?: string;
    awsRegion?: string;
}

/**
 * Runs the interactive configuration wizard
 *
 * NOTE: This is a simplified stub for v0.7.0 - needs full refactoring
 *
 * @param options - Wizard options
 * @returns Completed profile configuration
 */
export async function runInstallWizard(_options: WizardOptions = {}): Promise<ProfileConfig> {
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Benchling Webhook Configuration Wizard                 ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    console.warn(chalk.yellow("WARNING: This wizard needs updating for v0.7.0"));
    console.warn(chalk.yellow("Please use the new configuration format manually for now."));
    console.warn(chalk.yellow("See spec/189-multi/ for examples.\n"));

    throw new Error("Setup wizard not yet updated for v0.7.0. Please create config manually.");
}

/**
 * Setup wizard command handler
 *
 * @returns Promise that resolves when wizard completes
 */
export async function setupWizardCommand(): Promise<void> {
    console.log(chalk.bold.cyan("\n🚀 Benchling Webhook Setup Wizard\n"));
    console.log(chalk.red("ERROR: Setup wizard not yet updated for v0.7.0\n"));
    console.log("The setup wizard requires refactoring to work with the new configuration format.");
    console.log("\nFor now, please:");
    console.log("  1. Create config manually at ~/.config/benchling-webhook/default/config.json");
    console.log("  2. See spec/189-multi/ for example configuration files");
    console.log("  3. Use the ProfileConfig type from lib/types/config.ts as reference\n");

    process.exit(1);
}
