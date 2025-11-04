/**
 * Setup Wizard Command
 *
 * Launches the interactive setup wizard when npx is run without arguments.
 * This provides a guided experience for first-time users to configure and
 * deploy the Benchling webhook integration.
 *
 * @module commands/setup-wizard
 */

import chalk from "chalk";
import { runInstallWizard } from "../../scripts/install-wizard";

/**
 * Setup wizard command handler
 *
 * Provides guided setup experience:
 * 1. Welcome message and prerequisites check
 * 2. Configuration collection via install-wizard
 * 3. Automatic deployment (optional)
 * 4. Integration testing (optional)
 *
 * @returns Promise that resolves when wizard completes
 */
export async function setupWizardCommand(): Promise<void> {
    console.log(chalk.bold.cyan("\n🚀 Benchling Webhook Setup Wizard\n"));
    console.log("This wizard will guide you through:");
    console.log("  1. Collecting configuration (Benchling credentials, AWS settings)");
    console.log("  2. Validating credentials and access");
    console.log("  3. Saving configuration for deployment\n");
    console.log(chalk.dim("Press Ctrl+C at any time to exit\n"));

    // Run the existing install wizard
    await runInstallWizard({
        nonInteractive: false,
        skipValidation: false,
    });

    console.log(chalk.green.bold("\n✓ Setup complete!\n"));
    console.log("Next steps:");
    console.log(chalk.cyan("  • Run deployment: npx @quiltdata/benchling-webhook deploy"));
    console.log(chalk.cyan("  • Test integration: npx @quiltdata/benchling-webhook test"));
    console.log(chalk.dim("\nFor more information: https://github.com/quiltdata/benchling-webhook\n"));
}
