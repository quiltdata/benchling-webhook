/**
 * XDG Configuration Management
 *
 * Provides XDG-compliant configuration file management for the Benchling Webhook system.
 * Implements a three-file configuration model:
 * - User configuration: User-provided default settings
 * - Derived configuration: CLI-inferred configuration
 * - Deployment configuration: Deployment-specific artifacts
 *
 * Supports multiple named profiles (e.g., "default", "dev", "prod") for flexible configuration management.
 *
 * @module xdg-config
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync, readdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { tmpdir } from "os";
import Ajv from "ajv";
import merge from "lodash.merge";
import {
    UserConfig,
    DerivedConfig,
    DeploymentConfig,
    ConfigType,
    ProfileName,
    XDGConfigPaths,
    ConfigSet,
    ConfigProfile,
} from "./types/config";

/**
 * Base configuration structure (for backward compatibility)
 */
export interface BaseConfig {
    [key: string]: unknown;
}

// Re-export types for backward compatibility
export type { ConfigType, XDGConfigPaths, ConfigSet };

/**
 * JSON Schema for configuration validation
 * This is a lenient schema that allows additional properties
 */
const CONFIG_SCHEMA = {
    type: "object",
    properties: {
        quiltCatalog: { type: "string" },
        quiltUserBucket: { type: "string" },
        quiltDatabase: { type: "string" },
        quiltStackArn: { type: "string" },
        quiltRegion: { type: "string" },
        catalogUrl: { type: "string" },
        benchlingTenant: { type: "string" },
        benchlingClientId: { type: "string" },
        benchlingClientSecret: { type: "string" },
        benchlingAppDefinitionId: { type: "string" },
        benchlingSecret: { type: "string" },
        benchlingSecrets: { type: "string" },
        cdkAccount: { type: "string" },
        cdkRegion: { type: "string" },
        awsProfile: { type: "string" },
        queueArn: { type: "string" },
        pkgPrefix: { type: "string" },
        pkgKey: { type: "string" },
        logLevel: { type: "string" },
        webhookAllowList: { type: "string" },
        webhookEndpoint: { type: "string" },
        enableWebhookVerification: { type: "string" },
        createEcrRepository: { type: "string" },
        ecrRepositoryName: { type: "string" },
        imageTag: { type: "string" },
        webhookUrl: { type: "string" },
        deploymentTimestamp: { type: "string" },
        deployedAt: { type: "string" },
        stackArn: { type: "string" },
        _metadata: {
            type: "object",
            properties: {
                savedAt: { type: "string" },
                source: { type: "string" },
                version: { type: "string" },
                inferredAt: { type: "string" },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: true,
};

/**
 * XDG Configuration Manager
 *
 * Manages XDG-compliant configuration files for the Benchling Webhook system.
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
    }

    /**
     * Gets the default XDG base directory
     *
     * @returns The default base directory path
     */
    private getDefaultBaseDir(): string {
        const home = homedir();
        return resolve(home, ".config", "benchling-webhook");
    }

    /**
     * Expands home directory in a path
     *
     * @param path - Path potentially containing ~ for home directory
     * @returns Expanded absolute path
     */
    private static expandHomeDir(path: string): string {
        const home = homedir();
        return path.replace(/^~/, home);
    }

    /**
     * Gets the configuration file paths
     *
     * @returns Object containing paths to all configuration files
     */
    public static getPaths(): XDGConfigPaths {
        const home = homedir();
        const baseDir = resolve(home, ".config", "benchling-webhook");

        return {
            userConfig: resolve(baseDir, "default.json"),
            derivedConfig: resolve(baseDir, "config", "default.json"),
            deployConfig: resolve(baseDir, "deploy", "default.json"),
        };
    }

    /**
     * Gets the configuration file paths for this instance
     *
     * @returns Object containing paths to all configuration files
     */
    public getPaths(): XDGConfigPaths {
        return {
            userConfig: resolve(this.baseDir, "default.json"),
            derivedConfig: resolve(this.baseDir, "config", "default.json"),
            deployConfig: resolve(this.baseDir, "deploy", "default.json"),
        };
    }

    /**
     * Ensures all required configuration directories exist
     *
     * Creates the base configuration directory and subdirectories if they don't exist.
     *
     * @throws {Error} If directory creation fails
     */
    public ensureDirectories(): void {
        // Create base directory
        if (!existsSync(this.baseDir)) {
            mkdirSync(this.baseDir, { recursive: true });
        }

        // Create config subdirectory
        const configDir = resolve(this.baseDir, "config");
        if (!existsSync(configDir)) {
            mkdirSync(configDir, { recursive: true });
        }

        // Create deploy subdirectory
        const deployDir = resolve(this.baseDir, "deploy");
        if (!existsSync(deployDir)) {
            mkdirSync(deployDir, { recursive: true });
        }
    }

    /**
     * Gets the file path for a specific configuration type
     *
     * @param configType - Type of configuration to read
     * @returns Absolute path to the configuration file
     */
    private getConfigPath(configType: ConfigType): string {
        const paths = this.getPaths();
        switch (configType) {
        case "user":
            return paths.userConfig;
        case "derived":
            return paths.derivedConfig;
        case "deploy":
            return paths.deployConfig;
        default:
            throw new Error(`Unknown configuration type: ${configType}`);
        }
    }

    /**
     * Reads and parses a configuration file with schema validation
     *
     * @param configType - Type of configuration to read ("user", "derived", or "deploy")
     * @returns Parsed configuration object
     * @throws {Error} If file not found, invalid JSON, or schema validation fails
     */
    public readConfig(configType: ConfigType): BaseConfig {
        const configPath = this.getConfigPath(configType);

        // Check if file exists
        if (!existsSync(configPath)) {
            throw new Error(`Configuration file not found: ${configPath}`);
        }

        // Read file content
        let fileContent: string;
        try {
            fileContent = readFileSync(configPath, "utf-8");
        } catch (error) {
            throw new Error(`Failed to read configuration file: ${configPath}. ${(error as Error).message}`);
        }

        // Parse JSON
        let config: BaseConfig;
        try {
            config = JSON.parse(fileContent);
        } catch (error) {
            throw new Error(`Invalid JSON in configuration file: ${configPath}. ${(error as Error).message}`);
        }

        // Validate schema
        const ajv = new Ajv();
        const validate = ajv.compile(CONFIG_SCHEMA);
        const valid = validate(config);

        if (!valid) {
            const errors = validate.errors?.map((err) => `${err.instancePath} ${err.message}`).join(", ");
            throw new Error(`Invalid configuration schema in ${configPath}: ${errors}`);
        }

        return config;
    }

    /**
     * Gets the backup file path for a configuration type
     *
     * @param configType - Type of configuration
     * @returns Backup file path
     */
    public getBackupPath(configType: ConfigType): string {
        const configPath = this.getConfigPath(configType);
        return `${configPath}.backup`;
    }

    /**
     * Validates configuration against schema
     *
     * @param config - Configuration object to validate
     * @throws {Error} If validation fails
     */
    private validateConfigSchema(config: BaseConfig): void {
        const ajv = new Ajv();
        const validate = ajv.compile(CONFIG_SCHEMA);
        const valid = validate(config);

        if (!valid) {
            const errors = validate.errors?.map((err) => `${err.instancePath} ${err.message}`).join(", ");
            throw new Error(`Invalid configuration schema: ${errors}`);
        }
    }

    /**
     * Writes a configuration file atomically with backup
     *
     * Uses a temporary file and rename operation for atomic writes.
     * Creates a backup of the existing file before overwriting.
     *
     * @param configType - Type of configuration to write ("user", "derived", or "deploy")
     * @param config - Configuration object to write
     * @throws {Error} If validation fails or write operation fails
     */
    public writeConfig(configType: ConfigType, config: BaseConfig): void {
        // Validate configuration before writing
        this.validateConfigSchema(config);

        const configPath = this.getConfigPath(configType);
        const backupPath = this.getBackupPath(configType);

        // Create backup if file exists
        if (existsSync(configPath)) {
            try {
                copyFileSync(configPath, backupPath);
            } catch (error) {
                throw new Error(`Failed to create backup: ${(error as Error).message}`);
            }
        }

        // Write to temporary file first (atomic write)
        const tempPath = resolve(tmpdir(), `benchling-webhook-config-${Date.now()}.json`);
        const configJson = JSON.stringify(config, null, 4);

        try {
            writeFileSync(tempPath, configJson, "utf-8");

            // Atomic rename (with fallback for cross-device on Windows)
            try {
                renameSync(tempPath, configPath);
            } catch (renameError) {
                // Fall back to copy+delete for cross-device scenarios (Windows)
                copyFileSync(tempPath, configPath);
                unlinkSync(tempPath);
            }
        } catch (error) {
            throw new Error(`Failed to write configuration file: ${(error as Error).message}`);
        }
    }

    /**
     * Merges multiple configuration sources with priority order
     *
     * Merges configurations in priority order (user → derived → deploy),
     * where later configurations override earlier ones.
     * Uses deep merge to handle nested objects.
     *
     * @param configs - Configuration set to merge
     * @returns Merged configuration object
     */
    public mergeConfigs(configs: ConfigSet): BaseConfig {
        // Start with empty config
        let merged: BaseConfig = {};

        // Merge in priority order: user → derived → deploy
        // Each subsequent config overrides previous values
        if (configs.user) {
            merged = merge({}, merged, configs.user);
        }

        if (configs.derived) {
            merged = merge({}, merged, configs.derived);
        }

        if (configs.deploy) {
            merged = merge({}, merged, configs.deploy);
        }

        return merged;
    }

    // ====================================================================
    // Profile Management Methods (Phase 1.1)
    // ====================================================================

    /**
     * Gets the profile directory path
     *
     * @param profileName - Profile name (defaults to "default")
     * @returns Profile directory path
     */
    public getProfileDir(profileName: ProfileName = "default"): string {
        if (profileName === "default") {
            return this.baseDir;
        }
        return resolve(this.baseDir, "profiles", profileName);
    }

    /**
     * Gets configuration file paths for a specific profile
     *
     * @param profileName - Profile name (defaults to "default")
     * @returns Configuration file paths for the profile
     */
    public getProfilePaths(profileName: ProfileName = "default"): XDGConfigPaths {
        const profileDir = this.getProfileDir(profileName);

        return {
            userConfig: resolve(profileDir, "default.json"),
            derivedConfig: resolve(profileDir, "config", "default.json"),
            deployConfig: resolve(profileDir, "deploy", "default.json"),
        };
    }

    /**
     * Ensures profile directories exist
     *
     * @param profileName - Profile name (defaults to "default")
     */
    public ensureProfileDirectories(profileName: ProfileName = "default"): void {
        const profileDir = this.getProfileDir(profileName);

        // Create profile directory
        if (!existsSync(profileDir)) {
            mkdirSync(profileDir, { recursive: true });
        }

        // Create config subdirectory
        const configDir = resolve(profileDir, "config");
        if (!existsSync(configDir)) {
            mkdirSync(configDir, { recursive: true });
        }

        // Create deploy subdirectory
        const deployDir = resolve(profileDir, "deploy");
        if (!existsSync(deployDir)) {
            mkdirSync(deployDir, { recursive: true });
        }
    }

    /**
     * Lists all available profiles
     *
     * @returns Array of profile names
     */
    public listProfiles(): ProfileName[] {
        const profiles: ProfileName[] = ["default"];

        const profilesDir = resolve(this.baseDir, "profiles");
        if (existsSync(profilesDir)) {
            const entries = readdirSync(profilesDir, { withFileTypes: true });
            const profileDirs = entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name);
            profiles.push(...profileDirs);
        }

        return profiles;
    }

    /**
     * Checks if a profile exists
     *
     * @param profileName - Profile name to check
     * @returns True if profile exists, false otherwise
     */
    public profileExists(profileName: ProfileName): boolean {
        const profileDir = this.getProfileDir(profileName);
        return existsSync(profileDir);
    }

    /**
     * Reads configuration for a specific profile
     *
     * @param configType - Type of configuration to read
     * @param profileName - Profile name (defaults to "default")
     * @returns Parsed configuration object
     * @throws {Error} If file not found or validation fails
     */
    public readProfileConfig(configType: ConfigType, profileName: ProfileName = "default"): BaseConfig {
        const paths = this.getProfilePaths(profileName);
        let configPath: string;

        switch (configType) {
        case "user":
            configPath = paths.userConfig;
            break;
        case "derived":
            configPath = paths.derivedConfig;
            break;
        case "deploy":
            configPath = paths.deployConfig;
            break;
        default:
            throw new Error(`Unknown configuration type: ${configType}`);
        }

        // Check if file exists
        if (!existsSync(configPath)) {
            throw new Error(`Configuration file not found: ${configPath}`);
        }

        // Read and parse
        let fileContent: string;
        try {
            fileContent = readFileSync(configPath, "utf-8");
        } catch (error) {
            throw new Error(`Failed to read configuration file: ${configPath}. ${(error as Error).message}`);
        }

        let config: BaseConfig;
        try {
            config = JSON.parse(fileContent);
        } catch (error) {
            throw new Error(`Invalid JSON in configuration file: ${configPath}. ${(error as Error).message}`);
        }

        // Validate schema
        this.validateConfigSchema(config);

        return config;
    }

    /**
     * Writes configuration for a specific profile
     *
     * @param configType - Type of configuration to write
     * @param config - Configuration object to write
     * @param profileName - Profile name (defaults to "default")
     * @throws {Error} If validation fails or write operation fails
     */
    public writeProfileConfig(
        configType: ConfigType,
        config: BaseConfig,
        profileName: ProfileName = "default",
    ): void {
        // Validate configuration before writing
        this.validateConfigSchema(config);

        // Ensure profile directories exist
        this.ensureProfileDirectories(profileName);

        const paths = this.getProfilePaths(profileName);
        let configPath: string;

        switch (configType) {
        case "user":
            configPath = paths.userConfig;
            break;
        case "derived":
            configPath = paths.derivedConfig;
            break;
        case "deploy":
            configPath = paths.deployConfig;
            break;
        default:
            throw new Error(`Unknown configuration type: ${configType}`);
        }

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
        const tempPath = resolve(tmpdir(), `benchling-webhook-config-${Date.now()}.json`);
        const configJson = JSON.stringify(config, null, 4);

        try {
            writeFileSync(tempPath, configJson, "utf-8");

            // Atomic rename (with fallback for cross-device on Windows)
            try {
                renameSync(tempPath, configPath);
            } catch (renameError) {
                // Fall back to copy+delete for cross-device scenarios (Windows)
                copyFileSync(tempPath, configPath);
                unlinkSync(tempPath);
            }
        } catch (error) {
            throw new Error(`Failed to write configuration file: ${(error as Error).message}`);
        }
    }

    /**
     * Loads a complete profile with all configuration files
     *
     * @param profileName - Profile name (defaults to "default")
     * @returns Complete profile configuration
     */
    public loadProfile(profileName: ProfileName = "default"): ConfigProfile {
        const profile: ConfigProfile = {
            name: profileName,
        };

        const paths = this.getProfilePaths(profileName);

        // Load user config if exists
        if (existsSync(paths.userConfig)) {
            try {
                profile.user = this.readProfileConfig("user", profileName) as UserConfig;
            } catch (error) {
                // User config is optional
            }
        }

        // Load derived config if exists
        if (existsSync(paths.derivedConfig)) {
            try {
                profile.derived = this.readProfileConfig("derived", profileName) as DerivedConfig;
            } catch (error) {
                // Derived config is optional
            }
        }

        // Load deploy config if exists
        if (existsSync(paths.deployConfig)) {
            try {
                profile.deploy = this.readProfileConfig("deploy", profileName) as DeploymentConfig;
            } catch (error) {
                // Deploy config is optional
            }
        }

        return profile;
    }

    /**
     * Deletes a profile and all its configuration files
     *
     * WARNING: This is a destructive operation!
     *
     * @param profileName - Profile name to delete
     * @throws {Error} If attempting to delete the default profile or if deletion fails
     */
    public deleteProfile(profileName: ProfileName): void {
        if (profileName === "default") {
            throw new Error("Cannot delete the default profile");
        }

        const profileDir = this.getProfileDir(profileName);
        if (!existsSync(profileDir)) {
            throw new Error(`Profile does not exist: ${profileName}`);
        }

        // For safety, we'll require manual deletion
        throw new Error(
            `Profile deletion must be done manually. Profile directory: ${profileDir}`,
        );
    }
}
