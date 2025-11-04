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
    console.log("  3. Saving configuration for deployment");
    console.log("  4. Deploying to AWS (optional)\n");
    console.log(chalk.dim("Press Ctrl+C at any time to exit\n"));

    // Run the existing install wizard
    await runInstallWizard({
        nonInteractive: false,
        skipValidation: false,
    });

    console.log(chalk.green.bold("\n✓ Setup complete!\n"));

    // Ask if user wants to deploy now
    const inquirer = (await import("inquirer")).default;
    const { shouldDeploy } = await inquirer.prompt([
        {
            type: "confirm",
            name: "shouldDeploy",
            message: "Would you like to deploy to AWS now?",
            default: true,
        },
    ]);

    if (shouldDeploy) {
        console.log(chalk.cyan("\n📦 Starting deployment...\n"));
        const { deployCommand } = await import("./deploy");
        await deployCommand({});
        console.log(chalk.green.bold("\n✓ Deployment complete!\n"));
        console.log("Next steps:");
        console.log(chalk.cyan("  • Set webhook URL in Benchling app settings"));
        console.log(chalk.cyan("  • Install the app in your Benchling tenant"));
        console.log(chalk.cyan("  • Test integration: npx @quiltdata/benchling-webhook test"));
    } else {
        console.log("\nNext steps:");
        console.log(chalk.cyan("  • Run deployment: npx @quiltdata/benchling-webhook deploy"));
        console.log(chalk.cyan("  • Test integration: npx @quiltdata/benchling-webhook test"));
    }

    console.log(chalk.dim("\nFor more information: https://github.com/quiltdata/benchling-webhook\n"));
}
