/**
 * Configuration Storage Interface
 *
 * This interface abstracts the storage mechanism for configuration,
 * allowing tests to use in-memory implementations instead of the filesystem.
 */

import {
    ProfileConfig,
    DeploymentHistory,
    DeploymentRecord,
    ValidationResult,
} from "../types/config";

/**
 * Interface for configuration storage operations
 *
 * This abstraction allows for multiple implementations:
 * - XDGConfigStorage: Real filesystem-based storage (production)
 * - MockConfigStorage: In-memory storage (testing)
 */
export interface IConfigStorage {
    /**
     * Reads configuration for a profile
     * @param profile - Profile name
     * @returns Parsed configuration object
     * @throws {Error} If profile not found or configuration is invalid
     */
    readProfile(profile: string): ProfileConfig;

    /**
     * Writes configuration for a profile
     * @param profile - Profile name
     * @param config - Configuration object to write
     * @throws {Error} If validation fails or write operation fails
     */
    writeProfile(profile: string, config: ProfileConfig): void;

    /**
     * Deletes a profile and all its files
     * @param profile - Profile name to delete
     * @throws {Error} If attempting to delete default profile or if deletion fails
     */
    deleteProfile(profile: string): void;

    /**
     * Lists all available profiles
     * @returns Array of profile names
     */
    listProfiles(): string[];

    /**
     * Checks if a profile exists
     * @param profile - Profile name to check
     * @returns True if profile exists, false otherwise
     */
    profileExists(profile: string): boolean;

    /**
     * Gets deployment history for a profile
     * @param profile - Profile name
     * @returns Deployment history with active deployments and full history
     */
    getDeployments(profile: string): DeploymentHistory;

    /**
     * Records a new deployment for a profile
     * @param profile - Profile name
     * @param deployment - Deployment record to add
     */
    recordDeployment(profile: string, deployment: DeploymentRecord): void;

    /**
     * Gets the active deployment for a specific stage
     * @param profile - Profile name
     * @param stage - Stage name (e.g., "dev", "prod")
     * @returns Active deployment record for the stage, or null if none exists
     */
    getActiveDeployment(profile: string, stage: string): DeploymentRecord | null;

    /**
     * Reads profile configuration with inheritance support
     * @param profile - Profile name to read
     * @param baseProfile - Optional explicit base profile
     * @returns Merged configuration with inheritance applied
     */
    readProfileWithInheritance(profile: string, baseProfile?: string): ProfileConfig;

    /**
     * Validates a profile configuration against the schema
     * @param config - Configuration object to validate
     * @returns Validation result with errors and warnings
     */
    validateProfile(config: ProfileConfig): ValidationResult;
}
