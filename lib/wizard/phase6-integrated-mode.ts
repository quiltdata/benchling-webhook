/**
 * Phase 6: Integrated Mode
 *
 * Handles integrated stack mode where the BenchlingSecret from the Quilt stack
 * is updated with webhook configuration. NO deployment is performed.
 *
 * @module wizard/phase6-integrated-mode
 */

import chalk from "chalk";
import inquirer from "inquirer";
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
            ...(stackQuery.stackVersion && { stackVersion: stackQuery.stackVersion }),
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
            logGroups: stackQuery.logGroups, // Include discovered log groups
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

    // Add discovered workgroups and resources if present
    if (stackQuery.athenaUserWorkgroup) {
        config.quilt.athenaUserWorkgroup = stackQuery.athenaUserWorkgroup;
    }
    if (stackQuery.athenaUserPolicy) {
        config.quilt.athenaUserPolicy = stackQuery.athenaUserPolicy;
    }
    if (stackQuery.icebergWorkgroup) {
        config.quilt.icebergWorkgroup = stackQuery.icebergWorkgroup;
    }
    if (stackQuery.icebergDatabase) {
        config.quilt.icebergDatabase = stackQuery.icebergDatabase;
    }
    if (stackQuery.athenaResultsBucket) {
        config.quilt.athenaResultsBucket = stackQuery.athenaResultsBucket;
    }
    if (stackQuery.athenaResultsBucketPolicy) {
        config.quilt.athenaResultsBucketPolicy = stackQuery.athenaResultsBucketPolicy;
    }
    // Add IAM role ARNs if discovered
    if (stackQuery.writeRoleArn) {
        config.quilt.writeRoleArn = stackQuery.writeRoleArn;
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
 * - Check and optionally enable BenchlingWebhook parameter
 * - Show success message
 * - Return (NO deployment)
 *
 * @param input - Integrated mode input
 * @returns Integrated mode result
 */
export async function runIntegratedMode(input: IntegratedModeInput): Promise<IntegratedModeResult> {
    const { profile, configStorage, awsProfile, yes, stackQuery } = input;

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

    // Step 3.5: Check and optionally enable BenchlingWebhook parameter
    console.log("Checking BenchlingWebhook parameter...\n");

    const benchlingIntegrationEnabled = stackQuery.benchlingIntegrationEnabled;
    let integrationStatusUpdated = false;

    if (benchlingIntegrationEnabled === undefined) {
        console.log(chalk.yellow("⚠️  Could not determine BenchlingWebhook status"));
        console.log(chalk.dim("   You may need to enable it manually in CloudFormation\n"));
    } else if (benchlingIntegrationEnabled) {
        console.log(chalk.green("✓ BenchlingWebhook is already Enabled\n"));
    } else {
        // Parameter is disabled - offer to enable
        console.log(chalk.yellow("BenchlingWebhook is currently Disabled"));

        let shouldEnable = yes;
        if (!yes) {
            const { enable } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "enable",
                    message: "Enable BenchlingWebhook now?",
                    default: true,
                },
            ]);
            shouldEnable = enable;
        }

        if (shouldEnable) {
            console.log("\nEnabling BenchlingWebhook parameter...");

            const { updateStackParameter } = await import("../utils/stack-parameter-update");
            const updateResult = await updateStackParameter({
                stackArn: stackQuery.stackArn,
                region: config.deployment.region,
                parameterKey: "BenchlingWebhook",
                parameterValue: "Enabled",
                awsProfile,
            });

            if (updateResult.success) {
                console.log(chalk.green("✓ Stack update initiated"));
                console.log(chalk.dim("  The stack is now updating in the background\n"));
                integrationStatusUpdated = true;
            } else {
                console.warn(chalk.yellow(`⚠️  Failed to enable BenchlingWebhook: ${updateResult.error}`));
                console.warn(chalk.yellow("   You can enable it manually in CloudFormation console\n"));
            }
        } else {
            console.log(chalk.dim("  Skipped - you can enable it later via CloudFormation console\n"));
        }
    }

    // Step 4: Show success message with status monitoring command
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Setup Complete!                                         ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");
    console.log(chalk.bold("Integrated Stack Mode"));
    console.log(chalk.dim("─".repeat(80)));
    console.log(chalk.green("✓ BenchlingSecret updated in Quilt stack"));

    // Show integration status
    if (benchlingIntegrationEnabled === true && !integrationStatusUpdated) {
        console.log(chalk.green("✓ BenchlingWebhook is Enabled"));
    } else if (benchlingIntegrationEnabled === false || integrationStatusUpdated) {
        console.log(chalk.yellow("⚠ BenchlingWebhook update in progress"));
    } else {
        console.log(chalk.dim("✓ BenchlingWebhook status unknown"));
    }

    console.log(chalk.dim("✓ No separate webhook deployment needed"));
    console.log(chalk.dim("✓ Quilt stack will handle webhook events\n"));

    // Show discovered log groups
    if (stackQuery.logGroups && stackQuery.logGroups.length > 0) {
        console.log(chalk.bold("Discovered Log Groups:"));
        for (const logGroup of stackQuery.logGroups) {
            console.log(chalk.cyan(`  • ${logGroup.displayName}: ${logGroup.name}`));
        }
        console.log("");
    }

    console.log(chalk.bold("Next steps:"));
    console.log("  1. Monitor stack update:");
    console.log(chalk.cyan(`     npx @quiltdata/benchling-webhook status --profile ${profile}`));
    console.log("  2. Configure webhook URL in Benchling app settings");
    console.log("     (Get the webhook URL from your Quilt stack outputs)");
    console.log("  3. Test the webhook integration");
    console.log("  4. Monitor logs:");
    console.log(chalk.cyan(`     npx @quiltdata/benchling-webhook logs --profile ${profile}`));
    console.log("");

    return {
        success: true,
        configPath: `~/.config/benchling-webhook/${profile}/config.json`,
        secretArn: input.benchlingSecretArn,
    };
}
