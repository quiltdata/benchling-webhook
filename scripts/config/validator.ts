/**
 * Configuration Validation Module
 *
 * Provides validation functions for Benchling and AWS configuration.
 * Extracted from setup-wizard for better modularity.
 *
 * @module scripts/config/validator
 */

import * as https from "https";
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { ValidationResult } from "../../lib/types/config";

/**
 * Validates Benchling tenant accessibility
 *
 * Tests if the Benchling tenant URL is reachable and returns a valid response.
 *
 * @param tenant - Benchling tenant name (e.g., "acme" for acme.benchling.com)
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * const result = await validateBenchlingTenant("acme");
 * if (!result.isValid) {
 *   console.error("Validation errors:", result.errors);
 * }
 * ```
 */
export async function validateBenchlingTenant(tenant: string): Promise<ValidationResult> {
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
 *
 * Tests OAuth credentials by attempting to obtain an access token using client credentials flow.
 *
 * @param tenant - Benchling tenant name
 * @param clientId - OAuth client ID
 * @param clientSecret - OAuth client secret
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * const result = await validateBenchlingCredentials("acme", "client_id", "secret");
 * if (result.isValid) {
 *   console.log("✓ OAuth credentials validated successfully");
 * }
 * ```
 */
export async function validateBenchlingCredentials(
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
 *
 * Tests S3 bucket accessibility by performing HeadBucket and ListObjects operations.
 *
 * @param bucketName - S3 bucket name
 * @param region - AWS region
 * @param awsProfile - Optional AWS profile to use
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * const result = await validateS3BucketAccess("my-bucket", "us-east-1");
 * if (!result.isValid) {
 *   console.error("Bucket validation failed:", result.errors);
 * }
 * ```
 */
export async function validateS3BucketAccess(
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
 *
 * Performs comprehensive validation of all configuration fields.
 *
 * @param config - Profile configuration to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const validation = await validateConfig(profileConfig);
 * if (!validation.isValid) {
 *   throw new Error(`Configuration invalid: ${validation.errors.join(", ")}`);
 * }
 * ```
 */
export async function validateConfig(
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
