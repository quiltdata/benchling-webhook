import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";
import { existsSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";

export interface Config {
  // Quilt
  quiltCatalog: string;
  quiltUserBucket: string;
  quiltDatabase: string;

  // Benchling
  benchlingTenant: string;
  benchlingClientId: string;
  benchlingClientSecret: string;
  benchlingAppDefinitionId: string;

  // AWS
  cdkAccount: string;
  cdkRegion: string;
  awsProfile?: string;

  // SQS
  queueArn: string;

  // Optional
  pkgPrefix?: string;
  pkgKey?: string;
  logLevel?: string;
  webhookAllowList?: string;
  enableWebhookVerification?: string;
  createEcrRepository?: string;
  ecrRepositoryName?: string;
}

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
 * Load .env file and expand variables
 */
export function loadDotenv(filePath: string): Record<string, string> {
    const resolvedPath = resolve(filePath);

    if (!existsSync(resolvedPath)) {
        return {};
    }

    const result = dotenvConfig({ path: resolvedPath });

    if (result.error) {
        throw new Error(`Failed to load ${filePath}: ${result.error.message}`);
    }

    // Expand variables like ${VAR}
    if (result.parsed) {
        dotenvExpand(result);
    }

    return result.parsed || {};
}

/**
 * Load configuration from multiple sources with priority:
 * 1. CLI options (highest)
 * 2. Environment variables
 * 3. .env file
 * 4. quilt3 config (for catalog only)
 * 5. Inferred values (will be added separately)
 */
export function loadConfigSync(options: ConfigOptions = {}): Partial<Config> {
    // 1. Load .env file
    const envFile = options.envFile || ".env";
    const dotenvVars = existsSync(envFile) ? loadDotenv(envFile) : {};

    // 2. Merge with process.env
    const envVars = { ...dotenvVars, ...process.env };

    // 3. Try to get catalog from quilt3 config as fallback
    const quilt3Catalog = getQuilt3Catalog();

    // 4. Build config with CLI options taking priority
    const config: Partial<Config> = {
    // Quilt
        quiltCatalog: options.catalog || envVars.QUILT_CATALOG || quilt3Catalog,
        quiltUserBucket: options.bucket || envVars.QUILT_USER_BUCKET,
        quiltDatabase: envVars.QUILT_DATABASE,

        // Benchling
        benchlingTenant: options.tenant || envVars.BENCHLING_TENANT,
        benchlingClientId: options.clientId || envVars.BENCHLING_CLIENT_ID,
        benchlingClientSecret: options.clientSecret || envVars.BENCHLING_CLIENT_SECRET,
        benchlingAppDefinitionId: options.appId || envVars.BENCHLING_APP_DEFINITION_ID,

        // AWS
        cdkAccount: envVars.CDK_DEFAULT_ACCOUNT,
        cdkRegion: options.region || envVars.CDK_DEFAULT_REGION || envVars.AWS_REGION,
        awsProfile: options.profile || envVars.AWS_PROFILE,

        // SQS
        queueArn: envVars.QUEUE_ARN,

        // Optional
        pkgPrefix: envVars.PKG_PREFIX || "benchling",
        pkgKey: envVars.PKG_KEY || "experiment_id",
        logLevel: envVars.LOG_LEVEL || "INFO",
        webhookAllowList: envVars.WEBHOOK_ALLOW_LIST,
        enableWebhookVerification: envVars.ENABLE_WEBHOOK_VERIFICATION ?? "true",
        createEcrRepository: envVars.CREATE_ECR_REPOSITORY,
        ecrRepositoryName: envVars.ECR_REPOSITORY_NAME || "quiltdata/benchling",
    };

    // Remove undefined values
    return Object.fromEntries(
        Object.entries(config).filter(([, v]) => v !== undefined),
    ) as Partial<Config>;
}

/**
 * Merge inferred configuration with loaded config
 */
export function mergeInferredConfig(
    config: Partial<Config>,
    inferredVars: Record<string, string>,
): Partial<Config> {
    // Only use inferred values if not already set
    return {
        cdkAccount: config.cdkAccount || inferredVars.CDK_DEFAULT_ACCOUNT,
        cdkRegion: config.cdkRegion || inferredVars.CDK_DEFAULT_REGION,
        queueArn: config.queueArn || inferredVars.QUEUE_ARN,
        quiltDatabase: config.quiltDatabase || inferredVars.QUILT_DATABASE,
        ...config, // User values always take precedence
    };
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
        ["queueArn", "SQS queue ARN"],
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
