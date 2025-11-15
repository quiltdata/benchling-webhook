/**
 * Phase 6: Integrated Mode
 *
 * Handles integrated stack mode where the BenchlingSecret from the Quilt stack
 * is updated with webhook configuration. NO deployment is performed.
 *
 * @module wizard/phase6-integrated-mode
 */

import chalk from "chalk";
import { ProfileConfig } from "../types/config";
import { syncSecretsToAWS } from "../../bin/commands/sync-secrets";
import { IntegratedModeInput, IntegratedModeResult } from "./types";

/**
 * Builds ProfileConfig from collected parameters
 */
function buildProfileConfig(input: IntegratedModeInput): ProfileConfig {
    const { stackQuery, parameters, benchlingSecretArn, catalogDns } = input;

    const now = new Date().toISOString();

    const config: ProfileConfig = {
        quilt: {
            stackArn: stackQuery.stackArn,
            catalog: catalogDns,
            database: stackQuery.database,
            queueUrl: stackQuery.queueUrl,
            region: stackQuery.region,
        },
        benchling: {
            tenant: parameters.benchling.tenant,
            clientId: parameters.benchling.clientId,
            clientSecret: parameters.benchling.clientSecret,
            appDefinitionId: parameters.benchling.appDefinitionId,
            secretArn: benchlingSecretArn,
        },
        packages: {
            bucket: parameters.packages.bucket,
            prefix: parameters.packages.prefix,
            metadataKey: parameters.packages.metadataKey,
        },
        deployment: {
            region: parameters.deployment.region,
            account: parameters.deployment.account,
        },
        integratedStack: true, // CRITICAL: Mark as integrated mode
        logging: {
            level: parameters.logging.level,
        },
        security: {
            enableVerification: parameters.security.enableVerification,
            webhookAllowList: parameters.security.webhookAllowList,
        },
        _metadata: {
            version: "0.7.0",
            createdAt: now,
            updatedAt: now,
            source: "wizard",
        },
    };

    if (parameters.benchling.testEntryId) {
        config.benchling.testEntryId = parameters.benchling.testEntryId;
    }

    return config;
}

/**
 * Phase 6: Integrated Mode
 *
 * Responsibilities:
 * - Build complete configuration
 * - Save config with integratedStack: true
 * - Update BenchlingSecret ARN
 * - Show success message
 * - Return (NO deployment)
 *
 * @param input - Integrated mode input
 * @returns Integrated mode result
 */
export async function runIntegratedMode(input: IntegratedModeInput): Promise<IntegratedModeResult> {
    const { profile, configStorage, awsProfile } = input;

    console.log(chalk.bold("\nIntegrated Stack Mode\n"));

    // Step 1: Build configuration
    const config = buildProfileConfig(input);

    // Step 2: Save configuration
    console.log(`Saving configuration to profile: ${profile}...\n`);

    try {
        configStorage.writeProfile(profile, config);
        console.log(chalk.green(`✓ Configuration saved to: ~/.config/benchling-webhook/${profile}/config.json\n`));
    } catch (error) {
        throw new Error(`Failed to save configuration: ${(error as Error).message}`);
    }

    // Step 3: Update BenchlingSecret in Quilt stack
    console.log("Updating BenchlingSecret in Quilt stack...\n");

    try {
        await syncSecretsToAWS({
            profile,
            awsProfile,
            region: config.deployment.region,
            force: true,
            configStorage,
        });

        console.log(chalk.green("✓ BenchlingSecret updated in Quilt stack\n"));
    } catch (error) {
        console.warn(chalk.yellow(`⚠️  Failed to sync secrets: ${(error as Error).message}`));
        console.warn(chalk.yellow("   You can sync secrets manually later with:"));
        console.warn(chalk.cyan(`   npm run setup:sync-secrets -- --profile ${profile}\n`));
    }

    // Step 4: Show success message
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Setup Complete!                                         ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");
    console.log(chalk.bold("Integrated Stack Mode"));
    console.log(chalk.dim("─".repeat(80)));
    console.log(chalk.green("✓ BenchlingSecret updated in Quilt stack"));
    console.log(chalk.dim("✓ No separate webhook deployment needed"));
    console.log(chalk.dim("✓ Quilt stack will handle webhook events\n"));
    console.log(chalk.bold("Next steps:"));
    console.log("  1. Configure webhook URL in Benchling app settings");
    console.log("     (Get the webhook URL from your Quilt stack outputs)");
    console.log("  2. Test the webhook integration");
    console.log(`  3. Monitor logs: npx ts-node scripts/check-logs.ts --profile ${profile}\n`);

    return {
        success: true,
        configPath: `~/.config/benchling-webhook/${profile}/config.json`,
        secretArn: input.benchlingSecretArn,
    };
}
