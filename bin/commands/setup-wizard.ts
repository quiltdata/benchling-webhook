#!/usr/bin/env node
/**
 * Interactive Configuration Wizard (v0.7.0)
 *
 * Complete setup wizard that orchestrates:
 * 1. Quilt configuration inference
 * 2. Interactive configuration prompts
 * 3. Configuration validation
 * 4. Profile persistence via XDGConfig
 *
 * Consolidated from scripts/install-wizard.ts, scripts/config/wizard.ts,
 * and scripts/config/validator.ts.
 *
 * @module commands/setup-wizard
 */

import * as https from "https";
import inquirer from "inquirer";
import chalk from "chalk";
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig, ValidationResult } from "../../lib/types/config";
import { inferQuiltConfig } from "../commands/infer-quilt-config";
import { isQueueUrl } from "../../lib/utils/sqs";
import { manifestCommand } from "./manifest";

// =============================================================================
// VALIDATION FUNCTIONS (from scripts/config/validator.ts)
// =============================================================================

/**
 * Validates Benchling tenant accessibility
 */
async function validateBenchlingTenant(tenant: string): Promise<ValidationResult> {
    const result: ValidationResult = {
        isValid: false,
        errors: [],
        warnings: [],
    };

    if (!tenant || tenant.trim().length === 0) {
        result.errors.push("Tenant name cannot be empty");
        return result;
    }

    // Basic format validation
    if (!/^[a-zA-Z0-9-_]+$/.test(tenant)) {
        result.errors.push("Tenant name contains invalid characters (only alphanumeric, dash, underscore allowed)");
        return result;
    }

    // Test tenant URL accessibility
    const tenantUrl = `https://${tenant}.benchling.com`;

    return new Promise((resolve) => {
        https
            .get(tenantUrl, { timeout: 5000 }, (res) => {
                if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 301) {
                    result.isValid = true;
                    console.log(`  ✓ Tenant URL accessible: ${tenantUrl}`);
                } else {
                    if (!result.warnings) result.warnings = [];
                    result.warnings.push(`Tenant URL returned status ${res.statusCode}`);
                    result.isValid = true; // Consider this a warning, not an error
                }
                resolve(result);
            })
            .on("error", (error) => {
                if (!result.warnings) result.warnings = [];
                result.warnings.push(`Could not verify tenant URL: ${error.message}`);
                result.isValid = true; // Allow proceeding with warning
                resolve(result);
            });
    });
}

/**
 * Validates Benchling OAuth credentials
 */
async function validateBenchlingCredentials(
    tenant: string,
    clientId: string,
    clientSecret: string,
): Promise<ValidationResult> {
    const result: ValidationResult = {
        isValid: false,
        errors: [],
        warnings: [],
    };

    if (!clientId || clientId.trim().length === 0) {
        result.errors.push("Client ID cannot be empty");
    }

    if (!clientSecret || clientSecret.trim().length === 0) {
        result.errors.push("Client secret cannot be empty");
    }

    if (result.errors.length > 0) {
        return result;
    }

    // Test OAuth token endpoint
    const tokenUrl = `https://${tenant}.benchling.com/api/v2/token`;
    const authString = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    return new Promise((resolve) => {
        const postData = "grant_type=client_credentials";

        const options: https.RequestOptions = {
            method: "POST",
            headers: {
                "Authorization": `Basic ${authString}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": postData.length,
            },
            timeout: 10000,
        };

        const req = https.request(tokenUrl, options, (res) => {
            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                if (res.statusCode === 200) {
                    result.isValid = true;
                    console.log("  ✓ OAuth credentials validated successfully");
                } else {
                    result.errors.push(
                        `OAuth validation failed with status ${res.statusCode}: ${data.substring(0, 100)}`,
                    );
                }
                resolve(result);
            });
        });

        req.on("error", (error) => {
            if (!result.warnings) result.warnings = [];
            result.warnings.push(`Could not validate OAuth credentials: ${error.message}`);
            result.isValid = true; // Allow proceeding with warning
            resolve(result);
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Validates S3 bucket access
 */
async function validateS3BucketAccess(
    bucketName: string,
    region: string,
    awsProfile?: string,
): Promise<ValidationResult> {
    const result: ValidationResult = {
        isValid: false,
        errors: [],
        warnings: [],
    };

    if (!bucketName || bucketName.trim().length === 0) {
        result.errors.push("Bucket name cannot be empty");
        return result;
    }

    try {
        const clientConfig: { region: string; credentials?: AwsCredentialIdentityProvider } = { region };

        if (awsProfile) {
            const { fromIni } = await import("@aws-sdk/credential-providers");
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        const s3Client = new S3Client(clientConfig);

        // Test HeadBucket (verify bucket exists and we have access)
        const headCommand = new HeadBucketCommand({ Bucket: bucketName });
        await s3Client.send(headCommand);

        console.log(`  ✓ S3 bucket accessible: ${bucketName}`);

        // Test ListObjects (verify we can list objects)
        const listCommand = new ListObjectsV2Command({
            Bucket: bucketName,
            MaxKeys: 1,
        });
        await s3Client.send(listCommand);

        console.log("  ✓ S3 bucket list permission confirmed");

        result.isValid = true;
    } catch (error) {
        const err = error as Error;
        result.errors.push(`S3 bucket validation failed: ${err.message}`);
    }

    return result;
}

/**
 * Validates complete ProfileConfig
 */
async function validateConfig(
    config: {
        benchling: { tenant: string; clientId: string; clientSecret?: string };
        packages: { bucket: string };
        deployment: { region: string };
    },
    options: { skipValidation?: boolean; awsProfile?: string } = {},
): Promise<ValidationResult> {
    const result: ValidationResult = {
        isValid: true,
        errors: [],
        warnings: [],
    };

    if (options.skipValidation) {
        return result;
    }

    // Validate Benchling tenant
    const tenantValidation = await validateBenchlingTenant(config.benchling.tenant);
    if (!tenantValidation.isValid) {
        result.isValid = false;
        result.errors.push(...tenantValidation.errors);
    }
    if (tenantValidation.warnings && tenantValidation.warnings.length > 0) {
        if (!result.warnings) result.warnings = [];
        result.warnings.push(...tenantValidation.warnings);
    }

    // Validate OAuth credentials (if secret is provided)
    if (config.benchling.clientSecret) {
        const credValidation = await validateBenchlingCredentials(
            config.benchling.tenant,
            config.benchling.clientId,
            config.benchling.clientSecret,
        );
        if (!credValidation.isValid) {
            result.isValid = false;
            result.errors.push(...credValidation.errors);
        }
        if (credValidation.warnings && credValidation.warnings.length > 0) {
            if (!result.warnings) result.warnings = [];
            result.warnings.push(...credValidation.warnings);
        }
    }

    // Validate S3 bucket access
    const bucketValidation = await validateS3BucketAccess(
        config.packages.bucket,
        config.deployment.region,
        options.awsProfile,
    );
    if (!bucketValidation.isValid) {
        result.isValid = false;
        result.errors.push(...bucketValidation.errors);
    }
    if (bucketValidation.warnings && bucketValidation.warnings.length > 0) {
        if (!result.warnings) result.warnings = [];
        result.warnings.push(...bucketValidation.warnings);
    }

    return result;
}

// =============================================================================
// INTERACTIVE WIZARD PROMPTS (from scripts/config/wizard.ts)
// =============================================================================

/**
 * Wizard options
 */
interface WizardOptions {
    existingConfig?: Partial<ProfileConfig>;
    nonInteractive?: boolean;
    inheritFrom?: string;
}

/**
 * Runs interactive configuration wizard
 */
async function runConfigWizard(options: WizardOptions = {}): Promise<ProfileConfig> {
    const { existingConfig = {}, nonInteractive = false, inheritFrom } = options;

    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Benchling Webhook Configuration Wizard                 ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    if (inheritFrom) {
        console.log(`Creating profile inheriting from: ${inheritFrom}\n`);
    }

    const config: Partial<ProfileConfig> = { ...existingConfig };
    let awsAccountId: string | undefined;

    // If non-interactive, validate that all required fields are present
    if (nonInteractive) {
        if (!config.benchling?.tenant || !config.benchling?.clientId || !config.benchling?.clientSecret) {
            throw new Error(
                "Non-interactive mode requires benchlingTenant, benchlingClientId, and benchlingClientSecret to be already configured",
            );
        }

        // Add metadata and inheritance marker before returning
        const now = new Date().toISOString();
        const finalConfig = config as ProfileConfig;
        finalConfig._metadata = {
            version: "0.7.0",
            createdAt: config._metadata?.createdAt || now,
            updatedAt: now,
            source: "wizard",
        };

        if (inheritFrom) {
            finalConfig._inherits = inheritFrom;
        }

        return finalConfig;
    }

    // Prompt for Quilt configuration (if not inherited)
    if (!inheritFrom) {
        console.log("Step 1: Quilt Configuration\n");

        const quiltAnswers = await inquirer.prompt([
            {
                type: "input",
                name: "stackArn",
                message: "Quilt Stack ARN:",
                default: config.quilt?.stackArn,
                validate: (input: string): boolean | string =>
                    input.trim().length > 0 && input.startsWith("arn:aws:cloudformation:") ||
                    "Stack ARN is required and must start with arn:aws:cloudformation:",
            },
            {
                type: "input",
                name: "catalog",
                message: "Quilt Catalog URL (domain or full URL):",
                default: config.quilt?.catalog,
                validate: (input: string): boolean | string => {
                    const trimmed = input.trim();
                    if (trimmed.length === 0) {
                        return "Catalog URL is required";
                    }
                    return true;
                },
                filter: (input: string): string => {
                    // Strip protocol if present, store only domain
                    return input.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
                },
            },
            {
                type: "input",
                name: "database",
                message: "Quilt Athena Database:",
                default: config.quilt?.database || "quilt_catalog",
                validate: (input: string): boolean | string =>
                    input.trim().length > 0 || "Database name is required",
            },
            {
                type: "input",
                name: "queueUrl",
                message: "SQS Queue URL:",
                default: config.quilt?.queueUrl,
                validate: (input: string): boolean | string => {
                    return isQueueUrl(input) ||
                        "Queue URL is required and must look like https://sqs.<region>.amazonaws.com/<account>/<queue>";
                },
            },
        ]);

        // Extract region and account ID from stack ARN
        // ARN format: arn:aws:cloudformation:REGION:ACCOUNT_ID:stack/STACK_NAME/STACK_ID
        const arnMatch = quiltAnswers.stackArn.match(/^arn:aws:cloudformation:([^:]+):(\d{12}):/);
        const quiltRegion = arnMatch ? arnMatch[1] : "us-east-1";
        awsAccountId = arnMatch ? arnMatch[2] : undefined;

        config.quilt = {
            stackArn: quiltAnswers.stackArn,
            catalog: quiltAnswers.catalog,
            database: quiltAnswers.database,
            queueUrl: quiltAnswers.queueUrl,
            region: quiltRegion,
        };
    }

    // Prompt for Benchling configuration
    console.log("\nStep 2: Benchling Configuration\n");

    // First, get tenant
    const tenantAnswer = await inquirer.prompt([
        {
            type: "input",
            name: "tenant",
            message: "Benchling Tenant:",
            default: config.benchling?.tenant,
            validate: (input: string): boolean | string =>
                input.trim().length > 0 || "Tenant is required",
        },
    ]);

    // Ask if they have an app_definition_id BEFORE asking for credentials
    const hasAppDefId = await inquirer.prompt([
        {
            type: "confirm",
            name: "hasIt",
            message: "Do you have a Benchling App Definition ID for this app?",
            default: !!config.benchling?.appDefinitionId,
        },
    ]);

    let appDefinitionId: string;

    if (hasAppDefId.hasIt) {
        // They have it, ask for it
        const appDefAnswer = await inquirer.prompt([
            {
                type: "input",
                name: "appDefinitionId",
                message: "Benchling App Definition ID:",
                default: config.benchling?.appDefinitionId,
                validate: (input: string): boolean | string =>
                    input.trim().length > 0 || "App definition ID is required",
            },
        ]);
        appDefinitionId = appDefAnswer.appDefinitionId;
    } else {
        // They don't have it, create the manifest and show instructions
        console.log("\n" + chalk.blue("Creating app manifest...") + "\n");

        // Create manifest using the existing command
        await manifestCommand({
            catalog: config.quilt?.catalog,
            output: "app-manifest.yaml",
        });

        console.log("\n" + chalk.yellow("After you have installed the app in Benchling and have the App Definition ID, you can continue.") + "\n");

        // Now ask for the app definition ID
        const appDefAnswer = await inquirer.prompt([
            {
                type: "input",
                name: "appDefinitionId",
                message: "Benchling App Definition ID:",
                validate: (input: string): boolean | string =>
                    input.trim().length > 0 || "App definition ID is required",
            },
        ]);
        appDefinitionId = appDefAnswer.appDefinitionId;
    }

    // Now ask for OAuth credentials (which must come from the app)
    const credentialAnswers = await inquirer.prompt([
        {
            type: "input",
            name: "clientId",
            message: "Benchling OAuth Client ID (from the app above):",
            default: config.benchling?.clientId,
            validate: (input: string): boolean | string =>
                input.trim().length > 0 || "Client ID is required",
        },
        {
            type: "password",
            name: "clientSecret",
            message: config.benchling?.clientSecret
                ? "Benchling OAuth Client Secret (press Enter to keep existing):"
                : "Benchling OAuth Client Secret (from the app above):",
            validate: (input: string): boolean | string => {
                // If there's an existing secret and input is empty, we'll keep the existing one
                if (config.benchling?.clientSecret && input.trim().length === 0) {
                    return true;
                }
                return input.trim().length > 0 || "Client secret is required";
            },
        },
    ]);

    // Ask for optional test entry ID
    const testEntryAnswer = await inquirer.prompt([
        {
            type: "input",
            name: "testEntryId",
            message: "Benchling Test Entry ID (optional):",
            default: config.benchling?.testEntryId || "",
        },
    ]);

    // Handle empty password input - keep existing secret if user pressed Enter
    if (credentialAnswers.clientSecret.trim().length === 0 && config.benchling?.clientSecret) {
        credentialAnswers.clientSecret = config.benchling.clientSecret;
    }

    config.benchling = {
        tenant: tenantAnswer.tenant,
        clientId: credentialAnswers.clientId,
        clientSecret: credentialAnswers.clientSecret,
        appDefinitionId: appDefinitionId,
    };

    if (testEntryAnswer.testEntryId && testEntryAnswer.testEntryId.trim() !== "") {
        config.benchling!.testEntryId = testEntryAnswer.testEntryId;
    }

    // Prompt for package configuration
    console.log("\nStep 3: Package Configuration\n");

    const packageAnswers = await inquirer.prompt([
        {
            type: "input",
            name: "bucket",
            message: "Package S3 Bucket:",
            default: config.packages?.bucket,
            validate: (input: string): boolean | string =>
                input.trim().length > 0 || "Bucket name is required",
        },
        {
            type: "input",
            name: "prefix",
            message: "Package S3 prefix:",
            default: config.packages?.prefix || "benchling",
        },
        {
            type: "input",
            name: "metadataKey",
            message: "Package metadata key:",
            default: config.packages?.metadataKey || "experiment_id",
        },
    ]);

    config.packages = {
        bucket: packageAnswers.bucket,
        prefix: packageAnswers.prefix,
        metadataKey: packageAnswers.metadataKey,
    };

    // Prompt for deployment configuration
    console.log("\nStep 4: Deployment Configuration\n");

    const deploymentAnswers = await inquirer.prompt([
        {
            type: "input",
            name: "region",
            message: "AWS Deployment Region:",
            default: config.deployment?.region || config.quilt?.region || "us-east-1",
        },
        {
            type: "input",
            name: "account",
            message: "AWS Account ID:",
            default: config.deployment?.account || awsAccountId || config.quilt?.stackArn?.match(/:(\d{12}):/)?.[1],
            validate: (input: string): boolean | string => {
                if (!input || input.trim().length === 0) {
                    return "AWS Account ID is required";
                }
                if (!/^\d{12}$/.test(input.trim())) {
                    return "AWS Account ID must be a 12-digit number";
                }
                return true;
            },
        },
    ]);

    config.deployment = {
        region: deploymentAnswers.region,
        account: deploymentAnswers.account,
    };

    // Optional: Logging configuration
    console.log("\nStep 5: Optional Configuration\n");

    const optionalAnswers = await inquirer.prompt([
        {
            type: "list",
            name: "logLevel",
            message: "Log level:",
            choices: ["DEBUG", "INFO", "WARNING", "ERROR"],
            default: config.logging?.level || "INFO",
        },
        {
            type: "input",
            name: "webhookAllowList",
            message: "Webhook IP allowlist (comma-separated, empty for none):",
            default: config.security?.webhookAllowList || "",
        },
    ]);

    config.logging = {
        level: optionalAnswers.logLevel as "DEBUG" | "INFO" | "WARNING" | "ERROR",
    };

    config.security = {
        enableVerification: true,
        webhookAllowList: optionalAnswers.webhookAllowList,
    };

    // Add metadata
    const now = new Date().toISOString();
    config._metadata = {
        version: "0.7.0",
        createdAt: config._metadata?.createdAt || now,
        updatedAt: now,
        source: "wizard",
    };

    // Add inheritance marker if specified
    if (inheritFrom) {
        config._inherits = inheritFrom;
    }

    return config as ProfileConfig;
}

// =============================================================================
// MAIN WIZARD ORCHESTRATION (from scripts/install-wizard.ts)
// =============================================================================

/**
 * Install wizard options
 */
export interface InstallWizardOptions {
    profile?: string;
    inheritFrom?: string;
    nonInteractive?: boolean;
    skipValidation?: boolean;
    skipSecretsSync?: boolean;
    awsProfile?: string;
    awsRegion?: string;
}

/**
 * Main install wizard function
 *
 * Orchestrates the complete configuration workflow:
 * 1. Load existing configuration (if any)
 * 2. Infer Quilt configuration from AWS
 * 3. Run interactive prompts for missing fields
 * 4. Validate configuration
 * 5. Save to XDG config directory
 * 6. Sync secrets to AWS Secrets Manager
 */
async function runInstallWizard(options: InstallWizardOptions = {}): Promise<ProfileConfig> {
    const {
        profile = "default",
        inheritFrom,
        nonInteractive = false,
        skipValidation = false,
        skipSecretsSync = false,
        awsProfile,
        awsRegion = "us-east-1",
    } = options;

    const xdg = new XDGConfig();

    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Benchling Webhook Setup (v0.7.0)                        ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    // Step 1: Load existing configuration (if profile exists)
    let existingConfig: Partial<ProfileConfig> | undefined;

    // Determine if we should inherit from 'default' when profile is not 'default'
    const shouldInheritFromDefault = profile !== "default" && !inheritFrom;
    const effectiveInheritFrom = inheritFrom || (shouldInheritFromDefault ? "default" : undefined);

    if (xdg.profileExists(profile)) {
        console.log(`Loading existing configuration for profile: ${profile}\n`);
        try {
            existingConfig = effectiveInheritFrom
                ? xdg.readProfileWithInheritance(profile, effectiveInheritFrom)
                : xdg.readProfile(profile);
        } catch (error) {
            console.warn(`Warning: Could not load existing config: ${(error as Error).message}`);
        }
    } else if (effectiveInheritFrom) {
        // If profile doesn't exist but we should inherit, load base profile
        console.log(`Creating new profile '${profile}' inheriting from '${effectiveInheritFrom}'\n`);
        try {
            existingConfig = xdg.readProfile(effectiveInheritFrom);
        } catch (error) {
            throw new Error(`Base profile '${effectiveInheritFrom}' not found: ${(error as Error).message}`);
        }
    }

    // Step 2: Infer Quilt configuration (unless inheriting from another profile)
    let quiltConfig: Partial<ProfileConfig["quilt"]> = existingConfig?.quilt || {};
    let inferredAccountId: string | undefined;

    if (!effectiveInheritFrom || !existingConfig?.quilt) {
        console.log("Step 1: Inferring Quilt configuration from AWS...\n");

        try {
            const inferenceResult = await inferQuiltConfig({
                region: awsRegion,
                profile: awsProfile,
                interactive: !nonInteractive,
            });

            quiltConfig = inferenceResult;
            inferredAccountId = inferenceResult.account;

            console.log("✓ Quilt configuration inferred\n");
        } catch (error) {
            console.error(`Failed to infer Quilt configuration: ${(error as Error).message}`);

            if (nonInteractive) {
                throw error;
            }

            const { continueManually } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "continueManually",
                    message: "Continue and enter Quilt configuration manually?",
                    default: true,
                },
            ]);

            if (!continueManually) {
                throw new Error("Setup aborted by user");
            }
        }
    }

    // Merge inferred Quilt config with existing config
    const partialConfig: Partial<ProfileConfig> = {
        ...existingConfig,
        quilt: {
            ...existingConfig?.quilt,
            ...quiltConfig,
        } as ProfileConfig["quilt"],
        // Pass through inferred account ID for deployment config
        deployment: {
            ...existingConfig?.deployment,
            account: existingConfig?.deployment?.account || inferredAccountId,
        } as ProfileConfig["deployment"],
    };

    // Step 3: Run interactive wizard for remaining configuration
    const config = await runConfigWizard({
        existingConfig: partialConfig,
        nonInteractive,
        inheritFrom: effectiveInheritFrom,
    });

    // Step 4: Validate configuration
    if (!skipValidation) {
        console.log("\nValidating configuration...\n");

        const validation = await validateConfig(config, {
            skipValidation,
            awsProfile,
        });

        if (!validation.isValid) {
            console.error("\n❌ Configuration validation failed:");
            validation.errors.forEach((err) => console.error(`  - ${err}`));

            if (nonInteractive) {
                throw new Error("Configuration validation failed");
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
        } else {
            console.log("✓ Configuration validated successfully\n");
        }

        if (validation.warnings && validation.warnings.length > 0) {
            console.warn("\n⚠ Warnings:");
            validation.warnings.forEach((warn) => console.warn(`  - ${warn}`));
            console.log("");
        }
    }

    // Step 5: Save configuration
    console.log(`Saving configuration to profile: ${profile}...\n`);

    try {
        xdg.writeProfile(profile, config);
        console.log(`✓ Configuration saved to: ~/.config/benchling-webhook/${profile}/config.json\n`);
    } catch (error) {
        throw new Error(`Failed to save configuration: ${(error as Error).message}`);
    }

    // Step 6: Sync secrets to AWS Secrets Manager
    if (!skipSecretsSync) {
        console.log("Syncing secrets to AWS Secrets Manager...\n");

        try {
            const { syncSecretsToAWS } = await import("./sync-secrets");
            await syncSecretsToAWS({
                profile,
                awsProfile,
                region: awsRegion,
                force: true,
            });

            console.log(`✓ Secrets synced to AWS Secrets Manager\n`);
        } catch (error) {
            console.warn(chalk.yellow(`⚠️  Failed to sync secrets: ${(error as Error).message}`));
            console.warn(chalk.yellow("   You can sync secrets manually later with:"));
            console.warn(chalk.cyan(`   npm run setup:sync-secrets -- --profile ${profile}\n`));
        }
    }

    // Step 7: Display next steps
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Setup Complete!                                         ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    console.log("Next steps:");
    if (profile === "default") {
        console.log("  1. Deploy to AWS: npm run deploy");
        console.log("  2. Test integration: npm run test\n");
    } else if (profile === "dev") {
        console.log("  1. Deploy to AWS: npm run deploy:dev");
        console.log("  2. Test integration: npm run test:dev\n");
    } else if (profile === "prod") {
        console.log("  1. Deploy to AWS: npm run deploy:prod");
        console.log("  2. Test integration: npm run test:prod\n");
    } else {
        // For custom profiles, show the full command
        console.log(`  1. Deploy to AWS: npx benchling-webhook deploy --profile ${profile} --stage ${profile}`);
        console.log(`  2. Test integration: npm run test:${profile}\n`);
    }

    return config;
}

// =============================================================================
// CLI COMMAND EXPORT
// =============================================================================

/**
 * Setup wizard command handler
 *
 * @param options - Wizard options
 * @returns Promise that resolves when wizard completes
 */
export async function setupWizardCommand(options: InstallWizardOptions = {}): Promise<void> {
    try {
        await runInstallWizard(options);
    } catch (error) {
        // Handle user cancellation (Ctrl+C) gracefully
        const err = error as Error & { code?: string };
        if (err &&
            (err.message?.includes("User force closed") ||
             err.message?.includes("ERR_USE_AFTER_CLOSE") ||
             err.code === "ERR_USE_AFTER_CLOSE")) {
            console.log(chalk.yellow("\n✖ Setup cancelled by user"));
            process.exit(0);
        }
        throw error;
    }
}
