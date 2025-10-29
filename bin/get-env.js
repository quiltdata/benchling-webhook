#!/usr/bin/env node
/**
 * Get environment configuration from a Quilt catalog's config.json
 *
 * This script fetches config.json from a Quilt catalog URL and attempts to:
 * 1. Parse the configuration
 * 2. Query AWS CloudFormation to find the stack using resource identifiers
 * 3. Extract stack outputs and parameters
 * 4. Generate environment variables for .env
 *
 * Usage:
 *   node bin/get-env.js https://quilt-catalog.yourcompany.com
 *   node bin/get-env.js https://quilt-catalog.yourcompany.com --write
 */

const https = require("https");
const http = require("http");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Parse command line arguments (only when run directly)
let args, catalogUrl, outputFile, writeFile;
if (require.main === module) {
    args = process.argv.slice(2);
    catalogUrl = args.find((arg) => !arg.startsWith("--"));
    outputFile = args.find((arg) => arg.startsWith("--output="))?.split("=")[1];
    writeFile = args.includes("--write");

    if (!catalogUrl || args.includes("--help") || args.includes("-h")) {
        printHelp();
        process.exit(catalogUrl ? 0 : 1);
    }
}

/**
 * Fetch JSON from a URL
 */
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === "https:" ? https : http;

        const options = {
            headers: {
                "User-Agent": "benchling-webhook-config-tool/1.0",
                "Accept": "application/json"
            }
        };

        client
            .get(url, options, (res) => {
                let data = "";

                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }

                res.on("data", (chunk) => {
                    data += chunk;
                });

                res.on("end", () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse JSON: ${e.message}`));
                    }
                });
            })
            .on("error", reject);
    });
}

/**
 * Extract bucket name from S3 ARN or bucket name string
 */
function extractBucketName(bucketString) {
    if (bucketString.startsWith("arn:aws:s3:::")) {
        return bucketString.replace("arn:aws:s3:::", "").split("/")[0];
    }
    return bucketString.split("/")[0];
}

/**
 * Try to find CloudFormation stack by searching for resource
 */
function findStackByResource(region, resourceId) {
    try {
        const result = execSync(
            `aws cloudformation describe-stack-resources --region ${region} --physical-resource-id "${resourceId}" --query "StackResources[0].StackName" --output text 2>/dev/null`,
            { encoding: "utf-8" }
        );
        const stackName = result.trim();
        return stackName && stackName !== "None" ? stackName : null;
    } catch (error) {
        return null;
    }
}

/**
 * Search for stacks by name pattern
 */
function searchStacksByPattern(region, pattern) {
    try {
        const result = execSync(
            `aws cloudformation list-stacks --region ${region} --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE --query "StackSummaries[?contains(StackName, '${pattern}')].StackName" --output json`,
            { encoding: "utf-8" }
        );
        return JSON.parse(result);
    } catch (error) {
        return [];
    }
}

/**
 * Get stack outputs and parameters
 */
function getStackDetails(region, stackName) {
    try {
        const outputsResult = execSync(
            `aws cloudformation describe-stacks --region ${region} --stack-name "${stackName}" --query "Stacks[0].Outputs" --output json`,
            { encoding: "utf-8" }
        );

        const paramsResult = execSync(
            `aws cloudformation describe-stacks --region ${region} --stack-name "${stackName}" --query "Stacks[0].Parameters" --output json`,
            { encoding: "utf-8" }
        );

        return {
            outputs: JSON.parse(outputsResult) || [],
            parameters: JSON.parse(paramsResult) || []
        };
    } catch (error) {
        console.error(`Warning: Could not get stack details: ${error.message}`);
        return { outputs: [], parameters: [] };
    }
}

/**
 * Get AWS account ID
 */
function getAwsAccountId() {
    try {
        const result = execSync(
            `aws sts get-caller-identity --query Account --output text`,
            { encoding: "utf-8" }
        );
        return result.trim();
    } catch (error) {
        return null;
    }
}

/**
 * Extract API Gateway ID from endpoint URL
 */
function extractApiGatewayId(endpoint) {
    const match = endpoint.match(/https:\/\/([a-z0-9]+)\.execute-api/);
    return match ? match[1] : null;
}

/**
 * Extract stack name prefix from bucket names
 */
function inferStackPrefix(analyticsBucket, serviceBucket) {
    // Both buckets typically follow pattern: {prefix}-{suffix}-{resource}-{hash}
    // e.g., "quilt-staging-analyticsbucket-10ort3e91tnoa"

    const patterns = [analyticsBucket, serviceBucket]
        .filter(Boolean)
        .map(bucket => {
            const parts = bucket.split("-");
            // Try to find common prefix (usually first 1-2 parts)
            if (parts.length >= 3) {
                return parts.slice(0, 2).join("-"); // e.g., "quilt-staging"
            }
            return parts[0];
        });

    // Return most common pattern
    return patterns[0] || "quilt";
}

/**
 * Parse config.json and infer stack information
 */
async function inferStackConfig(catalogUrl) {
    console.log(`Fetching config from: ${catalogUrl}`);
    console.log("");

    // Normalize URL and construct config.json URL
    let configUrl = catalogUrl.replace(/\/$/, "");
    if (!configUrl.endsWith("/config.json")) {
        configUrl += "/config.json";
    }

    // Fetch config.json
    let config;
    try {
        config = await fetchJson(configUrl);
    } catch (error) {
        // If direct fetch fails, try with just /config.json path
        if (error.message.includes("403") || error.message.includes("404")) {
            const baseUrl = catalogUrl.match(/https?:\/\/[^/]+/)?.[0];
            if (baseUrl) {
                console.log(`Direct fetch failed, trying: ${baseUrl}/config.json`);
                config = await fetchJson(`${baseUrl}/config.json`);
            } else {
                throw error;
            }
        } else {
            throw error;
        }
    }

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

    // Extract identifiable resources
    const region = config.region;
    const apiGatewayId = extractApiGatewayId(config.apiGatewayEndpoint);
    const analyticsBucket = extractBucketName(config.analyticsBucket);
    const serviceBucket = extractBucketName(config.serviceBucket);
    const stackPrefix = inferStackPrefix(analyticsBucket, serviceBucket);

    console.log("Searching for CloudFormation stack...");
    console.log(`  Region: ${region}`);
    console.log(`  API Gateway ID: ${apiGatewayId || "not found"}`);
    console.log(`  Inferred stack prefix: ${stackPrefix}`);
    console.log("");

    // Try to find the stack
    let stackName = null;

    // Method 1: Search by API Gateway ID
    if (apiGatewayId) {
        console.log(`Searching by API Gateway ID: ${apiGatewayId}...`);
        stackName = findStackByResource(region, apiGatewayId);
        if (stackName) {
            console.log(`✓ Found stack by API Gateway: ${stackName}`);
        }
    }

    // Method 2: Search by Analytics Bucket
    if (!stackName && analyticsBucket) {
        console.log(`Searching by Analytics Bucket: ${analyticsBucket}...`);
        stackName = findStackByResource(region, analyticsBucket);
        if (stackName) {
            console.log(`✓ Found stack by Analytics Bucket: ${stackName}`);
        }
    }

    // Method 3: Search by Service Bucket
    if (!stackName && serviceBucket) {
        console.log(`Searching by Service Bucket: ${serviceBucket}...`);
        stackName = findStackByResource(region, serviceBucket);
        if (stackName) {
            console.log(`✓ Found stack by Service Bucket: ${stackName}`);
        }
    }

    // Method 4: Search by name pattern
    if (!stackName && stackPrefix) {
        console.log(`Searching by stack name pattern: *${stackPrefix}*...`);
        const stacks = searchStacksByPattern(region, stackPrefix);
        if (stacks.length > 0) {
            console.log(`✓ Found ${stacks.length} potential stack(s):`);
            stacks.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));

            if (stacks.length === 1) {
                stackName = stacks[0];
                console.log(`  Using: ${stackName}`);
            } else {
                console.log("");
                console.log("⚠️  Multiple stacks found. Using first match: " + stacks[0]);
                console.log("   If this is incorrect, manually verify the stack name.");
                stackName = stacks[0];
            }
        }
    }

    console.log("");

    if (!stackName) {
        console.log("⚠️  Could not automatically find CloudFormation stack.");
        console.log("   You may need to manually specify stack resources.");
        console.log("");
    }

    // Get stack details if found
    let stackDetails = { outputs: [], parameters: [] };
    if (stackName) {
        console.log(`Fetching stack details for: ${stackName}...`);
        stackDetails = getStackDetails(region, stackName);
        console.log(`✓ Retrieved ${stackDetails.outputs.length} outputs and ${stackDetails.parameters.length} parameters`);
        console.log("");
    }

    // Get AWS account ID
    const accountId = getAwsAccountId();
    if (accountId) {
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
        catalogUrl.replace(/\/config\.json$/, "")
    );

    return {
        config,
        stackName,
        stackDetails,
        inferredVars
    };
}

/**
 * Build inferred configuration
 */
function buildInferredConfig(config, stackName, stackDetails, region, accountId, catalogDomain) {
    const vars = {};

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
    const analyticsBucket = extractBucketName(config.analyticsBucket);
    const serviceBucket = extractBucketName(config.serviceBucket);

    // Find data bucket from stack outputs or use service bucket as fallback
    const bucketOutput = stackDetails.outputs.find(
        (o) => o.OutputKey === "Bucket" || o.OutputKey === "DataBucket"
    );
    const dataBucket = bucketOutput?.OutputValue || serviceBucket;

    if (dataBucket) {
        vars.QUILT_USER_BUCKET = `${dataBucket} # Verify this is YOUR data bucket`;
    }

    // Try to find database name from stack
    const databaseOutput = stackDetails.outputs.find(
        (o) => o.OutputKey === "Database" || o.OutputKey === "AthenaDatabase"
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
        (o) => o.OutputKey === "PackagerQueue" || o.OutputKey.includes("Queue")
    );
    if (queueOutput) {
        const queueValue = queueOutput.OutputValue;

        // Parse queue name from ARN or URL
        let queueName;
        if (queueValue.startsWith("arn:aws:sqs:")) {
            // ARN format: arn:aws:sqs:region:account:queue-name
            queueName = queueValue.split(":").pop();
        } else if (queueValue.includes("sqs.")) {
            // URL format: https://sqs.region.amazonaws.com/account/queue-name
            queueName = queueValue.split("/").pop();
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
    vars["# Stack Version"] = config.stackVersion;
    vars["# API Gateway Endpoint"] = config.apiGatewayEndpoint;

    return vars;
}

/**
 * Format environment variables for output
 */
function formatEnvVars(vars) {
    const lines = [];

    lines.push("# ==============================================================================");
    lines.push("# INFERRED CONFIGURATION");
    lines.push("# ==============================================================================");
    lines.push("# Generated by: bin/get-env.js");
    lines.push("# Date: " + new Date().toISOString());
    lines.push("#");
    lines.push("# ⚠️  IMPORTANT: Review and verify all values before using!");
    lines.push("#    Some values may need manual verification or completion.");
    lines.push("# ==============================================================================");
    lines.push("");

    for (const [key, value] of Object.entries(vars)) {
        if (key.startsWith("#")) {
            lines.push(`${key}: ${value}`);
        } else {
            lines.push(`${key}=${value}`);
        }
    }

    lines.push("");
    lines.push("# ==============================================================================");
    lines.push("# REQUIRED VALUES NOT INFERRED - Must be filled manually");
    lines.push("# ==============================================================================");
    lines.push("PREFIX=benchling-webhook");
    lines.push("BENCHLING_TENANT=your-tenant");
    lines.push("BENCHLING_CLIENT_ID=your-client-id");
    lines.push("BENCHLING_CLIENT_SECRET=your-client-secret");
    lines.push("BENCHLING_APP=benchling-webhook");
    lines.push("BENCHLING_API_KEY=your-api-key");
    lines.push("BENCHLING_APP_DEFINITION_ID=appdef_your_id_here");
    lines.push("ENABLE_WEBHOOK_VERIFICATION=true");
    lines.push("BENCHLING_TEST_ENTRY=etr_123456789");
    lines.push("");

    return lines.join("\n");
}

/**
 * Print help
 */
function printHelp() {
    console.log("Usage: node bin/get-env.js <catalog-url> [options]");
    console.log("");
    console.log("Arguments:");
    console.log("  catalog-url    URL of Quilt catalog (e.g., https://quilt-catalog.yourcompany.com)");
    console.log("");
    console.log("Options:");
    console.log("  --output=FILE  Write output to FILE instead of stdout");
    console.log("  --write        Write to env.inferred by default (without dot - user-visible)");
    console.log("  --help, -h     Show this help message");
    console.log("");
    console.log("Examples:");
    console.log("  node bin/get-env.js https://nightly.quilttest.com");
    console.log("  node bin/get-env.js https://nightly.quilttest.com --write");
    console.log("  node bin/get-env.js https://nightly.quilttest.com --output=env.staging");
    console.log("");
    console.log("Description:");
    console.log("  This script fetches config.json from a Quilt catalog and infers");
    console.log("  environment variables needed for benchling-webhook deployment by:");
    console.log("  1. Parsing the catalog configuration");
    console.log("  2. Querying AWS CloudFormation to find the associated stack");
    console.log("  3. Extracting stack outputs and parameters");
    console.log("  4. Generating environment variable assignments");
    console.log("");
    console.log("Requirements:");
    console.log("  - AWS CLI installed and configured");
    console.log("  - AWS credentials with CloudFormation read permissions");
    console.log("  - Network access to the catalog URL");
}

/**
 * Main execution
 */
async function main() {
    try {
        const result = await inferStackConfig(catalogUrl);

        // Format output
        const output = formatEnvVars(result.inferredVars);

        // Print summary
        console.log("=".repeat(80));
        console.log("INFERRED CONFIGURATION");
        console.log("=".repeat(80));
        console.log("");
        console.log(output);
        console.log("");

        // Write to file if requested
        const targetFile = outputFile || (writeFile ? "env.inferred" : null);
        if (targetFile) {
            const fullPath = path.resolve(targetFile);

            // Check if .env already exists and warn before proceeding
            const envPath = path.resolve(".env");
            if (fs.existsSync(envPath)) {
                console.log("⚠️  NOTICE: A .env file already exists!");
                console.log(`   Writing to ${targetFile} instead to avoid overwriting your configuration.`);
                console.log("");
            }

            fs.writeFileSync(fullPath, output);
            console.log("=".repeat(80));
            console.log(`✓ Configuration written to: ${fullPath}`);
            console.log("=".repeat(80));
            console.log("");
            console.log("Next steps:");
            console.log("  1. Review the generated file and verify all values");
            console.log("  2. Fill in the REQUIRED VALUES section with your Benchling credentials");
            if (fs.existsSync(envPath)) {
                console.log("  3. Carefully merge with your existing .env file (DO NOT overwrite!)");
                console.log("     Compare: diff .env env.inferred");
            } else {
                console.log("  3. Copy to .env when ready: cp env.inferred .env");
            }
            console.log("");
        } else {
            console.log("=".repeat(80));
            console.log("To save this configuration, run:");
            console.log(`  node bin/get-env.js ${catalogUrl} --write`);
            console.log("=".repeat(80));
            console.log("");
        }

    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { inferStackConfig, buildInferredConfig };
