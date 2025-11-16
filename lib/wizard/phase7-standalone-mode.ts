/**
 * Phase 7: Standalone Mode
 *
 * Handles standalone webhook mode where a new dedicated BenchlingSecret is created
 * and optionally deployed as a separate stack.
 *
 * @module wizard/phase7-standalone-mode
 */

import inquirer from "inquirer";
import chalk from "chalk";
import { ProfileConfig } from "../types/config";
import { syncSecretsToAWS } from "../../bin/commands/sync-secrets";
import { generateNextSteps } from "../next-steps-generator";
import { StandaloneModeInput, StandaloneModeResult } from "./types";

/**
 * Builds ProfileConfig from collected parameters
 */
function buildProfileConfig(input: StandaloneModeInput): ProfileConfig {
    const { stackQuery, parameters, catalogDns } = input;

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
            // No secretArn yet - will be set after creating secret
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
        integratedStack: false, // CRITICAL: Mark as standalone mode
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

    // Add discovered workgroups if present
    if (stackQuery.athenaUserWorkgroup) {
        config.quilt.athenaUserWorkgroup = stackQuery.athenaUserWorkgroup;
    }
    if (stackQuery.athenaIcebergWorkgroup) {
        config.quilt.athenaIcebergWorkgroup = stackQuery.athenaIcebergWorkgroup;
    }
    if (stackQuery.icebergDatabase) {
        config.quilt.icebergDatabase = stackQuery.icebergDatabase;
    }

    return config;
}

/**
 * Phase 7: Standalone Mode
 *
 * Responsibilities:
 * - Build complete configuration
 * - Save config with integratedStack: false
 * - Create new secret with pattern
 * - Ask about deployment
 * - Deploy if user confirms
 * - Show next steps
 *
 * @param input - Standalone mode input
 * @returns Standalone mode result
 */
export async function runStandaloneMode(input: StandaloneModeInput): Promise<StandaloneModeResult> {
    const { profile, configStorage, yes = false, setupOnly = false, awsProfile } = input;

    console.log(chalk.bold("\nStandalone Webhook Mode\n"));

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

    // Step 3: Create dedicated BenchlingSecret
    console.log("Creating dedicated BenchlingSecret...\n");

    let secretArn = "";

    try {
        const results = await syncSecretsToAWS({
            profile,
            awsProfile,
            region: config.deployment.region,
            force: true,
            configStorage,
        });

        if (results.length > 0) {
            secretArn = results[0].secretArn;
            console.log(chalk.green("✓ Secret created for standalone deployment\n"));
        }
    } catch (error) {
        console.warn(chalk.yellow(`⚠️  Failed to sync secrets: ${(error as Error).message}`));
        console.warn(chalk.yellow("   You can sync secrets manually later with:"));
        console.warn(chalk.cyan(`   npm run setup:sync-secrets -- --profile ${profile}\n`));
    }

    // Step 4: Ask about deployment (unless --setup-only)
    let deployed = false;

    if (!setupOnly) {
        let shouldDeploy = false;

        if (yes) {
            shouldDeploy = false; // In --yes mode, don't auto-deploy
        } else {
            const { deploy } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "deploy",
                    message: "Deploy to AWS now?",
                    default: true,
                },
            ]);
            shouldDeploy = deploy;
        }

        if (shouldDeploy) {
            console.log(chalk.blue("\nDeploying webhook stack...\n"));
            try {
                const { deployCommand } = await import("../../bin/commands/deploy");
                await deployCommand({
                    profile,
                    stage: profile === "prod" ? "prod" : "dev",
                    yes: true,
                });
                console.log(chalk.green("\n✓ Deployment completed successfully\n"));
                deployed = true;
            } catch (error) {
                console.error(chalk.red(`\n❌ Deployment failed: ${(error as Error).message}\n`));
                console.log(chalk.yellow("You can deploy manually later with:"));
                console.log(chalk.cyan(`   npm run deploy:${profile === "prod" ? "prod" : "dev"} -- --profile ${profile}\n`));
            }
        }
    }

    // Step 5: Show completion message
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Setup Complete!                                         ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    if (!deployed && !setupOnly) {
        const nextSteps = generateNextSteps({
            profile,
            stage: profile === "prod" ? "prod" : "dev",
        });
        console.log(nextSteps + "\n");
    } else if (setupOnly) {
        console.log(chalk.bold("Configuration saved. Use deploy command to deploy:\n"));
        console.log(chalk.cyan(`   npm run deploy:${profile === "prod" ? "prod" : "dev"} -- --profile ${profile}\n`));
    }

    return {
        success: true,
        configPath: `~/.config/benchling-webhook/${profile}/config.json`,
        secretArn,
        deployed,
    };
}
