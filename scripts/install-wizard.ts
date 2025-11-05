#!/usr/bin/env ts-node
/**
 * Install Wizard Main Orchestration (v0.7.0)
 *
 * Simplified wizard that orchestrates:
 * 1. Quilt configuration inference
 * 2. Interactive configuration prompts
 * 3. Configuration validation
 * 4. Profile persistence via XDGConfig
 *
 * All business logic extracted to focused modules.
 *
 * @module scripts/install-wizard
 */

import { XDGConfig } from "../lib/xdg-config";
import { ProfileConfig } from "../lib/types/config";
import { inferQuiltConfig } from "./infer-quilt-config";
import { runConfigWizard } from "./config/wizard";
import { validateConfig } from "./config/validator";
import inquirer from "inquirer";

/**
 * Install wizard options
 */
export interface InstallWizardOptions {
    profile?: string;
    inheritFrom?: string;
    nonInteractive?: boolean;
    skipValidation?: boolean;
    skipSecretsSync?: boolean;
    awsProfile?: string;
    awsRegion?: string;
}

/**
 * Main install wizard function
 *
 * Orchestrates the complete configuration workflow:
 * 1. Load existing configuration (if any)
 * 2. Infer Quilt configuration from AWS
 * 3. Run interactive prompts for missing fields
 * 4. Validate configuration
 * 5. Save to XDG config directory
 *
 * @param options - Wizard options
 * @returns Complete profile configuration
 *
 * @example
 * ```typescript
 * const config = await runInstallWizard({
 *   profile: "dev",
 *   inheritFrom: "default",
 *   awsRegion: "us-east-1"
 * });
 * ```
 */
export async function runInstallWizard(options: InstallWizardOptions = {}): Promise<ProfileConfig> {
    const {
        profile = "default",
        inheritFrom,
        nonInteractive = false,
        skipValidation = false,
        awsProfile,
        awsRegion = "us-east-1",
    } = options;

    const xdg = new XDGConfig();

    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Benchling Webhook Setup (v0.7.0)                        ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    // Step 1: Load existing configuration (if profile exists)
    let existingConfig: Partial<ProfileConfig> | undefined;

    if (xdg.profileExists(profile)) {
        console.log(`Loading existing configuration for profile: ${profile}\n`);
        try {
            existingConfig = inheritFrom
                ? xdg.readProfileWithInheritance(profile, inheritFrom)
                : xdg.readProfile(profile);
        } catch (error) {
            console.warn(`Warning: Could not load existing config: ${(error as Error).message}`);
        }
    } else if (inheritFrom) {
        console.log(`Creating new profile '${profile}' inheriting from '${inheritFrom}'\n`);
        try {
            existingConfig = xdg.readProfile(inheritFrom);
        } catch (error) {
            throw new Error(`Base profile '${inheritFrom}' not found: ${(error as Error).message}`);
        }
    }

    // Step 2: Infer Quilt configuration (unless inheriting from another profile)
    let quiltConfig: Partial<ProfileConfig["quilt"]> = existingConfig?.quilt || {};

    if (!inheritFrom || !existingConfig?.quilt) {
        console.log("Step 1: Inferring Quilt configuration from AWS...\n");

        try {
            quiltConfig = await inferQuiltConfig({
                region: awsRegion,
                profile: awsProfile,
                interactive: !nonInteractive,
            });

            console.log("✓ Quilt configuration inferred\n");
        } catch (error) {
            console.error(`Failed to infer Quilt configuration: ${(error as Error).message}`);

            if (nonInteractive) {
                throw error;
            }

            const { continueManually } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "continueManually",
                    message: "Continue and enter Quilt configuration manually?",
                    default: true,
                },
            ]);

            if (!continueManually) {
                throw new Error("Setup aborted by user");
            }
        }
    }

    // Merge inferred Quilt config with existing config
    const partialConfig: Partial<ProfileConfig> = {
        ...existingConfig,
        quilt: {
            ...existingConfig?.quilt,
            ...quiltConfig,
        } as ProfileConfig["quilt"],
    };

    // Step 3: Run interactive wizard for remaining configuration
    const config = await runConfigWizard({
        existingConfig: partialConfig,
        nonInteractive,
        inheritFrom,
    });

    // Step 4: Validate configuration
    if (!skipValidation) {
        console.log("\nValidating configuration...\n");

        const validation = await validateConfig(config, {
            skipValidation,
            awsProfile,
        });

        if (!validation.isValid) {
            console.error("\n❌ Configuration validation failed:");
            validation.errors.forEach((err) => console.error(`  - ${err}`));

            if (nonInteractive) {
                throw new Error("Configuration validation failed");
            }

            const { proceed } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "proceed",
                    message: "Save configuration anyway?",
                    default: false,
                },
            ]);

            if (!proceed) {
                throw new Error("Setup aborted by user");
            }
        } else {
            console.log("✓ Configuration validated successfully\n");
        }

        if (validation.warnings && validation.warnings.length > 0) {
            console.warn("\n⚠ Warnings:");
            validation.warnings.forEach((warn) => console.warn(`  - ${warn}`));
            console.log("");
        }
    }

    // Step 5: Save configuration
    console.log(`Saving configuration to profile: ${profile}...\n`);

    try {
        xdg.writeProfile(profile, config);
        console.log(`✓ Configuration saved to: ~/.config/benchling-webhook/${profile}/config.json\n`);
    } catch (error) {
        throw new Error(`Failed to save configuration: ${(error as Error).message}`);
    }

    // Step 6: Display next steps
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Setup Complete!                                         ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    console.log("Next steps:");
    console.log("  1. Sync secrets to AWS: npm run setup:sync-secrets");
    console.log("  2. Deploy to AWS: npm run deploy:dev");
    console.log("  3. Test integration: npm run test:dev\n");

    return config;
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const options: InstallWizardOptions = {};

    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--profile" && i + 1 < args.length) {
            options.profile = args[i + 1];
            i++;
        } else if (args[i] === "--inherit-from" && i + 1 < args.length) {
            options.inheritFrom = args[i + 1];
            i++;
        } else if (args[i] === "--region" && i + 1 < args.length) {
            options.awsRegion = args[i + 1];
            i++;
        } else if (args[i] === "--aws-profile" && i + 1 < args.length) {
            options.awsProfile = args[i + 1];
            i++;
        } else if (args[i] === "--yes" || args[i] === "-y") {
            options.nonInteractive = true;
        } else if (args[i] === "--skip-validation") {
            options.skipValidation = true;
        } else if (args[i] === "--skip-secrets-sync") {
            options.skipSecretsSync = true;
        } else if (args[i] === "--help" || args[i] === "-h") {
            console.log(`
Benchling Webhook Install Wizard (v0.7.0)

Usage: ts-node scripts/install-wizard.ts [options]

Options:
  --profile <name>          Profile name (default: "default")
  --inherit-from <profile>  Inherit configuration from another profile
  --region <region>         AWS region (default: "us-east-1")
  --aws-profile <profile>   AWS profile to use
  --yes, -y                 Non-interactive mode (requires existing config)
  --skip-validation         Skip configuration validation
  --skip-secrets-sync       Skip automatic secrets sync
  --help, -h                Show this help message

Examples:
  # Create default profile
  ts-node scripts/install-wizard.ts

  # Create dev profile inheriting from default
  ts-node scripts/install-wizard.ts --profile dev --inherit-from default

  # Create profile with specific AWS region
  ts-node scripts/install-wizard.ts --profile prod --region us-west-2
            `.trim());
            process.exit(0);
        }
    }

    try {
        await runInstallWizard(options);
    } catch (error) {
        console.error(`\n❌ Setup failed: ${(error as Error).message}\n`);
        process.exit(1);
    }
}

// Run main if executed directly
if (require.main === module) {
    main();
}
