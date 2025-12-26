#!/usr/bin/env ts-node
/**
 * XDG Launch: Unified Configuration Bridge
 *
 * Single command to launch FastAPI application in different modes (native, docker, docker-dev)
 * using profile-based XDG configuration as the single source of truth.
 *
 * Eliminates .env files and manual environment variable management.
 *
 * @module xdg-launch
 * @version 0.8.0
 */

import { spawn } from "child_process";
import { resolve } from "path";
import { existsSync } from "fs";
import { XDGConfig } from "../lib/xdg-config";
import { ProfileConfig } from "../lib/types/config";

/**
 * Launch mode options
 */
type LaunchMode = "native" | "docker" | "docker-dev";

/**
 * Launch configuration options
 */
interface LaunchOptions {
    mode: LaunchMode;
    profile: string;
    port?: number;
    verbose: boolean;
    test: boolean;
    noSecret: boolean;
}

/**
 * Environment variables map
 */
type EnvVars = Record<string, string>;

/**
 * Parse command-line arguments
 *
 * @param argv - Command-line arguments
 * @returns Parsed launch options
 */
function parseArguments(argv: string[]): LaunchOptions {
    const args = argv.slice(2);
    const options: Partial<LaunchOptions> = {
        profile: "default",
        verbose: false,
        test: false,
        noSecret: false,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "--mode" && i + 1 < args.length) {
            const mode = args[++i];
            if (mode !== "native" && mode !== "docker" && mode !== "docker-dev") {
                throw new Error(`Invalid mode: ${mode}. Must be: native, docker, or docker-dev`);
            }
            options.mode = mode;
        } else if (arg === "--profile" && i + 1 < args.length) {
            options.profile = args[++i];
        } else if (arg === "--port" && i + 1 < args.length) {
            options.port = parseInt(args[++i], 10);
            if (isNaN(options.port) || options.port < 1 || options.port > 65535) {
                throw new Error(`Invalid port: ${args[i]}. Must be between 1 and 65535`);
            }
        } else if (arg === "--verbose") {
            options.verbose = true;
        } else if (arg === "--test") {
            options.test = true;
        } else if (arg === "--no-secret") {
            options.noSecret = true;
        } else if (arg === "--help" || arg === "-h") {
            printUsage();
            process.exit(0);
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }

    if (!options.mode) {
        throw new Error("Missing required option: --mode");
    }

    return options as LaunchOptions;
}

/**
 * Print usage information
 */
function printUsage(): void {
    console.log(`
XDG Launch - Unified Configuration Bridge

Usage: npx ts-node bin/xdg-launch.ts [OPTIONS]

Options:
  --mode <mode>         Execution mode: native, docker, docker-dev (required)
  --profile <name>      XDG profile name (default: "default")
  --port <number>       Override default port
  --verbose             Enable verbose logging
  --test                Run in test mode
  --no-secret           Test degraded startup (empty BenchlingSecret)
  --help, -h            Show this help message

Examples:
  npx ts-node bin/xdg-launch.ts --mode native --profile dev
  npx ts-node bin/xdg-launch.ts --mode docker --profile default
  npx ts-node bin/xdg-launch.ts --mode docker-dev --profile dev --verbose
  npx ts-node bin/xdg-launch.ts --mode native --profile dev --test
    `.trim());
}

/**
 * Load XDG profile configuration
 *
 * @param profileName - Profile name
 * @returns Profile configuration
 */
function loadProfile(profileName: string): ProfileConfig {
    const xdg = new XDGConfig();

    if (!xdg.profileExists(profileName)) {
        const available = xdg.listProfiles();
        throw new Error(
            `Profile not found: "${profileName}"\n\n` +
            "Available profiles:\n" +
            (available.length > 0
                ? available.map((p) => `  - ${p}`).join("\n")
                : "  (none)"
            ) +
            "\n\n" +
            "Create a new profile:\n" +
            `  npm run setup -- --profile ${profileName}`,
        );
    }

    return xdg.readProfile(profileName);
}

/**
 * Extract secret name from Secrets Manager ARN
 *
 * AWS Secrets Manager automatically appends a 6-character random suffix to secret names
 * in ARNs (e.g., "my-secret-Ab12Cd"). This function extracts the base secret name by
 * removing the suffix.
 *
 * @param arn - Secrets Manager ARN
 * @returns Secret name without the random suffix
 */
function extractSecretName(arn: string): string {
    if (!arn) {
        return "";
    }
    // ARN format: arn:aws:secretsmanager:region:account:secret:name-XXXXXX
    // where XXXXXX is a 6-character random suffix added by AWS
    const match = arn.match(/secret:([^:]+)/);
    if (!match) {
        return arn;
    }

    const fullName = match[1];

    // Remove the AWS-generated 6-character suffix (format: -XXXXXX)
    // The suffix is always a hyphen followed by 6 alphanumeric characters
    const withoutSuffix = fullName.replace(/-[A-Za-z0-9]{6}$/, "");

    return withoutSuffix;
}

/**
 * Build environment variables from profile configuration
 *
 * Maps XDG config fields to service-specific environment variables.
 *
 * @param config - Profile configuration
 * @param mode - Launch mode
 * @param options - Launch options
 * @returns Environment variables map
 */
function buildEnvVars(config: ProfileConfig, mode: LaunchMode, options: LaunchOptions): EnvVars {
    // Filter out undefined values from process.env and convert to Record<string, string>
    const filteredProcessEnv: EnvVars = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            filteredProcessEnv[key] = value;
        }
    }

    const envVars: EnvVars = {
        // Preserve existing process.env (with undefined values filtered out)
        ...filteredProcessEnv,

        // Quilt Services (v0.8.0+ service-specific - NO MORE STACK ARN!)
        QUILT_WEB_HOST: config.quilt.catalog,
        ATHENA_USER_DATABASE: config.quilt.database,
        ATHENA_USER_WORKGROUP: config.quilt.athenaUserWorkgroup || "primary",
        PACKAGER_SQS_URL: config.quilt.queueUrl,

        // IAM Policy ARNs for ECS task role (attached directly, no role assumption needed)
        // Note: These are attached to the task role in the CDK stack, not passed as env vars
        // Kept here for backward compatibility with older container versions
        QUILT_BUCKET_WRITE_POLICY_ARN: config.quilt.bucketWritePolicyArn || "",
        QUILT_ATHENA_USER_POLICY_ARN: config.quilt.athenaUserPolicyArn || "",

        // AWS Configuration
        AWS_REGION: config.quilt.region || config.deployment.region,
        AWS_DEFAULT_REGION: config.quilt.region || config.deployment.region,

        // Benchling Configuration (credentials from Secrets Manager, NOT environment)
        BenchlingSecret: extractSecretName(config.benchling.secretArn || ""),

        // Security Configuration
        ENABLE_WEBHOOK_VERIFICATION: String(config.security?.enableVerification !== false),
    };

    // Mode-specific variables
    if (mode === "native" || mode === "docker-dev") {
        envVars.APP_ENV = "development";
        envVars.LOG_LEVEL = config.logging?.level || "DEBUG";

        // Disable verification in dev mode for easier testing
        if (mode === "docker-dev") {
            envVars.ENABLE_WEBHOOK_VERIFICATION = "false";
        }
    } else {
        // docker (production)
        envVars.APP_ENV = "production";
        envVars.LOG_LEVEL = config.logging?.level || "INFO";
    }

    // Test mode flag - disable webhook verification for local testing
    if (options.test) {
        envVars.BENCHLING_TEST_MODE = "true";
        envVars.ENABLE_WEBHOOK_VERIFICATION = "false";
    }

    // No-secret mode - test degraded startup behavior
    if (options.noSecret) {
        envVars.BenchlingSecret = "";
        envVars.ENABLE_WEBHOOK_VERIFICATION = "false";
    }

    return envVars;
}

/**
 * Validate required configuration
 *
 * Ensures all required service variables are present and well-formed.
 *
 * @param envVars - Environment variables to validate
 * @param profile - Profile name (for error messages)
 */
function validateConfig(envVars: EnvVars, profile: string): void {
    // Required service variables (NO BENCHLING_TENANT - comes from Secrets Manager!)
    const required = [
        "QUILT_WEB_HOST",
        "ATHENA_USER_DATABASE",
        "PACKAGER_SQS_URL",
        "AWS_REGION",
        "BenchlingSecret",
    ];

    const missing = required.filter((key) => !envVars[key]);

    if (missing.length > 0) {
        throw new Error(
            "Missing required configuration:\n" +
            missing.map((key) => `  - ${key}`).join("\n") +
            "\n\n" +
            "Check profile configuration at:\n" +
            `  ~/.config/benchling-webhook/${profile}/config.json\n\n` +
            "Run setup wizard to configure:\n" +
            `  npm run setup -- --profile ${profile}`,
        );
    }

    // Format validation
    if (!envVars.PACKAGER_SQS_URL.match(/^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d+\/.+/)) {
        throw new Error(
            `Invalid SQS URL format: ${envVars.PACKAGER_SQS_URL}\n\n` +
            "Expected format:\n" +
            "  https://sqs.{region}.amazonaws.com/{account}/{queue-name}\n\n" +
            "Example:\n" +
            "  https://sqs.us-east-1.amazonaws.com/123456789012/packager-queue",
        );
    }

    // Validate BenchlingSecret is present (secret name, not ARN)
    if (!envVars.BenchlingSecret) {
        throw new Error(
            "Missing BenchlingSecret\n\n" +
            "BenchlingSecret must be the name of your AWS Secrets Manager secret.\n" +
            "Example: benchling-webhook-prod",
        );
    }
}

/**
 * Filter secrets from environment variables for verbose logging
 *
 * @param envVars - Environment variables
 * @returns Filtered environment variables (secrets masked)
 */
function filterSecrets(envVars: EnvVars): EnvVars {
    const filtered: EnvVars = {};
    for (const [key, value] of Object.entries(envVars)) {
        const upperKey = key.toUpperCase();
        if (upperKey.includes("SECRET") || upperKey.includes("PASSWORD") || upperKey.includes("TOKEN")) {
            filtered[key] = "***REDACTED***";
        } else {
            filtered[key] = value;
        }
    }
    return filtered;
}

/**
 * Spawn docker-compose command with consistent environment
 *
 * @param args - docker-compose arguments
 * @param dockerDir - Docker working directory
 * @param envVars - Environment variables
 * @param stdio - stdio option for spawn
 * @returns Child process
 */
function spawnDockerCompose(
    args: string[],
    dockerDir: string,
    envVars: EnvVars,
    stdio: "inherit" | "pipe" = "inherit",
): ReturnType<typeof spawn> {
    // Debug: Log key environment variables being passed
    const keyVars = ["QUILT_WEB_HOST", "ATHENA_USER_DATABASE", "PACKAGER_SQS_URL", "BenchlingSecret"];
    const debug = process.env.DEBUG_XDG === "true";
    if (debug) {
        console.log("DEBUG: Spawning docker-compose with environment:");
        keyVars.forEach(key => {
            const value = envVars[key];
            console.log(`  ${key}=${value ? (key.includes("Secret") ? "***" : value) : "MISSING"}`);
        });
        console.log(`DEBUG: cwd=${dockerDir}`);
        console.log(`DEBUG: command=docker-compose ${args.join(" ")}`);
    }

    return spawn("docker-compose", args, {
        cwd: dockerDir,
        env: envVars,
        stdio,
    });
}

/**
 * Wait for server to be healthy
 *
 * @param url - Server URL to check
 * @param maxAttempts - Maximum number of attempts
 * @param delayMs - Delay between attempts in milliseconds
 * @returns Promise that resolves when server is healthy
 */
async function waitForHealth(url: string, maxAttempts = 30, delayMs = 1000): Promise<void> {
    console.log(`\n⏳ Waiting for server to be healthy at ${url}...`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await fetch(`${url}/health`, {
                signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
                console.log(`✅ Server is healthy (attempt ${attempt}/${maxAttempts})\n`);
                return;
            } else {
                // Log non-OK responses for debugging
                if (process.env.DEBUG_XDG === "true") {
                    console.log(`DEBUG: Health check attempt ${attempt}: HTTP ${response.status}`);
                }
            }
        } catch (error) {
            // Log errors for debugging
            if (process.env.DEBUG_XDG === "true" && attempt % 5 === 0) {
                const err = error as Error;
                console.log(`DEBUG: Health check attempt ${attempt}: ${err.message}`);
            }
        }

        if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    throw new Error(`Server did not become healthy after ${maxAttempts} attempts`);
}

/**
 * Run tests against the server
 *
 * @param url - Server URL to test
 * @param profile - Profile name
 * @returns Promise that resolves with test exit code
 */
async function runTests(url: string, profile: string): Promise<number> {
    console.log("🧪 Running tests...\n");

    const dockerDir = resolve(__dirname, "..", "docker");
    const testScript = resolve(dockerDir, "scripts", "test_webhook.py");

    if (!existsSync(testScript)) {
        throw new Error(`Test script not found: ${testScript}`);
    }

    return new Promise((resolve) => {
        const proc = spawn("uv", ["run", "python", testScript, url, "--profile", profile], {
            cwd: dockerDir,
            stdio: "inherit",
        });

        proc.on("exit", (code) => {
            resolve(code || 0);
        });

        proc.on("error", (error) => {
            console.error(`\n❌ Failed to run tests: ${error.message}`);
            resolve(1);
        });
    });
}

/**
 * Launch FastAPI application in native mode
 *
 * Runs FastAPI directly on host using uv.
 *
 * @param envVars - Environment variables
 * @param options - Launch options
 */
async function launchNative(envVars: EnvVars, options: LaunchOptions): Promise<void> {
    const port = options.port || 8080;
    envVars.PORT = String(port);

    console.log(`🚀 Launching native FastAPI (port ${port})...`);

    if (options.verbose) {
        console.log("\nEnvironment Variables:");
        const filtered = filterSecrets(envVars);
        Object.entries(filtered)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([key, value]) => console.log(`  ${key}=${value}`));
        console.log();
    }

    // Check if uv is installed
    const dockerDir = resolve(__dirname, "..", "docker");
    if (!existsSync(dockerDir)) {
        throw new Error(`Docker directory not found: ${dockerDir}`);
    }

    console.log(`Working directory: ${dockerDir}`);
    console.log(`Command: uv run uvicorn src.app:create_app --factory --host 0.0.0.0 --port ${port}\n`);

    const proc = spawn("uv", ["run", "uvicorn", "src.app:create_app", "--factory", "--host", "0.0.0.0", "--port", String(port)], {
        cwd: dockerDir,
        env: envVars,
        stdio: options.test ? "pipe" : "inherit",
    });

    // If in test mode, run tests after server is healthy
    if (options.test) {
        try {
            const serverUrl = `http://localhost:${port}`;
            await waitForHealth(serverUrl);
            const exitCode = await runTests(serverUrl, options.profile);

            console.log("\n🛑 Shutting down server...");
            proc.kill("SIGTERM");

            // Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 1000));

            process.exit(exitCode);
        } catch (error) {
            console.error(`\n❌ Test failed: ${(error as Error).message}`);
            proc.kill("SIGTERM");
            process.exit(1);
        }
    } else {
        // Non-test mode: run server interactively with graceful shutdown
        const cleanup = (): void => {
            console.log("\n\n🛑 Shutting down...");
            proc.kill("SIGTERM");
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        proc.on("error", (error: Error & { code?: string }) => {
            console.error(`\n❌ Failed to start native FastAPI: ${error.message}`);
            if (error.code === "ENOENT") {
                console.error("\nIs \"uv\" installed and in your PATH?");
                console.error("Install uv: https://docs.astral.sh/uv/getting-started/installation/");
            }
            process.exit(1);
        });

        proc.on("exit", (code) => {
            if (code !== 0 && code !== null) {
                console.error(`\n❌ Native FastAPI exited with code ${code}`);
            }
            process.exit(code || 0);
        });
    }
}

/**
 * Launch FastAPI application in Docker production mode
 *
 * Runs production Docker container via docker-compose.
 *
 * @param envVars - Environment variables
 * @param options - Launch options
 */
async function launchDocker(envVars: EnvVars, options: LaunchOptions): Promise<void> {
    const port = options.port || 8083;
    envVars.PORT = String(port);

    console.log(`🐳 Launching Docker production (port ${port})...`);

    if (options.verbose) {
        console.log("\nEnvironment Variables:");
        const filtered = filterSecrets(envVars);
        Object.entries(filtered)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([key, value]) => console.log(`  ${key}=${value}`));
        console.log();
    }

    const dockerDir = resolve(__dirname, "..", "docker");
    if (!existsSync(dockerDir)) {
        throw new Error(`Docker directory not found: ${dockerDir}`);
    }

    console.log(`Working directory: ${dockerDir}`);

    // Build first with --pull to ensure base image is current
    // This forces Docker to check if source files have changed
    console.log("Building image with latest source changes...");
    const buildProc = spawnDockerCompose(
        ["build", "--pull", "app"],
        dockerDir,
        envVars,
        "inherit",
    );

    // Wait for build to complete
    await new Promise<void>((resolve, reject) => {
        buildProc.on("exit", (code) => {
            if (code === 0) {
                console.log("\n✅ Build complete, starting container...\n");
                resolve();
            } else {
                reject(new Error(`Build failed with exit code ${code}`));
            }
        });
        buildProc.on("error", reject);
    });

    // Now start the container
    console.log("Command: docker-compose up app\n");
    const proc = spawnDockerCompose(
        ["up", "app"],
        dockerDir,
        envVars,
        options.test ? "pipe" : "inherit",
    );

    // If in test mode, run tests after server is healthy
    if (options.test) {
        const dockerCleanup = (): void => {
            spawnDockerCompose(["down"], dockerDir, envVars);
        };

        try {
            const serverUrl = `http://localhost:${port}`;
            await waitForHealth(serverUrl);
            const exitCode = await runTests(serverUrl, options.profile);

            console.log("\n🛑 Shutting down Docker container...");
            dockerCleanup();

            // Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 2000));

            process.exit(exitCode);
        } catch (error) {
            console.error(`\n❌ Test failed: ${(error as Error).message}`);
            dockerCleanup();
            process.exit(1);
        }
    } else {
        // Non-test mode: run server interactively with graceful shutdown
        const cleanup = (): void => {
            console.log("\n\n🛑 Shutting down Docker container...");
            spawnDockerCompose(["down"], dockerDir, envVars);
            proc.kill("SIGTERM");
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        proc.on("error", (error: Error & { code?: string }) => {
            console.error(`\n❌ Failed to start Docker: ${error.message}`);
            if (error.code === "ENOENT") {
                console.error("\nIs \"docker-compose\" installed and in your PATH?");
            }
            process.exit(1);
        });

        proc.on("exit", (code) => {
            if (code !== 0 && code !== null) {
                console.error(`\n❌ Docker exited with code ${code}`);
            }
            process.exit(code || 0);
        });
    }
}

/**
 * Launch FastAPI application in Docker development mode
 *
 * Runs Docker container with hot-reload enabled via docker-compose --profile dev.
 *
 * @param envVars - Environment variables
 * @param options - Launch options
 */
async function launchDockerDev(envVars: EnvVars, options: LaunchOptions): Promise<void> {
    const hostPort = options.port || 8082;
    // Note: Container always listens on 8080, hostPort is for the port mapping
    // Don't set PORT in envVars - let docker-compose.yml handle it

    console.log(`🐳 Launching Docker development (port ${hostPort}, hot-reload enabled)...`);

    if (options.verbose) {
        console.log("\nEnvironment Variables:");
        const filtered = filterSecrets(envVars);
        Object.entries(filtered)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([key, value]) => console.log(`  ${key}=${value}`));
        console.log();
    }

    const dockerDir = resolve(__dirname, "..", "docker");
    if (!existsSync(dockerDir)) {
        throw new Error(`Docker directory not found: ${dockerDir}`);
    }

    console.log(`Working directory: ${dockerDir}`);

    // Build first with --pull to ensure base image is current
    // This forces Docker to check if source files have changed
    console.log("Building image with latest source changes...");
    const buildProc = spawnDockerCompose(
        ["--profile", "dev", "build", "--pull", "app-dev"],
        dockerDir,
        envVars,
        "inherit",
    );

    // Wait for build to complete
    await new Promise<void>((resolve, reject) => {
        buildProc.on("exit", (code) => {
            if (code === 0) {
                console.log("\n✅ Build complete, starting container...\n");
                resolve();
            } else {
                reject(new Error(`Build failed with exit code ${code}`));
            }
        });
        buildProc.on("error", reject);
    });

    // If in test mode, run tests after server is healthy
    if (options.test) {
        // In test mode, use detached mode (-d) to start container in background
        console.log("Command: docker-compose --profile dev up -d app-dev\n");
        const startProc = spawnDockerCompose(
            ["--profile", "dev", "up", "-d", "app-dev"],
            dockerDir,
            envVars,
            "inherit",
        );

        // Wait for docker-compose to start the container
        await new Promise<void>((resolve, reject) => {
            startProc.on("exit", (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`docker-compose up failed with exit code ${code}`));
                }
            });
            startProc.on("error", reject);
        });
        const dockerCleanup = (): void => {
            spawnDockerCompose(["--profile", "dev", "down"], dockerDir, envVars);
        };

        try {
            const serverUrl = `http://localhost:${hostPort}`;
            await waitForHealth(serverUrl);
            const exitCode = await runTests(serverUrl, options.profile);

            console.log("\n🛑 Shutting down Docker dev container...");
            dockerCleanup();

            // Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 2000));

            process.exit(exitCode);
        } catch (error) {
            console.error(`\n❌ Test failed: ${(error as Error).message}`);
            dockerCleanup();
            process.exit(1);
        }
    } else {
        // Non-test mode: run server interactively (foreground)
        console.log("Command: docker-compose --profile dev up app-dev\n");
        const proc = spawnDockerCompose(
            ["--profile", "dev", "up", "app-dev"],
            dockerDir,
            envVars,
            "inherit",
        );

        const cleanup = (): void => {
            console.log("\n\n🛑 Shutting down Docker dev container...");
            spawnDockerCompose(["--profile", "dev", "down"], dockerDir, envVars);
            proc.kill("SIGTERM");
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        proc.on("error", (error: Error & { code?: string }) => {
            console.error(`\n❌ Failed to start Docker dev: ${error.message}`);
            if (error.code === "ENOENT") {
                console.error("\nIs \"docker-compose\" installed and in your PATH?");
            }
            process.exit(1);
        });

        proc.on("exit", (code) => {
            if (code !== 0 && code !== null) {
                console.error(`\n❌ Docker dev exited with code ${code}`);
            }
            process.exit(code || 0);
        });
    }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
    try {
        // Parse command-line arguments
        const options = parseArguments(process.argv);

        // Load XDG profile configuration
        const config = loadProfile(options.profile);

        // Build environment variables
        const envVars = buildEnvVars(config, options.mode, options);

        // Validate configuration
        validateConfig(envVars, options.profile);

        // Launch appropriate mode
        switch (options.mode) {
        case "native":
            await launchNative(envVars, options);
            break;
        case "docker":
            await launchDocker(envVars, options);
            break;
        case "docker-dev":
            await launchDockerDev(envVars, options);
            break;
        default:
            throw new Error(`Unknown mode: ${options.mode}`);
        }
    } catch (error) {
        console.error(`\n❌ Error: ${(error as Error).message}\n`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch((error) => {
        console.error(`\n❌ Fatal error: ${error.message}\n`);
        process.exit(1);
    });
}

// Export for testing
export { parseArguments, loadProfile, buildEnvVars, validateConfig, filterSecrets };
