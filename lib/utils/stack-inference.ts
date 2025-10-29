/**
 * Stack inference utilities for discovering CloudFormation stacks
 * and extracting configuration from Quilt catalogs
 */

import { execSync } from "child_process";

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
 * Extract bucket name from S3 ARN or bucket name string
 */
export function extractBucketName(bucketString: string): string {
    if (bucketString.startsWith("arn:aws:s3:::")) {
        return bucketString.replace("arn:aws:s3:::", "").split("/")[0];
    }
    return bucketString.split("/")[0];
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
 * Search for stacks by name pattern
 */
export function searchStacksByPattern(region: string, pattern: string): string[] {
    try {
        const result = execSync(
            `aws cloudformation list-stacks --region ${region} --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE --query "StackSummaries[?contains(StackName, '${pattern}')].StackName" --output json`,
            { encoding: "utf-8" },
        );
        return JSON.parse(result) as string[];
    } catch {
        return [];
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
 * Extract stack name prefix from bucket names
 */
export function inferStackPrefix(analyticsBucket?: string, serviceBucket?: string): string {
    const patterns = [analyticsBucket, serviceBucket]
        .filter(Boolean)
        .map((bucket) => {
            const parts = (bucket as string).split("-");
            if (parts.length >= 3) {
                return parts.slice(0, 2).join("-");
            }
            return parts[0];
        });

    return patterns[0] || "quilt";
}

/**
 * Find CloudFormation stack using multiple search strategies
 */
export function findStack(
    region: string,
    apiGatewayId: string | null,
    analyticsBucket: string,
    serviceBucket: string,
    stackPrefix: string,
    verbose = true,
): string | null {
    let stackName: string | null = null;

    // Method 1: Search by API Gateway ID
    if (apiGatewayId) {
        if (verbose) console.log(`Searching by API Gateway ID: ${apiGatewayId}...`);
        stackName = findStackByResource(region, apiGatewayId);
        if (stackName && verbose) {
            console.log(`✓ Found stack by API Gateway: ${stackName}`);
        }
    }

    // Method 2: Search by Analytics Bucket
    if (!stackName && analyticsBucket) {
        if (verbose) console.log(`Searching by Analytics Bucket: ${analyticsBucket}...`);
        stackName = findStackByResource(region, analyticsBucket);
        if (stackName && verbose) {
            console.log(`✓ Found stack by Analytics Bucket: ${stackName}`);
        }
    }

    // Method 3: Search by Service Bucket
    if (!stackName && serviceBucket) {
        if (verbose) console.log(`Searching by Service Bucket: ${serviceBucket}...`);
        stackName = findStackByResource(region, serviceBucket);
        if (stackName && verbose) {
            console.log(`✓ Found stack by Service Bucket: ${stackName}`);
        }
    }

    // Method 4: Search by name pattern
    if (!stackName && stackPrefix) {
        if (verbose) console.log(`Searching by stack name pattern: *${stackPrefix}*...`);
        const stacks = searchStacksByPattern(region, stackPrefix);
        if (stacks.length > 0) {
            if (verbose) {
                console.log(`✓ Found ${stacks.length} potential stack(s):`);
                stacks.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));
            }

            if (stacks.length === 1) {
                stackName = stacks[0];
                if (verbose) console.log(`  Using: ${stackName}`);
            } else {
                if (verbose) {
                    console.log("");
                    console.log("⚠️  Multiple stacks found. Using first match: " + stacks[0]);
                    console.log("   If this is incorrect, manually verify the stack name.");
                }
                stackName = stacks[0];
            }
        }
    }

    return stackName;
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

    // Try to infer bucket and database from stack or config
    const serviceBucket = extractBucketName(config.serviceBucket);

    // Find data bucket from stack outputs or use service bucket as fallback
    const bucketOutput = stackDetails.outputs.find(
        (o) => o.OutputKey === "Bucket" || o.OutputKey === "DataBucket",
    );
    const dataBucket = bucketOutput?.OutputValue || serviceBucket;

    if (dataBucket) {
        vars.QUILT_USER_BUCKET = `${dataBucket} # Verify this is YOUR data bucket`;
    }

    // Try to find database name from stack
    const databaseOutput = stackDetails.outputs.find(
        (o) =>
            o.OutputKey === "Database" ||
            o.OutputKey === "AthenaDatabase" ||
            o.OutputKey === "UserAthenaDatabase",
    );
    if (databaseOutput) {
        vars.QUILT_DATABASE = databaseOutput.OutputValue;
    } else if (catalog) {
        // Infer database name from catalog (common pattern)
        const dbGuess = catalog.replace(/[.-]/g, "_") + "_db";
        vars.QUILT_DATABASE = `${dbGuess} # VERIFY THIS - inferred from catalog name`;
    }

    // SQS Queue
    const queueOutput = stackDetails.outputs.find(
        (o) => o.OutputKey === "PackagerQueue" || o.OutputKey.includes("Queue"),
    );
    if (queueOutput) {
        const queueValue = queueOutput.OutputValue;

        // Parse queue name from ARN or URL
        let queueName: string;
        if (queueValue.startsWith("arn:aws:sqs:")) {
            // ARN format: arn:aws:sqs:region:account:queue-name
            queueName = queueValue.split(":").pop() as string;
        } else if (queueValue.includes("sqs.")) {
            // URL format: https://sqs.region.amazonaws.com/account/queue-name
            queueName = queueValue.split("/").pop() as string;
        } else {
            // Assume it's just the queue name
            queueName = queueValue;
        }

        vars.QUEUE_NAME = queueName;

        // Build SQS URL
        if (accountId && region && queueName) {
            vars.SQS_QUEUE_URL = `https://sqs.${region}.amazonaws.com/${accountId}/${queueName}`;
        }
    } else if (stackName) {
        vars.QUEUE_NAME = `${stackName}-PackagerQueue-XXXXX # VERIFY THIS - not found in outputs`;
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
        console.log("Configuration Summary:");
        console.log("=".repeat(80));
        console.log(`Region:           ${config.region}`);
        console.log(`API Gateway:      ${config.apiGatewayEndpoint}`);
        console.log(`Analytics Bucket: ${config.analyticsBucket}`);
        console.log(`Service Bucket:   ${config.serviceBucket}`);
        console.log(`Stack Version:    ${config.stackVersion}`);
        console.log("=".repeat(80));
        console.log("");
    }

    // Extract identifiable resources
    const region = config.region;
    const apiGatewayId = extractApiGatewayId(config.apiGatewayEndpoint);
    const analyticsBucket = extractBucketName(config.analyticsBucket);
    const serviceBucket = extractBucketName(config.serviceBucket);
    const stackPrefix = inferStackPrefix(analyticsBucket, serviceBucket);

    if (verbose) {
        console.log("Searching for CloudFormation stack...");
        console.log(`  Region: ${region}`);
        console.log(`  API Gateway ID: ${apiGatewayId || "not found"}`);
        console.log(`  Inferred stack prefix: ${stackPrefix}`);
        console.log("");
    }

    // Try to find the stack
    const stackName = findStack(
        region,
        apiGatewayId,
        analyticsBucket,
        serviceBucket,
        stackPrefix,
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

    return {
        config,
        stackName,
        stackDetails,
        inferredVars,
    };
}
