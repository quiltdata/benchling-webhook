#!/usr/bin/env node
import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { execSync } from "child_process";
import type { Config } from "../lib/utils/config";

// Import get-env for library usage
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { inferStackConfig } = require("./get-env.js");

/**
 * Result of CDK bootstrap check
 */
export interface BootstrapStatus {
  bootstrapped: boolean;
  status?: string;
  message?: string;
  command?: string;
  warning?: string;
}

/**
 * Result of deployment
 */
export interface DeploymentResult {
  app: cdk.App;
  stack: BenchlingWebhookStack;
  stackName: string;
  stackId: string;
}

/**
 * Configuration inference result
 */
export interface InferenceResult {
  success: boolean;
  inferredVars: Record<string, string>;
  error?: string;
}

/**
 * Check if CDK is bootstrapped for the given account/region
 * Returns status object instead of exiting
 */
export async function checkCdkBootstrap(
    account: string,
    region: string,
): Promise<BootstrapStatus> {
    try {
        const result = execSync(
            `aws cloudformation describe-stacks --region ${region} --stack-name CDKToolkit --query "Stacks[0].StackStatus" --output text 2>&1`,
            { encoding: "utf-8" },
        );

        const stackStatus = result.trim();

        if (
            stackStatus.includes("does not exist") ||
      stackStatus.includes("ValidationError")
        ) {
            return {
                bootstrapped: false,
                message: `CDK is not bootstrapped for account ${account} in region ${region}`,
                command: `npx cdk bootstrap aws://${account}/${region}`,
            };
        }

        if (!stackStatus.includes("COMPLETE")) {
            return {
                bootstrapped: true,
                status: stackStatus,
                warning: `CDKToolkit stack is in state: ${stackStatus}. This may cause deployment issues.`,
            };
        }

        return {
            bootstrapped: true,
            status: stackStatus,
        };
    } catch (error) {
        return {
            bootstrapped: false,
            message: `Could not verify CDK bootstrap status: ${(error as Error).message}`,
        };
    }
}

/**
 * Attempt to infer configuration from catalog
 * Non-fatal - returns success flag and inferred values
 */
export async function inferConfiguration(catalogUrl: string): Promise<InferenceResult> {
    try {
    // Normalize URL
        const normalizedUrl = catalogUrl.startsWith("http")
            ? catalogUrl
            : `https://${catalogUrl}`;

        const result = await inferStackConfig(normalizedUrl);

        return {
            success: true,
            inferredVars: result.inferredVars,
        };
    } catch (error) {
        return {
            success: false,
            inferredVars: {},
            error: (error as Error).message,
        };
    }
}

/**
 * Create CDK app and stack (synthesis only, no deployment)
 * Pure function - returns app and stack objects
 */
export function createStack(config: Config): DeploymentResult {
    const app = new cdk.App();

    const stack = new BenchlingWebhookStack(app, "BenchlingWebhookStack", {
        env: {
            account: config.cdkAccount,
            region: config.cdkRegion,
        },
        bucketName: config.quiltUserBucket,
        queueUrl: config.queueUrl,
        environment: "production",
        prefix: config.pkgPrefix || "benchling",
        benchlingClientId: config.benchlingClientId,
        benchlingClientSecret: config.benchlingClientSecret,
        benchlingTenant: config.benchlingTenant,
        quiltCatalog: config.quiltCatalog,
        quiltDatabase: config.quiltDatabase,
        webhookAllowList: config.webhookAllowList,
        logLevel: config.logLevel || "INFO",
        createEcrRepository: config.createEcrRepository === "true",
        ecrRepositoryName: config.ecrRepositoryName || "quiltdata/benchling",
    });

    return {
        app,
        stack,
        stackName: stack.stackName,
        stackId: stack.stackId,
    };
}

/**
 * DEPRECATED: Legacy getConfig function for backwards compatibility
 * This combines user-provided values from .env with inferred values from the Quilt catalog.
 * User values always take precedence over inferred values.
 */
async function legacyGetConfig(): Promise<Record<string, string | undefined>> {
    const userEnv = process.env;
    let inferredEnv: Record<string, string> = {};

    // If QUILT_CATALOG is provided, try to infer additional configuration
    if (userEnv.QUILT_CATALOG) {
        try {
            console.log(`Inferring configuration from catalog: ${userEnv.QUILT_CATALOG}`);
            const result = await inferStackConfig(
                `https://${userEnv.QUILT_CATALOG.replace(/^https?:\/\//, "")}`,
            );
            inferredEnv = result.inferredVars;
            console.log("✓ Successfully inferred stack configuration\n");
        } catch (error) {
            console.error(
                `Warning: Could not infer configuration from catalog: ${(error as Error).message}`,
            );
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

    // Validate inferred values are present
    const requiredInferredVars = [
        "CDK_DEFAULT_ACCOUNT",
        "CDK_DEFAULT_REGION",
        "QUEUE_URL",
        "QUILT_DATABASE",
    ];

    const missingInferredVars = requiredInferredVars.filter(
        (varName) => !config[varName],
    );

    if (missingInferredVars.length > 0) {
        console.error("Error: Could not infer required configuration:");
        missingInferredVars.forEach((varName) => {
            console.error(`  - ${varName}`);
        });
        console.error(
            "\nThese values should be automatically inferred from your Quilt catalog.",
        );
        console.error("Please ensure:");
        console.error("  1. QUILT_CATALOG is set correctly");
        console.error("  2. Your AWS credentials have CloudFormation read permissions");
        console.error("  3. The Quilt stack is deployed and accessible");
        console.error("\nAlternatively, you can manually set these values in your .env file.");
        process.exit(1);
    }

    // Validate required Benchling fields
    const requiredBenchlingFields = [
        "BENCHLING_TENANT",
        "BENCHLING_CLIENT_ID",
        "BENCHLING_CLIENT_SECRET",
        "BENCHLING_APP_DEFINITION_ID",
    ] as const;

    const missingBenchling = requiredBenchlingFields.filter(
        (field) => !config[field],
    );

    if (missingBenchling.length > 0) {
        console.error(
            "Error: The following required Benchling configuration is missing:",
        );
        missingBenchling.forEach((field) => console.error(`  - ${field}`));
        process.exit(1);
    }

    return config;
}

/**
 * DEPRECATED: Legacy main function for backwards compatibility
 * Use createStack() + CDK CLI for new code
 */
async function legacyMain(): Promise<void> {
    const config = await legacyGetConfig();

    // Check bootstrap
    const bootstrapStatus = await checkCdkBootstrap(
    config.CDK_DEFAULT_ACCOUNT!,
    config.CDK_DEFAULT_REGION!,
    );

    if (!bootstrapStatus.bootstrapped) {
        console.error("\n❌ CDK Bootstrap Error");
        console.error("=".repeat(80));
        console.error(bootstrapStatus.message);
        console.error("\nTo bootstrap CDK, run:");
        console.error(`  ${bootstrapStatus.command}`);
        console.error("=".repeat(80));
        process.exit(1);
    }

    if (bootstrapStatus.warning) {
        console.error("\n⚠️  CDK Bootstrap Warning");
        console.error("=".repeat(80));
        console.error(bootstrapStatus.warning);
        console.error("=".repeat(80));
    } else {
        console.log(`✓ CDK is bootstrapped (CDKToolkit stack: ${bootstrapStatus.status})\n`);
    }

    // Create stack
    const app = new cdk.App();
    new BenchlingWebhookStack(app, "BenchlingWebhookStack", {
        env: {
            account: config.CDK_DEFAULT_ACCOUNT,
            region: config.CDK_DEFAULT_REGION,
        },
        bucketName: config.QUILT_USER_BUCKET!, // User's data bucket
        queueUrl: config.QUEUE_URL!,
        environment: "production",
        prefix: config.PKG_PREFIX || "benchling",
        benchlingClientId: config.BENCHLING_CLIENT_ID!,
        benchlingClientSecret: config.BENCHLING_CLIENT_SECRET!,
        benchlingTenant: config.BENCHLING_TENANT!,
        quiltCatalog: config.QUILT_CATALOG!,
        quiltDatabase: config.QUILT_DATABASE!,
        webhookAllowList: config.WEBHOOK_ALLOW_LIST,
        logLevel: config.LOG_LEVEL || "INFO",
        // ECR repository configuration
        createEcrRepository: config.CREATE_ECR_REPOSITORY === "true",
        ecrRepositoryName: config.ECR_REPOSITORY_NAME || "quiltdata/benchling",
    });
}

// Only run if called directly (not imported)
if (require.main === module) {
    legacyMain().catch((error) => {
        console.error("Fatal error during CDK synthesis:", error);
        process.exit(1);
    });
}

// Export functions for library usage
export { inferStackConfig };
