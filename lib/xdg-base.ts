/**
 * XDG Base Abstract Class (v0.7.0)
 *
 * Abstract base class containing all shared business logic for configuration management.
 * Concrete implementations (XDGConfig, XDGTest) provide storage primitives.
 *
 * This separation allows:
 * - Shared validation, inheritance, and error handling logic in one place
 * - Multiple storage backends (filesystem, in-memory) with identical behavior
 * - Better test coverage by exercising business logic through both implementations
 *
 * @module xdg-base
 * @version 0.7.0
 */

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
import { IConfigStorage } from "./interfaces/config-storage";

/**
 * Abstract base class for XDG configuration management
 *
 * Implements IConfigStorage interface with all business logic.
 * Subclasses must implement abstract storage primitives for their specific storage mechanism.
 *
 * @abstract
 * @example
 * ```typescript
 * // Filesystem implementation
 * class XDGConfig extends XDGBase {
 *   protected readProfileRaw(profile: string): ProfileConfig {
 *     const data = readFileSync(this.getProfilePath(profile), "utf-8");
 *     return JSON.parse(data);
 *   }
 *   // ... other primitives
 * }
 *
 * // In-memory implementation
 * class XDGTest extends XDGBase {
 *   private profiles = new Map<string, ProfileConfig>();
 *   protected readProfileRaw(profile: string): ProfileConfig {
 *     const config = this.profiles.get(profile);
 *     if (!config) throw new Error(`Profile not found: ${profile}`);
 *     return config;
 *   }
 *   // ... other primitives
 * }
 * ```
 */
export abstract class XDGBase implements IConfigStorage {
    // ====================================================================
    // Abstract Storage Primitives (implemented by subclasses)
    // ====================================================================

    /**
     * Reads raw profile configuration without validation
     *
     * @param profile - Profile name
     * @returns Raw profile configuration
     * @throws {Error} If profile cannot be read
     */
    protected abstract readProfileRaw(profile: string): ProfileConfig;

    /**
     * Writes raw profile configuration without validation
     *
     * @param profile - Profile name
     * @param config - Configuration to write
     * @throws {Error} If write fails
     */
    protected abstract writeProfileRaw(profile: string, config: ProfileConfig): void;

    /**
     * Deletes profile and all associated data
     *
     * @param profile - Profile name
     * @throws {Error} If deletion fails
     */
    protected abstract deleteProfileRaw(profile: string): void;

    /**
     * Lists all profile names
     *
     * @returns Array of profile names
     */
    protected abstract listProfilesRaw(): string[];

    /**
     * Checks if profile exists
     *
     * @param profile - Profile name
     * @returns True if profile exists
     */
    protected abstract profileExistsRaw(profile: string): boolean;

    /**
     * Reads raw deployment history without validation
     *
     * @param profile - Profile name
     * @returns Deployment history or null if none exists
     * @throws {Error} If read fails
     */
    protected abstract readDeploymentsRaw(profile: string): DeploymentHistory | null;

    /**
     * Writes raw deployment history without validation
     *
     * @param profile - Profile name
     * @param history - Deployment history to write
     * @throws {Error} If write fails
     */
    protected abstract writeDeploymentsRaw(profile: string, history: DeploymentHistory): void;

    // ====================================================================
    // Configuration Management (Public API with Business Logic)
    // ====================================================================

    /**
     * Reads configuration for a profile with validation
     *
     * @param profile - Profile name (e.g., "default", "dev", "prod")
     * @returns Validated configuration object
     * @throws {Error} If profile not found or configuration is invalid
     *
     * @example
     * ```typescript
     * const config = storage.readProfile("default");
     * console.log(config.benchling.tenant);
     * ```
     */
    public readProfile(profile: string): ProfileConfig {
        if (!this.profileExistsRaw(profile)) {
            throw new Error(this.buildProfileNotFoundError(profile));
        }

        let config: ProfileConfig;
        try {
            config = this.readProfileRaw(profile);
        } catch (error) {
            throw new Error(`Failed to read profile "${profile}": ${(error as Error).message}`);
        }

        // Validate schema - WARN instead of ERROR to allow migration from older schemas
        const validation = this.validateProfile(config);
        if (!validation.isValid) {
            console.warn(`Warning: Configuration for profile "${profile}" has validation issues:`);
            validation.errors.forEach((err) => console.warn(`  - ${err}`));
            console.warn("The configuration will still be loaded to allow migration. Please run setup again to fix these issues.\n");
        }

        return config;
    }

    /**
     * Writes configuration for a profile with validation
     *
     * Creates the profile if it doesn't exist.
     *
     * @param profile - Profile name
     * @param config - Configuration object to write
     * @throws {Error} If validation fails or write operation fails
     *
     * @example
     * ```typescript
     * storage.writeProfile("default", {
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

        try {
            this.writeProfileRaw(profile, config);
        } catch (error) {
            throw new Error(`Failed to write profile "${profile}": ${(error as Error).message}`);
        }
    }

    /**
     * Deletes a profile and all its data
     *
     * WARNING: This is a destructive operation!
     * Cannot delete the "default" profile.
     *
     * @param profile - Profile name to delete
     * @throws {Error} If attempting to delete default profile or if deletion fails
     *
     * @example
     * ```typescript
     * storage.deleteProfile("dev");
     * ```
     */
    public deleteProfile(profile: string): void {
        if (profile === "default") {
            throw new Error("Cannot delete the default profile");
        }

        if (!this.profileExistsRaw(profile)) {
            throw new Error(`Profile does not exist: ${profile}`);
        }

        try {
            this.deleteProfileRaw(profile);
        } catch (error) {
            throw new Error(`Failed to delete profile "${profile}": ${(error as Error).message}`);
        }
    }

    /**
     * Lists all available profiles
     *
     * @returns Array of profile names
     *
     * @example
     * ```typescript
     * const profiles = storage.listProfiles();
     * console.log(profiles); // ["default", "dev", "prod"]
     * ```
     */
    public listProfiles(): string[] {
        return this.listProfilesRaw();
    }

    /**
     * Checks if a profile exists
     *
     * @param profile - Profile name to check
     * @returns True if profile exists and has valid configuration, false otherwise
     *
     * @example
     * ```typescript
     * if (storage.profileExists("dev")) {
     *   const config = storage.readProfile("dev");
     * }
     * ```
     */
    public profileExists(profile: string): boolean {
        return this.profileExistsRaw(profile);
    }

    // ====================================================================
    // Deployment Tracking (Public API with Business Logic)
    // ====================================================================

    /**
     * Gets deployment history for a profile with validation
     *
     * Returns empty history if deployments don't exist.
     *
     * @param profile - Profile name
     * @returns Deployment history with active deployments and full history
     *
     * @example
     * ```typescript
     * const deployments = storage.getDeployments("default");
     * console.log(deployments.active["prod"]); // Active prod deployment
     * console.log(deployments.history[0]); // Most recent deployment
     * ```
     */
    public getDeployments(profile: string): DeploymentHistory {
        let deployments: DeploymentHistory | null;
        try {
            deployments = this.readDeploymentsRaw(profile);
        } catch (error) {
            throw new Error(`Failed to read deployments for profile "${profile}": ${(error as Error).message}`);
        }

        // Return empty history if none exists
        if (!deployments) {
            return {
                active: {},
                history: [],
            };
        }

        // Validate schema
        const ajv = new Ajv();
        addFormats(ajv);
        const validate = ajv.compile(DeploymentHistorySchema);
        const valid = validate(deployments);

        if (!valid) {
            const errors = validate.errors?.map((err) => `${err.instancePath} ${err.message}`).join(", ");
            throw new Error(`Invalid deployment history schema for profile "${profile}": ${errors}`);
        }

        return deployments;
    }

    /**
     * Records a new deployment for a profile
     *
     * Adds deployment to history and updates active deployment for the stage.
     * Creates deployment history if it doesn't exist.
     *
     * @param profile - Profile name
     * @param deployment - Deployment record to add
     *
     * @example
     * ```typescript
     * storage.recordDeployment("default", {
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
        // Load existing deployments or create new
        let deployments: DeploymentHistory;
        try {
            deployments = this.getDeployments(profile);
        } catch (error) {
            // If getDeployments fails, start with empty history
            console.warn(`Warning: Could not read deployment history: ${(error as Error).message}`);
            console.warn("Starting with empty deployment history (previous deployments not preserved).\n");
            deployments = {
                active: {},
                history: [],
            };
        }

        // Add to history (newest first)
        deployments.history.unshift(deployment);

        // Update active deployment for this stage
        deployments.active[deployment.stage] = deployment;

        // Write deployments
        try {
            this.writeDeploymentsRaw(profile, deployments);
        } catch (error) {
            throw new Error(`Failed to record deployment for profile "${profile}": ${(error as Error).message}`);
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
     * const prodDeployment = storage.getActiveDeployment("default", "prod");
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
    // Profile Inheritance (Business Logic)
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
     * const devConfig = storage.readProfileWithInheritance("dev");
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
    // Validation (Business Logic)
    // ====================================================================

    /**
     * Validates a profile configuration against the schema
     *
     * @param config - Configuration object to validate
     * @returns Validation result with errors and warnings
     *
     * @example
     * ```typescript
     * const validation = storage.validateProfile(config);
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
    // Error Messages (Business Logic)
    // ====================================================================

    /**
     * Builds a helpful error message when a profile is not found
     *
     * Subclasses can override this to add storage-specific detection
     * (e.g., legacy file detection for filesystem storage).
     *
     * @param profile - Profile name that was not found
     * @returns Formatted error message
     */
    protected buildProfileNotFoundError(profile: string): string {
        return `
Profile not found: ${profile}

No configuration found for profile: ${profile}

Run setup wizard to create configuration:
  npx @quiltdata/benchling-webhook@latest setup

Available profiles: ${this.listProfiles().join(", ") || "(none)"}
        `.trim();
    }
}
