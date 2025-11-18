/**
 * Phase 2: Stack Query
 *
 * Queries CloudFormation stack for the confirmed catalog and extracts
 * all available parameters including BenchlingSecret ARN.
 * ALSO resolves and caches Quilt services for deployment-time usage.
 *
 * @module wizard/phase2-stack-query
 */

import chalk from "chalk";
import { inferQuiltConfig } from "../../bin/commands/infer-quilt-config";
import { resolveQuiltServices } from "../utils/service-resolver";
import { StackQueryResult } from "./types";
import { ResolvedQuiltServices } from "../types/config";

/**
 * Phase 2 options
 */
export interface StackQueryOptions {
    /** AWS profile to use for querying */
    awsProfile?: string;
    /** AWS region to search in */
    awsRegion?: string;
    /** Non-interactive mode */
    yes?: boolean;
}

/**
 * Phase 2: Stack Query
 *
 * Responsibilities:
 * - Query CloudFormation stack for the confirmed catalog
 * - Extract ALL available parameters from stack
 * - Resolve and cache Quilt services for deployment
 * - Handle stack query failures gracefully
 * - Return stack configuration with cached services
 *
 * @param catalogDns - Confirmed catalog DNS name
 * @param options - Stack query options
 * @returns Stack query result with cached resolved services
 */
export async function runStackQuery(
    catalogDns: string,
    options: StackQueryOptions = {},
): Promise<StackQueryResult> {
    const { awsProfile, awsRegion } = options;

    console.log(`Querying CloudFormation stack for catalog: ${catalogDns}...\n`);

    try {
        // Use inferQuiltConfig with the confirmed catalog - this will skip quilt3 check
        const inferenceResult = await inferQuiltConfig({
            region: awsRegion,
            profile: awsProfile,
            interactive: false, // Don't prompt - we already have the catalog
            yes: true, // Auto-confirm - we already got user's catalog choice
            catalogDns: catalogDns, // Pass the confirmed catalog
        });

        // Verify the inferred catalog matches our confirmed catalog
        const normalizedInferred = inferenceResult.catalog?.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const normalizedConfirmed = catalogDns.replace(/^https?:\/\//, "").replace(/\/$/, "");

        if (normalizedInferred !== normalizedConfirmed) {
            console.log(chalk.yellow(
                `Warning: Inferred catalog (${normalizedInferred}) does not match confirmed catalog (${normalizedConfirmed})`,
            ));
        }

        // Extract data from inference result
        if (!inferenceResult.stackArn) {
            throw new Error(`No CloudFormation stack found for catalog: ${catalogDns}`);
        }

        const stackArn = inferenceResult.stackArn;
        const database = inferenceResult.database || "quilt_catalog";
        const queueUrl = inferenceResult.queueUrl || "";
        const region = inferenceResult.region || awsRegion || "us-east-1";
        const account = inferenceResult.account || "";
        const benchlingSecretArn = inferenceResult.benchlingSecretArn;
        const benchlingIntegrationEnabled = inferenceResult.benchlingIntegrationEnabled;
        const athenaUserWorkgroup = inferenceResult.athenaUserWorkgroup;
        const athenaUserPolicy = inferenceResult.athenaUserPolicy;
        const icebergWorkgroup = inferenceResult.icebergWorkgroup;
        const icebergDatabase = inferenceResult.icebergDatabase;
        const athenaResultsBucket = inferenceResult.athenaResultsBucket;
        const athenaResultsBucketPolicy = inferenceResult.athenaResultsBucketPolicy;

        // Log what we found
        console.log(chalk.green("✓ Stack query succeeded\n"));
        console.log(chalk.dim(`✓ Stack ARN: ${stackArn}`));
        console.log(chalk.dim(`✓ Database: ${database}`));
        console.log(chalk.dim(`✓ Workgroup: ${athenaUserWorkgroup}`));
        console.log(chalk.dim(`✓ Queue URL: ${queueUrl}`));
        console.log(chalk.dim(`✓ Region: ${region}`));
        console.log(chalk.dim(`✓ Account: ${account}`));
        console.log(athenaUserPolicy
            ? chalk.dim(`✓ Athena User Policy: ${athenaUserPolicy}`)
            : chalk.yellow("⚠ Athena User Policy: NOT FOUND"));
        console.log(athenaResultsBucket
            ? chalk.dim(`✓ Athena Results Bucket: ${athenaResultsBucket}`)
            : chalk.yellow("⚠ Athena Results Bucket: NOT FOUND"));
        console.log(athenaResultsBucketPolicy
            ? chalk.dim(`✓ Athena Results Bucket Policy: ${athenaResultsBucketPolicy}`)
            : chalk.yellow("⚠ Athena Results Bucket Policy: NOT FOUND"));

        // Iceberg resources are optional (recent addition to Quilt stacks)
        if (icebergWorkgroup) {
            console.log(chalk.green(`✓ Iceberg Workgroup: ${icebergWorkgroup}`));
        } else {
            console.log(chalk.dim("  Iceberg Workgroup: Not available (optional)"));
        }
        if (icebergDatabase) {
            console.log(chalk.green(`✓ Iceberg Database: ${icebergDatabase}`));
        } else {
            console.log(chalk.dim("  Iceberg Database: Not available (optional)"));
        }

        if (benchlingSecretArn) {
            console.log(chalk.green(`✓ BenchlingSecret: ${benchlingSecretArn}`));
        } else {
            console.log(chalk.dim("⚠ BenchlingSecret: Not found in stack"));
        }

        if (benchlingIntegrationEnabled !== undefined) {
            console.log(
                benchlingIntegrationEnabled
                    ? chalk.green("✓ Benchling Integration: Enabled")
                    : chalk.yellow("⚠ Benchling Integration: Disabled"),
            );
        }

        console.log("");

        // NEW: Resolve Quilt services and cache them for deployment
        console.log(chalk.cyan("Resolving Quilt services from CloudFormation stack...\n"));
        let resolvedServices: ResolvedQuiltServices | undefined;

        try {
            const services = await resolveQuiltServices({ stackArn });

            // Build ResolvedQuiltServices with timestamp and source
            resolvedServices = {
                packagerQueueUrl: services.packagerQueueUrl,
                athenaUserDatabase: services.athenaUserDatabase,
                quiltWebHost: services.quiltWebHost,
                icebergDatabase: services.icebergDatabase,
                athenaUserWorkgroup: services.athenaUserWorkgroup,
                athenaResultsBucket: services.athenaResultsBucket,
                icebergWorkgroup: services.icebergWorkgroup,
                resolvedAt: new Date().toISOString(),
                sourceStackArn: stackArn,
            };

            console.log(chalk.green("✓ Services resolved and cached for deployment\n"));
            console.log(chalk.dim(`  Packager Queue: ${resolvedServices.packagerQueueUrl}`));
            console.log(chalk.dim(`  Athena Database: ${resolvedServices.athenaUserDatabase}`));
            console.log(chalk.dim(`  Quilt Web Host: ${resolvedServices.quiltWebHost}`));
            if (resolvedServices.icebergDatabase) {
                console.log(chalk.dim(`  Iceberg Database: ${resolvedServices.icebergDatabase}`));
            }
            if (resolvedServices.icebergWorkgroup) {
                console.log(chalk.dim(`  Iceberg Workgroup: ${resolvedServices.icebergWorkgroup}`));
            }
            if (resolvedServices.athenaUserWorkgroup) {
                console.log(chalk.dim(`  Athena Workgroup: ${resolvedServices.athenaUserWorkgroup}`));
            }
            if (resolvedServices.athenaResultsBucket) {
                console.log(chalk.dim(`  Athena Results Bucket: ${resolvedServices.athenaResultsBucket}`));
            }
            console.log("");
        } catch (error) {
            // Service resolution failed - log warning but don't fail setup
            // This allows setup to continue even if service resolution has issues
            console.log(chalk.yellow(`⚠ Service resolution failed: ${(error as Error).message}`));
            console.log(chalk.yellow("  Setup will continue, but deployment may require manual configuration\n"));
        }

        return {
            stackArn,
            catalog: normalizedConfirmed,
            database,
            queueUrl,
            region,
            account,
            benchlingSecretArn,
            benchlingIntegrationEnabled,
            athenaUserWorkgroup,
            athenaUserPolicy,
            icebergWorkgroup,
            icebergDatabase,
            athenaResultsBucket,
            athenaResultsBucketPolicy,
            stackQuerySucceeded: true,
            resolvedServices, // Include cached services
        };
    } catch (error) {
        const errorMessage = (error as Error).message;
        console.error(chalk.red(`Stack query failed: ${errorMessage}\n`));

        // Return partial data for graceful degradation
        return {
            stackArn: "",
            catalog: catalogDns,
            database: "quilt_catalog",
            queueUrl: "",
            region: awsRegion || "us-east-1",
            account: "",
            benchlingSecretArn: undefined,
            benchlingIntegrationEnabled: undefined,
            stackQuerySucceeded: false,
            resolvedServices: undefined, // No services if stack query failed
        };
    }
}
