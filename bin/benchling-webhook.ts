#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";
import { execSync } from "child_process";
import { getStackName } from "../lib/types/config";
import type { StackConfig } from "../lib/types/stack-config";

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
 *
 * v0.10.0: Clean library API - accepts minimal StackConfig interface
 *
 * This function is called directly by deploy.ts - no subprocess, no environment variables.
 *
 * @param config - Minimal stack configuration (transformed from ProfileConfig)
 * @param options - Deployment options (account, region, profile name)
 * @returns Deployment result with synthesized app and stack
 *
 * @example
 * ```typescript
 * import { createStack } from "@quiltdata/benchling-webhook";
 * import { profileToStackConfig } from "./lib/utils/config-transform";
 *
 * const profile = XDGConfig.readProfile("default");
 * const stackConfig = profileToStackConfig(profile);
 *
 * const result = createStack(stackConfig, {
 *   account: "123456789012",
 *   region: "us-east-1",
 *   profileName: "default"
 * });
 * ```
 */
export function createStack(
    config: StackConfig,
    options: {
        account: string;
        region: string;
        profileName: string;
        tags?: Record<string, string>;
    },
): DeploymentResult {
    const app = new cdk.App();

    // Determine stack name: use profile-based naming with optional custom name
    const stackName = getStackName(options.profileName, config.deployment.stackName);

    const stack = new BenchlingWebhookStack(app, stackName, {
        env: {
            account: options.account,
            region: options.region,
        },
        config: config,
        tags: options.tags,
    });

    return {
        app,
        stack,
        stackName: stack.stackName,
        stackId: stack.stackId,
    };
}
