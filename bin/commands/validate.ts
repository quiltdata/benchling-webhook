import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { execSync } from "child_process";
import {
    loadConfigSync,
    mergeInferredConfig,
    validateConfig,
    formatValidationErrors,
    type ConfigOptions,
} from "../../lib/utils/config";
import {
    checkCdkBootstrap,
} from "../benchling-webhook";

export async function validateCommand(options: ConfigOptions & { verbose?: boolean }): Promise<void> {
    console.log(
        boxen(chalk.bold("Configuration Validation"), {
            padding: 1,
            borderColor: "yellow",
            borderStyle: "round",
        }),
    );
    console.log();

    // 1. Load configuration
    const spinner = ora("Loading configuration...").start();
    let config = loadConfigSync(options);
    spinner.succeed(`Configuration loaded from: ${options.envFile || ".env"}`);

    // 2. Inference is deprecated in secrets-only mode (v0.6.0+)
    // Configuration is now stored in AWS Secrets Manager and CloudFormation parameters

    // 3. Validate
    spinner.start("Validating configuration...");
    const validation = validateConfig(config);

    if (validation.valid) {
        spinner.succeed("Configuration is valid");
    } else {
        spinner.fail("Configuration validation failed");
    }

    // 4. Display results
    console.log();

    if (options.verbose || !validation.valid) {
        console.log(chalk.bold("Configuration Summary:"));
        console.log(chalk.gray("─".repeat(80)));
        console.log();

        // Required user values
        console.log(chalk.bold("Required user values:"));
        const userFields = [
            "quiltCatalog",
            "quiltUserBucket",
            "benchlingTenant",
            "benchlingClientId",
            "benchlingClientSecret",
            "benchlingAppDefinitionId",
        ];

        for (const field of userFields) {
            const value = config[field as keyof typeof config];
            const status = value ? chalk.green("✓") : chalk.red("✗");
            const display = value || chalk.gray("(not set)");
            console.log(`  ${status} ${field}: ${display}`);
        }
        console.log();

        // Inferred values
        console.log(chalk.bold("Inferred values:"));
        const inferredFields = [
            "cdkAccount",
            "cdkRegion",
            "queueName",
            "quiltDatabase",
        ];

        for (const field of inferredFields) {
            const value = config[field as keyof typeof config];
            const status = value ? chalk.green("✓") : chalk.red("✗");
            const display = value || chalk.gray("(could not infer)");
            console.log(`  ${status} ${field}: ${display}`);
        }
        console.log();
    }

    // 5. Check AWS credentials
    spinner.start("Checking AWS credentials...");
    try {
        const accountId = execSync("aws sts get-caller-identity --query Account --output text", {
            encoding: "utf-8",
        }).trim();
        spinner.succeed(`AWS credentials configured (account: ${accountId})`);
    } catch {
        spinner.fail("AWS credentials not configured");
        console.log();
        console.log(chalk.yellow("To configure AWS credentials, run:"));
        console.log(chalk.cyan("  aws configure"));
        console.log();
    }

    // 6. Check CDK bootstrap
    if (config.cdkAccount && config.cdkRegion) {
        spinner.start("Checking CDK bootstrap status...");

        const bootstrapStatus = await checkCdkBootstrap(
            config.cdkAccount,
            config.cdkRegion,
        );

        if (bootstrapStatus.bootstrapped) {
            spinner.succeed(`CDK is bootstrapped (${bootstrapStatus.status})`);
        } else {
            spinner.fail("CDK is not bootstrapped");
            console.log();
            console.log(chalk.yellow("To bootstrap CDK, run:"));
            console.log(chalk.cyan(`  ${bootstrapStatus.command}`));
            console.log();
        }
    }

    // 7. Final result
    console.log();
    console.log(chalk.gray("─".repeat(80)));

    if (validation.valid) {
        console.log();
        console.log(
            boxen(
                `${chalk.green.bold("✓ Configuration is valid!")}\n\n` +
          "Ready to deploy.\n\n" +
          `Run: ${chalk.cyan("npx @quiltdata/benchling-webhook deploy")}`,
                { padding: 1, borderColor: "green", borderStyle: "round" },
            ),
        );
    } else {
        console.log();
        console.error(chalk.red.bold("❌ Configuration is invalid\n"));
        console.error(formatValidationErrors(validation));
        console.log(chalk.yellow("To fix this:"));
        console.log("  1. Run: " + chalk.cyan("npx @quiltdata/benchling-webhook init"));
        console.log("  2. Or edit your .env file to add missing values");
        console.log();
        process.exit(1);
    }
}
