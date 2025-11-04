/**
 * TypeScript Wrapper for Python XDG CLI
 *
 * Provides type-safe access to the Python XDG configuration CLI from TypeScript.
 * This ensures consistency by delegating all XDG operations to the Python implementation.
 *
 * @module lib/xdg-cli-wrapper
 */

import { execSync } from "child_process";
import * as path from "path";
import type { CompleteConfig, DerivedConfig, UserConfig, DeploymentConfig, ProfileName, ConfigType } from "./types/config";

/**
 * CLI execution options
 */
interface CLIOptions {
    profile?: ProfileName;
    type?: ConfigType;
    validate?: boolean;
    backup?: boolean;
    pretty?: boolean;
    verbose?: boolean;
}

/**
 * Base class for XDG CLI errors
 */
export class XDGCLIError extends Error {
    constructor(
        message: string,
        public readonly command: string,
        public readonly exitCode: number,
        public readonly stderr: string,
    ) {
        super(message);
        this.name = "XDGCLIError";
    }
}

/**
 * Get the path to the Python CLI script
 */
function getCLIPath(): string {
    return path.join(__dirname, "..", "docker", "scripts", "benchling-webhook-config");
}

/**
 * Execute Python CLI command
 */
function executeCLI(args: string[], options: { captureStdout?: boolean; verbose?: boolean } = {}): string {
    const cliPath = getCLIPath();
    const command = `python3 ${cliPath} ${args.join(" ")}`;

    try {
        const result = execSync(command, {
            encoding: "utf-8",
            stdio: options.captureStdout ? "pipe" : ["pipe", "pipe", "inherit"],
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });
        return result;
    } catch (error: unknown) {
        const err = error as { stderr?: Buffer | string; message?: string; status?: number };
        const stderr = err.stderr?.toString() || err.message || "Unknown error";
        const exitCode = err.status || 1;

        throw new XDGCLIError(`XDG CLI command failed: ${command}`, command, exitCode, stderr);
    }
}

/**
 * XDG CLI Wrapper Class
 *
 * Provides TypeScript interface to Python XDG CLI operations.
 */
export class XDGCLIWrapper {
    /**
     * Read configuration from XDG storage
     *
     * @param options - Read options
     * @returns Configuration data
     */
    static read<T = UserConfig>(options: CLIOptions = {}): T {
        const args = ["read"];

        if (options.profile) {
            args.push("--profile", options.profile);
        }
        if (options.type) {
            args.push("--type", options.type);
        }
        if (options.validate) {
            args.push("--validate");
        }
        args.push("--compact"); // Always use compact for parsing

        const output = executeCLI(args, { captureStdout: true, verbose: options.verbose });
        return JSON.parse(output) as T;
    }

    /**
     * Write configuration to XDG storage
     *
     * @param data - Configuration data to write
     * @param options - Write options
     */
    static write(data: Record<string, unknown>, options: CLIOptions = {}): void {
        const args = ["write", JSON.stringify(data)];

        if (options.profile) {
            args.push("--profile", options.profile);
        }
        if (options.type) {
            args.push("--type", options.type);
        }
        if (options.validate !== false) {
            args.push("--validate");
        }
        if (options.backup !== false) {
            args.push("--backup");
        }

        executeCLI(args, { verbose: options.verbose });
    }

    /**
     * Merge data into existing configuration
     *
     * @param data - Data to merge
     * @param options - Merge options
     */
    static merge(data: Record<string, unknown>, options: CLIOptions = {}): void {
        const args = ["merge", JSON.stringify(data)];

        if (options.profile) {
            args.push("--profile", options.profile);
        }
        if (options.type) {
            args.push("--type", options.type);
        }
        if (options.validate !== false) {
            args.push("--validate");
        }
        if (options.backup !== false) {
            args.push("--backup");
        }

        executeCLI(args, { verbose: options.verbose });
    }

    /**
     * Validate configuration against schema
     *
     * @param options - Validation options
     * @returns True if valid, false otherwise
     */
    static validate(options: CLIOptions = {}): boolean {
        const args = ["validate"];

        if (options.profile) {
            args.push("--profile", options.profile);
        }
        if (options.type) {
            args.push("--type", options.type);
        }

        try {
            executeCLI(args, { verbose: options.verbose });
            return true;
        } catch (error) {
            if (error instanceof XDGCLIError) {
                return false;
            }
            throw error;
        }
    }

    /**
     * List all available profiles
     *
     * @returns Array of profile names
     */
    static listProfiles(): ProfileName[] {
        const output = executeCLI(["list"], { captureStdout: true });
        // Parse output: "Available profiles:\n  default\n  dev\n..."
        const lines = output.split("\n").filter((line) => line.trim() && !line.includes("Available profiles"));
        return lines.map((line) => line.trim().split(/\s+/)[0]);
    }

    /**
     * Export configuration as JSON
     *
     * @param options - Export options
     * @returns Configuration data
     */
    static export<T = CompleteConfig>(options: CLIOptions = {}): T {
        const args = ["export"];

        if (options.profile) {
            args.push("--profile", options.profile);
        }
        if (options.type) {
            args.push("--type", options.type);
        }
        args.push("--compact");

        const output = executeCLI(args, { captureStdout: true, verbose: options.verbose });
        return JSON.parse(output) as T;
    }

    /**
     * Get a specific configuration field value
     *
     * @param key - Field key (supports dot notation)
     * @param options - Get options
     * @returns Field value
     */
    static get(key: string, options: CLIOptions & { default?: string } = {}): unknown {
        const args = ["get", key];

        if (options.profile) {
            args.push("--profile", options.profile);
        }
        if (options.type) {
            args.push("--type", options.type);
        }
        if (options.default) {
            args.push("--default", options.default);
        }

        const output = executeCLI(args, { captureStdout: true, verbose: options.verbose });

        // Try to parse as JSON, otherwise return as string
        try {
            return JSON.parse(output.trim());
        } catch {
            return output.trim();
        }
    }

    /**
     * Set a specific configuration field value
     *
     * @param key - Field key (supports dot notation)
     * @param value - Value to set
     * @param options - Set options
     */
    static set(key: string, value: unknown, options: CLIOptions = {}): void {
        const isObject = typeof value === "object";
        const args = ["set", key, isObject ? JSON.stringify(value) : String(value)];

        if (options.profile) {
            args.push("--profile", options.profile);
        }
        if (options.type) {
            args.push("--type", options.type);
        }
        if (isObject) {
            args.push("--json");
        }
        if (options.backup !== false) {
            args.push("--backup");
        }

        executeCLI(args, { verbose: options.verbose });
    }

    /**
     * Read user configuration
     */
    static readUser(profile: ProfileName = "default"): UserConfig {
        return this.read<UserConfig>({ profile, type: "user" });
    }

    /**
     * Read derived configuration
     */
    static readDerived(profile: ProfileName = "default"): DerivedConfig {
        return this.read<DerivedConfig>({ profile, type: "derived" });
    }

    /**
     * Read deployment configuration
     */
    static readDeploy(profile: ProfileName = "default"): DeploymentConfig {
        return this.read<DeploymentConfig>({ profile, type: "deploy" });
    }

    /**
     * Read complete merged configuration
     */
    static readComplete(profile: ProfileName = "default"): CompleteConfig {
        return this.export<CompleteConfig>({ profile, type: "complete" });
    }
}
