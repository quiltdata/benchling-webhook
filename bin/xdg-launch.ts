#!/usr/bin/env ts-node
/**
 * XDG Launch: Unified Configuration Bridge
 *
 * Single command to launch Flask application in different modes (native, docker, docker-dev)
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
 * @param arn - Secrets Manager ARN
 * @returns Secret name only
 */
function extractSecretName(arn: string): string {
    if (!arn) {
        return "";
    }
    // ARN format: arn:aws:secretsmanager:region:account:secret:name-randomchars
    const match = arn.match(/secret:([^:]+)/);
    return match ? match[1] : arn;
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
    const envVars: EnvVars = {
        // Preserve existing process.env
        ...process.env as EnvVars,

        // Quilt Services (v0.8.0+ service-specific - NO MORE STACK ARN!)
        QUILT_WEB_HOST: config.quilt.catalog,
        ATHENA_USER_DATABASE: config.quilt.database,
        ATHENA_USER_WORKGROUP: config.quilt.athenaUserWorkgroup || "primary",
        ATHENA_RESULTS_BUCKET: config.quilt.athenaResultsBucket || "",
        ICEBERG_DATABASE: config.quilt.icebergDatabase || "",
        ICEBERG_WORKGROUP: config.quilt.icebergWorkgroup || "",
        PACKAGER_SQS_URL: config.quilt.queueUrl,

        // AWS Configuration
        AWS_REGION: config.quilt.region || config.deployment.region,
        AWS_DEFAULT_REGION: config.quilt.region || config.deployment.region,

        // Benchling Configuration (credentials from Secrets Manager, NOT environment)
        BenchlingSecret: extractSecretName(config.benchling.secretArn || ""),

        // Package Storage
        PACKAGE_BUCKET: config.packages.bucket,
        PACKAGE_PREFIX: config.packages.prefix,
        PACKAGE_METADATA_KEY: config.packages.metadataKey,

        // Security Configuration
        ENABLE_WEBHOOK_VERIFICATION: String(config.security?.enableVerification !== false),
        WEBHOOK_ALLOW_LIST: config.security?.webhookAllowList || "",
    };

    // Mode-specific variables
    if (mode === "native" || mode === "docker-dev") {
        envVars.FLASK_ENV = "development";
        envVars.FLASK_DEBUG = "true";
        envVars.LOG_LEVEL = config.logging?.level || "DEBUG";

        // Disable verification in dev mode for easier testing
        if (mode === "docker-dev") {
            envVars.ENABLE_WEBHOOK_VERIFICATION = "false";
        }
    } else {
        // docker (production)
        envVars.FLASK_ENV = "production";
        envVars.LOG_LEVEL = config.logging?.level || "INFO";
    }

    // Test mode flag
    if (options.test) {
        envVars.BENCHLING_TEST_MODE = "true";
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
        "PACKAGE_BUCKET",
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
 * Launch Flask application in native mode
 *
 * Runs Flask directly on host using uv.
 *
 * @param envVars - Environment variables
 * @param options - Launch options
 */
function launchNative(envVars: EnvVars, options: LaunchOptions): void {
    const port = options.port || 5001;
    envVars.PORT = String(port);

    console.log(`🚀 Launching native Flask (port ${port})...`);

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
    console.log("Command: uv run python -m src.app\n");

    const proc = spawn("uv", ["run", "python", "-m", "src.app"], {
        cwd: dockerDir,
        env: envVars,
        stdio: "inherit",
    });

    // Graceful shutdown
    const cleanup = (): void => {
        console.log("\n\n🛑 Shutting down...");
        proc.kill("SIGTERM");
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    proc.on("error", (error: Error & { code?: string }) => {
        console.error(`\n❌ Failed to start native Flask: ${error.message}`);
        if (error.code === "ENOENT") {
            console.error("\nIs \"uv\" installed and in your PATH?");
            console.error("Install uv: https://docs.astral.sh/uv/getting-started/installation/");
        }
        process.exit(1);
    });

    proc.on("exit", (code) => {
        if (code !== 0 && code !== null) {
            console.error(`\n❌ Native Flask exited with code ${code}`);
        }
        process.exit(code || 0);
    });
}

/**
 * Launch Flask application in Docker production mode
 *
 * Runs production Docker container via docker-compose.
 *
 * @param envVars - Environment variables
 * @param options - Launch options
 */
function launchDocker(envVars: EnvVars, options: LaunchOptions): void {
    const port = options.port || 5003;
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
    console.log("Command: docker-compose up app\n");

    const proc = spawn("docker-compose", ["up", "app"], {
        cwd: dockerDir,
        env: envVars,
        stdio: "inherit",
    });

    // Graceful shutdown
    const cleanup = (): void => {
        console.log("\n\n🛑 Shutting down Docker container...");
        // Use docker-compose down for clean shutdown
        spawn("docker-compose", ["down"], {
            cwd: dockerDir,
            stdio: "inherit",
        });
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

/**
 * Launch Flask application in Docker development mode
 *
 * Runs Docker container with hot-reload enabled via docker-compose --profile dev.
 *
 * @param envVars - Environment variables
 * @param options - Launch options
 */
function launchDockerDev(envVars: EnvVars, options: LaunchOptions): void {
    const port = options.port || 5002;
    envVars.PORT = String(port);

    console.log(`🐳 Launching Docker development (port ${port}, hot-reload enabled)...`);

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
    console.log("Command: docker-compose --profile dev up app-dev\n");

    const proc = spawn("docker-compose", ["--profile", "dev", "up", "app-dev"], {
        cwd: dockerDir,
        env: envVars,
        stdio: "inherit",
    });

    // Graceful shutdown
    const cleanup = (): void => {
        console.log("\n\n🛑 Shutting down Docker dev container...");
        // Use docker-compose down for clean shutdown
        spawn("docker-compose", ["--profile", "dev", "down"], {
            cwd: dockerDir,
            stdio: "inherit",
        });
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

/**
 * Main entry point
 */
function main(): void {
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
            launchNative(envVars, options);
            break;
        case "docker":
            launchDocker(envVars, options);
            break;
        case "docker-dev":
            launchDockerDev(envVars, options);
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
    main();
}

// Export for testing
export { parseArguments, loadProfile, buildEnvVars, validateConfig, filterSecrets };
