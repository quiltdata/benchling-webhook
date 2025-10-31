/**
 * Benchling Secrets Management
 *
 * This module provides types, validation, and utilities for managing
 * Benchling API credentials in AWS Secrets Manager.
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
