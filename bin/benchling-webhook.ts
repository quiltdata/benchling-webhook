#!/usr/bin/env node
import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { execSync } from "child_process";
import type { Config } from "../lib/utils/config";

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
 * Secrets-only mode (v0.6.0+) - requires QUILT_STACK_ARN and BENCHLING_SECRET
 */
export function createStack(config: Config): DeploymentResult {
    const app = new cdk.App();

    const stack = new BenchlingWebhookStack(app, "BenchlingWebhookStack", {
        env: {
            account: config.cdkAccount,
            region: config.cdkRegion,
        },
        // Secrets-only mode parameters (v0.6.0+)
        quiltStackArn: config.quiltStackArn!,
        benchlingSecret: config.benchlingSecret!,
        logLevel: config.logLevel || "INFO",
        createEcrRepository: config.createEcrRepository === "true",
        ecrRepositoryName: config.ecrRepositoryName || "quiltdata/benchling",
        imageTag: config.imageTag || "latest",
    });

    return {
        app,
        stack,
        stackName: stack.stackName,
        stackId: stack.stackId,
    };
}

// Only run if called directly (not imported)
// Secrets-only mode (v0.6.0+) - all configuration comes from environment variables
if (require.main === module) {
    const app = new cdk.App();

    new BenchlingWebhookStack(app, "BenchlingWebhookStack", {
        env: {
            account: process.env.CDK_DEFAULT_ACCOUNT,
            region: process.env.CDK_DEFAULT_REGION,
        },
        quiltStackArn: process.env.QUILT_STACK_ARN!,
        benchlingSecret: process.env.BENCHLING_SECRET!,
        logLevel: process.env.LOG_LEVEL || "INFO",
        createEcrRepository: process.env.CREATE_ECR_REPOSITORY === "true",
        ecrRepositoryName: process.env.ECR_REPOSITORY_NAME || "quiltdata/benchling",
        imageTag: process.env.IMAGE_TAG || "latest",
    });
}
