#!/usr/bin/env node
import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";

// Import get-env to infer configuration from catalog
const { inferStackConfig } = require("./get-env.js");

/**
 * Get environment configuration with catalog inference
 *
 * This combines user-provided values from .env with inferred values from the Quilt catalog.
 * User values always take precedence over inferred values.
 */
async function getConfig() {
    const userEnv = process.env;
    let inferredEnv: Record<string, string> = {};

    // If QUILT_CATALOG is provided, try to infer additional configuration
    if (userEnv.QUILT_CATALOG) {
        try {
            console.log(`Inferring configuration from catalog: ${userEnv.QUILT_CATALOG}`);
            const result = await inferStackConfig(`https://${userEnv.QUILT_CATALOG.replace(/^https?:\/\//, '')}`);
            inferredEnv = result.inferredVars;
            console.log("✓ Successfully inferred stack configuration\n");
        } catch (error) {
            console.error(`Warning: Could not infer configuration from catalog: ${(error as Error).message}`);
            console.error("Falling back to environment variables only.\n");
        }
    }

    // Merge: user env takes precedence over inferred values
    const config = { ...inferredEnv, ...userEnv };

    // Validate required user-provided values
    const requiredUserVars = [
        "QUILT_CATALOG",
        "QUILT_USER_BUCKET",
        "BENCHLING_CLIENT_ID",
        "BENCHLING_CLIENT_SECRET",
        "BENCHLING_TENANT",
    ];

    const missingVars = requiredUserVars.filter((varName) => !config[varName]);

    if (missingVars.length > 0) {
        console.error("Error: Missing required environment variables:");
        missingVars.forEach((varName) => {
            console.error(`  - ${varName}`);
        });
        console.error("\nPlease set these variables in your .env file.");
        console.error("See env.template for guidance.");
        process.exit(1);
    }

    // Validate inferred values are present (should be available if catalog lookup succeeded)
    const requiredInferredVars = [
        "CDK_DEFAULT_ACCOUNT",
        "CDK_DEFAULT_REGION",
        "QUEUE_NAME",
        "SQS_QUEUE_URL",
        "QUILT_DATABASE",
    ];

    const missingInferredVars = requiredInferredVars.filter((varName) => !config[varName]);

    if (missingInferredVars.length > 0) {
        console.error("Error: Could not infer required configuration:");
        missingInferredVars.forEach((varName) => {
            console.error(`  - ${varName}`);
        });
        console.error("\nThese values should be automatically inferred from your Quilt catalog.");
        console.error("Please ensure:");
        console.error("  1. QUILT_CATALOG is set correctly");
        console.error("  2. Your AWS credentials have CloudFormation read permissions");
        console.error("  3. The Quilt stack is deployed and accessible");
        console.error("\nAlternatively, you can manually set these values in your .env file.");
        process.exit(1);
    }

    // Validate conditional requirements
    if (config.ENABLE_WEBHOOK_VERIFICATION !== "false" && !config.BENCHLING_APP_DEFINITION_ID) {
        console.error("Error: BENCHLING_APP_DEFINITION_ID is required when webhook verification is enabled.");
        console.error("Either set BENCHLING_APP_DEFINITION_ID or set ENABLE_WEBHOOK_VERIFICATION=false");
        process.exit(1);
    }

    return config;
}

/**
 * Main execution
 */
async function main() {
    const config = await getConfig();

    const app = new cdk.App();
    new BenchlingWebhookStack(app, "BenchlingWebhookStack", {
        env: {
            account: config.CDK_DEFAULT_ACCOUNT,
            region: config.CDK_DEFAULT_REGION,
        },
        bucketName: config.QUILT_USER_BUCKET!, // User's data bucket
        queueName: config.QUEUE_NAME!,
        environment: config.STAGE || "prod",
        prefix: config.PREFIX || "benchling",
        benchlingClientId: config.BENCHLING_CLIENT_ID!,
        benchlingClientSecret: config.BENCHLING_CLIENT_SECRET!,
        benchlingTenant: config.BENCHLING_TENANT!,
        quiltCatalog: config.QUILT_CATALOG!,
        quiltDatabase: config.QUILT_DATABASE!,
        webhookAllowList: config.WEBHOOK_ALLOW_LIST,
        // ECR repository configuration
        createEcrRepository: config.CREATE_ECR_REPOSITORY === "true",
        ecrRepositoryName: config.ECR_REPOSITORY_NAME || "quiltdata/benchling",
    });
}

main().catch((error) => {
    console.error("Fatal error during CDK synthesis:", error);
    process.exit(1);
});
