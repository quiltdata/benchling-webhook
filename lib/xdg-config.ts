/**
 * XDG Configuration Management
 *
 * Provides XDG-compliant configuration file management for the Benchling Webhook system.
 * Implements a three-file configuration model:
 * - User configuration: User-provided default settings
 * - Derived configuration: CLI-inferred configuration
 * - Deployment configuration: Deployment-specific artifacts
 *
 * @module xdg-config
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import Ajv from "ajv";

/**
 * Configuration file paths for XDG-compliant storage
 */
export interface XDGConfigPaths {
    userConfig: string;
    derivedConfig: string;
    deployConfig: string;
}

/**
 * Configuration type identifier
 */
export type ConfigType = "user" | "derived" | "deploy";

/**
 * Base configuration structure
 */
export interface BaseConfig {
    [key: string]: unknown;
}

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
        enableWebhookVerification: { type: "string" },
        createEcrRepository: { type: "string" },
        ecrRepositoryName: { type: "string" },
        imageTag: { type: "string" },
        webhookUrl: { type: "string" },
        deploymentTimestamp: { type: "string" },
        stackArn: { type: "string" },
    },
    additionalProperties: false,
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
}
