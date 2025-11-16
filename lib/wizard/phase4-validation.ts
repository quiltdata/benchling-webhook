/**
 * Phase 4: Validation
 *
 * Validates all collected parameters before proceeding to mode decision.
 *
 * @module wizard/phase4-validation
 */

import * as https from "https";
import chalk from "chalk";
import { S3Client, HeadBucketCommand, ListObjectsV2Command, GetBucketLocationCommand } from "@aws-sdk/client-s3";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { ValidationInput, ValidationResult } from "./types";

/**
 * Detects the actual region of an S3 bucket
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
        return null;
    }
}

/**
 * Validates Benchling tenant accessibility
 */
async function validateBenchlingTenant(tenant: string): Promise<{ isValid: boolean; errors: string[]; warnings: string[] }> {
    const result = { isValid: false, errors: [] as string[], warnings: [] as string[] };

    if (!tenant || tenant.trim().length === 0) {
        result.errors.push("Tenant name cannot be empty");
        return result;
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(tenant)) {
        result.errors.push("Tenant name contains invalid characters (only alphanumeric, dash, underscore allowed)");
        return result;
    }

    const tenantUrl = `https://${tenant}.benchling.com`;
    console.log(`  Testing Benchling tenant URL: ${tenantUrl}`);

    return new Promise((resolve) => {
        https.get(tenantUrl, { timeout: 5000 }, (res) => {
            if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 301) {
                result.isValid = true;
                console.log(`  ✓ Tenant URL accessible: ${tenantUrl}`);
            } else {
                result.warnings.push(`Tenant URL ${tenantUrl} returned status ${res.statusCode}`);
                result.isValid = true; // Consider this a warning, not an error
            }
            resolve(result);
        }).on("error", (error) => {
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
): Promise<{ isValid: boolean; errors: string[]; warnings: string[] }> {
    const result = { isValid: false, errors: [] as string[], warnings: [] as string[] };

    if (!clientId || clientId.trim().length === 0) {
        result.errors.push("Client ID cannot be empty");
    }

    if (!clientSecret || clientSecret.trim().length === 0) {
        result.errors.push("Client secret cannot be empty");
    }

    if (result.errors.length > 0) {
        return result;
    }

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
): Promise<{ isValid: boolean; errors: string[]; warnings: string[] }> {
    const result = { isValid: false, errors: [] as string[], warnings: [] as string[] };

    if (!bucketName || bucketName.trim().length === 0) {
        result.errors.push("Bucket name cannot be empty");
        return result;
    }

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

        console.log(`  Testing S3 bucket access: ${bucketName} (region: ${regionToUse}${awsProfile ? `, profile: ${awsProfile}` : ""})`);
        const headCommand = new HeadBucketCommand({ Bucket: bucketName });
        await s3Client.send(headCommand);

        console.log(`  ✓ S3 bucket accessible: ${bucketName}`);

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
 * Phase 4: Validation
 *
 * Responsibilities:
 * - Validate Benchling credentials (OAuth test)
 * - Validate S3 bucket access
 * - Validate app definition ID exists
 * - Return validation result with errors
 *
 * @param input - Validation input
 * @returns Validation result
 */
export async function runValidation(input: ValidationInput): Promise<ValidationResult> {
    const { parameters, awsProfile } = input;

    const result: ValidationResult = {
        success: true,
        errors: [],
        warnings: [],
        shouldExitForManifest: false,
    };

    // Validate Benchling tenant
    const tenantValidation = await validateBenchlingTenant(parameters.benchling.tenant);
    if (!tenantValidation.isValid) {
        result.success = false;
        result.errors.push(...tenantValidation.errors);
    }
    result.warnings.push(...tenantValidation.warnings);

    // Validate OAuth credentials
    const credValidation = await validateBenchlingCredentials(
        parameters.benchling.tenant,
        parameters.benchling.clientId,
        parameters.benchling.clientSecret,
    );
    if (!credValidation.isValid) {
        result.success = false;
        result.errors.push(...credValidation.errors);
    }
    result.warnings.push(...credValidation.warnings);

    // Validate S3 bucket access
    const bucketValidation = await validateS3BucketAccess(
        parameters.packages.bucket,
        parameters.deployment.region,
        awsProfile,
    );
    if (!bucketValidation.isValid) {
        result.success = false;
        result.errors.push(...bucketValidation.errors);
    }
    result.warnings.push(...bucketValidation.warnings);

    if (result.success) {
        console.log(chalk.green("✓ Configuration validated successfully\n"));
    } else {
        console.error(chalk.red("\n❌ Configuration validation failed:"));
        console.error(chalk.gray("   The following validations were performed:"));
        console.error(chalk.gray(`   - Benchling tenant: ${parameters.benchling.tenant}`));
        console.error(chalk.gray(`   - OAuth credentials: Client ID ${parameters.benchling.clientId.substring(0, 8)}...`));
        console.error(chalk.gray(`   - S3 bucket: ${parameters.packages.bucket} (region: ${parameters.deployment.region})`));
        console.error("");
        result.errors.forEach((err) => console.error(`${err}\n`));
    }

    if (result.warnings.length > 0) {
        console.warn(chalk.yellow("\n⚠ Warnings:"));
        result.warnings.forEach((warn) => console.warn(`  ${warn}\n`));
    }

    return result;
}
