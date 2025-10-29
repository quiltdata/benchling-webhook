import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { prompt } from "enquirer";
import {
    loadConfigSync,
    mergeInferredConfig,
    validateConfig,
    formatValidationErrors,
    type Config,
    type ConfigOptions,
} from "../../lib/utils/config";
import {
    checkCdkBootstrap,
    inferConfiguration,
    createStack,
} from "../benchling-webhook";

export async function deployCommand(options: ConfigOptions & { yes?: boolean; bootstrapCheck?: boolean; requireApproval?: string }): Promise<void> {
    console.log(
        boxen(chalk.bold("Benchling Webhook Deployment"), {
            padding: 1,
            borderColor: "blue",
            borderStyle: "round",
        }),
    );
    console.log();

    // 1. Load configuration
    const spinner = ora("Loading configuration...").start();
    let config = loadConfigSync(options);

    // 2. Attempt inference if catalog is available
    if (config.quiltCatalog) {
        spinner.text = "Inferring configuration from catalog...";

        const inferenceResult = await inferConfiguration(config.quiltCatalog);

        if (inferenceResult.success) {
            config = mergeInferredConfig(config, inferenceResult.inferredVars);
            spinner.succeed("Configuration loaded and inferred");
        } else {
            spinner.warn(`Configuration loaded (inference failed: ${inferenceResult.error})`);
        }
    } else {
        spinner.succeed("Configuration loaded");
    }

    // 3. Validate configuration
    spinner.start("Validating configuration...");
    const validation = validateConfig(config);

    if (!validation.valid) {
        spinner.fail("Configuration validation failed");
        console.log();
        console.error(chalk.red.bold("❌ Configuration Error\n"));
        console.error(formatValidationErrors(validation));
        console.log(chalk.yellow("To fix this, you can:"));
        console.log("  1. Run interactive setup: " + chalk.cyan("npx @quiltdata/benchling-webhook init"));
        console.log("  2. Create/edit .env file with required values");
        console.log("  3. Pass values as CLI options");
        console.log();
        console.log("For help: " + chalk.cyan("npx @quiltdata/benchling-webhook --help"));
        process.exit(1);
    }

    spinner.succeed("Configuration validated");

    if (validation.warnings.length > 0) {
        console.log();
        for (const warning of validation.warnings) {
            console.log(chalk.yellow(`  ⚠ ${warning}`));
        }
    }

    // 4. Check CDK bootstrap
    if (options.bootstrapCheck !== false) {
        spinner.start("Checking CDK bootstrap status...");

        const bootstrapStatus = await checkCdkBootstrap(
            config.cdkAccount!,
            config.cdkRegion!,
        );

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

    // 5. Display deployment plan
    console.log();
    console.log(chalk.bold("Deployment Plan"));
    console.log(chalk.gray("─".repeat(80)));
    console.log(`  ${chalk.bold("Stack:")}    BenchlingWebhookStack`);
    console.log(`  ${chalk.bold("Account:")}  ${config.cdkAccount}`);
    console.log(`  ${chalk.bold("Region:")}   ${config.cdkRegion}`);
    console.log(`  ${chalk.bold("Catalog:")}  ${config.quiltCatalog}`);
    console.log(`  ${chalk.bold("Bucket:")}   ${config.quiltUserBucket}`);
    console.log(chalk.gray("─".repeat(80)));
    console.log();

    // 6. Confirm (unless --yes)
    if (!options.yes) {
        const response: { proceed: boolean } = await prompt({
            type: "confirm",
            name: "proceed",
            message: "Proceed with deployment?",
            initial: true,
        });

        if (!response.proceed) {
            console.log(chalk.yellow("Deployment cancelled"));
            process.exit(0);
        }
        console.log();
    }

    // 7. Create stack (synthesis)
    spinner.start("Synthesizing CDK stack...");
    try {
        const result = createStack(config as Config);
        spinner.succeed("Stack synthesized");

        // 8. Deploy using CDK CLI
        spinner.start("Deploying to AWS (this may take a few minutes)...");
        spinner.stop(); // Stop spinner for CDK output
        console.log(); // New line for CDK output

        // Execute CDK deploy directly - the app.synth() will be called by CDK
        // We need to synthesize to cdk.out and then deploy
        result.app.synth();

        const cdkCommand = `npx cdk deploy --require-approval ${options.requireApproval || "never"} --app cdk.out`;

        execSync(cdkCommand, {
            stdio: "inherit",
            env: {
                ...process.env,
                CDK_DEFAULT_ACCOUNT: config.cdkAccount,
                CDK_DEFAULT_REGION: config.cdkRegion,
            },
        });

        spinner.succeed("Stack deployed successfully");

        // 9. Success message
        console.log();
        console.log(
            boxen(
                `${chalk.green.bold("✓ Deployment completed successfully!")}\n\n` +
          `Stack:  ${chalk.cyan(result.stackName)}\n` +
          `Region: ${chalk.cyan(config.cdkRegion)}\n\n` +
          `${chalk.bold("Next steps:")}\n` +
          "  1. Configure your Benchling app\n" +
          "  2. Set the webhook URL from AWS console\n" +
          "  3. Test the integration\n\n" +
          `${chalk.dim("For more info: https://github.com/quiltdata/benchling-webhook#readme")}`,
                { padding: 1, borderColor: "green", borderStyle: "round" },
            ),
        );
    } catch (error) {
        spinner.fail("Deployment failed");
        console.error();
        console.error(chalk.red((error as Error).message));
        process.exit(1);
    }
}
