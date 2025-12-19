#!/usr/bin/env node
/**
 * Configuration Profile Management CLI
 *
 * Provides commands for creating, listing, and managing configuration profiles.
 * Fully migrated to v0.7.0+ architecture using ProfileConfig and XDGConfig.
 *
 * Usage:
 *   npx ts-node bin/commands/config-profiles.ts list
 *   npx ts-node bin/commands/config-profiles.ts create <profile-name>
 *   npx ts-node bin/commands/config-profiles.ts show <profile-name>
 *   npx ts-node bin/commands/config-profiles.ts validate <profile-name>
 *
 * @module bin/commands/config-profiles
 * @version 0.7.0+
 */

import { XDGConfig } from "../../lib/xdg-config";
import { ProfileName, ProfileConfig } from "../../lib/types/config";
import { Command } from "commander";

/**
 * Profile Manager
 *
 * Manages configuration profiles with validation and AWS integration.
 */
class ProfileManager {
    private xdgConfig: XDGConfig;

    constructor() {
        this.xdgConfig = new XDGConfig();
    }

    /**
     * Lists all available profiles
     */
    public listProfiles(): void {
        console.log("Available configuration profiles:\n");

        const profiles = this.xdgConfig.listProfiles();

        if (profiles.length === 0) {
            console.log("  No profiles found.");
            console.log("\n  Run 'config-profiles create <name>' to create a new profile.");
            return;
        }

        profiles.forEach((profileName) => {
            const exists = this.xdgConfig.profileExists(profileName);
            const status = exists ? "✓" : "✗";
            const marker = profileName === "default" ? " (default)" : "";

            console.log(`  ${status} ${profileName}${marker}`);

            // Show configuration status
            if (exists) {
                try {
                    const profile = this.xdgConfig.readProfile(profileName);
                    const sections = [];
                    if (profile.quilt) sections.push("quilt");
                    if (profile.benchling) sections.push("benchling");
                    if (profile.packages) sections.push("packages");
                    if (profile.deployment) sections.push("deployment");

                    if (sections.length > 0) {
                        console.log(`    Sections: ${sections.join(", ")}`);
                    }
                } catch (error) {
                    console.log(`    Error reading profile: ${(error as Error).message}`);
                }
            }
        });

        console.log();
    }

    /**
     * Creates a new profile
     *
     * @param profileName - Name of the profile to create
     */
    public createProfile(profileName: ProfileName): void {
        console.log(`Creating profile: ${profileName}\n`);

        // Check if profile already exists
        if (this.xdgConfig.profileExists(profileName)) {
            console.error(`Error: Profile '${profileName}' already exists.`);
            process.exit(1);
        }

        // Create minimal valid ProfileConfig
        const config: ProfileConfig = {
            quilt: {
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/placeholder/placeholder",
                catalog: "https://placeholder.quilt.com",
                database: "placeholder_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/placeholder",
                region: "us-east-1",
            },
            benchling: {
                tenant: "placeholder",
                clientId: "placeholder",
                appDefinitionId: "placeholder",
            },
            packages: {
                bucket: "placeholder-bucket",
                prefix: "benchling",
                metadataKey: "experiment_id",
            },
            deployment: {
                region: "us-east-1",
            },
            _metadata: {
                version: "0.7.0",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: "cli",
            },
        };

        // Write profile configuration
        this.xdgConfig.writeProfile(profileName, config);

        console.log(`Profile '${profileName}' created successfully!`);
        console.log(`\nConfiguration file: ~/.config/benchling-webhook/${profileName}/config.json`);
        console.log("\nEdit the config file to add your actual configuration values.");
        console.log();
    }

    /**
     * Shows detailed information about a profile
     *
     * @param profileName - Name of the profile to show
     */
    public showProfile(profileName: ProfileName): void {
        if (!this.xdgConfig.profileExists(profileName)) {
            console.error(`Error: Profile '${profileName}' does not exist.`);
            process.exit(1);
        }

        console.log(`Profile: ${profileName}\n`);

        try {
            const profile = this.xdgConfig.readProfile(profileName);

            console.log("Configuration:");
            console.log("\nQuilt:");
            this.printSection(profile.quilt);

            console.log("\nBenchling:");
            this.printSection(profile.benchling);

            console.log("\nPackages:");
            this.printSection(profile.packages);

            console.log("\nDeployment:");
            this.printSection(profile.deployment);

            if (profile.logging) {
                console.log("\nLogging:");
                this.printSection(profile.logging);
            }

            if (profile.security) {
                console.log("\nSecurity:");
                this.printSection(profile.security);
            }

            console.log("\nMetadata:");
            this.printSection(profile._metadata);
            console.log();
        } catch (error) {
            console.error(`Error reading profile: ${(error as Error).message}`);
            process.exit(1);
        }
    }

    /**
     * Validates a profile configuration
     *
     * @param profileName - Name of the profile to validate
     */
    public validateProfile(profileName: ProfileName): void {
        console.log(`Validating profile: ${profileName}\n`);

        if (!this.xdgConfig.profileExists(profileName)) {
            console.error(`Error: Profile '${profileName}' does not exist.`);
            process.exit(1);
        }

        try {
            const profile = this.xdgConfig.readProfile(profileName);
            const validation = this.xdgConfig.validateProfile(profile);

            if (validation.isValid) {
                console.log("✓ Profile validation passed!");
                return;
            }

            if (validation.errors.length > 0) {
                console.log("Errors:");
                validation.errors.forEach((error) => console.log(`  ✗ ${error}`));
                console.log();
            }

            if (validation.warnings && validation.warnings.length > 0) {
                console.log("Warnings:");
                validation.warnings.forEach((warning) => console.log(`  ⚠ ${warning}`));
                console.log();
            }

            if (validation.errors.length > 0) {
                process.exit(1);
            }
        } catch (error) {
            console.error(`Validation failed: ${(error as Error).message}`);
            process.exit(1);
        }
    }

    /**
     * Prints a configuration section in a readable format
     *
     * @param section - Configuration section to print
     */
    private printSection(section: unknown): void {
        if (!section || typeof section !== "object") {
            console.log("  (empty)");
            return;
        }

        const entries = Object.entries(section);

        if (entries.length === 0) {
            console.log("  (empty)");
            return;
        }

        entries.forEach(([key, value]) => {
            if (key.toLowerCase().includes("secret") && typeof value === "string") {
                // Mask secrets
                console.log(`  ${key}: ${value.substring(0, 4)}****`);
            } else if (typeof value === "object" && value !== null) {
                console.log(`  ${key}: ${JSON.stringify(value, null, 2)}`);
            } else {
                console.log(`  ${key}: ${value}`);
            }
        });
    }
}

/**
 * Main CLI program
 */
function main(): void {
    const program = new Command();
    const manager = new ProfileManager();

    program
        .name("config-profiles")
        .description("Configuration Profile Management for Benchling Webhook")
        .version("0.7.0");

    // List command
    program
        .command("list")
        .description("List all available configuration profiles")
        .action(() => {
            manager.listProfiles();
        });

    // Create command
    program
        .command("create <profile-name>")
        .description("Create a new configuration profile")
        .option("--aws-profile <profile>", "AWS profile to associate with this configuration")
        .option("--description <text>", "Profile description")
        .action((profileName: string) => {
            manager.createProfile(profileName);
        });

    // Show command
    program
        .command("show <profile-name>")
        .description("Show detailed information about a profile")
        .action((profileName: string) => {
            manager.showProfile(profileName);
        });

    // Validate command
    program
        .command("validate <profile-name>")
        .description("Validate a profile configuration")
        .action((profileName: string) => {
            manager.validateProfile(profileName);
        });

    program.parse(process.argv);

    // Show help if no command provided
    if (!process.argv.slice(2).length) {
        program.outputHelp();
    }
}

// Run CLI
if (require.main === module) {
    main();
}

export { ProfileManager };
