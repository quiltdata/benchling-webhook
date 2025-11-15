/**
 * Configuration Utilities
 *
 * Legacy configuration types and utility functions.
 * Most configuration loading now happens via XDG profiles (see lib/xdg-config.ts).
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";
import { isQueueUrl } from "./sqs";

/**
 * Legacy Config interface
 * @deprecated Use ProfileConfig from lib/types/config.ts instead
 */
export interface Config {
  // Secrets-Only Mode (v0.6.0+)
  quiltStackArn?: string;
  benchlingSecret?: string;

  // Quilt
  quiltCatalog: string;
  quiltUserBucket: string;
  quiltDatabase: string;

  // Benchling
  benchlingTenant: string;
  benchlingClientId: string;
  benchlingClientSecret: string;
  benchlingAppDefinitionId: string;

  // Unified secrets configuration (ARN or JSON)
  benchlingSecrets?: string;

  // AWS
  cdkAccount: string;
  cdkRegion: string;
  awsProfile?: string;

  // SQS
  queueUrl: string;

  // Optional
  pkgPrefix?: string;
  pkgKey?: string;
  logLevel?: string;
  webhookAllowList?: string;
  enableWebhookVerification?: string;
  createEcrRepository?: string;
  ecrRepositoryName?: string;
  imageTag?: string;
}

/**
 * Legacy ConfigOptions interface
 * @deprecated CLI commands now use XDG profiles
 */
export interface ConfigOptions {
  envFile?: string;
  catalog?: string;
  bucket?: string;
  tenant?: string;
  clientId?: string;
  clientSecret?: string;
  appId?: string;
  profile?: string;
  region?: string;
  imageTag?: string;
  benchlingSecrets?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  field: string;
  message: string;
  canInfer: boolean;
  helpText?: string;
}

/**
 * Get catalog URL from quilt3 config if available
 */
export function getQuilt3Catalog(): string | undefined {
    try {
        const result = execSync("quilt3 config", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
        const catalog = result.trim();
        // quilt3 config returns the full URL (e.g., https://nightly.quilttest.com)
        // We want just the domain
        if (catalog) {
            const url = new URL(catalog);
            return url.hostname;
        }
    } catch {
        // quilt3 not installed or not configured
        return undefined;
    }
    return undefined;
}

/**
 * Process benchling-secrets parameter, handling @file.json syntax
 *
 * Supports three input formats:
 * - ARN: `arn:aws:secretsmanager:...` - passed through unchanged
 * - JSON: `{"client_id":"...","client_secret":"...","tenant":"..."}` - passed through unchanged
 * - File: `@secrets.json` - reads file content from path after @ symbol
 *
 * @param input - The benchling-secrets value (ARN, JSON, or @filepath)
 * @returns Processed secret string (trimmed)
 * @throws Error if file not found or not readable
 *
 * @example
 * // Pass through ARN
 * processBenchlingSecretsInput("arn:aws:secretsmanager:...")
 * // Returns: "arn:aws:secretsmanager:..."
 *
 * @example
 * // Pass through JSON
 * processBenchlingSecretsInput('{"client_id":"...","client_secret":"...","tenant":"..."}')
 * // Returns: '{"client_id":"...","client_secret":"...","tenant":"..."}'
 *
 * @example
 * // Read from file
 * processBenchlingSecretsInput("@secrets.json")
 * // Returns: contents of secrets.json (trimmed)
 */
export function processBenchlingSecretsInput(input: string): string {
    const trimmed = input.trim();

    // Check for @file syntax
    if (trimmed.startsWith("@")) {
        const filePath = trimmed.slice(1); // Remove @ prefix
        const resolvedPath = resolve(filePath);

        if (!existsSync(resolvedPath)) {
            throw new Error(
                `Secrets file not found: ${filePath}\n` +
                `  Resolved path: ${resolvedPath}\n` +
                "  Tip: Use relative or absolute path after @ (e.g., @secrets.json or @/path/to/secrets.json)",
            );
        }

        try {
            const fileContent = readFileSync(resolvedPath, "utf-8");
            return fileContent.trim();
        } catch (error) {
            throw new Error(
                `Failed to read secrets file: ${filePath}\n` +
                `  Error: ${(error as Error).message}`,
            );
        }
    }

    // Return as-is for ARN or inline JSON
    return trimmed;
}

/**
 * Mask sensitive parts of ARN for display
 *
 * Shows region and partial secret name, masks account ID for security.
 * Account ID is masked as ****XXXX where XXXX are the last 4 digits.
 *
 * @param arn - AWS Secrets Manager ARN to mask
 * @returns Masked ARN string or original input if not valid ARN format
 *
 * @example
 * maskArn("arn:aws:secretsmanager:us-east-1:123456789012:secret:name")
 * // Returns: "arn:aws:secretsmanager:us-east-1:****9012:secret:name"
 *
 * @example
 * maskArn("not-an-arn")
 * // Returns: "not-an-arn"
 */
export function maskArn(arn: string): string {
    // Pattern: arn:aws:secretsmanager:region:account:secret:name
    const match = arn.match(/^(arn:aws:secretsmanager:[^:]+:)(\d{12})(:.+)$/);

    if (match) {
        const [, prefix, account, suffix] = match;
        const maskedAccount = "****" + account.slice(-4);
        return prefix + maskedAccount + suffix;
    }

    // Return as-is if pattern doesn't match
    return arn;
}

/**
 * Validate configuration and return detailed errors
 */
export function validateConfig(config: Partial<Config>): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Required user-provided values (CANNOT be inferred)
    const requiredUserFields: Array<[keyof Config, string, string]> = [
        ["quiltCatalog", "Quilt catalog URL", "Your Quilt catalog domain (e.g., quilt-catalog.company.com)"],
        ["quiltUserBucket", "S3 bucket for data", "The S3 bucket where you want to store Benchling exports (CANNOT be inferred - must be explicitly provided)"],
        ["benchlingTenant", "Benchling tenant", "Your Benchling tenant name (use XXX if you login to XXX.benchling.com)"],
        ["benchlingClientId", "Benchling OAuth client ID", "OAuth client ID from your Benchling app"],
        ["benchlingClientSecret", "Benchling OAuth client secret", "OAuth client secret from your Benchling app"],
        ["benchlingAppDefinitionId", "Benchling app definition ID", "App definition ID is always required. Create a Benchling app:\n" +
            "    1. Run: npx @quiltdata/benchling-webhook manifest\n" +
            "    2. Upload the manifest to Benchling\n" +
            "    3. Copy the App Definition ID from the app overview"],
    ];

    for (const [field, message, helpText] of requiredUserFields) {
        if (!config[field]) {
            errors.push({
                field: field as string,
                message,
                canInfer: false,
                helpText,
            });
        }
    }

    // Required inferred values
    const requiredInferredFields: Array<[keyof Config, string]> = [
        ["cdkAccount", "AWS account ID"],
        ["cdkRegion", "AWS region"],
        ["queueUrl", "SQS queue URL"],
        ["quiltDatabase", "Quilt database name"],
    ];

    for (const [field, message] of requiredInferredFields) {
        if (!config[field]) {
            errors.push({
                field: field as string,
                message,
                canInfer: true,
                helpText: "This value should be automatically inferred from your Quilt catalog configuration",
            });
        }
    }

    // Validation rules for existing values
    if (config.quiltCatalog && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(config.quiltCatalog)) {
        warnings.push("QUILT_CATALOG should be a domain name without protocol (e.g., catalog.company.com, not https://catalog.company.com)");
    }

    if (config.quiltUserBucket && !/^[a-z0-9.-]{3,63}$/.test(config.quiltUserBucket)) {
        warnings.push("QUILT_USER_BUCKET does not look like a valid S3 bucket name");
    }

    if (config.queueUrl && !isQueueUrl(config.queueUrl)) {
        warnings.push("QUEUE_URL should be a valid SQS queue URL (https://sqs.<region>.amazonaws.com/<account>/<queue>)");
    }

    // Security warnings
    if (config.enableWebhookVerification === "false") {
        warnings.push("Webhook verification is disabled - this is NOT recommended for production use");
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Format validation errors for CLI display
 */
export function formatValidationErrors(result: ValidationResult): string {
    const lines: string[] = [];

    if (result.errors.length > 0) {
        lines.push("Missing required configuration:");
        lines.push("");

        const userErrors = result.errors.filter(e => !e.canInfer);
        const inferErrors = result.errors.filter(e => e.canInfer);

        if (userErrors.length > 0) {
            lines.push("Values you must provide:");
            for (const error of userErrors) {
                lines.push(`  • ${error.message}`);
                if (error.helpText) {
                    lines.push(`    ${error.helpText}`);
                }
            }
            lines.push("");
        }

        if (inferErrors.length > 0) {
            lines.push("Values that could not be inferred:");
            for (const error of inferErrors) {
                lines.push(`  • ${error.message}`);
                if (error.helpText) {
                    lines.push(`    ${error.helpText}`);
                }
            }
            lines.push("");
        }
    }

    if (result.warnings.length > 0) {
        lines.push("Warnings:");
        for (const warning of result.warnings) {
            lines.push(`  ⚠ ${warning}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}
