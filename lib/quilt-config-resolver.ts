/**
 * Quilt Configuration Resolver
 *
 * Automatically infers Quilt configuration from the quilt3 CLI.
 * Extracts catalog URL, S3 bucket, and region information.
 *
 * @module quilt-config-resolver
 */

import { execSync } from "child_process";

/**
 * Quilt configuration structure
 */
export interface QuiltConfig {
    catalogUrl?: string;
    userBucket?: string;
    defaultRegion?: string;
}

/**
 * Quilt Configuration Resolver
 *
 * Resolves Quilt configuration from the quilt3 CLI or user overrides.
 */
export class QuiltConfigResolver {
    /**
     * Resolves Quilt configuration with optional manual overrides
     *
     * @param manualConfig - Optional manual configuration overrides
     * @returns Resolved Quilt configuration
     */
    public static async resolve(manualConfig?: Partial<QuiltConfig>): Promise<QuiltConfig> {
        const resolver = new QuiltConfigResolver();

        // If manual config is provided, return it
        if (manualConfig) {
            return {
                catalogUrl: manualConfig.catalogUrl,
                userBucket: manualConfig.userBucket,
                defaultRegion: manualConfig.defaultRegion,
            };
        }

        // Try to infer from quilt3 CLI
        try {
            return await resolver.resolveFromQuilt3();
        } catch (error) {
            throw new Error(`Quilt configuration not found: ${(error as Error).message}`);
        }
    }

    /**
     * Resolves configuration from quilt3 CLI
     *
     * @returns Resolved Quilt configuration
     * @throws {Error} If quilt3 is not installed or configured
     */
    public async resolveFromQuilt3(): Promise<QuiltConfig> {
        return this.resolveWithCommand("quilt3 config");
    }

    /**
     * Resolves configuration using a custom command
     *
     * @param command - Command to execute
     * @returns Resolved Quilt configuration
     * @throws {Error} If command fails
     */
    public async resolveWithCommand(command: string): Promise<QuiltConfig> {
        try {
            const output = execSync(command, {
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
            }).trim();

            return this.parseQuilt3Config(output);
        } catch (error) {
            throw new Error(`Failed to execute command: ${command}. ${(error as Error).message}`);
        }
    }

    /**
     * Parses quilt3 config output
     *
     * @param output - Raw output from quilt3 config command
     * @returns Parsed Quilt configuration
     */
    public parseQuilt3Config(output: string): QuiltConfig {
        if (!output) {
            throw new Error("Empty quilt3 config output");
        }

        // quilt3 config returns the full URL (e.g., https://nightly.quilttest.com)
        // We want just the domain
        let catalogUrl = output.trim();

        // Remove protocol if present
        if (catalogUrl.startsWith("http://") || catalogUrl.startsWith("https://")) {
            try {
                const url = new URL(catalogUrl);
                catalogUrl = url.hostname;
            } catch {
                // If URL parsing fails, use as-is
            }
        }

        return {
            catalogUrl,
        };
    }
}
