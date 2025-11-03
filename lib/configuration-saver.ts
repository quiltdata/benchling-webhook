import { XDGConfig } from "./xdg-config";
import merge from "lodash.merge";

/**
 * Configuration metadata
 */
export interface ConfigMetadata {
    savedAt: string;
    source: string;
    version?: string;
    inferredAt?: string;
}

/**
 * Save options for configuration persistence
 */
export interface SaveOptions {
    xdgConfig?: XDGConfig;
    source?: string;
    skipValidation?: boolean;
    merge?: boolean;
}

/**
 * Configuration saver for persisting configuration to XDG files
 */
export class ConfigurationSaver {
    /**
     * Default XDG config instance
     */
    private static defaultXDGConfig: XDGConfig | null = null;

    /**
     * Get or create default XDG config instance
     */
    private static getDefaultXDGConfig(): XDGConfig {
        if (!ConfigurationSaver.defaultXDGConfig) {
            ConfigurationSaver.defaultXDGConfig = new XDGConfig();
            ConfigurationSaver.defaultXDGConfig.ensureDirectories();
        }
        return ConfigurationSaver.defaultXDGConfig;
    }

    /**
     * Save configuration to user config file
     *
     * @param config - Configuration to save
     * @param options - Save options
     * @returns Saved configuration with metadata
     */
    public static async save(
        config: Record<string, string | number | boolean>,
        options: SaveOptions = {},
    ): Promise<Record<string, string | number | boolean>> {
        const {
            xdgConfig = ConfigurationSaver.getDefaultXDGConfig(),
            source = "wizard",
            skipValidation = false,
            merge: shouldMerge = false,
        } = options;

        // Validate configuration if not skipped
        if (!skipValidation) {
            ConfigurationSaver.validateConfig(config);
        }

        // Merge with existing config if requested
        let finalConfig = { ...config };
        if (shouldMerge) {
            try {
                const existingConfig = xdgConfig.readConfig("user");
                finalConfig = merge({}, existingConfig, config);
            } catch {
                // If no existing config, just use the new config
                finalConfig = { ...config };
            }
        }

        // Add metadata
        const metadata = ConfigurationSaver.getMetadata({ source });
        const configWithMetadata = {
            ...finalConfig,
            _metadata: metadata,
        };

        // Save to user config
        xdgConfig.writeConfig("user", configWithMetadata);

        // If source indicates inference, also save to derived config
        if (source === "quilt-cli" || source === "inference") {
            await ConfigurationSaver.saveToDerived(config, {
                xdgConfig,
                source,
            });
        }

        return finalConfig;
    }

    /**
     * Save inferred configuration to derived config file
     *
     * @param config - Inferred configuration
     * @param options - Save options
     */
    public static async saveToDerived(
        config: Record<string, string | number | boolean>,
        options: SaveOptions = {},
    ): Promise<void> {
        const {
            xdgConfig = ConfigurationSaver.getDefaultXDGConfig(),
            source = "inferred",
        } = options;

        // Add inference metadata
        const metadata = ConfigurationSaver.getMetadata({
            source,
            inferredAt: new Date().toISOString(),
        });

        const configWithMetadata = {
            ...config,
            _metadata: metadata,
        };

        // Save to derived config
        xdgConfig.writeConfig("derived", configWithMetadata);
    }

    /**
     * Save deployment outputs to deployment config file
     *
     * @param config - Deployment configuration
     * @param options - Save options
     */
    public static async saveToDeployment(
        config: Record<string, string | number | boolean>,
        options: SaveOptions = {},
    ): Promise<void> {
        const {
            xdgConfig = ConfigurationSaver.getDefaultXDGConfig(),
            source = "deployment",
        } = options;

        // Add deployment metadata
        const metadata = ConfigurationSaver.getMetadata({ source });

        const configWithMetadata = {
            ...config,
            _metadata: metadata,
        };

        // Save to deployment config
        xdgConfig.writeConfig("deploy", configWithMetadata);
    }

    /**
     * Create metadata for configuration
     *
     * @param options - Metadata options
     * @returns Configuration metadata
     */
    public static getMetadata(options: Partial<ConfigMetadata> = {}): ConfigMetadata {
        return {
            savedAt: new Date().toISOString(),
            source: options.source || "unknown",
            version: ConfigurationSaver.getVersion(),
            ...(options.inferredAt && { inferredAt: options.inferredAt }),
        };
    }

    /**
     * Get the current version
     *
     * @returns Version string
     */
    private static getVersion(): string {
        // For now, return a static version
        // In production, this would read from package.json
        return "0.6.0";
    }

    /**
     * Validate configuration before saving
     *
     * @param config - Configuration to validate
     * @throws {Error} If configuration is invalid
     */
    private static validateConfig(config: Record<string, string | number | boolean>): void {
        // Check if config is empty
        if (Object.keys(config).length === 0) {
            throw new Error("Configuration validation failed: Configuration cannot be empty");
        }

        // Basic validation passed
    }
}
