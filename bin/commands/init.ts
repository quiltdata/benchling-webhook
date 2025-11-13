import chalk from "chalk";
import { setupWizardCommand } from "./setup-wizard";

interface InitOptions {
    output?: string;
    force?: boolean;
    minimal?: boolean;
    infer?: boolean;
}

/**
 * Init command - redirects to setup wizard (the modern way)
 * This command is kept for backward compatibility
 */
export async function initCommand(_options: InitOptions): Promise<void> {
    console.log(chalk.yellow("Note: 'init' command has been replaced with an interactive setup wizard."));
    console.log(chalk.dim("Starting setup wizard...\n"));

    // Redirect to setup wizard
    try {
        await setupWizardCommand({
            profile: "default",
            yes: false,
        });
    } catch (error) {
        // Handle user cancellation gracefully
        if (error instanceof Error && error.message.includes("User force closed")) {
            console.log(chalk.yellow("\n✖ Setup cancelled"));
            process.exit(0);
        }
        throw error;
    }
}
