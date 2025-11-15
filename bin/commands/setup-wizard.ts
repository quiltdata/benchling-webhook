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
import { S3Client, HeadBucketCommand, ListObjectsV2Command, GetBucketLocationCommand } from "@aws-sdk/client-s3";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig, ValidationResult } from "../../lib/types/config";
import { inferQuiltConfig } from "../commands/infer-quilt-config";
import { isQueueUrl } from "../../lib/utils/sqs";
import { manifestCommand } from "./manifest";
import { generateNextSteps } from "../../lib/next-steps-generator";

// =============================================================================
// VALIDATION FUNCTIONS (from scripts/config/validator.ts)
// =============================================================================

/**
 * Detects the actual region of an S3 bucket
 *
 * @param bucketName - Name of the S3 bucket
 * @param awsProfile - Optional AWS profile to use
 * @returns The bucket's actual region, or null if detection fails
 */
async function detectBucketRegion(bucketName: string, awsProfile?: string): Promise<string | null> {
    try {
        const clientConfig: { region: string; credentials?: AwsCredentialIdentityProvider } = {
            region: "us-east-1", // Use us-east-1 as the API endpoint for GetBucketLocation
        };

        if (awsProfile) {
            const { fromIni } = await import("@aws-sdk/credential-providers");
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        const s3Client = new S3Client(clientConfig);
        const command = new GetBucketLocationCommand({ Bucket: bucketName });
        const response = await s3Client.send(command);

        // AWS returns null for us-east-1, otherwise returns the region constraint
        const region = response.LocationConstraint || "us-east-1";
        return region;
    } catch {
        // If we can't detect the region, return null and let validation proceed with the provided region
        return null;
    }
}

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
    console.log(`  Testing Benchling tenant URL: ${tenantUrl}`);

    return new Promise((resolve) => {
        https
            .get(tenantUrl, { timeout: 5000 }, (res) => {
                if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 301) {
                    result.isValid = true;
                    console.log(`  ✓ Tenant URL accessible: ${tenantUrl}`);
                } else {
                    if (!result.warnings) result.warnings = [];
                    result.warnings.push(`Tenant URL ${tenantUrl} returned status ${res.statusCode}`);
                    result.isValid = true; // Consider this a warning, not an error
                }
                resolve(result);
            })
            .on("error", (error) => {
                if (!result.warnings) result.warnings = [];
                result.warnings.push(`Could not verify tenant URL ${tenantUrl}: ${error.message}`);
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
    console.log(`  Testing OAuth credentials: ${tokenUrl} (Client ID: ${clientId.substring(0, 8)}...)`);

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
                    let errorDetail = data.substring(0, 200);
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.error_description) {
                            errorDetail = parsed.error_description;
                        }
                    } catch {
                        // Keep the raw data if not JSON
                    }

                    result.errors.push(
                        `OAuth validation failed for tenant '${tenant}':\n` +
                        `    Tested: POST ${tokenUrl}\n` +
                        `    Status: ${res.statusCode}\n` +
                        `    Error: ${errorDetail}\n` +
                        "    Hint: Verify Client ID and Secret are correct and match the app definition",
                    );
                }
                resolve(result);
            });
        });

        req.on("error", (error) => {
            if (!result.warnings) result.warnings = [];
            result.warnings.push(
                `Could not validate OAuth credentials at ${tokenUrl}: ${error.message}\n` +
                "    This may be a network issue. Credentials will be validated during deployment.",
            );
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

    // First, try to detect the bucket's actual region
    console.log(`  Detecting region for bucket: ${bucketName}`);
    const actualRegion = await detectBucketRegion(bucketName, awsProfile);

    let regionToUse = region;
    if (actualRegion && actualRegion !== region) {
        console.log(`  ⚠ Bucket is in ${actualRegion}, not ${region} - using detected region`);
        regionToUse = actualRegion;
    } else if (actualRegion) {
        console.log(`  ✓ Bucket region confirmed: ${actualRegion}`);
    }

    try {
        const clientConfig: { region: string; credentials?: AwsCredentialIdentityProvider } = { region: regionToUse };

        if (awsProfile) {
            const { fromIni } = await import("@aws-sdk/credential-providers");
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        const s3Client = new S3Client(clientConfig);

        // Test HeadBucket (verify bucket exists and we have access)
        console.log(`  Testing S3 bucket access: ${bucketName} (region: ${regionToUse}${awsProfile ? `, profile: ${awsProfile}` : ""})`);
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
        const err = error as Error & { Code?: string; name?: string; $metadata?: { httpStatusCode?: number } };
        const errorCode = err.Code || err.name || "UnknownError";
        const errorMsg = err.message || "Unknown error occurred";
        const statusCode = err.$metadata?.httpStatusCode;

        // Provide specific guidance based on error type
        let hint = "Verify bucket exists, region is correct, and you have s3:GetBucketLocation and s3:ListBucket permissions";
        if (errorCode === "NoSuchBucket" || errorMsg.includes("does not exist")) {
            hint = "The bucket does not exist. Verify the bucket name is correct.";
        } else if (errorCode === "AccessDenied" || errorCode === "403" || statusCode === 403) {
            hint = "Access denied. Verify your AWS credentials have s3:GetBucketLocation and s3:ListBucket permissions for this bucket.";
        } else if (errorCode === "PermanentRedirect" || errorCode === "301" || statusCode === 301) {
            hint = `The bucket exists but is in a different region. Try specifying the correct region for bucket '${bucketName}'.`;
        }

        result.errors.push(
            `S3 bucket validation failed for '${bucketName}' in region '${regionToUse}'${awsProfile ? ` (AWS profile: ${awsProfile})` : ""}:\n` +
            `    Error: ${errorCode}${statusCode ? ` (HTTP ${statusCode})` : ""}\n` +
            `    Message: ${errorMsg}\n` +
            "    Tested: HeadBucket operation\n" +
            `    Hint: ${hint}`,
        );
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
    yes?: boolean;
    inheritFrom?: string;
}

/**
 * Runs interactive configuration wizard
 */
async function runConfigWizard(options: WizardOptions = {}): Promise<ProfileConfig> {
    const { existingConfig = {}, yes = false, inheritFrom } = options;

    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Benchling Webhook Configuration Wizard                 ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    if (inheritFrom) {
        console.log(`Creating profile inheriting from: ${inheritFrom}\n`);
    }

    const config: Partial<ProfileConfig> = { ...existingConfig };
    let awsAccountId: string | undefined;

    // If non-interactive, validate that all required fields are present
    if (yes) {
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

    // Always prompt for Quilt configuration (use existing/inferred values as defaults)
    console.log("Step 1: Quilt Configuration\n");

    const quiltAnswers = await inquirer.prompt([
        {
            type: "input",
            name: "catalog",
            message: "Quilt Catalog DNS name (e.g., open.quiltdata.com):",
            default: config.quilt?.catalog,
            validate: (input: string): boolean | string => {
                const trimmed = input.trim();
                if (trimmed.length === 0) {
                    return "Catalog DNS name is required";
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
            name: "stackArn",
            message: "Quilt Stack ARN:",
            default: config.quilt?.stackArn,
            validate: (input: string): boolean | string =>
                input.trim().length > 0 && input.startsWith("arn:aws:cloudformation:") ||
                "Stack ARN is required and must start with arn:aws:cloudformation:",
        },
        {
            type: "input",
            name: "database",
            message: "Quilt Athena Database:",
            // NOTE: "quilt_catalog" is a prompt default ONLY, NOT an OPTIONAL preset
            // This field is REQUIRED - users must provide a value or it must be inferred from Quilt stack
            // With --yes flag, this prompt should NOT be skipped even though it has a default here
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

    // Prompt for Benchling configuration
    console.log("\nStep 2: Benchling Configuration\n");

    // Check if there's an existing BenchlingSecret ARN from the Quilt stack
    let useStackSecret = false;
    if (config.benchling?.secretArn) {
        console.log(chalk.green(`✓ Found BenchlingSecret in Quilt stack: ${config.benchling.secretArn}\n`));
        const secretChoice = await inquirer.prompt([
            {
                type: "list",
                name: "choice",
                message: "How do you want to handle Benchling credentials?",
                choices: [
                    { name: "Use this secret (will write credentials into it)", value: "use" },
                    { name: "Create a new secret instead", value: "new" },
                ],
                default: "use",
            },
        ]);
        useStackSecret = secretChoice.choice === "use";

        if (useStackSecret) {
            console.log(chalk.blue("\nWill store credentials in the Quilt stack's BenchlingSecret.\n"));
        } else {
            console.log(chalk.blue("\nWill create a new secret for Benchling credentials.\n"));
        }
    }

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

    // If user chose to use the stack secret, store the ARN
    if (useStackSecret && config.benchling?.secretArn) {
        config.benchling.secretArn = config.benchling.secretArn;
    }

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
            // NOTE: "benchling" is an OPTIONAL preset - can be auto-applied with --yes flag
            default: config.packages?.prefix || "benchling",
        },
        {
            type: "input",
            name: "metadataKey",
            message: "Package metadata key:",
            // NOTE: "experiment_id" is an OPTIONAL preset - can be auto-applied with --yes flag
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
            // Prefer inferred region from Quilt stack, then existing deployment config, then fallback
            default: config.quilt?.region || config.deployment?.region || "us-east-1",
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
    yes?: boolean;
    skipValidation?: boolean;
    skipSecretsSync?: boolean;
    awsProfile?: string;
    awsRegion?: string;
    isPartOfInstall?: boolean; // NEW: Suppress next steps if part of install command
}

/**
 * Setup wizard result (for Phase 3)
 */
export interface SetupWizardResult {
    success: boolean;
    profile: string;
    config: ProfileConfig;
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
async function runInstallWizard(options: InstallWizardOptions = {}): Promise<SetupWizardResult> {
    const {
        profile = "default",
        inheritFrom,
        yes = false,
        skipValidation = false,
        skipSecretsSync = false,
        awsProfile,
        awsRegion, // NO DEFAULT - let inferQuiltConfig fetch region from catalog's config.json
        isPartOfInstall = false, // NEW: Default to false for backward compatibility
    } = options;

    const xdg = new XDGConfig();

    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Benchling Webhook Setup (v0.7.0)                        ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    // Step 1: Load existing configuration (if profile exists) - for suggestions only
    let existingConfig: Partial<ProfileConfig> | undefined;

    if (xdg.profileExists(profile)) {
        console.log(`Loading existing configuration for profile: ${profile}\n`);
        try {
            existingConfig = xdg.readProfile(profile);
        } catch (error) {
            console.warn(`Warning: Could not load existing config: ${(error as Error).message}`);
        }
    } else if (inheritFrom) {
        // Only use explicit inheritFrom if specified (for suggestions)
        console.log(`Creating new profile '${profile}' with suggestions from '${inheritFrom}'\n`);
        try {
            existingConfig = xdg.readProfile(inheritFrom);
        } catch (error) {
            throw new Error(`Base profile '${inheritFrom}' not found: ${(error as Error).message}`);
        }
    }

    // Step 2: Always infer Quilt configuration from AWS (provides suggestions)
    let quiltConfig: Partial<ProfileConfig["quilt"]> = existingConfig?.quilt || {};
    let inferredAccountId: string | undefined;
    let inferredBenchlingSecretArn: string | undefined;

    console.log("Step 1: Inferring Quilt configuration from AWS...\n");

    try {
        const inferenceResult = await inferQuiltConfig({
            region: awsRegion,
            profile: awsProfile,
            interactive: !yes,
            yes: yes,
        });

        // Check if user wants manual selection (not an error - they just want to enter it themselves)
        if (inferenceResult.source === "manual-selection-required") {
            console.log("Will prompt for Quilt configuration manually.\n");
            // Keep any partial results but let wizard prompt for the rest
            quiltConfig = {
                ...quiltConfig,
                ...inferenceResult,
            };
        } else {
            // Merge inferred config with existing (inferred takes precedence as fresher data)
            quiltConfig = {
                ...quiltConfig,
                ...inferenceResult,
            };
            inferredAccountId = inferenceResult.account;
            inferredBenchlingSecretArn = inferenceResult.benchlingSecretArn;

            console.log("✓ Quilt configuration inferred\n");
        }
    } catch (error) {
        console.error(`Failed to infer Quilt configuration: ${(error as Error).message}`);

        if (yes) {
            throw error;
        }

        console.log("Will prompt for Quilt configuration manually.\n");
    }

    // Merge inferred/existing config as suggestions for the wizard
    const partialConfig: Partial<ProfileConfig> = {
        ...existingConfig,
        quilt: quiltConfig as ProfileConfig["quilt"],
        // Pass through inferred account ID for deployment config
        deployment: {
            ...existingConfig?.deployment,
            account: existingConfig?.deployment?.account || inferredAccountId,
        } as ProfileConfig["deployment"],
    };

    // Pass through BenchlingSecret ARN if found in Quilt stack
    if (inferredBenchlingSecretArn || existingConfig?.benchling?.secretArn) {
        (partialConfig as any).benchling = {
            ...existingConfig?.benchling,
            secretArn: existingConfig?.benchling?.secretArn || inferredBenchlingSecretArn,
        };
    }

    // Step 3: Run interactive wizard for all configuration (with inferred/existing values as suggestions)
    const config = await runConfigWizard({
        existingConfig: partialConfig,
        yes,
        inheritFrom, // Only pass explicit inheritFrom, not auto-derived
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
            console.error(chalk.gray("   The following validations were performed:"));
            console.error(chalk.gray(`   - Benchling tenant: ${config.benchling.tenant}`));
            console.error(chalk.gray(`   - OAuth credentials: Client ID ${config.benchling.clientId.substring(0, 8)}...`));
            console.error(chalk.gray(`   - S3 bucket: ${config.packages.bucket} (region: ${config.deployment.region})`));
            console.error("");
            validation.errors.forEach((err) => console.error(`${err}\n`));

            if (yes) {
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
            validation.warnings.forEach((warn) => console.warn(`  ${warn}\n`));
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
                // Use the deployment region from config (which defaults to Quilt stack region)
                region: config.deployment?.region,
                force: true,
            });

            console.log("✓ Secrets synced to AWS Secrets Manager\n");
        } catch (error) {
            console.warn(chalk.yellow(`⚠️  Failed to sync secrets: ${(error as Error).message}`));
            console.warn(chalk.yellow("   You can sync secrets manually later with:"));
            console.warn(chalk.cyan(`   npm run setup:sync-secrets -- --profile ${profile}\n`));
        }
    }

    // Step 7: Display next steps (only if NOT part of install command)
    if (!isPartOfInstall) {
        console.log("╔═══════════════════════════════════════════════════════════╗");
        console.log("║   Setup Complete!                                         ║");
        console.log("╚═══════════════════════════════════════════════════════════╝\n");

        // Use next steps generator (Phase 2: with context detection)
        const nextSteps = generateNextSteps({
            profile,
            stage: profile === "prod" ? "prod" : "dev",
        });
        console.log(nextSteps + "\n");
    }

    // Return result for install command orchestration
    return {
        success: true,
        profile,
        config,
    };
}

// =============================================================================
// CLI COMMAND EXPORT
// =============================================================================

/**
 * Setup wizard command handler
 *
 * @param options - Wizard options
 * @returns Promise that resolves with setup result
 */
export async function setupWizardCommand(options: InstallWizardOptions = {}): Promise<SetupWizardResult> {
    try {
        return await runInstallWizard(options);
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
