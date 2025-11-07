/**
 * Stack inference utilities for discovering CloudFormation stacks
 * and extracting configuration from Quilt catalogs
 */

import { execSync } from "child_process";
import { isQueueUrl } from "./sqs";

export interface QuiltCatalogConfig {
    region: string;
    apiGatewayEndpoint: string;
    analyticsBucket: string;
    serviceBucket: string;
    stackVersion?: string;
    [key: string]: unknown;
}

export interface StackDetails {
    outputs: Array<{ OutputKey: string; OutputValue: string }>;
    parameters: Array<{ ParameterKey: string; ParameterValue: string }>;
}

export interface InferredStackInfo {
    config: QuiltCatalogConfig;
    stackName: string | null;
    stackDetails: StackDetails;
    inferredVars: Record<string, string>;
}

export interface QuiltStack {
    StackName: string;
    StackStatus: string;
    Outputs?: Array<{ OutputKey: string; OutputValue: string }>;
}

export interface StackSummary {
    StackName: string;
    StackStatus: string;
    CreationTime: string;
    LastUpdatedTime?: string;
}

/**
 * Fetch JSON from a URL using native Node.js modules
 */
export async function fetchJson(url: string): Promise<unknown> {
    const https = await import("https");
    const http = await import("http");

    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === "https:" ? https : http;

        const options = {
            headers: {
                "User-Agent": "benchling-webhook-config-tool/1.0",
                Accept: "application/json",
            },
        };

        client
            .get(url, options, (res) => {
                let data = "";

                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }

                res.on("data", (chunk: Buffer) => {
                    data += chunk.toString();
                });

                res.on("end", () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        const error = e as Error;
                        reject(new Error(`Failed to parse JSON: ${error.message}`));
                    }
                });
            })
            .on("error", reject);
    });
}

/**
 * Try to find CloudFormation stack by searching for resource
 */
export function findStackByResource(region: string, resourceId: string): string | null {
    try {
        const result = execSync(
            `aws cloudformation describe-stack-resources --region ${region} --physical-resource-id "${resourceId}" --query "StackResources[0].StackName" --output text 2>/dev/null`,
            { encoding: "utf-8" },
        );
        const stackName = result.trim();
        return stackName && stackName !== "None" ? stackName : null;
    } catch {
        return null;
    }
}

/**
 * Get stack outputs and parameters
 */
export function getStackDetails(region: string, stackName: string): StackDetails {
    try {
        const outputsResult = execSync(
            `aws cloudformation describe-stacks --region ${region} --stack-name "${stackName}" --query "Stacks[0].Outputs" --output json`,
            { encoding: "utf-8" },
        );

        const paramsResult = execSync(
            `aws cloudformation describe-stacks --region ${region} --stack-name "${stackName}" --query "Stacks[0].Parameters" --output json`,
            { encoding: "utf-8" },
        );

        return {
            outputs: JSON.parse(outputsResult) || [],
            parameters: JSON.parse(paramsResult) || [],
        };
    } catch (error) {
        console.error(
            `Warning: Could not get stack details: ${(error as Error).message}`,
        );
        return { outputs: [], parameters: [] };
    }
}

/**
 * Get AWS account ID
 */
export function getAwsAccountId(): string | null {
    try {
        const result = execSync("aws sts get-caller-identity --query Account --output text", {
            encoding: "utf-8",
        });
        return result.trim();
    } catch {
        return null;
    }
}

/**
 * Extract API Gateway ID from endpoint URL
 */
export function extractApiGatewayId(endpoint: string): string | null {
    const match = endpoint.match(/https:\/\/([a-z0-9]+)\.execute-api/);
    return match ? match[1] : null;
}


/**
 * Find CloudFormation stack using API Gateway ID
 */
export function findStack(
    region: string,
    apiGatewayId: string | null,
    verbose = true,
): string | null {
    let stackName: string | null = null;

    // Search by API Gateway ID
    if (apiGatewayId) {
        if (verbose) console.log(`Searching by API Gateway ID: ${apiGatewayId}...`);
        stackName = findStackByResource(region, apiGatewayId);
        if (stackName && verbose) {
            console.log(`✓ Found stack by API Gateway: ${stackName}`);
        }
    }

    return stackName;
}

/**
 * List all CloudFormation stacks in a region
 */
export function listAllStacks(region: string): StackSummary[] {
    const statusFilters = [
        "CREATE_COMPLETE",
        "UPDATE_COMPLETE",
        "UPDATE_ROLLBACK_COMPLETE",
    ].join(" ");

    try {
        const result = execSync(
            `aws cloudformation list-stacks --region ${region} --stack-status-filter ${statusFilters} --query 'StackSummaries' --output json`,
            { encoding: "utf-8" }
        );
        return JSON.parse(result);
    } catch (error) {
        console.error(`Error listing stacks: ${(error as Error).message}`);
        return [];
    }
}

/**
 * Check if a stack has the QuiltWebHost output (identifying it as a Quilt catalog stack)
 * This is the canonical way to identify Quilt stacks vs other CloudFormation stacks.
 */
export function isQuiltStack(region: string, stackName: string): boolean {
    try {
        const result = execSync(
            `aws cloudformation describe-stacks --region ${region} --stack-name "${stackName}" --query 'Stacks[0].Outputs[?OutputKey==\`QuiltWebHost\`] | length(@)' --output text 2>/dev/null`,
            { encoding: "utf-8" }
        );
        return parseInt(result.trim()) > 0;
    } catch {
        return false;
    }
}

/**
 * Find all Quilt catalog stacks in a region
 * Returns an array of stacks that have the QuiltWebHost output
 */
export function findAllQuiltStacks(region: string, verbose = false): QuiltStack[] {
    if (verbose) {
        console.log(`Searching for Quilt stacks in ${region}...`);
    }

    const allStacks = listAllStacks(region);
    const quiltStacks: QuiltStack[] = [];

    for (const stackSummary of allStacks) {
        if (isQuiltStack(region, stackSummary.StackName)) {
            const details = getStackDetails(region, stackSummary.StackName);
            if (details) {
                quiltStacks.push({
                    StackName: stackSummary.StackName,
                    StackStatus: stackSummary.StackStatus,
                    Outputs: details.outputs,
                });
            }
        }
    }

    if (verbose) {
        console.log(`Found ${quiltStacks.length} Quilt stack(s)`);
    }

    return quiltStacks;
}

/**
 * Build inferred configuration from stack details
 */
export function buildInferredConfig(
    config: QuiltCatalogConfig,
    stackName: string | null,
    stackDetails: StackDetails,
    region: string,
    accountId: string | null,
    catalogDomain: string,
): Record<string, string> {
    const vars: Record<string, string> = {};

    // Extract catalog domain
    const catalogMatch = catalogDomain.match(/https?:\/\/([^/]+)/);
    const catalog = catalogMatch ? catalogMatch[1] : "";

    // AWS Configuration
    if (accountId) {
        vars.CDK_DEFAULT_ACCOUNT = accountId;
    }
    vars.CDK_DEFAULT_REGION = region;
    vars.AWS_REGION = region;

    // Quilt Configuration
    if (catalog) {
        vars.QUILT_CATALOG = catalog;
    }

    // Try to find database name from stack
    const databaseOutput = stackDetails.outputs.find(
        (o) => o.OutputKey === "UserAthenaDatabaseName",
    );
    if (databaseOutput) {
        vars.QUILT_DATABASE = databaseOutput.OutputValue;
    } else if (catalog) {
        // Infer database name from catalog (common pattern)
        const dbGuess = catalog.replace(/[.-]/g, "_") + "_db";
        vars.QUILT_DATABASE = `${dbGuess} # VERIFY THIS - inferred from catalog name`;
    }

    // SQS Queue URL (normalize from URL or ARN)
    const queueOutput =
        stackDetails.outputs.find((o) => o.OutputKey === "PackagerQueueUrl") ||
        stackDetails.outputs.find((o) => o.OutputKey === "QueueUrl");

    if (queueOutput && queueOutput.OutputValue && isQueueUrl(queueOutput.OutputValue)) {
        vars.QUEUE_URL = queueOutput.OutputValue;
    }

    // Additional useful info
    if (stackName) {
        vars["# CloudFormation Stack"] = stackName;
    }
    if (config.stackVersion) {
        vars["# Stack Version"] = config.stackVersion;
    }
    vars["# API Gateway Endpoint"] = config.apiGatewayEndpoint;

    return vars;
}

/**
 * Parse config.json and infer stack information
 */
export async function inferStackConfig(
    catalogUrl: string,
    verbose = true,
): Promise<InferredStackInfo> {
    if (verbose) {
        console.log(`Fetching config from: ${catalogUrl}`);
        console.log("");
    }

    // Normalize URL and construct config.json URL
    let configUrl = catalogUrl.replace(/\/$/, "");
    if (!configUrl.endsWith("/config.json")) {
        configUrl += "/config.json";
    }

    // Fetch config.json
    let config: QuiltCatalogConfig;
    try {
        config = (await fetchJson(configUrl)) as QuiltCatalogConfig;
    } catch (error) {
        // If direct fetch fails, try with just /config.json path
        const err = error as Error;
        if (err.message.includes("403") || err.message.includes("404")) {
            const baseUrl = catalogUrl.match(/https?:\/\/[^/]+/)?.[0];
            if (baseUrl) {
                if (verbose) console.log(`Direct fetch failed, trying: ${baseUrl}/config.json`);
                config = (await fetchJson(`${baseUrl}/config.json`)) as QuiltCatalogConfig;
            } else {
                throw error;
            }
        } else {
            throw error;
        }
    }

    if (verbose) {
        console.log("✓ Successfully fetched config.json");
        console.log("");
        console.log("Catalog Configuration:");
        console.log("=".repeat(80));
        console.log(`Region:           ${config.region}`);
        console.log(`Stack Version:    ${config.stackVersion || "unknown"}`);
        console.log("=".repeat(80));
        console.log("");
    }

    // Extract identifiable resources
    const region = config.region;
    const apiGatewayId = extractApiGatewayId(config.apiGatewayEndpoint);

    if (verbose) {
        console.log("Searching for CloudFormation stack...");
        console.log(`  Region: ${region}`);
        console.log(`  API Gateway ID: ${apiGatewayId || "not found"}`);
        console.log("");
    }

    // Try to find the stack
    const stackName = findStack(
        region,
        apiGatewayId,
        verbose,
    );

    if (verbose) {
        console.log("");

        if (!stackName) {
            console.log("⚠️  Could not automatically find CloudFormation stack.");
            console.log("   You may need to manually specify stack resources.");
            console.log("");
        }
    }

    // Get stack details if found
    let stackDetails: StackDetails = { outputs: [], parameters: [] };
    if (stackName) {
        if (verbose) {
            console.log(`Fetching stack details for: ${stackName}...`);
        }
        stackDetails = getStackDetails(region, stackName);
        if (verbose) {
            console.log(
                `✓ Retrieved ${stackDetails.outputs.length} outputs and ${stackDetails.parameters.length} parameters`,
            );
            console.log("");
        }
    }

    // Get AWS account ID
    const accountId = getAwsAccountId();
    if (accountId && verbose) {
        console.log(`✓ AWS Account ID: ${accountId}`);
        console.log("");
    }

    // Build inferred environment variables
    const inferredVars = buildInferredConfig(
        config,
        stackName,
        stackDetails,
        region,
        accountId,
        catalogUrl.replace(/\/config\.json$/, ""),
    );

    // Display inferred values
    if (verbose) {
        console.log("Inferred Stack Parameters:");
        console.log("=".repeat(80));
        if (inferredVars.QUILT_CATALOG) {
            console.log(`Catalog:          ${inferredVars.QUILT_CATALOG}`);
        }
        if (inferredVars.QUILT_DATABASE) {
            console.log(`Database:         ${inferredVars.QUILT_DATABASE}`);
        }
        if (inferredVars.QUEUE_URL) {
            console.log(`Queue URL:        ${inferredVars.QUEUE_URL}`);
        }
        if (inferredVars.CDK_DEFAULT_ACCOUNT) {
            console.log(`AWS Account:      ${inferredVars.CDK_DEFAULT_ACCOUNT}`);
        }
        if (inferredVars.CDK_DEFAULT_REGION) {
            console.log(`AWS Region:       ${inferredVars.CDK_DEFAULT_REGION}`);
        }
        console.log("=".repeat(80));
        console.log("");
    }

    return {
        config,
        stackName,
        stackDetails,
        inferredVars,
    };
}
