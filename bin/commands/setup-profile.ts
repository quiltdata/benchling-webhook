/**
 * Setup Profile Command (v0.7.0)
 *
 * Creates a new profile for multi-environment deployment with support for
 * profile inheritance. Profiles enable separate configurations for dev,
 * staging, and production environments.
 *
 * @module commands/setup-profile
 * @version 0.7.0
 */

import chalk from "chalk";
import inquirer from "inquirer";
import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig } from "../../lib/types/config";

/**
 * Setup profile command handler
 *
 * Creates a new profile configuration by:
 * 1. Loading the base profile (default or specified) as a template
 * 2. Prompting for profile-specific values
 * 3. Supporting profile inheritance via _inherits field
 * 4. Saving profile configuration
 *
 * @param profileName - Name of the profile to create (e.g., "dev", "staging", "prod")
 * @param options - Command options
 * @returns Promise that resolves when profile is created
 * @throws Error if base profile doesn't exist or if profile creation fails
 */
export async function setupProfileCommand(
    profileName: string,
    options?: {
        inheritFrom?: string;  // Base profile to inherit from
        force?: boolean;       // Overwrite existing profile without prompting
    },
): Promise<void> {
    console.log(chalk.bold.cyan(`\n📋 Creating Profile: ${profileName}\n`));

    // Validate profile name
    if (!profileName || profileName.trim().length === 0) {
        throw new Error("Profile name cannot be empty");
    }

    if (profileName === "default" && !options?.force) {
        throw new Error("Cannot create a profile named 'default' - it already exists as the base profile");
    }

    // Sanitize profile name (alphanumeric, hyphens, underscores only)
    if (!/^[a-zA-Z0-9-_]+$/.test(profileName)) {
        throw new Error("Profile name can only contain letters, numbers, hyphens, and underscores");
    }

    const xdg = new XDGConfig();

    // Check if profile already exists
    if (xdg.profileExists(profileName) && !options?.force) {
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

    // Determine base profile for inheritance
    const baseProfile = options?.inheritFrom || "default";

    // Load base profile as template
    let baseConfig: ProfileConfig;
    try {
        baseConfig = xdg.readProfile(baseProfile);
        console.log(chalk.green(`✓ Loaded '${baseProfile}' profile as template\n`));
    } catch (error) {
        throw new Error(
            `Cannot create profile: base profile '${baseProfile}' not found.\n` +
            "  Run 'npm run setup' first to create the default profile.\n" +
            `  Error: ${(error as Error).message}`,
        );
    }

    // Validate that base config has required fields
    if (!baseConfig.benchling?.tenant) {
        throw new Error(
            `Base profile '${baseProfile}' is missing required field: benchling.tenant\n` +
            "  Run 'npm run setup' to configure the base profile properly.",
        );
    }

    // Prompt for profile-specific values
    console.log(chalk.dim(`This profile will inherit settings from '${baseProfile}' profile.`));
    console.log(chalk.dim("You can customize environment-specific values below.\n"));

    const answers = await inquirer.prompt<{
        useInheritance: boolean;
        appDefinitionId: string;
        imageTag: string;
        customizeQuiltStack: boolean;
        customizeSecretArn: boolean;
    }>([
        {
            type: "confirm",
            name: "useInheritance",
            message: `Use profile inheritance (inherit from '${baseProfile}')?`,
            default: true,
        },
        {
            type: "input",
            name: "appDefinitionId",
            message: `Benchling App Definition ID (${profileName}):`,
            default: baseConfig.benchling.appDefinitionId,
            validate: (input: string): boolean | string =>
                input.trim().length > 0 || "App Definition ID is required",
        },
        {
            type: "input",
            name: "imageTag",
            message: "Docker image tag:",
            default: profileName === "dev" ? "latest" : baseConfig.deployment.imageTag || "0.7.0",
            validate: (input: string): boolean | string =>
                input.trim().length > 0 || "Image tag is required",
        },
        {
            type: "confirm",
            name: "customizeQuiltStack",
            message: "Use a different Quilt stack for this profile?",
            default: false,
        },
        {
            type: "confirm",
            name: "customizeSecretArn",
            message: "Use a different Secrets Manager ARN for this profile?",
            default: false,
        },
    ]);

    // Optionally prompt for custom Quilt stack ARN
    let quiltStackArn = baseConfig.quilt.stackArn;
    if (answers.customizeQuiltStack) {
        const stackAnswer = await inquirer.prompt<{ stackArn: string }>({
            type: "input",
            name: "stackArn",
            message: "Quilt Stack ARN:",
            default: baseConfig.quilt.stackArn,
            validate: (input: string): boolean | string => {
                if (!input || input.trim().length === 0) {
                    return "Quilt Stack ARN is required";
                }
                if (!input.startsWith("arn:aws:cloudformation:")) {
                    return "Must be a valid CloudFormation stack ARN";
                }
                return true;
            },
        });
        quiltStackArn = stackAnswer.stackArn;
    }

    // Optionally prompt for custom secret ARN
    let secretArn = baseConfig.benchling.secretArn;
    if (answers.customizeSecretArn) {
        const secretAnswer = await inquirer.prompt<{ secretArn: string }>([
            {
                type: "input",
                name: "secretArn",
                message: "AWS Secrets Manager ARN:",
                default: baseConfig.benchling.secretArn,
                validate: (input: string): boolean | string => {
                    if (!input || input.trim().length === 0) {
                        return "Secret ARN is required";
                    }
                    if (!input.startsWith("arn:aws:secretsmanager:")) {
                        return "Must be a valid Secrets Manager ARN";
                    }
                    return true;
                },
            },
        ]);
        secretArn = secretAnswer.secretArn;
    }

    // Create profile config
    const profileConfig: ProfileConfig = {
        quilt: {
            ...baseConfig.quilt,
            stackArn: quiltStackArn,
        },
        benchling: {
            ...baseConfig.benchling,
            appDefinitionId: answers.appDefinitionId,
            secretArn: secretArn,
        },
        packages: {
            ...baseConfig.packages,
        },
        deployment: {
            ...baseConfig.deployment,
            imageTag: answers.imageTag,
        },
        resolvedServices: {
            ...baseConfig.resolvedServices,
            // Update resolvedAt timestamp for the new profile
            resolvedAt: new Date().toISOString(),
        },
        logging: baseConfig.logging,
        security: baseConfig.security,
        _metadata: {
            version: "0.7.0",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: "cli",
            profile: profileName,
            basedOn: baseProfile,
        },
    };

    // Add inheritance if requested
    if (answers.useInheritance) {
        profileConfig._inherits = baseProfile;
    }

    // Save profile configuration
    try {
        xdg.writeProfile(profileName, profileConfig);
        console.log(chalk.green(`\n✓ Profile '${profileName}' created successfully`));

        const configPath = `~/.config/benchling-webhook/${profileName}/config.json`;
        console.log(chalk.dim(`  Configuration saved to: ${configPath}\n`));

        // Display next steps
        console.log(chalk.bold("Next steps:"));
        console.log(chalk.cyan(`  1. Sync secrets: npm run setup:sync-secrets -- --profile ${profileName}`));
        console.log(chalk.cyan(`  2. Deploy: npm run deploy:${profileName === "dev" ? "dev" : "prod"} -- --profile ${profileName}`));
        console.log(chalk.cyan(`  3. Test: npm run test:${profileName === "dev" ? "dev" : "prod"}\n`));

        console.log(chalk.dim("Profile configuration:"));
        if (profileConfig._inherits) {
            console.log(chalk.dim(`  Inherits from: ${profileConfig._inherits}`));
        }
        console.log(chalk.dim(`  App Definition ID: ${profileConfig.benchling.appDefinitionId}`));
        console.log(chalk.dim(`  Image Tag: ${profileConfig.deployment.imageTag}`));
        console.log(chalk.dim(`  Secret ARN: ${profileConfig.benchling.secretArn}`));
        console.log(chalk.dim(`  Quilt Stack: ${profileConfig.quilt.stackArn}`));
        console.log();
    } catch (error) {
        throw new Error(`Failed to save profile configuration: ${(error as Error).message}`);
    }
}
