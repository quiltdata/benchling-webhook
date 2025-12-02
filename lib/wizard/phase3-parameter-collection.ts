/**
 * Phase 3: Parameter Collection
 *
 * Collects all required parameters from the user, using stack query results
 * as defaults to avoid re-prompting.
 *
 * @module wizard/phase3-parameter-collection
 */

import inquirer from "inquirer";
import chalk from "chalk";
import { manifestCommand } from "../../bin/commands/manifest";
import { ParameterCollectionInput, ParameterCollectionResult } from "./types";

/**
 * Phase 3: Parameter Collection
 *
 * Responsibilities:
 * - Collect Benchling credentials
 * - Collect package settings
 * - Collect deployment configuration
 * - Use stack query results as defaults (don't re-prompt)
 * - Return complete configuration
 *
 * @param input - Parameter collection input
 * @returns Parameter collection result
 */
export async function runParameterCollection(
    input: ParameterCollectionInput,
): Promise<ParameterCollectionResult> {
    const { stackQuery, existingConfig, yes = false } = input;

    // =========================================================================
    // VPC Configuration (FIRST - most important infrastructure decision)
    // =========================================================================
    console.log(chalk.cyan("VPC Configuration:"));

    let vpcId: string | undefined;

    // Use VPC discovered in Phase 2 (Stack Query)
    const discoveredVpc = stackQuery.discoveredVpc;

    if (discoveredVpc && discoveredVpc.isValid) {
        // Report discovered VPC
        const vpcDescription = discoveredVpc.name
            ? `${discoveredVpc.name} (${discoveredVpc.vpcId})`
            : discoveredVpc.vpcId;
        console.log(`  VPC: ${vpcDescription} - ${discoveredVpc.privateSubnetCount} private subnets in ${discoveredVpc.availabilityZoneCount} AZs`);

        // Warn about potential connectivity issues
        console.log(chalk.yellow("  ⚠ Warning: This VPC may block Benchling webhook access"));

        if (yes) {
            // In non-interactive mode, check if there's an existing VPC preference
            if (existingConfig?.deployment?.vpc?.vpcId) {
                vpcId = existingConfig.deployment.vpc.vpcId;
                console.log(chalk.dim(`  Using VPC: ${vpcId} (from existing config)`));
            } else {
                // Default to creating new VPC in non-interactive mode (safer default)
                vpcId = undefined;
                console.log(chalk.dim("  Will create new standalone VPC (recommended, safer default)"));
            }
        } else {
            // Interactive mode - ask if they want to create standalone VPC
            // Default to YES (create new VPC) unless existing config uses this VPC
            const defaultCreateStandalone = existingConfig?.deployment?.vpc?.vpcId !== discoveredVpc.vpcId;

            const { createStandaloneVpc } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "createStandaloneVpc",
                    message: "Create standalone VPC? (No = use existing VPC from stack)",
                    default: defaultCreateStandalone,
                },
            ]);

            vpcId = createStandaloneVpc ? undefined : discoveredVpc.vpcId;

            if (vpcId) {
                console.log(chalk.dim(`  Using existing VPC: ${vpcId}`));
            } else {
                console.log(chalk.dim("  Will create new standalone VPC (2 AZs, private subnets, NAT Gateways)"));
            }
        }
    } else {
        // No valid VPC discovered - will auto-create
        console.log("  VPC: Will create new standalone VPC (2 AZs, private subnets, NAT Gateways)");
        vpcId = undefined;
    }

    // =========================================================================
    // Benchling Configuration
    // =========================================================================
    console.log("\n" + chalk.cyan("Benchling Configuration:"));

    // Tenant
    let tenant: string;
    if (input.benchlingTenant) {
        tenant = input.benchlingTenant;
        console.log(`  Tenant: ${tenant} (from CLI)`);
    } else if (yes) {
        // In non-interactive mode, use existing config or error
        if (existingConfig?.benchling?.tenant) {
            tenant = existingConfig.benchling.tenant;
            console.log(`  Tenant: ${tenant} (from existing config)`);
        } else {
            throw new Error("--benchling-tenant is required in non-interactive mode");
        }
    } else {
        // Always show prompt with default from existing config
        const tenantAnswer = await inquirer.prompt([
            {
                type: "input",
                name: "tenant",
                message: "Benchling Tenant:",
                default: existingConfig?.benchling?.tenant || "",
                validate: (value: string): boolean | string =>
                    value.trim().length > 0 || "Tenant is required",
            },
        ]);
        tenant = tenantAnswer.tenant;
    }

    // Check if we have existing app - offer to reuse or create new
    let shouldReuseApp = true; // Default to reusing existing app
    const catalogChanged = existingConfig?.quilt?.catalog && existingConfig.quilt.catalog !== stackQuery.catalog;

    if (existingConfig?.benchling?.appDefinitionId && !yes) {
        // Show catalog change warning if applicable
        if (catalogChanged) {
            console.log("\n" + chalk.yellow(
                `Catalog changed from ${existingConfig.quilt.catalog} to ${stackQuery.catalog}`,
            ));
        }

        // Always ask if user wants to reuse existing app or create new one
        const { reuseApp } = await inquirer.prompt([
            {
                type: "confirm",
                name: "reuseApp",
                message: `Use existing app (${existingConfig.benchling.appDefinitionId})?`,
                default: true,
            },
        ]);

        shouldReuseApp = reuseApp;
        if (!shouldReuseApp) {
            console.log(chalk.dim("Will prompt for new app credentials\n"));
        }
    }

    // App Definition ID
    let appDefinitionId: string | undefined;
    let hasAppDefId = false;

    if (input.benchlingAppDefinitionId) {
        appDefinitionId = input.benchlingAppDefinitionId;
        hasAppDefId = true;
        console.log(`  App Definition ID: ${appDefinitionId} (from CLI)`);
    } else if (yes) {
        // In non-interactive mode, use existing config or error
        if (existingConfig?.benchling?.appDefinitionId && shouldReuseApp) {
            appDefinitionId = existingConfig.benchling.appDefinitionId;
            hasAppDefId = true;
            console.log(`  App Definition ID: ${appDefinitionId} (from existing config)`);
        } else {
            throw new Error("--benchling-app-definition-id is required in non-interactive mode");
        }
    } else if (existingConfig?.benchling?.appDefinitionId && shouldReuseApp) {
        // Have existing app ID and user chose to reuse - show prompt with default
        const appDefAnswer = await inquirer.prompt([
            {
                type: "input",
                name: "appDefinitionId",
                message: "Benchling App Definition ID:",
                default: existingConfig.benchling.appDefinitionId,
                validate: (value: string): boolean | string =>
                    value.trim().length > 0 || "App definition ID is required",
            },
        ]);
        appDefinitionId = appDefAnswer.appDefinitionId;
        hasAppDefId = true;
    } else if (!shouldReuseApp) {
        // User explicitly chose to create new app - skip to manifest generation
        hasAppDefId = false;
    } else {
        // No existing app ID and no choice made - ask if they have one
        const hasAppDefIdAnswer = await inquirer.prompt([
            {
                type: "confirm",
                name: "hasIt",
                message: "Do you have a Benchling App Definition ID for this app?",
                default: false,
            },
        ]);
        hasAppDefId = hasAppDefIdAnswer.hasIt;

        if (hasAppDefId) {
            // Prompt for it
            const appDefAnswer = await inquirer.prompt([
                {
                    type: "input",
                    name: "appDefinitionId",
                    message: "Benchling App Definition ID:",
                    validate: (value: string): boolean | string =>
                        value.trim().length > 0 || "App definition ID is required",
                },
            ]);
            appDefinitionId = appDefAnswer.appDefinitionId;
        }
    }

    if (!hasAppDefId) {
        // They don't have it - create manifest and guide them
        console.log("\n" + chalk.blue("Creating app manifest...") + "\n");

        await manifestCommand({
            catalog: stackQuery.catalog,
            output: "app-manifest.yaml",
        });

        console.log("\n" + chalk.yellow(
            "After you have installed the app in Benchling and have the App Definition ID, you can continue.",
        ) + "\n");

        // Now ask for the app definition ID
        const appDefAnswer = await inquirer.prompt([
            {
                type: "input",
                name: "appDefinitionId",
                message: "Benchling App Definition ID:",
                validate: (value: string): boolean | string =>
                    value.trim().length > 0 || "App definition ID is required to continue",
            },
        ]);
        appDefinitionId = appDefAnswer.appDefinitionId;
    }

    // Validation: Exit if no app definition ID
    if (!appDefinitionId || appDefinitionId.trim().length === 0) {
        console.log("\n" + chalk.red("Setup cannot continue without an App Definition ID."));
        console.log(chalk.yellow("Please install the app in Benchling first, then run setup again.\n"));
        process.exit(0);
    }

    // OAuth Credentials
    let clientId: string;
    let clientSecret: string;

    if (input.benchlingClientId && input.benchlingClientSecret) {
        clientId = input.benchlingClientId;
        clientSecret = input.benchlingClientSecret;
        console.log(`  Client ID: ${clientId.substring(0, 8)}... (from CLI)`);
        console.log("  Client Secret: ******** (from CLI)");
    } else if (yes) {
        // In non-interactive mode, use existing config or error
        if (existingConfig?.benchling?.clientId && existingConfig?.benchling?.clientSecret && shouldReuseApp) {
            clientId = existingConfig.benchling.clientId;
            clientSecret = existingConfig.benchling.clientSecret;
            console.log(`  Client ID: ${clientId.substring(0, 8)}... (from existing config)`);
            console.log("  Client Secret: ******** (from existing config)");
        } else {
            throw new Error("--benchling-client-id and --benchling-client-secret are required in non-interactive mode");
        }
    } else {
        // Always show prompts with defaults from existing config (only if reusing app)
        const hasExistingCreds = shouldReuseApp && existingConfig?.benchling?.clientId && existingConfig?.benchling?.clientSecret;
        const credentialAnswers = await inquirer.prompt([
            {
                type: "input",
                name: "clientId",
                message: "Benchling OAuth Client ID:",
                default: hasExistingCreds ? existingConfig?.benchling?.clientId : "",
                validate: (value: string): boolean | string =>
                    value.trim().length > 0 || "Client ID is required",
            },
            {
                type: "password",
                name: "clientSecret",
                message: "Benchling OAuth Client Secret" +
                    (hasExistingCreds ? " (press Enter to keep existing):" : ":"),
                default: hasExistingCreds ? existingConfig?.benchling?.clientSecret : "",
                validate: (value: string): boolean | string => {
                    // Allow empty input if we have existing credentials (will use default)
                    if (hasExistingCreds && value.trim().length === 0) {
                        return true;
                    }
                    return value.trim().length > 0 || "Client secret is required";
                },
            },
        ]);
        clientId = credentialAnswers.clientId;
        // If user pressed Enter with empty input and we have existing creds, use the existing secret
        clientSecret = credentialAnswers.clientSecret.trim() === "" && hasExistingCreds
            ? existingConfig!.benchling!.clientSecret!
            : credentialAnswers.clientSecret;
    }

    // Test Entry ID (optional) - can be reused even when creating new app
    let testEntryId: string | undefined;
    if (input.benchlingTestEntryId) {
        testEntryId = input.benchlingTestEntryId;
        console.log(`  Test Entry ID: ${testEntryId} (from CLI)`);
    } else if (yes) {
        // In non-interactive mode, use existing config if available
        testEntryId = existingConfig?.benchling?.testEntryId;
        if (testEntryId) {
            console.log(`  Test Entry ID: ${testEntryId} (from existing config)`);
        }
    } else {
        // Always show prompt with default from existing config (even for new apps)
        const existingTestEntryId = existingConfig?.benchling?.testEntryId;
        const testEntryAnswer = await inquirer.prompt([
            {
                type: "input",
                name: "testEntryId",
                message: "Benchling Test Entry ID (optional)" +
                    (existingTestEntryId ? " (press Enter to keep existing):" : ":"),
                default: existingTestEntryId || "",
            },
        ]);
        // Accept both empty (to keep existing) and new values
        if (testEntryAnswer.testEntryId && testEntryAnswer.testEntryId.trim() !== "") {
            testEntryId = testEntryAnswer.testEntryId.trim();
        } else if (existingTestEntryId) {
            // User pressed Enter with existing value - keep it
            testEntryId = existingTestEntryId;
        }
    }

    // =========================================================================
    // Package Configuration
    // =========================================================================
    console.log("\n" + chalk.cyan("Package Configuration:"));

    let bucket: string;
    let prefix: string;
    let metadataKey: string;

    if (input.userBucket && input.pkgPrefix && input.pkgKey) {
        bucket = input.userBucket;
        prefix = input.pkgPrefix;
        metadataKey = input.pkgKey;
        console.log(`  Bucket: ${bucket} (from CLI)`);
        console.log(`  Prefix: ${prefix} (from CLI)`);
        console.log(`  Metadata Key: ${metadataKey} (from CLI)`);
    } else if (yes) {
        // In non-interactive mode, use CLI args or existing config or error
        bucket = input.userBucket || existingConfig?.packages?.bucket || "";
        prefix = input.pkgPrefix || existingConfig?.packages?.prefix || "benchling";
        metadataKey = input.pkgKey || existingConfig?.packages?.metadataKey || "experiment_id";

        if (!bucket) {
            throw new Error("--user-bucket is required in non-interactive mode");
        }

        console.log(`  Bucket: ${bucket} (from ${input.userBucket ? "CLI" : "existing config"})`);
        console.log(`  Prefix: ${prefix} (from ${input.pkgPrefix ? "CLI" : existingConfig?.packages?.prefix ? "existing config" : "default"})`);
        console.log(`  Metadata Key: ${metadataKey} (from ${input.pkgKey ? "CLI" : existingConfig?.packages?.metadataKey ? "existing config" : "default"})`);
    } else {
        // Always show prompts with defaults from existing config
        const packageAnswers = await inquirer.prompt([
            {
                type: "input",
                name: "bucket",
                message: "Package S3 Bucket:",
                default: existingConfig?.packages?.bucket || "",
                validate: (value: string): boolean | string =>
                    value.trim().length > 0 || "Bucket name is required",
            },
            {
                type: "input",
                name: "prefix",
                message: "Package S3 prefix:",
                default: existingConfig?.packages?.prefix || "benchling",
            },
            {
                type: "input",
                name: "metadataKey",
                message: "Package metadata key:",
                default: existingConfig?.packages?.metadataKey || "experiment_id",
            },
        ]);
        bucket = packageAnswers.bucket;
        prefix = packageAnswers.prefix;
        metadataKey = packageAnswers.metadataKey;
    }

    // =========================================================================
    // Deployment Configuration
    // =========================================================================
    console.log("\n" + chalk.cyan("Deployment Configuration:"));

    const region = stackQuery.region;
    const account = stackQuery.account;

    console.log(`  Region: ${region} (from stack)`);
    console.log(`  Account: ${account} (from stack)`);

    // =========================================================================
    // Optional Configuration
    // =========================================================================
    console.log("\n" + chalk.cyan("Optional Configuration:"));

    let logLevel: "DEBUG" | "INFO" | "WARNING" | "ERROR";
    let webhookAllowList: string;

    if (input.logLevel && input.webhookAllowList !== undefined) {
        logLevel = input.logLevel as "DEBUG" | "INFO" | "WARNING" | "ERROR";
        webhookAllowList = input.webhookAllowList;
        console.log(`  Log Level: ${logLevel} (from CLI)`);
        console.log(`  Webhook Allow List: ${webhookAllowList || "(none)"} (from CLI)`);
    } else if (yes) {
        // In non-interactive mode, use CLI args or existing config or defaults
        logLevel = (input.logLevel as "DEBUG" | "INFO" | "WARNING" | "ERROR") || existingConfig?.logging?.level || "INFO";
        webhookAllowList = input.webhookAllowList ?? existingConfig?.security?.webhookAllowList ?? "";
        console.log(`  Log Level: ${logLevel} (from ${input.logLevel ? "CLI" : existingConfig?.logging?.level ? "existing config" : "default"})`);
        console.log(`  Webhook Allow List: ${webhookAllowList || "(none)"} (from ${input.webhookAllowList !== undefined ? "CLI" : existingConfig?.security?.webhookAllowList ? "existing config" : "default"})`);
    } else {
        // Always show prompts with defaults from existing config
        const optionalAnswers = await inquirer.prompt([
            {
                type: "list",
                name: "logLevel",
                message: "Log level:",
                choices: ["DEBUG", "INFO", "WARNING", "ERROR"],
                default: existingConfig?.logging?.level || "INFO",
            },
            {
                type: "input",
                name: "webhookAllowList",
                message: "Webhook IP allowlist (comma-separated, empty for none):",
                default: existingConfig?.security?.webhookAllowList || "",
            },
        ]);
        logLevel = optionalAnswers.logLevel;
        webhookAllowList = optionalAnswers.webhookAllowList;
    }

    console.log(""); // Empty line for spacing

    return {
        benchling: {
            tenant,
            clientId,
            clientSecret,
            appDefinitionId,
            testEntryId,
        },
        packages: {
            bucket,
            prefix,
            metadataKey,
        },
        deployment: {
            region,
            account,
            vpc: vpcId && discoveredVpc ? {
                vpcId,
                privateSubnetIds: discoveredVpc.privateSubnetIds,
                publicSubnetIds: discoveredVpc.publicSubnetIds,
                availabilityZones: discoveredVpc.availabilityZones,
                vpcCidrBlock: discoveredVpc.cidrBlock,
            } : undefined,
        },
        logging: {
            level: logLevel,
        },
        security: {
            enableVerification: true,
            webhookAllowList,
        },
    };
}
