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
import { configShowCommand } from "./commands/config-show";
import { installCommand } from "./commands/install";
import { statusCommand } from "./commands/status";
import { logsCommand } from "./commands/logs";
import pkg from "../package.json";

const program = new Command();

program
    .name("benchling-webhook")
    .description(
        "Benchling Webhook Integration for Quilt - Deploy lab notebook integration to AWS\n\n" +
      "Run without arguments to install (setup + deploy)",
    )
    .version(pkg.version, "-v, --version", "Display version number")
    .helpOption("-h, --help", "Display help for command")
    .addHelpText(
        "after",
        `

Quick Start:
  1. Run interactive installer (setup + deploy):
     $ npx @quiltdata/benchling-webhook

  2. Setup only (skip deployment):
     $ npx @quiltdata/benchling-webhook --setup-only

  3. Non-interactive install:
     $ npx @quiltdata/benchling-webhook --yes

v0.7.0 Changes:
  - New unified configuration architecture with profile support
  - Profile-based deployment tracking (~/.config/benchling-webhook/{profile}/)
  - Independent --profile and --stage options for flexible deployments
  - Profile inheritance support for environment hierarchies

For upgrade instructions: https://github.com/quiltdata/benchling-webhook/blob/main/MIGRATION.md
`,
    );

// Deploy command
program
    .command("deploy")
    .description("Deploy the CDK stack to AWS")
    .option("--quilt-stack-arn <arn>", "ARN of Quilt CloudFormation stack")
    .option(
        "--benchling-secret <name>",
        "Name or ARN of Benchling secret in Secrets Manager",
    )
    .option("--env-file <path>", "Path to .env file", ".env")
// Multi-environment options (v0.7.0)
    .option("--config, --profile <name>", "Configuration profile to use (default: default)")
    .option("--stage <name>", "API Gateway stage: dev or prod (default: prod)")
// Common options
    .option("--no-bootstrap-check", "Skip CDK bootstrap verification")
    .option("--require-approval <level>", "CDK approval level", "never")
    .option("--region <region>", "AWS region to deploy to")
    .option("--image-tag <tag>", "Docker image tag to deploy (default: latest)")
    .option("--yes", "Skip confirmation prompts")
    .addHelpText(
        "after",
        `

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
`,
    )
    .action(async (options) => {
        try {
            await deployCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Setup command (for backward compatibility - setup only, no deploy)
program
    .command("setup")
    .description("Run setup wizard only (without deployment)")
    .option("--config, --profile <name>", "Configuration profile to use (default: default)")
    .option("--inherit-from <name>", "Base profile to inherit from")
    .option("--region <region>", "AWS region")
    .option("--aws-profile <name>", "AWS credentials profile")
    .action(async (options) => {
        try {
            await setupWizardCommand(options);
            process.exit(0);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Status command
program
    .command("status")
    .description(
        "Check CloudFormation stack status and BenchlingIntegration parameter",
    )
    .option(
        "--config, --profile <name>",
        "Configuration profile to check (default: default)",
    )
    .option("--aws-profile <name>", "AWS credentials profile")
    .option("--detailed", "Show detailed stack events")
    .option(
        "--timer <seconds>",
        "Auto-refresh interval in seconds (default: 10, use 0 or non-numeric to disable)",
        "10",
    )
    .option(
        "--no-exit",
        "Continue monitoring even after stack reaches terminal status",
    )
    .addHelpText(
        "after",
        `

Examples:
  Check status of default profile (auto-refreshes every 10 seconds):
    $ npx @quiltdata/benchling-webhook status

  Check status of specific profile:
    $ npx @quiltdata/benchling-webhook status --profile prod

  One-shot mode (no auto-refresh):
    $ npx @quiltdata/benchling-webhook status --timer 0

  Custom refresh interval (30 seconds):
    $ npx @quiltdata/benchling-webhook status --timer 30

  Continue monitoring even after completion:
    $ npx @quiltdata/benchling-webhook status --no-exit

Note: This command only works for integrated stack mode profiles.
By default, auto-refresh stops when stack reaches a terminal state (*_COMPLETE or *_FAILED).
Use --no-exit to keep monitoring indefinitely.
`,
    )
    .action(async (options) => {
        try {
            await statusCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Logs command
program
    .command("logs")
    .description("View CloudWatch logs from deployed webhook integration")
    .option("--config, --profile <name>", "Configuration profile to use (default: default)")
    .option("--aws-profile <name>", "AWS credentials profile")
    .option(
        "--type <type>",
        "Log group to view: all (default), ecs, api, api-exec",
        "all",
    )
    .option(
        "--since <time>",
        "Time period to fetch logs (examples: 5m, 1h, 2d)",
        "5m",
    )
    .option("--filter <pattern>", "Filter logs by pattern (example: ERROR)")
    .option("--limit <n>", "Number of log entries to show per log group (default: 5)", "5")
    .option("--timer <seconds>", "Auto-refresh interval in seconds (default: 10, use 0 to disable)", "10")
    .addHelpText(
        "after",
        `

Log Types:
  all       All log groups (ECS, API Gateway access, API Gateway execution)
  ecs       ECS container logs (application logs)
  api       API Gateway access logs (request/response info)
  api-exec  API Gateway execution logs (detailed debugging)

Examples:
  View all logs (auto-refreshes every 10 seconds):
    $ npx @quiltdata/benchling-webhook logs --profile sales

  View only ECS logs:
    $ npx @quiltdata/benchling-webhook logs --profile sales --type ecs

  Show last 10 entries per log group:
    $ npx @quiltdata/benchling-webhook logs --profile sales --limit 10

  Disable auto-refresh (single snapshot):
    $ npx @quiltdata/benchling-webhook logs --profile sales --timer 0

  Auto-refresh every 5 seconds:
    $ npx @quiltdata/benchling-webhook logs --profile sales --timer 5

  Filter for errors in last hour:
    $ npx @quiltdata/benchling-webhook logs --profile sales --since 1h --filter ERROR

  View last 2 days of API Gateway logs:
    $ npx @quiltdata/benchling-webhook logs --profile sales --type api --since 2d

For more information: https://github.com/quiltdata/benchling-webhook#viewing-logs
`,
    )
    .action(async (options) => {
        try {
            // Parse limit as integer
            if (options.limit) {
                options.limit = parseInt(options.limit, 10);
            }
            await logsCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Init command (legacy - redirects to setup wizard)
program
    .command("init")
    .description("Interactive setup wizard (alias for 'setup' command)")
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
    .option("--config, --profile <name>", "Configuration profile to validate", "default")
    .option("--verbose", "Show detailed validation information")
    .action(async (options) => {
        try {
            const { XDGConfig } = await import("../lib/xdg-config");
            const xdg = new XDGConfig();
            const profile = options.profile || "default";

            if (!xdg.profileExists(profile)) {
                console.error(chalk.red(`Profile does not exist: ${profile}`));
                console.log();
                console.log(chalk.yellow("To create a profile, run:"));
                console.log(chalk.cyan("  npx @quiltdata/benchling-webhook"));
                process.exit(1);
            }

            const config = xdg.readProfile(profile);
            await validateCommand({ config, profile, verbose: options.verbose });
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Test command
program
    .command("test")
    .description("Test the deployed webhook endpoint")
    .option(
        "--url <url>",
        "Webhook URL to test (auto-detected from stack if omitted)",
    )
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
    .option("--config, --profile <name>", "Configuration profile to use (optional)")
    .option("--catalog <url>", "Catalog URL to use (optional, overrides profile)")
    .action(async (options) => {
        try {
            let catalogUrl = options.catalog;

            // If catalog not provided directly, try to load from profile
            if (!catalogUrl && options.profile) {
                const { XDGConfig } = await import("../lib/xdg-config");
                const xdg = new XDGConfig();

                if (xdg.profileExists(options.profile)) {
                    const config = xdg.readProfile(options.profile);
                    catalogUrl = config.quilt.catalog;
                }
            }

            await manifestCommand({ output: options.output, catalog: catalogUrl });
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
    .addHelpText(
        "after",
        `

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
`,
    )
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
    .option("--config, --profile <name>", "Configuration profile to check", "default")
    .option("--json", "Output in JSON format")
    .action(async (options) => {
        try {
            await healthCheckCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Config show command (for Python interop)
program
    .command("config")
    .description("Show configuration for a profile as JSON")
    .option("--config-name, --profile <name>", "Configuration profile to show", "default")
    .action(async (options) => {
        try {
            await configShowCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Run install command when no command provided (but not for help/version flags)
const args = process.argv.slice(2);
const isHelpOrVersion = args.some(
    (arg) =>
        arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v",
);

if (
    !args.length ||
  (args.length > 0 && args[0].startsWith("--") && !isHelpOrVersion)
) {
    // Parse options for install command
    const options: {
    yes?: boolean;
    profile?: string;
    inheritFrom?: string;
    awsRegion?: string;
    awsProfile?: string;
    setupOnly?: boolean;
    skipValidation?: boolean;
  } = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--yes" || args[i] === "-y") {
            options.yes = true;
        } else if (args[i] === "--setup-only") {
            options.setupOnly = true;
        } else if ((args[i] === "--profile" || args[i] === "--config") && i + 1 < args.length) {
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
        } else if (args[i] === "--skip-validation") {
            options.skipValidation = true;
        }
    }

    installCommand(options)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        });
} else {
    program.parse();
}
