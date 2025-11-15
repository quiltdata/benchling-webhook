/**
 * XDG Test Implementation (In-Memory)
 *
 * In-memory implementation of XDGBase for testing without filesystem I/O.
 * Perfect for testing configuration logic in isolation without touching the real XDG config directory.
 *
 * This implementation stores all configuration data in memory using Maps.
 * All business logic (validation, inheritance, deployment tracking) is handled by XDGBase.
 *
 * @module xdg-test
 * @version 0.7.0
 */

import { ProfileConfig, DeploymentHistory } from "../../lib/types/config";
import { XDGBase } from "../../lib/xdg-base";

/**
 * In-memory XDG configuration storage for testing
 *
 * Extends XDGBase with Map-based storage primitives.
 * All business logic is inherited from XDGBase, ensuring identical behavior
 * to the production filesystem implementation.
 *
 * @example
 * ```typescript
 * const storage = new XDGTest();
 *
 * // Write and read profiles
 * storage.writeProfile("test", config);
 * const read = storage.readProfile("test");
 *
 * // Clear all data after test
 * storage.clear();
 * ```
 */
export class XDGTest extends XDGBase {
    private profiles: Map<string, ProfileConfig> = new Map();
    private deployments: Map<string, DeploymentHistory> = new Map();

    /**
     * Clears all stored data (useful for test cleanup)
     *
     * @example
     * ```typescript
     * afterEach(() => {
     *   storage.clear();
     * });
     * ```
     */
    public clear(): void {
        this.profiles.clear();
        this.deployments.clear();
    }

    // ====================================================================
    // Abstract Storage Primitives Implementation (In-Memory)
    // ====================================================================

    /**
     * Reads raw profile configuration from memory without validation
     *
     * @param profile - Profile name
     * @returns Raw profile configuration (deep copy)
     * @throws {Error} If profile not found
     */
    protected readProfileRaw(profile: string): ProfileConfig {
        const config = this.profiles.get(profile);
        if (!config) {
            throw new Error(`Profile not found: ${profile}`);
        }

        // Return a deep copy to prevent mutations
        return JSON.parse(JSON.stringify(config));
    }

    /**
     * Writes raw profile configuration to memory without validation
     *
     * @param profile - Profile name
     * @param config - Configuration to write
     */
    protected writeProfileRaw(profile: string, config: ProfileConfig): void {
        // Store a deep copy to prevent external mutations
        this.profiles.set(profile, JSON.parse(JSON.stringify(config)));
    }

    /**
     * Deletes profile and all associated data from memory
     *
     * @param profile - Profile name
     */
    protected deleteProfileRaw(profile: string): void {
        this.profiles.delete(profile);
        this.deployments.delete(profile);
    }

    /**
     * Lists all profile names from memory
     *
     * @returns Array of profile names (sorted)
     */
    protected listProfilesRaw(): string[] {
        return Array.from(this.profiles.keys()).sort();
    }

    /**
     * Checks if profile exists in memory
     *
     * @param profile - Profile name
     * @returns True if profile exists
     */
    protected profileExistsRaw(profile: string): boolean {
        return this.profiles.has(profile);
    }

    /**
     * Reads raw deployment history from memory without validation
     *
     * @param profile - Profile name
     * @returns Deployment history or null if none exists
     */
    protected readDeploymentsRaw(profile: string): DeploymentHistory | null {
        const history = this.deployments.get(profile);
        if (!history) {
            return null;
        }

        // Return a deep copy
        return JSON.parse(JSON.stringify(history));
    }

    /**
     * Writes raw deployment history to memory without validation
     *
     * @param profile - Profile name
     * @param history - Deployment history to write
     */
    protected writeDeploymentsRaw(profile: string, history: DeploymentHistory): void {
        // Store a deep copy to prevent external mutations
        this.deployments.set(profile, JSON.parse(JSON.stringify(history)));
    }
}
