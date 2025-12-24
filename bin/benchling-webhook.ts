#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { execSync } from "child_process";
import type { Config } from "../lib/utils/config";
import type { ProfileConfig } from "../lib/types/config";
import { getStackName } from "../lib/types/config";
import { profileToStackConfig } from "../lib/utils/config-transform";

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
 * Create CDK app and stack (synthesis only, no deployment)
 * Accepts legacy Config for backward compatibility with existing deployment scripts.
 * v0.7.0: Uses ProfileConfig internally
 * v0.9.8: Supports profile-based stack names for multi-stack deployments
 * v0.10.0: Transforms ProfileConfig to StackConfig before passing to stack
 */
export function createStack(config: Config): DeploymentResult {
    const app = new cdk.App();

    // Convert legacy config to ProfileConfig for backward compatibility
    const profileConfig: ProfileConfig = {
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
        logging: {
            level: (config.logLevel as "DEBUG" | "INFO" | "WARNING" | "ERROR") || "INFO",
        },
        security: {
            webhookAllowList: config.webhookAllowList || "",
            enableVerification: config.enableWebhookVerification !== "false",
        },
        _metadata: {
            version: "0.10.0-migration",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: "cli",
        },
    };

    // Transform ProfileConfig to minimal StackConfig
    const stackConfig = profileToStackConfig(profileConfig);

    // Determine stack name: use profile-based naming with optional custom name
    // For legacy compatibility, assume "default" profile unless specified in deployment config
    const profile = "default";
    const stackName = getStackName(profile, profileConfig.deployment?.stackName);

    const stack = new BenchlingWebhookStack(app, stackName, {
        env: {
            account: config.cdkAccount,
            region: config.cdkRegion,
        },
        config: stackConfig,
    });

    return {
        app,
        stack,
        stackName: stack.stackName,
        stackId: stack.stackId,
    };
}

// Only run if called directly (not imported)
// v0.7.0+: Uses ProfileConfig read from environment variables
// v0.10.0+: Transforms ProfileConfig to StackConfig before passing to stack
// This module is primarily used by CDK CLI (npx cdk deploy) which requires direct execution
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
            // Include VPC configuration if specified
            ...(process.env.VPC_ID && {
                vpc: {
                    vpcId: process.env.VPC_ID,
                    // Parse subnet arrays from JSON-encoded environment variables
                    ...(process.env.VPC_PRIVATE_SUBNET_IDS && {
                        privateSubnetIds: JSON.parse(process.env.VPC_PRIVATE_SUBNET_IDS),
                    }),
                    ...(process.env.VPC_PUBLIC_SUBNET_IDS && {
                        publicSubnetIds: JSON.parse(process.env.VPC_PUBLIC_SUBNET_IDS),
                    }),
                    ...(process.env.VPC_AVAILABILITY_ZONES && {
                        availabilityZones: JSON.parse(process.env.VPC_AVAILABILITY_ZONES),
                    }),
                    ...(process.env.VPC_CIDR_BLOCK && {
                        vpcCidrBlock: process.env.VPC_CIDR_BLOCK,
                    }),
                },
            }),
            // Include custom stack name if specified
            ...(process.env.STACK_NAME && {
                stackName: process.env.STACK_NAME,
            }),
        },
        logging: {
            level: (process.env.LOG_LEVEL as "DEBUG" | "INFO" | "WARNING" | "ERROR") || "INFO",
        },
        security: {
            webhookAllowList: process.env.WEBHOOK_ALLOW_LIST || "",
            enableVerification: process.env.ENABLE_WEBHOOK_VERIFICATION !== "false",
        },
        _metadata: {
            version: "0.10.0",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: "cli",
        },
    };

    // Transform ProfileConfig to minimal StackConfig
    const stackConfig = profileToStackConfig(profileConfig);

    // Determine stack name from environment or profile
    const profile = process.env.PROFILE || "default";
    const stackName = getStackName(profile, profileConfig.deployment.stackName);

    new BenchlingWebhookStack(app, stackName, {
        env: {
            account: process.env.CDK_DEFAULT_ACCOUNT,
            region: process.env.CDK_DEFAULT_REGION,
        },
        config: stackConfig,
    });
}
