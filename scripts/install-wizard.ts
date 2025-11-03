#!/usr/bin/env node
/**
 * Interactive Configuration Wizard
 *
 * Guided configuration setup with comprehensive validation:
 * - Benchling tenant and OAuth credentials
 * - S3 bucket access verification
 * - Quilt API connectivity testing
 * - AWS Secrets Manager integration
 *
 * Supports both interactive and non-interactive (CI/CD) modes.
 *
 * @module scripts/install-wizard
 */

import inquirer from "inquirer";
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { XDGConfig, BaseConfig } from "../lib/xdg-config";
import { UserConfig, ProfileName } from "../lib/types/config";
import { inferQuiltConfig, inferenceResultToDerivedConfig } from "./infer-quilt-config";
import { syncSecretsToAWS } from "./sync-secrets";
import * as https from "https";

/**
 * Wizard configuration options
 */
interface WizardOptions {
    profile?: ProfileName;
    nonInteractive?: boolean;
    skipValidation?: boolean;
    awsProfile?: string;
    awsRegion?: string;
}

/**
 * Validation result for configuration steps
 */
interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Validates Benchling tenant accessibility
 *
 * @param tenant - Benchling tenant name
 * @returns Validation result
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
        result.errors.push("Tenant name contains invalid characters");
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
                    result.warnings.push(`Tenant URL returned status ${res.statusCode}`);
                    result.isValid = true; // Consider this a warning, not an error
                }
                resolve(result);
            })
            .on("error", (error) => {
                result.warnings.push(`Could not verify tenant URL: ${error.message}`);
                result.isValid = true; // Allow proceeding with warning
                resolve(result);
            });
    });
}

/**
 * Validates Benchling OAuth credentials
 *
 * @param tenant - Benchling tenant
 * @param clientId - OAuth client ID
 * @param clientSecret - OAuth client secret
 * @returns Validation result
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
 * @param bucketName - S3 bucket name
 * @param region - AWS region
 * @param awsProfile - AWS profile to use
 * @returns Validation result
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
 * Validates Quilt API connectivity
 *
 * @param catalogUrl - Quilt catalog URL
 * @returns Validation result
 */
async function validateQuiltAPI(catalogUrl: string): Promise<ValidationResult> {
    const result: ValidationResult = {
        isValid: false,
        errors: [],
        warnings: [],
    };

    if (!catalogUrl || catalogUrl.trim().length === 0) {
        result.errors.push("Catalog URL cannot be empty");
        return result;
    }

    // Validate URL format
    try {
        new URL(catalogUrl);
    } catch (error) {
        result.errors.push("Invalid catalog URL format");
        return result;
    }

    // Test API endpoint
    const apiUrl = `${catalogUrl}/api/config`;

    return new Promise((resolve) => {
        https
            .get(apiUrl, { timeout: 10000 }, (res) => {
                let data = "";

                res.on("data", (chunk) => {
                    data += chunk;
                });

                res.on("end", () => {
                    if (res.statusCode === 200) {
                        result.isValid = true;
                        console.log(`  ✓ Quilt API accessible: ${apiUrl}`);
                    } else {
                        result.warnings.push(`Quilt API returned status ${res.statusCode}`);
                        result.isValid = true; // Allow proceeding with warning
                    }
                    resolve(result);
                });
            })
            .on("error", (error) => {
                result.warnings.push(`Could not validate Quilt API: ${error.message}`);
                result.isValid = true; // Allow proceeding with warning
                resolve(result);
            });
    });
}

/**
 * Runs the interactive configuration wizard
 *
 * @param options - Wizard options
 * @returns Completed user configuration
 */
export async function runInstallWizard(options: WizardOptions = {}): Promise<UserConfig> {
    const { profile = "default", nonInteractive = false, skipValidation = false, awsProfile, awsRegion = "us-east-1" } = options;

    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Benchling Webhook Configuration Wizard                 ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    const config: UserConfig = {
        _metadata: {
            source: "install-wizard",
            savedAt: new Date().toISOString(),
            version: "0.6.0",
        },
    };

    // Step 1: Infer Quilt configuration
    console.log("Step 1: Inferring Quilt configuration...\n");

    const inferenceResult = await inferQuiltConfig({
        region: awsRegion,
        profile: awsProfile,
        interactive: !nonInteractive,
    });

    const derivedConfig = inferenceResultToDerivedConfig(inferenceResult);

    // Merge inferred config
    Object.assign(config, derivedConfig);

    console.log("\n✓ Quilt configuration inferred");

    // Step 2: Quilt configuration prompts (if needed)
    if (!nonInteractive) {
        console.log("\nStep 2: Verify Quilt configuration\n");

        const quiltAnswers = await inquirer.prompt([
            {
                type: "input",
                name: "quiltCatalog",
                message: "Quilt Catalog URL:",
                default: config.quiltCatalog,
                validate: (input: string) => input.trim().length > 0 || "Catalog URL is required",
            },
            {
                type: "input",
                name: "quiltUserBucket",
                message: "Quilt User Bucket:",
                default: config.quiltUserBucket,
                validate: (input: string) => input.trim().length > 0 || "Bucket name is required",
            },
            {
                type: "input",
                name: "quiltRegion",
                message: "AWS Region:",
                default: config.quiltRegion || awsRegion,
            },
        ]);

        Object.assign(config, quiltAnswers);
    }

    // Validate Quilt API and S3 bucket
    if (!skipValidation) {
        if (config.quiltCatalog) {
            const quiltValidation = await validateQuiltAPI(config.quiltCatalog);
            if (!quiltValidation.isValid) {
                console.error("\n❌ Quilt API validation failed:");
                quiltValidation.errors.forEach((err) => console.error(`  - ${err}`));
                if (!nonInteractive) {
                    const { proceed } = await inquirer.prompt([
                        {
                            type: "confirm",
                            name: "proceed",
                            message: "Continue anyway?",
                            default: false,
                        },
                    ]);
                    if (!proceed) {
                        throw new Error("Configuration aborted by user");
                    }
                }
            }
            if (quiltValidation.warnings.length > 0) {
                console.warn("\n⚠ Warnings:");
                quiltValidation.warnings.forEach((warn) => console.warn(`  - ${warn}`));
            }
        }

        if (config.quiltUserBucket) {
            const s3Validation = await validateS3BucketAccess(
                config.quiltUserBucket,
                config.quiltRegion || awsRegion,
                awsProfile,
            );
            if (!s3Validation.isValid) {
                console.error("\n❌ S3 bucket validation failed:");
                s3Validation.errors.forEach((err) => console.error(`  - ${err}`));
                if (!nonInteractive) {
                    const { proceed } = await inquirer.prompt([
                        {
                            type: "confirm",
                            name: "proceed",
                            message: "Continue anyway?",
                            default: false,
                        },
                    ]);
                    if (!proceed) {
                        throw new Error("Configuration aborted by user");
                    }
                }
            }
        }
    }

    // Step 3: Benchling configuration
    console.log("\nStep 3: Benchling configuration\n");

    if (!nonInteractive) {
        const benchlingAnswers = await inquirer.prompt([
            {
                type: "input",
                name: "benchlingTenant",
                message: "Benchling Tenant:",
                validate: (input: string) => input.trim().length > 0 || "Tenant is required",
            },
            {
                type: "input",
                name: "benchlingClientId",
                message: "Benchling OAuth Client ID:",
                validate: (input: string) => input.trim().length > 0 || "Client ID is required",
            },
            {
                type: "password",
                name: "benchlingClientSecret",
                message: "Benchling OAuth Client Secret:",
                validate: (input: string) => input.trim().length > 0 || "Client secret is required",
            },
            {
                type: "input",
                name: "benchlingAppDefinitionId",
                message: "Benchling App Definition ID:",
                validate: (input: string) => input.trim().length > 0 || "App definition ID is required",
            },
        ]);

        Object.assign(config, benchlingAnswers);

        // Validate Benchling configuration
        if (!skipValidation && config.benchlingTenant) {
            const tenantValidation = await validateBenchlingTenant(config.benchlingTenant);
            if (!tenantValidation.isValid) {
                console.error("\n❌ Benchling tenant validation failed:");
                tenantValidation.errors.forEach((err) => console.error(`  - ${err}`));
                const { proceed } = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "proceed",
                        message: "Continue anyway?",
                        default: false,
                    },
                ]);
                if (!proceed) {
                    throw new Error("Configuration aborted by user");
                }
            }
            if (tenantValidation.warnings.length > 0) {
                console.warn("\n⚠ Warnings:");
                tenantValidation.warnings.forEach((warn) => console.warn(`  - ${warn}`));
            }

            // Validate OAuth credentials
            if (config.benchlingClientId && config.benchlingClientSecret) {
                const credValidation = await validateBenchlingCredentials(
                    config.benchlingTenant,
                    config.benchlingClientId,
                    config.benchlingClientSecret,
                );
                if (!credValidation.isValid) {
                    console.error("\n❌ Benchling OAuth credential validation failed:");
                    credValidation.errors.forEach((err) => console.error(`  - ${err}`));
                    const { proceed } = await inquirer.prompt([
                        {
                            type: "confirm",
                            name: "proceed",
                            message: "Continue anyway?",
                            default: false,
                        },
                    ]);
                    if (!proceed) {
                        throw new Error("Configuration aborted by user");
                    }
                }
                if (credValidation.warnings.length > 0) {
                    console.warn("\n⚠ Warnings:");
                    credValidation.warnings.forEach((warn) => console.warn(`  - ${warn}`));
                }
            }
        }
    } else {
        // Non-interactive mode: read from environment
        config.benchlingTenant = process.env.BENCHLING_TENANT;
        config.benchlingClientId = process.env.BENCHLING_CLIENT_ID;
        config.benchlingClientSecret = process.env.BENCHLING_CLIENT_SECRET;
        config.benchlingAppDefinitionId = process.env.BENCHLING_APP_DEFINITION_ID;

        if (!config.benchlingTenant || !config.benchlingClientId || !config.benchlingClientSecret) {
            throw new Error(
                "Non-interactive mode requires BENCHLING_TENANT, BENCHLING_CLIENT_ID, and BENCHLING_CLIENT_SECRET environment variables",
            );
        }
    }

    // Step 4: AWS configuration
    console.log("\nStep 4: AWS configuration\n");

    if (!nonInteractive) {
        const awsAnswers = await inquirer.prompt([
            {
                type: "input",
                name: "awsProfile",
                message: "AWS Profile (optional, leave empty for default):",
                default: awsProfile || "",
            },
            {
                type: "input",
                name: "cdkRegion",
                message: "CDK Deployment Region:",
                default: config.quiltRegion || awsRegion,
            },
        ]);

        if (awsAnswers.awsProfile) {
            config.awsProfile = awsAnswers.awsProfile;
        }
        config.cdkRegion = awsAnswers.cdkRegion;
    } else {
        config.cdkRegion = config.quiltRegion || awsRegion;
    }

    // Step 5: Optional configuration
    console.log("\nStep 5: Optional configuration\n");

    if (!nonInteractive) {
        const optionalAnswers = await inquirer.prompt([
            {
                type: "input",
                name: "pkgPrefix",
                message: "Package S3 prefix (default: benchling):",
                default: "benchling",
            },
            {
                type: "input",
                name: "pkgKey",
                message: "Package metadata key (default: experiment_id):",
                default: "experiment_id",
            },
            {
                type: "list",
                name: "logLevel",
                message: "Log level:",
                choices: ["DEBUG", "INFO", "WARNING", "ERROR"],
                default: "INFO",
            },
        ]);

        Object.assign(config, optionalAnswers);
    } else {
        config.pkgPrefix = config.pkgPrefix || "benchling";
        config.pkgKey = config.pkgKey || "experiment_id";
        config.logLevel = config.logLevel || "INFO";
    }

    // Step 6: Save configuration
    console.log("\nStep 6: Saving configuration...\n");

    const xdgConfig = new XDGConfig();
    xdgConfig.ensureProfileDirectories(profile);
    xdgConfig.writeProfileConfig("user", config as BaseConfig, profile);

    console.log(`✓ Configuration saved to profile: ${profile}`);

    // Step 7: Sync secrets to AWS Secrets Manager
    if (!nonInteractive) {
        const { syncSecrets } = await inquirer.prompt([
            {
                type: "confirm",
                name: "syncSecrets",
                message: "Sync secrets to AWS Secrets Manager?",
                default: true,
            },
        ]);

        if (syncSecrets) {
            console.log("\nSyncing secrets to AWS Secrets Manager...\n");
            await syncSecretsToAWS({
                profile,
                awsProfile: config.awsProfile,
                region: config.cdkRegion || awsRegion,
            });
            console.log("\n✓ Secrets synced successfully");
        }
    }

    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    console.log("║   Configuration Complete!                                 ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    return config;
}

/**
 * Main execution for CLI usage
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const options: WizardOptions = {};

    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--profile" && i + 1 < args.length) {
            options.profile = args[i + 1];
            i++;
        } else if (args[i] === "--non-interactive") {
            options.nonInteractive = true;
        } else if (args[i] === "--skip-validation") {
            options.skipValidation = true;
        } else if (args[i] === "--aws-profile" && i + 1 < args.length) {
            options.awsProfile = args[i + 1];
            i++;
        } else if (args[i] === "--aws-region" && i + 1 < args.length) {
            options.awsRegion = args[i + 1];
            i++;
        } else if (args[i] === "--help") {
            console.log("Usage: install-wizard [options]");
            console.log("\nOptions:");
            console.log("  --profile <name>          Configuration profile name (default: default)");
            console.log("  --non-interactive         Run in non-interactive mode (CI/CD)");
            console.log("  --skip-validation         Skip validation checks");
            console.log("  --aws-profile <profile>   AWS profile to use");
            console.log("  --aws-region <region>     AWS region (default: us-east-1)");
            console.log("  --help                    Show this help message");
            process.exit(0);
        }
    }

    try {
        await runInstallWizard(options);
    } catch (error) {
        console.error("\n❌ Configuration failed:", (error as Error).message);
        process.exit(1);
    }
}

// Run main if executed directly
if (require.main === module) {
    main();
}
