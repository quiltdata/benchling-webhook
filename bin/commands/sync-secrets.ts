#!/usr/bin/env node
/**
 * AWS Secrets Manager Integration
 *
 * WARNING: This file needs significant refactoring for v0.7.0
 * TODO: Update to use ProfileConfig instead of UserConfig/DerivedConfig
 * TODO: Remove references to BaseConfig
 * TODO: Update to use readProfile/writeProfile instead of readProfileConfig/writeProfileConfig
 *
 * Synchronizes configuration to AWS Secrets Manager with:
 * - Consistent secret naming conventions
 * - AWS profile selection support
 * - Atomic secret creation/update operations
 * - ARN tracking in XDG configuration
 *
 * @module scripts/sync-secrets
 */

import {
    SecretsManagerClient,
    CreateSecretCommand,
    UpdateSecretCommand,
    GetSecretValueCommand,
    DescribeSecretCommand,
    ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { XDGConfig } from "../../lib/xdg-config";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { ProfileConfig, ProfileName } from "../../lib/types/config";
import { generateSecretName } from "../../lib/utils/secrets";

/**
 * Secrets sync options
 */
interface SyncSecretsOptions {
    profile?: ProfileName;
    awsProfile?: string;
    region?: string;
    dryRun?: boolean;
    force?: boolean;
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
        const { fromIni } = await import("@aws-sdk/credential-providers");
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
 * Builds secret value JSON from profile configuration
 *
 * @param config - Profile configuration
 * @returns Secret value as JSON string
 */
function buildSecretValue(config: ProfileConfig): string {
    // Use snake_case field names to match Python config_resolver expectations
    const secretData = {
        tenant: config.benchling.tenant,
        client_id: config.benchling.clientId,
        client_secret: config.benchling.clientSecret || "",
        app_definition_id: config.benchling.appDefinitionId,
        user_bucket: config.packages.bucket,
        pkg_prefix: config.packages.prefix,
        pkg_key: config.packages.metadataKey,
        log_level: config.logging?.level || "INFO",
        webhook_allow_list: config.security?.webhookAllowList || "",
        enable_webhook_verification: config.security?.enableVerification !== false ? "true" : "false",
    };

    // Add optional fields
    if (config.quilt.queueArn) {
        Object.assign(secretData, { queue_arn: config.quilt.queueArn });
    }

    return JSON.stringify(secretData, null, 2);
}

/**
 * Syncs configuration to AWS Secrets Manager
 *
 * @param options - Sync options
 * @returns Array of sync results
 */
export async function syncSecretsToAWS(options: SyncSecretsOptions = {}): Promise<SyncResult[]> {
    const { profile = "default", awsProfile, region = "us-east-1", dryRun = false, force = false } = options;

    const results: SyncResult[] = [];

    // Step 1: Load configuration
    console.log(`Loading configuration from profile: ${profile}...`);
    const xdgConfig = new XDGConfig();

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

    // Step 3: Generate secret name
    const secretName = generateSecretName(profile, config.benchling.tenant);
    console.log(`Secret name: ${secretName}`);

    // Step 4: Build secret value
    const secretValue = buildSecretValue(config);

    if (dryRun) {
        console.log("\n=== DRY RUN MODE ===");
        console.log(`Would sync secret: ${secretName}`);
        console.log(`Secret value:\n${secretValue}`);
        return results;
    }

    // Step 5: Check if secret exists
    const exists = await secretExists(client, secretName);

    let secretArn: string;
    let action: "created" | "updated" | "skipped";

    if (exists) {
        if (force) {
            console.log(`Updating existing secret: ${secretName}...`);
            secretArn = await updateSecret(client, {
                name: secretName,
                value: secretValue,
                description: `Benchling Webhook configuration for ${config.benchling.tenant} (profile: ${profile})`,
            });
            action = "updated";
            console.log(`✓ Secret updated: ${secretArn}`);
        } else {
            console.log(`Secret already exists: ${secretName}`);
            console.log("Use --force to update existing secret");

            // Get existing secret ARN
            const describeCommand = new DescribeSecretCommand({ SecretId: secretName });
            const describeResponse = await client.send(describeCommand);
            secretArn = describeResponse.ARN || "";
            action = "skipped";
        }
    } else {
        console.log(`Creating new secret: ${secretName}...`);
        secretArn = await createSecret(client, {
            name: secretName,
            value: secretValue,
            description: `Benchling Webhook configuration for ${config.benchling.tenant} (profile: ${profile})`,
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

    // Step 6: Update XDG configuration with secret ARN
    console.log("Updating XDG configuration with secret ARN...");

    // Update config with secret ARN
    config.benchling.secretArn = secretArn;
    config._metadata.updatedAt = new Date().toISOString();
    config._metadata.source = "cli";

    // Write updated config
    xdgConfig.writeProfile(profile, config);

    console.log("✓ XDG configuration updated with secret ARN");

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
}): Promise<Record<string, string>> {
    const { profile = "default", awsProfile, region = "us-east-1" } = options;

    // Load configuration
    const xdgConfig = new XDGConfig();
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
    const options: SyncSecretsOptions = {};
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

    try {
        if (command === "sync") {
            console.log("╔═══════════════════════════════════════════════════════════╗");
            console.log("║   AWS Secrets Manager Sync                                ║");
            console.log("╚═══════════════════════════════════════════════════════════╝\n");

            const results = await syncSecretsToAWS(options);

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
