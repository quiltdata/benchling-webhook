#!/usr/bin/env node
/**
 * Validate Command
 *
 * Pure function to validate configuration.
 * Configuration data is passed in as parameters.
 */

import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { execSync } from "child_process";
import { runValidation } from "../../lib/wizard/phase4-validation";
import { checkCdkBootstrap } from "../benchling-webhook";
import type { ProfileConfig } from "../../lib/types/config";

interface ValidateOptions {
    config: ProfileConfig;
    profile: string;
    verbose?: boolean;
}

/**
 * Validate command - validates configuration passed in
 * This is a pure function - configuration must be passed in
 */
export async function validateCommand(options: ValidateOptions): Promise<void> {
    const { config, profile, verbose } = options;

    console.log(
        boxen(chalk.bold("Configuration Validation"), {
            padding: 1,
            borderColor: "yellow",
            borderStyle: "round",
        }),
    );
    console.log();

    const spinner = ora("Loading configuration...").start();
    spinner.succeed(`Configuration loaded from profile: ${profile}`);

    // Display configuration summary if verbose
    if (verbose) {
        console.log();
        console.log(chalk.bold("Configuration Summary:"));
        console.log(chalk.gray("─".repeat(80)));
        console.log();

        console.log(chalk.bold("Quilt:"));
        console.log(`  Catalog: ${config.quilt.catalog}`);
        console.log(`  Database: ${config.quilt.database}`);
        console.log(`  Queue URL: ${config.quilt.queueUrl}`);
        console.log(`  Region: ${config.quilt.region}`);
        console.log();

        console.log(chalk.bold("Benchling:"));
        console.log(`  Tenant: ${config.benchling.tenant}`);
        console.log(`  Client ID: ${config.benchling.clientId?.substring(0, 8)}...`);
        console.log(`  App Definition ID: ${config.benchling.appDefinitionId || "(not set)"}`);
        console.log();

        console.log(chalk.bold("Packages:"));
        console.log(`  Bucket: ${config.packages.bucket}`);
        console.log(`  Prefix: ${config.packages.prefix}`);
        console.log(`  Metadata Key: ${config.packages.metadataKey}`);
        console.log();

        console.log(chalk.bold("Deployment:"));
        console.log(`  Region: ${config.deployment.region}`);
        console.log(`  Account: ${config.deployment.account || "(not set)"}`);
        console.log(`  Mode: ${config.integratedStack ? "Integrated" : "Standalone"}`);
        console.log();
    }

    // Run validation checks (using wizard validation logic)
    console.log(chalk.bold("Running validation checks..."));
    console.log();

    const validationResult = await runValidation({
        stackQuery: {
            catalog: config.quilt.catalog,
            stackArn: config.quilt.stackArn || "",
            database: config.quilt.database,
            queueUrl: config.quilt.queueUrl,
            region: config.quilt.region,
            account: config.deployment.account || "",
            stackQuerySucceeded: true,
        },
        parameters: {
            benchling: {
                tenant: config.benchling.tenant,
                clientId: config.benchling.clientId || "",
                clientSecret: config.benchling.clientSecret || "",
                appDefinitionId: config.benchling.appDefinitionId,
            },
            packages: {
                bucket: config.packages.bucket,
                prefix: config.packages.prefix,
                metadataKey: config.packages.metadataKey,
            },
            deployment: {
                region: config.deployment.region,
                account: config.deployment.account || "",
            },
            logging: {
                level: (config.logging?.level || "INFO") as "DEBUG" | "INFO" | "WARNING" | "ERROR",
            },
            security: {
                enableVerification: config.security?.enableVerification ?? true,
                webhookAllowList: config.security?.webhookAllowList || "",
            },
        },
        awsProfile: undefined, // Use default AWS credentials
    });

    // Check AWS credentials
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

    // Check CDK bootstrap
    spinner.start("Checking CDK bootstrap status...");

    const bootstrapStatus = await checkCdkBootstrap(
        config.deployment.account || "",
        config.deployment.region,
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

    // Final result
    console.log();
    console.log(chalk.gray("─".repeat(80)));

    if (validationResult.success) {
        console.log();
        console.log(
            boxen(
                `${chalk.green.bold("✓ Configuration is valid!")}\n\n` +
          "Ready to deploy.\n\n" +
          `Run: ${chalk.cyan(`npx @quiltdata/benchling-webhook deploy --profile ${profile}`)}`,
                { padding: 1, borderColor: "green", borderStyle: "round" },
            ),
        );
    } else {
        console.log();
        console.error(chalk.red.bold("❌ Configuration is invalid\n"));

        if (validationResult.errors.length > 0) {
            console.error(chalk.red("Errors:"));
            validationResult.errors.forEach((err) => console.error(`  ${err}`));
            console.log();
        }

        if (validationResult.warnings.length > 0) {
            console.warn(chalk.yellow("Warnings:"));
            validationResult.warnings.forEach((warn) => console.warn(`  ${warn}`));
            console.log();
        }

        console.log(chalk.yellow("To fix this:"));
        console.log("  1. Run: " + chalk.cyan("npx @quiltdata/benchling-webhook@latest"));
        console.log("  2. Or manually edit: " + chalk.cyan(`~/.config/benchling-webhook/${profile}/config.json`));
        console.log();
        process.exit(1);
    }
}
