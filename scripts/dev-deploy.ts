#!/usr/bin/env ts-node

/**
 * Development deployment workflow script
 *
 * This script:
 * 1. Creates a dev git tag with timestamp (v{version}-{timestamp})
 * 2. Pushes the tag to GitHub (triggers CI to build Docker image)
 * 3. Waits for CI/CD pipeline to complete (monitors GitHub Actions)
 * 4. Deploys CDK stack using the CI-built image tag
 *
 * Usage:
 *   npm run deploy:dev                    # Full workflow
 *   npm run deploy:dev -- --continue      # Skip tag creation, wait for CI and deploy
 *   npm run deploy:dev -- --tag <tag>     # Use specific existing tag
 *
 * IMPORTANT: This uses CI-built images (x86_64), NOT local builds.
 * Local ARM builds would fail in AWS which runs on x86_64.
 */

import { execSync } from "child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { generateSecretName } from "../lib/utils/secrets";

interface PackageJson {
    version: string;
}

interface RunOptions {
    silent?: boolean;
    allowFailure?: boolean;
}

interface WorkflowRun {
    status: string;
    conclusion: string | null;
    url: string;
    databaseId: number;
}

interface DeployConfig {
    dev?: {
        endpoint: string;
        imageTag: string;
        deployedAt: string;
        stackName: string;
    };
    [key: string]: any;
}

// Read package.json for version
const packagePath = join(__dirname, "..", "package.json");
const pkg: PackageJson = JSON.parse(readFileSync(packagePath, "utf8"));

function run(command: string, options: RunOptions = {}): string | null {
    const silent = options.silent || false;
    if (!silent) {
        console.log(`\n$ ${command}\n`);
    }
    try {
        return execSync(command, {
            stdio: silent ? "pipe" : "inherit",
            encoding: "utf-8",
            ...options,
        });
    } catch (error) {
        if (!silent) {
            console.error(`\n❌ Command failed: ${command}`);
        }
        if (options.allowFailure) {
            return null;
        }
        process.exit(1);
    }
}

async function waitForWorkflow(commitSha: string, timeoutMinutes: number = 15): Promise<boolean> {
    console.log("");
    console.log(`Waiting for CI workflow to complete (timeout: ${timeoutMinutes} minutes)...`);
    console.log("");

    // Check if gh CLI is available
    try {
        execSync("gh --version", { stdio: "ignore" });
    } catch (e) {
        console.error("❌ GitHub CLI (gh) is not installed or not in PATH");
        console.error("   Install from: https://cli.github.com/");
        console.error("\n   Alternatively, monitor the workflow manually and deploy when complete:");
        console.error("   1. Watch: https://github.com/quiltdata/benchling-webhook/actions");
        console.error("   2. Deploy: npm run cli -- --image-tag <version> --yes");
        process.exit(1);
    }

    const startTime = Date.now();
    const timeoutMs = timeoutMinutes * 60 * 1000;
    let attempt = 0;
    let workflowUrl: string | null = null;

    while (Date.now() - startTime < timeoutMs) {
        attempt++;

        try {
            // Use gh to list recent workflow runs for this commit
            const result = run(
                `gh run list --commit ${commitSha} --json status,conclusion,url,databaseId --limit 5`,
                {
                    silent: true,
                    allowFailure: true,
                },
            );

            if (!result) {
                process.stdout.write(
                    `\r  Attempt ${attempt}: Waiting for workflow to start (commit ${commitSha.substring(0, 7)})...`,
                );
                await new Promise((resolve) => setTimeout(resolve, 10000));
                continue;
            }

            const runs: WorkflowRun[] = JSON.parse(result);

            if (runs && runs.length > 0) {
                const workflowRun = runs[0]; // Most recent run for this commit
                const status = workflowRun.status;
                const conclusion = workflowRun.conclusion;
                workflowUrl = workflowRun.url;

                process.stdout.write(
                    `\r  Attempt ${attempt}: Status=${status}, Conclusion=${conclusion || "pending"}... ${workflowUrl}`,
                );

                if (status === "completed") {
                    console.log("\n");
                    if (conclusion === "success") {
                        console.log("✅ CI workflow completed successfully!");
                        console.log(`   Run: ${workflowUrl}`);
                        return true;
                    } else {
                        console.error(`\n❌ CI workflow failed with conclusion: ${conclusion}`);
                        console.error(`   Run: ${workflowUrl}`);
                        console.error("   Please check the workflow logs and fix any issues.");
                        process.exit(1);
                    }
                }
            } else {
                process.stdout.write(
                    `\r  Attempt ${attempt}: Waiting for workflow to start (commit ${commitSha.substring(0, 7)})...`,
                );
            }
        } catch (error) {
            // Errors are non-fatal, just retry
            if (attempt % 10 === 0) {
                console.log(`\n  Warning: ${(error as Error).message}`);
            }
        }

        // Wait 10 seconds between checks
        await new Promise((resolve) => setTimeout(resolve, 10000));
    }

    console.error("\n\n❌ Timeout waiting for CI workflow to complete");
    console.error(`   Waited ${timeoutMinutes} minutes`);
    if (workflowUrl) {
        console.error(`   Check status at: ${workflowUrl}`);
    } else {
        console.error("   Check status at: https://github.com/quiltdata/benchling-webhook/actions");
    }
    console.error("\n   Once the workflow completes, you can deploy manually with:");
    console.error("   npm run cli -- --image-tag <version> --yes");
    process.exit(1);
}

async function main(): Promise<void> {
    console.log("🚀 Starting development deployment workflow...");
    console.log("");
    console.log("This workflow uses CI-built Docker images (x86_64 for AWS).");
    console.log("Local ARM builds are NOT used as they would fail in AWS.");
    console.log("");

    // Parse command line arguments
    const args = process.argv.slice(2);
    const continueMode = args.includes("--continue");
    const tagIndex = args.indexOf("--tag");
    const specificTag = tagIndex !== -1 ? args[tagIndex + 1] : null;

    let devTag: string;
    let version: string;

    if (specificTag) {
        // Use specific tag provided by user
        devTag = specificTag;
        version = specificTag.replace(/^v/, "").split("-")[0]; // Extract version from tag
        console.log(`Using specified tag: ${devTag}`);
        console.log(`Extracted version: ${version}`);
    } else if (continueMode) {
        // Continue mode - find most recent dev tag
        console.log("Continue mode: Finding most recent dev tag...");
        try {
            const tagsOutput = run("git tag --sort=-creatordate", { silent: true });
            if (!tagsOutput) {
                throw new Error("No tags found");
            }
            const tags = tagsOutput.trim().split("\n");
            const recentDevTag = tags.find((t) => t.match(/^v[\d.]+-.+Z$/));

            if (!recentDevTag) {
                console.error("❌ No dev tags found");
                console.error("   Run without --continue to create a new dev tag first");
                process.exit(1);
            }

            devTag = recentDevTag;
            version = devTag.replace(/^v/, "").split("-")[0];
            console.log(`✅ Found recent dev tag: ${devTag}`);
            console.log(`   Version: ${version}`);
        } catch (e) {
            console.error("❌ Failed to find recent dev tag");
            process.exit(1);
        }
    } else {
        // Normal mode - create new tag
        // 1. Check for uncommitted changes
        console.log("Step 1: Checking for uncommitted changes...");
        try {
            execSync("git diff-index --quiet HEAD --", { stdio: "ignore" });
        } catch (e) {
            console.error("❌ You have uncommitted changes");
            console.error("   Commit or stash your changes before creating a dev deployment");
            process.exit(1);
        }
        console.log("✅ Working directory is clean");

        // 2. Generate dev tag name
        version = pkg.version;
        const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
        devTag = `v${version}-${timestamp}`;

        console.log("");
        console.log(`Step 2: Creating dev tag: ${devTag}`);

        // Check if tag already exists
        try {
            execSync(`git rev-parse ${devTag}`, { stdio: "ignore" });
            console.error(`❌ Tag ${devTag} already exists`);
            process.exit(1);
        } catch (e) {
            // Tag doesn't exist, continue
        }

        // Create tag
        const message = `Development release ${devTag}\n\nThis is a pre-release for testing purposes.`;
        run(`git tag -a ${devTag} -m "${message}"`);
        console.log(`✅ Created git tag ${devTag}`);

        // 3. Push tag to origin (triggers CI)
        console.log("");
        console.log("Step 3: Pushing tag to origin (this triggers CI/CD)...");
        run(`git push origin ${devTag}`);
        console.log(`✅ Pushed tag ${devTag} to origin`);
        console.log("   CI will now build Docker image for x86_64 (AWS-compatible)");
    }

    // 4. Wait for CI to complete
    console.log("");
    console.log("Step 4: Waiting for CI to build Docker image...");

    // Get the commit SHA for the tag (use ^{commit} to dereference annotated tags)
    const commitShaOutput = run(`git rev-parse ${devTag}^{commit}`, { silent: true });
    if (!commitShaOutput) {
        console.error("❌ Failed to get commit SHA");
        process.exit(1);
    }
    const commitSha = commitShaOutput.trim();

    await waitForWorkflow(commitSha);

    // 5. Deploy CDK stack with CI-built image tag using secrets-only mode
    console.log("");
    console.log("Step 5: Deploying CDK stack with CI-built image (secrets-only mode)...");
    process.chdir(join(__dirname, ".."));
    // Use the full version with timestamp (without 'v' prefix)
    const imageTag = devTag.replace(/^v/, "");

    // Secrets-only mode parameters
    const quiltStackArn =
        "arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/e51b0c10-10c9-11ee-9b41-12fda87498a3";
    const benchlingSecret = generateSecretName("default", "quilt-dtt");

    run(
        `npm run deploy:prod -- --quilt-stack-arn ${quiltStackArn} --benchling-secret ${benchlingSecret} --image-tag ${imageTag} --yes`,
    );

    // 6. Get and store the deployment endpoint
    console.log("");
    console.log("Step 6: Retrieving deployment endpoint...");

    try {
        const cloudformation = new CloudFormationClient({ region: "us-east-1" });
        const command = new DescribeStacksCommand({ StackName: "BenchlingWebhookStack" });
        const response = await cloudformation.send(command);

        if (response.Stacks && response.Stacks.length > 0) {
            const stack = response.Stacks[0];
            const endpointOutput = stack.Outputs?.find((o) => o.OutputKey === "WebhookEndpoint");
            const webhookUrl = endpointOutput?.OutputValue || "";

            if (webhookUrl) {
                // Store endpoint in XDG config
                const configDir = join(homedir(), ".config", "benchling-webhook");
                const deployJsonPath = join(configDir, "deploy.json");

                // Read existing deploy.json or create new one
                let deployConfig: DeployConfig = {};
                if (existsSync(deployJsonPath)) {
                    deployConfig = JSON.parse(readFileSync(deployJsonPath, "utf8"));
                }

                // Remove trailing slash to avoid double slashes in test URLs
                const cleanEndpoint = webhookUrl.replace(/\/$/, "");

                // Update dev section
                deployConfig.dev = {
                    endpoint: cleanEndpoint,
                    imageTag: imageTag,
                    deployedAt: new Date().toISOString(),
                    stackName: "BenchlingWebhookStack",
                };

                // Ensure config directory exists
                if (!existsSync(configDir)) {
                    mkdirSync(configDir, { recursive: true });
                }

                // Write deploy.json
                writeFileSync(deployJsonPath, JSON.stringify(deployConfig, null, 2));
                console.log(`✅ Stored deployment endpoint in ${deployJsonPath}`);
                console.log(`   Endpoint: ${cleanEndpoint}`);
            }
        }
    } catch (error) {
        console.warn(`⚠️  Could not retrieve/store deployment endpoint: ${(error as Error).message}`);
    }

    console.log("");
    console.log("✅ Development deployment complete!");
    console.log("");
    console.log(`Dev tag: ${devTag}`);
    console.log(`Image tag: ${imageTag} (built by CI for x86_64)`);
    console.log("");
}

main().catch((error) => {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
});
