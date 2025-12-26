#!/usr/bin/env node
/**
 * Interactive Configuration Wizard (v0.10.0)
 *
 * Unified setup wizard that orchestrates:
 * 1. Catalog discovery and confirmation
 * 2. Stack query for infrastructure details
 * 3. Context display and flow decision
 * 4. Parameter collection (only when needed)
 * 5. Execution (update secrets, enable/disable integration, deploy)
 *
 * Architecture:
 * - Context first, then targeted questions
 * - Parameter collection is deferred until required
 * - Integrated and standalone paths share execution helpers
 *
 * @module commands/setup-wizard
 * @version 0.10.0
 */

import chalk from "chalk";
import inquirer from "inquirer";
import { XDGConfig } from "../../lib/xdg-config";
import type { XDGBase } from "../../lib/xdg-base";
import { ProfileConfig } from "../../lib/types/config";
import { readFileSync } from "fs";
import { join } from "path";

// Phase modules
import { runCatalogDiscovery } from "../../lib/wizard/phase1-catalog-discovery";
import { runStackQuery } from "../../lib/wizard/phase2-stack-query";
import { runParameterCollection } from "../../lib/wizard/phase3-parameter-collection";
import { runValidation } from "../../lib/wizard/phase4-validation";
import { runUnifiedFlowDecision } from "../../lib/wizard/phase5-unified-flow";
import { buildProfileConfigFromExisting, buildProfileConfigFromParameters } from "../../lib/wizard/profile-config-builder";
import { pollStackStatus, waitForBenchlingSecretArn } from "../../lib/wizard/stack-waiter";
import { syncSecretsToAWS } from "./sync-secrets";
import { deployCommand } from "./deploy";
import { CFN_PARAMS } from "../../lib/types/config";
import { updateStackParameter } from "../../lib/utils/stack-parameter-update";

/**
 * Setup wizard options
 */
export interface SetupWizardOptions {
    /** Configuration profile name */
    profile?: string;
    /** Inherit from another profile (legacy, unused in phase-based wizard) */
    inheritFrom?: string;
    /** Non-interactive mode (use defaults/CLI args) */
    yes?: boolean;
    /** Skip validation checks */
    skipValidation?: boolean;
    /** AWS profile to use */
    awsProfile?: string;
    /** AWS region to use */
    awsRegion?: string;
    /** Setup only (don't prompt for deployment) */
    setupOnly?: boolean;
    /** Part of install command (suppress next steps) */
    isPartOfInstall?: boolean;
    /** Config storage implementation (for testing) */
    configStorage?: XDGBase;

    // CLI argument overrides
    catalogUrl?: string;
    benchlingTenant?: string;
    benchlingClientId?: string;
    benchlingClientSecret?: string;
    benchlingAppDefinitionId?: string;
    userBucket?: string;
    pkgPrefix?: string;
    pkgKey?: string;
    logLevel?: string;
    webhookAllowList?: string;
}

/**
 * Setup wizard result
 */
export interface SetupWizardResult {
    success: boolean;
    profile: string;
    config: ProfileConfig;
    /** Whether deployment decision was already handled by the wizard (standalone mode only) */
    deploymentHandled?: boolean;
}

/**
 * Step titles for the wizard phases
 * This is the single source of truth for step numbering and titles
 */
const STEP_TITLES = {
    catalogDiscovery: "Quilt Catalog Discovery",
    stackQuery: "Quilt Stack Configuration",
    flowDecision: "Context & Flow Selection",
    parameterCollection: "Benchling Parameters",
    validation: "Validation",
    execution: "Execution",
};

/**
 * Gets the package version from package.json
 */
function getVersion(): string {
    try {
        const packagePath = join(__dirname, "../../package.json");
        const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
        return packageJson.version;
    } catch {
        return "unknown";
    }
}

/**
 * Prints the wizard welcome banner
 */
function printWelcomeBanner(): void {
    const version = getVersion();
    const prefix = "   Benchling Webhook Setup (v";
    const suffix = ")";
    const totalWidth = 63; // Width between the ║ symbols
    const contentLength = prefix.length + version.length + suffix.length;
    const padding = " ".repeat(totalWidth - contentLength);

    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    console.log(`║${prefix}${version}${suffix}${padding}║`);
    console.log("╚═══════════════════════════════════════════════════════════╝");
}

/**
 * Prints a step header with proper numbering
 * @param stepNumber - The current step number
 * @param title - The step title
 */
function printStepHeader(stepNumber: number, title: string): void {
    console.log(chalk.bold(`\nStep ${stepNumber}: ${title}\n`));
}

/**
 * Main setup wizard orchestrator
 *
 * This function orchestrates the 7 phases of the setup wizard in sequence.
 * Each phase is isolated and testable. The flow is enforced by the code
 * structure - integrated mode explicitly returns, preventing fall-through
 * to deployment.
 *
 * Flow:
 * 1. Phase 1: Catalog Discovery (local config only, no AWS)
 * 2. Phase 2: Stack Query (query CloudFormation for confirmed catalog)
 * 3. Phase 3: Parameter Collection (collect user inputs)
 * 4. Phase 4: Validation (validate all parameters)
 * 5. Phase 5: Mode Decision (choose integrated vs standalone)
 * 6a. Phase 6: Integrated Mode (update secret, EXIT) OR
 * 6b. Phase 7: Standalone Mode (create secret, optionally deploy, EXIT)
 *
 * The orchestrator prints step headers before each phase to ensure
 * consistent numbering regardless of execution path.
 *
 * @param options - Setup wizard options
 * @returns Setup wizard result
 */
export async function runSetupWizard(options: SetupWizardOptions = {}): Promise<SetupWizardResult> {
    const {
        profile = "default",
        yes = false,
        skipValidation = false,
        awsProfile,
        awsRegion,
        setupOnly = false,
        configStorage,
    } = options;

    const xdg = configStorage || new XDGConfig();

    printWelcomeBanner();

    // Load existing configuration if it exists
    let existingConfig: ProfileConfig | null = null;

    try {
        existingConfig = xdg.readProfile(profile);
        console.log(chalk.dim(`\nLoading existing configuration for profile: ${profile}\n`));
    } catch {
        // Profile doesn't exist - offer to copy from default
        if (profile !== "default" && !yes) {
            try {
                const defaultConfig = xdg.readProfile("default");

                const { copy } = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "copy",
                        message: `Profile '${profile}' doesn't exist. Copy configuration from 'default'?`,
                        default: true,
                    },
                ]);

                if (copy) {
                    existingConfig = defaultConfig;
                    console.log(chalk.dim("\nCopying configuration from profile: default\n"));
                } else {
                    console.log(chalk.dim(`\nCreating new configuration for profile: ${profile}\n`));
                }
            } catch {
                // No default profile either - fresh setup
                console.log(chalk.dim(`\nCreating new configuration for profile: ${profile}\n`));
            }
        } else {
            // Creating default profile or in --yes mode
            console.log(chalk.dim(`\nCreating new configuration for profile: ${profile}\n`));
        }
    }

    // =========================================================================
    // PHASE 1: CATALOG DISCOVERY
    // =========================================================================
    // Detects and confirms catalog DNS (local config only, NO AWS queries)
    // Priority: CLI arg > existing config > quilt3 detection > manual entry
    printStepHeader(1, STEP_TITLES.catalogDiscovery);
    const catalogResult = await runCatalogDiscovery({
        yes,
        catalogUrl: options.catalogUrl,
        existingCatalog: existingConfig?.quilt?.catalog,
    });

    // =========================================================================
    // PHASE 2: STACK QUERY
    // =========================================================================
    // NOW query AWS for the CONFIRMED catalog
    // This extracts ALL parameters including BenchlingSecret ARN
    printStepHeader(2, STEP_TITLES.stackQuery);
    const stackQuery = await runStackQuery(catalogResult.catalogDns, {
        awsProfile,
        awsRegion,
        yes,
    });

    // Handle stack query failure
    if (!stackQuery.stackQuerySucceeded) {
        console.error(chalk.red("\n❌ Stack query failed. Cannot continue setup."));
        console.error(chalk.yellow("Please verify:"));
        console.error(chalk.yellow("  1. The catalog DNS is correct"));
        console.error(chalk.yellow("  2. You have AWS credentials configured"));
        console.error(chalk.yellow("  3. The CloudFormation stack exists for this catalog\n"));
        throw new Error("Stack query failed");
    }

    // =========================================================================
    // PHASE 3: CONTEXT + FLOW DECISION
    // =========================================================================
    printStepHeader(3, STEP_TITLES.flowDecision);
    const flowDecision = await runUnifiedFlowDecision({
        stackQuery,
        existingConfig,
        configStorage: xdg,
        profile,
        yes,
        awsProfile,
    });

    if (flowDecision.action === "exit") {
        console.log(chalk.green("✓ Exit without changes"));
        if (existingConfig) {
            return {
                success: true,
                profile,
                config: existingConfig,
                deploymentHandled: true,
            };
        }
        process.exit(0);
    }

    const actionsRequiringParameters = new Set([
        "update-integration-secret",
        "enable-integration",
        "deploy-standalone",
        "update-standalone-redeploy",
    ]);

    let parameters = undefined as Awaited<ReturnType<typeof runParameterCollection>> | undefined;

    const collectParameters = async (): Promise<void> => {
        printStepHeader(4, STEP_TITLES.parameterCollection);
        parameters = await runParameterCollection({
            stackQuery,
            existingConfig,
            yes,
            profile,
            benchlingTenant: options.benchlingTenant,
            benchlingClientId: options.benchlingClientId,
            benchlingClientSecret: options.benchlingClientSecret,
            benchlingAppDefinitionId: options.benchlingAppDefinitionId,
            userBucket: options.userBucket,
            pkgPrefix: options.pkgPrefix,
            pkgKey: options.pkgKey,
            logLevel: options.logLevel,
            webhookAllowList: options.webhookAllowList,
        });

        if (!skipValidation) {
            printStepHeader(5, STEP_TITLES.validation);
            const validation = await runValidation({
                stackQuery,
                parameters,
                awsProfile,
            });

            if (!validation.success) {
                if (yes) {
                    throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
                }

                const { proceed } = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "proceed",
                        message: "Save configuration anyway?",
                        default: false,
                    },
                ]);

                if (!proceed) {
                    throw new Error("Setup aborted by user");
                }
            }
        }
    };

    if (actionsRequiringParameters.has(flowDecision.action)) {
        await collectParameters();
    }

    const saveConfig = (config: ProfileConfig): void => {
        console.log(`Saving configuration to profile: ${profile}...\n`);
        xdg.writeProfile(profile, config);
        console.log(chalk.green(`✓ Configuration saved to: ~/.config/benchling-webhook/${profile}/config.json\n`));
    };

    const requireConfig = async (integratedStack: boolean): Promise<ProfileConfig> => {
        try {
            return buildProfileConfigFromExisting({
                stackQuery,
                existingConfig,
                secretDetails: flowDecision.secretDetails,
                catalogDns: catalogResult.catalogDns,
                integratedStack,
                benchlingSecretArn: flowDecision.benchlingSecretArn,
            });
        } catch (_error) {
            if (!parameters) {
                await collectParameters();
            }
            return buildProfileConfigFromParameters({
                stackQuery,
                parameters: parameters!,
                catalogDns: catalogResult.catalogDns,
                integratedStack,
                benchlingSecretArn: flowDecision.benchlingSecretArn,
            });
        }
    };

    printStepHeader(6, STEP_TITLES.execution);

    switch (flowDecision.action) {
    case "update-integration-secret": {
        const benchlingSecretArn = flowDecision.benchlingSecretArn;
        if (!benchlingSecretArn) {
            throw new Error("BenchlingSecret ARN not found for integrated update.");
        }
        const config = buildProfileConfigFromParameters({
            stackQuery,
            parameters: parameters!,
            catalogDns: catalogResult.catalogDns,
            integratedStack: true,
            benchlingSecretArn,
        });

        saveConfig(config);
        await syncSecretsToAWS({
            profile,
            awsProfile,
            region: config.deployment.region,
            force: true,
            configStorage: xdg,
        });
        break;
    }
    case "review-only": {
        const integratedStack = flowDecision.flow !== "standalone-existing";
        const config = await requireConfig(integratedStack);
        saveConfig(config);
        break;
    }
    case "disable-integration": {
        const confirmDisable = yes || (await inquirer.prompt([
            {
                type: "confirm",
                name: "confirmDisable",
                message: "Stop webhook? (can re-enable later)",
                default: false,
            },
        ])).confirmDisable;

        if (!confirmDisable) {
            console.log(chalk.green("✓ Exit without changes"));
            return {
                success: true,
                profile,
                config: existingConfig || (await requireConfig(true)),
                deploymentHandled: true,
            };
        }

        const updateResult = await updateStackParameter({
            stackArn: stackQuery.stackArn,
            region: stackQuery.region,
            parameterKey: CFN_PARAMS.BENCHLING_WEBHOOK,
            parameterValue: "Disabled",
            awsProfile,
        });

        if (updateResult.success) {
            console.log(chalk.green("✓ Stack update initiated"));
            await pollStackStatus({
                stackArn: stackQuery.stackArn,
                region: stackQuery.region,
                awsProfile,
            });
        } else {
            throw new Error(updateResult.error || "Failed to disable BenchlingIntegration");
        }

        const config = await requireConfig(true);
        saveConfig(config);
        break;
    }
    case "switch-standalone": {
        const confirmSwitch = yes || (await inquirer.prompt([
            {
                type: "confirm",
                name: "confirmSwitch",
                message: "Create separate infrastructure? (~8-10 min)",
                default: false,
            },
        ])).confirmSwitch;

        if (!confirmSwitch) {
            console.log(chalk.green("✓ Exit without changes"));
            return {
                success: true,
                profile,
                config: existingConfig || (await requireConfig(true)),
                deploymentHandled: true,
            };
        }

        const updateResult = await updateStackParameter({
            stackArn: stackQuery.stackArn,
            region: stackQuery.region,
            parameterKey: CFN_PARAMS.BENCHLING_WEBHOOK,
            parameterValue: "Disabled",
            awsProfile,
        });

        if (updateResult.success) {
            console.log(chalk.green("✓ Stack update initiated"));
            await pollStackStatus({
                stackArn: stackQuery.stackArn,
                region: stackQuery.region,
                awsProfile,
            });
        } else {
            throw new Error(updateResult.error || "Failed to disable BenchlingIntegration");
        }

        const config = await requireConfig(false);
        saveConfig(config);

        await syncSecretsToAWS({
            profile,
            awsProfile,
            region: config.deployment.region,
            force: true,
            configStorage: xdg,
        });

        if (!setupOnly) {
            await deployCommand({
                profile,
                stage: profile === "prod" ? "prod" : "dev",
                yes: true,
            });
        }
        break;
    }
    case "enable-integration": {
        const confirmEnable = yes || (await inquirer.prompt([
            {
                type: "confirm",
                name: "confirmEnable",
                message: "Enable integration?",
                default: true,
            },
        ])).confirmEnable;

        if (!confirmEnable) {
            console.log(chalk.green("✓ Exit without changes"));
            return {
                success: true,
                profile,
                config: existingConfig || (await requireConfig(true)),
                deploymentHandled: true,
            };
        }

        const updateResult = await updateStackParameter({
            stackArn: stackQuery.stackArn,
            region: stackQuery.region,
            parameterKey: CFN_PARAMS.BENCHLING_WEBHOOK,
            parameterValue: "Enabled",
            awsProfile,
        });

        if (updateResult.success) {
            console.log(chalk.green("✓ Stack update initiated"));
            await pollStackStatus({
                stackArn: stackQuery.stackArn,
                region: stackQuery.region,
                awsProfile,
            });
        } else {
            throw new Error(updateResult.error || "Failed to enable BenchlingIntegration");
        }

        const benchlingSecretArn = await waitForBenchlingSecretArn({
            stackArn: stackQuery.stackArn,
            region: stackQuery.region,
            awsProfile,
        });

        const config = buildProfileConfigFromParameters({
            stackQuery,
            parameters: parameters!,
            catalogDns: catalogResult.catalogDns,
            integratedStack: true,
            benchlingSecretArn,
        });

        saveConfig(config);
        await syncSecretsToAWS({
            profile,
            awsProfile,
            region: config.deployment.region,
            force: true,
            configStorage: xdg,
        });
        break;
    }
    case "deploy-standalone": {
        const config = buildProfileConfigFromParameters({
            stackQuery,
            parameters: parameters!,
            catalogDns: catalogResult.catalogDns,
            integratedStack: false,
        });

        saveConfig(config);
        await syncSecretsToAWS({
            profile,
            awsProfile,
            region: config.deployment.region,
            force: true,
            configStorage: xdg,
        });

        if (!setupOnly) {
            await deployCommand({
                profile,
                stage: profile === "prod" ? "prod" : "dev",
                yes: true,
            });
        }
        break;
    }
    case "update-standalone-redeploy": {
        const config = buildProfileConfigFromParameters({
            stackQuery,
            parameters: parameters!,
            catalogDns: catalogResult.catalogDns,
            integratedStack: false,
        });

        saveConfig(config);

        if (!setupOnly) {
            await deployCommand({
                profile,
                stage: profile === "prod" ? "prod" : "dev",
                yes: true,
            });
        }

        await syncSecretsToAWS({
            profile,
            awsProfile,
            region: config.deployment.region,
            force: true,
            configStorage: xdg,
        });
        break;
    }
    case "update-standalone-secret": {
        const config = await requireConfig(false);
        saveConfig(config);
        await syncSecretsToAWS({
            profile,
            awsProfile,
            region: config.deployment.region,
            force: true,
            configStorage: xdg,
        });
        break;
    }
    default:
        break;
    }

    const finalConfig = xdg.readProfile(profile);
    return {
        success: true,
        profile,
        config: finalConfig,
        deploymentHandled: true,
    };
}

/**
 * Setup wizard command handler
 *
 * Wraps runSetupWizard with error handling for graceful user cancellation.
 *
 * @param options - Wizard options
 * @returns Promise that resolves with setup result
 */
export async function setupWizardCommand(options: SetupWizardOptions = {}): Promise<SetupWizardResult> {
    try {
        return await runSetupWizard(options);
    } catch (error) {
        // Handle user cancellation (Ctrl+C) gracefully
        const err = error as Error & { code?: string };
        if (
            err &&
            (err.message?.includes("User force closed") ||
                err.message?.includes("ERR_USE_AFTER_CLOSE") ||
                err.code === "ERR_USE_AFTER_CLOSE")
        ) {
            console.log(chalk.yellow("\n✖ Setup cancelled by user"));
            process.exit(0);
        }
        throw error;
    }
}
