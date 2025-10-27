#!/usr/bin/env node
import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";

// Validate required environment variables
const requiredEnvVars = [
    "CDK_DEFAULT_ACCOUNT",
    "CDK_DEFAULT_REGION",
    "BENCHLING_CLIENT_ID",
    "BENCHLING_CLIENT_SECRET",
    "BENCHLING_TENANT",
    "BUCKET_NAME",
    "S3_BUCKET_NAME",
    "QUEUE_NAME",
    "SQS_QUEUE_URL",
    "QUILT_CATALOG",
    "QUILT_DATABASE",
];

const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingEnvVars.length > 0) {
    console.error("Error: Missing required environment variables:");
    missingEnvVars.forEach((varName) => {
        console.error(`  - ${varName}`);
    });
    console.error("\nPlease set these variables in your .env file or environment.");
    process.exit(1);
}

// Validate conditional requirements
if (process.env.ENABLE_WEBHOOK_VERIFICATION !== "false" && !process.env.BENCHLING_APP_DEFINITION_ID) {
    console.error("Error: BENCHLING_APP_DEFINITION_ID is required when webhook verification is enabled.");
    console.error("Either set BENCHLING_APP_DEFINITION_ID or set ENABLE_WEBHOOK_VERIFICATION=false");
    process.exit(1);
}

const app = new cdk.App();
new BenchlingWebhookStack(app, "BenchlingWebhookStack", {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
    bucketName: process.env.BUCKET_NAME || "my-bucket-name",
    queueName: process.env.QUEUE_NAME || "my-queue-name",
    environment: process.env.STAGE || "prod",
    prefix: process.env.PREFIX || "benchling",
    benchlingClientId: process.env.BENCHLING_CLIENT_ID || "",
    benchlingClientSecret: process.env.BENCHLING_CLIENT_SECRET || "",
    benchlingTenant: process.env.BENCHLING_TENANT || "",
    quiltCatalog: process.env.QUILT_CATALOG || "open.quiltdata.com",
    quiltDatabase: process.env.QUILT_DATABASE || "",
    webhookAllowList: process.env.WEBHOOK_ALLOW_LIST,
    // ECR repository configuration
    createEcrRepository: process.env.CREATE_ECR_REPOSITORY === "true",
    ecrRepositoryName: process.env.ECR_REPOSITORY_NAME || "quiltdata/benchling",
});
