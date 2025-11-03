#!/usr/bin/env node
/**
 * Quilt Catalog Auto-Inference
 *
 * Automatically infers Quilt catalog configuration from:
 * 1. quilt3 CLI configuration (~/.quilt3/config.yml)
 * 2. Interactive catalog selection (if multiple catalogs available)
 * 3. AWS CloudFormation stack inspection
 *
 * @module scripts/infer-quilt-config
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import * as readline from "readline";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { CloudFormationClient, DescribeStacksCommand, ListStacksCommand } from "@aws-sdk/client-cloudformation";
import { DerivedConfig } from "../lib/types/config";

/**
 * Quilt catalog configuration from quilt3 CLI
 */
interface QuiltCatalogConfig {
    navigator_url?: string;
    s3Bucket?: string;
    region?: string;
    registryUrl?: string;
    apiGatewayEndpoint?: string;
}

/**
 * Parsed Quilt stack information
 */
interface QuiltStackInfo {
    stackName: string;
    stackArn: string;
    region: string;
    bucket?: string;
    queueArn?: string;
    catalogUrl?: string;
}

/**
 * Result of Quilt configuration inference
 */
interface InferenceResult {
    catalogUrl?: string;
    quiltUserBucket?: string;
    quiltStackArn?: string;
    quiltRegion?: string;
    queueArn?: string;
    registryUrl?: string;
    source: string;
}

/**
 * Reads quilt3 CLI configuration from ~/.quilt3/config.yml
 *
 * @returns Parsed quilt3 configuration or null if not found
 */
function readQuilt3Config(): QuiltCatalogConfig | null {
    const quilt3ConfigPath = resolve(homedir(), ".quilt3", "config.yml");

    if (!existsSync(quilt3ConfigPath)) {
        return null;
    }

    try {
        const configContent = readFileSync(quilt3ConfigPath, "utf-8");
        const config: QuiltCatalogConfig = {};

        // Parse YAML manually (simple key-value extraction)
        const lines = configContent.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("navigator_url:")) {
                config.navigator_url = trimmed.split("navigator_url:")[1].trim().replace(/['"]/g, "");
            } else if (trimmed.startsWith("s3Bucket:")) {
                config.s3Bucket = trimmed.split("s3Bucket:")[1].trim().replace(/['"]/g, "");
            } else if (trimmed.startsWith("region:")) {
                config.region = trimmed.split("region:")[1].trim().replace(/['"]/g, "");
            } else if (trimmed.startsWith("registryUrl:")) {
                config.registryUrl = trimmed.split("registryUrl:")[1].trim().replace(/['"]/g, "");
            } else if (trimmed.startsWith("apiGatewayEndpoint:")) {
                config.apiGatewayEndpoint = trimmed.split("apiGatewayEndpoint:")[1].trim().replace(/['"]/g, "");
            }
        }

        return config;
    } catch (error) {
        console.error(`Warning: Failed to read quilt3 config: ${(error as Error).message}`);
        return null;
    }
}

/**
 * Executes quilt3 config command to get current configuration
 *
 * @returns Quilt3 config output or null if command fails
 */
function executeQuilt3ConfigCommand(): string | null {
    try {
        const output = execSync("quilt3 config", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
        return output.trim();
    } catch (error) {
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
                    const key = output.OutputKey?.toLowerCase() || "";
                    const value = output.OutputValue || "";

                    if (key.includes("bucket")) {
                        stackInfo.bucket = value;
                    } else if (key.includes("queue")) {
                        stackInfo.queueArn = value;
                    } else if (key.includes("catalog") || key.includes("url")) {
                        stackInfo.catalogUrl = value;
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
 * 1. quilt3 CLI configuration
 * 2. CloudFormation stack inspection
 * 3. Interactive selection if multiple options
 *
 * @param options - Inference options
 * @returns Inferred configuration
 */
export async function inferQuiltConfig(options: {
    region?: string;
    profile?: string;
    interactive?: boolean;
}): Promise<InferenceResult> {
    const { region = "us-east-1", profile, interactive = true } = options;

    const result: InferenceResult = {
        source: "none",
    };

    // Step 1: Try quilt3 CLI configuration
    console.log("Checking quilt3 CLI configuration...");
    const quilt3Config = readQuilt3Config();

    if (quilt3Config) {
        console.log("Found quilt3 configuration:");
        if (quilt3Config.navigator_url) {
            console.log(`  Catalog URL: ${quilt3Config.navigator_url}`);
            result.catalogUrl = quilt3Config.navigator_url;
        }
        if (quilt3Config.s3Bucket) {
            console.log(`  S3 Bucket: ${quilt3Config.s3Bucket}`);
            result.quiltUserBucket = quilt3Config.s3Bucket;
        }
        if (quilt3Config.region) {
            console.log(`  Region: ${quilt3Config.region}`);
            result.quiltRegion = quilt3Config.region;
        }
        if (quilt3Config.registryUrl) {
            result.registryUrl = quilt3Config.registryUrl;
        }

        result.source = "quilt3-cli";
    } else {
        console.log("No quilt3 CLI configuration found.");
    }

    // Step 2: Try CloudFormation stack discovery
    console.log("\nSearching for Quilt CloudFormation stacks...");
    const stacks = await findQuiltStacks(region, profile);

    if (stacks.length > 0) {
        console.log(`Found ${stacks.length} Quilt stack(s):`);

        let selectedStack: QuiltStackInfo;

        if (stacks.length === 1) {
            selectedStack = stacks[0];
            console.log(`  Using stack: ${selectedStack.stackName}`);
        } else if (interactive) {
            const options = stacks.map((s) => `${s.stackName} (${s.region})`);
            const selectedIndex = await promptCatalogSelection(options);
            selectedStack = stacks[selectedIndex];
        } else {
            selectedStack = stacks[0];
            console.log(`  Using first stack: ${selectedStack.stackName}`);
        }

        // Merge stack information
        if (selectedStack.stackArn) {
            result.quiltStackArn = selectedStack.stackArn;
        }
        if (selectedStack.bucket && !result.quiltUserBucket) {
            result.quiltUserBucket = selectedStack.bucket;
        }
        if (selectedStack.queueArn) {
            result.queueArn = selectedStack.queueArn;
        }
        if (selectedStack.catalogUrl && !result.catalogUrl) {
            result.catalogUrl = selectedStack.catalogUrl;
        }
        if (selectedStack.region && !result.quiltRegion) {
            result.quiltRegion = selectedStack.region;
        }

        if (result.source === "none") {
            result.source = "cloudformation";
        } else {
            result.source = "quilt3-cli+cloudformation";
        }
    } else {
        console.log("No Quilt CloudFormation stacks found.");
    }

    return result;
}

/**
 * Converts inference result to DerivedConfig
 *
 * @param result - Inference result
 * @returns DerivedConfig object
 */
export function inferenceResultToDerivedConfig(result: InferenceResult): DerivedConfig {
    const config: DerivedConfig = {
        _metadata: {
            inferredAt: new Date().toISOString(),
            inferredFrom: result.source,
            source: "infer-quilt-config",
            version: "0.6.0",
        },
    };

    if (result.catalogUrl) {
        config.catalogUrl = result.catalogUrl;
        config.quiltCatalog = result.catalogUrl;
    }

    if (result.quiltUserBucket) {
        config.quiltUserBucket = result.quiltUserBucket;
    }

    if (result.quiltStackArn) {
        config.quiltStackArn = result.quiltStackArn;
    }

    if (result.quiltRegion) {
        config.quiltRegion = result.quiltRegion;
    }

    if (result.queueArn) {
        config.queueArn = result.queueArn;
    }

    return config;
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
    if (result.catalogUrl) console.log(`Catalog URL: ${result.catalogUrl}`);
    if (result.quiltUserBucket) console.log(`User Bucket: ${result.quiltUserBucket}`);
    if (result.quiltStackArn) console.log(`Stack ARN: ${result.quiltStackArn}`);
    if (result.quiltRegion) console.log(`Region: ${result.quiltRegion}`);
    if (result.queueArn) console.log(`Queue ARN: ${result.queueArn}`);

    const derivedConfig = inferenceResultToDerivedConfig(result);
    console.log("\n=== Derived Configuration ===");
    console.log(JSON.stringify(derivedConfig, null, 4));
}

// Run main if executed directly
if (require.main === module) {
    main().catch((error) => {
        console.error("Error:", error.message);
        process.exit(1);
    });
}
