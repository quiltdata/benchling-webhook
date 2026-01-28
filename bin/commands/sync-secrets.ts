#!/usr/bin/env node
/**
 * AWS Secrets Manager Integration
 *
 * Synchronizes configuration to AWS Secrets Manager with:
 * - Mode-aware secret management (integrated vs standalone)
 * - Consistent secret naming conventions
 * - AWS profile selection support
 * - Atomic secret creation/update operations
 * - ARN tracking in XDG configuration
 *
 * @module commands/sync-secrets
 */

import {
    SecretsManagerClient,
    CreateSecretCommand,
    UpdateSecretCommand,
    GetSecretValueCommand,
    DescribeSecretCommand,
    ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { fromIni } from "@aws-sdk/credential-providers";
import { XDGConfig } from "../../lib/xdg-config";
import type { XDGBase } from "../../lib/xdg-base";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { ProfileConfig, ProfileName } from "../../lib/types/config";
import { generateSecretName } from "../../lib/utils/secrets";
import { restartECSServicesUsingSecret } from "../../lib/utils/ecs-service-discovery";

/**
 * Secrets sync options
 */
interface SyncSecretsOptions {
    profile?: ProfileName;
    awsProfile?: string;
    region: string; // REQUIRED - must specify target region for secrets
    dryRun?: boolean;
    force?: boolean;
    configStorage?: XDGBase; // Dependency injection for testing
}

/**
 * Secret configuration to sync
 */
interface SecretConfig {
    name: string;
    value: string;
    description: string;
}

/**
 * Sync result
 */
interface SyncResult {
    secretName: string;
    secretArn: string;
    action: "created" | "updated" | "skipped";
    message: string;
}

/**
 * Creates or retrieves Secrets Manager client
 *
 * @param region - AWS region
 * @param awsProfile - AWS profile to use
 * @returns SecretsManagerClient instance
 */
async function getSecretsManagerClient(region: string, awsProfile?: string): Promise<SecretsManagerClient> {
    const clientConfig: { region: string; credentials?: AwsCredentialIdentityProvider } = { region };

    if (awsProfile) {
        clientConfig.credentials = fromIni({ profile: awsProfile });
    }

    return new SecretsManagerClient(clientConfig);
}

/**
 * Checks if a secret exists
 *
 * @param client - Secrets Manager client
 * @param secretName - Secret name
 * @returns True if secret exists, false otherwise
 */
async function secretExists(client: SecretsManagerClient, secretName: string): Promise<boolean> {
    try {
        const command = new DescribeSecretCommand({ SecretId: secretName });
        await client.send(command);
        return true;
    } catch (error) {
        if (error instanceof ResourceNotFoundException) {
            return false;
        }
        throw error;
    }
}

/**
 * Creates a new secret in Secrets Manager
 *
 * @param client - Secrets Manager client
 * @param secretConfig - Secret configuration
 * @returns Secret ARN
 */
async function createSecret(client: SecretsManagerClient, secretConfig: SecretConfig): Promise<string> {
    const command = new CreateSecretCommand({
        Name: secretConfig.name,
        SecretString: secretConfig.value,
        Description: secretConfig.description,
        Tags: [
            { Key: "ManagedBy", Value: "benchling-webhook" },
            { Key: "Version", Value: "0.7.0" },
        ],
    });

    const response = await client.send(command);
    return response.ARN || "";
}

/**
 * Updates an existing secret in Secrets Manager
 *
 * @param client - Secrets Manager client
 * @param secretConfig - Secret configuration
 * @returns Secret ARN
 */
async function updateSecret(client: SecretsManagerClient, secretConfig: SecretConfig): Promise<string> {
    const command = new UpdateSecretCommand({
        SecretId: secretConfig.name,
        SecretString: secretConfig.value,
        Description: secretConfig.description,
    });

    const response = await client.send(command);
    return response.ARN || "";
}

/**
 * Retrieves secret value from Secrets Manager
 *
 * @param client - Secrets Manager client
 * @param secretName - Secret name
 * @returns Secret value as JSON string
 */
async function getSecret(client: SecretsManagerClient, secretName: string): Promise<string> {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await client.send(command);
    return response.SecretString || "";
}

/**
 * Determine if a stored value is actually referencing a secret identifier rather than the secret value.
 *
 * @param value - The candidate value from configuration
 * @param secretName - The generated secret name for the profile
 * @param secretArn - Optional ARN recorded in configuration
 * @returns True if value matches known identifiers, false otherwise
 */
function isSecretPlaceholder(value: string | undefined, secretName: string, secretArn?: string): boolean {
    if (!value) {
        return false;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return false;
    }

    if (trimmed === secretName) {
        return true;
    }

    if (secretArn && trimmed === secretArn) {
        return true;
    }

    return false;
}

/**
 * Parse secret payload JSON and ensure it is an object.
 *
 * @param secretString - Raw secret JSON string
 * @param identifier - Secret identifier (for error messages)
 * @returns Parsed payload as record
 * @throws Error if JSON is invalid or not an object
 */
function parseSecretPayload(secretString: string, identifier: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(secretString);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error(`Secret ${identifier} must be a JSON object`);
        }
        return parsed as Record<string, unknown>;
    } catch (error) {
        throw new Error(`Secret ${identifier} contains invalid JSON: ${(error as Error).message}`);
    }
}

/**
 * Extract client secret from secret payload supporting both snake_case and camelCase.
 *
 * @param payload - Parsed secret payload
 * @returns Client secret value if present
 */
function extractClientSecret(payload: Record<string, unknown>): string | undefined {
    const candidates = ["client_secret", "clientSecret"];

    for (const key of candidates) {
        const value = payload[key];
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }

    return undefined;
}

/**
 * Resolve the Benchling client secret value to upload.
 *
 * This ensures we never upload the secret name/ARN itself by attempting to read the
 * existing secret when configuration contains only identifiers.
 *
 * @param client - Secrets Manager client
 * @param config - Profile configuration
 * @param secretName - Generated secret name for the profile
 * @returns Resolved client secret value
 * @throws Error if the client secret cannot be resolved
 */
async function resolveClientSecretValue(
    client: SecretsManagerClient,
    config: ProfileConfig,
    secretName: string,
): Promise<string> {
    const directValue = config.benchling.clientSecret?.trim();
    if (directValue && !isSecretPlaceholder(directValue, secretName, config.benchling.secretArn)) {
        return directValue;
    }

    const identifiers: string[] = [];
    if (config.benchling.secretArn) {
        identifiers.push(config.benchling.secretArn);
    }
    identifiers.push(secretName);

    let lastError: Error | undefined;

    for (const identifier of identifiers) {
        if (!identifier) {
            continue;
        }

        try {
            const secretString = await getSecret(client, identifier);
            const payload = parseSecretPayload(secretString, identifier);
            const resolved = extractClientSecret(payload);

            if (resolved) {
                return resolved;
            }

            lastError = new Error(`Secret ${identifier} does not contain a client_secret field`);
        } catch (error) {
            if (error instanceof ResourceNotFoundException) {
                // Try next identifier
                continue;
            }

            lastError = error instanceof Error ? error : new Error(String(error));
        }
    }

    if (lastError) {
        throw lastError;
    }

    throw new Error(
        "Benchling OAuth client secret is required but could not be resolved from the profile or existing Secrets Manager entries. " +
            "Provide benchling.clientSecret in your profile configuration or ensure the existing secret contains a client_secret value.",
    );
}

/**
 * Builds secret value JSON from profile configuration
 *
 * @param config - Profile configuration
 * @param clientSecret - Resolved client secret value
 * @returns Secret value as JSON string
 */
function buildSecretValue(config: ProfileConfig, clientSecret: string): string {
    // Use snake_case field names to match Python config_resolver expectations
    const secretData = {
        tenant: config.benchling.tenant,
        client_id: config.benchling.clientId,
        client_secret: clientSecret,
        app_definition_id: config.benchling.appDefinitionId,
        user_bucket: config.packages.bucket,
        pkg_prefix: config.packages.prefix,
        pkg_key: config.packages.metadataKey,
        log_level: config.logging?.level || "INFO",
        webhook_allow_list: config.security?.webhookAllowList || "",
        enable_webhook_verification: config.security?.enableVerification !== false ? "true" : "false",
    };

    return JSON.stringify(secretData, null, 2);
}

/**
 * Syncs configuration to AWS Secrets Manager
 *
 * Mode-aware behavior (B7):
 * - Integrated mode (integratedStack=true): Always updates existing BenchlingSecret ARN
 * - Standalone mode (integratedStack=false): Creates new secret with pattern quiltdata/benchling-webhook/<profile>/<tenant>
 *
 * @param options - Sync options
 * @returns Array of sync results
 */
export async function syncSecretsToAWS(options: SyncSecretsOptions): Promise<SyncResult[]> {
    const { profile = "default", awsProfile, region, dryRun = false, force = false, configStorage } = options;

    // Validate required parameters
    if (!region) {
        throw new Error("region is required - must specify AWS region for secret storage");
    }

    const results: SyncResult[] = [];

    // Step 1: Load configuration
    console.log(`Loading configuration from profile: ${profile}...`);
    const xdgConfig = configStorage || new XDGConfig();

    let config: ProfileConfig;
    try {
        config = xdgConfig.readProfile(profile);
    } catch (error) {
        throw new Error(`Failed to load configuration: ${(error as Error).message}`);
    }

    // Validate required fields
    if (!config.benchling.tenant) {
        throw new Error("Benchling tenant is required");
    }

    if (!config.benchling.clientId) {
        throw new Error("Benchling OAuth client ID is required");
    }

    // Step 2: Initialize Secrets Manager client
    console.log(`Initializing Secrets Manager client (region: ${region})...`);
    const client = await getSecretsManagerClient(region, awsProfile);

    // Step 3: Determine secret name based on mode (B7)
    const generatedSecretName = generateSecretName(profile, config.benchling.tenant);
    let secretName: string;
    let isIntegratedMode = false;

    // Check both integratedStack flag and secretArn presence for mode detection
    if (config.integratedStack && config.benchling.secretArn) {
        // Integrated mode: Use existing secret ARN from Quilt stack
        secretName = config.benchling.secretArn;
        isIntegratedMode = true;
        console.log(`Integrated mode: Using BenchlingSecret from Quilt stack: ${secretName}`);
    } else if (config.benchling.secretArn && config.integratedStack === undefined) {
        // Legacy config with secretArn but no integratedStack field - assume integrated
        secretName = config.benchling.secretArn;
        isIntegratedMode = true;
        console.log(`Legacy integrated mode detected: Using BenchlingSecret: ${secretName}`);
    } else {
        // Standalone mode: Generate new secret name
        secretName = generatedSecretName;
        console.log(`Standalone mode: Secret name: ${secretName}`);
    }

    // Step 4: Build secret value
    let clientSecretValue: string;
    try {
        // Pass generatedSecretName for placeholder checking (not the ARN)
        clientSecretValue = await resolveClientSecretValue(client, config, generatedSecretName);
    } catch (error) {
        throw new Error(`Failed to resolve Benchling client secret: ${(error as Error).message}`);
    }

    const secretValue = buildSecretValue(config, clientSecretValue);

    if (dryRun) {
        console.log("\n=== DRY RUN MODE ===");
        console.log(`Mode: ${isIntegratedMode ? "Integrated" : "Standalone"}`);
        console.log(`Would sync secret: ${secretName}`);
        console.log(`Secret value:\n${secretValue}`);
        return results;
    }

    // Step 5: Check if secret exists
    const exists = await secretExists(client, secretName);

    let secretArn: string;
    let action: "created" | "updated" | "skipped";

    if (exists) {
        if (isIntegratedMode) {
            // Integrated mode: Always update existing secret (force is implied)
            console.log(`Updating BenchlingSecret from Quilt stack: ${secretName}...`);
            secretArn = await updateSecret(client, {
                name: secretName,
                value: secretValue,
                description: `Benchling Webhook configuration for ${config.benchling.tenant} (profile: ${profile}, integrated mode)`,
            });
            action = "updated";
            console.log(`✓ BenchlingSecret updated: ${secretArn}`);
        } else if (force) {
            // Standalone mode with force flag
            console.log(`Updating existing secret: ${secretName}...`);
            secretArn = await updateSecret(client, {
                name: secretName,
                value: secretValue,
                description: `Benchling Webhook configuration for ${config.benchling.tenant} (profile: ${profile}, standalone mode)`,
            });
            action = "updated";
            console.log(`✓ Secret updated: ${secretArn}`);
        } else {
            // Standalone mode without force - skip update
            console.log(`Secret already exists: ${secretName}`);
            console.log("Use --force to update existing secret");

            // Get existing secret ARN
            const describeCommand = new DescribeSecretCommand({ SecretId: secretName });
            const describeResponse = await client.send(describeCommand);
            secretArn = describeResponse.ARN || "";
            action = "skipped";
        }
    } else {
        if (isIntegratedMode) {
            // Integrated mode but secret doesn't exist - this is an error
            throw new Error(
                `BenchlingSecret ARN found in Quilt stack outputs (${secretName}) but the secret does not exist in Secrets Manager. ` +
                "This may indicate the Quilt stack deployment is incomplete or the secret was deleted.",
            );
        }
        // Standalone mode: Create new secret
        console.log(`Creating new secret: ${secretName}...`);
        secretArn = await createSecret(client, {
            name: secretName,
            value: secretValue,
            description: `Benchling Webhook configuration for ${config.benchling.tenant} (profile: ${profile}, standalone mode)`,
        });
        action = "created";
        console.log(`✓ Secret created: ${secretArn}`);
    }

    results.push({
        secretName,
        secretArn,
        action,
        message: `Secret ${action} successfully`,
    });

    // Step 6: Update XDG configuration with secret ARN (always update for tracking)
    console.log("Updating XDG configuration with secret ARN...");

    // Update config with secret ARN
    config.benchling.secretArn = secretArn;
    config._metadata.updatedAt = new Date().toISOString();
    config._metadata.source = "cli";

    // Write updated config
    xdgConfig.writeProfile(profile, config);

    console.log("✓ XDG configuration updated with secret ARN");

    // Step 7: Restart ECS services if secret was updated (not just created or skipped)
    if (action === "updated") {
        try {
            console.log("\n=== Restarting ECS Services ===");
            console.log("Secret was updated. Checking for running containers that need to be restarted...");

            let stackNameOrArn: string | undefined;

            // Determine stack to restart based on deployment mode
            if (config.integratedStack && config.quilt.stackArn) {
                // Integrated mode: Use Quilt stack ARN
                stackNameOrArn = config.quilt.stackArn;
                console.log(`Integrated mode: Using Quilt stack: ${stackNameOrArn}`);
            } else {
                // Standalone mode: Try to find active deployment to get stack name
                const activeDeployment = xdgConfig.getActiveDeployment(profile, "prod") ||
                                        xdgConfig.getActiveDeployment(profile, "dev");

                if (activeDeployment && activeDeployment.stackName) {
                    stackNameOrArn = activeDeployment.stackName;
                    console.log(`Standalone mode: Found deployment in stack: ${stackNameOrArn}`);
                }
            }

            if (stackNameOrArn) {
                console.log("Restarting ECS services that use this secret...");

                const restartedServices = await restartECSServicesUsingSecret(
                    stackNameOrArn,
                    region,
                    secretArn,
                    awsProfile,
                );

                if (restartedServices.length > 0) {
                    console.log(`✓ Restarted ${restartedServices.length} ECS service(s):`);
                    restartedServices.forEach((svc: string) => console.log(`  - ${svc}`));
                    console.log("\nNote: New containers will start with the updated secret values.");
                    console.log("Container restart may take 1-2 minutes to complete.");
                } else {
                    console.log("⚠ No ECS services using this secret were found in the stack.");
                    console.log("If you have running containers using this secret, you may need to restart them manually.");
                }
            } else {
                console.log("⚠ No stack found for this profile.");
                console.log("If you have running containers, you may need to restart them manually.");
                console.log("Containers will not pick up the updated secret until they are restarted.");
            }
        } catch (error) {
            console.warn(`\n⚠ Warning: Could not restart ECS services: ${(error as Error).message}`);
            console.warn("The secret was updated successfully, but running containers may not have picked it up.");
            console.warn("You may need to manually restart your containers or redeploy your stack.");
        }
    }

    return results;
}

/**
 * Retrieves secrets from AWS Secrets Manager
 *
 * @param options - Retrieval options
 * @returns Secret value as parsed JSON
 */
export async function getSecretsFromAWS(options: {
    profile?: ProfileName;
    awsProfile?: string;
    region?: string;
    configStorage?: XDGBase;
}): Promise<Record<string, string>> {
    const { profile = "default", awsProfile, region = "us-east-1", configStorage } = options;

    // Load configuration
    const xdgConfig = configStorage || new XDGConfig();
    const config = xdgConfig.readProfile(profile);

    if (!config.benchling.secretArn) {
        throw new Error("No secret ARN found in configuration. Run sync-secrets first.");
    }

    // Initialize Secrets Manager client
    const client = await getSecretsManagerClient(region, awsProfile);

    // Retrieve secret
    const secretValue = await getSecret(client, config.benchling.secretArn);

    // Parse and return
    return JSON.parse(secretValue);
}

/**
 * Validates that secrets are accessible
 *
 * @param options - Validation options
 * @returns True if secrets are accessible
 */
export async function validateSecretsAccess(options: {
    profile?: ProfileName;
    awsProfile?: string;
    region?: string;
    configStorage?: XDGBase;
}): Promise<boolean> {
    try {
        await getSecretsFromAWS(options);
        return true;
    } catch (error) {
        console.error(`Secret validation failed: ${(error as Error).message}`);
        return false;
    }
}

/**
 * Main execution for CLI usage
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const options: Partial<SyncSecretsOptions> = {}; // Partial until we parse all args
    let command = "sync";

    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "get") {
            command = "get";
        } else if (args[i] === "validate") {
            command = "validate";
        } else if (args[i] === "--profile" && i + 1 < args.length) {
            options.profile = args[i + 1];
            i++;
        } else if (args[i] === "--aws-profile" && i + 1 < args.length) {
            options.awsProfile = args[i + 1];
            i++;
        } else if (args[i] === "--region" && i + 1 < args.length) {
            options.region = args[i + 1];
            i++;
        } else if (args[i] === "--dry-run") {
            options.dryRun = true;
        } else if (args[i] === "--force") {
            options.force = true;
        } else if (args[i] === "--help") {
            console.log("Usage: sync-secrets [command] [options]");
            console.log("\nCommands:");
            console.log("  sync              Sync secrets to AWS Secrets Manager (default)");
            console.log("  get               Retrieve secrets from AWS Secrets Manager");
            console.log("  validate          Validate secret accessibility");
            console.log("\nOptions:");
            console.log("  --profile <name>          Configuration profile (default: default)");
            console.log("  --aws-profile <profile>   AWS profile to use");
            console.log("  --region <region>         AWS region (default: us-east-1)");
            console.log("  --dry-run                 Show what would be synced without making changes");
            console.log("  --force                   Force update of existing secrets");
            console.log("  --help                    Show this help message");
            process.exit(0);
        }
    }

    // Validate required options before execution
    if (command === "sync" && !options.region) {
        throw new Error("--region is required for syncing secrets");
    }

    try {
        if (command === "sync") {
            console.log("╔═══════════════════════════════════════════════════════════╗");
            console.log("║   AWS Secrets Manager Sync                                ║");
            console.log("╚═══════════════════════════════════════════════════════════╝\n");

            const results = await syncSecretsToAWS(options as SyncSecretsOptions);

            console.log("\n=== Sync Results ===");
            results.forEach((result) => {
                console.log(`\n${result.secretName}:`);
                console.log(`  Action: ${result.action}`);
                console.log(`  ARN: ${result.secretArn}`);
                console.log(`  Message: ${result.message}`);
            });

            console.log("\n✓ Secrets sync completed successfully");
        } else if (command === "get") {
            console.log("Retrieving secrets from AWS Secrets Manager...\n");

            const secrets = await getSecretsFromAWS(options);

            console.log("=== Retrieved Secrets ===");
            Object.keys(secrets).forEach((key) => {
                if (key.toLowerCase().includes("secret") || key.toLowerCase().includes("password")) {
                    console.log(`${key}: ********`);
                } else {
                    console.log(`${key}: ${secrets[key]}`);
                }
            });
        } else if (command === "validate") {
            console.log("Validating secret accessibility...\n");

            const isValid = await validateSecretsAccess(options);

            if (isValid) {
                console.log("✓ Secrets are accessible");
                process.exit(0);
            } else {
                console.error("❌ Secrets are not accessible");
                process.exit(1);
            }
        }
    } catch (error) {
        console.error("\n❌ Error:", (error as Error).message);
        process.exit(1);
    }
}

// Run main if executed directly
if (require.main === module) {
    main();
}
