/**
 * Setup Profile Command
 *
 * Creates a new profile for multi-environment deployment by copying the default
 * profile and prompting for profile-specific values. Profiles enable separate
 * configurations for dev, staging, and production environments.
 *
 * @module commands/setup-profile
 */

import chalk from "chalk";
import inquirer from "inquirer";
import { XDGConfig, BaseConfig } from "../../lib/xdg-config";
import { generateSecretName } from "../../lib/utils/secrets";

/**
 * Setup profile command handler
 *
 * Creates a new profile configuration by:
 * 1. Loading the default profile as a template
 * 2. Prompting for profile-specific values
 * 3. Generating standardized secret name
 * 4. Saving profile configuration
 *
 * @param profileName - Name of the profile to create (e.g., "dev", "staging", "prod")
 * @returns Promise that resolves when profile is created
 * @throws Error if default profile doesn't exist or if profile already exists
 */
export async function setupProfileCommand(profileName: string): Promise<void> {
    console.log(chalk.bold.cyan(`\n📋 Creating Profile: ${profileName}\n`));

    // Validate profile name
    if (!profileName || profileName.trim().length === 0) {
        throw new Error("Profile name cannot be empty");
    }

    if (profileName === "default") {
        throw new Error("Cannot create a profile named 'default' - it already exists as the base profile");
    }

    // Sanitize profile name (alphanumeric, hyphens, underscores only)
    if (!/^[a-zA-Z0-9-_]+$/.test(profileName)) {
        throw new Error("Profile name can only contain letters, numbers, hyphens, and underscores");
    }

    const xdg = new XDGConfig();

    // Check if profile already exists
    if (xdg.profileExists(profileName)) {
        const { overwrite } = await inquirer.prompt([
            {
                type: "confirm",
                name: "overwrite",
                message: chalk.yellow(`Profile '${profileName}' already exists. Overwrite?`),
                default: false,
            },
        ]);

        if (!overwrite) {
            console.log(chalk.dim("\nProfile creation cancelled"));
            return;
        }
    }

    // Load default profile as template
    let defaultConfig: BaseConfig;
    try {
        defaultConfig = xdg.readProfileConfig("user", "default");
        console.log(chalk.green("✓ Loaded default profile as template\n"));
    } catch (error) {
        throw new Error(
            "Cannot create profile: default profile not found.\n" +
            "  Run 'npm run setup' first to create the default profile.\n" +
            `  Error: ${(error as Error).message}`,
        );
    }

    // Validate that default config has required fields
    if (!defaultConfig.benchlingTenant) {
        throw new Error(
            "Default profile is missing required field: benchlingTenant\n" +
            "  Run 'npm run setup' to configure the default profile properly.",
        );
    }

    // Prompt for profile-specific values
    console.log(chalk.dim("This profile will inherit most settings from the default profile."));
    console.log(chalk.dim("You can customize environment-specific values below.\n"));

    const answers = await inquirer.prompt<{
        benchlingAppDefinitionId: string;
        imageTag: string;
        customizeQuiltStack: boolean;
    }>([
        {
            type: "input",
            name: "benchlingAppDefinitionId",
            message: `Benchling App Definition ID (${profileName}):`,
            default: defaultConfig.benchlingAppDefinitionId as string,
            validate: (input: string): boolean | string =>
                input.trim().length > 0 || "App Definition ID is required",
        },
        {
            type: "input",
            name: "imageTag",
            message: "Docker image tag:",
            default: profileName === "dev" ? "latest" : "0.6.3",
            validate: (input: string): boolean | string =>
                input.trim().length > 0 || "Image tag is required",
        },
        {
            type: "confirm",
            name: "customizeQuiltStack",
            message: "Use a different Quilt stack for this profile?",
            default: false,
        },
    ]);

    // Optionally prompt for custom Quilt stack ARN
    let quiltStackArn = defaultConfig.quiltStackArn;
    if (answers.customizeQuiltStack) {
        const stackAnswer = await inquirer.prompt<{ quiltStackArn: string }>([
            {
                type: "input",
                name: "quiltStackArn",
                message: "Quilt Stack ARN:",
                default: defaultConfig.quiltStackArn as string,
                validate: (input: string): boolean | string => {
                    if (!input || input.trim().length === 0) {
                        return "Quilt Stack ARN is required";
                    }
                    if (!input.startsWith("arn:aws:cloudformation:")) {
                        return "Must be a valid CloudFormation stack ARN";
                    }
                    return true;
                },
            },
        ]);
        quiltStackArn = stackAnswer.quiltStackArn;
    }

    // Generate secret name using profile and tenant
    const secretName = generateSecretName(profileName, defaultConfig.benchlingTenant as string);

    console.log(chalk.dim(`\nGenerated secret name: ${secretName}`));

    // Create profile config by copying default and overriding specific values
    const profileConfig: BaseConfig = {
        ...defaultConfig,
        // Profile-specific overrides
        benchlingAppDefinitionId: answers.benchlingAppDefinitionId,
        benchlingSecret: secretName,
        imageTag: answers.imageTag,
        quiltStackArn: quiltStackArn,
        // Add metadata
        _metadata: {
            ...(typeof defaultConfig._metadata === "object" && defaultConfig._metadata !== null
                ? defaultConfig._metadata
                : {}),
            source: "setup-profile",
            savedAt: new Date().toISOString(),
            profile: profileName,
            basedOn: "default",
        },
    };

    // Save profile configuration
    try {
        xdg.writeProfileConfig("user", profileConfig, profileName);
        console.log(chalk.green(`\n✓ Profile '${profileName}' created successfully`));

        const paths = xdg.getProfilePaths(profileName);
        console.log(chalk.dim(`  Configuration saved to: ${paths.userConfig}\n`));

        // Display next steps
        console.log(chalk.bold("Next steps:"));
        console.log(chalk.cyan(`  1. Sync secrets: npm run setup:sync-secrets -- --profile ${profileName}`));
        console.log(chalk.cyan(`  2. Deploy: npm run deploy:${profileName === "dev" ? "dev" : "prod"} -- --profile ${profileName}`));
        console.log(chalk.cyan(`  3. Test: npm run test:${profileName === "dev" ? "dev" : "prod"} -- --profile ${profileName}\n`));

        console.log(chalk.dim("Profile configuration:"));
        console.log(chalk.dim(`  App Definition ID: ${profileConfig.benchlingAppDefinitionId}`));
        console.log(chalk.dim(`  Image Tag: ${profileConfig.imageTag}`));
        console.log(chalk.dim(`  Secret Name: ${secretName}`));
        console.log(chalk.dim(`  Quilt Stack: ${profileConfig.quiltStackArn}`));
        console.log();
    } catch (error) {
        throw new Error(`Failed to save profile configuration: ${(error as Error).message}`);
    }
}
