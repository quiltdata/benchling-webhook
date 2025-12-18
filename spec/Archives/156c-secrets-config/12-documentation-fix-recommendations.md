# Documentation Fix Recommendations

**Goal**: Clear, actionable recommendations for fixing the README vs AGENTS.md confusion

**Priority**: High - User confusion is causing adoption friction

---

## Problem Statement

**Current Issue**: Users reading README.md see references to `npm run setup` in deployment examples, but this command is not available via npx. This creates confusion about the proper workflow.

**Example from README.md (line 239)**:

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook

# Install dependencies and configure (interactive)
npm run setup  # ← THIS IS NOT AVAILABLE VIA NPX

# Build package
npm run build
```

**Root Cause**: README.md conflates two workflows:

1. NPX deployment (primary audience)
2. Development setup (secondary audience)

---

## Recommended Changes

### Change 1: Add "Getting Started" Section to README

**Location**: After "Prerequisites" section (after line 11)

**Add New Section**:

```markdown
## Getting Started: Choose Your Workflow

This project supports two workflows depending on your use case:

### 🚀 Quick Deployment (NPX - Recommended for most users)

**Use this if you:**
- Want to deploy quickly without cloning the repository
- Don't need local testing or development features
- Are comfortable with minimal configuration validation

**Workflow Overview:**
1. Generate Benchling manifest
2. Create Benchling app and get credentials
3. Create AWS secret with credentials
4. Deploy to AWS

👉 **Continue to [Setup](#setup) section below**

---

### 🛠️ Development & Advanced Features (Git Clone)

**Use this if you:**
- Want interactive setup wizard with credential validation
- Need local integration testing with Docker
- Are contributing to the project
- Want XDG-compliant configuration storage
- Need multiple deployment profiles

**Workflow Overview:**
1. Clone repository
2. Run interactive setup wizard (`npm run setup`)
3. Test locally with Docker
4. Deploy to AWS

👉 **Skip to [Development](#development) section below**

---

💡 **Not sure which to choose?** Start with NPX workflow. You can always clone the repo later for advanced features.
```

---

### Change 2: Clarify "Setup" Section for NPX Users

**Location**: Current "Setup" section (lines 12-70)

**Update Section Header**:

```markdown
## Setup (NPX Workflow)

> **Note**: This section is for NPX users (quick deployment). If you're developing or want advanced features, see [Development](#development) section.
```

**Clarify Step 1**:

```markdown
### 1. Create Benchling App

Generate the Benchling app manifest (no installation required):

```bash
npx @quiltdata/benchling-webhook manifest
```

This creates `app-manifest.yaml` in your current directory.

Follow the displayed instructions to [upload the manifest](https://docs.benchling.com/docs/getting-started-benchling-apps#creating-an-app-from-a-manifest) to Benchling and get your:

- OAuth Client ID
- OAuth Client Secret
- App Definition ID

```

**Clarify Step 2**:

```markdown
### 2. Store Benchling Secrets in AWS Secrets Manager

Create a secret in AWS Secrets Manager with your Benchling credentials:

```bash
aws secretsmanager create-secret \
  --name benchling-webhook-credentials \
  --description "Benchling OAuth credentials" \
  --secret-string '{
    "client_id": "your-benchling-client-id",
    "client_secret": "your-benchling-client-secret",
    "tenant": "your-tenant",
    "app_definition_id": "your-app-definition-id"
  }'
```

> **Note**: Replace `your-tenant` with your Benchling tenant name (e.g., "acme" if you login at acme.benchling.com)

> **Tip**: The secret must contain `client_id`, `client_secret`, and `tenant`. The `app_definition_id` is optional but recommended.

**Alternative: Use `.env` file with `init` command (optional)**

If you prefer to configure interactively:

```bash
npx @quiltdata/benchling-webhook init
```

This will prompt you for configuration and create a `.env` file. Then create the secret from the file:

```bash
# After running init, create secret from .env values
aws secretsmanager create-secret \
  --name benchling-webhook-credentials \
  --description "Benchling OAuth credentials" \
  --secret-string "$(cat .env | grep BENCHLING | jq -Rs 'split("\n") | map(select(length > 0) | split("=")) | map({key: .[0] | sub("BENCHLING_"; "") | ascii_downcase, value: .[1]}) | from_entries')"
```

```

**Clarify Step 3**:

```markdown
### 3. Deploy to AWS (Secrets-Only Mode)

Deploy using the minimal configuration approach:

```bash
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc123" \
  --benchling-secret "benchling-webhook-credentials"
```

> **Finding your Quilt Stack ARN:**
>
> ```bash
> # List CloudFormation stacks containing "Quilt"
> aws cloudformation describe-stacks \
>   --query 'Stacks[?contains(StackName, `Quilt`)].StackId' \
>   --output text
> ```
>
> Or find it in AWS Console → CloudFormation → Your Stack → Stack info → ARN

**What happens during deployment:**

1. ✅ Validates your Quilt stack ARN
2. ✅ Checks if the Benchling secret exists in Secrets Manager
3. ✅ Verifies CDK is bootstrapped in your AWS account
4. ✅ Deploys API Gateway, ALB, Fargate, and supporting resources
5. ✅ Returns your webhook URL

**Deployment takes ~10-15 minutes**. After completion, you'll see:

- Webhook URL (use this in Benchling app settings)
- CloudWatch log group name (for debugging)

```

---

### Change 3: Move Development Section to End

**Location**: After "All Available Commands" section (after line 188)

**Rename and Restructure**:

```markdown
## Development & Advanced Features

> **Note**: This section is for developers and users who want advanced features like local testing, interactive setup wizard, and XDG-compliant configuration.

### Prerequisites (Additional)

In addition to the [main prerequisites](#prerequisites), you'll need:
- Git
- Python 3.x (for Docker container)
- Docker Desktop
- Make (for build automation)

### 1. Clone Repository

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
```

### 2. Interactive Setup Wizard

Run the comprehensive setup wizard with credential validation:

```bash
npm run setup
```

This interactive wizard will:

1. ✅ **Infer Quilt configuration** from `quilt3 config`
2. ✅ **Detect Quilt stack ARN** from CloudFormation
3. ✅ **Validate Benchling credentials** with OAuth token test
4. ✅ **Verify S3 bucket access** with read/write tests
5. ✅ **Sync secrets to AWS Secrets Manager** automatically
6. ✅ **Save configuration** to `~/.config/benchling-webhook/default.json`

**What you'll need:**

- Benchling tenant, client ID, client secret, app definition ID
- AWS credentials configured (via `aws configure` or `AWS_PROFILE`)
- Access to your Quilt S3 bucket

**Configuration is stored in XDG-compliant location:**

- macOS/Linux: `~/.config/benchling-webhook/default.json`
- Windows: `%APPDATA%\benchling-webhook\default.json`

### 3. Test Locally

Test the Flask webhook processor locally with Docker:

```bash
npm run test           # Unit tests (lint + typecheck + mocked tests)
npm run test:local     # Local integration (build Docker + real Benchling)
```

### 4. Deploy to Dev Environment

Deploy an isolated dev stack for testing:

```bash
npm run deploy:dev     # Deploys dev stack + runs integration tests
```

### 5. Deploy to Production

After testing, deploy to production:

```bash
npm run deploy:prod
```

### Additional Commands

```bash
npm run setup:infer          # Re-infer Quilt configuration
npm run setup:sync-secrets   # Sync secrets to AWS
npm run setup:health         # Validate configuration health
npm run test:remote          # Remote integration test (deploys dev stack)
npm run release:tag          # Create version tag (for maintainers)
```

### Configuration Management

**View current configuration:**

```bash
cat ~/.config/benchling-webhook/default.json
```

**Use multiple profiles:**

```bash
npm run setup -- --profile staging
npm run deploy:prod -- --profile staging
```

**Health check:**

```bash
npm run setup:health
```

**Re-sync secrets after updating config:**

```bash
npm run setup:sync-secrets
```

For complete development workflow documentation, see [AGENTS.md](./AGENTS.md).

```

---

### Change 4: Update "All Available Commands" Section

**Location**: Current line 172

**Replace with Clearer Structure**:

```markdown
## Available Commands

### NPX Commands (No Installation Required)

For quick deployment and basic operations:

```bash
# Get help
npx @quiltdata/benchling-webhook --help

# Generate Benchling app manifest
npx @quiltdata/benchling-webhook manifest

# Interactive configuration (creates .env file)
npx @quiltdata/benchling-webhook init

# Validate configuration
npx @quiltdata/benchling-webhook validate

# Deploy to AWS (default command)
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn <arn> \
  --benchling-secret <name>

# Test deployed webhook
npx @quiltdata/benchling-webhook test --url <webhook-url>
```

### NPM Commands (Repository Required)

For development and advanced features (requires `git clone`):

```bash
# Setup & Configuration
npm run setup                # Interactive setup wizard
npm run setup:infer          # Infer Quilt config
npm run setup:sync-secrets   # Sync secrets to AWS
npm run setup:health         # Validate configuration

# Testing
npm run test                 # Unit tests (lint + typecheck + mocked)
npm run test:local           # Local integration (Docker + real Benchling)
npm run test:remote          # Remote integration (deploy dev + test)
npm run build:typecheck      # TypeScript type checking only
npm run lint                 # Linting and auto-fix

# Deployment
npm run deploy:dev           # Deploy dev stack (full workflow)
npm run deploy:prod          # Deploy production stack

# Release (Maintainers)
npm run release:tag          # Create version tag
npm run release              # Full release workflow
```

### Command Comparison

| Task | NPX Command | NPM Command |
| ------ | ------------- | ------------- |
| Generate manifest | `npx ... manifest` | N/A (use npx) |
| Setup configuration | `npx ... init` (basic) | `npm run setup` (advanced) |
| Deploy to AWS | `npx ... deploy` | `npm run deploy:prod` |
| Test webhook | `npx ... test` | `npm run test:remote` |
| Local testing | ❌ Not available | `npm run test:local` |
| Health check | ❌ Not available | `npm run setup:health` |

💡 **Tip**: Start with NPX commands for quick deployment. Clone the repository later if you need advanced features.

```

---

### Change 5: Add "When to Use Which" Section

**Location**: After "Configuration" section, before "All Available Commands"

**Add New Section**:

```markdown
## NPX vs Development: When to Use Which?

### Use NPX Workflow If:

✅ You want to **deploy quickly** without cloning the repository
✅ You have **simple, one-time deployment** needs
✅ You're comfortable with **manual AWS secret creation**
✅ You **trust your configuration** (minimal validation)
✅ You **don't need local testing**

**Limitations**:
- ❌ No interactive setup wizard
- ❌ No automatic credential validation
- ❌ No local Docker testing
- ❌ No XDG config profiles

### Use Development Workflow (Git Clone) If:

✅ You want **comprehensive setup** with validation
✅ You need **local integration testing**
✅ You want **automatic credential validation**
✅ You're **contributing** to the project
✅ You prefer **XDG-compliant configuration**
✅ You need **multiple deployment profiles**

**Advantages**:
- ✅ Interactive setup wizard
- ✅ Benchling OAuth validation
- ✅ S3 bucket verification
- ✅ Local Docker testing
- ✅ Health checks
- ✅ Profile management

### Migration Path

**Started with NPX, want advanced features?**

```bash
# Clone the repository
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook

# Install dependencies
npm install

# Run setup wizard (will detect existing .env if present)
npm run setup

# Now use npm commands
npm run test:local
npm run deploy:dev
```

See [Development](#development-advanced-features) section for full details.

```

---

### Change 6: Update AGENTS.md Cross-Reference

**Location**: AGENTS.md line 1

**Add Preamble**:

```markdown
# Benchling Webhook Integration - Developer Guide

> **👥 Audience**: This guide is for **contributors and advanced users** who want to develop, test, or use advanced features locally.
>
> **🚀 For quick deployment**: See [README.md](./README.md) for the NPX workflow (no repository clone needed).
>
> **📋 What's the difference?**
> - **README.md** = NPX workflow for end users (quick deployment)
> - **AGENTS.md** = Development workflow for contributors (comprehensive setup)
>
> See [Feature Comparison](./spec/156c-secrets-config/11-npx-vs-npm-feature-comparison.md) for details.

---

# Benchling Webhook Integration - Developer Guide

[Rest of AGENTS.md content...]
```

---

### Change 7: Add Troubleshooting Section

**Location**: After "Troubleshooting" section (line 276)

**Expand Troubleshooting**:

```markdown
## Troubleshooting

### Common Issues

#### **Issue: "npx command not found"**

**Solution**: Install Node.js 18+ from [nodejs.org](https://nodejs.org)

```bash
node --version  # Should be 18.0.0 or higher
```

---

#### **Issue: "npm run setup: command not found"**

**Problem**: You're trying to use npm commands without cloning the repository.

**Solution**: Either:

1. **Use NPX workflow** (no clone needed):

   ```bash
   npx @quiltdata/benchling-webhook init
   npx @quiltdata/benchling-webhook deploy --quilt-stack-arn <arn>
   ```

2. **Clone repository** for npm commands:

   ```bash
   git clone https://github.com/quiltdata/benchling-webhook.git
   cd benchling-webhook
   npm install
   npm run setup
   ```

**See**: [When to Use Which](#npx-vs-development-when-to-use-which) section

---

#### **Issue: "Invalid secret ARN format"**

**Problem**: Wrong secret parameter format

**Solution**: Use secret **name** (not full ARN) for v0.6.0+:

```bash
# ✅ Correct (v0.6.0+)
--benchling-secret "benchling-webhook-credentials"

# ❌ Wrong (old format)
--benchling-secret "arn:aws:secretsmanager:us-east-1:123:secret:name"
```

---

#### **Issue: "Missing required field: client_id"**

**Problem**: Secret in AWS Secrets Manager is missing required fields

**Solution**: Verify secret contains all required fields:

```bash
aws secretsmanager get-secret-value \
  --secret-id benchling-webhook-credentials \
  --query SecretString \
  --output text | jq .
```

**Required fields**:

```json
{
  "client_id": "...",
  "client_secret": "...",
  "tenant": "..."
}
```

**Update secret**:

```bash
aws secretsmanager update-secret \
  --secret-id benchling-webhook-credentials \
  --secret-string '{
    "client_id": "your-id",
    "client_secret": "your-secret",
    "tenant": "your-tenant",
    "app_definition_id": "your-app-id"
  }'
```

---

#### **Issue: "Cannot find Quilt stack ARN"**

**Problem**: Don't know where to find the ARN

**Solution**: Use AWS CLI:

```bash
# Find all CloudFormation stacks with "Quilt" in the name
aws cloudformation describe-stacks \
  --query 'Stacks[?contains(StackName, `Quilt`)].{Name:StackName, ARN:StackId}' \
  --output table
```

Or find in AWS Console:

1. Navigate to CloudFormation
2. Select your Quilt stack
3. Stack info → ARN (copy the full ARN)

---

#### **Issue: "CDK is not bootstrapped"**

**Problem**: CDK needs one-time setup in your AWS account/region

**Solution**: Bootstrap CDK:

```bash
# The deploy command will show the exact command, but typically:
npx cdk bootstrap aws://ACCOUNT-ID/REGION
```

**Example**:

```bash
npx cdk bootstrap aws://123456789012/us-east-1
```

This is a **one-time operation** per account/region combination.

---

### Getting More Help

- 📖 [Full Documentation](./docs/)
- 🐛 [Report Issues](https://github.com/quiltdata/benchling-webhook/issues)
- 💬 [Discussions](https://github.com/quiltdata/benchling-webhook/discussions)
- 📧 Security: <security@quiltdata.com>

**For development issues**: See [AGENTS.md](./AGENTS.md)

```

---

## Implementation Plan

### Phase 1: Immediate (Documentation Only)

**Priority**: P0 (Critical for user clarity)

**Tasks**:
1. ✅ Add "Getting Started: Choose Your Workflow" section
2. ✅ Update "Setup" section headers to clarify NPX focus
3. ✅ Add "When to Use Which" section
4. ✅ Move Development section to end
5. ✅ Expand troubleshooting section
6. ✅ Update AGENTS.md preamble

**Estimated Effort**: 2-3 hours

**Files to Update**:
- `README.md`
- `AGENTS.md`

### Phase 2: Short-Term (Code Enhancements)

**Priority**: P1 (Improves user experience)

**Tasks**:
1. Enhance `bin/commands/init.ts` with `--infer` flag
2. Add `--validate` flag to test credentials
3. Add `--sync-secrets` flag for AWS sync
4. Update CLI help text
5. Add examples to CLI output

**Estimated Effort**: 1-2 days

**Files to Update**:
- `bin/commands/init.ts`
- `bin/cli.ts`

### Phase 3: Long-Term (Optional)

**Priority**: P2 (Nice-to-have)

**Tasks**:
1. Create unified setup experience
2. Add health check to npx CLI
3. Consider publishing separate dev package
4. Add telemetry for usage patterns

**Estimated Effort**: 1-2 weeks

---

## Success Metrics

**How to measure success**:

1. **User Issues Reduced**
   - Track GitHub issues mentioning "npm run setup" confusion
   - Target: 80% reduction in setup-related issues

2. **Documentation Clarity**
   - User surveys: "Was it clear which workflow to use?"
   - Target: 90% "yes" responses

3. **Adoption Rate**
   - NPX downloads vs git clones
   - Track which workflow users choose

4. **Support Time**
   - Average time to resolve setup issues
   - Target: 50% reduction

---

## Review Checklist

Before implementing, verify:

- [ ] Clear distinction between NPX and NPM workflows
- [ ] No references to `npm run setup` in NPX workflow sections
- [ ] Migration path documented
- [ ] Troubleshooting covers common issues
- [ ] Examples are accurate and tested
- [ ] Links between README and AGENTS.md are correct
- [ ] Both workflows are presented as valid (not one better than other)

---

## Conclusion

**Key Principle**: Both NPX and NPM workflows are **intentional and valuable**. The documentation should:

1. ✅ Clearly distinguish the two workflows
2. ✅ Help users choose the right one
3. ✅ Document limitations and advantages of each
4. ✅ Provide migration path between workflows

**Not**: Deprecate one in favor of the other.
