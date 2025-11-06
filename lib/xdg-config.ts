/**
 * XDG Configuration Management (v0.7.0 - BREAKING CHANGE)
 *
 * Complete rewrite with NO backward compatibility with v0.6.x.
 *
 * This module provides XDG-compliant configuration management for the Benchling Webhook system
 * with a simplified, profile-first architecture:
 *
 * - Single unified configuration file per profile (`config.json`)
 * - Per-profile deployment tracking (`deployments.json`)
 * - Profile inheritance support with deep merging
 * - Comprehensive validation and helpful error messages
 *
 * Directory Structure:
 * ```
 * ~/.config/benchling-webhook/
 * ├── default/
 * │   ├── config.json         # Profile configuration
 * │   └── deployments.json    # Deployment history
 * └── dev/
 *     ├── config.json
 *     └── deployments.json
 * ```
 *
 * @module xdg-config
 * @version 0.7.0
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync, readdirSync, rmSync } from "fs";
import { resolve, join, dirname } from "path";
import { homedir } from "os";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import merge from "lodash.merge";
import {
    ProfileConfig,
    DeploymentHistory,
    DeploymentRecord,
    ValidationResult,
    ProfileConfigSchema,
    DeploymentHistorySchema,
} from "./types/config";

/**
 * XDG Configuration Manager (v0.7.0)
 *
 * Manages profile-based configuration with deployment tracking.
 * NO backward compatibility with v0.6.x configuration files.
 *
 * @example
 * ```typescript
 * const xdg = new XDGConfig();
 *
 * // Read profile configuration
 * const config = xdg.readProfile("default");
 *
 * // Write profile configuration
 * xdg.writeProfile("default", config);
 *
 * // Record deployment
 * xdg.recordDeployment("default", {
 *   stage: "prod",
 *   timestamp: new Date().toISOString(),
 *   imageTag: "0.7.0",
 *   endpoint: "https://...",
 *   stackName: "BenchlingWebhookStack",
 *   region: "us-east-1"
 * });
 * ```
 */
export class XDGConfig {
    private readonly baseDir: string;

    /**
     * Creates a new XDG Configuration Manager
     *
     * @param baseDir - Base configuration directory (defaults to ~/.config/benchling-webhook)
     */
    constructor(baseDir?: string) {
        this.baseDir = baseDir || this.getDefaultBaseDir();
        this.ensureBaseDirectoryExists();
    }

    /**
     * Gets the default XDG base directory
     *
     * @returns The default base directory path (~/.config/benchling-webhook)
     */
    private getDefaultBaseDir(): string {
        const xdgConfigHome = process.env.XDG_CONFIG_HOME;
        if (xdgConfigHome && xdgConfigHome.trim().length > 0) {
            return resolve(xdgConfigHome, "benchling-webhook");
        }

        const home = homedir();
        return resolve(home, ".config", "benchling-webhook");
    }

    /**
     * Ensures the base configuration directory exists
     *
     * @throws {Error} If directory creation fails
     */
    private ensureBaseDirectoryExists(): void {
        if (!existsSync(this.baseDir)) {
            mkdirSync(this.baseDir, { recursive: true });
        }
    }

    // ====================================================================
    // Configuration Management
    // ====================================================================

    /**
     * Reads configuration for a profile
     *
     * @param profile - Profile name (e.g., "default", "dev", "prod")
     * @returns Parsed configuration object
     * @throws {Error} If profile not found or configuration is invalid
     *
     * @example
     * ```typescript
     * const config = xdg.readProfile("default");
     * console.log(config.benchling.tenant);
     * ```
     */
    public readProfile(profile: string): ProfileConfig {
        const configPath = this.getProfileConfigPath(profile);

        if (!existsSync(configPath)) {
            throw new Error(this.buildProfileNotFoundError(profile));
        }

        let fileContent: string;
        try {
            fileContent = readFileSync(configPath, "utf-8");
        } catch (error) {
            throw new Error(`Failed to read configuration file: ${configPath}. ${(error as Error).message}`);
        }

        let config: ProfileConfig;
        try {
            config = JSON.parse(fileContent);
        } catch (error) {
            throw new Error(`Invalid JSON in configuration file: ${configPath}. ${(error as Error).message}`);
        }

        // Validate schema
        const validation = this.validateProfile(config);
        if (!validation.isValid) {
            throw new Error(`Invalid configuration in ${configPath}:\n${validation.errors.join("\n")}`);
        }

        return config;
    }

    /**
     * Writes configuration for a profile
     *
     * Creates the profile directory if it doesn't exist.
     * Performs atomic write with automatic backup.
     *
     * @param profile - Profile name
     * @param config - Configuration object to write
     * @throws {Error} If validation fails or write operation fails
     *
     * @example
     * ```typescript
     * xdg.writeProfile("default", {
     *   quilt: { ... },
     *   benchling: { ... },
     *   packages: { ... },
     *   deployment: { ... },
     *   _metadata: {
     *     version: "0.7.0",
     *     createdAt: new Date().toISOString(),
     *     updatedAt: new Date().toISOString(),
     *     source: "wizard"
     *   }
     * });
     * ```
     */
    public writeProfile(profile: string, config: ProfileConfig): void {
        // Validate configuration before writing
        const validation = this.validateProfile(config);
        if (!validation.isValid) {
            throw new Error(`Invalid configuration:\n${validation.errors.join("\n")}`);
        }

        // Ensure profile directory exists
        const profileDir = this.getProfileDir(profile);
        if (!existsSync(profileDir)) {
            mkdirSync(profileDir, { recursive: true });
        }

        const configPath = this.getProfileConfigPath(profile);
        const backupPath = `${configPath}.backup`;

        // Create backup if file exists
        if (existsSync(configPath)) {
            try {
                copyFileSync(configPath, backupPath);
            } catch (error) {
                throw new Error(`Failed to create backup: ${(error as Error).message}`);
            }
        }

        // Write to temporary file first (atomic write)
        const tempPath = join(
            profileDir,
            `.config.json.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
        );
        const configJson = JSON.stringify(config, null, 4);

        try {
            writeFileSync(tempPath, configJson, "utf-8");

            // Atomic rename (with fallback for cross-device on Windows)
            try {
                renameSync(tempPath, configPath);
            } catch {
                // Fall back to copy+delete for cross-device scenarios (Windows)
                // Ensure target directory exists before copying
                const targetDir = dirname(configPath);
                if (!existsSync(targetDir)) {
                    mkdirSync(targetDir, { recursive: true });
                }
                copyFileSync(tempPath, configPath);
                unlinkSync(tempPath);
            }
        } catch (error) {
            throw new Error(`Failed to write configuration file: ${(error as Error).message}`);
        }
    }

    /**
     * Deletes a profile and all its files
     *
     * WARNING: This is a destructive operation!
     * Cannot delete the "default" profile.
     *
     * @param profile - Profile name to delete
     * @throws {Error} If attempting to delete default profile or if deletion fails
     *
     * @example
     * ```typescript
     * xdg.deleteProfile("dev");
     * ```
     */
    public deleteProfile(profile: string): void {
        if (profile === "default") {
            throw new Error("Cannot delete the default profile");
        }

        const profileDir = this.getProfileDir(profile);
        if (!existsSync(profileDir)) {
            throw new Error(`Profile does not exist: ${profile}`);
        }

        try {
            rmSync(profileDir, { recursive: true, force: true });
        } catch (error) {
            throw new Error(`Failed to delete profile: ${(error as Error).message}`);
        }
    }

    /**
     * Lists all available profiles
     *
     * @returns Array of profile names
     *
     * @example
     * ```typescript
     * const profiles = xdg.listProfiles();
     * console.log(profiles); // ["default", "dev", "prod"]
     * ```
     */
    public listProfiles(): string[] {
        if (!existsSync(this.baseDir)) {
            return [];
        }

        const entries = readdirSync(this.baseDir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .filter((name) => {
                // Only include directories with config.json
                const configPath = this.getProfileConfigPath(name);
                return existsSync(configPath);
            });
    }

    /**
     * Checks if a profile exists
     *
     * @param profile - Profile name to check
     * @returns True if profile exists and has valid config.json, false otherwise
     *
     * @example
     * ```typescript
     * if (xdg.profileExists("dev")) {
     *   const config = xdg.readProfile("dev");
     * }
     * ```
     */
    public profileExists(profile: string): boolean {
        const configPath = this.getProfileConfigPath(profile);
        return existsSync(configPath);
    }

    // ====================================================================
    // Deployment Tracking
    // ====================================================================

    /**
     * Gets deployment history for a profile
     *
     * Returns empty history if deployments.json doesn't exist.
     *
     * @param profile - Profile name
     * @returns Deployment history with active deployments and full history
     *
     * @example
     * ```typescript
     * const deployments = xdg.getDeployments("default");
     * console.log(deployments.active["prod"]); // Active prod deployment
     * console.log(deployments.history[0]); // Most recent deployment
     * ```
     */
    public getDeployments(profile: string): DeploymentHistory {
        const deploymentsPath = this.getProfileDeploymentsPath(profile);

        if (!existsSync(deploymentsPath)) {
            return {
                active: {},
                history: [],
            };
        }

        let fileContent: string;
        try {
            fileContent = readFileSync(deploymentsPath, "utf-8");
        } catch (error) {
            throw new Error(`Failed to read deployments file: ${deploymentsPath}. ${(error as Error).message}`);
        }

        let deployments: DeploymentHistory;
        try {
            deployments = JSON.parse(fileContent);
        } catch (error) {
            throw new Error(`Invalid JSON in deployments file: ${deploymentsPath}. ${(error as Error).message}`);
        }

        // Validate schema
        const ajv = new Ajv();
        addFormats(ajv);
        const validate = ajv.compile(DeploymentHistorySchema);
        const valid = validate(deployments);

        if (!valid) {
            const errors = validate.errors?.map((err) => `${err.instancePath} ${err.message}`).join(", ");
            throw new Error(`Invalid deployments schema in ${deploymentsPath}: ${errors}`);
        }

        return deployments;
    }

    /**
     * Records a new deployment for a profile
     *
     * Adds deployment to history and updates active deployment for the stage.
     * Creates deployments.json if it doesn't exist.
     *
     * @param profile - Profile name
     * @param deployment - Deployment record to add
     *
     * @example
     * ```typescript
     * xdg.recordDeployment("default", {
     *   stage: "prod",
     *   timestamp: new Date().toISOString(),
     *   imageTag: "0.7.0",
     *   endpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
     *   stackName: "BenchlingWebhookStack",
     *   region: "us-east-1",
     *   deployedBy: "ernest@example.com",
     *   commit: "abc123f"
     * });
     * ```
     */
    public recordDeployment(profile: string, deployment: DeploymentRecord): void {
        // Ensure profile directory exists
        const profileDir = this.getProfileDir(profile);
        if (!existsSync(profileDir)) {
            mkdirSync(profileDir, { recursive: true });
        }

        // Load existing deployments or create new
        let deployments: DeploymentHistory;
        try {
            deployments = this.getDeployments(profile);
        } catch {
            deployments = {
                active: {},
                history: [],
            };
        }

        // Add to history (newest first)
        deployments.history.unshift(deployment);

        // Update active deployment for this stage
        deployments.active[deployment.stage] = deployment;

        // Write deployments file
        const deploymentsPath = this.getProfileDeploymentsPath(profile);
        const backupPath = `${deploymentsPath}.backup`;

        // Create backup if file exists
        if (existsSync(deploymentsPath)) {
            try {
                copyFileSync(deploymentsPath, backupPath);
            } catch (error) {
                throw new Error(`Failed to create backup: ${(error as Error).message}`);
            }
        }

        // Write to temporary file first (atomic write)
        const tempPath = join(
            profileDir,
            `.deployments.json.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
        );
        const deploymentsJson = JSON.stringify(deployments, null, 4);

        try {
            writeFileSync(tempPath, deploymentsJson, "utf-8");

            // Atomic rename (with fallback for cross-device on Windows)
            try {
                renameSync(tempPath, deploymentsPath);
            } catch {
                // Fall back to copy+delete for cross-device scenarios (Windows)
                // Ensure target directory exists before copying
                const targetDir = dirname(deploymentsPath);
                if (!existsSync(targetDir)) {
                    mkdirSync(targetDir, { recursive: true });
                }
                copyFileSync(tempPath, deploymentsPath);
                unlinkSync(tempPath);
            }
        } catch (error) {
            throw new Error(`Failed to write deployments file: ${(error as Error).message}`);
        }
    }

    /**
     * Gets the active deployment for a specific stage
     *
     * @param profile - Profile name
     * @param stage - Stage name (e.g., "dev", "prod")
     * @returns Active deployment record for the stage, or null if none exists
     *
     * @example
     * ```typescript
     * const prodDeployment = xdg.getActiveDeployment("default", "prod");
     * if (prodDeployment) {
     *   console.log("Prod endpoint:", prodDeployment.endpoint);
     * }
     * ```
     */
    public getActiveDeployment(profile: string, stage: string): DeploymentRecord | null {
        try {
            const deployments = this.getDeployments(profile);
            return deployments.active[stage] || null;
        } catch {
            return null;
        }
    }

    // ====================================================================
    // Profile Inheritance
    // ====================================================================

    /**
     * Reads profile configuration with inheritance support
     *
     * If the profile has an `_inherits` field, loads the base profile first
     * and deep merges the current profile on top.
     *
     * Detects and prevents circular inheritance chains.
     *
     * @param profile - Profile name to read
     * @param baseProfile - Optional explicit base profile (overrides `_inherits`)
     * @returns Merged configuration with inheritance applied
     * @throws {Error} If circular inheritance is detected
     *
     * @example
     * ```typescript
     * // dev/config.json has "_inherits": "default"
     * const devConfig = xdg.readProfileWithInheritance("dev");
     * // Returns default config deep-merged with dev overrides
     * ```
     */
    public readProfileWithInheritance(profile: string, baseProfile?: string): ProfileConfig {
        const visited = new Set<string>();
        return this.readProfileWithInheritanceInternal(profile, baseProfile, visited);
    }

    /**
     * Internal recursive implementation of profile inheritance
     *
     * @param profile - Current profile name
     * @param explicitBase - Explicitly specified base profile
     * @param visited - Set of visited profiles (for circular detection)
     * @returns Merged configuration
     * @throws {Error} If circular inheritance is detected
     */
    private readProfileWithInheritanceInternal(
        profile: string,
        explicitBase: string | undefined,
        visited: Set<string>,
    ): ProfileConfig {
        // Detect circular inheritance
        if (visited.has(profile)) {
            const chain = Array.from(visited).join(" -> ");
            throw new Error(`Circular inheritance detected: ${chain} -> ${profile}`);
        }

        visited.add(profile);

        // Read current profile
        const config = this.readProfile(profile);

        // Determine base profile
        const baseProfileName = explicitBase || config._inherits;

        // No inheritance - return as-is
        if (!baseProfileName) {
            return config;
        }

        // Load base profile with inheritance
        const baseConfig = this.readProfileWithInheritanceInternal(baseProfileName, undefined, visited);

        // Deep merge: base config first, then current profile overrides
        const merged = this.deepMergeConfigs(baseConfig, config);

        // Remove _inherits from final result (it's already applied)
        delete merged._inherits;

        return merged;
    }

    /**
     * Deep merges two profile configurations
     *
     * Nested objects are merged recursively.
     * Arrays are replaced (not concatenated).
     * Current config takes precedence over base config.
     *
     * @param base - Base configuration
     * @param current - Current configuration (takes precedence)
     * @returns Merged configuration
     */
    private deepMergeConfigs(base: ProfileConfig, current: ProfileConfig): ProfileConfig {
        return merge({}, base, current);
    }

    // ====================================================================
    // Validation
    // ====================================================================

    /**
     * Validates a profile configuration against the schema
     *
     * @param config - Configuration object to validate
     * @returns Validation result with errors and warnings
     *
     * @example
     * ```typescript
     * const validation = xdg.validateProfile(config);
     * if (!validation.isValid) {
     *   console.error("Validation errors:", validation.errors);
     * }
     * ```
     */
    public validateProfile(config: ProfileConfig): ValidationResult {
        const ajv = new Ajv({ allErrors: true, strict: false });
        addFormats(ajv);
        const validate = ajv.compile(ProfileConfigSchema);
        const valid = validate(config);

        if (valid) {
            return {
                isValid: true,
                errors: [],
                warnings: [],
            };
        }

        const errors = validate.errors?.map((err) => {
            const path = err.instancePath || "(root)";
            return `${path}: ${err.message}`;
        }) || [];

        return {
            isValid: false,
            errors,
            warnings: [],
        };
    }

    // ====================================================================
    // Path Helpers
    // ====================================================================

    /**
     * Gets the directory path for a profile
     *
     * @param profile - Profile name
     * @returns Absolute path to profile directory
     */
    private getProfileDir(profile: string): string {
        return join(this.baseDir, profile);
    }

    /**
     * Gets the config.json path for a profile
     *
     * @param profile - Profile name
     * @returns Absolute path to config.json
     */
    private getProfileConfigPath(profile: string): string {
        return join(this.getProfileDir(profile), "config.json");
    }

    /**
     * Gets the deployments.json path for a profile
     *
     * @param profile - Profile name
     * @returns Absolute path to deployments.json
     */
    private getProfileDeploymentsPath(profile: string): string {
        return join(this.getProfileDir(profile), "deployments.json");
    }

    // ====================================================================
    // Error Messages
    // ====================================================================

    /**
     * Builds a helpful error message when a profile is not found
     *
     * Detects legacy v0.6.x configuration files and provides upgrade guidance.
     *
     * @param profile - Profile name that was not found
     * @returns Formatted error message
     */
    private buildProfileNotFoundError(profile: string): string {
        const legacyFiles = [
            join(this.baseDir, "default.json"),
            join(this.baseDir, "deploy.json"),
            join(this.baseDir, "profiles"),
        ];

        const hasLegacyFiles = legacyFiles.some((f) => existsSync(f));

        if (hasLegacyFiles) {
            return `
Profile not found: ${profile}

Configuration format changed in v0.7.0.
Your old configuration files are not compatible.

Please run setup wizard to create new configuration:
  npx @quiltdata/benchling-webhook@latest setup

Your old configuration files remain at:
  ~/.config/benchling-webhook/default.json
  ~/.config/benchling-webhook/deploy.json

You can manually reference these files to re-enter your settings.
            `.trim();
        }

        return `
Profile not found: ${profile}

No configuration found for profile: ${profile}

Run setup wizard to create configuration:
  npx @quiltdata/benchling-webhook@latest setup

Available profiles: ${this.listProfiles().join(", ") || "(none)"}
        `.trim();
    }
}
