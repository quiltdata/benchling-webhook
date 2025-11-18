/**
 * Mock Configuration Storage (In-Memory)
 *
 * This mock implementation stores configuration in memory instead of the filesystem.
 * Perfect for testing without touching the real XDG config directory.
 */

import merge from "lodash.merge";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
    ProfileConfig,
    DeploymentHistory,
    DeploymentRecord,
    ValidationResult,
    ProfileConfigSchema,
} from "../../lib/types/config";
import { IConfigStorage } from "../../lib/interfaces/config-storage";

/**
 * Mock configuration storage that keeps everything in memory
 */
export class MockConfigStorage implements IConfigStorage {
    private profiles: Map<string, ProfileConfig> = new Map();
    private deployments: Map<string, DeploymentHistory> = new Map();

    /**
     * Clears all stored data (useful for test cleanup)
     */
    public clear(): void {
        this.profiles.clear();
        this.deployments.clear();
    }

    public readProfile(profile: string): ProfileConfig {
        const config = this.profiles.get(profile);
        if (!config) {
            throw new Error(this.buildProfileNotFoundError(profile));
        }

        // Validate schema - WARN instead of ERROR to allow migration from older schemas
        const validation = this.validateProfile(config);
        if (!validation.isValid) {
            console.warn(`Warning: Configuration for profile "${profile}" has validation issues:`);
            validation.errors.forEach((err) => console.warn(`  - ${err}`));
            console.warn("The configuration will still be loaded to allow migration. Please run setup again to fix these issues.\n");
        }

        // Return a deep copy to prevent mutations
        return JSON.parse(JSON.stringify(config));
    }

    public writeProfile(profile: string, config: ProfileConfig): void {
        // Validate configuration before writing
        const validation = this.validateProfile(config);
        if (!validation.isValid) {
            throw new Error(`Invalid configuration:\n${validation.errors.join("\n")}`);
        }

        // Store a deep copy to prevent external mutations
        this.profiles.set(profile, JSON.parse(JSON.stringify(config)));
    }

    public deleteProfile(profile: string): void {
        if (profile === "default") {
            throw new Error("Cannot delete the default profile");
        }

        if (!this.profiles.has(profile)) {
            throw new Error(`Profile does not exist: ${profile}`);
        }

        this.profiles.delete(profile);
        this.deployments.delete(profile);
    }

    public listProfiles(): string[] {
        return Array.from(this.profiles.keys()).sort();
    }

    public profileExists(profile: string): boolean {
        return this.profiles.has(profile);
    }

    public getDeployments(profile: string): DeploymentHistory {
        const history = this.deployments.get(profile);
        if (!history) {
            return {
                active: {},
                history: [],
            };
        }

        // Return a deep copy
        return JSON.parse(JSON.stringify(history));
    }

    public recordDeployment(profile: string, deployment: DeploymentRecord): void {
        let history = this.deployments.get(profile);
        if (!history) {
            history = {
                active: {},
                history: [],
            };
        }

        // Add to history (newest first)
        history.history.unshift(deployment);

        // Update active deployment for this stage
        history.active[deployment.stage] = deployment;

        // Store updated history
        this.deployments.set(profile, history);
    }

    public getActiveDeployment(profile: string, stage: string): DeploymentRecord | null {
        try {
            const deployments = this.getDeployments(profile);
            return deployments.active[stage] || null;
        } catch {
            return null;
        }
    }

    public readProfileWithInheritance(profile: string, baseProfile?: string): ProfileConfig {
        const visited = new Set<string>();
        return this.readProfileWithInheritanceInternal(profile, baseProfile, visited);
    }

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

    private deepMergeConfigs(base: ProfileConfig, current: ProfileConfig): ProfileConfig {
        return merge({}, base, current);
    }

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

    private buildProfileNotFoundError(profile: string): string {
        return `
Profile not found: ${profile}

No configuration found for profile: ${profile}

Run setup wizard to create configuration:
  npx @quiltdata/benchling-webhook@latest setup

Available profiles: ${this.listProfiles().join(", ") || "(none)"}
        `.trim();
    }
}
