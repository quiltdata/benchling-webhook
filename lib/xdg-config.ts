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

import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

/**
 * Configuration file paths for XDG-compliant storage
 */
export interface XDGConfigPaths {
    userConfig: string;
    derivedConfig: string;
    deployConfig: string;
}

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
}
