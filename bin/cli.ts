#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { deployCommand } from "./commands/deploy";
import { initCommand } from "./commands/init";
import { validateCommand } from "./commands/validate";
import { testCommand } from "./commands/test";
import { manifestCommand } from "./commands/manifest";
import { setupWizardCommand } from "./commands/setup-wizard";
import { setupProfileCommand } from "./commands/setup-profile";
import { healthCheckCommand } from "./commands/health-check";

// Load package.json for version
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../package.json");

const program = new Command();

program
    .name("benchling-webhook")
    .description("Benchling Webhook Integration for Quilt - Deploy lab notebook integration to AWS\n\n" +
                 "Run without arguments for interactive setup wizard")
    .version(pkg.version, "-v, --version", "Display version number")
    .helpOption("-h, --help", "Display help for command")
    .addHelpText("after", `

Quick Start:
  1. Run interactive setup:
     $ npx @quiltdata/benchling-webhook

  2. Deploy to AWS:
     $ npx @quiltdata/benchling-webhook deploy

v0.7.0 Changes:
  - New unified configuration architecture with profile support
  - Profile-based deployment tracking (~/.config/benchling-webhook/{profile}/)
  - Independent --profile and --stage options for flexible deployments
  - Profile inheritance support for environment hierarchies

For upgrade instructions: https://github.com/quiltdata/benchling-webhook/blob/main/MIGRATION.md
`);

// Deploy command
program
    .command("deploy")
    .description("Deploy the CDK stack to AWS")
    .option("--quilt-stack-arn <arn>", "ARN of Quilt CloudFormation stack")
    .option("--benchling-secret <name>", "Name or ARN of Benchling secret in Secrets Manager")
    .option("--env-file <path>", "Path to .env file", ".env")
    // Multi-environment options (v0.7.0)
    .option("--profile <name>", "Configuration profile to use (default: default)")
    .option("--stage <name>", "API Gateway stage: dev or prod (default: prod)")
    // Common options
    .option("--no-bootstrap-check", "Skip CDK bootstrap verification")
    .option("--require-approval <level>", "CDK approval level", "never")
    .option("--region <region>", "AWS region to deploy to")
    .option("--image-tag <tag>", "Docker image tag to deploy (default: latest)")
    .option("--yes", "Skip confirmation prompts")
    .addHelpText("after", `

Examples:
  Deploy to production with default profile:
    $ npx @quiltdata/benchling-webhook deploy \\
        --quilt-stack-arn "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc123"

  Deploy to dev stage with dev profile:
    $ npx @quiltdata/benchling-webhook deploy \\
        --profile dev --stage dev

  Deploy to prod with custom image tag:
    $ npx @quiltdata/benchling-webhook deploy \\
        --stage prod --image-tag "0.7.0"

For more information: https://github.com/quiltdata/benchling-webhook#deployment
`)
    .action(async (options) => {
        try {
            await deployCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Init command (legacy - redirects to setup wizard)
program
    .command("init")
    .description("Interactive setup wizard (alias for running without arguments)")
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

// Setup profile command (v0.7.0)
program
    .command("setup-profile <name>")
    .description("Create a new configuration profile with optional inheritance")
    .option("--inherit-from <profile>", "Base profile to inherit from", "default")
    .option("--force", "Overwrite existing profile without prompting")
    .addHelpText("after", `

Examples:
  Create dev profile inheriting from default:
    $ npx @quiltdata/benchling-webhook setup-profile dev

  Create staging profile inheriting from prod:
    $ npx @quiltdata/benchling-webhook setup-profile staging --inherit-from prod

Profile inheritance allows you to:
  - Reuse common settings across environments
  - Override only environment-specific values
  - Maintain a single source of truth for shared configuration

For more information: https://github.com/quiltdata/benchling-webhook#multi-environment-setup
`)
    .action(async (name, options) => {
        try {
            await setupProfileCommand(name, options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Health check command
program
    .command("health-check")
    .description("Check configuration health and secrets sync status")
    .option("--profile <name>", "Configuration profile to check", "default")
    .option("--json", "Output in JSON format")
    .action(async (options) => {
        try {
            await healthCheckCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Run setup wizard when no command provided (but not for help/version flags)
const args = process.argv.slice(2);
const isHelpOrVersion = args.some(arg => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v");

if ((!args.length || (args.length > 0 && args[0].startsWith("--") && !isHelpOrVersion))) {
    // Parse options for setup wizard
    const options: { nonInteractive?: boolean; profile?: string; inheritFrom?: string; awsRegion?: string; awsProfile?: string } = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--yes" || args[i] === "-y") {
            options.nonInteractive = true;
        } else if (args[i] === "--profile" && i + 1 < args.length) {
            options.profile = args[i + 1];
            i++;
        } else if (args[i] === "--inherit-from" && i + 1 < args.length) {
            options.inheritFrom = args[i + 1];
            i++;
        } else if (args[i] === "--region" && i + 1 < args.length) {
            options.awsRegion = args[i + 1];
            i++;
        } else if (args[i] === "--aws-profile" && i + 1 < args.length) {
            options.awsProfile = args[i + 1];
            i++;
        }
    }

    setupWizardCommand(options)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        });
} else {
    program.parse();
}
