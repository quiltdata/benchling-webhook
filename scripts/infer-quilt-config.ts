#!/usr/bin/env ts-node
/**
 * Quilt Catalog Auto-Inference (v0.7.0)
 *
 * Automatically infers Quilt catalog configuration from:
 * 1. quilt3 CLI command (`quilt3 config`)
 * 2. AWS CloudFormation stack inspection
 * 3. Interactive catalog selection (if multiple catalogs available)
 *
 * Returns configuration in v0.7.0 ProfileConfig format.
 *
 * @module scripts/infer-quilt-config
 */

import { execSync } from "child_process";
import * as readline from "readline";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { CloudFormationClient, DescribeStacksCommand, ListStacksCommand } from "@aws-sdk/client-cloudformation";
import { QuiltConfig } from "../lib/types/config";

/**
 * Quilt CLI configuration
 */
interface QuiltCliConfig {
    catalogUrl?: string;
}

/**
 * Parsed Quilt stack information
 */
interface QuiltStackInfo {
    stackName: string;
    stackArn: string;
    region: string;
    bucket?: string;
    database?: string;
    queueArn?: string;
    catalogUrl?: string;
}

/**
 * Inference options
 */
export interface InferenceOptions {
    region?: string;
    profile?: string;
    interactive?: boolean;
}

/**
 * Executes quilt3 config command to get current catalog URL
 *
 * @returns Catalog URL from quilt3 CLI or null if command fails
 */
function getQuilt3Catalog(): QuiltCliConfig | null {
    try {
        const output = execSync("quilt3 config", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
        let catalogUrl = output.trim();

        if (catalogUrl && catalogUrl.startsWith("http")) {
            console.log(`Found quilt3 CLI configuration: ${catalogUrl}`);
            // Strip protocol and trailing slash, store only domain
            catalogUrl = catalogUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
            return { catalogUrl };
        }

        return null;
    } catch {
        // quilt3 command not available or failed
        return null;
    }
}

/**
 * Finds Quilt CloudFormation stacks in AWS account
 *
 * @param region - AWS region to search
 * @param profile - AWS profile to use
 * @returns Array of Quilt stack information
 */
async function findQuiltStacks(region: string, profile?: string): Promise<QuiltStackInfo[]> {
    try {
        const clientConfig: { region: string; credentials?: AwsCredentialIdentityProvider } = { region };

        if (profile) {
            const { fromIni } = await import("@aws-sdk/credential-providers");
            clientConfig.credentials = fromIni({ profile });
        }

        const client = new CloudFormationClient(clientConfig);

        // List all stacks
        const listCommand = new ListStacksCommand({
            StackStatusFilter: ["CREATE_COMPLETE", "UPDATE_COMPLETE"],
        });

        const listResponse = await client.send(listCommand);
        const stacks = listResponse.StackSummaries || [];

        // Filter for Quilt stacks (containing "quilt" in the name)
        const quiltStacks = stacks.filter(
            (stack) =>
                stack.StackName?.toLowerCase().includes("quilt") ||
                stack.StackName?.toLowerCase().includes("catalog"),
        );

        // Get detailed information for each stack
        const stackInfos: QuiltStackInfo[] = [];
        for (const stack of quiltStacks) {
            if (!stack.StackName) continue;

            try {
                const describeCommand = new DescribeStacksCommand({
                    StackName: stack.StackName,
                });

                const describeResponse = await client.send(describeCommand);
                const stackDetail = describeResponse.Stacks?.[0];

                if (!stackDetail) continue;

                const outputs = stackDetail.Outputs || [];
                const stackInfo: QuiltStackInfo = {
                    stackName: stack.StackName,
                    stackArn: stackDetail.StackId || "",
                    region: region,
                };

                // Extract outputs
                for (const output of outputs) {
                    const key = output.OutputKey || "";
                    const value = output.OutputValue || "";

                    if (key === "QuiltWebHost") {
                        // Strip protocol and trailing slash, store only domain
                        stackInfo.catalogUrl = value.replace(/^https?:\/\//, "").replace(/\/$/, "");
                    } else if (key.includes("ucket")) {
                        stackInfo.bucket = value;
                    } else if (key === "UserAthenaDatabaseName" || key.includes("Database")) {
                        stackInfo.database = value;
                    } else if (key.includes("Queue")) {
                        stackInfo.queueArn = value;
                    }
                }

                stackInfos.push(stackInfo);
            } catch (describeError) {
                console.error(`Warning: Failed to describe stack ${stack.StackName}: ${(describeError as Error).message}`);
            }
        }

        return stackInfos;
    } catch (error) {
        console.error(`Warning: Failed to list CloudFormation stacks: ${(error as Error).message}`);
        return [];
    }
}

/**
 * Prompts user to select from multiple catalog options
 *
 * @param options - Array of catalog options
 * @returns Selected catalog index
 */
async function promptCatalogSelection(options: string[]): Promise<number> {
    console.log("\nMultiple Quilt catalog configurations found:");
    options.forEach((opt, idx) => {
        console.log(`  ${idx + 1}. ${opt}`);
    });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(`\nSelect catalog (1-${options.length}): `, (answer) => {
            rl.close();
            const selection = parseInt(answer.trim(), 10);
            if (isNaN(selection) || selection < 1 || selection > options.length) {
                console.log("Invalid selection, using first option.");
                resolve(0);
            } else {
                resolve(selection - 1);
            }
        });
    });
}

/**
 * Infers Quilt configuration from multiple sources
 *
 * Priority order:
 * 1. quilt3 CLI command (`quilt3 config`)
 * 2. CloudFormation stack inspection
 * 3. Interactive selection if multiple options
 *
 * Returns configuration in v0.7.0 ProfileConfig.quilt format.
 *
 * @param options - Inference options
 * @returns Quilt configuration object
 *
 * @example
 * ```typescript
 * const quiltConfig = await inferQuiltConfig({
 *   region: "us-east-1",
 *   profile: "default",
 *   interactive: true
 * });
 * console.log(quiltConfig.stackArn);
 * ```
 */
export async function inferQuiltConfig(options: InferenceOptions = {}): Promise<Partial<QuiltConfig>> {
    const { region = "us-east-1", profile, interactive = true } = options;

    const result: Partial<QuiltConfig> = {
        region,
    };

    // Step 1: Try quilt3 CLI command
    console.log("Checking quilt3 CLI configuration...");
    const quilt3Config = getQuilt3Catalog();

    if (quilt3Config?.catalogUrl) {
        result.catalog = quilt3Config.catalogUrl;
        console.log(`  ✓ Found catalog URL from quilt3: ${result.catalog}`);
    } else {
        console.log("  No quilt3 CLI configuration found.");
    }

    // Step 2: Search for CloudFormation stacks
    console.log("\nSearching for Quilt CloudFormation stacks...");
    const stacks = await findQuiltStacks(region, profile);

    if (stacks.length === 0) {
        console.log("  No Quilt CloudFormation stacks found.");
        if (!result.catalog) {
            throw new Error(
                "Unable to infer Quilt configuration. Please run 'quilt3 config <catalog-url>' or provide stack ARN manually.",
            );
        }
        return result;
    }

    console.log(`  Found ${stacks.length} Quilt stack(s)\n`);

    let selectedStack: QuiltStackInfo;

    // If we have a catalog URL from quilt3, try to find matching stack
    if (result.catalog && stacks.length > 1) {
        // Both result.catalog and stack catalogUrl are now bare domains, so compare directly
        const matchingStack = stacks.find((s) => s.catalogUrl === result.catalog);
        if (matchingStack) {
            selectedStack = matchingStack;
            console.log(`  Auto-selected stack matching catalog URL: ${selectedStack.stackName}`);
        } else {
            console.log(`  No stack found matching catalog URL: ${result.catalog}`);
            if (interactive) {
                const options = stacks.map((s) => `${s.stackName} (${s.region})`);
                const selectedIndex = await promptCatalogSelection(options);
                selectedStack = stacks[selectedIndex];
                console.log(`\nSelected: ${selectedStack.stackName}`);
            } else {
                selectedStack = stacks[0];
                console.log(`  Using first stack: ${selectedStack.stackName}`);
            }
        }
    } else if (stacks.length === 1) {
        selectedStack = stacks[0];
        console.log(`  Using stack: ${selectedStack.stackName}`);
    } else if (interactive) {
        const options = stacks.map((s) => `${s.stackName} (${s.region})`);
        const selectedIndex = await promptCatalogSelection(options);
        selectedStack = stacks[selectedIndex];
        console.log(`\nSelected: ${selectedStack.stackName}`);
    } else {
        selectedStack = stacks[0];
        console.log(`  Using first stack: ${selectedStack.stackName}`);
    }

    // Populate result from selected stack
    result.stackArn = selectedStack.stackArn;
    result.bucket = selectedStack.bucket;
    result.database = selectedStack.database || "quilt_catalog";
    result.queueArn = selectedStack.queueArn;
    result.region = selectedStack.region;

    if (selectedStack.catalogUrl) {
        result.catalog = selectedStack.catalogUrl;
    }

    console.log("\n✓ Quilt configuration inferred successfully\n");

    return result;
}

/**
 * Main execution for CLI usage
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const options: InferenceOptions = {
        interactive: true,
    };

    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--region" && i + 1 < args.length) {
            options.region = args[i + 1];
            i++;
        } else if (args[i] === "--profile" && i + 1 < args.length) {
            options.profile = args[i + 1];
            i++;
        } else if (args[i] === "--non-interactive") {
            options.interactive = false;
        }
    }

    console.log("Quilt Catalog Auto-Inference (v0.7.0)\n");

    const result = await inferQuiltConfig(options);

    console.log("=== Inference Results ===");
    console.log(`Stack ARN: ${result.stackArn || "Not found"}`);
    console.log(`Catalog URL: ${result.catalog || "Not found"}`);
    console.log(`Bucket: ${result.bucket || "Not found"}`);
    console.log(`Database: ${result.database || "Not found"}`);
    console.log(`Queue ARN: ${result.queueArn || "Not found"}`);
    console.log(`Region: ${result.region || "Not found"}`);
}

// Run main if executed directly
if (require.main === module) {
    main().catch((error) => {
        console.error("Error:", error.message);
        process.exit(1);
    });
}
