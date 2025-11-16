# CORRECTED NPX UX Specification (v0.7.0)

**Date**: 2025-11-03
**Status**: FINAL - Ready for Implementation
**Branch**: `npx-ux`

---

## Critical Corrections

### 1. ❌ NO `~/.quilt3/config.yml` File

**WRONG** (previous specs): Read `~/.quilt3/config.yml` and parse YAML

**CORRECT**: Use `quilt3 config` CLI command which returns catalog URL directly:

```bash
$ quilt3 config
https://my-catalog.quiltdata.com
```

### 2. 🎯 Default Behavior = Setup

**WRONG** (previous specs): Default to `deploy` command, require explicit `setup`

**CORRECT**: Running `npx @quiltdata/benchling-webhook` **without any command** should run the setup wizard:

```bash
$ npx @quiltdata/benchling-webhook
# Automatically runs setup wizard
```

### 3. 📖 README = Simple User Experience Only

**WRONG** (previous specs): Document power user commands, CI/CD, multiple workflows

**CORRECT**: README focuses ONLY on the simple setup experience. Advanced options go in CLAUDE.md (developer docs).

### 4. 🎯 Focus = End Users Only

**WRONG** (previous specs): Design for power users, CI/CD, multiple personas

**CORRECT**: Design for ONE persona - **the end user who wants it to just work**.

---

## Simplified Command Architecture

### Primary Command (99% of users)

```bash
npx @quiltdata/benchling-webhook
# OR
npx @quiltdata/benchling-webhook setup
```

**What it does**:
1. Generate manifest
2. [PAUSE] Wait for user to upload to Benchling
3. Auto-detect Quilt config via `quilt3 config` CLI
4. Prompt for Benchling credentials
5. Validate credentials
6. Deploy to AWS
7. [PAUSE] Wait for user to configure webhook URL
8. Test integration
9. Success!

### Internal Commands (for wizard to use)

These are NOT documented in README, only used internally by setup wizard:

- `init` - Generate manifest (called by setup)
- `deploy` - Deploy stack (called by setup)
- `test` - Verify webhook (called by setup)
- `logs` - Stream logs (for debugging only, not in setup flow)

---

## Corrected Helper Module: `infer-quilt.ts`

```typescript
import { execSync } from "child_process";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";

export interface QuiltConfig {
    success: boolean;
    catalogUrl?: string;
    bucket?: string;
    region?: string;
    stackName?: string;
    stackArn?: string;
    sqsQueueArn?: string;
    athenaDatabase?: string;
    error?: string;
}

export async function inferQuiltConfig(): Promise<QuiltConfig> {
    try {
        // 1. Get catalog URL from quilt3 CLI
        let catalogUrl: string;
        try {
            catalogUrl = execSync("quilt3 config", { encoding: "utf-8" }).trim();
        } catch (error) {
            return {
                success: false,
                error: "Could not run 'quilt3 config'. Is quilt3 installed? (pip install quilt3)"
            };
        }

        if (!catalogUrl || !catalogUrl.startsWith("http")) {
            return {
                success: false,
                error: "No catalog URL configured. Run: quilt3 catalog <catalog-url>"
            };
        }

        // 2. Find CloudFormation stack with matching catalog
        const cfn = new CloudFormationClient({});
        const stacksResponse = await cfn.send(new DescribeStacksCommand({}));

        const quiltStack = stacksResponse.Stacks?.find(stack => {
            const catalogOutput = stack.Outputs?.find(o => o.OutputKey === "CatalogUrl");
            return catalogOutput?.OutputValue === catalogUrl;
        });

        if (!quiltStack) {
            return {
                success: false,
                error: `No CloudFormation stack found for catalog: ${catalogUrl}\n` +
                       `Make sure your Quilt stack is deployed in the same AWS account/region.`
            };
        }

        // 3. Extract outputs
        const getOutput = (key: string) =>
            quiltStack.Outputs?.find(o => o.OutputKey === key)?.OutputValue;

        return {
            success: true,
            catalogUrl,
            bucket: getOutput("BucketName"),
            region: quiltStack.StackId?.split(":")[3],
            stackName: quiltStack.StackName,
            stackArn: quiltStack.StackId,
            sqsQueueArn: getOutput("QueueArn"),
            athenaDatabase: getOutput("AthenaDatabase")
        };
    } catch (error) {
        return {
            success: false,
            error: `Failed to infer Quilt config: ${(error as Error).message}`
        };
    }
}
```

---

## Simplified README.md

```markdown
# Benchling Webhook Integration for Quilt

Connect Benchling lab notebook entries to Quilt data packages via webhooks.

## Prerequisites

- Benchling account with app creation permissions
- AWS account with admin permissions
- AWS CLI configured with credentials
- Quilt stack deployed in AWS
- Python 3.8+ with `quilt3` installed

## Setup

Run the setup wizard:

```bash
npx @quiltdata/benchling-webhook@latest
```

The wizard will guide you through:

1. **Generate Manifest** - Creates `app-manifest.yaml` for your Benchling app

2. **Create Benchling App** (Manual step in browser)
   - Upload manifest to Benchling Developer Console
   - Copy your App Definition ID
   - Generate OAuth credentials

3. **Deploy to AWS** (Automated)
   - Auto-detects your Quilt configuration
   - Validates Benchling credentials
   - Deploys webhook to AWS
   - Returns webhook URL

4. **Configure Benchling App** (Manual step in browser)
   - Set webhook URL in app settings
   - Install app in your tenant

5. **Test Integration** (Automated)
   - Verifies webhook receives events
   - Shows recent activity

That's it! 🎉

### What If Something Goes Wrong?

The wizard validates everything before deploying, so errors are caught early with clear instructions on how to fix them.

**Common issues**:

- **"Could not run quilt3 config"** → Install quilt3: `pip install quilt3`
- **"No catalog URL configured"** → Configure quilt: `quilt3 catalog <your-catalog-url>`
- **"Benchling credential validation failed"** → Check client ID and secret are correct
- **"No events received"** → Make sure you installed the app and granted it project access

For detailed logs: `npx @quiltdata/benchling-webhook@latest logs`

## Usage

In Benchling:
1. Create or open notebook entry
2. Insert Canvas → "Quilt Integration"
3. Create or update package

Data is automatically synced to your Quilt catalog!

## Updating

To update your deployment:

```bash
npx @quiltdata/benchling-webhook@latest
```

The wizard will detect your existing setup and offer to update it.

## Support

- 🐛 [Report Issues](https://github.com/quiltdata/benchling-webhook/issues)
- 📖 [Documentation](./docs/)
- 💬 [Discussions](https://github.com/quiltdata/benchling-webhook/discussions)

## License

Apache-2.0

---

**For contributors and advanced usage**, see [CLAUDE.md](./CLAUDE.md)
```

---

## Corrected CLI Entry Point

```typescript
// bin/cli.ts

#!/usr/bin/env node

import { Command } from "commander";
import { setupCommand } from "./commands/setup";
import { manifestCommand } from "./commands/manifest";
import { deployCommand } from "./commands/deploy";
import { testCommand } from "./commands/test";
import { logsCommand } from "./commands/logs";

const pkg = require("../package.json");

const program = new Command();

program
    .name("benchling-webhook")
    .description("Benchling webhook integration for Quilt")
    .version(pkg.version);

// DEFAULT ACTION: Run setup wizard
program
    .action(async () => {
        await setupCommand({});
    });

// Explicit setup command (same as default)
program
    .command("setup")
    .description("Interactive setup wizard (default)")
    .option("--skip-test", "Skip webhook testing phase")
    .option("--save", "Save configuration locally")
    .action(async (options) => {
        await setupCommand(options);
    });

// Internal commands (used by setup, but can be called directly)
program
    .command("init")
    .description("Generate Benchling app manifest")
    .option("--output <path>", "Output path", "app-manifest.yaml")
    .action(manifestCommand);

program
    .command("deploy")
    .description("Deploy webhook stack to AWS")
    .option("--quilt-stack-arn <arn>", "Quilt CloudFormation stack ARN")
    .option("--benchling-secret <name>", "Benchling secret name/ARN")
    .option("--region <region>", "AWS region")
    .option("--yes", "Skip confirmation")
    .action(deployCommand);

program
    .command("test")
    .description("Verify webhook health")
    .option("--region <region>", "AWS region")
    .option("--wait", "Wait for events")
    .option("--timeout <seconds>", "Wait timeout", "60")
    .action(testCommand);

program
    .command("logs")
    .description("Stream CloudWatch logs")
    .option("-f, --follow", "Follow log output")
    .option("--since <time>", "Show logs since (e.g., 5m, 1h)")
    .option("--filter <pattern>", "Filter logs by pattern")
    .option("--region <region>", "AWS region")
    .action(logsCommand);

program.parse();
```

---

## Corrected Setup Flow

```typescript
// bin/commands/setup.ts

export async function setupCommand(options: SetupOptions): Promise<void> {
    console.clear();

    console.log(chalk.bold.cyan("\n🚀 Benchling Webhook Setup\n"));
    console.log("This wizard will guide you through the complete setup.\n");

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Create Benchling App
    // ═══════════════════════════════════════════════════════════════

    console.log(chalk.bold.cyan("═══ PHASE 1: Create Benchling App ═══\n"));

    // Generate manifest
    const spinner = ora("Generating app manifest...").start();
    await manifestCommand({ output: "app-manifest.yaml" });
    spinner.succeed("Generated app-manifest.yaml");

    // Wait for user to upload to Benchling
    await pauseForManualStep({
        title: "Upload Manifest to Benchling",
        instructions: [
            "1. Go to your Benchling tenant:",
            "   → Settings → Developer Console → Apps",
            "",
            "2. Click 'Create' → 'From manifest'",
            "",
            "3. Upload the file: app-manifest.yaml",
            "",
            "4. After creation, copy these values:",
            "   • App Definition ID (app_def_xxxxx)",
            "   • Client ID (from OAuth section)",
            "   • Client Secret (click 'Generate Secret')",
            "",
            "   ⚠️  Save the Client Secret - you'll only see it once!"
        ],
        confirmMessage: "Have you completed these steps and have your credentials ready?"
    });

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Deploy to AWS
    // ═══════════════════════════════════════════════════════════════

    console.log(chalk.bold.cyan("\n═══ PHASE 2: Deploy to AWS ═══\n"));

    // Detect Quilt config
    spinner.start("Detecting Quilt configuration...");
    const quiltConfig = await inferQuiltConfig();

    if (!quiltConfig.success) {
        spinner.fail("Could not detect Quilt configuration");
        console.log(chalk.red(`\n${quiltConfig.error}\n`));
        process.exit(1);
    }

    spinner.succeed(`Found Quilt stack: ${quiltConfig.stackName}`);
    console.log(chalk.dim(`  Catalog: ${quiltConfig.catalogUrl}`));
    console.log(chalk.dim(`  Region: ${quiltConfig.region}`));
    console.log(chalk.dim(`  Bucket: ${quiltConfig.bucket}`));
    console.log();

    // Prompt for Benchling credentials
    console.log(chalk.bold("📝 Enter Benchling Credentials\n"));

    const credentials = await inquirer.prompt([
        {
            type: "input",
            name: "tenant",
            message: "Benchling tenant (e.g., 'acme' for acme.benchling.com):",
            validate: (input) => input.trim().length > 0 || "Required"
        },
        {
            type: "input",
            name: "clientId",
            message: "OAuth Client ID:",
            validate: (input) => input.trim().length > 0 || "Required"
        },
        {
            type: "password",
            name: "clientSecret",
            message: "OAuth Client Secret:",
            validate: (input) => input.trim().length > 0 || "Required"
        },
        {
            type: "input",
            name: "appDefinitionId",
            message: "App Definition ID (app_def_xxxxx):",
            validate: (input) => {
                if (!input.trim()) return "Required";
                if (!input.startsWith("app_def_")) {
                    return "Should start with 'app_def_'";
                }
                return true;
            }
        }
    ]);

    // Validate credentials
    spinner.start("Validating Benchling credentials...");
    const validation = await validateBenchlingCredentials(credentials);

    if (!validation.valid) {
        spinner.fail("Validation failed");
        console.log(chalk.red(`\n${validation.error}\n`));
        console.log(chalk.yellow("Please check your credentials and try again."));
        process.exit(1);
    }

    spinner.succeed("Credentials validated ✓");

    // Create secret
    const secretName = `benchling-webhook-${credentials.tenant}`;
    spinner.start(`Creating AWS secret: ${secretName}`);

    await createOrUpdateSecret({
        name: secretName,
        credentials,
        region: quiltConfig.region
    });

    spinner.succeed(`Secret created: ${secretName}`);

    // Deploy stack
    console.log(chalk.bold("\n🚢 Deploying to AWS...\n"));

    const deployment = await deployStack({
        quiltStackArn: quiltConfig.stackArn,
        benchlingSecret: secretName,
        region: quiltConfig.region,
        yes: true
    });

    const webhookUrl = deployment.outputs.WebhookUrl;

    console.log(chalk.bold.green("\n✅ Deployment Complete!\n"));
    console.log(chalk.cyan("Your webhook URL:"));
    console.log(chalk.bold.white(`  ${webhookUrl}\n`));

    // Copy to clipboard
    try {
        await clipboardy.write(webhookUrl);
        console.log(chalk.dim("(Copied to clipboard)"));
    } catch {
        // Clipboard might not work
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: Configure App in Benchling
    // ═══════════════════════════════════════════════════════════════

    console.log(chalk.bold.cyan("\n═══ PHASE 3: Configure Webhook in Benchling ═══\n"));

    await pauseForManualStep({
        title: "Configure Webhook URL",
        instructions: [
            "1. Go to your Benchling app settings:",
            `   → https://${credentials.tenant}.benchling.com/settings/dev`,
            "",
            "2. Open your app and scroll to 'Webhook URL'",
            "",
            "3. Paste the webhook URL:",
            `   ${webhookUrl}`,
            "",
            "4. Save changes",
            "",
            "5. Install the app:",
            "   → Go to 'Version History' tab",
            "   → Click 'Install'",
            "   → Choose organizations/teams",
            "   → Grant access to projects where you want to use it"
        ],
        confirmMessage: "Have you configured the webhook URL and installed the app?"
    });

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: Test Integration
    // ═══════════════════════════════════════════════════════════════

    if (!options.skipTest) {
        console.log(chalk.bold.cyan("\n═══ PHASE 4: Test Integration ═══\n"));

        console.log(boxen(
            chalk.bold("Let's verify the webhook is working!\n\n") +
            "In Benchling:\n" +
            "1. Open or create a notebook entry\n" +
            "2. Insert Canvas → 'Quilt Integration'\n" +
            "3. Interact with the canvas\n\n" +
            chalk.dim("This creates a webhook event we can detect."),
            { padding: 1, borderColor: "cyan", borderStyle: "round" }
        ));

        await inquirer.prompt([{
            type: "input",
            name: "ready",
            message: "Press ENTER when you've created a test event..."
        }]);

        spinner.start("Waiting for webhook events (60s timeout)...");

        const testResult = await waitForWebhookEvents({
            timeout: 60000,
            region: quiltConfig.region,
            logGroup: "/ecs/benchling-webhook"
        });

        if (testResult.success) {
            spinner.succeed("Event received! ✓");
            console.log(chalk.dim(`  Type: ${testResult.eventType}`));
            console.log(chalk.dim(`  Entry: ${testResult.entryId}`));
        } else {
            spinner.warn("No events detected yet");
            console.log(chalk.yellow("\nThis is normal if you haven't created a test event yet."));
            console.log(chalk.dim("You can test later by running: npx @quiltdata/benchling-webhook test"));
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SUCCESS!
    // ═══════════════════════════════════════════════════════════════

    console.log(chalk.bold.green("\n═══ 🎉 Setup Complete! ═══\n"));

    console.log(boxen(
        chalk.bold("Your Benchling webhook is ready!\n\n") +
        `Webhook URL: ${webhookUrl}\n` +
        `AWS Secret: ${secretName}\n` +
        `Region: ${quiltConfig.region}\n\n` +
        chalk.bold("Next steps:\n") +
        "• Use the Quilt canvas in your Benchling entries\n" +
        "• View logs: npx @quiltdata/benchling-webhook logs\n" +
        "• Test again: npx @quiltdata/benchling-webhook test",
        { padding: 1, borderColor: "green", borderStyle: "round" }
    ));

    if (options.save) {
        await saveConfig({
            webhookUrl,
            secretName,
            stackArn: quiltConfig.stackArn,
            region: quiltConfig.region
        });
    }
}

async function pauseForManualStep(config: {
    title: string;
    instructions: string[];
    confirmMessage: string;
}): Promise<void> {
    console.log(boxen(
        chalk.bold.yellow("⚠️  MANUAL STEP REQUIRED\n\n") +
        chalk.bold(config.title) + "\n\n" +
        config.instructions.join("\n"),
        { padding: 1, borderColor: "yellow", borderStyle: "round" }
    ));
    console.log();

    const answer = await inquirer.prompt([{
        type: "confirm",
        name: "ready",
        message: config.confirmMessage,
        default: false
    }]);

    if (!answer.ready) {
        console.log(chalk.yellow("\nSetup paused."));
        console.log(chalk.dim("Run this command again when ready to continue.\n"));
        process.exit(0);
    }
}
```

---

## Updated Implementation Checklist

### Week 1, Day 2: Implement Helper - CORRECTED

**`bin/commands/helpers/infer-quilt.ts`**:

- [ ] Execute `quilt3 config` to get catalog URL (NOT read YAML file)
- [ ] Handle case where quilt3 is not installed
- [ ] Handle case where no catalog is configured
- [ ] Query CloudFormation for matching stack
- [ ] Extract stack outputs
- [ ] Return structured result
- [ ] Add unit tests

**Test cases**:
```typescript
describe("inferQuiltConfig", () => {
    it("should get catalog URL from quilt3 config command");
    it("should handle quilt3 not installed");
    it("should handle no catalog configured");
    it("should find matching CloudFormation stack");
    it("should extract stack outputs");
});
```

---

## Summary of Corrections

### ✅ What Changed

1. **Quilt Config Detection**: Use `quilt3 config` CLI (not YAML file)
2. **Default Behavior**: `npx @quiltdata/benchling-webhook` runs setup wizard
3. **README Focus**: Only simple user experience, no power user docs
4. **Target Audience**: End users only, not CI/CD or developers

### ✅ What Stayed the Same

- Overall setup flow with manual pauses
- Credential validation before deployment
- Webhook event detection
- State persistence for pause/resume
- Helper module architecture

---

## Ready for Implementation

These corrections are CRITICAL. The implementation should follow this corrected spec exactly.

**Next step**: Begin Week 1, Day 1 with these corrections in mind.
