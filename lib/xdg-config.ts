/**
 * XDG Configuration Management (v0.7.0 - BREAKING CHANGE)
 *
 * Filesystem implementation of XDGBase for XDG-compliant configuration management.
 *
 * This module provides filesystem-specific storage primitives for the Benchling Webhook system:
 * - Filesystem-based profile storage in ~/.config/benchling-webhook/
 * - Per-profile deployment tracking
 * - Legacy configuration detection
 * - Atomic writes with automatic backups
 *
 * All business logic (validation, inheritance, deployment tracking) is handled by XDGBase.
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
import { ProfileConfig, DeploymentHistory } from "./types/config";
import { XDGBase } from "./xdg-base";

/**
 * XDG Configuration Manager (v0.7.0)
 *
 * Filesystem-based implementation extending XDGBase.
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
export class XDGConfig extends XDGBase {
    private readonly baseDir: string;

    /**
     * Creates a new XDG Configuration Manager
     *
     * @param baseDir - Base configuration directory (defaults to ~/.config/benchling-webhook)
     */
    constructor(baseDir?: string) {
        super();
        this.baseDir = baseDir || this.getDefaultBaseDir();
        this.ensureBaseDirectoryExists();
    }

    // ====================================================================
    // Abstract Storage Primitives Implementation (Filesystem)
    // ====================================================================

    /**
     * Reads raw profile configuration from filesystem without validation
     *
     * @param profile - Profile name
     * @returns Raw profile configuration
     * @throws {Error} If profile cannot be read
     */
    protected readProfileRaw(profile: string): ProfileConfig {
        const configPath = this.getProfileConfigPath(profile);

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

        return config;
    }

    /**
     * Writes raw profile configuration to filesystem without validation
     *
     * Creates the profile directory if it doesn't exist.
     * Performs atomic write with automatic backup.
     *
     * @param profile - Profile name
     * @param config - Configuration to write
     * @throws {Error} If write fails
     */
    protected writeProfileRaw(profile: string, config: ProfileConfig): void {
        // Ensure profile directory exists
        const profileDir = this.getProfilePath(profile);
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
            `.config.json.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        );
        const configJson = JSON.stringify(config, null, 4);

        try {
            writeFileSync(tempPath, configJson, "utf-8");

            // Atomic rename (with fallback for cross-device on Windows)
            try {
                renameSync(tempPath, configPath);
            } catch (error) {
                // Fall back to copy+delete for cross-device scenarios (Windows)
                console.warn(`Warning: Atomic rename failed, using copy fallback: ${(error as Error).message}`);
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
     * Deletes profile and all associated data from filesystem
     *
     * @param profile - Profile name
     * @throws {Error} If deletion fails
     */
    protected deleteProfileRaw(profile: string): void {
        const profileDir = this.getProfilePath(profile);
        try {
            rmSync(profileDir, { recursive: true, force: true });
        } catch (error) {
            throw new Error(`Failed to delete profile directory: ${(error as Error).message}`);
        }
    }

    /**
     * Lists all profile names from filesystem
     *
     * @returns Array of profile names
     */
    protected listProfilesRaw(): string[] {
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
     * Checks if profile exists on filesystem
     *
     * @param profile - Profile name
     * @returns True if profile exists
     */
    protected profileExistsRaw(profile: string): boolean {
        const configPath = this.getProfileConfigPath(profile);
        return existsSync(configPath);
    }

    /**
     * Reads raw deployment history from filesystem without validation
     *
     * @param profile - Profile name
     * @returns Deployment history or null if none exists
     * @throws {Error} If read fails
     */
    protected readDeploymentsRaw(profile: string): DeploymentHistory | null {
        const deploymentsPath = this.getDeploymentsPath(profile);

        if (!existsSync(deploymentsPath)) {
            return null;
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

        return deployments;
    }

    /**
     * Writes raw deployment history to filesystem without validation
     *
     * @param profile - Profile name
     * @param history - Deployment history to write
     * @throws {Error} If write fails
     */
    protected writeDeploymentsRaw(profile: string, history: DeploymentHistory): void {
        // Ensure profile directory exists
        const profileDir = this.getProfilePath(profile);
        if (!existsSync(profileDir)) {
            mkdirSync(profileDir, { recursive: true });
        }

        const deploymentsPath = this.getDeploymentsPath(profile);
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
            `.deployments.json.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        );
        const deploymentsJson = JSON.stringify(history, null, 4);

        try {
            writeFileSync(tempPath, deploymentsJson, "utf-8");

            // Atomic rename (with fallback for cross-device on Windows)
            try {
                renameSync(tempPath, deploymentsPath);
            } catch (error) {
                // Fall back to copy+delete for cross-device scenarios (Windows)
                console.warn(`Warning: Atomic rename failed, using copy fallback: ${(error as Error).message}`);
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

    // ====================================================================
    // Filesystem Path Helpers
    // ====================================================================

    /**
     * Gets the default XDG base directory
     *
     * Respects XDG_CONFIG_HOME environment variable per XDG Base Directory spec.
     *
     * @returns The default base directory path (~/.config/benchling-webhook or $XDG_CONFIG_HOME/benchling-webhook)
     */
    private getDefaultBaseDir(): string {
        const xdgConfigHome = process.env.XDG_CONFIG_HOME;
        if (xdgConfigHome) {
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

    /**
     * Gets the directory path for a profile
     *
     * @param profile - Profile name
     * @returns Absolute path to profile directory
     */
    private getProfilePath(profile: string): string {
        return join(this.baseDir, profile);
    }

    /**
     * Gets the config.json path for a profile
     *
     * @param profile - Profile name
     * @returns Absolute path to config.json
     */
    private getProfileConfigPath(profile: string): string {
        return join(this.getProfilePath(profile), "config.json");
    }

    /**
     * Gets the deployments.json path for a profile
     *
     * @param profile - Profile name
     * @returns Absolute path to deployments.json
     */
    private getDeploymentsPath(profile: string): string {
        return join(this.getProfilePath(profile), "deployments.json");
    }

    // ====================================================================
    // Filesystem-Specific Features
    // ====================================================================

    /**
     * Detects legacy v0.6.x configuration files
     *
     * @returns True if legacy files are detected
     */
    public detectLegacyConfiguration(): boolean {
        const legacyFiles = [
            join(this.baseDir, "default.json"),
            join(this.baseDir, "deploy.json"),
            join(this.baseDir, "profiles"),
        ];

        return legacyFiles.some((f) => existsSync(f));
    }

    /**
     * Builds a helpful error message when a profile is not found
     *
     * Overrides base class to add legacy configuration detection.
     *
     * @param profile - Profile name that was not found
     * @returns Formatted error message
     */
    protected buildProfileNotFoundError(profile: string): string {
        if (this.detectLegacyConfiguration()) {
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

        return super.buildProfileNotFoundError(profile);
    }
}
