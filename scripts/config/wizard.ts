/**
 * Interactive Configuration Wizard
 *
 * Provides interactive prompts for collecting configuration details.
 * Extracted from setup-wizard for better modularity.
 *
 * @module scripts/config/wizard
 */

import inquirer from "inquirer";
import { ProfileConfig } from "../../lib/types/config";

/**
 * Wizard options
 */
export interface WizardOptions {
    existingConfig?: Partial<ProfileConfig>;
    nonInteractive?: boolean;
    inheritFrom?: string;
}

/**
 * Runs interactive configuration wizard
 *
 * Prompts user for all required configuration fields.
 * Supports profile inheritance via `inheritFrom` option.
 *
 * @param options - Wizard options
 * @returns Complete profile configuration
 *
 * @example
 * ```typescript
 * const config = await runConfigWizard({
 *   existingConfig: existingProfile,
 *   nonInteractive: false
 * });
 * ```
 */
export async function runConfigWizard(options: WizardOptions = {}): Promise<ProfileConfig> {
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
        console.log("Step 1: Quilt Configuration\n");
        console.log("Note: Run 'npm run setup:infer' first to auto-detect Quilt stack\n");

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
                message: "Quilt Catalog URL:",
                default: config.quilt?.catalog,
                validate: (input: string): boolean | string =>
                    input.trim().length > 0 && input.startsWith("http") ||
                    "Catalog URL is required and must start with http",
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

    // Prompt for Benchling configuration
    console.log("\nStep 2: Benchling Configuration\n");

    const benchlingAnswers = await inquirer.prompt([
        {
            type: "input",
            name: "tenant",
            message: "Benchling Tenant:",
            default: config.benchling?.tenant,
            validate: (input: string): boolean | string =>
                input.trim().length > 0 || "Tenant is required",
        },
        {
            type: "input",
            name: "clientId",
            message: "Benchling OAuth Client ID:",
            default: config.benchling?.clientId,
            validate: (input: string): boolean | string =>
                input.trim().length > 0 || "Client ID is required",
        },
        {
            type: "password",
            name: "clientSecret",
            message: config.benchling?.clientSecret
                ? "Benchling OAuth Client Secret (press Enter to keep existing):"
                : "Benchling OAuth Client Secret:",
            validate: (input: string): boolean | string => {
                // If there's an existing secret and input is empty, we'll keep the existing one
                if (config.benchling?.clientSecret && input.trim().length === 0) {
                    return true;
                }
                return input.trim().length > 0 || "Client secret is required";
            },
        },
        {
            type: "input",
            name: "appDefinitionId",
            message: "Benchling App Definition ID:",
            default: config.benchling?.appDefinitionId,
            validate: (input: string): boolean | string =>
                input.trim().length > 0 || "App definition ID is required",
        },
        {
            type: "input",
            name: "testEntryId",
            message: "Benchling Test Entry ID (optional):",
            default: config.benchling?.testEntryId || "",
        },
    ]);

    // Handle empty password input - keep existing secret if user pressed Enter
    if (benchlingAnswers.clientSecret.trim().length === 0 && config.benchling?.clientSecret) {
        benchlingAnswers.clientSecret = config.benchling.clientSecret;
    }

    config.benchling = {
        tenant: benchlingAnswers.tenant,
        clientId: benchlingAnswers.clientId,
        clientSecret: benchlingAnswers.clientSecret,
        appDefinitionId: benchlingAnswers.appDefinitionId,
    };

    if (benchlingAnswers.testEntryId && benchlingAnswers.testEntryId.trim() !== "") {
        config.benchling.testEntryId = benchlingAnswers.testEntryId;
    }

    // Prompt for package configuration
    console.log("\nStep 3: Package Configuration\n");

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
            name: "imageTag",
            message: "Docker image tag:",
            default: config.deployment?.imageTag || "latest",
        },
    ]);

    config.deployment = {
        region: deploymentAnswers.region,
        imageTag: deploymentAnswers.imageTag,
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
