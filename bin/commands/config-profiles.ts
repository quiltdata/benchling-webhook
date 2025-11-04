#!/usr/bin/env node
/**
 * Configuration Profile Management CLI
 *
 * Provides commands for creating, listing, and managing configuration profiles.
 * Supports AWS profile integration and profile validation.
 *
 * Usage:
 *   npx ts-node bin/config-profiles.ts list
 *   npx ts-node bin/config-profiles.ts create <profile-name>
 *   npx ts-node bin/config-profiles.ts show <profile-name>
 *   npx ts-node bin/config-profiles.ts validate <profile-name>
 *
 * @module bin/config-profiles
 */

import { XDGConfig, BaseConfig } from "../lib/xdg-config";
import { ProfileName, UserConfig, DerivedConfig, DeploymentConfig } from "../lib/types/config";
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
                const profile = this.xdgConfig.loadProfile(profileName);
                const hasUser = profile.user ? "user" : "";
                const hasDerived = profile.derived ? "derived" : "";
                const hasDeploy = profile.deploy ? "deploy" : "";
                const configs = [hasUser, hasDerived, hasDeploy].filter(Boolean).join(", ");

                if (configs) {
                    console.log(`    Configs: ${configs}`);
                }
            }
        });

        console.log();
    }

    /**
     * Creates a new profile
     *
     * @param profileName - Name of the profile to create
     * @param options - Creation options
     */
    public createProfile(
        profileName: ProfileName,
        options: { awsProfile?: string; description?: string } = {},
    ): void {
        console.log(`Creating profile: ${profileName}\n`);

        // Check if profile already exists
        if (this.xdgConfig.profileExists(profileName)) {
            console.error(`Error: Profile '${profileName}' already exists.`);
            process.exit(1);
        }

        // Ensure directories exist
        this.xdgConfig.ensureProfileDirectories(profileName);

        // Create initial user configuration
        const userConfig: BaseConfig = {
            awsProfile: options.awsProfile,
            _metadata: {
                savedAt: new Date().toISOString(),
                source: "cli",
                version: "0.6.0",
            },
        };

        // Write user configuration
        this.xdgConfig.writeProfileConfig("user", userConfig, profileName);

        const paths = this.xdgConfig.getProfilePaths(profileName);
        console.log(`Profile '${profileName}' created successfully!`);
        console.log("\nConfiguration files:");
        console.log(`  User config:   ${paths.userConfig}`);
        console.log(`  Derived config: ${paths.derivedConfig}`);
        console.log(`  Deploy config:  ${paths.deployConfig}`);
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

        const profile = this.xdgConfig.loadProfile(profileName);
        const paths = this.xdgConfig.getProfilePaths(profileName);

        // Show paths
        console.log("Configuration files:");
        console.log(`  User config:   ${paths.userConfig}`);
        console.log(`  Derived config: ${paths.derivedConfig}`);
        console.log(`  Deploy config:  ${paths.deployConfig}`);
        console.log();

        // Show user configuration
        if (profile.user) {
            console.log("User Configuration:");
            this.printConfig(profile.user);
            console.log();
        }

        // Show derived configuration
        if (profile.derived) {
            console.log("Derived Configuration:");
            this.printConfig(profile.derived);
            console.log();
        }

        // Show deployment configuration
        if (profile.deploy) {
            console.log("Deployment Configuration:");
            this.printConfig(profile.deploy);
            console.log();
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

        const profile = this.xdgConfig.loadProfile(profileName);
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate user configuration
        if (!profile.user) {
            errors.push("Missing user configuration");
        } else {
            // Check required fields
            const required = [
                "benchlingTenant",
                "benchlingClientId",
                "quiltCatalog",
                "quiltUserBucket",
            ];

            required.forEach((field) => {
                if (!profile.user![field as keyof UserConfig]) {
                    errors.push(`Missing required field in user config: ${field}`);
                }
            });

            // Check AWS profile
            if (!profile.user.awsProfile) {
                warnings.push("No AWS profile specified");
            }
        }

        // Validate derived configuration
        if (profile.derived) {
            if (!profile.derived.catalogUrl) {
                warnings.push("Derived config missing catalogUrl");
            }
        } else {
            warnings.push("No derived configuration found");
        }

        // Report results
        if (errors.length === 0 && warnings.length === 0) {
            console.log("✓ Profile validation passed!");
            return;
        }

        if (errors.length > 0) {
            console.log("Errors:");
            errors.forEach((error) => console.log(`  ✗ ${error}`));
            console.log();
        }

        if (warnings.length > 0) {
            console.log("Warnings:");
            warnings.forEach((warning) => console.log(`  ⚠ ${warning}`));
            console.log();
        }

        if (errors.length > 0) {
            process.exit(1);
        }
    }

    /**
     * Prints configuration object in a readable format
     *
     * @param config - Configuration object to print
     */
    private printConfig(config: UserConfig | DerivedConfig | DeploymentConfig): void {
        const entries = Object.entries(config).filter(([key]) => key !== "_metadata");

        if (entries.length === 0) {
            console.log("  (empty)");
            return;
        }

        entries.forEach(([key, value]) => {
            if (key.toLowerCase().includes("secret") && typeof value === "string") {
                // Mask secrets
                console.log(`  ${key}: ${value.substring(0, 4)}****`);
            } else if (typeof value === "object") {
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
        .version("0.6.0");

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
        .action((profileName: string, options: { awsProfile?: string; description?: string }) => {
            manager.createProfile(profileName, options);
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
