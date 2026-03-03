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
    // Add IAM managed policy ARNs if discovered
    if (stackQuery.bucketWritePolicyArn) {
        config.quilt.bucketWritePolicyArn = stackQuery.bucketWritePolicyArn;
    }
    if (stackQuery.athenaUserPolicyArn) {
        config.quilt.athenaUserPolicyArn = stackQuery.athenaUserPolicyArn;
    }

    return config;
}

/**
 * Phase 6: Integrated Mode
 *
 * Responsibilities:
 * - Build complete configuration
 * - Save config with integratedStack: true (informational only)
 * - Update BenchlingSecret ARN
 * - Show success message
 * - Return (NO deployment; BenchlingWebhook parameter managed via IAC)
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

    // Step 3.5: Query and cache webhook URL from Quilt stack
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
    console.log(chalk.dim("ℹ BenchlingWebhook parameter managed via IAC (not changed by this tool)"));
    console.log(chalk.dim("✓ No separate webhook deployment needed"));
    console.log(chalk.dim("✓ Quilt stack will handle webhook events\n"));

    console.log(chalk.bold("Next steps:"));
    let stepNumber = 1;

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
