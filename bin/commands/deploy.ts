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
import { extractQuiltResources, getStackResources } from "../../lib/utils/stack-inference";
import { checkCdkBootstrap, createStack } from "../benchling-webhook";
import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig, getStackName } from "../../lib/types/config";
import { profileToStackConfig } from "../../lib/utils/config-transform";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { syncSecretsToAWS } from "./sync-secrets";

/**
 * Helper function to display setup command suggestion
 */
function suggestSetup(profileName: string, message: string): void {
    console.log(chalk.yellow(message));
    console.log();
    console.log(chalk.cyan(`  npm run setup -- --profile ${profileName}`));
    console.log();
}

type StackCheck = {
    stackExists: boolean;
    stackStatus?: string;
    statusCategory: "none" | "in_progress" | "failed";
};

/**
 * Check if the existing stack is in a problematic state (active rollback, failed, etc.)
 *
 * Note: UPDATE_ROLLBACK_COMPLETE and ROLLBACK_COMPLETE are safe states - the stack
 * successfully rolled back and is ready for new updates. Only active rollbacks
 * (in progress) and truly failed states require user attention.
 */
async function checkStackStatus(region: string, stackName: string): Promise<StackCheck> {
    try {
        const cloudformation = new CloudFormationClient({ region });

        // Check if stack exists
        const describeCommand = new DescribeStacksCommand({ StackName: stackName });
        const describeResponse = await cloudformation.send(describeCommand);

        if (!describeResponse.Stacks || describeResponse.Stacks.length === 0) {
            return {
                stackExists: false,
                statusCategory: "none",
            };
        }

        const stack = describeResponse.Stacks[0];
        const stackStatus = stack.StackStatus || "";

        const inProgressStates = [
            "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS",
            "UPDATE_ROLLBACK_IN_PROGRESS",
            "ROLLBACK_IN_PROGRESS",
        ];
        const failedStates = ["ROLLBACK_FAILED", "UPDATE_ROLLBACK_FAILED"];
        // Note: UPDATE_ROLLBACK_COMPLETE and ROLLBACK_COMPLETE are SAFE states
        // The stack successfully rolled back and is ready for new updates

        const statusCategory = inProgressStates.includes(stackStatus)
            ? "in_progress"
            : failedStates.includes(stackStatus)
                ? "failed"
                : "none";

        return {
            stackExists: true,
            stackStatus,
            statusCategory,
        };
    } catch (_error) {
        // Stack doesn't exist or error checking
        return {
            stackExists: false,
            statusCategory: "none",
        };
    }
}

async function resolveQuiltAthenaWorkgroup(
    stackArn: string,
    region: string,
    quiltStackName: string,
): Promise<string | undefined> {
    try {
        const resources = await getStackResources(region, stackArn);
        const discovered = extractQuiltResources(resources);
        const workgroup = discovered.athenaUserWorkgroup;

        if (!workgroup) {
            return undefined;
        }

        const expectedPrefix = `${quiltStackName}-`;
        if (!workgroup.startsWith(expectedPrefix)) {
            console.log(
                chalk.yellow(
                    `⚠️  Ignoring Athena workgroup '${workgroup}' (expected prefix '${expectedPrefix}')`,
                ),
            );
            return undefined;
        }

        return workgroup;
    } catch (error) {
        console.log(
            chalk.yellow(
                `⚠️  Failed to discover Athena workgroup from Quilt stack: ${(error as Error).message}`,
            ),
        );
        return undefined;
    }
}

// Legacy detection functions removed in v1.0.0
// v1.0.0 uses REST API v1 (not HTTP API v2) with resource policies instead of WAF

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
 * v0.10.0: Refactored to call createStack() directly instead of spawning subprocess.
 * This eliminates environment variable IPC complexity and simplifies testing.
 *
 * @module commands/deploy
 * @version 0.10.0
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
    force?: boolean;            // Force deployment despite legacy architecture warning
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
        console.log(chalk.cyan("     npx @quiltdata/benchling-webhook@latest deploy \\"));
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
 *
 * v0.10.0: Refactored to call createStack() directly instead of using environment variable IPC.
 * Configuration is passed programmatically through function calls, not subprocess environment.
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
        force?: boolean;
    },
): Promise<void> {
    // Check if this is an integrated stack - NO deployment allowed
    if (config.integratedStack === true) {
        console.log();
        console.log(boxen(
            chalk.yellow.bold("⚠️  Integrated Stack Mode") + "\n\n" +
            chalk.dim("The webhook handler is already deployed as part of the Quilt stack.\n") +
            chalk.dim("No separate deployment is needed or allowed.\n\n") +
            chalk.cyan("To update credentials, run:\n") +
            chalk.cyan(`  npm run setup -- --profile ${options.profileName}`),
            {
                padding: 1,
                margin: 1,
                borderStyle: "round",
                borderColor: "yellow",
            },
        ));
        console.log();
        process.exit(0);
    }

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
        console.log(chalk.cyan("  npx @quiltdata/benchling-webhook@latest setup"));
        if (options.profileName !== "default") {
            console.log(chalk.cyan("  # Or with custom profile:"));
            console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook@latest setup --profile ${options.profileName}`));
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

    // Determine stack name using helper function
    const stackName = getStackName(options.profileName, config.deployment.stackName);

    // Check for rollback or failed state
    spinner.start("Checking stack status...");
    const stackCheck = await checkStackStatus(deployRegion, stackName);

    // REVIEW_IN_PROGRESS is unrecoverable - must destroy and recreate
    if (stackCheck.stackExists && stackCheck.stackStatus === "REVIEW_IN_PROGRESS") {
        spinner.fail("Stack in unrecoverable state (REVIEW_IN_PROGRESS)");
        console.log();
        console.log(
            boxen(
                `${chalk.red.bold("Stack in Unrecoverable State")}\n\n` +
                `The stack ${chalk.cyan(stackName)} is in ${chalk.yellow("REVIEW_IN_PROGRESS")} state.\n` +
                "This means a CloudFormation change set failed during creation.\n\n" +
                `${chalk.bold("This stack must be destroyed and recreated.")}\n`,
                { padding: 1, borderColor: "red", borderStyle: "round" },
            ),
        );
        console.log();

        const { shouldDestroy } = await prompt<{ shouldDestroy: boolean }>([
            {
                type: "confirm",
                name: "shouldDestroy",
                message: "Destroy this stack and recreate? (Only option to proceed)",
                initial: true,
            },
        ]);

        if (!shouldDestroy) {
            console.log(chalk.yellow("Deployment cancelled"));
            process.exit(1);
        }

        // Destroy the stack
        console.log();
        spinner.start("Destroying stuck stack...");

        try {
            // REVIEW_IN_PROGRESS stacks require special handling:
            // 1. Delete the failed changeset first
            // 2. Then delete the stack directly (CDK destroy won't work)

            // Step 1: Delete the failed changeset
            spinner.text = "Deleting failed changeset...";
            try {
                execSync(
                    `aws cloudformation delete-change-set --change-set-name cdk-deploy-change-set --stack-name ${stackName} --region ${deployRegion}`,
                    { encoding: "utf-8" },
                );
            } catch (_changesetError) {
                // Changeset might not exist, which is fine - continue with stack deletion
            }

            // Step 2: Delete the stack directly using AWS CLI
            spinner.text = "Deleting stack...";
            execSync(
                `aws cloudformation delete-stack --stack-name ${stackName} --region ${deployRegion}`,
                { encoding: "utf-8" },
            );

            // Step 3: Wait for deletion to complete
            spinner.text = "Waiting for stack deletion to complete...";
            execSync(
                `aws cloudformation wait stack-delete-complete --stack-name ${stackName} --region ${deployRegion}`,
                { encoding: "utf-8", timeout: 300000 },
            );

            spinner.succeed("Stack destroyed");
            console.log(chalk.blue("Proceeding with fresh deployment..."));
            console.log();
        } catch (error) {
            spinner.fail("Failed to destroy stack");
            console.log();
            console.error(chalk.red((error as Error).message));
            console.log();
            console.log(chalk.yellow("You may need to manually delete the stack:"));
            console.log(chalk.cyan(`  aws cloudformation delete-change-set --change-set-name cdk-deploy-change-set --stack-name ${stackName} --region ${deployRegion}`));
            console.log(chalk.cyan(`  aws cloudformation delete-stack --stack-name ${stackName} --region ${deployRegion}`));
            console.log();
            process.exit(1);
        }
    }

    const needsAttention = ["in_progress", "failed", "rolled_back"].includes(stackCheck.statusCategory);

    if (needsAttention) {
        const isActiveRollback = stackCheck.statusCategory === "in_progress";
        const borderColor = isActiveRollback ? "red" : "yellow";
        const title = isActiveRollback ? "Stack is rolling back" : "Stack in problematic state";

        spinner[isActiveRollback ? "fail" : "warn"]("Stack state may block update");
        console.log();
        console.log(
            boxen(
                `${chalk.red.bold(title)}\n\n` +
                `${chalk.bold("Stack status:")} ${stackCheck.stackStatus}\n\n` +
                `${chalk.bold("Options:")}\n` +
                (isActiveRollback
                    ? "  1) Wait/abort (recommended while rollback is in progress)\n  2) Destroy and redeploy if stuck\n  3) Proceed anyway (likely to fail)\n"
                    : "  1) Proceed with deploy\n  2) Destroy and redeploy clean\n  3) Abort\n"),
                { padding: 1, borderColor, borderStyle: "round" },
            ),
        );
        console.log();

        const { proceedChoice } = await prompt<{ proceedChoice: string }>([
            {
                type: "select",
                name: "proceedChoice",
                message: "How would you like to proceed?",
                choices: isActiveRollback
                    ? [
                        { name: "abort", message: "Abort / wait for rollback to finish (recommended)" },
                        { name: "destroy", message: "Destroy existing stack then redeploy clean" },
                        { name: "proceed", message: "Proceed anyway (likely to fail while rollback active)" },
                    ]
                    : [
                        { name: "proceed", message: "Proceed with deployment" },
                        { name: "destroy", message: "Destroy existing stack then redeploy clean" },
                        { name: "abort", message: "Abort now" },
                    ],
                initial: isActiveRollback ? 0 : 0,
            },
        ]);

        if (proceedChoice === "destroy") {
            console.log();
            console.log(chalk.bold("Run destroy then redeploy:"));
            console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook@latest destroy --profile ${options.profileName} --stage ${options.stage}`));
            console.log(chalk.cyan(`  npx @quiltdata/benchling-webhook@latest deploy --profile ${options.profileName} --stage ${options.stage}`));
            console.log();
            process.exit(1);
        }

        if (proceedChoice === "abort") {
            console.log(chalk.yellow("Aborting by user choice."));
            process.exit(1);
        }

        spinner.warn("Proceeding despite stack state; deployment may fail.");
    } else {
        spinner.succeed("Stack status OK - ready for deployment");
    }

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

    spinner.succeed("Quilt configuration loaded");

    spinner.start("Resolving Quilt Athena workgroup...");
    const discoveredAthenaWorkgroup = await resolveQuiltAthenaWorkgroup(
        stackArn,
        deployRegion,
        parsed.stackName,
    );
    if (discoveredAthenaWorkgroup) {
        spinner.succeed(`Resolved Athena workgroup: ${discoveredAthenaWorkgroup}`);
    } else {
        spinner.succeed("No Quilt-managed Athena workgroup found; will create one in webhook stack");
    }

    // Convert to QuiltServices format for display
    const services: QuiltServices = {
        packagerQueueUrl: config.quilt.queueUrl,
        athenaUserDatabase: config.quilt.database,
        quiltWebHost: config.quilt.catalog,
        athenaUserWorkgroup: discoveredAthenaWorkgroup,
    };

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
    console.log(`  ${chalk.bold("Stack:")}                     ${stackName}`);
    console.log(`  ${chalk.bold("Account:")}                   ${deployAccount}`);
    console.log(`  ${chalk.bold("Region:")}                    ${deployRegion}`);
    console.log(`  ${chalk.bold("Stage:")}                     ${options.stage}`);
    console.log(`  ${chalk.bold("Profile:")}                   ${options.profileName}`);
    console.log();
    console.log(chalk.bold("  Resolved Quilt Services:"));
    console.log(`    ${chalk.bold("Catalog Host:")}            ${services.quiltWebHost}`);
    console.log(`    ${chalk.bold("Packager Queue:")}          ${services.packagerQueueUrl}`);
    console.log(`    ${chalk.bold("Athena Database:")}         ${services.athenaUserDatabase}`);
    if (services.athenaUserWorkgroup) {
        console.log(`    ${chalk.bold("Athena Workgroup:")}        ${services.athenaUserWorkgroup}`);
    } else {
        console.log(`    ${chalk.bold("Athena Workgroup:")}        ${stackName}-athena-workgroup ${chalk.dim("(webhook-managed)")}`);
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
    console.log(chalk.bold("  Security Settings:"));
    const verificationEnabled = config.security?.enableVerification !== false;
    console.log(
        `    ${chalk.bold("Webhook Verification:")}    ${verificationEnabled ? chalk.green("ENABLED") : chalk.red("DISABLED")}`,
    );

    // Parse and validate webhook allowlist (same logic as rest-api-gateway.ts)
    const webhookAllowList = config.security?.webhookAllowList || "";
    const allowedIps = webhookAllowList
        .split(",")
        .map(ip => ip.trim())
        .filter(ip => ip.length > 0);

    if (allowedIps.length > 0) {
        console.log(`    ${chalk.bold("IP Filtering:")}            ${chalk.green("ENABLED (Resource Policy)")}`);
        console.log(`    ${chalk.dim(`                                 Allowed IPs: ${allowedIps.join(", ")}`)}`);
    } else {
        console.log(`    ${chalk.bold("IP Filtering:")}            ${chalk.gray("DISABLED")}`);
    }
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
            process.exit(1);
        }
        console.log();
    }

    // Deploy using createStack() + cdk deploy (v0.10.0+)
    // No environment variable IPC - configuration passed programmatically
    console.log();
    console.log(chalk.blue.bold("▶ Starting deployment..."));
    console.log();

    // Track deployment success - we'll verify actual stack status even if CDK command fails
    let deploymentSucceeded = false;
    let cdkError: Error | null = null;
    try {
        // Call createStack() directly to synthesize the CDK app (NO subprocess, NO env vars)
        // Configuration is passed programmatically through the function call

        // Update profile config with CLI overrides
        const deployConfig: ProfileConfig = {
            ...config,
            benchling: {
                ...config.benchling,
                secretArn: benchlingSecret,  // Use CLI-provided or profile secret ARN
            },
            deployment: {
                ...config.deployment,
                imageTag: options.imageTag,
            },
        };

        // Build deployment tags so the stack is traceable in the AWS console
        const deployedAt = new Date().toISOString();
        const deployedBy = process.env.USER || process.env.USERNAME || "unknown";
        let gitSha = "unknown";
        try {
            gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
        } catch { /* not a git repo or git unavailable */ }

        const stackTags: Record<string, string> = {
            "deployed-by": deployedBy,
            "deployed-at": deployedAt,
            "profile": options.profileName,
            "git-sha": gitSha,
        };

        // Transform ProfileConfig → StackConfig (minimal interface)
        const stackConfig = profileToStackConfig(deployConfig);
        const result = createStack(stackConfig, {
            account: deployAccount,
            region: deployRegion,
            profileName: options.profileName,
            tags: stackTags,
        });

        // Synthesize the CDK app to generate CloudFormation template
        const cloudAssembly = result.app.synth();

        // Build CloudFormation parameters for deployment
        // Parameter names must match the CfnParameter IDs in BenchlingWebhookStack
        const parameters = [
            // Explicit service parameters
            `PackagerQueueUrl=${services.packagerQueueUrl}`,
            `AthenaUserDatabase=${services.athenaUserDatabase}`,
            `QuiltWebHost=${services.quiltWebHost}`,

            // Optional Athena workgroup (from Quilt stack discovery)
            // Query results are managed automatically by the workgroup's AWS-managed configuration
            `AthenaUserWorkgroup=${services.athenaUserWorkgroup || ""}`,

            // Legacy parameters
            `BenchlingSecretARN=${benchlingSecret}`,
            `ImageTag=${options.imageTag}`,
            `PackageBucket=${config.packages.bucket}`,
            `QuiltDatabase=${config.quilt.database || ""}`,  // IAM permissions only (same value as AthenaUserDatabase)
            `LogLevel=${config.logging?.level || "INFO"}`,
        ];

        const parametersArg = parameters.map(p => `--parameters ${p}`).join(" ");

        // Deploy the synthesized template using CDK deploy
        // Use cloud assembly directory instead of app path - NO environment variable configuration needed
        const cdkCommand = `npx cdk deploy --app "${cloudAssembly.directory}" --require-approval ${options.requireApproval || "never"} --method=direct ${parametersArg}`;

        execSync(cdkCommand, {
            stdio: "inherit",
            env: {
                ...process.env,
                // Only pass essential AWS credentials, NO application configuration
                CDK_DEFAULT_ACCOUNT: deployAccount,
                CDK_DEFAULT_REGION: deployRegion,
            },
        });

        deploymentSucceeded = true;
        console.log();
        spinner.succeed("Stack deployed successfully");
    } catch (error) {
        // CDK command failed, but the stack might have actually deployed successfully
        // Check actual stack status before failing
        cdkError = error as Error;
        console.log();
        console.log(chalk.yellow("CDK command exited with error, checking actual stack status..."));

        const finalCheck = await checkStackStatus(deployRegion, stackName);
        if (finalCheck.stackExists &&
            (finalCheck.stackStatus === "CREATE_COMPLETE" || finalCheck.stackStatus === "UPDATE_COMPLETE")) {
            console.log(chalk.green(`✓ Stack deployment succeeded despite CDK error (${finalCheck.stackStatus})`));
            deploymentSucceeded = true;
            spinner.succeed("Stack deployed successfully");
        } else {
            deploymentSucceeded = false;
            spinner.fail("Deployment failed");
        }
    }

    // Record deployment endpoint if stack deployed successfully
    if (deploymentSucceeded) {

        // After successful deployment, store endpoint and run tests
        console.log();
        console.log("Retrieving deployment endpoint...");

        try {
            const cloudformation = new CloudFormationClient({ region: deployRegion });

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
                            `Stack:  ${chalk.cyan(stackName)}\n` +
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
    } else {
        // Deployment failed - report the error
        console.log();
        console.error(chalk.red((cdkError as Error).message));
        process.exit(1);
    }
}
