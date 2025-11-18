import { XDGConfig } from "./xdg-config";
import { ProfileConfig } from "./types/config";
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
    merge?: boolean;
    profile?: string;
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
        }
        return ConfigurationSaver.defaultXDGConfig;
    }

    /**
     * Save configuration to profile
     *
     * @param config - Configuration to save
     * @param options - Save options
     * @returns Saved configuration with metadata
     */
    public static async save(
        config: Partial<ProfileConfig>,
        options: SaveOptions = {},
    ): Promise<ProfileConfig> {
        const {
            xdgConfig = ConfigurationSaver.getDefaultXDGConfig(),
            source = "wizard",
            merge: shouldMerge = false,
            profile = "default",
        } = options;

        // Merge with existing config if requested
        let finalConfig = { ...config };
        if (shouldMerge && xdgConfig.profileExists(profile)) {
            try {
                const existingConfig = xdgConfig.readProfile(profile);
                finalConfig = merge({}, existingConfig, config);
            } catch (error) {
                // If no existing config, just use the new config
                console.warn(`Warning: Could not read existing configuration for merge: ${(error as Error).message}`);
                console.warn("Using new configuration only (existing config not merged).\n");
                finalConfig = { ...config };
            }
        }

        // Add metadata
        const metadata = ConfigurationSaver.getMetadata({ source });
        const configWithMetadata: ProfileConfig = {
            ...finalConfig,
            _metadata: {
                version: metadata.version || "0.7.0",
                createdAt: finalConfig._metadata?.createdAt || metadata.savedAt,
                updatedAt: metadata.savedAt,
                source: source as "wizard" | "manual" | "cli",
            },
        } as ProfileConfig;

        // Save to profile
        xdgConfig.writeProfile(profile, configWithMetadata);

        return configWithMetadata;
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
        return "0.7.0";
    }
}
