# Secure Setup - Issue #195

## Overview

The goal of `npm run setup` is to **AUTOMATICALLY SETUP THE ENTIRE QUILT STACK** with minimal but well-structured user input. The setup wizard should walk the user through a complete, end-to-end deployment in three clear steps:

### The Three-Step Workflow

1. **Detect and Configure the Stack** (ideally automatic)
   - Auto-detect existing Quilt CloudFormation stack
   - Extract required values (bucket, queue ARN, catalog URL, etc.)
   - Minimal manual input required

2. **Create Benchling App with Custom Manifest**
   - Generate app manifest based on detected Quilt stack
   - Guide user through creating Benchling app in their tenant
   - Collect OAuth credentials (client ID, client secret)
   - Collect app definition ID

3. **Deploy Stack and Return Webhook URL**
   - Deploy AWS infrastructure (ECS, API Gateway, ALB, etc.)
   - Return the webhook URL to the user
   - Instruct user to enter webhook URL in Benchling app settings

The wizard should be **simple, clean, and linear** - walking the user through these steps without confusion or manual configuration.

---

## Requirements Status

### 1. Setup Works at All ⚠️

**Status**: Partial - Components exist but workflow is fragmented

**Current State**:

- ✅ Interactive wizard prompts exist ([lib/configuration-wizard.ts](../../lib/configuration-wizard.ts))
- ✅ Stack auto-detection works ([lib/quilt-config-resolver.ts](../../lib/quilt-config-resolver.ts))
- ✅ Manifest generation works ([bin/commands/manifest.ts](../../bin/commands/manifest.ts))
- ✅ Deployment automation works
- ❌ **Missing**: Integrated three-step workflow that connects these pieces

**Gap**:
The user currently has to:

1. Run `npm run setup:infer` separately to detect stack
2. Manually create Benchling app (no guidance)
3. Run `npm run setup` to enter credentials
4. Run `npm run sync-secrets` to sync to AWS
5. Run `npm run deploy` to deploy
6. Manually find webhook URL in AWS console or outputs

**Required**:
One command (`npm run setup`) that does ALL of this in sequence:

```bash
npx @quiltdata/benchling-webhook setup
```

### 2. Benchling App Creation Guidance ❌

**Status**: Critical gap - This is the heart of the issue

**Current State**:

- ✅ Manifest generation exists (`manifest` command)
- ✅ Documentation exists in README
- ❌ **Not integrated into setup wizard**
- ❌ **No step-by-step walkthrough during setup**

**Required Implementation**:

The setup wizard MUST include a dedicated "Step 2" that:

1. **Generate the manifest file** automatically based on detected stack

   ```typescript
   console.log("\n📋 Step 2: Create Benchling App\n");

   // Generate manifest with detected Quilt catalog URL
   const manifest = generateManifest(config.quiltCatalog);
   writeFileSync('./benchling-app-manifest.yaml', manifest);

   console.log("✓ Generated app manifest: benchling-app-manifest.yaml");
   ```

2. **Display clear instructions** for creating the app

   ```typescript
   console.log("\nCreate your Benchling app:\n");
   console.log("1. Open: https://{tenant}.benchling.com/admin/apps");
   console.log("2. Click 'Create New App'");
   console.log("3. Upload the manifest file: benchling-app-manifest.yaml");
   console.log("4. Configure OAuth client credentials");
   console.log("5. Install the app (leave webhook URL blank for now)");
   console.log("6. Copy the following values:\n");
   console.log("   - OAuth Client ID");
   console.log("   - OAuth Client Secret");
   console.log("   - App Definition ID (from app overview page)\n");
   ```

3. **Wait for user confirmation** and collect credentials

   ```typescript
   const { ready } = await inquirer.prompt([{
     name: "ready",
     message: "Have you created the Benchling app and installed it?",
     type: "confirm"
   }]);

   if (!ready) {
     console.log("\nPlease complete the Benchling app setup before continuing.");
     console.log("Re-run 'npm run setup' when ready.\n");
     process.exit(0);
   }

   // Now collect credentials
   const credentials = await inquirer.prompt([
     { name: "clientId", message: "Enter OAuth Client ID:", type: "input" },
     { name: "clientSecret", message: "Enter OAuth Client Secret:", type: "password" },
     { name: "appDefinitionId", message: "Enter App Definition ID:", type: "input" }
   ]);
   ```

4. **Validate credentials** before proceeding

   ```typescript
   console.log("\nValidating credentials...");
   await validateBenchlingCredentials(credentials);
   console.log("✓ Credentials validated\n");
   ```

### 3. Security: No Secrets Manager for Verification Bypass ✅

**Status**: Complete

**Implementation**:

- Webhook signature verification is controlled by `security.enableVerification` in local config
- This setting is NEVER synced to AWS Secrets Manager
- Secrets Manager only stores: `clientId`, `clientSecret`, webhook allow list
- Verification can only be disabled via local config file or local env vars (dev mode only)

**Security Properties**:

- ✅ Verification enabled by default in production
- ✅ Cannot be disabled via Secrets Manager
- ✅ Only configurable through profile config (local file)
- ✅ No runtime configuration override path from AWS

**Code Reference**:

- [lib/benchling-webhook-stack.ts](../../lib/benchling-webhook-stack.ts) - Passes verification setting as env var, not from Secrets Manager
- [bin/commands/sync-secrets.ts](../../bin/commands/sync-secrets.ts) - Explicitly excludes security settings from sync

### 4. Sales Account Installation (Dedicated Profile) ✅

**Status**: Complete (v0.7.0+)

Profile-based configuration fully supports dedicated profiles:

```bash
# Setup wizard automatically asks for profile name
npm run setup

# Choose "sales" when prompted:
? Enter profile name: sales

# This creates:
# ~/.config/benchling-webhook/sales/config.json
# ~/.config/benchling-webhook/sales/deployments.json

# Deploy with sales profile
npm run deploy -- --profile sales

# Each profile is completely isolated:
# - Separate config file
# - Separate deployment tracking
# - Separate AWS Secrets Manager secret
# - Can use different AWS_PROFILE for different AWS accounts
```

**Directory Structure**:

```
~/.config/benchling-webhook/
├── default/          # Default profile
│   ├── config.json
│   └── deployments.json
├── sales/            # Sales profile (isolated)
│   ├── config.json
│   └── deployments.json
└── prod/             # Production profile (isolated)
    ├── config.json
    └── deployments.json
```

### 5. Usable npx Package ✅

**Status**: Complete

```bash
# One command to set up and run everything:
npx @quiltdata/benchling-webhook@latest

# Sub commands ALSO work via npx:
npx @quiltdata/benchling-webhook@latest setup --only
npx @quiltdata/benchling-webhook@latest manifest
npx @quiltdata/benchling-webhook@latest deploy
npx @quiltdata/benchling-webhook@latest test
```

**Package Configuration**:

- Published to npm as `@quiltdata/benchling-webhook`
- Entry point: `bin/cli.js`
- All dependencies bundled
- Works without local installation

---

## Implementation Status Summary

| Requirement | Status | Blocker |
|-------------|--------|---------|
| 1. Setup works at all | ⚠️ Partial | Need integrated three-step workflow |
| 2. Benchling app walkthrough | ❌ Critical | Not integrated into setup wizard |
| 3. No secrets-based verification bypass | ✅ Complete | - |
| 4. Sales account with dedicated profile | ✅ Complete | - |
| 5. Usable npx package | ✅ Complete | - |

**Overall**: 2.5/5 complete (50%)

---

## Required Implementation

### The Integrated Setup Wizard

The setup command must be rewritten to execute this exact sequence:

```typescript
// bin/commands/setup.ts

export async function setupCommand(options: { profile?: string }): Promise<void> {
  console.log(chalk.bold("\n🚀 Benchling Webhook Setup\n"));

  // ============================================================
  // STEP 1: Detect and Configure Stack
  // ============================================================

  console.log(chalk.bold("Step 1: Detect Quilt Stack\n"));

  console.log("Searching for Quilt CloudFormation stacks...");
  const stacks = await detectQuiltStacks();

  if (stacks.length === 0) {
    console.error("❌ No Quilt stack found. Please deploy Quilt first.");
    console.log("Visit: https://www.quilt.bio/install");
    process.exit(1);
  }

  let selectedStack;
  if (stacks.length === 1) {
    selectedStack = stacks[0];
    console.log(`✓ Found Quilt stack: ${selectedStack.name}`);
  } else {
    // Multiple stacks - prompt user to choose
    const { stack } = await inquirer.prompt([{
      type: "list",
      name: "stack",
      message: "Multiple Quilt stacks found. Choose one:",
      choices: stacks.map(s => ({ name: s.name, value: s }))
    }]);
    selectedStack = stack;
  }

  console.log("\nExtracting Quilt configuration...");
  const quiltConfig = await extractQuiltConfig(selectedStack);
  console.log(`✓ Catalog: ${quiltConfig.catalog}`);
  console.log(`✓ Bucket: ${quiltConfig.bucket}`);
  console.log(`✓ Queue: ${quiltConfig.queueArn}`);

  // ============================================================
  // STEP 2: Create Benchling App
  // ============================================================

  console.log(chalk.bold("\n\nStep 2: Create Benchling App\n"));

  // Prompt for tenant name first (needed for manifest and instructions)
  const { tenant } = await inquirer.prompt([{
    name: "tenant",
    message: "Enter your Benchling tenant name (e.g., 'acme' for acme.benchling.com):",
    type: "input",
    validate: validateTenant
  }]);

  // Generate manifest
  console.log("\nGenerating Benchling app manifest...");
  const manifest = generateManifest({
    catalog: quiltConfig.catalog,
    version: pkg.version
  });

  const manifestPath = path.join(process.cwd(), "benchling-app-manifest.yaml");
  writeFileSync(manifestPath, manifest);
  console.log(`✓ Created: ${manifestPath}`);

  // Display instructions
  console.log(boxen(
    chalk.bold("Create your Benchling app:\n\n") +
    `1. Navigate to: ${chalk.cyan(`https://${tenant}.benchling.com/admin/apps`)}\n` +
    `2. Click ${chalk.bold("'Create New App'")}\n` +
    `3. Upload the manifest: ${chalk.cyan(manifestPath)}\n` +
    `4. Configure OAuth credentials (copy Client ID and Secret)\n` +
    `5. ${chalk.bold("Install the app")} in your tenant ${chalk.dim("(leave webhook URL blank)")}\n` +
    `6. Copy the ${chalk.bold("App Definition ID")} from the app overview page`,
    { padding: 1, borderColor: "blue", borderStyle: "round" }
  ));

  // Wait for user
  console.log();
  const { ready } = await inquirer.prompt([{
    name: "ready",
    message: "Have you created and installed the Benchling app?",
    type: "confirm"
  }]);

  if (!ready) {
    console.log("\n⏸  Setup paused. Re-run when ready:\n");
    console.log(`  ${chalk.cyan("npx @quiltdata/benchling-webhook setup")}\n`);
    process.exit(0);
  }

  // Collect credentials
  console.log("\nEnter your Benchling app credentials:\n");
  const credentials = await inquirer.prompt([
    {
      name: "clientId",
      message: "OAuth Client ID:",
      type: "input",
      validate: validateClientId
    },
    {
      name: "clientSecret",
      message: "OAuth Client Secret:",
      type: "password",
      validate: validateClientSecret
    },
    {
      name: "appDefinitionId",
      message: "App Definition ID:",
      type: "input",
      validate: validateAppDefinitionId
    }
  ]);

  // Optional: test entry ID
  const { testEntry } = await inquirer.prompt([{
    name: "testEntry",
    message: "Test entry ID (optional, press Enter to skip):",
    type: "input"
  }]);

  // Validate credentials
  console.log("\n🔐 Validating Benchling credentials...");
  await validateBenchlingAuth({
    tenant,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret
  });
  console.log("✓ Credentials validated");

  // ============================================================
  // STEP 3: Deploy Stack and Return Webhook URL
  // ============================================================

  console.log(chalk.bold("\n\nStep 3: Deploy to AWS\n"));

  // Build complete config
  const completeConfig = {
    quilt: quiltConfig,
    benchling: {
      tenant,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      secretArn: `arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT}:secret:benchling/${profile}`,
      appDefinitionId: credentials.appDefinitionId,
      ...(testEntry && { testEntryId: testEntry })
    },
    packages: {
      bucket: quiltConfig.bucket,
      prefix: "benchling",
      metadataKey: "experiment_id"
    },
    deployment: {
      region: process.env.AWS_REGION || "us-east-1",
      account: await getAWSAccountId(),
      imageTag: "latest"
    },
    security: {
      enableVerification: true
    }
  };

  // Save config
  const profileName = options.profile || "default";
  console.log(`Saving configuration to profile: ${profileName}`);
  xdgConfig.writeProfile(profileName, completeConfig);
  console.log(`✓ Config saved: ~/.config/benchling-webhook/${profileName}/config.json`);

  // Sync secrets to AWS
  console.log("\nSyncing secrets to AWS Secrets Manager...");
  await syncSecretsToAWS(profileName, completeConfig);
  console.log("✓ Secrets synced");

  // Deploy infrastructure
  console.log("\nDeploying AWS infrastructure...");
  console.log("This will take 5-10 minutes...\n");

  const deployment = await deployCDKStack(profileName, completeConfig);

  console.log("✓ Deployment complete!");

  // Record deployment
  xdgConfig.recordDeployment(profileName, {
    stage: "prod",
    timestamp: new Date().toISOString(),
    imageTag: "latest",
    endpoint: deployment.webhookUrl,
    stackName: "BenchlingWebhookStack",
    region: completeConfig.deployment.region
  });

  // Display webhook URL
  console.log(boxen(
    chalk.bold.green("✓ Setup Complete!\n\n") +
    chalk.bold("Webhook URL:\n") +
    chalk.cyan(deployment.webhookUrl) + "\n\n" +
    chalk.bold("Final Step:\n") +
    `1. Go to: ${chalk.cyan(`https://${tenant}.benchling.com/admin/apps`)}\n` +
    `2. Select your app: "${manifest.info.name}"\n` +
    `3. Click ${chalk.bold("'Settings'")} → ${chalk.bold("'Webhook URL'")}\n` +
    `4. Enter the webhook URL above\n` +
    `5. Click ${chalk.bold("'Save'")}\n\n` +
    chalk.dim("Test your integration by creating an entry in Benchling!"),
    { padding: 1, borderColor: "green", borderStyle: "round" }
  ));

  console.log();
}
```

### Key Implementation Details

**Stack Detection** ([lib/quilt-config-resolver.ts](../../lib/quilt-config-resolver.ts)):

- Already implemented
- Scans CloudFormation for Quilt stacks
- Extracts outputs (bucket, queue, catalog)

**Manifest Generation** ([bin/commands/manifest.ts](../../bin/commands/manifest.ts)):

- Already implemented
- Needs minor refactor to be callable from setup wizard
- Should embed catalog URL in manifest

**Credential Validation**:

- New function needed: `validateBenchlingAuth()`
- Make test API call to Benchling using OAuth token
- Verify credentials work before saving

**Deployment Automation**:

- Existing CDK deployment logic
- Needs wrapper to capture webhook URL output
- Should stream CloudFormation events to console

---

## Testing Plan

### End-to-End Setup Test (Happy Path)

```bash
# Prerequisites:
# - Quilt stack already deployed
# - AWS credentials configured
# - Benchling account ready

# Run setup
npx @quiltdata/benchling-webhook@latest setup

# Expected flow:
# 1. Auto-detects Quilt stack ✓
# 2. Generates manifest file ✓
# 3. Shows Benchling app instructions ✓
# 4. Waits for user to create app
# 5. Collects credentials ✓
# 6. Validates credentials ✓
# 7. Deploys to AWS ✓
# 8. Shows webhook URL ✓

# Verify:
ls benchling-app-manifest.yaml           # Generated manifest
cat ~/.config/benchling-webhook/default/config.json  # Saved config
aws secretsmanager get-secret-value --secret-id benchling/default  # Synced secrets
curl https://xxx.amazonaws.com/prod/health  # Deployed stack
```

### Error Cases to Test

1. **No Quilt stack found**

   ```bash
   # Should fail gracefully with helpful message
   ```

2. **Invalid Benchling credentials**

   ```bash
   # Should validate before saving/deploying
   ```

3. **User cancels mid-setup**

   ```bash
   # Should allow resume without re-doing steps
   ```

4. **Deployment fails**

   ```bash
   # Should show CloudFormation error, not crash
   ```

### Sales Profile Test

```bash
# Setup should support profile flag
npx @quiltdata/benchling-webhook setup --profile sales

# Should:
# - Create ~/.config/benchling-webhook/sales/config.json
# - Use separate secret: benchling/sales
# - Support different AWS account via AWS_PROFILE
```

---

## Current Gaps Summary

### Critical (Blocking Issue Resolution)

1. **Integrated three-step workflow** - Setup wizard must execute all three steps in sequence
2. **Benchling app guidance in wizard** - Must be embedded in setup flow, not separate command
3. **Webhook URL display** - Must show final URL after deployment

### Important (User Experience)

4. **Credential validation** - Verify Benchling credentials before deployment
5. **Progress indicators** - Show deployment progress during long-running CDK deploy
6. **Error recovery** - Allow resuming setup after failure without starting over

### Nice to Have

7. **Pre-flight checks** - Validate AWS permissions before starting
8. **Rollback on failure** - Clean up partial deployments
9. **Setup video/docs** - Visual guide for first-time users

---

## Success Criteria

Issue #195 is resolved when:

✅ `npx @quiltdata/benchling-webhook setup` executes the complete three-step workflow
✅ User is guided through Benchling app creation with clear instructions
✅ Manifest is auto-generated based on detected stack
✅ Credentials are validated before deployment
✅ Webhook URL is displayed at the end
✅ Entire process works without consulting documentation
✅ Security: verification cannot be disabled via Secrets Manager
✅ Profile support enables dedicated sales/prod/dev installations
✅ Works cleanly via npx (no local installation required)

---

## Related Work

### Completed (v0.7.0 - v0.7.2)

- ✅ Profile-based configuration (PR #189)
- ✅ Secrets resolution fix (PR #197)
- ✅ NPX package improvements (PR #185)
- ✅ Stack auto-detection
- ✅ Manifest generation command

### Required (To Close #195)

- ❌ Integrate three steps into single `setup` command
- ❌ Embed Benchling app guidance in setup flow
- ❌ Add credential validation
- ❌ Display webhook URL after deployment
- ❌ Add progress indicators for deployment
- ❌ Test end-to-end with fresh Benchling account

---

## Conclusion

**The core issue**: The setup wizard exists as disconnected pieces. Users must manually orchestrate multiple commands and reference documentation to complete setup.

**The solution**: Implement the integrated three-step workflow that automatically walks users from "I have a Quilt stack" to "My Benchling webhook is working" with a single command.

**Estimated effort**: 1-2 days to integrate existing components into cohesive workflow.

**Priority**: HIGH - This blocks production use by non-technical users (e.g., sales team).
