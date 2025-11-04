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
 * @module commands/setup-wizard
 */

import inquirer from "inquirer";
import chalk from "chalk";
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { XDGConfig, BaseConfig } from "../../lib/xdg-config";
import { UserConfig, ProfileName } from "../../lib/types/config";
import { inferQuiltConfig, inferenceResultToDerivedConfig } from "./infer-quilt-config";
import { syncSecretsToAWS } from "./sync-secrets";
import { parseStackArn, extractStackOutputs } from "../../lib/utils/config-resolver";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
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
 * Verifies CDK deployment account using AWS STS
 *
 * @param region - AWS region for STS client
 * @param awsProfile - AWS profile to use (optional)
 * @returns AWS account ID
 */
async function verifyCDKDeploymentAccount(region: string, awsProfile?: string): Promise<string> {
    try {
        const clientConfig: { region: string; credentials?: AwsCredentialIdentityProvider } = { region };

        if (awsProfile) {
            const { fromIni } = await import("@aws-sdk/credential-providers");
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        const stsClient = new STSClient(clientConfig);
        const response = await stsClient.send(new GetCallerIdentityCommand({}));

        const accountId = response.Account!;
        console.log(`  ✓ CDK deployment account verified: ${accountId}`);
        return accountId;
    } catch (error) {
        throw new Error(`Failed to verify AWS account: ${(error as Error).message}`);
    }
}

/**
 * Finds catalog region by fetching config.json from QuiltWebHost
 *
 * @param catalogUrl - Quilt catalog URL (QuiltWebHost)
 * @returns AWS region string or null if unable to determine
 */
async function findCatalogRegion(catalogUrl: string): Promise<string | null> {
    if (!catalogUrl || catalogUrl.trim().length === 0) {
        return null;
    }

    // Validate URL format
    try {
        new URL(catalogUrl);
    } catch {
        console.warn(`  ⚠ Invalid catalog URL format: ${catalogUrl}`);
        return null;
    }

    // Fetch config.json from QuiltWebHost
    const configUrl = `${catalogUrl}/config.json`;

    return new Promise((resolve) => {
        https
            .get(configUrl, { timeout: 10000 }, (res) => {
                let data = "";

                res.on("data", (chunk) => {
                    data += chunk;
                });

                res.on("end", () => {
                    if (res.statusCode === 200) {
                        try {
                            const config = JSON.parse(data);

                            // Quilt config.json has direct "region" field
                            const region = config.region;

                            if (region && typeof region === "string") {
                                console.log(`  ✓ Found catalog region: ${region}`);
                                resolve(region);
                            } else {
                                console.warn("  ⚠ No region field in catalog config.json");
                                resolve(null);
                            }
                        } catch (error) {
                            console.warn(`  ⚠ Failed to parse catalog config.json: ${(error as Error).message}`);
                            resolve(null);
                        }
                    } else {
                        console.warn(`  ⚠ Catalog config.json returned status ${res.statusCode}`);
                        resolve(null);
                    }
                });
            })
            .on("error", (error) => {
                console.warn(`  ⚠ Could not fetch catalog config: ${error.message}`);
                resolve(null);
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

    // Load existing configuration if available
    const xdgConfig = new XDGConfig();
    let existingConfig: UserConfig = {};

    try {
        existingConfig = xdgConfig.readProfileConfig("user", profile) as UserConfig;
        console.log("✓ Loaded existing configuration\n");
    } catch {
        console.log("No existing configuration found, starting fresh\n");
    }

    const config: UserConfig = {
        ...existingConfig, // Merge existing config as defaults
        _metadata: {
            source: "install-wizard",
            savedAt: new Date().toISOString(),
            version: "0.6.0",
        },
    };

    // Step 1: Infer Quilt configuration
    console.log("Step 1: Inferring Quilt configuration...\n");

    // Step 1a: Try to get catalog URL from quilt3 CLI first
    let catalogRegion = awsRegion;
    try {
        const { execSync } = await import("child_process");
        const catalogUrl = execSync("quilt3 config", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();

        if (catalogUrl && catalogUrl.startsWith("http")) {
            console.log(`Found quilt3 CLI catalog: ${catalogUrl}`);

            // Fetch region from catalog config.json
            const detectedRegion = await findCatalogRegion(catalogUrl);
            if (detectedRegion) {
                catalogRegion = detectedRegion;
                console.log(`Using catalog region: ${catalogRegion}`);
            }
        }
    } catch {
        // quilt3 not available or failed, continue with default region
        console.log(`No quilt3 CLI found, using default region: ${catalogRegion}`);
    }

    const inferenceResult = await inferQuiltConfig({
        region: catalogRegion,
        profile: awsProfile,
        interactive: !nonInteractive,
    });

    const derivedConfig = inferenceResultToDerivedConfig(inferenceResult);

    // Merge inferred config
    Object.assign(config, derivedConfig);

    console.log("\n✓ Quilt configuration inferred");

    // Step 2: Display and confirm Quilt stack configuration
    if (!nonInteractive) {
        console.log("\nStep 2: Verify Quilt Stack Configuration\n");

        console.log("Detected Quilt stack:");

        // Use parseStackArn and extractStackOutputs to get complete stack info
        if (config.quiltStackArn) {
            try {
                const parsedArn = parseStackArn(config.quiltStackArn);
                console.log(`  Stack Name: ${parsedArn.stackName}`);
                console.log(`  Stack ARN: ${config.quiltStackArn}`);
                console.log(`  Region: ${parsedArn.region}`);
                console.log(`  Account: ${parsedArn.account}`);

                // Fetch stack outputs using the config-resolver module
                try {
                    const clientConfig: { region: string; credentials?: AwsCredentialIdentityProvider } = {
                        region: parsedArn.region,
                    };

                    if (config.awsProfile || awsProfile) {
                        const { fromIni } = await import("@aws-sdk/credential-providers");
                        clientConfig.credentials = fromIni({ profile: config.awsProfile || awsProfile });
                    }

                    const cfClient = new CloudFormationClient(clientConfig);
                    const outputs = await extractStackOutputs(cfClient, parsedArn.stackName);

                    console.log(`  Catalog URL: ${outputs.QuiltWebHost || "Not found"}`);
                    console.log(`  User Database: ${outputs.UserAthenaDatabaseName || outputs.AthenaDatabase || "Not found"}`);
                    console.log(`  Queue ARN: ${outputs.PackagerQueueArn || outputs.QueueArn || "Not found"}`);
                } catch (outputError) {
                    console.warn(`  ⚠ Could not fetch stack outputs: ${(outputError as Error).message}`);
                    console.log(`  Catalog URL: ${config.quiltCatalog || "Not found"}`);
                    console.log(`  Queue ARN: ${config.queueArn || "Not found"}`);
                }
            } catch {
                // Fall back to simple display if parsing fails
                console.log(`  Stack ARN: ${config.quiltStackArn}`);
                console.log(`  Region: ${config.quiltRegion || awsRegion}`);
                console.log(`  Catalog URL: ${config.quiltCatalog || "Not found"}`);
                console.log(`  Queue ARN: ${config.queueArn || "Not found"}`);
            }
        } else {
            console.log("  Stack ARN: Not found");
            console.log(`  Region: ${config.quiltRegion || awsRegion}`);
        }

        const { confirmStack } = await inquirer.prompt([
            {
                type: "confirm",
                name: "confirmStack",
                message: "Is this the correct Quilt stack?",
                default: true,
            },
        ]);

        if (!confirmStack) {
            console.log("\nPlease run the wizard again and select the correct stack.");
            process.exit(0);
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
                default: config.benchlingTenant,
                validate: (input: string): boolean | string => input.trim().length > 0 || "Tenant is required",
            },
            {
                type: "input",
                name: "benchlingClientId",
                message: "Benchling OAuth Client ID:",
                default: config.benchlingClientId,
                validate: (input: string): boolean | string => input.trim().length > 0 || "Client ID is required",
            },
            {
                type: "password",
                name: "benchlingClientSecret",
                message: config.benchlingClientSecret
                    ? "Benchling OAuth Client Secret (press Enter to keep existing):"
                    : "Benchling OAuth Client Secret:",
                validate: (input: string): boolean | string => {
                    // If there's an existing secret and input is empty, we'll keep the existing one
                    if (config.benchlingClientSecret && input.trim().length === 0) {
                        return true;
                    }
                    return input.trim().length > 0 || "Client secret is required";
                },
            },
            {
                type: "input",
                name: "benchlingAppDefinitionId",
                message: "Benchling App Definition ID:",
                default: config.benchlingAppDefinitionId,
                validate: (input: string): boolean | string => input.trim().length > 0 || "App definition ID is required",
            },
            {
                type: "input",
                name: "benchlingPkgBucket",
                message: "Benchling Package S3 Bucket:",
                default: config.benchlingPkgBucket || config.quiltUserBucket,
                validate: (input: string): boolean | string => input.trim().length > 0 || "Bucket name is required",
            },
        ]);

        // Handle empty password input - keep existing secret if user pressed Enter
        if (benchlingAnswers.benchlingClientSecret.trim().length === 0 && config.benchlingClientSecret) {
            benchlingAnswers.benchlingClientSecret = config.benchlingClientSecret;
        }

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

            // Validate Benchling package bucket
            if (config.benchlingPkgBucket) {
                const bucketValidation = await validateS3BucketAccess(
                    config.benchlingPkgBucket,
                    config.quiltRegion || awsRegion,
                    awsProfile,
                );
                if (!bucketValidation.isValid) {
                    console.error("\n❌ Benchling package bucket validation failed:");
                    bucketValidation.errors.forEach((err) => console.error(`  - ${err}`));
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
    } else {
        // Non-interactive mode: use existing config values
        // Required fields must already be set in XDG config
        if (!config.benchlingTenant || !config.benchlingClientId || !config.benchlingClientSecret) {
            throw new Error(
                "Non-interactive mode requires benchlingTenant, benchlingClientId, and benchlingClientSecret to be already configured in XDG config. Run 'npm run setup' interactively first.",
            );
        }

        // Set default bucket if not specified
        if (!config.benchlingPkgBucket) {
            config.benchlingPkgBucket = config.quiltUserBucket;
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

        // Verify CDK deployment account
        console.log("\nVerifying CDK deployment account...");
        try {
            const accountId = await verifyCDKDeploymentAccount(awsAnswers.cdkRegion, config.awsProfile);
            config.cdkAccount = accountId;
        } catch (error) {
            console.error(`\n❌ Failed to verify AWS account: ${(error as Error).message}`);
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
    } else {
        // Non-interactive mode: use existing config or default region
        if (!config.cdkRegion) {
            config.cdkRegion = config.quiltRegion || awsRegion;
        }
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
            {
                type: "input",
                name: "benchlingTestEntry",
                message: "Benchling Test Entry ID (optional, for validation):",
                default: config.benchlingTestEntry || "",
            },
        ]);

        Object.assign(config, optionalAnswers);

        // Remove empty benchlingTestEntry if not provided
        if (!config.benchlingTestEntry || config.benchlingTestEntry.trim() === "") {
            delete config.benchlingTestEntry;
        }
    } else {
        // Non-interactive mode: use existing config or defaults
        if (!config.pkgPrefix) {
            config.pkgPrefix = "benchling";
        }
        if (!config.pkgKey) {
            config.pkgKey = "experiment_id";
        }
        if (!config.logLevel) {
            config.logLevel = "INFO";
        }
        // benchlingTestEntry is optional, keep existing value if present
    }

    // Step 6: Save configuration
    console.log("\nStep 6: Saving configuration...\n");

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
 * Setup wizard command handler
 *
 * Provides guided setup experience:
 * 1. Welcome message and prerequisites check
 * 2. Configuration collection via install-wizard
 * 3. Automatic deployment (optional)
 * 4. Integration testing (optional)
 *
 * @returns Promise that resolves when wizard completes
 */
export async function setupWizardCommand(): Promise<void> {
    console.log(chalk.bold.cyan("\n🚀 Benchling Webhook Setup Wizard\n"));
    console.log("This wizard will guide you through:");
    console.log("  1. Collecting configuration (Benchling credentials, AWS settings)");
    console.log("  2. Validating credentials and access");
    console.log("  3. Saving configuration for deployment");
    console.log("  4. Deploying to AWS (optional)\n");
    console.log(chalk.dim("Press Ctrl+C at any time to exit\n"));

    // Run the install wizard
    await runInstallWizard({
        nonInteractive: false,
        skipValidation: false,
    });

    console.log(chalk.green.bold("\n✓ Setup complete!\n"));

    // Run post-setup health check
    console.log(chalk.cyan("Running post-setup health check...\n"));
    const { runHealthChecks } = await import("./health-check");
    const healthStatus = await runHealthChecks();

    // Display health check results
    const healthIcon =
        healthStatus.overall === "healthy" ? chalk.green("✓") : healthStatus.overall === "degraded" ? chalk.yellow("⚠") : chalk.red("❌");
    console.log(`${healthIcon} Configuration health: ${healthStatus.overall}`);

    // Show any warnings or failures
    const issues = healthStatus.checks.filter((c) => c.status !== "pass");
    if (issues.length > 0) {
        console.log(chalk.yellow("\nConfiguration issues detected:"));
        for (const issue of issues) {
            const icon = issue.status === "warn" ? chalk.yellow("⚠") : chalk.red("❌");
            console.log(`  ${icon} ${issue.message}`);
            if (issue.details?.recommendation) {
                console.log(chalk.dim(`     → ${issue.details.recommendation}`));
            }
        }
        console.log("");
    }

    // Ask if user wants to deploy now
    const { shouldDeploy } = await inquirer.prompt([
        {
            type: "confirm",
            name: "shouldDeploy",
            message: "Would you like to deploy to AWS now?",
            default: true,
        },
    ]);

    if (shouldDeploy) {
        console.log(chalk.cyan("\n📦 Starting deployment...\n"));
        const { deployCommand } = await import("./deploy");
        await deployCommand({});
        console.log(chalk.green.bold("\n✓ Deployment complete!\n"));
        console.log("Next steps:");
        console.log(chalk.cyan("  • Set webhook URL in Benchling app settings"));
        console.log(chalk.cyan("  • Install the app in your Benchling tenant"));
        console.log(chalk.cyan("  • Test integration: npx @quiltdata/benchling-webhook test"));
    } else {
        console.log("\nNext steps:");
        console.log(chalk.cyan("  • Run deployment: npx @quiltdata/benchling-webhook deploy"));
        console.log(chalk.cyan("  • Test integration: npx @quiltdata/benchling-webhook test"));
    }

    console.log(chalk.dim("\nFor more information: https://github.com/quiltdata/benchling-webhook\n"));
}
