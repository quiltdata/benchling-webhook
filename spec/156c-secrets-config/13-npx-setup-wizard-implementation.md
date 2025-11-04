# NPX Setup Wizard Implementation Plan

**Goal**: Bring the FULL setup wizard experience to npx users - make it the PRIMARY user experience

**Date**: 2025-11-03
**Priority**: HIGH - This is THE solution to the npx vs npm confusion

---

## Executive Summary

**What We're Doing**: Make `npx @quiltdata/benchling-webhook setup` the ONE COMMAND that does everything.

**Why**: We built an amazing interactive wizard with validation, inference, and secrets management. It's locked behind `npm run setup`. Let's give it to ALL users via npx!

**Result**:
```bash
# Before (complex, manual, error-prone)
npx @quiltdata/benchling-webhook manifest
aws secretsmanager create-secret --name ... --secret-string '{...}'
# Find stack ARN in CloudFormation console
npx @quiltdata/benchling-webhook deploy --quilt-stack-arn ... --benchling-secret ...

# After (ONE COMMAND!)
npx @quiltdata/benchling-webhook setup
# ✓ Auto-detects Quilt config
# ✓ Validates Benchling credentials
# ✓ Creates AWS secret
# ✓ Deploys stack
# ✓ Returns webhook URL
# DONE!
```

---

## Implementation Steps

### Step 1: Compile Setup Wizard for NPX (1-2 hours)

**Action**: Move setup wizard to production CLI

**Files to Change**:

1. **Move and adapt wizard**: `scripts/install-wizard.ts` → `bin/commands/setup.ts`
   - Keep ALL validation logic
   - Keep ALL inference logic
   - Keep ALL secrets sync logic
   - **Remove** XDG config dependency (use temp files or in-memory for npx users)
   - Add `--save` flag for users who want to save config locally

2. **Add to CLI**: `bin/cli.ts`
```typescript
program
    .command("setup")
    .description("Interactive setup wizard - configure and deploy in one command")
    .option("--save", "Save configuration locally (optional)")
    .option("--deploy", "Deploy immediately after setup (default: true)")
    .option("--no-deploy", "Setup only, don't deploy")
    .action(async (options) => {
        try {
            await setupCommand(options);
        } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });
```

3. **Update package.json**: Add wizard dependencies to production deps
```json
{
  "dependencies": {
    "inquirer": "^12.10.0",  // Already present
    "@aws-sdk/client-secrets-manager": "^3.922.0",  // Already present
    "@aws-sdk/client-cloudformation": "^3.920.0",  // Already present
    "@aws-sdk/client-s3": "^3.758.0"  // Already present
  }
}
```

**Good news**: All deps are already production deps! No package bloat!

---

### Step 2: Update README to Make Setup Primary (30 minutes)

**New README.md "Setup" section**:

```markdown
## Setup

### One-Command Setup (Recommended)

Run the interactive setup wizard:

```bash
npx @quiltdata/benchling-webhook@latest setup
```

This will:
1. ✓ Auto-detect your Quilt configuration from `quilt3 config`
2. ✓ Prompt for Benchling credentials (tenant, client ID, secret, app definition ID)
3. ✓ Validate Benchling OAuth credentials
4. ✓ Verify S3 bucket access
5. ✓ Create AWS Secrets Manager secret automatically
6. ✓ Deploy the webhook stack to AWS
7. ✓ Return your webhook URL

**That's it!** The wizard handles everything.

---

### Manual Setup (Advanced)

If you prefer manual control, see [Advanced Setup Guide](./AGENTS.md#manual-deployment).

Quick summary:
1. Generate manifest: `npx @quiltdata/benchling-webhook@latest manifest`
2. Create AWS secret: `aws secretsmanager create-secret ...`
3. Deploy: `npx @quiltdata/benchling-webhook@latest deploy --quilt-stack-arn ... --benchling-secret ...`
```

**That's the ENTIRE setup section**. Clean, simple, ONE command.

---

### Step 3: Create bin/commands/setup.ts (2-3 hours)

**Core Implementation**:

```typescript
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { SecretsManagerClient, CreateSecretCommand } from "@aws-sdk/client-secrets-manager";
import { inferQuiltConfig } from "./setup-helpers/infer-quilt";
import { validateBenchlingCredentials } from "./setup-helpers/validate-benchling";
import { deployStack } from "./deploy";

export async function setupCommand(options: { save?: boolean; deploy?: boolean }): Promise<void> {
    console.log(chalk.bold.cyan("\n🚀 Benchling Webhook Setup Wizard\n"));

    // Step 1: Infer Quilt configuration
    const spinner = ora("Detecting Quilt configuration...").start();
    const quiltConfig = await inferQuiltConfig();

    if (quiltConfig.success) {
        spinner.succeed(`Found Quilt stack: ${quiltConfig.stackName}`);
        console.log(chalk.dim(`  Catalog: ${quiltConfig.catalogUrl}`));
        console.log(chalk.dim(`  Region: ${quiltConfig.region}`));
        console.log(chalk.dim(`  Bucket: ${quiltConfig.bucket}`));
    } else {
        spinner.fail("Could not auto-detect Quilt configuration");
        console.log(chalk.yellow("\nPlease ensure you have quilt3 configured: quilt3 config"));
        process.exit(1);
    }

    // Step 2: Prompt for Benchling credentials
    console.log(chalk.bold("\n📝 Benchling Credentials\n"));

    const benchlingAnswers = await inquirer.prompt([
        {
            type: "input",
            name: "tenant",
            message: "Benchling tenant (e.g., 'acme' for acme.benchling.com):",
            validate: (input: string) => input.trim().length > 0 || "Tenant is required",
        },
        {
            type: "input",
            name: "clientId",
            message: "OAuth Client ID:",
            validate: (input: string) => input.trim().length > 0 || "Client ID is required",
        },
        {
            type: "password",
            name: "clientSecret",
            message: "OAuth Client Secret:",
            validate: (input: string) => input.trim().length > 0 || "Client secret is required",
        },
        {
            type: "input",
            name: "appDefinitionId",
            message: "App Definition ID:",
            validate: (input: string) => input.trim().length > 0 || "App definition ID is required",
        },
    ]);

    // Step 3: Validate Benchling credentials
    spinner.start("Validating Benchling credentials...");
    const credentialValidation = await validateBenchlingCredentials(
        benchlingAnswers.tenant,
        benchlingAnswers.clientId,
        benchlingAnswers.clientSecret
    );

    if (!credentialValidation.valid) {
        spinner.fail("Benchling credential validation failed");
        console.error(chalk.red(`\n${credentialValidation.error}\n`));
        process.exit(1);
    }
    spinner.succeed("Benchling credentials validated");

    // Step 4: Create AWS secret
    spinner.start("Creating AWS Secrets Manager secret...");
    const secretName = `benchling-webhook-${benchlingAnswers.tenant}`;

    const secretsClient = new SecretsManagerClient({ region: quiltConfig.region });

    try {
        await secretsClient.send(new CreateSecretCommand({
            Name: secretName,
            Description: "Benchling webhook credentials",
            SecretString: JSON.stringify({
                client_id: benchlingAnswers.clientId,
                client_secret: benchlingAnswers.clientSecret,
                tenant: benchlingAnswers.tenant,
                app_definition_id: benchlingAnswers.appDefinitionId,
            }),
        }));
        spinner.succeed(`Secret created: ${secretName}`);
    } catch (error: any) {
        if (error.name === "ResourceExistsException") {
            spinner.info(`Secret already exists: ${secretName}`);
        } else {
            spinner.fail("Failed to create secret");
            console.error(chalk.red(`\n${error.message}\n`));
            process.exit(1);
        }
    }

    // Step 5: Deploy stack (if --deploy flag is true, default)
    if (options.deploy !== false) {
        console.log(chalk.bold("\n🚢 Deploying to AWS\n"));

        await deployStack(quiltConfig.stackArn, secretName, {
            yes: true, // Skip confirmation in wizard mode
            region: quiltConfig.region,
        });

        console.log(chalk.bold.green("\n✅ Setup Complete!\n"));
        console.log(chalk.cyan("Next steps:"));
        console.log("  1. Copy your webhook URL (shown above)");
        console.log("  2. Configure it in your Benchling app settings");
        console.log("  3. Install the app in your Benchling tenant");
        console.log("\n" + chalk.dim("For help: npx @quiltdata/benchling-webhook@latest --help"));
    } else {
        console.log(chalk.bold.green("\n✅ Configuration Complete!\n"));
        console.log(chalk.cyan("To deploy:"));
        console.log(`  npx @quiltdata/benchling-webhook@latest deploy \\`);
        console.log(`    --quilt-stack-arn "${quiltConfig.stackArn}" \\`);
        console.log(`    --benchling-secret "${secretName}"`);
    }

    // Step 6: Optionally save config locally
    if (options.save) {
        spinner.start("Saving configuration locally...");
        // Save to .benchling-webhook.json in current directory
        const fs = await import("fs");
        fs.writeFileSync(".benchling-webhook.json", JSON.stringify({
            quiltStackArn: quiltConfig.stackArn,
            benchlingSecret: secretName,
            region: quiltConfig.region,
        }, null, 2));
        spinner.succeed("Configuration saved to .benchling-webhook.json");
    }
}
```

---

### Step 4: Create Helper Modules (1-2 hours)

**bin/commands/setup-helpers/infer-quilt.ts**:
```typescript
// Extract inference logic from scripts/infer-quilt-config.ts
// Simplify for npx use (no XDG dependencies)
export async function inferQuiltConfig(): Promise<InferenceResult> {
    // 1. Try to read quilt3 config
    // 2. Extract catalog URL
    // 3. Find CloudFormation stack with matching catalog
    // 4. Extract stack outputs (bucket, queue, etc.)
    // 5. Return structured result
}
```

**bin/commands/setup-helpers/validate-benchling.ts**:
```typescript
// Extract validation logic from scripts/install-wizard.ts
export async function validateBenchlingCredentials(
    tenant: string,
    clientId: string,
    clientSecret: string
): Promise<ValidationResult> {
    // Test OAuth token endpoint
    // Return success/error
}
```

---

### Step 5: Update AGENTS.md (15 minutes)

**New AGENTS.md preamble**:

```markdown
# Benchling Webhook Integration - Developer Guide

> **For most users**: Use `npx @quiltdata/benchling-webhook@latest setup` (see [README.md](./README.md))
>
> **This guide is for**:
> - Contributors developing the project
> - Advanced users needing local testing
> - Users wanting to understand internals

## Quick Deploy (Most Users)

See [README.md](./README.md) for the simple one-command setup:
```bash
npx @quiltdata/benchling-webhook@latest setup
```

## Development Setup (Contributors)

If you're developing or contributing to this project:

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install
npm run setup  # Uses XDG config for multi-profile development
```

[Rest of AGENTS.md...]
```

---

## Benefits of This Approach

### For NPX Users (End Users)
✅ **ONE command** to rule them all
✅ **Auto-detection** of Quilt config
✅ **Validation** before deployment (catch errors early)
✅ **Secrets management** handled automatically
✅ **No manual AWS commands** needed
✅ **Clear error messages** with guidance

### For Contributors (Developers)
✅ **Same wizard logic** (DRY principle)
✅ **XDG config still available** via `npm run setup`
✅ **Multiple profiles** for dev/staging/prod
✅ **Local testing** with Docker
✅ **Clean separation** of concerns

### For Maintenance
✅ **Single source of truth** for setup logic
✅ **Both workflows use same validation**
✅ **Less documentation confusion**
✅ **Better user experience = fewer support issues**

---

## Package Size Impact

**Current package**: ~2 MB

**After changes**: ~2.1 MB (+5%)

**Why so small?**: All wizard dependencies (inquirer, AWS SDK, etc.) are ALREADY production dependencies! We're just exposing functionality that's already in the package.

---

## Testing Plan

### Test Case 1: Fresh Setup
```bash
npx @quiltdata/benchling-webhook@latest setup
```
- Verify auto-detection of Quilt config
- Verify Benchling credential validation
- Verify AWS secret creation
- Verify deployment succeeds
- Verify webhook URL is returned

### Test Case 2: Setup Without Deploy
```bash
npx @quiltdata/benchling-webhook@latest setup --no-deploy
```
- Verify secret created
- Verify deployment skipped
- Verify deploy command shown

### Test Case 3: Save Config Locally
```bash
npx @quiltdata/benchling-webhook@latest setup --save
```
- Verify .benchling-webhook.json created
- Verify can reuse config for updates

### Test Case 4: Error Handling
- Invalid Benchling credentials → Clear error message
- No Quilt config found → Helpful guidance
- AWS permission error → Actionable error message

---

## Migration Path

### Existing Workflows Continue to Work

**Current npx workflow** (still works):
```bash
npx @quiltdata/benchling-webhook@latest deploy \
  --quilt-stack-arn <arn> \
  --benchling-secret <name>
```

**Current npm workflow** (still works):
```bash
npm run setup  # For contributors with XDG config
```

### New Recommended Workflow

**For everyone**:
```bash
npx @quiltdata/benchling-webhook@latest setup
```

---

## Implementation Timeline

**Week 1**:
- Day 1-2: Move wizard to bin/commands/setup.ts
- Day 3: Create helper modules (infer, validate)
- Day 4: Test and refine
- Day 5: Update README and AGENTS.md

**Week 2**:
- Day 1-2: User testing and feedback
- Day 3-4: Polish and fix edge cases
- Day 5: Release v0.7.0 with new setup command

---

## Success Metrics

### User Experience
- Setup time reduced from **15 minutes** → **5 minutes**
- Error rate reduced by **80%** (validation catches issues early)
- Support questions reduced by **70%** (wizard handles everything)

### Adoption
- 90% of new users use `setup` command
- <5% of users need manual deployment
- Positive feedback on GitHub issues

---

## Rollout Plan

### Phase 1: Beta (Week 1)
```bash
npx @quiltdata/benchling-webhook@beta setup
```
- Invite early adopters to test
- Collect feedback
- Fix critical bugs

### Phase 2: Release (Week 2)
```bash
npx @quiltdata/benchling-webhook@latest setup
```
- Update README to make setup primary
- Announce in GitHub discussions
- Update Quilt documentation

### Phase 3: Deprecation (v1.0.0)
- Mark manual deploy as "advanced"
- Setup becomes THE way to deploy

---

## Documentation Changes

### README.md
**Before**: 150 lines of manual setup instructions
**After**: 20 lines with ONE command

### AGENTS.md
**Before**: Mixed audience (users + developers)
**After**: Pure developer focus with clear "most users, go to README" callout

---

## Summary

**What we're doing**: Make the setup wizard THE primary npx user experience

**Why**: We built amazing validation and inference logic - let's give it to ALL users!

**How**: Move wizard to bin/commands/setup.ts, compile it, make it the default workflow

**Result**: One command to configure, validate, and deploy. Simple. Fast. Reliable.

**Timeline**: 1-2 weeks to implement and test

**Impact**: Massively improved user experience, reduced support burden, clearer documentation

---

## Next Steps

1. ✅ Get approval for this approach
2. Implement bin/commands/setup.ts
3. Create helper modules
4. Update README to make setup primary
5. Test with real users
6. Release v0.7.0

**Ready to proceed?**
