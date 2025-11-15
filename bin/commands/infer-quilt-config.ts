#!/usr/bin/env node
/**
 * Quilt Catalog Auto-Inference
 *
 * Automatically infers Quilt catalog configuration from:
 * 1. quilt3 CLI command (`quilt3 config`)
 * 2. AWS CloudFormation stack inspection
 * 3. Interactive catalog selection (if multiple catalogs available)
 *
 * @module scripts/infer-quilt-config
 */

import { execSync } from "child_process";
import * as readline from "readline";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { CloudFormationClient, DescribeStacksCommand, ListStacksCommand } from "@aws-sdk/client-cloudformation";
import { isQueueUrl } from "../../lib/utils/sqs";
import { fetchJson } from "../../lib/utils/stack-inference";

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
    account?: string;
    database?: string;
    queueUrl?: string;
    catalogUrl?: string;
    benchlingSecretArn?: string;
}

/**
 * Result of Quilt configuration inference
 */
interface InferenceResult {
    catalog?: string;
    database?: string;
    stackArn?: string;
    region?: string;
    account?: string;
    queueUrl?: string;
    benchlingSecretArn?: string;
    source: string;
}

/**
 * Executes quilt3 config command to get current catalog URL
 *
 * @returns Catalog URL from quilt3 CLI or null if command fails
 */
function getQuilt3Catalog(): QuiltCliConfig | null {
    try {
        const output = execSync("quilt3 config", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
        const catalogUrl = output.trim();

        if (catalogUrl && catalogUrl.startsWith("http")) {
            console.log(`Found quilt3 CLI configuration: ${catalogUrl}`);
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
 * @param region - AWS region to search (defaults to us-east-1)
 * @param profile - AWS profile to use
 * @returns Array of Quilt stack information
 */
async function findQuiltStacks(region: string = "us-east-1", profile?: string): Promise<QuiltStackInfo[]> {
    try {
        const clientConfig: { region: string; credentials?: AwsCredentialIdentityProvider } = { region };

        if (profile) {
            // Load AWS profile credentials
            const { fromIni } = await import("@aws-sdk/credential-providers");
            clientConfig.credentials = fromIni({ profile });
        }

        const client = new CloudFormationClient(clientConfig);

        // List all stacks (include rollback states as they may still be functional)
        const listCommand = new ListStacksCommand({
            StackStatusFilter: ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"],
        });

        const listResponse = await client.send(listCommand);
        const stacks = listResponse.StackSummaries || [];

        // Get detailed information for each stack and filter for Quilt stacks
        // All Quilt catalog stacks have a "QuiltWebHost" output - this is the canonical identifier
        // Stack names vary (e.g., "quilt-staging", "tf-stable", "sales-prod") so we check outputs
        const stackInfos: QuiltStackInfo[] = [];

        for (const stack of stacks) {
            if (!stack.StackName) continue;

            try {
                const describeCommand = new DescribeStacksCommand({
                    StackName: stack.StackName,
                });

                const describeResponse = await client.send(describeCommand);
                const stackDetail = describeResponse.Stacks?.[0];

                if (!stackDetail) continue;

                const outputs = stackDetail.Outputs || [];

                // Only include this stack if it has QuiltWebHost output (canonical Quilt stack identifier)
                const hasQuiltWebHost = outputs.some((output) => output.OutputKey === "QuiltWebHost");
                if (!hasQuiltWebHost) continue;

                const stackInfo: QuiltStackInfo = {
                    stackName: stack.StackName,
                    stackArn: stackDetail.StackId || "",
                    region: region,
                };

                // Extract AWS Account ID from Stack ARN
                // ARN format: arn:aws:cloudformation:REGION:ACCOUNT_ID:stack/STACK_NAME/STACK_ID
                const arnMatch = stackInfo.stackArn.match(/^arn:aws:cloudformation:[^:]+:(\d{12}):/);
                if (arnMatch) {
                    stackInfo.account = arnMatch[1];
                }

                // Extract outputs
                for (const output of outputs) {
                    const key = output.OutputKey || "";
                    const value = output.OutputValue || "";

                    if (key === "QuiltWebHost") {
                        stackInfo.catalogUrl = value;
                    } else if (key === "UserAthenaDatabaseName" || key.includes("Database")) {
                        stackInfo.database = value;
                    } else if (key.includes("Queue")) {
                        if (isQueueUrl(value)) {
                            stackInfo.queueUrl = value;
                        }
                    } else if (key === "BenchlingSecretArn" || key === "BenchlingSecret") {
                        // Check for BenchlingSecret output from T4 template
                        stackInfo.benchlingSecretArn = value;
                    }
                }

                stackInfos.push(stackInfo);
            } catch {
                // Silently skip stacks that can't be described
                // to avoid overwhelming users with warnings for non-accessible stacks
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
 * 2. Fetch catalog's config.json to get region
 * 3. CloudFormation stack inspection in that region
 * 4. Interactive selection if multiple options
 *
 * @param options - Inference options
 * @returns Inferred configuration
 */
export async function inferQuiltConfig(options: {
    region?: string;
    profile?: string;
    interactive?: boolean;
    yes?: boolean;
}): Promise<InferenceResult> {
    const { region, profile, interactive = true, yes = false } = options;

    const result: InferenceResult = {
        source: "none",
    };

    // Step 1: Try quilt3 CLI command
    console.log("Checking quilt3 CLI configuration...");
    const quilt3Config = getQuilt3Catalog();

    if (quilt3Config?.catalogUrl) {
        result.catalog = quilt3Config.catalogUrl;
        result.source = "quilt3-cli";
    } else {
        console.log("No quilt3 CLI configuration found.");
    }

    // Step 1.5: If we have a catalog URL but no region specified, fetch config.json to get the region
    let searchRegion = region;
    let catalogNameFromUrl: string | undefined;

    if (quilt3Config?.catalogUrl && !searchRegion) {
        try {
            console.log(`\nFetching catalog configuration from ${quilt3Config.catalogUrl}...`);
            const configUrl = quilt3Config.catalogUrl.replace(/\/$/, "") + "/config.json";
            const catalogConfig = (await fetchJson(configUrl)) as { region?: string; stackName?: string; [key: string]: unknown };

            if (catalogConfig.region) {
                searchRegion = catalogConfig.region;
                result.region = searchRegion;
                console.log(`✓ Found catalog region: ${searchRegion}`);
            } else {
                console.log("⚠️  config.json does not contain region field");
            }

            // Extract catalog name from config.json if available
            if (catalogConfig.stackName) {
                catalogNameFromUrl = catalogConfig.stackName as string;
            }
        } catch (error) {
            console.log(`⚠️  Could not fetch config.json: ${(error as Error).message}`);
            console.log("   Falling back to default region search...");
        }
    }

    // Step 2: Search for CloudFormation stacks
    console.log("\nSearching for Quilt CloudFormation stacks...");

    // Use the region from config.json if available, otherwise use provided region or default
    const regionToSearch = searchRegion || "us-east-1";
    console.log(`Searching in region: ${regionToSearch}`);

    const stacks = await findQuiltStacks(regionToSearch, profile);

    if (stacks.length === 0) {
        console.log("No Quilt CloudFormation stacks found.");
        return result;
    }

    console.log(`Found ${stacks.length} Quilt stack(s):\n`);

    let selectedStack: QuiltStackInfo;

    // If we have a catalog URL from quilt3, try to find matching stack
    if (result.catalog && stacks.length > 1) {
        // Normalize URLs for comparison (remove protocol and trailing slashes)
        const normalizeUrl = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const targetUrl = normalizeUrl(result.catalog);

        const matchingStack = stacks.find((s) => s.catalogUrl && normalizeUrl(s.catalogUrl) === targetUrl);
        if (matchingStack) {
            selectedStack = matchingStack;
            console.log(`Auto-selected stack matching catalog URL: ${selectedStack.stackName}`);

            // If --yes not passed and interactive mode, verify the catalog name before using it
            if (!yes && interactive) {
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });

                const confirmed = await new Promise<boolean>((resolve) => {
                    rl.question(
                        `\nUsing catalog stack: ${selectedStack.stackName}\nIs this the correct catalog? (y/n): `,
                        (answer) => {
                            rl.close();
                            resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
                        }
                    );
                });

                if (!confirmed) {
                    console.log("\nPlease select the correct stack:");
                    const options = stacks.map((s) => `${s.stackName} (${s.region})`);
                    const selectedIndex = await promptCatalogSelection(options);
                    selectedStack = stacks[selectedIndex];
                    console.log(`\nSelected: ${selectedStack.stackName}`);
                }
            }
        } else {
            // No match found, prompt user
            console.log(`No stack found matching catalog URL: ${result.catalog}`);
            if (interactive) {
                const options = stacks.map((s) => `${s.stackName} (${s.region})`);
                const selectedIndex = await promptCatalogSelection(options);
                selectedStack = stacks[selectedIndex];
                console.log(`\nSelected: ${selectedStack.stackName}`);
            } else {
                selectedStack = stacks[0];
                console.log(`Using first stack: ${selectedStack.stackName}`);
            }
        }
    } else if (stacks.length === 1) {
        selectedStack = stacks[0];
        console.log(`Using stack: ${selectedStack.stackName}`);

        // If --yes not passed and interactive mode, verify the catalog name before using it
        if (!yes && interactive) {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            const confirmed = await new Promise<boolean>((resolve) => {
                rl.question(
                    `\nUsing catalog stack: ${selectedStack.stackName}\nIs this the correct catalog? (y/n): `,
                    (answer) => {
                        rl.close();
                        resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
                    }
                );
            });

            if (!confirmed) {
                // User wants to select manually - let the wizard handle it
                // Return partial result so wizard can prompt for missing fields
                return {
                    ...result,
                    source: "manual-selection-required",
                };
            }
        }
    } else if (interactive) {
        const options = stacks.map((s) => `${s.stackName} (${s.region})`);
        const selectedIndex = await promptCatalogSelection(options);
        selectedStack = stacks[selectedIndex];
        console.log(`\nSelected: ${selectedStack.stackName}`);
    } else {
        selectedStack = stacks[0];
        console.log(`Using first stack: ${selectedStack.stackName}`);
    }

    // Populate result from selected stack
    if (selectedStack.stackArn) {
        result.stackArn = selectedStack.stackArn;
    }
    if (selectedStack.account) {
        result.account = selectedStack.account;
    }
    if (selectedStack.database) {
        result.database = selectedStack.database;
    }
    if (selectedStack.queueUrl) {
        result.queueUrl = selectedStack.queueUrl;
    }
    if (selectedStack.catalogUrl && !result.catalog) {
        result.catalog = selectedStack.catalogUrl;
    }
    if (selectedStack.region) {
        result.region = selectedStack.region;
    }
    if (selectedStack.benchlingSecretArn) {
        result.benchlingSecretArn = selectedStack.benchlingSecretArn;
        console.log(`✓ Found BenchlingSecret from Quilt stack: ${selectedStack.benchlingSecretArn}`);
    }

    if (result.source === "quilt3-cli") {
        result.source = "quilt3-cli+cloudformation";
    } else {
        result.source = "cloudformation";
    }

    return result;
}


/**
 * Main execution for CLI usage
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const options: { region?: string; profile?: string; interactive?: boolean } = {
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

    console.log("Quilt Catalog Auto-Inference\n");

    const result = await inferQuiltConfig(options);

    console.log("\n=== Inference Results ===");
    console.log(`Source: ${result.source}`);
    if (result.catalog) console.log(`Catalog URL: ${result.catalog}`);
    if (result.database) console.log(`Database: ${result.database}`);
    if (result.stackArn) console.log(`Stack ARN: ${result.stackArn}`);
    if (result.region) console.log(`Region: ${result.region}`);
    if (result.account) console.log(`AWS Account ID: ${result.account}`);
    if (result.queueUrl) console.log(`Queue URL: ${result.queueUrl}`);
}

// Run main if executed directly
if (require.main === module) {
    main().catch((error) => {
        console.error("Error:", error.message);
        process.exit(1);
    });
}
