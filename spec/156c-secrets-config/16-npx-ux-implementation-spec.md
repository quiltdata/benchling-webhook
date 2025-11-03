# NPX UX Implementation Spec: Hybrid Multi-Phase Approach

**Date**: 2025-11-03
**Status**: Ready for Implementation
**Branch**: `npx-ux`
**Target Version**: v0.7.0

---

## Executive Summary

**Approach**: Hybrid model with both guided wizard (`setup`) and individual phase commands (`init`, `deploy`, `test`)

**Rationale**:
- First-time users get hand-holding with `setup`
- Power users get granular control with individual commands
- Updates and iterations don't require re-entering all credentials
- Clear separation of automated vs manual steps

---

## Command Architecture

### Command Overview

| Command | Purpose | Interactive | Manual Steps | Use Case |
|---------|---------|-------------|--------------|----------|
| `setup` | Full guided wizard | Yes | Pauses for manual | First-time setup |
| `init` | Generate manifest | No | Shows instructions | Quick start, regenerate |
| `deploy` | Deploy/update stack | Yes (prompts) | None | Deploy, update secrets |
| `test` | Verify webhook | No | None | Health check, debugging |
| `logs` | Stream CloudWatch | No | None | Debugging, monitoring |

---

## Detailed Command Specifications

### 1. `npx @quiltdata/benchling-webhook@latest setup`

**Purpose**: End-to-end guided setup for first-time users

**Flow**:
```
1. Welcome + Prerequisites Check
2. Phase 1: Generate Manifest
3. [PAUSE] Wait for user to upload to Benchling
4. Phase 2: Infer Quilt Config
5. Phase 2: Prompt for Benchling Credentials
6. Phase 2: Validate Credentials
7. Phase 2: Deploy to AWS
8. [PAUSE] Wait for user to configure webhook URL
9. [PAUSE] Wait for user to install app
10. Phase 3: Test Webhook
11. Success Screen
```

**Options**:
```bash
--save              # Save config to .benchling-webhook.json
--skip-test         # Skip webhook testing phase
--no-deploy         # Setup secrets but don't deploy
```

**Implementation**:
```typescript
// bin/commands/setup.ts

import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import clipboardy from "clipboardy";

export async function setupCommand(options: SetupOptions): Promise<void> {
    console.clear();
    displayWelcome();

    // Prerequisites check
    await checkPrerequisites();

    // Phase 1: Generate Manifest
    console.log(chalk.bold.cyan("\n═══ PHASE 1: Create Benchling App ═══\n"));
    await generateManifest();
    await waitForManualStep({
        title: "Upload Manifest to Benchling",
        instructions: [
            "1. Go to: https://docs.benchling.com/docs/getting-started-benchling-apps#creating-an-app-from-a-manifest",
            "2. Upload app-manifest.yaml to Benchling",
            "3. Copy the App Definition ID (app_def_xxxxx)",
            "4. Generate OAuth credentials (Client ID + Secret)"
        ],
        prompt: "Have you completed these steps?"
    });

    // Phase 2: Deploy to AWS
    console.log(chalk.bold.cyan("\n═══ PHASE 2: Deploy to AWS ═══\n"));

    const spinner = ora("Detecting Quilt configuration...").start();
    const quiltConfig = await inferQuiltConfig();
    if (!quiltConfig.success) {
        spinner.fail("Could not detect Quilt configuration");
        console.log(chalk.yellow("\nPlease run: quilt3 config"));
        process.exit(1);
    }
    spinner.succeed(`Found Quilt stack: ${quiltConfig.stackName}`);
    displayQuiltConfig(quiltConfig);

    const credentials = await promptForCredentials(quiltConfig.tenant);

    spinner.start("Validating Benchling credentials...");
    const validation = await validateBenchlingCredentials(credentials);
    if (!validation.valid) {
        spinner.fail("Validation failed");
        console.error(chalk.red(`\n${validation.error}\n`));
        process.exit(1);
    }
    spinner.succeed("Credentials validated");

    spinner.start("Creating AWS secret...");
    const secretName = await createSecret(credentials, quiltConfig.region);
    spinner.succeed(`Secret created: ${secretName}`);

    if (options.noDeploy) {
        console.log(chalk.green("\n✓ Setup complete (deployment skipped)"));
        displayNextSteps("manual-deploy", { secretName, quiltConfig });
        return;
    }

    spinner.start("Deploying stack to AWS...");
    const deployment = await deployStack({
        quiltStackArn: quiltConfig.stackArn,
        benchlingSecret: secretName,
        region: quiltConfig.region,
        yes: true
    });
    spinner.succeed("Stack deployed");

    const webhookUrl = deployment.outputs.WebhookUrl;
    console.log(chalk.bold.green("\n✓ Deployment Complete!\n"));
    console.log(chalk.cyan("Webhook URL:"), webhookUrl);

    try {
        await clipboardy.write(webhookUrl);
        console.log(chalk.dim("(Copied to clipboard)"));
    } catch (e) {
        // Clipboard might not work in some environments
    }

    // Phase 3: Configure in Benchling
    console.log(chalk.bold.cyan("\n═══ PHASE 3: Configure App in Benchling ═══\n"));
    await waitForManualStep({
        title: "Configure Webhook URL",
        instructions: [
            `1. Go to: https://${credentials.tenant}.benchling.com/settings/dev`,
            "2. Open your app settings",
            `3. Paste webhook URL: ${webhookUrl}`,
            "4. Save changes",
            "",
            "5. Click 'Install' in Version History tab",
            "6. Choose organizations/teams",
            "7. Grant access to projects"
        ],
        prompt: "Have you completed these steps?"
    });

    // Phase 4: Test
    if (!options.skipTest) {
        console.log(chalk.bold.cyan("\n═══ PHASE 4: Test Integration ═══\n"));
        await waitForManualStep({
            title: "Create Test Event",
            instructions: [
                "Please test the integration in Benchling:",
                "1. Open or create a notebook entry",
                "2. Insert Canvas → 'Quilt Integration'",
                "3. Interact with the canvas"
            ],
            prompt: "Press ENTER when ready to check for events",
            requireConfirmation: false
        });

        spinner.start("Waiting for webhook events (60s timeout)...");
        const testResult = await waitForWebhookEvents({
            timeout: 60000,
            region: quiltConfig.region,
            logGroup: "/ecs/benchling-webhook"
        });

        if (testResult.success) {
            spinner.succeed("Event received!");
            console.log(chalk.dim(`  Type: ${testResult.eventType}`));
            console.log(chalk.dim(`  Entry: ${testResult.entryId}`));
        } else {
            spinner.warn("No events received yet");
            console.log(chalk.yellow("\nThis is normal if you haven't created a test event yet."));
            console.log(chalk.dim("Run 'npx @quiltdata/benchling-webhook test' later to verify."));
        }
    }

    // Success
    console.log(chalk.bold.green("\n═══ 🎉 Setup Complete! ═══\n"));
    displaySuccessMessage({ webhookUrl, secretName, quiltConfig });

    if (options.save) {
        await saveConfig({ secretName, quiltConfig, webhookUrl });
    }
}

async function waitForManualStep(config: ManualStepConfig): Promise<void> {
    console.log(boxen(
        chalk.bold.yellow("⚠️  MANUAL STEP REQUIRED\n\n") +
        chalk.bold(config.title) + "\n\n" +
        config.instructions.join("\n"),
        { padding: 1, borderColor: "yellow", borderStyle: "round" }
    ));

    const answer = await inquirer.prompt([{
        type: config.requireConfirmation !== false ? "confirm" : "input",
        name: "ready",
        message: config.prompt,
        default: config.requireConfirmation !== false ? false : ""
    }]);

    if (config.requireConfirmation !== false && !answer.ready) {
        console.log(chalk.red("\nSetup paused. Run this command again when ready."));
        process.exit(0);
    }
}
```

---

### 2. `npx @quiltdata/benchling-webhook@latest init`

**Purpose**: Quick start - generate manifest and show instructions

**Flow**:
```
1. Generate app-manifest.yaml
2. Display boxed instructions for next steps
3. Exit
```

**Options**:
```bash
--output <path>     # Custom output path (default: app-manifest.yaml)
--open              # Open Benchling docs in browser
```

**Output**:
```
✓ Created app-manifest.yaml

┌─────────────────────────────────────────────────────────────────┐
│ Next Steps:                                                     │
│                                                                 │
│ 1. Upload Manifest to Benchling                                │
│    https://docs.benchling.com/docs/getting-started-benchling-apps#creating-an-app-from-a-manifest
│                                                                 │
│    • Go to Feature Settings → Developer Console → Apps         │
│    • Click "Create" → "From manifest"                          │
│    • Upload app-manifest.yaml                                  │
│                                                                 │
│ 2. Copy App Definition ID                                      │
│    After creation, Benchling will show: app_def_xxxxx          │
│                                                                 │
│ 3. Generate OAuth Credentials                                  │
│    • Click "Generate Secret" in app settings                   │
│    • Copy Client ID and Client Secret                          │
│                                                                 │
│ 4. Deploy to AWS                                               │
│    npx @quiltdata/benchling-webhook@latest deploy              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3. `npx @quiltdata/benchling-webhook@latest deploy`

**Purpose**: Deploy or update webhook stack

**Modes**:

#### Mode A: Interactive (Default)
```bash
npx @quiltdata/benchling-webhook@latest deploy
```
- Infers Quilt config
- Prompts for Benchling credentials
- Validates before deploying
- Creates/updates secret
- Deploys stack

#### Mode B: Secrets-Only (Existing v0.6.0)
```bash
npx @quiltdata/benchling-webhook@latest deploy \
  --quilt-stack-arn arn:aws:cloudformation:... \
  --benchling-secret my-secret-name \
  --yes
```
- Non-interactive
- Uses existing secret
- No credential prompts

#### Mode C: Legacy (Existing v0.6.0)
```bash
npx @quiltdata/benchling-webhook@latest deploy \
  --benchling-secrets @secrets.json \
  --catalog my-catalog.quiltdata.com
```
- For backward compatibility

**Options**:
```bash
# Interactive mode
--update                # Update existing deployment

# Secrets-only mode
--quilt-stack-arn <arn> # Quilt CloudFormation stack ARN
--benchling-secret <name> # Existing secret name/ARN

# Legacy mode
--benchling-secrets <value> # JSON, @file, or ARN
--catalog <url>         # Quilt catalog URL
--bucket <name>         # S3 bucket

# Common
--region <region>       # AWS region
--profile <profile>     # AWS profile
--image-tag <tag>       # Docker image tag
--yes                   # Skip confirmation
--no-bootstrap-check    # Skip CDK bootstrap check
```

**Flow (Interactive Mode)**:
```typescript
export async function deployCommand(options: DeployOptions): Promise<void> {
    // Check if secrets-only mode
    if (options.quiltStackArn && options.benchlingSecret) {
        return deploySecretsOnlyMode(options);
    }

    // Check if legacy mode
    if (options.benchlingSecrets && options.catalog) {
        return deployLegacyMode(options);
    }

    // Interactive mode
    console.log(chalk.bold.cyan("\n🚀 Benchling Webhook Deployment\n"));

    // Check prerequisites
    const hasQuilt = await checkQuiltInstalled();
    if (!hasQuilt) {
        console.log(chalk.yellow("Quilt Python client not found."));
        console.log(chalk.dim("Install: pip install quilt3"));
        const proceed = await inquirer.prompt([{
            type: "confirm",
            name: "continue",
            message: "Continue without Quilt config auto-detection?",
            default: false
        }]);
        if (!proceed.continue) process.exit(0);
    }

    // Infer Quilt configuration
    const spinner = ora("Detecting Quilt configuration...").start();
    const quiltConfig = await inferQuiltConfig();

    if (quiltConfig.success) {
        spinner.succeed(`Found Quilt stack: ${quiltConfig.stackName}`);
        console.log(chalk.dim(`  Catalog: ${quiltConfig.catalogUrl}`));
        console.log(chalk.dim(`  Region: ${quiltConfig.region}`));
        console.log(chalk.dim(`  Bucket: ${quiltConfig.bucket}`));
        console.log();

        const useDetected = await inquirer.prompt([{
            type: "confirm",
            name: "use",
            message: "Use this Quilt configuration?",
            default: true
        }]);

        if (!useDetected.use) {
            // Manual input
            const manual = await promptForManualQuiltConfig();
            Object.assign(quiltConfig, manual);
        }
    } else {
        spinner.fail("Could not auto-detect Quilt configuration");
        console.log(chalk.yellow("\nPlease provide Quilt configuration manually.\n"));
        const manual = await promptForManualQuiltConfig();
        Object.assign(quiltConfig, { ...manual, success: true });
    }

    // Prompt for Benchling credentials
    console.log(chalk.bold("\n📝 Benchling Credentials\n"));
    const credentials = await promptForCredentials();

    // Validate credentials
    spinner.start("Validating Benchling credentials...");
    const validation = await validateBenchlingCredentials(credentials);
    if (!validation.valid) {
        spinner.fail("Validation failed");
        console.error(chalk.red(`\n${validation.error}\n`));
        process.exit(1);
    }
    spinner.succeed("Credentials validated");

    // Verify S3 access
    spinner.start(`Verifying S3 bucket access: ${quiltConfig.bucket}`);
    const s3Check = await verifyS3Access(quiltConfig.bucket, quiltConfig.region);
    if (!s3Check.success) {
        spinner.fail("S3 access failed");
        console.error(chalk.red(`\n${s3Check.error}\n`));
        process.exit(1);
    }
    spinner.succeed("S3 bucket accessible");

    // Create or update secret
    const secretName = `benchling-webhook-${credentials.tenant}`;
    spinner.start(`Creating/updating secret: ${secretName}`);
    await createOrUpdateSecret({
        name: secretName,
        credentials,
        region: quiltConfig.region
    });
    spinner.succeed(`Secret ready: ${secretName}`);

    // Confirm deployment
    if (!options.yes) {
        console.log(chalk.bold("\n📋 Deployment Summary\n"));
        console.log(chalk.cyan("  Quilt Stack:"), quiltConfig.stackName);
        console.log(chalk.cyan("  Region:"), quiltConfig.region);
        console.log(chalk.cyan("  Benchling Tenant:"), credentials.tenant);
        console.log(chalk.cyan("  Secret:"), secretName);
        console.log();

        const confirm = await inquirer.prompt([{
            type: "confirm",
            name: "proceed",
            message: "Proceed with deployment?",
            default: true
        }]);

        if (!confirm.proceed) {
            console.log(chalk.yellow("Deployment cancelled."));
            process.exit(0);
        }
    }

    // Deploy
    console.log(chalk.bold("\n🚢 Deploying to AWS...\n"));
    const deployment = await deployStack({
        quiltStackArn: quiltConfig.stackArn,
        benchlingSecret: secretName,
        region: quiltConfig.region,
        imageTag: options.imageTag,
        yes: true
    });

    console.log(chalk.bold.green("\n✅ Deployment Complete!\n"));
    const webhookUrl = deployment.outputs.WebhookUrl;
    console.log(chalk.cyan("Webhook URL:"), webhookUrl);
    console.log();

    try {
        await clipboardy.write(webhookUrl);
        console.log(chalk.dim("(Copied to clipboard)"));
    } catch (e) {
        // Ignore clipboard errors
    }

    console.log(boxen(
        chalk.bold("Next Steps:\n\n") +
        `1. Configure webhook URL in Benchling app settings:\n` +
        `   https://${credentials.tenant}.benchling.com/settings/dev\n\n` +
        `2. Install app in your tenant\n\n` +
        `3. Test: npx @quiltdata/benchling-webhook@latest test`,
        { padding: 1, borderColor: "green", borderStyle: "round" }
    ));
}
```

---

### 4. `npx @quiltdata/benchling-webhook@latest test`

**Purpose**: Verify webhook health and recent activity

**Flow**:
```
1. Find deployed stack
2. Check ECS service health
3. Query CloudWatch logs for recent events
4. Display summary
```

**Options**:
```bash
--region <region>       # AWS region
--profile <profile>     # AWS profile
--tail                  # Follow logs in real-time
--wait                  # Wait for events (useful after setup)
--timeout <seconds>     # Wait timeout (default: 60)
```

**Output**:
```
🔍 Checking webhook health...

✓ Stack: benchling-webhook (deployed)
✓ ECS Service: Running (2/2 tasks healthy)
✓ ALB Target Health: Healthy
✓ API Gateway: Responding

📊 Recent Activity (last 5 minutes):

  ✓ 3 events received
  ✓ 3 packages processed
  ✓ 0 errors

Latest Events:
  [14:32:18] v2.canvas.userInteracted → EXP-123 ✓
  [14:30:45] v2.entry.updated.fields → EXP-122 ✓
  [14:28:12] v2.canvas.created → EXP-123 ✓

Commands:
  npx @quiltdata/benchling-webhook@latest logs     # Stream logs
  npx @quiltdata/benchling-webhook@latest deploy   # Update deployment
```

---

### 5. `npx @quiltdata/benchling-webhook@latest logs`

**Purpose**: Stream CloudWatch logs

**Options**:
```bash
--follow, -f            # Follow log output
--since <time>          # Show logs since (e.g., "5m", "1h", "2h30m")
--filter <pattern>      # Filter logs by pattern
--region <region>       # AWS region
--profile <profile>     # AWS profile
```

**Implementation**:
```typescript
export async function logsCommand(options: LogsOptions): Promise<void> {
    const region = options.region || await detectRegion();
    const logGroup = "/ecs/benchling-webhook";

    const args = [
        "logs", "tail", logGroup,
        "--region", region
    ];

    if (options.follow) args.push("--follow");
    if (options.since) args.push("--since", options.since);
    if (options.filter) args.push("--filter-pattern", options.filter);
    if (options.profile) args.push("--profile", options.profile);

    console.log(chalk.dim(`Streaming logs from ${logGroup}...`));
    console.log(chalk.dim("Press Ctrl+C to exit\n"));

    execSync(`aws ${args.join(" ")}`, { stdio: "inherit" });
}
```

---

## Helper Modules

### `bin/commands/helpers/infer-quilt.ts`

**Purpose**: Auto-detect Quilt configuration from `~/.quilt3/config.yml` and CloudFormation

```typescript
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
        // 1. Read ~/.quilt3/config.yml
        const configPath = path.join(os.homedir(), ".quilt3", "config.yml");
        if (!fs.existsSync(configPath)) {
            return { success: false, error: "Quilt config not found. Run: quilt3 config" };
        }

        const configYaml = fs.readFileSync(configPath, "utf-8");
        const config = yaml.parse(configYaml);

        const catalogUrl = config.navigator_url;
        if (!catalogUrl) {
            return { success: false, error: "No catalog URL in Quilt config" };
        }

        // 2. Find CloudFormation stack with matching catalog
        const cfn = new CloudFormationClient({});
        const stacks = await cfn.send(new DescribeStacksCommand({}));

        const quiltStack = stacks.Stacks?.find(stack => {
            const catalogOutput = stack.Outputs?.find(o => o.OutputKey === "CatalogUrl");
            return catalogOutput?.OutputValue === catalogUrl;
        });

        if (!quiltStack) {
            return {
                success: false,
                error: `No CloudFormation stack found for catalog: ${catalogUrl}`
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

### `bin/commands/helpers/validate-benchling.ts`

**Purpose**: Validate Benchling credentials before deployment

```typescript
export interface ValidationResult {
    valid: boolean;
    error?: string;
    tokenResponse?: any;
}

export async function validateBenchlingCredentials(
    credentials: BenchlingCredentials
): Promise<ValidationResult> {
    try {
        const tokenUrl = `https://${credentials.tenant}.benchling.com/api/v2/token`;

        const response = await fetch(tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret,
                scope: "read:entry write:entry"
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            return {
                valid: false,
                error: `OAuth validation failed (${response.status}): ${errorText}`
            };
        }

        const tokenData = await response.json();

        if (!tokenData.access_token) {
            return {
                valid: false,
                error: "No access token in response"
            };
        }

        return {
            valid: true,
            tokenResponse: tokenData
        };
    } catch (error) {
        return {
            valid: false,
            error: `Validation error: ${(error as Error).message}`
        };
    }
}
```

---

### `bin/commands/helpers/webhook-test.ts`

**Purpose**: Wait for and detect webhook events in CloudWatch Logs

```typescript
export interface WebhookTestResult {
    success: boolean;
    eventType?: string;
    entryId?: string;
    timestamp?: Date;
    error?: string;
}

export async function waitForWebhookEvents(options: {
    timeout: number;
    region: string;
    logGroup: string;
}): Promise<WebhookTestResult> {
    const startTime = Date.now();
    const endTime = startTime + options.timeout;

    const logs = new CloudWatchLogsClient({ region: options.region });

    while (Date.now() < endTime) {
        try {
            const result = await logs.send(new FilterLogEventsCommand({
                logGroupName: options.logGroup,
                startTime: startTime,
                filterPattern: '"Received webhook event"'
            }));

            if (result.events && result.events.length > 0) {
                const latestEvent = result.events[result.events.length - 1];
                const message = latestEvent.message || "";

                // Parse event details from log message
                const eventTypeMatch = message.match(/type[:\s]+(\S+)/i);
                const entryMatch = message.match(/entry[:\s]+(\S+)/i);

                return {
                    success: true,
                    eventType: eventTypeMatch?.[1],
                    entryId: entryMatch?.[1],
                    timestamp: new Date(latestEvent.timestamp || Date.now())
                };
            }
        } catch (error) {
            // Log group might not exist yet
        }

        // Wait 2 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return {
        success: false,
        error: "Timeout waiting for events"
    };
}
```

---

## Testing Plan

### Unit Tests

```typescript
// test/commands/infer-quilt.test.ts
describe("inferQuiltConfig", () => {
    it("should detect Quilt config from ~/.quilt3/config.yml");
    it("should find matching CloudFormation stack");
    it("should extract stack outputs");
    it("should handle missing config gracefully");
});

// test/commands/validate-benchling.test.ts
describe("validateBenchlingCredentials", () => {
    it("should validate valid credentials");
    it("should reject invalid credentials");
    it("should handle network errors");
});
```

### Integration Tests

```bash
# Test full setup workflow
npm run test:setup

# Test individual commands
npm run test:init
npm run test:deploy
npm run test:test
```

---

## Documentation Updates

### README.md

```markdown
## Quick Start

Choose your preferred method:

### Option 1: Guided Setup (Recommended for First-Time Users)

```bash
npx @quiltdata/benchling-webhook@latest setup
```

This wizard will:
- Guide you through creating a Benchling app
- Auto-detect your Quilt configuration
- Validate credentials before deploying
- Deploy the webhook to AWS
- Help you test the integration

### Option 2: Step-by-Step Setup (More Control)

#### Step 1: Generate Manifest
```bash
npx @quiltdata/benchling-webhook@latest init
```

#### Step 2: Create App in Benchling
[Instructions with screenshots]

#### Step 3: Deploy to AWS
```bash
npx @quiltdata/benchling-webhook@latest deploy
```

#### Step 4: Configure Webhook in Benchling
[Instructions with screenshots]

#### Step 5: Test
```bash
npx @quiltdata/benchling-webhook@latest test
```

### Option 3: Non-Interactive (CI/CD, Updates)

```bash
npx @quiltdata/benchling-webhook@latest deploy \
  --quilt-stack-arn arn:aws:cloudformation:... \
  --benchling-secret my-secret-name \
  --yes
```

## All Commands

- `setup` - Guided setup wizard (first-time users)
- `init` - Generate Benchling app manifest
- `deploy` - Deploy or update webhook stack
- `test` - Verify webhook health
- `logs` - Stream CloudWatch logs
- `--help` - Show help for any command
```

---

## Implementation Timeline

### Week 1: Core Commands
- **Day 1**: Implement `init` command (simple, good starting point)
- **Day 2**: Implement helper modules (infer-quilt, validate-benchling)
- **Day 3**: Enhance `deploy` command with interactive mode
- **Day 4**: Implement `test` command
- **Day 5**: Implement `logs` command

### Week 2: Setup Wizard
- **Day 1-2**: Implement `setup` command with phase progression
- **Day 3**: Add webhook event detection
- **Day 4**: Polish UX (messages, colors, boxes)
- **Day 5**: Integration testing

### Week 3: Polish & Release
- **Day 1-2**: Documentation (README, screenshots, video)
- **Day 3**: Beta testing with real users
- **Day 4**: Fix bugs and refine based on feedback
- **Day 5**: Release v0.7.0

---

## Success Metrics

### User Experience
- [ ] Setup completion rate >90%
- [ ] Time to first webhook event <15 minutes
- [ ] Support questions reduced by 70%
- [ ] User satisfaction score >4.5/5

### Technical
- [ ] Quilt config detection accuracy >95%
- [ ] Credential validation catches errors before deployment
- [ ] Zero deployments with invalid credentials
- [ ] Webhook health detection accuracy >99%

---

## Migration from v0.6.x

### Backward Compatibility

All existing commands continue to work:

```bash
# v0.6.x secrets-only mode
npx @quiltdata/benchling-webhook@latest deploy \
  --quilt-stack-arn ... \
  --benchling-secret ... \
  --yes

# Still works in v0.7.0 ✓
```

### New Recommended Workflow

```bash
# v0.7.0 - First time
npx @quiltdata/benchling-webhook@latest setup

# v0.7.0 - Updates
npx @quiltdata/benchling-webhook@latest deploy --update
```

---

## Next Steps

1. ✅ Review and approve this spec
2. Create feature branch: `feat/npx-ux-commands`
3. Implement Week 1 (core commands)
4. Implement Week 2 (setup wizard)
5. Implement Week 3 (polish & release)
6. Release v0.7.0

---

**Spec Complete** ✅

Ready for implementation!
