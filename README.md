# Benchling Webhook Integration for Quilt

Connects Benchling lab notebook entries to Quilt data packages via webhooks.

## BREAKING CHANGE: v0.7.0

Version 0.7.0 introduces a completely new configuration architecture. If you are upgrading from v0.6.x, **you must reconfigure your deployment**. See [Migration Guide](#migration-from-v06x) below.

## Prerequisites

- Node.js 18+ with `npx` ([download](https://nodejs.org))
- [AWS credentials](https://docs.aws.amazon.com/cli/v1/userguide/cli-configure-files.html) configured
- Existing [Quilt deployment](https://www.quilt.bio/install)
- Benchling tenant with OAuth app configured

## Quick Start

Run the guided setup wizard:

```bash
npx @quiltdata/benchling-webhook@latest
```

The wizard will:

1. Detect your Quilt stack from AWS CloudFormation
2. Collect and validate your Benchling credentials
3. Sync secrets to AWS Secrets Manager
4. Deploy to AWS

After deployment, install the webhook URL in your [Benchling app settings](https://docs.benchling.com/docs/getting-started-benchling-apps#installing-your-app).

## Usage

In Benchling: Create entry → Insert Canvas → "Quilt Integration" → Create/Update package

## Configuration Structure (v0.7.0+)

Profiles are stored in `~/.config/benchling-webhook/{profile}/`:

```
~/.config/benchling-webhook/
├── default/
│   ├── config.json          # All configuration settings
│   └── deployments.json     # Deployment history and tracking
├── dev/                     # Optional: development profile
│   ├── config.json
│   └── deployments.json
└── prod/                    # Optional: separate production profile
    ├── config.json
    └── deployments.json
```

### Profile-Based Configuration

**Profile**: A named set of configuration values (credentials, settings, etc.)

**Stage**: An API Gateway deployment target (`dev`, `prod`, `staging`, etc.)

Profiles and stages are independent - you can deploy any profile to any stage.

## Multi-Environment Deployments

### For End Users (Single Environment)

Most users only need production:

```bash
npx @quiltdata/benchling-webhook@latest        # Setup production profile
npx @quiltdata/benchling-webhook@latest deploy # Deploy to production
npx @quiltdata/benchling-webhook@latest test   # Test production
```

### For Maintainers (Dev + Production)

Create side-by-side dev and production environments:

```bash
# Initial setup (one-time)
npx @quiltdata/benchling-webhook@latest setup                       # Setup default profile
npx @quiltdata/benchling-webhook@latest setup-profile dev --inherit # Setup dev profile

# Edit dev profile to override:
# - benchling.appDefinitionId (different Benchling app for dev)
# - deployment.imageTag ("latest" for dev, semantic version for prod)

# Deploy both environments
npx @quiltdata/benchling-webhook@latest deploy --profile dev --stage dev     # Deploy dev
npx @quiltdata/benchling-webhook@latest deploy --profile default --stage prod # Deploy prod

# Test both environments
npx @quiltdata/benchling-webhook@latest test --profile dev    # Test dev
npx @quiltdata/benchling-webhook@latest test --profile default # Test prod
```

### Architecture

```
Single AWS Stack: BenchlingWebhookStack
├── API Gateway (shared)
│   ├── Stage: dev  → https://xxx.amazonaws.com/dev/event
│   └── Stage: prod → https://xxx.amazonaws.com/prod/event
├── ALB (shared)
│   ├── Target Group: dev-targets  → ECS Service: benchling-webhook-dev
│   └── Target Group: prod-targets → ECS Service: benchling-webhook-prod
├── ECS Cluster (shared)
│   ├── Service: benchling-webhook-dev  (imageTag: latest)
│   └── Service: benchling-webhook-prod (imageTag: v0.7.0)
└── VPC, Secrets Manager, CloudWatch (shared)
```

## Available Commands

```bash
npx @quiltdata/benchling-webhook@latest --help              # Show all commands
npx @quiltdata/benchling-webhook@latest setup               # Initial setup (creates default profile)
npx @quiltdata/benchling-webhook@latest setup-profile dev   # Create dev profile
npx @quiltdata/benchling-webhook@latest deploy              # Deploy default profile to prod stage
npx @quiltdata/benchling-webhook@latest deploy --profile dev --stage dev # Deploy dev profile to dev stage
npx @quiltdata/benchling-webhook@latest test                # Test deployed integration
npx @quiltdata/benchling-webhook@latest manifest            # Generate Benchling app manifest
```

## Migration from v0.6.x

**IMPORTANT: Version 0.7.0 is a BREAKING CHANGE release.**

The configuration structure has completely changed. There is **NO automatic migration**. You must manually reconfigure your deployment.

### Step-by-Step Upgrade Guide

1. **Before upgrading, save your current configuration:**

   ```bash
   # Save your current settings for reference
   cat ~/.config/benchling-webhook/default.json > ~/benchling-config-backup.json
   cat ~/.config/benchling-webhook/deploy.json >> ~/benchling-config-backup.json
   ```

2. **Install v0.7.0:**

   ```bash
   npm install -g @quiltdata/benchling-webhook@0.7.0
   # or use npx
   npx @quiltdata/benchling-webhook@0.7.0
   ```

3. **Run setup wizard to create new configuration:**

   ```bash
   npx @quiltdata/benchling-webhook@latest setup
   ```

   The wizard will prompt you to re-enter your configuration. Reference your backup file for settings.

4. **For multi-environment setups, create additional profiles:**

   ```bash
   npx @quiltdata/benchling-webhook@latest setup-profile dev --inherit
   ```

5. **Test your deployment:**

   ```bash
   npx @quiltdata/benchling-webhook@latest deploy --profile default --stage prod
   npx @quiltdata/benchling-webhook@latest test --profile default
   ```

6. **Optional: Clean up old configuration files:**

   Old configuration files are not used by v0.7.0 but remain for reference:
   - `~/.config/benchling-webhook/default.json` (old user config)
   - `~/.config/benchling-webhook/deploy.json` (old deployment tracking)
   - `~/.config/benchling-webhook/profiles/` (old profiles directory)

   You can safely delete these after verifying your new deployment works.

### What Changed in v0.7.0

| v0.6.x | v0.7.0 |
|--------|--------|
| `~/.config/benchling-webhook/default.json` | `~/.config/benchling-webhook/default/config.json` |
| `~/.config/benchling-webhook/profiles/dev/default.json` | `~/.config/benchling-webhook/dev/config.json` |
| `~/.config/benchling-webhook/deploy.json` (shared) | `~/.config/benchling-webhook/{profile}/deployments.json` (per-profile) |

For detailed migration information, see [MIGRATION.md](./MIGRATION.md).

## Cost Information

Running multiple environments increases infrastructure costs:

| Configuration | Monthly Cost | Notes |
|---------------|--------------|-------|
| **Single environment** | $70-100 | Production only |
| **Dual environment** | $85-145 | +15-45% for dev environment |

**Cost breakdown:**
- ALB: ~$23 (shared between environments)
- NAT Gateway: ~$32 (shared between environments)
- ECS Fargate: ~$15-45 per environment (scales with usage)

## Resources

- [Changelog](./CHANGELOG.md) - Version history
- [Migration Guide](./MIGRATION.md) - Upgrading from v0.6.x to v0.7.0
- [Report Issues](https://github.com/quiltdata/benchling-webhook/issues)

## License

Apache-2.0
