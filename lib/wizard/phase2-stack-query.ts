/**
 * Phase 2: Stack Query
 *
 * Queries CloudFormation stack for the confirmed catalog and extracts
 * all available parameters including BenchlingSecret ARN.
 *
 * @module wizard/phase2-stack-query
 */

import chalk from "chalk";
import { inferQuiltConfig } from "../../bin/commands/infer-quilt-config";
import { StackQueryResult, DiscoveredVpcInfo } from "./types";
import { discoverVpcFromStack } from "../../scripts/discover-vpc";

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
 * - Handle stack query failures gracefully
 * - Return stack configuration
 *
 * @param catalogDns - Confirmed catalog DNS name
 * @param options - Stack query options
 * @returns Stack query result
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
        const readRoleArn = inferenceResult.readRoleArn;
        const writeRoleArn = inferenceResult.writeRoleArn;

        // Log what we found
        console.log(chalk.green("✓ Stack query succeeded\n"));
        console.log(chalk.dim(`✓ Stack ARN: ${stackArn}`));
        console.log(chalk.dim(`✓ Account: ${account}`));
        console.log(chalk.dim(`✓ Region: ${region}`));
        console.log(chalk.dim(`✓ Queue URL: ${queueUrl}`));
        console.log(chalk.dim(`✓ Database: ${database}`));
        console.log(chalk.dim(`✓ Workgroup: ${athenaUserWorkgroup}`));
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
        if (icebergDatabase) {
            console.log(chalk.green(`✓ Iceberg Database: ${icebergDatabase}`));
        } else {
            console.log(chalk.dim("  Iceberg Database: Not available (optional)"));
        }
        if (icebergWorkgroup) {
            console.log(chalk.green(`✓ Iceberg Workgroup: ${icebergWorkgroup}`));
        } else {
            console.log(chalk.dim("  Iceberg Workgroup: Not available (optional)"));
        }

        // IAM role ARNs are logged by inferQuiltConfig, so no need to log again here

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

        // Discover VPC from stack
        let discoveredVpcInfo: DiscoveredVpcInfo | undefined;
        try {
            const discoveredVpc = await discoverVpcFromStack({
                stackArn,
                region,
            });

            if (discoveredVpc) {
                const privateSubnets = discoveredVpc.subnets.filter((s) => !s.isPublic);
                const azs = new Set(privateSubnets.map((s) => s.availabilityZone));

                discoveredVpcInfo = {
                    vpcId: discoveredVpc.vpcId,
                    name: discoveredVpc.name,
                    cidrBlock: discoveredVpc.cidrBlock,
                    privateSubnetCount: privateSubnets.length,
                    availabilityZoneCount: azs.size,
                    isValid: discoveredVpc.isValid,
                    validationErrors: discoveredVpc.validationErrors,
                };

                if (discoveredVpc.isValid) {
                    console.log(chalk.green(`✓ VPC: ${discoveredVpc.vpcId}`));
                    if (discoveredVpc.name) {
                        console.log(chalk.dim(`  Name: ${discoveredVpc.name}`));
                    }
                    console.log(chalk.dim(`  CIDR: ${discoveredVpc.cidrBlock}`));
                    console.log(chalk.dim(`  Private subnets: ${privateSubnets.length} across ${azs.size} AZs`));
                } else {
                    console.log(chalk.yellow(`⚠ VPC: ${discoveredVpc.vpcId} (does not meet requirements)`));
                    discoveredVpc.validationErrors.forEach((err) => {
                        console.log(chalk.dim(`  - ${err}`));
                    });
                }
            } else {
                console.log(chalk.dim("  VPC: Not found in stack"));
            }
        } catch (error) {
            const err = error as Error;
            console.log(chalk.dim(`  VPC: Discovery failed (${err.message})`));
        }

        console.log("");

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
            readRoleArn,
            writeRoleArn,
            discoveredVpc: discoveredVpcInfo,
            stackQuerySucceeded: true,
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
        };
    }
}
