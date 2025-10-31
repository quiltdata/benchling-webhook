/**
 * Benchling Secrets Management
 *
 * This module provides types, validation, and utilities for managing
 * Benchling API credentials in AWS Secrets Manager.
 *
 * ## Supported Formats
 *
 * ### ARN Format
 * Provide the ARN of an existing AWS Secrets Manager secret:
 * ```
 * arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-webhook/credentials
 * ```
 *
 * ### JSON Format
 * Provide credentials as a JSON object:
 * ```json
 * {
 *   "client_id": "your-client-id",
 *   "client_secret": "your-client-secret",
 *   "tenant": "your-tenant",
 *   "app_definition_id": "optional-app-id",
 *   "api_url": "https://optional-api-url.com"
 * }
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { parseAndValidateSecrets } from './secrets';
 *
 * // Parse and validate ARN
 * const arnConfig = parseAndValidateSecrets(
 *   'arn:aws:secretsmanager:us-east-1:123456789012:secret:name'
 * );
 * console.log(arnConfig.format); // "arn"
 * console.log(arnConfig.arn); // the validated ARN
 *
 * // Parse and validate JSON
 * const jsonConfig = parseAndValidateSecrets(
 *   '{"client_id":"abc","client_secret":"secret","tenant":"company"}'
 * );
 * console.log(jsonConfig.format); // "json"
 * console.log(jsonConfig.data); // the validated secret data
 *
 * // Handle validation errors
 * try {
 *   parseAndValidateSecrets('invalid');
 * } catch (error) {
 *   if (error instanceof SecretsValidationError) {
 *     console.error(error.formatForCLI());
 *   }
 * }
 * ```
 *
 * @module secrets
 */

/**
 * Benchling secret structure stored in AWS Secrets Manager
 */
export interface BenchlingSecretData {
  /** Benchling OAuth client ID */
  client_id: string;

  /** Benchling OAuth client secret */
  client_secret: string;

  /** Benchling tenant name (e.g., "company" for company.benchling.com) */
  tenant: string;

  /** Benchling app definition ID (optional for backward compatibility) */
  app_definition_id?: string;

  /** Custom Benchling API URL (optional, defaults to https://{tenant}.benchling.com) */
  api_url?: string;
}

/**
 * Accepted formats for BENCHLING_SECRETS parameter
 * Can be either a Secret ARN or JSON string
 */
export type BenchlingSecretsInput = string;

/**
 * Parsed and validated secret configuration
 */
export interface BenchlingSecretsConfig {
  /** The input format detected */
  format: "arn" | "json";

  /** If format is "arn", the validated ARN */
  arn?: string;

  /** If format is "json", the validated secret data */
  data?: BenchlingSecretData;

  /** Original input value (for error messages) */
  original: string;
}

/**
 * Validation result with errors and warnings
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  field: string;
  message: string;
  suggestion?: string;
}

/**
 * Detect whether input is an ARN or JSON string
 *
 * @param input - The BENCHLING_SECRETS input value
 * @returns "arn" if input looks like an ARN, "json" otherwise
 *
 * @example
 * detectSecretsFormat("arn:aws:secretsmanager:...") // returns "arn"
 * detectSecretsFormat('{"client_id":"..."}') // returns "json"
 */
export function detectSecretsFormat(input: string): "arn" | "json" {
    // Trim whitespace
    const trimmed = input.trim();

    // Check if starts with ARN prefix
    if (trimmed.startsWith("arn:aws:secretsmanager:")) {
        return "arn";
    }

    // Check if starts with { (JSON object)
    if (trimmed.startsWith("{")) {
        return "json";
    }

    // Default to JSON and let validation catch errors
    return "json";
}

/**
 * Validate AWS Secrets Manager ARN format
 *
 * @param arn - The ARN string to validate
 * @returns Validation result with errors and warnings
 *
 * @example
 * validateSecretArn("arn:aws:secretsmanager:us-east-1:123456789012:secret:name")
 * // returns { valid: true, errors: [], warnings: [] }
 */
export function validateSecretArn(arn: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Check ARN format using regex
    // Pattern: arn:aws:secretsmanager:region:account:secret:name
    const arnPattern = /^arn:aws:secretsmanager:([a-z0-9-]+):(\d{12}):secret:(.+)$/;
    const match = arn.match(arnPattern);

    if (!match) {
        errors.push({
            field: "arn",
            message: "Invalid AWS Secrets Manager ARN format",
            suggestion: "Expected format: arn:aws:secretsmanager:region:account:secret:name",
        });
        return { valid: false, errors, warnings };
    }

    const [, region, accountId, secretName] = match;

    // Validate region (basic check - not empty)
    if (!region || region.length === 0) {
        errors.push({
            field: "region",
            message: "ARN missing AWS region",
            suggestion: "Ensure ARN includes a valid AWS region (e.g., us-east-1)",
        });
    }

    // Validate account ID (must be exactly 12 digits)
    if (accountId.length !== 12) {
        errors.push({
            field: "account",
            message: "Invalid AWS account ID in ARN",
            suggestion: "Account ID must be exactly 12 digits",
        });
    }

    // Validate secret name (not empty)
    if (!secretName || secretName.length === 0) {
        errors.push({
            field: "secret",
            message: "ARN missing secret name",
            suggestion: "Ensure ARN includes the secret name",
        });
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Validate secret data structure and field values
 *
 * @param data - The secret data object to validate
 * @returns Validation result with errors and warnings
 *
 * @example
 * validateSecretData({ client_id: "abc", client_secret: "secret", tenant: "company" })
 * // returns { valid: true, errors: [], warnings: [] }
 */
export function validateSecretData(data: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Check if data is an object
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        errors.push({
            field: "data",
            message: "Secret data must be a JSON object",
            suggestion:
                "Expected format: {\"client_id\": \"...\", \"client_secret\": \"...\", \"tenant\": \"...\"}",
        });
        return { valid: false, errors, warnings };
    }

    const secretData = data as Record<string, unknown>;

    // Required fields
    const requiredFields: Array<keyof BenchlingSecretData> = [
        "client_id",
        "client_secret",
        "tenant",
    ];

    for (const field of requiredFields) {
        if (!(field in secretData)) {
            errors.push({
                field,
                message: `Missing required field: ${field}`,
                suggestion: `Add "${field}" to your secret configuration`,
            });
        } else if (typeof secretData[field] !== "string") {
            errors.push({
                field,
                message: `Field ${field} must be a string`,
                suggestion: `Change ${field} value to a string`,
            });
        } else if ((secretData[field] as string).trim() === "") {
            errors.push({
                field,
                message: `Field ${field} cannot be empty`,
                suggestion: `Provide a non-empty value for ${field}`,
            });
        }
    }

    // Optional fields type checking
    const optionalFields: Array<keyof BenchlingSecretData> = [
        "app_definition_id",
        "api_url",
    ];

    for (const field of optionalFields) {
        if (field in secretData && typeof secretData[field] !== "string") {
            errors.push({
                field,
                message: `Field ${field} must be a string`,
                suggestion: `Change ${field} value to a string or remove it`,
            });
        }
    }

    // Validate tenant format (alphanumeric and hyphens)
    if (secretData.tenant && typeof secretData.tenant === "string") {
        const tenantPattern = /^[a-z0-9-]+$/i;
        if (!tenantPattern.test(secretData.tenant)) {
            errors.push({
                field: "tenant",
                message: "Invalid tenant format",
                suggestion: "Tenant must contain only letters, numbers, and hyphens",
            });
        }
    }

    // Validate api_url if provided
    if (secretData.api_url && typeof secretData.api_url === "string") {
        try {
            new URL(secretData.api_url);
        } catch {
            errors.push({
                field: "api_url",
                message: "Invalid URL format for api_url",
                suggestion: "Provide a valid URL (e.g., https://company.benchling.com)",
            });
        }
    }

    // Check for unknown fields (warning only)
    const knownFields = new Set([...requiredFields, ...optionalFields]);
    for (const field in secretData) {
        if (!knownFields.has(field as keyof BenchlingSecretData)) {
            warnings.push(`Unknown field "${field}" will be ignored`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Custom error class for secrets validation failures
 */
export class SecretsValidationError extends Error {
    public readonly errors: ValidationError[];
    public readonly warnings: string[];

    constructor(message: string, errors: ValidationError[], warnings: string[]) {
        super(message);
        this.name = "SecretsValidationError";
        this.errors = errors;
        this.warnings = warnings;

        // Maintain proper stack trace (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, SecretsValidationError);
        }
    }

    /**
     * Format errors for CLI display
     */
    public formatForCLI(): string {
        const lines: string[] = [this.message, ""];

        if (this.errors.length > 0) {
            lines.push("Errors:");
            for (const error of this.errors) {
                lines.push(`  × ${error.field}: ${error.message}`);
                if (error.suggestion) {
                    lines.push(`    → ${error.suggestion}`);
                }
            }
            lines.push("");
        }

        if (this.warnings.length > 0) {
            lines.push("Warnings:");
            for (const warning of this.warnings) {
                lines.push(`  ⚠ ${warning}`);
            }
            lines.push("");
        }

        return lines.join("\n");
    }
}

/**
 * Parse and validate BENCHLING_SECRETS input
 *
 * This is the main entry point for secret validation. It detects the format
 * (ARN or JSON), performs appropriate validation, and returns a structured
 * configuration object.
 *
 * @param input - The BENCHLING_SECRETS input string
 * @returns Parsed and validated configuration
 * @throws SecretsValidationError if validation fails
 *
 * @example
 * // Parse ARN
 * const config = parseAndValidateSecrets("arn:aws:secretsmanager:...")
 * console.log(config.format) // "arn"
 *
 * @example
 * // Parse JSON
 * const config = parseAndValidateSecrets('{"client_id":"...","client_secret":"...","tenant":"..."}')
 * console.log(config.format) // "json"
 */
export function parseAndValidateSecrets(input: string): BenchlingSecretsConfig {
    // Detect format
    const format = detectSecretsFormat(input);

    if (format === "arn") {
        // Validate ARN
        const validation = validateSecretArn(input);

        if (!validation.valid) {
            throw new SecretsValidationError(
                "Invalid secret ARN",
                validation.errors,
                validation.warnings,
            );
        }

        return {
            format: "arn",
            arn: input.trim(),
            original: input,
        };
    } else {
        // Parse JSON
        let data: unknown;
        try {
            data = JSON.parse(input);
        } catch (error) {
            throw new SecretsValidationError(
                "Invalid JSON in secret data",
                [
                    {
                        field: "json",
                        message: `JSON parse error: ${(error as Error).message}`,
                        suggestion: "Ensure the secret data is valid JSON",
                    },
                ],
                [],
            );
        }

        // Validate structure
        const validation = validateSecretData(data);

        if (!validation.valid) {
            throw new SecretsValidationError(
                "Invalid secret data structure",
                validation.errors,
                validation.warnings,
            );
        }

        return {
            format: "json",
            data: data as BenchlingSecretData,
            original: input,
        };
    }
}
