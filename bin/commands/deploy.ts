import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { prompt } from "enquirer";
import { maskArn } from "../../lib/utils/config";
import {
    QuiltServices,
    ServiceResolverError,
    parseStackArn,
} from "../../lib/utils/service-resolver";
import { checkCdkBootstrap } from "../benchling-webhook";
import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig } from "../../lib/types/config";
import { CloudFormationClient, DescribeStacksCommand, DescribeStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import { syncSecretsToAWS } from "./sync-secrets";
import * as fs from "fs";
import * as path from "path";

/**
 * Helper function to display setup command suggestion
 */
function suggestSetup(profileName: string, message: string): void {
    console.log(chalk.yellow(message));
    console.log();
    console.log(chalk.cyan(`  npm run setup -- --profile ${profileName}`));
    console.log();
}

/**
 * Detect if the existing stack is v0.8.x (REST API + ALB architecture)
 * Returns true if v0.8.x stack detected, false otherwise
 *
 * Also handles stacks in failed/rollback states by examining existing resources
 */
async function detectLegacyStack(region: string): Promise<boolean> {
    try {
        const cloudformation = new CloudFormationClient({ region });
        const stackName = "BenchlingWebhookStack";

        // Check if stack exists
        const describeCommand = new DescribeStacksCommand({ StackName: stackName });
        const describeResponse = await cloudformation.send(describeCommand);

        if (!describeResponse.Stacks || describeResponse.Stacks.length === 0) {
            return false; // No stack exists
        }

        const stack = describeResponse.Stacks[0];
        const stackStatus = stack.StackStatus || "";

        // Check if stack is in a rollback/failed state that blocks updates
        // These states indicate a previous deployment attempt failed
        const blockingStates = [
            "UPDATE_ROLLBACK_COMPLETE",
            "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS",
            "UPDATE_ROLLBACK_IN_PROGRESS",
            "UPDATE_ROLLBACK_FAILED",
            "ROLLBACK_COMPLETE",
            "ROLLBACK_IN_PROGRESS",
            "ROLLBACK_FAILED",
        ];

        if (blockingStates.includes(stackStatus)) {
            // Stack is in a failed state - can't determine architecture reliably
            // User needs to destroy and redeploy regardless
            // Return true to trigger migration warning which tells them to destroy
            return true;
        }

        // Get stack resources to check architecture
        const resourcesCommand = new DescribeStackResourcesCommand({ StackName: stackName });
        const resourcesResponse = await cloudformation.send(resourcesCommand);

        if (!resourcesResponse.StackResources) {
            return false;
        }

        // v0.8.x indicators:
        // - Has AWS::ElasticLoadBalancingV2::LoadBalancer (ALB)
        // - Has AWS::ApiGateway::RestApi (REST API)
        // v0.9.0 indicators:
        // - Has AWS::ApiGatewayV2::VpcLink (VPC Link)
        // - Has AWS::ApiGatewayV2::Api (HTTP API)
        const hasALB = resourcesResponse.StackResources.some(
            r => r.ResourceType === "AWS::ElasticLoadBalancingV2::LoadBalancer",
        );
        const hasRestAPI = resourcesResponse.StackResources.some(
            r => r.ResourceType === "AWS::ApiGateway::RestApi",
        );
        const hasVpcLink = resourcesResponse.StackResources.some(
            r => r.ResourceType === "AWS::ApiGatewayV2::VpcLink",
        );
        const hasHttpAPI = resourcesResponse.StackResources.some(
            r => r.ResourceType === "AWS::ApiGatewayV2::Api",
        );

        // If has ALB or REST API but not VPC Link or HTTP API, it's v0.8.x
        return (hasALB || hasRestAPI) && !hasVpcLink && !hasHttpAPI;
    } catch (_error) {
        // Stack doesn't exist or error checking - not a v0.8.x stack
        return false;
    }
}

/**
 * Get the most recent dev version tag (without 'v' prefix)
 * Returns null if no dev tags found
 */
function getLatestDevVersion(): string | null {
    try {
        // Get all tags matching dev pattern: v{version}-{timestamp}Z
        const tags = execSync("git tag --list", { encoding: "utf8" })
            .trim()
            .split("\n")
            .filter(tag => /^v\d+\.\d+\.\d+-\d{8}T\d{6}Z$/.test(tag));

        if (tags.length === 0) {
            return null;
        }

        // Sort by timestamp (newest first)
        tags.sort((a, b) => {
            const timestampA = a.match(/(\d{8}T\d{6}Z)$/)?.[1] || "";
            const timestampB = b.match(/(\d{8}T\d{6}Z)$/)?.[1] || "";
            return timestampB.localeCompare(timestampA);
        });

        // Return latest tag without 'v' prefix
        return tags[0].substring(1);
    } catch {
        return null;
    }
}

/**
 * Deploy command for v0.7.0 configuration architecture
 *
 * Uses new profile-based configuration with deployment tracking.
 * Supports independent --profile and --stage options.
 *
 * @module commands/deploy
 * @version 0.7.0
 */
export async function deployCommand(options: {
    yes?: boolean;
    bootstrapCheck?: boolean;
    requireApproval?: string;
    profile?: string;           // Profile name (default: "default")
    stage?: "dev" | "prod";     // API Gateway stage (independent of profile)
    stackArn?: string;
    benchlingSecret?: string;
    imageTag?: string;
    region?: string;
    envFile?: string;
}): Promise<void> {
    console.log(
        boxen(chalk.bold("Benchling Webhook Deployment"), {
            padding: 1,
            borderColor: "blue",
            borderStyle: "round",
        }),
    );
    console.log();

    // Determine profile name (default: "default")
    const profileName = options.profile || "default";

    // Determine stage (default: "prod")
    const stage = options.stage || "prod";

    // Load configuration from profile
    const xdg = new XDGConfig();
    let config: ProfileConfig;

    try {
        // Use readProfileWithInheritance to support profile inheritance
        config = xdg.readProfileWithInheritance(profileName);
        console.log(chalk.dim(`✓ Loaded configuration from profile: ${profileName}\n`));
    } catch (error) {
        console.error(chalk.red.bold("❌ Configuration Error\n"));
        console.error(chalk.red((error as Error).message));
        console.log();
        console.log(chalk.yellow("Run setup wizard to create configuration:"));
        // Suggest stage-specific setup command
        const setupCmd = stage === "dev" ? "setup:dev" : stage === "prod" ? "setup:prod" : "setup";
        const profileArg = profileName !== "default" ? ` -- --profile ${profileName}` : "";
        console.log(chalk.cyan(`  npm run ${setupCmd}${profileArg}`));
        console.log();
        process.exit(1);
    }

    // Get required parameters with priority: CLI options > Profile config
    const quiltStackArn = options.stackArn || config.quilt.stackArn;
    const benchlingSecret = options.benchlingSecret || config.benchling.secretArn;

    // Auto-detect image tag based on profile
    // For dev profiles, use the latest dev tag (without 'v' prefix)
    // For prod profiles, use config or "latest"
    let imageTag: string;
    if (options.imageTag) {
        // CLI option takes highest priority
        imageTag = options.imageTag;
    } else if (profileName === "dev") {
        // Auto-detect latest dev tag for dev profile
        const devVersion = getLatestDevVersion();
        if (devVersion) {
            imageTag = devVersion;
            console.log(chalk.dim(`✓ Auto-detected dev image tag: ${imageTag}\n`));
        } else {
            console.error(chalk.yellow("⚠️  No dev tags found, using 'latest'"));
            console.error(chalk.yellow("   Create a dev tag with: npm run version:tag:dev\n"));
            imageTag = "latest";
        }
    } else {
        // Use config or default to "latest"
        imageTag = config.deployment.imageTag || "latest";
    }

    // Validate required parameters
    const missingParams: string[] = [];
    if (!quiltStackArn) missingParams.push("quiltStackArn (in profile or --quilt-stack-arn)");
    if (!benchlingSecret) missingParams.push("benchlingSecret (in profile or --benchling-secret)");

    if (missingParams.length > 0) {
        console.error(chalk.red.bold("❌ Missing Required Parameters\n"));
        missingParams.forEach(param => {
            console.error(chalk.red(`  ${param} is required`));
        });
        console.log();
        console.log(chalk.yellow("Options:"));
        console.log("  1. Provide via CLI:");
        console.log(chalk.cyan("     npx @quiltdata/benchling-webhook deploy \\"));
        console.log(chalk.cyan("       --quilt-stack-arn <arn> \\"));
        console.log(chalk.cyan("       --benchling-secret <arn>"));
        console.log();
        console.log("  2. Update profile configuration:");
        console.log(chalk.cyan("     npm run setup"));
        console.log();
        process.exit(1);
    }

    // Deploy (both parameters validated above)
    return await deploy(quiltStackArn!, benchlingSecret!, config, {
        ...options,
        imageTag,
        profileName,
        stage,
    });
}

/**
 * Deploy the Benchling webhook stack
 */
export async function deploy(
    stackArn: string,
    benchlingSecret: string,
    config: ProfileConfig,
    options: {
        yes?: boolean;
        bootstrapCheck?: boolean;
        requireApproval?: string;
        stage: "dev" | "prod";
        profileName: string;
        imageTag: string;
        region?: string;
        envFile?: string;
    },
): Promise<void> {
    const spinner = ora("Validating parameters...").start();

    // Parse stack ARN to extract region/account
    let parsed;
    try {
        parsed = parseStackArn(stackArn);
        spinner.succeed("Stack ARN validated");
    } catch (error) {
        spinner.fail("Invalid Stack ARN");
        console.log();
        if (error instanceof ServiceResolverError) {
            console.error(chalk.red(error.format()));
        } else {
            console.error(chalk.red((error as Error).message));
        }
        console.log();
        console.log(chalk.yellow("Expected format:"));
        console.log("  arn:aws:cloudformation:region:account:stack/name/id");
        console.log();
        console.log(chalk.yellow("Example:"));
        console.log("  arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123");
        process.exit(1);
    }

    // Use region from stack ARN, but allow override from CLI
    const deployRegion = options.region || parsed.region;
    const deployAccount = parsed.account;

    // Verify secrets exist in AWS Secrets Manager
    spinner.start("Verifying Benchling secrets in AWS Secrets Manager...");
    try {
        // Temporarily suppress console output during sync operation
        const originalLog = console.log;
        console.log = (): void => {}; // Suppress logs during sync

        let results;
        try {
            // Sync secrets directly - creates/verifies without updating existing secrets
            results = await syncSecretsToAWS({
                profile: options.profileName,
                region: deployRegion,
                force: false, // Don't update existing secrets
            });
        } finally {
            // Restore console.log
            console.log = originalLog;
        }

        // Determine action from results
        let message = "verified";
        if (results.length > 0) {
            const action = results[0].action;
            if (action === "created") {
                message = "created and verified";
            } else if (action === "skipped") {
                message = "verified (existing)";
            } else if (action === "updated") {
                message = "verified and updated";
            }
        }

        spinner.succeed(`Secrets ${message}`);
    } catch (error) {
        spinner.fail("Failed to verify secrets");
        console.log();
        console.error(chalk.red((error as Error).message));
        console.log();
        console.log(chalk.yellow("To sync secrets manually, run:"));
        console.log(chalk.cyan("  npx @quiltdata/benchling-webhook setup"));
        if (options.profileName !== "default") {
            console.log(chalk.cyan("  # Or with custom profile:"));
            console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook setup --profile ${options.profileName}`));
        }
        console.log();
        process.exit(1);
    }

    // Check CDK bootstrap
    if (options.bootstrapCheck !== false) {
        spinner.start("Checking CDK bootstrap status...");

        const bootstrapStatus = await checkCdkBootstrap(deployAccount, deployRegion);

        if (!bootstrapStatus.bootstrapped) {
            spinner.fail("CDK is not bootstrapped");
            console.log();
            console.error(chalk.red.bold("❌ CDK Bootstrap Error\n"));
            console.error(bootstrapStatus.message);
            console.log();
            console.log("To bootstrap CDK, run:");
            console.log(chalk.cyan(`  ${bootstrapStatus.command}`));
            console.log();
            console.log(chalk.dim("What is CDK bootstrap?"));
            console.log(chalk.dim("  It creates necessary AWS resources (S3 bucket, IAM roles) that CDK"));
            console.log(chalk.dim("  needs to deploy CloudFormation stacks. This is a one-time setup per"));
            console.log(chalk.dim("  AWS account/region combination."));
            console.log();
            process.exit(1);
        }

        if (bootstrapStatus.warning) {
            spinner.warn(`CDK bootstrap: ${bootstrapStatus.warning}`);
        } else {
            spinner.succeed(`CDK is bootstrapped (${bootstrapStatus.status})`);
        }
    }

    // Check for v0.8.x stack and warn about migration
    spinner.start("Checking for legacy stack or failed deployment...");
    const isLegacyStack = await detectLegacyStack(deployRegion);

    if (isLegacyStack) {
        spinner.fail("Existing stack blocks update");
        console.log();
        console.log(
            boxen(
                `${chalk.red.bold("Stack state requires action")}\n\n` +
                `${chalk.yellow("Detected a legacy/failed BenchlingWebhookStack that may block update.")}\n\n` +
                `${chalk.bold("Evidence:")}\n` +
                "  • Stack has ALB/REST API resources or is in a rollback/failed state\n\n" +
                `${chalk.bold("Options:")}\n` +
                "  1) Destroy the existing stack and redeploy clean (recommended if rollback/failed)\n" +
                "  2) Proceed anyway (may fail if CloudFormation cannot update)\n",
                { padding: 1, borderColor: "yellow", borderStyle: "round" },
            ),
        );
        console.log();

        const { proceedChoice } = await prompt<{ proceedChoice: string }>([
            {
                type: "select",
                name: "proceedChoice",
                message: "How would you like to proceed?",
                choices: [
                    { name: "destroy", message: "Destroy existing stack then deploy clean (recommended)" },
                    { name: "proceed", message: "Proceed with deployment (may fail if stack is blocked)" },
                    { name: "abort", message: "Abort now" },
                ],
                initial: 0,
            },
        ]);

        if (proceedChoice === "destroy") {
            console.log();
            console.log(chalk.bold("Run destroy then redeploy:"));
            console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook destroy --profile ${options.profileName} --stage ${options.stage}`));
            console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook deploy --profile ${options.profileName} --stage ${options.stage}`));
            console.log();
            process.exit(1);
        }

        if (proceedChoice === "abort") {
            console.log(chalk.yellow("Aborting by user choice."));
            process.exit(1);
        }

        spinner.warn("Proceeding despite legacy/failed stack detection; deployment may fail.");
    }

    spinner.succeed("Stack status OK - ready for deployment");

    // Load Quilt configuration from config.quilt.*
    spinner.start("Loading Quilt configuration...");

    // Validate required fields
    const missingFields: string[] = [];
    if (!config.quilt.queueUrl) missingFields.push("queueUrl");
    if (!config.quilt.database) missingFields.push("database");
    if (!config.quilt.catalog) missingFields.push("catalog");

    if (missingFields.length > 0) {
        spinner.fail("Invalid Quilt configuration");
        console.log();
        console.error(chalk.red(`Error: Required fields missing: ${missingFields.join(", ")}`));
        console.log();
        suggestSetup(options.profileName, "Please re-run setup:");
        process.exit(1);
    }

    // Convert to QuiltServices format for deployment
    const services: QuiltServices = {
        packagerQueueUrl: config.quilt.queueUrl,
        athenaUserDatabase: config.quilt.database,
        quiltWebHost: config.quilt.catalog,
        icebergDatabase: config.quilt.icebergDatabase,
        athenaUserWorkgroup: config.quilt.athenaUserWorkgroup,
        athenaResultsBucket: config.quilt.athenaResultsBucket,
        icebergWorkgroup: config.quilt.icebergWorkgroup,
    };

    spinner.succeed("Quilt configuration loaded");

    // Build ECR image URI for display
    // HARDCODED: Always use the quiltdata AWS account for ECR images
    const ecrAccount = "712023778557";
    const ecrRegion = "us-east-1";
    const ecrRepository = config.deployment.ecrRepository || "quiltdata/benchling";
    const ecrImageUri = `${ecrAccount}.dkr.ecr.${ecrRegion}.amazonaws.com/${ecrRepository}:${options.imageTag}`;

    // Display deployment plan
    console.log();
    console.log(chalk.bold("Deployment Plan"));
    console.log(chalk.gray("─".repeat(80)));
    console.log(`  ${chalk.bold("Stack:")}                     BenchlingWebhookStack`);
    console.log(`  ${chalk.bold("Account:")}                   ${deployAccount}`);
    console.log(`  ${chalk.bold("Region:")}                    ${deployRegion}`);
    console.log(`  ${chalk.bold("Stage:")}                     ${options.stage}`);
    console.log(`  ${chalk.bold("Profile:")}                   ${options.profileName}`);
    console.log();
    console.log(chalk.bold("  Resolved Quilt Services:"));
    console.log(`    ${chalk.bold("Catalog Host:")}            ${services.quiltWebHost}`);
    console.log(`    ${chalk.bold("Packager Queue:")}          ${services.packagerQueueUrl}`);
    console.log(`    ${chalk.bold("Athena Database:")}         ${services.athenaUserDatabase}`);
    console.log(`    ${chalk.bold("Athena Workgroup:")}        ${services.athenaUserWorkgroup}`);
    console.log(`    ${chalk.bold("Athena Results Bucket:")}   ${services.athenaResultsBucket}`);
    if (services.icebergDatabase) {
        console.log(`    ${chalk.bold("Iceberg Database:")}        ${services.icebergDatabase}`);
    }
    if (services.icebergWorkgroup) {
        console.log(`    ${chalk.bold("Iceberg Workgroup:")}       ${services.icebergWorkgroup}`);
    }
    console.log();
    console.log(chalk.bold("  Stack Parameters:"));
    console.log(`    ${chalk.bold("Quilt Stack ARN:")}         ${maskArn(stackArn)} ${chalk.dim("(deployment-time resolution only)")}`);
    console.log(`    ${chalk.bold("Benchling Secret:")}        ${benchlingSecret}`);
    console.log();
    console.log(chalk.bold("  Container Image:"));
    console.log(`    ${chalk.bold("ECR Account:")}             ${ecrAccount}`);
    console.log(`    ${chalk.bold("ECR Repository:")}          ${ecrRepository}`);
    console.log(`    ${chalk.bold("Image Tag:")}               ${options.imageTag}`);
    console.log(`    ${chalk.bold("Full Image URI:")}          ${ecrImageUri}`);
    console.log();
    console.log(chalk.dim("  ℹ️  Configuration loaded from profile - single source of truth"));
    console.log(chalk.gray("─".repeat(80)));
    console.log();

    // Confirm (unless --yes)
    if (!options.yes) {
        const response: { proceed: boolean } = await prompt({
            type: "confirm",
            name: "proceed",
            message: "Proceed with deployment?",
            initial: true,
        });

        if (!response.proceed) {
            console.log(chalk.yellow("Deployment cancelled"));
            process.exit(0);
        }
        console.log();
    }

    // Deploy using CDK CLI
    console.log();
    console.log(chalk.blue.bold("▶ Starting deployment..."));
    console.log();

    try {
        // Build CloudFormation parameters
        // Parameter names must match the CfnParameter IDs in BenchlingWebhookStack
        const parameters = [
            // Explicit service parameters (v1.0.0+)
            `PackagerQueueUrl=${services.packagerQueueUrl}`,
            `AthenaUserDatabase=${services.athenaUserDatabase}`,
            `QuiltWebHost=${services.quiltWebHost}`,
            `IcebergDatabase=${services.icebergDatabase || ""}`,

            // NEW: Optional Athena resources (from Quilt stack discovery)
            `IcebergWorkgroup=${services.icebergWorkgroup || ""}`,
            `AthenaUserWorkgroup=${services.athenaUserWorkgroup || ""}`,
            `AthenaResultsBucket=${services.athenaResultsBucket || ""}`,

            // Legacy parameters
            `BenchlingSecretARN=${benchlingSecret}`,
            `ImageTag=${options.imageTag}`,
            `PackageBucket=${config.packages.bucket}`,
            `QuiltDatabase=${config.quilt.database || ""}`,  // IAM permissions only (same value as AthenaUserDatabase)
            `LogLevel=${config.logging?.level || "INFO"}`,
        ];

        const parametersArg = parameters.map(p => `--parameters ${p}`).join(" ");

        // Determine the CDK app entry point
        // The path needs to be absolute to work from any cwd

        // Find the package root directory
        // When compiled: __dirname is dist/bin/commands, so go up 3 levels
        // When source: __dirname is bin/commands, so go up 2 levels
        let moduleDir: string;
        if (__dirname.includes("/dist/")) {
            // Compiled: dist/bin/commands -> ../../../
            moduleDir = path.resolve(__dirname, "../../..");
        } else {
            // Source: bin/commands -> ../../
            moduleDir = path.resolve(__dirname, "../..");
        }

        let appPath: string;
        const tsSourcePath = path.join(moduleDir, "bin/benchling-webhook.ts");
        const jsDistPath = path.join(moduleDir, "dist/bin/benchling-webhook.js");

        if (fs.existsSync(tsSourcePath)) {
            // Development mode: TypeScript source exists, use it directly
            appPath = `npx ts-node --prefer-ts-exts "${tsSourcePath}"`;
        } else if (fs.existsSync(jsDistPath)) {
            // Production mode: use compiled JavaScript
            appPath = `node "${jsDistPath}"`;
        } else {
            // Fallback: rely on cdk.json (should not happen)
            console.warn(chalk.yellow("⚠️  Could not find CDK app entry point, relying on cdk.json"));
            appPath = "";
        }

        const appArg = appPath ? `--app "${appPath}"` : "";
        const cdkCommand = `npx cdk deploy ${appArg} --require-approval ${options.requireApproval || "never"} ${parametersArg}`;

        execSync(cdkCommand, {
            stdio: "inherit",
            env: {
                ...process.env,
                CDK_DEFAULT_ACCOUNT: deployAccount,
                CDK_DEFAULT_REGION: deployRegion,
                QUILT_STACK_ARN: stackArn,
                BENCHLING_SECRET: benchlingSecret,
            },
        });

        console.log();
        spinner.succeed("Stack deployed successfully");

        // After successful deployment, store endpoint and run tests
        console.log();
        console.log("Retrieving deployment endpoint...");

        try {
            const cloudformation = new CloudFormationClient({ region: deployRegion });
            const stackName = "BenchlingWebhookStack";

            const command = new DescribeStacksCommand({ StackName: stackName });
            const response = await cloudformation.send(command);

            if (response.Stacks && response.Stacks.length > 0) {
                const stack = response.Stacks[0];
                const endpointOutput = stack.Outputs?.find((o) => o.OutputKey === "WebhookEndpoint");
                const webhookUrl = endpointOutput?.OutputValue || "";
                const authorizerArn = stack.Outputs?.find((o) => o.OutputKey === "AuthorizerFunctionArn")?.OutputValue;
                const authorizerLogGroup = stack.Outputs?.find((o) => o.OutputKey === "AuthorizerLogGroup")?.OutputValue;

                if (webhookUrl) {
                    // Remove trailing slash to avoid double slashes in test URLs
                    const cleanEndpoint = webhookUrl.replace(/\/$/, "");

                    // Record deployment in profile
                    const xdg = new XDGConfig();
                    xdg.recordDeployment(options.profileName, {
                        stage: options.stage,
                        timestamp: new Date().toISOString(),
                        imageTag: options.imageTag,
                        endpoint: cleanEndpoint,
                        stackName: stackName,
                        region: deployRegion,
                        deployedBy: process.env.USER || process.env.USERNAME,
                        authorizerArn,
                        authorizerLogGroup,
                    });

                    console.log(`✅ Recorded deployment to profile '${options.profileName}' stage '${options.stage}'`);

                    // Success message with webhook URL
                    console.log();
                    console.log(
                        boxen(
                            `${chalk.green.bold("✓ Deployment Complete!")}\n\n` +
                            `Stack:  ${chalk.cyan("BenchlingWebhookStack")}\n` +
                            `Region: ${chalk.cyan(deployRegion)}\n` +
                            `Stage:  ${chalk.cyan(options.stage)}\n` +
                            `Profile: ${chalk.cyan(options.profileName)}\n` +
                            `Webhook URL: ${chalk.cyan(webhookUrl)}\n\n` +
                            `${chalk.bold("Next steps:")}\n` +
                            "  1. Set the webhook URL in your Benchling app settings:\n" +
                            `     ${chalk.cyan(webhookUrl)}\n\n` +
                            "  2. Test the integration by creating a Quilt package in Benchling\n\n" +
                            `${chalk.dim("For more info: https://github.com/quiltdata/benchling-webhook#readme")}`,
                            { padding: 1, borderColor: "green", borderStyle: "round" },
                        ),
                    );
                } else {
                    console.warn("⚠️  Could not retrieve WebhookEndpoint from stack outputs");
                }
            }
        } catch (error) {
            console.warn(`⚠️  Could not retrieve deployment endpoint: ${(error as Error).message}`);
            console.warn("   Deployment succeeded but endpoint could not be recorded");
        }
    } catch (error) {
        spinner.fail("Deployment failed");
        console.error();
        console.error(chalk.red((error as Error).message));
        process.exit(1);
    }
}
