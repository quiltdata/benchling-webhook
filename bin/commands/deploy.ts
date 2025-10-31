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
    maskArn,
    type Config,
    type ConfigOptions,
} from "../../lib/utils/config";
import {
    parseAndValidateSecrets,
    SecretsValidationError,
} from "../../lib/utils/secrets";
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

    // 2a. Validate benchling-secrets if provided (Episode 7)
    if (config.benchlingSecrets) {
        spinner.text = "Validating Benchling secrets...";

        try {
            const secretsConfig = parseAndValidateSecrets(config.benchlingSecrets);

            // Episode 10: Display secret source and format
            if (secretsConfig.format === "arn") {
                spinner.info(`Using Benchling secrets from ARN: ${maskArn(secretsConfig.arn!)}`);
            } else {
                spinner.info("Using Benchling secrets from JSON configuration");
            }

            // Episode 8: Check for deprecated parameter usage
            const hasOldParams = !!(
                config.benchlingTenant ||
                config.benchlingClientId ||
                config.benchlingClientSecret
            );

            if (hasOldParams) {
                spinner.warn("Both --benchling-secrets and individual secret parameters provided");
                console.log(chalk.yellow("\n  ⚠ DEPRECATION WARNING:"));
                console.log(chalk.yellow("  Individual secret parameters (--tenant, --client-id, --client-secret) are deprecated."));
                console.log(chalk.yellow("  The --benchling-secrets parameter will take precedence.\n"));
                console.log(chalk.dim("  Migration guide: https://github.com/quiltdata/benchling-webhook#secrets-configuration\n"));

                // Clear old parameters to avoid confusion
                config.benchlingTenant = undefined as unknown as string;
                config.benchlingClientId = undefined as unknown as string;
                config.benchlingClientSecret = undefined as unknown as string;
                config.benchlingAppDefinitionId = undefined as unknown as string;
            }

            spinner.start("Validating configuration...");
        } catch (error) {
            spinner.fail("Secret validation failed");
            console.log();

            if (error instanceof SecretsValidationError) {
                console.error(chalk.red.bold("❌ Benchling Secrets Error\n"));
                console.error(error.formatForCLI());
                console.log(chalk.yellow("Secrets format:"));
                console.log("  ARN:  arn:aws:secretsmanager:region:account:secret:name");
                console.log("  JSON: {\"client_id\":\"...\",\"client_secret\":\"...\",\"tenant\":\"...\"}");
                console.log("  File: @secrets.json\n");
            } else {
                console.error(chalk.red((error as Error).message));
            }

            process.exit(1);
        }
    } else {
        spinner.start("Validating configuration...");
    }

    // 3. Validate configuration
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
    console.log(`  ${chalk.bold("Stack:")}                      BenchlingWebhookStack`);
    console.log(`  ${chalk.bold("Account:")}                    ${config.cdkAccount}`);
    console.log(`  ${chalk.bold("Region:")}                     ${config.cdkRegion}`);
    console.log();
    console.log(chalk.bold("  Stack Parameters:"));
    console.log(`    ${chalk.bold("Quilt Catalog:")}            ${config.quiltCatalog}`);
    console.log(`    ${chalk.bold("Quilt Database:")}           ${config.quiltDatabase}`);
    console.log(`    ${chalk.bold("Quilt User Bucket:")}        ${config.quiltUserBucket}`);

    // Episode 9: Display Benchling configuration based on new or old parameters
    if (config.benchlingSecrets) {
        try {
            const secretsConfig = parseAndValidateSecrets(config.benchlingSecrets);

            if (secretsConfig.format === "arn") {
                console.log(`    ${chalk.bold("Benchling Secrets:")}        ARN (${maskArn(secretsConfig.arn!)})`);
            } else {
                // Display from parsed JSON
                console.log(`    ${chalk.bold("Benchling Tenant:")}         ${secretsConfig.data!.tenant}`);
                console.log(`    ${chalk.bold("Benchling Client ID:")}      ${secretsConfig.data!.client_id}`);
                console.log(`    ${chalk.bold("Benchling Client Secret:")}  ***${secretsConfig.data!.client_secret.slice(-4)}`);
                if (secretsConfig.data!.app_definition_id) {
                    console.log(`    ${chalk.bold("Benchling App ID:")}        ${secretsConfig.data!.app_definition_id}`);
                }
            }
        } catch {
            // Validation already passed, so this shouldn't happen, but fall back to old display
            console.log(`    ${chalk.bold("Benchling Secrets:")}        (configured)`);
        }
    } else {
        // Fallback to individual parameters (deprecated path)
        console.log(`    ${chalk.bold("Benchling Tenant:")}         ${config.benchlingTenant}`);
        console.log(`    ${chalk.bold("Benchling Client ID:")}      ${config.benchlingClientId}`);
        console.log(`    ${chalk.bold("Benchling Client Secret:")}  ${config.benchlingClientSecret ? "***" + config.benchlingClientSecret.slice(-4) : "(not set)"}`);
        if (config.benchlingAppDefinitionId) {
            console.log(`    ${chalk.bold("Benchling App ID:")}        ${config.benchlingAppDefinitionId}`);
        }
    }
    console.log(`    ${chalk.bold("Queue ARN:")}                ${config.queueArn}`);
    console.log(`    ${chalk.bold("Package Prefix:")}           ${config.pkgPrefix || "benchling"}`);
    console.log(`    ${chalk.bold("Package Key:")}              ${config.pkgKey || "experiment_id"}`);
    console.log(`    ${chalk.bold("Log Level:")}                ${config.logLevel || "INFO"}`);
    if (config.webhookAllowList) {
        console.log(`    ${chalk.bold("Webhook Allow List:")}      ${config.webhookAllowList}`);
    }
    console.log(`    ${chalk.bold("Webhook Verification:")}    ${config.enableWebhookVerification ?? "true"}`);
    console.log(`    ${chalk.bold("Create ECR Repository:")}   ${config.createEcrRepository || "false"}`);
    console.log(`    ${chalk.bold("ECR Repository Name:")}     ${config.ecrRepositoryName || "quiltdata/benchling"}`);
    console.log(`    ${chalk.bold("Docker Image Tag:")}        ${config.imageTag || "latest"}`);
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

        // Build CloudFormation parameters to pass explicitly
        const parameters = [
            `ImageTag=${config.imageTag || "latest"}`,
            `BucketName=${config.quiltUserBucket}`,
            `PackagePrefix=${config.pkgPrefix || "benchling"}`,
            `PackageKey=${config.pkgKey || "experiment_id"}`,
            `QueueArn=${config.queueArn}`,
            `QuiltDatabase=${config.quiltDatabase}`,
            `LogLevel=${config.logLevel || "INFO"}`,
            `EnableWebhookVerification=${config.enableWebhookVerification ?? "true"}`,
            `QuiltCatalog=${config.quiltCatalog || "open.quiltdata.com"}`,
            `WebhookAllowList=${config.webhookAllowList || ""}`,
        ];

        // Add Benchling secrets parameter based on configuration
        if (config.benchlingSecrets) {
            // New parameter: consolidated secrets
            parameters.push(`BenchlingSecrets=${config.benchlingSecrets}`);
        } else {
            // Old parameters: individual values (deprecated but supported)
            parameters.push(`BenchlingTenant=${config.benchlingTenant || ""}`);
            parameters.push(`BenchlingClientId=${config.benchlingClientId || ""}`);
            parameters.push(`BenchlingClientSecret=${config.benchlingClientSecret || ""}`);
        }

        const parametersArg = parameters.map(p => `--parameters ${p}`).join(" ");
        const cdkCommand = `npx cdk deploy --require-approval ${options.requireApproval || "never"} ${parametersArg}`;

        execSync(cdkCommand, {
            stdio: "inherit",
            env: {
                ...process.env,
                CDK_DEFAULT_ACCOUNT: config.cdkAccount,
                CDK_DEFAULT_REGION: config.cdkRegion,
            },
        });

        spinner.succeed("Stack deployed successfully");

        // 9. Get stack outputs
        spinner.start("Retrieving stack outputs...");
        let webhookUrl = "";
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { CloudFormationClient, DescribeStacksCommand } = require("@aws-sdk/client-cloudformation");
            const cloudformation = new CloudFormationClient({
                region: config.cdkRegion,
            });

            const command = new DescribeStacksCommand({
                StackName: "BenchlingWebhookStack",
            });
            const response = await cloudformation.send(command);

            if (response.Stacks && response.Stacks.length > 0) {
                const stack = response.Stacks[0];
                const output = stack.Outputs?.find((o: { OutputKey?: string }) => o.OutputKey === "WebhookEndpoint");
                webhookUrl = output?.OutputValue || "";
            }
            spinner.succeed("Stack outputs retrieved");
        } catch {
            spinner.warn("Could not retrieve stack outputs");
        }

        // 10. Test the webhook endpoint
        if (webhookUrl) {
            console.log();
            spinner.start("Testing webhook endpoint...");
            try {
                const testCmd = `curl -s -w "\\n%{http_code}" "${webhookUrl}/health"`;
                const testResult = execSync(testCmd, { encoding: "utf-8", timeout: 10000 });
                const lines = testResult.trim().split("\n");
                const statusCode = lines[lines.length - 1];

                if (statusCode === "200") {
                    spinner.succeed("Webhook health check passed");
                } else {
                    spinner.warn(`Webhook returned HTTP ${statusCode}`);
                }
            } catch {
                spinner.warn("Could not test webhook endpoint");
            }
        }

        // 11. Success message
        console.log();
        console.log(
            boxen(
                `${chalk.green.bold("✓ Deployment completed successfully!")}\n\n` +
          `Stack:  ${chalk.cyan(result.stackName)}\n` +
          `Region: ${chalk.cyan(config.cdkRegion)}\n` +
          (webhookUrl ? `Webhook URL: ${chalk.cyan(webhookUrl)}\n\n` : "\n") +
          `${chalk.bold("Next steps:")}\n` +
          "  1. Set the webhook URL in your Benchling app settings:\n" +
          `     ${chalk.cyan(webhookUrl || "<WEBHOOK_URL>")}\n\n` +
          "  2. Test the integration by creating a Quilt package in Benchling\n\n" +
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
