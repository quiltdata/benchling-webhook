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
    .option("--catalog <url>", "Quilt catalog URL")
    .option("--bucket <name>", "S3 bucket for data")
    .option("--tenant <name>", "Benchling tenant")
    .option("--client-id <id>", "Benchling OAuth client ID")
    .option("--client-secret <secret>", "Benchling OAuth client secret")
    .option("--app-id <id>", "Benchling app definition ID")
    .option("--env-file <path>", "Path to .env file", ".env")
    .option("--no-bootstrap-check", "Skip CDK bootstrap verification")
    .option("--require-approval <level>", "CDK approval level", "never")
    .option("--profile <name>", "AWS profile to use")
    .option("--region <region>", "AWS region to deploy to")
    .option("--image-tag <tag>", "Docker image tag to deploy (default: latest)")
    .option("--yes", "Skip confirmation prompts")
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
