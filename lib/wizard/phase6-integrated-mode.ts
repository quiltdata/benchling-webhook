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
import { ProfileConfig, CFN_PARAMS } from "../types/config";
import { syncSecretsToAWS } from "../../bin/commands/sync-secrets";
import { IntegratedModeInput, IntegratedModeResult } from "./types";
import packageJson from "../../package.json";

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
            vpc: parameters.deployment.vpc,
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
            version: packageJson.version,
            createdAt: now,
            updatedAt: now,
            source: "wizard",
        },
    };

    // Add discovered workgroups and resources if present
    if (stackQuery.athenaUserWorkgroup) {
        config.quilt.athenaUserWorkgroup = stackQuery.athenaUserWorkgroup;
    }
    if (stackQuery.athenaUserPolicy) {
        config.quilt.athenaUserPolicy = stackQuery.athenaUserPolicy;
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
 * - Check and optionally enable BenchlingIntegration parameter
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

    // Step 3.5: Check and optionally enable BenchlingIntegration parameter
    console.log("Checking BenchlingIntegration parameter...\n");

    const benchlingIntegrationEnabled = stackQuery.benchlingIntegrationEnabled;
    let integrationStatusUpdated = false;

    if (benchlingIntegrationEnabled === undefined) {
        console.error(chalk.red("\n❌ CRITICAL ERROR: Cannot determine BenchlingIntegration parameter status\n"));
        console.error(chalk.yellow("This could mean:"));
        console.error(chalk.yellow("  1. The Quilt stack does not support BenchlingIntegration parameter"));
        console.error(chalk.yellow("  2. Insufficient permissions to read CloudFormation parameters"));
        console.error(chalk.yellow("  3. The stack query failed to detect the parameter\n"));
        console.error(chalk.red("Integrated setup requires this parameter to enable webhook processing."));
        console.error(chalk.red("Cannot continue with integrated setup.\n"));
        throw new Error("BenchlingIntegration parameter status unknown - integrated setup failed");
    } else if (benchlingIntegrationEnabled) {
        console.log(chalk.green("✓ BenchlingIntegration is already Enabled\n"));
    } else {
        // Parameter is disabled - offer to enable
        console.log(chalk.yellow("BenchlingIntegration is currently Disabled"));

        let shouldEnable = yes;
        if (!yes) {
            const { enable } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "enable",
                    message: "Enable BenchlingIntegration now?",
                    default: true,
                },
            ]);
            shouldEnable = enable;
        }

        if (shouldEnable) {
            console.log("\nEnabling BenchlingIntegration parameter...");

            const { updateStackParameter } = await import("../utils/stack-parameter-update");
            const updateResult = await updateStackParameter({
                stackArn: stackQuery.stackArn,
                region: config.deployment.region,
                parameterKey: CFN_PARAMS.BENCHLING_WEBHOOK,
                parameterValue: "Enabled",
                awsProfile,
            });

            if (updateResult.success) {
                console.log(chalk.green("✓ Stack update initiated"));
                console.log(chalk.dim("  The stack is now updating in the background\n"));
                integrationStatusUpdated = true;

                // Offer to monitor stack update status
                let shouldMonitorStatus = yes;
                if (!yes) {
                    const { monitor } = await inquirer.prompt([
                        {
                            type: "confirm",
                            name: "monitor",
                            message: "Monitor stack update status now?",
                            default: true,
                        },
                    ]);
                    shouldMonitorStatus = monitor;
                }

                if (shouldMonitorStatus) {
                    console.log(chalk.dim("\nLaunching status monitor...\n"));

                    try {
                        // Import and run status command
                        const { statusCommand } = await import("../../bin/commands/status");
                        await statusCommand({
                            profile,
                            awsProfile,
                            configStorage,
                            timer: 10, // 10 second refresh interval
                            exit: true, // Exit when terminal status reached
                        });
                    } catch (error) {
                        console.warn(chalk.yellow(`\n⚠️  Status monitoring failed: ${(error as Error).message}`));
                        console.warn(chalk.yellow("   You can run status manually with:"));
                        console.warn(chalk.cyan(`   npx @quiltdata/benchling-webhook status --profile ${profile}\n`));
                    }
                } else {
                    console.log(chalk.dim("  You can monitor status later with:"));
                    console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook status --profile ${profile}\n`));
                }
            } else {
                console.warn(chalk.yellow(`⚠️  Failed to enable BenchlingIntegration: ${updateResult.error}`));
                console.warn(chalk.yellow("   You can enable it manually in CloudFormation console\n"));
            }
        } else {
            console.log(chalk.dim("  Skipped - you can enable it later via CloudFormation console\n"));
        }
    }

    // Step 3.6: Query and cache webhook URL from Quilt stack
    console.log("Querying webhook URL from stack...\n");

    let webhookUrl: string | undefined;
    try {
        const { CloudFormationClient, DescribeStacksCommand } = await import("@aws-sdk/client-cloudformation");
        const { fromIni } = await import("@aws-sdk/credential-providers");

        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = {
            region: config.deployment.region,
        };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        const cfClient = new CloudFormationClient(clientConfig);
        const command = new DescribeStacksCommand({ StackName: stackQuery.stackArn });
        const response = await cfClient.send(command);
        const stack = response.Stacks?.[0];

        if (stack?.Outputs) {
            const webhookOutput = stack.Outputs.find(
                (o) => o.OutputKey === "BenchlingWebhookEndpoint" ||
                       o.OutputKey === "WebhookEndpoint" ||
                       o.OutputKey === "BenchlingUrl",
            );
            webhookUrl = webhookOutput?.OutputValue;

            if (webhookUrl) {
                console.log(chalk.green(`✓ Webhook URL: ${webhookUrl}\n`));

                // Cache webhook URL in deployments.json
                configStorage.recordDeployment(profile, {
                    stage: "prod",
                    endpoint: webhookUrl,
                    timestamp: new Date().toISOString(),
                    imageTag: "integrated",
                    stackName: stackQuery.stackArn.match(/stack\/([^/]+)\//)?.[1] || "QuiltStack",
                    region: config.deployment.region,
                });
            } else {
                console.log(chalk.yellow("⚠️  Webhook URL not found in stack outputs"));
                console.log(chalk.dim("   This is expected if BenchlingIntegration was just enabled\n"));
            }
        }
    } catch (error) {
        console.warn(chalk.yellow(`⚠️  Could not query webhook URL: ${(error as Error).message}`));
        console.warn(chalk.dim("   You can view it later with: npx @quiltdata/benchling-webhook status\n"));
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
        console.log(chalk.green("✓ BenchlingIntegration is Enabled"));
    } else if (benchlingIntegrationEnabled === false || integrationStatusUpdated) {
        console.log(chalk.yellow("⚠ BenchlingIntegration update in progress"));
    } else {
        console.log(chalk.dim("✓ BenchlingIntegration status unknown"));
    }

    console.log(chalk.dim("✓ No separate webhook deployment needed"));
    console.log(chalk.dim("✓ Quilt stack will handle webhook events\n"));

    console.log(chalk.bold("Next steps:"));
    let stepNumber = 1;

    // Only show status monitoring if we didn't just run it
    if (integrationStatusUpdated && !yes) {
        // Status was likely already shown, skip this step
    } else if (integrationStatusUpdated) {
        // --yes mode, suggest manual monitoring
        console.log(`  ${stepNumber++}. Monitor stack update:`);
        console.log(chalk.cyan(`     npx @quiltdata/benchling-webhook@latest status --profile ${profile}`));
    }

    console.log(`  ${stepNumber++}. Configure webhook URL in Benchling app settings`);
    if (webhookUrl) {
        console.log(chalk.dim(`     Webhook URL: ${webhookUrl}`));
    } else {
        console.log("     (Get the webhook URL from your Quilt stack outputs)");
    }
    console.log(`  ${stepNumber++}. Test the webhook integration`);
    console.log(`  ${stepNumber++}. Monitor logs:`);
    console.log(chalk.cyan(`     npx @quiltdata/benchling-webhook@latest logs --profile ${profile}`));
    console.log("");

    return {
        success: true,
        configPath: `~/.config/benchling-webhook/${profile}/config.json`,
        secretArn: input.benchlingSecretArn,
    };
}
