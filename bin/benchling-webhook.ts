#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { execSync } from "child_process";
import type { Config } from "../lib/utils/config";
import type { ProfileConfig } from "../lib/types/config";

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
 * Convert legacy Config to ProfileConfig (temporary adapter for Phase 4 migration)
 * TODO: Remove this function in Phase 4 when all config loading uses ProfileConfig directly
 */
function legacyConfigToProfileConfig(config: Config): ProfileConfig {
    return {
        quilt: {
            stackArn: config.quiltStackArn || "",
            catalog: config.quiltCatalog,
            database: config.quiltDatabase,
            queueUrl: config.queueUrl,
            region: config.cdkRegion,
        },
        benchling: {
            tenant: config.benchlingTenant,
            clientId: config.benchlingClientId,
            clientSecret: config.benchlingClientSecret,
            secretArn: config.benchlingSecret,
            appDefinitionId: config.benchlingAppDefinitionId,
        },
        packages: {
            bucket: config.quiltUserBucket,
            prefix: config.pkgPrefix || "benchling",
            metadataKey: config.pkgKey || "experiment_id",
        },
        deployment: {
            region: config.cdkRegion,
            account: config.cdkAccount,
            ecrRepository: config.ecrRepositoryName || "quiltdata/benchling",
            imageTag: config.imageTag || "latest",
        },
        resolvedServices: {
            packagerQueueUrl: config.queueUrl,
            athenaUserDatabase: config.quiltDatabase,
            quiltWebHost: config.quiltCatalog.replace(/^https?:\/\//, ""),
            resolvedAt: new Date().toISOString(),
            sourceStackArn: config.quiltStackArn || "arn:aws:cloudformation:us-east-1:123456789012:stack/placeholder/placeholder",
        },
        logging: {
            level: (config.logLevel as "DEBUG" | "INFO" | "WARNING" | "ERROR") || "INFO",
        },
        security: {
            webhookAllowList: config.webhookAllowList || "",
            enableVerification: config.enableWebhookVerification !== "false",
        },
        _metadata: {
            version: "0.7.0-migration",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: "cli",
        },
    };
}

/**
 * Create CDK app and stack (synthesis only, no deployment)
 * v0.7.0: Updated to use ProfileConfig
 * TODO: Phase 4 will update this to read ProfileConfig directly from XDGConfig
 */
export function createStack(config: Config): DeploymentResult {
    const app = new cdk.App();

    // Convert legacy config to ProfileConfig
    const profileConfig = legacyConfigToProfileConfig(config);

    const stack = new BenchlingWebhookStack(app, "BenchlingWebhookStack", {
        env: {
            account: config.cdkAccount,
            region: config.cdkRegion,
        },
        config: profileConfig,
    });

    return {
        app,
        stack,
        stackName: stack.stackName,
        stackId: stack.stackId,
    };
}

// Only run if called directly (not imported)
// v0.7.0: Updated to use ProfileConfig
// TODO: Phase 4 will replace this with proper XDGConfig loading
if (require.main === module) {
    const app = new cdk.App();

    // Minimal ProfileConfig from environment variables (for direct CDK usage)
    // For destroy operations, provide placeholder values if SKIP_CONFIG_VALIDATION is set
    const skipValidation = process.env.SKIP_CONFIG_VALIDATION === "true";
    const profileConfig: ProfileConfig = {
        quilt: {
            stackArn: process.env.QUILT_STACK_ARN || (skipValidation ? "placeholder" : ""),
            catalog: process.env.QUILT_CATALOG || "",
            database: process.env.QUILT_DATABASE || "",
            queueUrl: process.env.QUEUE_URL || "",
            region: process.env.CDK_DEFAULT_REGION || "us-east-1",
        },
        benchling: {
            tenant: process.env.BENCHLING_TENANT || "",
            clientId: process.env.BENCHLING_CLIENT_ID || "",
            secretArn: process.env.BENCHLING_SECRET || (skipValidation ? "placeholder" : undefined),
            appDefinitionId: process.env.BENCHLING_APP_DEFINITION_ID || "",
        },
        packages: {
            bucket: process.env.QUILT_USER_BUCKET || "",
            prefix: process.env.PKG_PREFIX || "benchling",
            metadataKey: process.env.PKG_KEY || "experiment_id",
        },
        deployment: {
            region: process.env.CDK_DEFAULT_REGION || "us-east-1",
            account: process.env.CDK_DEFAULT_ACCOUNT,
            ecrRepository: process.env.ECR_REPOSITORY_NAME || "quiltdata/benchling",
            imageTag: process.env.IMAGE_TAG || "latest",
        },
        resolvedServices: {
            packagerQueueUrl: process.env.QUEUE_URL || "https://sqs.us-east-1.amazonaws.com/123456789012/placeholder-queue",
            athenaUserDatabase: process.env.QUILT_DATABASE || "placeholder_database",
            quiltWebHost: process.env.QUILT_CATALOG?.replace(/^https?:\/\//, "") || "placeholder.quiltdata.com",
            resolvedAt: new Date().toISOString(),
            sourceStackArn: process.env.QUILT_STACK_ARN || "arn:aws:cloudformation:us-east-1:123456789012:stack/placeholder/placeholder",
        },
        logging: {
            level: (process.env.LOG_LEVEL as "DEBUG" | "INFO" | "WARNING" | "ERROR") || "INFO",
        },
        security: {
            webhookAllowList: process.env.WEBHOOK_ALLOW_LIST || "",
            enableVerification: process.env.ENABLE_WEBHOOK_VERIFICATION !== "false",
        },
        _metadata: {
            version: "0.7.0",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: "cli",
        },
    };

    new BenchlingWebhookStack(app, "BenchlingWebhookStack", {
        env: {
            account: process.env.CDK_DEFAULT_ACCOUNT,
            region: process.env.CDK_DEFAULT_REGION,
        },
        config: profileConfig,
    });
}
