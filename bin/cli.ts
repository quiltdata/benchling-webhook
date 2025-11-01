#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { deployCommand } from "./commands/deploy";
import { initCommand } from "./commands/init";
import { validateCommand } from "./commands/validate";
import { testCommand } from "./commands/test";
import { manifestCommand } from "./commands/manifest";

// Load package.json for version
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../package.json");

const program = new Command();

program
    .name("benchling-webhook")
    .description("Benchling Webhook Integration for Quilt - Deploy lab notebook integration to AWS")
    .version(pkg.version, "-v, --version", "Display version number")
    .helpOption("-h, --help", "Display help for command");

// Deploy command (default)
program
    .command("deploy", { isDefault: true })
    .description("Deploy the CDK stack to AWS")
    // Secrets-only mode (v0.6.0+)
    .option("--quilt-stack-arn <arn>", "ARN of Quilt CloudFormation stack (enables secrets-only mode)")
    .option("--benchling-secret <name>", "Name or ARN of Benchling secret in Secrets Manager (enables secrets-only mode)")
    // Legacy mode options
    .option("--catalog <url>", "Quilt catalog URL (legacy mode)")
    .option("--bucket <name>", "S3 bucket for data (legacy mode)")
    .option("--benchling-secrets <value>", "Benchling secrets configuration (ARN, JSON, or @file) (legacy mode)")
    .option("--tenant <name>", "Benchling tenant (deprecated, use --benchling-secrets or secrets-only mode)")
    .option("--client-id <id>", "Benchling OAuth client ID (deprecated, use --benchling-secrets or secrets-only mode)")
    .option("--client-secret <secret>", "Benchling OAuth client secret (deprecated, use --benchling-secrets or secrets-only mode)")
    .option("--app-id <id>", "Benchling app definition ID (deprecated, use --benchling-secrets or secrets-only mode)")
    .option("--env-file <path>", "Path to .env file", ".env")
    // Common options
    .option("--no-bootstrap-check", "Skip CDK bootstrap verification")
    .option("--require-approval <level>", "CDK approval level", "never")
    .option("--profile <name>", "AWS profile to use")
    .option("--region <region>", "AWS region to deploy to")
    .option("--image-tag <tag>", "Docker image tag to deploy (default: latest)")
    .option("--yes", "Skip confirmation prompts")
    .addHelpText("after", `
Examples:
  Secrets-Only Mode (v0.6.0+ - Recommended):
    $ npx @quiltdata/benchling-webhook deploy \\
        --quilt-stack-arn "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc123" \\
        --benchling-secret "my-benchling-credentials"

  Legacy Mode (using Secrets Manager ARN):
    $ npx @quiltdata/benchling-webhook deploy --benchling-secrets "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-credentials"

  Legacy Mode (using inline JSON):
    $ npx @quiltdata/benchling-webhook deploy --benchling-secrets '{"client_id":"xxx","client_secret":"yyy","tenant":"company"}'

  Legacy Mode (using JSON file):
    $ npx @quiltdata/benchling-webhook deploy --benchling-secrets @secrets.json

For more information: https://github.com/quiltdata/benchling-webhook#secrets-configuration
`)
    .action(async (options) => {
        try {
            await deployCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Init command
program
    .command("init")
    .description("Initialize configuration interactively")
    .option("--output <path>", "Output file path", ".env")
    .option("--force", "Overwrite existing file")
    .option("--minimal", "Only prompt for required values")
    .option("--infer", "Attempt to infer values from catalog")
    .action(async (options) => {
        try {
            await initCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Validate command
program
    .command("validate")
    .description("Validate configuration without deploying")
    .option("--env-file <path>", "Path to .env file", ".env")
    .option("--verbose", "Show detailed validation information")
    .action(async (options) => {
        try {
            await validateCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Test command
program
    .command("test")
    .description("Test the deployed webhook endpoint")
    .option("--url <url>", "Webhook URL to test (auto-detected from stack if omitted)")
    .action(async (options) => {
        try {
            await testCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Manifest command
program
    .command("manifest")
    .description("Generate Benchling app manifest file")
    .option("--output <path>", "Output file path", "app-manifest.yaml")
    .action(async (options) => {
        try {
            await manifestCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Show help when no command provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}

program.parse();
