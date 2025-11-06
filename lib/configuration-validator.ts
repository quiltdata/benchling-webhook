import { BenchlingAuthValidator, BenchlingCredentials } from "./benchling-auth-validator";
import { S3BucketValidator, S3BucketConfig } from "./s3-bucket-validator";

/**
 * Configuration object for validation
 */
export interface Configuration {
    catalogUrl?: string;
    benchlingTenant?: string;
    benchlingClientId?: string;
    benchlingClientSecret?: string;
    benchlingAppDefinitionId?: string;
    quiltUserBucket?: string;
    quiltRegion?: string;
    [key: string]: string | undefined;
}

/**
 * Validation options
 */
export interface ValidationOptions {
    skipBenchlingValidation?: boolean;
    skipS3Validation?: boolean;
}

/**
 * Comprehensive validation result
 */
export interface ComprehensiveValidationResult {
    isValid: boolean;
    errors: string[];
    warnings?: string[];
}

/**
 * Comprehensive configuration validator
 *
 * Combines all validation checks (Benchling + S3) and provides
 * comprehensive validation results with aggregated errors.
 */
export class ConfigurationValidator {
    /**
     * Required configuration fields
     */
    private static readonly REQUIRED_FIELDS = [
        "catalogUrl",
        "benchlingTenant",
        "benchlingClientId",
        "benchlingClientSecret",
        "benchlingAppDefinitionId",
        "quiltUserBucket",
        "quiltRegion",
    ];

    /**
     * Validate entire configuration
     *
     * @param config - Configuration to validate
     * @param options - Validation options
     * @returns Comprehensive validation result
     */
    public static async validate(
        config: Configuration,
        options: ValidationOptions = {},
    ): Promise<ComprehensiveValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Check required fields
        const missingFields = ConfigurationValidator.checkRequiredFields(config);
        if (missingFields.length > 0) {
            errors.push(`Missing required fields: ${missingFields.join(", ")}`);
        }

        // Validate catalog URL format
        if (config.catalog && !ConfigurationValidator.validateCatalogUrl(config.catalog)) {
            errors.push("Invalid catalog URL");
        } else if (!config.catalog) {
            errors.push("Invalid catalog URL");
        }

        // If basic validation fails, return early
        if (errors.length > 0 && (options.skipBenchlingValidation || options.skipS3Validation)) {
            return {
                isValid: false,
                errors,
                warnings: warnings.length > 0 ? warnings : undefined,
            };
        }

        // Validate Benchling authentication
        if (!options.skipBenchlingValidation && config.benchlingTenant && config.benchlingClientId && config.benchlingClientSecret) {
            try {
                const benchlingCredentials: BenchlingCredentials = {
                    tenant: config.benchlingTenant,
                    clientId: config.benchlingClientId,
                    clientSecret: config.benchlingClientSecret,
                };

                const benchlingResult = await BenchlingAuthValidator.validate(benchlingCredentials);

                if (!benchlingResult.isValid) {
                    errors.push(...benchlingResult.errors);
                }

                if (benchlingResult.warnings) {
                    warnings.push(...benchlingResult.warnings);
                }
            } catch (error) {
                if (error instanceof Error) {
                    errors.push(`Benchling validation failed: ${error.message}`);
                }
            }
        }

        // Validate S3 bucket access
        if (!options.skipS3Validation && config.quiltUserBucket && config.region) {
            try {
                const s3Config: S3BucketConfig = {
                    bucketName: config.quiltUserBucket,
                    region: config.region,
                };

                const s3Result = await S3BucketValidator.validate(s3Config);

                if (!s3Result.hasAccess) {
                    errors.push(...s3Result.errors);
                }
            } catch (error) {
                if (error instanceof Error) {
                    errors.push(`S3 validation failed: ${error.message}`);
                }
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings: warnings.length > 0 ? warnings : undefined,
        };
    }

    /**
     * Validate catalog URL format
     *
     * @param catalogUrl - Catalog URL to validate
     * @returns True if URL format is valid
     */
    public static validateCatalogUrl(catalogUrl: string): boolean {
        if (!catalogUrl || catalogUrl.trim() === "") {
            return false;
        }

        try {
            const url = new URL(catalogUrl);
            return url.protocol === "http:" || url.protocol === "https:";
        } catch {
            return false;
        }
    }

    /**
     * Check for missing required fields
     *
     * @param config - Configuration to check
     * @returns Array of missing field names
     */
    public static checkRequiredFields(config: Configuration): string[] {
        const missing: string[] = [];

        for (const field of ConfigurationValidator.REQUIRED_FIELDS) {
            if (!config[field] || config[field]?.trim() === "") {
                missing.push(field);
            }
        }

        return missing;
    }
}
