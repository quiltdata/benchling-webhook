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
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import inquirer from "inquirer";
import chalk from "chalk";
import boxen from "boxen";
import ora from "ora";
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig, ValidationResult } from "../../lib/types/config";
import { inferQuiltConfig } from "../commands/infer-quilt-config";
import { generateBenchlingManifest } from "./manifest";
import { syncSecretsToAWS } from "./sync-secrets";
import { deployCommand } from "./deploy";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../../package.json");

const MANIFEST_FILENAME = "benchling-app-manifest.yaml";

function getAccountFromStackArn(stackArn?: string): string | undefined {
    if (!stackArn) {
        return undefined;
    }

    const parts = stackArn.split(":");
    if (parts.length < 5) {
        return undefined;
    }

    const account = parts[4];
    return /^[0-9]{12}$/.test(account) ? account : undefined;
}

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

    // If non-interactive, validate that all required fields are present
    if (nonInteractive) {
        if (!config.benchling?.tenant || !config.benchling?.clientId || !config.benchling?.clientSecret) {
            throw new Error(
                "Non-interactive mode requires benchlingTenant, benchlingClientId, and benchlingClientSecret to be already configured",
            );
        }
        return config as ProfileConfig;
    }

    // Prompt for Quilt configuration (if not inherited)
    if (!inheritFrom) {
        // Check if all required Quilt fields are already present (from inference)
        // Note: bucket is optional and can be inferred from other sources if missing
        const hasAllQuiltFields =
            config.quilt?.stackArn &&
            config.quilt?.catalog &&
            config.quilt?.database &&
            config.quilt?.queueArn;

        let shouldPromptForQuilt = !hasAllQuiltFields;

        if (hasAllQuiltFields) {
            console.log("Step 1: Quilt Configuration (inferred from AWS)\n");
            console.log(`  Stack ARN: ${config.quilt!.stackArn}`);
            console.log(`  Catalog: ${config.quilt!.catalog}`);
            console.log(`  Database: ${config.quilt!.database}`);
            console.log(`  Queue ARN: ${config.quilt!.queueArn}`);
            if (config.quilt!.bucket) {
                console.log(`  Bucket: ${config.quilt!.bucket}`);
            }
            console.log("");

            const { confirmQuilt } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "confirmQuilt",
                    message: "Use these inferred Quilt settings?",
                    default: true,
                },
            ]);

            if (!confirmQuilt) {
                console.log("\nPlease enter Quilt configuration manually:\n");
                shouldPromptForQuilt = true;
            }
        }

        // Only prompt for Quilt fields if not all are present OR user chose to enter manually
        if (shouldPromptForQuilt) {
            if (!hasAllQuiltFields) {
                console.log("Step 1: Quilt Configuration\n");
                console.log("Note: Run 'npm run setup:infer' first to auto-detect Quilt stack\n");
            }

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
                    name: "bucket",
                    message: "Quilt S3 Bucket:",
                    default: config.quilt?.bucket,
                    validate: (input: string): boolean | string =>
                        input.trim().length > 0 || "Bucket name is required",
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
                    name: "queueArn",
                    message: "SQS Queue ARN:",
                    default: config.quilt?.queueArn,
                    validate: (input: string): boolean | string =>
                        input.trim().length > 0 && input.startsWith("arn:aws:sqs:") ||
                    "Queue ARN is required and must start with arn:aws:sqs:",
                },
            ]);

            // Extract region from stack ARN
            const arnMatch = quiltAnswers.stackArn.match(/^arn:aws:cloudformation:([^:]+):/);
            const quiltRegion = arnMatch ? arnMatch[1] : "us-east-1";

            config.quilt = {
                stackArn: quiltAnswers.stackArn,
                catalog: quiltAnswers.catalog,
                bucket: quiltAnswers.bucket,
                database: quiltAnswers.database,
                queueArn: quiltAnswers.queueArn,
                region: quiltRegion,
            };
        }
    }

    // Prompt for Benchling configuration & guide app setup
    console.log("\nStep 2: Create Benchling App\n");

    let benchlingTenant = config.benchling?.tenant?.trim();
    benchlingTenant = benchlingTenant && benchlingTenant.length > 0 ? benchlingTenant : undefined;

    if (nonInteractive) {
        if (!benchlingTenant) {
            throw new Error("Benchling tenant must be provided in non-interactive mode");
        }
    } else {
        while (!benchlingTenant) {
            const tenantAnswer = await inquirer.prompt([
                {
                    type: "input",
                    name: "tenant",
                    message: "Benchling tenant (e.g., 'acme' for acme.benchling.com):",
                    default: config.benchling?.tenant || "",
                    filter: (value: string): string => value.trim(),
                    validate: (input: string): boolean | string =>
                        input.trim().length > 0 || "Tenant is required",
                },
            ]);

            const candidateTenant = tenantAnswer.tenant.trim();
            const tenantValidation = await validateBenchlingTenant(candidateTenant);

            if (tenantValidation.isValid) {
                benchlingTenant = candidateTenant;
                if (tenantValidation.warnings && tenantValidation.warnings.length > 0) {
                    console.warn("");
                    console.warn("⚠ Tenant validation warnings:");
                    tenantValidation.warnings.forEach((warning) => console.warn(`  - ${warning}`));
                    console.warn("");
                }
            } else {
                console.error("\n❌ Benchling tenant validation failed:");
                tenantValidation.errors.forEach((err) => console.error(`  - ${err}`));
                console.log("");
            }
        }
    }

    let manifestPath = join(process.cwd(), MANIFEST_FILENAME);

    if (!nonInteractive) {
        const manifestContent = generateBenchlingManifest({
            catalogDomain: config.quilt?.catalog,
            version: pkg.version,
        });

        let shouldWriteManifest = true;

        if (existsSync(manifestPath)) {
            const { overwrite } = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "overwrite",
                    message: `A manifest already exists at ${manifestPath}. Overwrite it?`,
                    default: false,
                },
            ]);

            shouldWriteManifest = overwrite;

            if (!overwrite) {
                console.log(`\nUsing existing manifest: ${manifestPath}`);
            }
        }

        if (shouldWriteManifest) {
            writeFileSync(manifestPath, manifestContent, "utf-8");
            console.log(`\n✓ Generated app manifest: ${manifestPath}`);
        }

        const manifestAppName =
            config.quilt?.catalog && config.quilt.catalog.length > 0
                ? config.quilt.catalog.replace(/[.:]/g, "-")
                : "Quilt Integration";

        const instructions =
            chalk.bold("Create your Benchling app:\n\n") +
            `1. Open ${chalk.cyan(`https://${benchlingTenant}.benchling.com/admin/apps`)}\n` +
            "2. Click 'Create New App'\n" +
            `3. Upload the manifest: ${chalk.cyan(manifestPath)}\n` +
            "4. Create OAuth credentials and copy the Client ID / Secret\n" +
            "5. Install the app (leave webhook URL blank for now)\n" +
            "6. Copy the App Definition ID from the overview page\n";

        console.log();
        console.log(
            boxen(instructions, {
                padding: 1,
                borderColor: "blue",
                borderStyle: "round",
            }),
        );

        console.log();
        const { ready } = await inquirer.prompt([
            {
                type: "confirm",
                name: "ready",
                message: "Have you created and installed the Benchling app?",
                default: true,
            },
        ]);

        if (!ready) {
            console.log("\n⏸  Setup paused. Re-run when ready:\n");
            console.log(`  ${chalk.cyan("npx @quiltdata/benchling-webhook setup")}\n`);
            process.exit(0);
        }

        console.log(`Using manifest app name: ${manifestAppName}\n`);
    }

    let benchlingClientId = config.benchling?.clientId?.trim();
    let benchlingClientSecret = config.benchling?.clientSecret?.trim();
    let benchlingAppDefinitionId = config.benchling?.appDefinitionId?.trim();
    let benchlingTestEntryId = config.benchling?.testEntryId?.trim();

    if (nonInteractive) {
        if (!benchlingClientId || !benchlingClientSecret || !benchlingAppDefinitionId) {
            throw new Error(
                "Non-interactive mode requires Benchling clientId, clientSecret, and appDefinitionId to be configured",
            );
        }
    } else {
        let credentialsValid = false;

        while (!credentialsValid) {
            const credentialAnswers = await inquirer.prompt([
                {
                    type: "input",
                    name: "clientId",
                    message: "Benchling OAuth Client ID:",
                    default: benchlingClientId || "",
                    filter: (value: string): string => value.trim(),
                    validate: (input: string): boolean | string =>
                        input.trim().length > 0 || "Client ID is required",
                },
                {
                    type: "password",
                    name: "clientSecret",
                    message: benchlingClientSecret
                        ? "Benchling OAuth Client Secret (press Enter to keep existing):"
                        : "Benchling OAuth Client Secret:",
                },
                {
                    type: "input",
                    name: "appDefinitionId",
                    message: "Benchling App Definition ID:",
                    default: benchlingAppDefinitionId || "",
                    filter: (value: string): string => value.trim(),
                    validate: (input: string): boolean | string =>
                        input.trim().length > 0 || "App Definition ID is required",
                },
                {
                    type: "input",
                    name: "testEntryId",
                    message: "Benchling Test Entry ID (optional):",
                    default: benchlingTestEntryId || "",
                    filter: (value: string): string => value.trim(),
                },
            ]);

            const candidateSecret =
                credentialAnswers.clientSecret.trim().length === 0 && benchlingClientSecret
                    ? benchlingClientSecret
                    : credentialAnswers.clientSecret.trim();

            if (!candidateSecret) {
                console.error("\n❌ Benchling OAuth client secret is required\n");
                continue;
            }

            const spinner = ora("Validating Benchling credentials...").start();
            const validation = await validateBenchlingCredentials(
                benchlingTenant as string,
                credentialAnswers.clientId.trim(),
                candidateSecret,
            );

            if (validation.isValid) {
                spinner.succeed("Benchling credentials validated");
                if (validation.warnings && validation.warnings.length > 0) {
                    console.warn("\n⚠ Credential validation warnings:");
                    validation.warnings.forEach((warn) => console.warn(`  - ${warn}`));
                    console.warn("");
                }

                benchlingClientId = credentialAnswers.clientId.trim();
                benchlingClientSecret = candidateSecret;
                benchlingAppDefinitionId = credentialAnswers.appDefinitionId.trim();
                benchlingTestEntryId = credentialAnswers.testEntryId || undefined;
                credentialsValid = true;
            } else {
                spinner.fail("Benchling credential validation failed");
                console.error("");
                validation.errors.forEach((err) => console.error(`  - ${err}`));
                console.error("");

                const { retry } = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "retry",
                        message: "Credentials invalid. Try again?",
                        default: true,
                    },
                ]);

                if (!retry) {
                    throw new Error("Setup aborted due to invalid Benchling credentials");
                }
            }
        }
    }

    config.benchling = {
        tenant: benchlingTenant as string,
        clientId: benchlingClientId as string,
        clientSecret: benchlingClientSecret,
        appDefinitionId: benchlingAppDefinitionId as string,
    };

    if (benchlingTestEntryId && benchlingTestEntryId.length > 0) {
        config.benchling.testEntryId = benchlingTestEntryId;
    }

    // Prompt for package configuration
    console.log("\nPackage Storage Configuration\n");

    const packageAnswers = await inquirer.prompt([
        {
            type: "input",
            name: "bucket",
            message: "Package S3 Bucket:",
            default: config.packages?.bucket || config.quilt?.bucket,
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
    console.log("\nDeployment Defaults\n");

    const defaultAccount = config.deployment?.account || getAccountFromStackArn(config.quilt?.stackArn);

    const deploymentAnswers = await inquirer.prompt([
        {
            type: "input",
            name: "account",
            message: "AWS Account ID:",
            default: defaultAccount || "",
            filter: (value: string): string => value.trim(),
            validate: (input: string): boolean | string =>
                input.trim().length === 0 || /^[0-9]{12}$/.test(input.trim()) || "Account ID must be a 12 digit number",
        },
        {
            type: "input",
            name: "region",
            message: "AWS Deployment Region:",
            default: config.deployment?.region || config.quilt?.region || "us-east-1",
        },
        {
            type: "input",
            name: "imageTag",
            message: "Docker image tag:",
            default: config.deployment?.imageTag || "latest",
        },
    ]);

    config.deployment = {
        ...(deploymentAnswers.account ? { account: deploymentAnswers.account } : {}),
        region: deploymentAnswers.region,
        imageTag: deploymentAnswers.imageTag,
    };

    // Optional: Logging configuration
    console.log("\nSecurity and Logging Options\n");

    const optionalAnswers = await inquirer.prompt([
        {
            type: "list",
            name: "logLevel",
            message: "Log level:",
            choices: ["DEBUG", "INFO", "WARNING", "ERROR"],
            default: config.logging?.level || "INFO",
        },
        {
            type: "confirm",
            name: "enableVerification",
            message: "Enable webhook signature verification:",
            default: config.security?.enableVerification !== false,
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
        enableVerification: optionalAnswers.enableVerification,
        webhookAllowList: optionalAnswers.webhookAllowList,
    };

    // Add metadata
    const now = new Date().toISOString();
    config._metadata = {
        version: pkg.version,
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
    skipDeployment?: boolean;
    deployStage?: "dev" | "prod";
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
 */
async function runInstallWizard(options: InstallWizardOptions = {}): Promise<ProfileConfig> {
    const {
        profile = "default",
        inheritFrom,
        nonInteractive = false,
        skipValidation = false,
        skipSecretsSync = false,
        skipDeployment = false,
        deployStage = "prod",
        awsProfile,
        awsRegion = "us-east-1",
    } = options;

    const xdg = new XDGConfig();

    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    const headerLine = `║   Benchling Webhook Setup (v${pkg.version})`;
    console.log(`${headerLine.padEnd(59, " ")}║`);
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    // Step 1: Load existing configuration (if profile exists)
    let existingConfig: Partial<ProfileConfig> | undefined;

    if (xdg.profileExists(profile)) {
        console.log(`Loading existing configuration for profile: ${profile}\n`);
        try {
            existingConfig = inheritFrom
                ? xdg.readProfileWithInheritance(profile, inheritFrom)
                : xdg.readProfile(profile);
        } catch (error) {
            console.warn(`Warning: Could not load existing config: ${(error as Error).message}`);
        }
    } else if (inheritFrom) {
        console.log(`Creating new profile '${profile}' inheriting from '${inheritFrom}'\n`);
        try {
            existingConfig = xdg.readProfile(inheritFrom);
        } catch (error) {
            throw new Error(`Base profile '${inheritFrom}' not found: ${(error as Error).message}`);
        }
    }

    // Step 2: Infer Quilt configuration (unless inheriting from another profile)
    let quiltConfig: Partial<ProfileConfig["quilt"]> = existingConfig?.quilt || {};

    if (!inheritFrom || !existingConfig?.quilt) {
        console.log("Step 1: Inferring Quilt configuration from AWS...\n");

        try {
            const inferenceResult = await inferQuiltConfig({
                region: awsRegion,
                profile: awsProfile,
                interactive: !nonInteractive,
            });

            // Map InferenceResult to QuiltConfig fields
            if (inferenceResult.quiltStackArn) {
                quiltConfig.stackArn = inferenceResult.quiltStackArn;
            }
            if (inferenceResult.catalogUrl) {
                // Strip protocol and trailing slash to store only domain
                quiltConfig.catalog = inferenceResult.catalogUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
            }
            if (inferenceResult.quiltUserBucket) {
                quiltConfig.bucket = inferenceResult.quiltUserBucket;
            }
            if (inferenceResult.quiltDatabase) {
                quiltConfig.database = inferenceResult.quiltDatabase;
            }
            if (inferenceResult.queueArn) {
                quiltConfig.queueArn = inferenceResult.queueArn;
            }
            if (inferenceResult.quiltRegion) {
                quiltConfig.region = inferenceResult.quiltRegion;
            }

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
    };

    // Step 3: Run interactive wizard for remaining configuration
    let config = await runConfigWizard({
        existingConfig: partialConfig,
        nonInteractive,
        inheritFrom,
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

    // Step 5: Persist configuration locally
    console.log(`Saving configuration to profile: ${profile}...\n`);

    try {
        xdg.writeProfile(profile, config);
        console.log(chalk.green(`✓ Configuration saved: ~/.config/benchling-webhook/${profile}/config.json\n`));
    } catch (error) {
        throw new Error(`Failed to save configuration: ${(error as Error).message}`);
    }

    // Step 6: Sync secrets and deploy (unless skipped)
    console.log(chalk.bold("Step 3: Deploy Stack and Return Webhook URL\n"));

    if (skipSecretsSync) {
        console.log(chalk.yellow("Skipping secrets sync (--skip-secrets-sync)."));
        console.log(chalk.yellow(`Run \`npm run setup:sync-secrets -- --profile ${profile}\` when ready.\n`));
    } else {
        console.log("Syncing secrets to AWS Secrets Manager...\n");
        try {
            await syncSecretsToAWS({
                profile,
                awsProfile,
                region: config.deployment.region,
                force: true,
            });
            console.log(chalk.green("\n✓ Secrets synced to AWS Secrets Manager\n"));
            // Reload config to capture secret ARN written by sync
            config = xdg.readProfile(profile);
        } catch (error) {
            throw new Error(`Secrets sync failed: ${(error as Error).message}`);
        }
    }

    if (skipDeployment) {
        console.log(chalk.yellow("Skipping deployment (--skip-deployment)."));
        console.log(
            chalk.yellow(`Run \`npm run deploy -- --profile ${profile} --stage ${deployStage}\` to deploy later.\n`),
        );
        return config;
    }

    if (!nonInteractive) {
        console.log(
            `Deploy target: profile=${chalk.cyan(profile)}, stage=${chalk.cyan(deployStage)}, region=${chalk.cyan(
                config.deployment.region,
            )}\n`,
        );
        const { confirmDeploy } = await inquirer.prompt([
            {
                type: "confirm",
                name: "confirmDeploy",
                message: "Deploy AWS infrastructure now? (takes ~5-10 minutes)",
                default: true,
            },
        ]);

        if (!confirmDeploy) {
            console.log(chalk.yellow("\nDeployment skipped by user."));
            console.log(
                chalk.yellow(`Re-run with \`npm run deploy -- --profile ${profile} --stage ${deployStage}\` when ready.\n`),
            );
            return config;
        }
    }

    console.log("Deploying AWS infrastructure. This can take several minutes...\n");

    await deployCommand({
        profile,
        stage: deployStage,
        requireApproval: "never",
        yes: true,
    });

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
    await runInstallWizard(options);
}
