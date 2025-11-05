# Migration Guide: v0.6.x to v0.7.0

## BREAKING CHANGE WARNING

Version 0.7.0 introduces a complete redesign of the configuration architecture. **There is NO automatic migration**. You must manually reconfigure your deployment using the setup wizard.

## Why This Breaking Change?

The v0.6.x configuration system had accumulated significant technical debt:

1. **Inconsistent directory structure** - Mix of root-level and nested configuration files
2. **Shared deployment tracking** - Single `deploy.json` file conflated profiles with deployment stages
3. **Unclear profile/stage separation** - Couldn't deploy a dev profile to prod stage (or vice versa)
4. **Over-engineered config types** - Three-tier system (user/derived/deploy) that was rarely used correctly
5. **Manual profile merging** - Fallback logic scattered across codebase

Version 0.7.0 provides a clean, maintainable architecture with:

- **Profile-first design** - Each profile is self-contained
- **Per-profile deployment tracking** - Each profile tracks its own deployments
- **Profile/stage independence** - Deploy any profile to any stage
- **Single configuration file** - One `config.json` per profile
- **Explicit inheritance** - Opt-in profile inheritance with `_inherits` field

## What Changed

### Configuration File Locations

| v0.6.x | v0.7.0 |
|--------|--------|
| `~/.config/benchling-webhook/default.json` | `~/.config/benchling-webhook/default/config.json` |
| `~/.config/benchling-webhook/profiles/dev/default.json` | `~/.config/benchling-webhook/dev/config.json` |
| `~/.config/benchling-webhook/deploy.json` | `~/.config/benchling-webhook/{profile}/deployments.json` |
| `~/.config/benchling-webhook/config/default.json` | (Removed - no longer used) |

### Directory Structure

**v0.6.x (old):**

```
~/.config/benchling-webhook/
├── default.json              # User config for default profile
├── config/
│   └── default.json          # Derived config (rarely used)
├── deploy/                   # Empty (never used)
├── deploy.json               # Shared deployment tracking (all profiles)
└── profiles/
    ├── dev/
    │   ├── default.json      # User config for dev profile
    │   ├── config/           # Empty (never used)
    │   └── deploy/           # Empty (never used)
    └── custom/
        └── default.json
```

**v0.7.0 (new):**

```
~/.config/benchling-webhook/
├── default/
│   ├── config.json           # All configuration for default profile
│   └── deployments.json      # Deployment history for default profile
├── dev/
│   ├── config.json           # All configuration for dev profile
│   └── deployments.json      # Deployment history for dev profile
└── custom/
    ├── config.json           # All configuration for custom profile
    └── deployments.json      # Deployment history for custom profile
```

### Configuration Schema

**v0.6.x** used flat key-value structure:

```json
{
  "quiltStackArn": "arn:aws:cloudformation:...",
  "quiltCatalog": "https://example.quiltdata.com",
  "quiltUserBucket": "quilt-example",
  "benchlingTenant": "example",
  "benchlingClientId": "...",
  "benchlingPkgBucket": "benchling-packages",
  "imageTag": "latest"
}
```

**v0.7.0** uses nested, organized structure:

```json
{
  "quilt": {
    "stackArn": "arn:aws:cloudformation:...",
    "catalog": "https://example.quiltdata.com",
    "bucket": "quilt-example",
    "database": "quilt_example",
    "queueArn": "arn:aws:sqs:...",
    "region": "us-east-1"
  },
  "benchling": {
    "tenant": "example",
    "clientId": "...",
    "secretArn": "arn:aws:secretsmanager:...",
    "appDefinitionId": "app_...",
    "testEntryId": "etr_..."
  },
  "packages": {
    "bucket": "benchling-packages",
    "prefix": "benchling",
    "metadataKey": "experiment_id"
  },
  "deployment": {
    "region": "us-east-1",
    "account": "123456789012",
    "imageTag": "latest"
  },
  "logging": {
    "level": "INFO"
  },
  "security": {
    "enableVerification": true
  },
  "_metadata": {
    "version": "0.7.0",
    "createdAt": "2025-11-04T10:00:00Z",
    "updatedAt": "2025-11-04T10:00:00Z",
    "source": "wizard"
  }
}
```

### Field Name Mapping

| v0.6.x Field | v0.7.0 Field |
|--------------|--------------|
| `quiltStackArn` | `quilt.stackArn` |
| `quiltCatalog` | `quilt.catalog` |
| `quiltUserBucket` | `quilt.bucket` |
| `quiltDatabase` | `quilt.database` |
| `quiltQueueArn` | `quilt.queueArn` |
| `benchlingTenant` | `benchling.tenant` |
| `benchlingClientId` | `benchling.clientId` |
| `benchlingClientSecret` | (Stored in AWS Secrets Manager) |
| `benchlingSecretArn` | `benchling.secretArn` |
| `benchlingAppDefinitionId` | `benchling.appDefinitionId` |
| `benchlingTestEntry` | `benchling.testEntryId` |
| `benchlingPkgBucket` | `packages.bucket` |
| `benchlingPkgPrefix` | `packages.prefix` |
| `benchlingPkgKey` | `packages.metadataKey` |
| `imageTag` | `deployment.imageTag` |
| `region` | `deployment.region` |
| `awsAccountId` | `deployment.account` |

### Deployment Tracking

**v0.6.x** used shared `deploy.json`:

```json
{
  "prod": {
    "endpoint": "https://xxx.amazonaws.com/prod",
    "imageTag": "0.6.3"
  },
  "dev": {
    "endpoint": "https://xxx.amazonaws.com/dev",
    "imageTag": "latest"
  }
}
```

**v0.7.0** uses per-profile `deployments.json`:

```json
{
  "active": {
    "prod": {
      "endpoint": "https://xxx.amazonaws.com/prod",
      "imageTag": "0.7.0",
      "deployedAt": "2025-11-03T14:20:00Z"
    }
  },
  "history": [
    {
      "stage": "prod",
      "timestamp": "2025-11-03T14:20:00Z",
      "imageTag": "0.7.0",
      "endpoint": "https://xxx.amazonaws.com/prod",
      "stackName": "BenchlingWebhookStack",
      "region": "us-east-1"
    }
  ]
}
```

## Migration Steps

### Step 1: Backup Your Current Configuration

Before upgrading, save your existing configuration for reference:

```bash
# Backup default profile configuration
cat ~/.config/benchling-webhook/default.json > ~/benchling-v0.6-default.json

# Backup deployment tracking
cat ~/.config/benchling-webhook/deploy.json > ~/benchling-v0.6-deploy.json

# If using multiple profiles, backup each one
cat ~/.config/benchling-webhook/profiles/dev/default.json > ~/benchling-v0.6-dev.json
cat ~/.config/benchling-webhook/profiles/prod/default.json > ~/benchling-v0.6-prod.json
```

### Step 2: Document Your Current Deployment

Make note of:

1. Your deployment endpoints (from `deploy.json`)
2. Image tags for each environment
3. Any custom settings or overrides
4. AWS account ID and region

### Step 3: Install v0.7.0

```bash
npm install -g @quiltdata/benchling-webhook@0.7.0

# Or use npx (recommended)
npx @quiltdata/benchling-webhook@0.7.0
```

### Step 4: Run Setup Wizard

The setup wizard will create a new `default` profile:

```bash
npx @quiltdata/benchling-webhook@latest setup
```

You'll be prompted to enter:

1. **Quilt Configuration** (auto-detected from CloudFormation)
   - Stack ARN
   - Catalog URL
   - User bucket
   - Database name
   - Queue ARN

2. **Benchling Configuration**
   - Tenant name
   - OAuth client ID and secret
   - App definition ID
   - Test entry ID (optional)

3. **Package Configuration**
   - S3 bucket for packages
   - Key prefix (default: `benchling`)
   - Metadata key (default: `experiment_id`)

4. **Deployment Configuration**
   - AWS region
   - Image tag (e.g., `0.7.0` for production)

5. **Optional Settings**
   - Log level
   - Webhook verification
   - IP allowlist

**Tip:** Reference your backup files (`~/benchling-v0.6-*.json`) to copy settings.

### Step 5: Verify Configuration

Check the generated configuration:

```bash
cat ~/.config/benchling-webhook/default/config.json
```

Ensure all fields match your previous configuration.

### Step 6: Create Additional Profiles (If Needed)

If you had multiple profiles in v0.6.x, create them in v0.7.0:

#### For development profile:

```bash
npx @quiltdata/benchling-webhook@latest setup-profile dev --inherit
```

This creates a dev profile that inherits from `default`. You'll only need to override:

- `benchling.appDefinitionId` (different Benchling app for dev)
- `deployment.imageTag` (e.g., `latest` instead of version number)

#### For production profile (if separate from default):

```bash
npx @quiltdata/benchling-webhook@latest setup-profile prod --inherit
```

### Step 7: Manually Edit Profiles (If Needed)

If the wizard doesn't capture all your settings, manually edit the configuration:

```bash
# Edit default profile
vi ~/.config/benchling-webhook/default/config.json

# Edit dev profile
vi ~/.config/benchling-webhook/dev/config.json
```

### Step 8: Sync Secrets to AWS

Ensure your secrets are synced to AWS Secrets Manager:

```bash
npm run setup:sync-secrets
```

### Step 9: Test Configuration

Validate your configuration:

```bash
npm run setup:health
```

### Step 10: Deploy

Deploy your stack using the new configuration:

```bash
# Deploy default profile to production
npx @quiltdata/benchling-webhook@latest deploy --profile default --stage prod

# Deploy dev profile to dev
npx @quiltdata/benchling-webhook@latest deploy --profile dev --stage dev
```

### Step 11: Verify Deployment

Test your deployed webhook:

```bash
# Test production
npx @quiltdata/benchling-webhook@latest test --profile default

# Test dev
npx @quiltdata/benchling-webhook@latest test --profile dev
```

### Step 12: Clean Up Old Configuration (Optional)

After verifying v0.7.0 works, you can delete old configuration files:

```bash
# Remove old configuration files
rm ~/.config/benchling-webhook/default.json
rm ~/.config/benchling-webhook/deploy.json
rm -rf ~/.config/benchling-webhook/config
rm -rf ~/.config/benchling-webhook/deploy
rm -rf ~/.config/benchling-webhook/profiles

# Keep backups safe
# Do NOT delete ~/benchling-v0.6-*.json files yet
```

## Example Migration Scenarios

### Scenario 1: Single Environment (Production Only)

**v0.6.x setup:**

```
~/.config/benchling-webhook/
├── default.json              # Production config
└── deploy.json               # { "prod": {...} }
```

**Migration:**

```bash
# 1. Backup
cat ~/.config/benchling-webhook/default.json > ~/benchling-v0.6-backup.json

# 2. Install v0.7.0
npx @quiltdata/benchling-webhook@0.7.0

# 3. Run setup wizard
npx @quiltdata/benchling-webhook@latest setup

# 4. Deploy
npx @quiltdata/benchling-webhook@latest deploy --profile default --stage prod

# 5. Test
npx @quiltdata/benchling-webhook@latest test --profile default
```

**Result:**

```
~/.config/benchling-webhook/
└── default/
    ├── config.json           # Production config
    └── deployments.json      # Deployment tracking
```

### Scenario 2: Multi-Environment (Dev + Production)

**v0.6.x setup:**

```
~/.config/benchling-webhook/
├── default.json              # Production config
├── profiles/
│   └── dev/
│       └── default.json      # Dev config
└── deploy.json               # { "prod": {...}, "dev": {...} }
```

**Migration:**

```bash
# 1. Backup
cat ~/.config/benchling-webhook/default.json > ~/benchling-v0.6-prod.json
cat ~/.config/benchling-webhook/profiles/dev/default.json > ~/benchling-v0.6-dev.json
cat ~/.config/benchling-webhook/deploy.json > ~/benchling-v0.6-deploy.json

# 2. Install v0.7.0
npx @quiltdata/benchling-webhook@0.7.0

# 3. Setup default profile (production)
npx @quiltdata/benchling-webhook@latest setup
# Enter production settings, use imageTag: "0.7.0"

# 4. Setup dev profile (inherits from default)
npx @quiltdata/benchling-webhook@latest setup-profile dev --inherit
# Override only: benchling.appDefinitionId, deployment.imageTag: "latest"

# 5. Deploy both environments
npx @quiltdata/benchling-webhook@latest deploy --profile default --stage prod
npx @quiltdata/benchling-webhook@latest deploy --profile dev --stage dev

# 6. Test both environments
npx @quiltdata/benchling-webhook@latest test --profile default
npx @quiltdata/benchling-webhook@latest test --profile dev
```

**Result:**

```
~/.config/benchling-webhook/
├── default/
│   ├── config.json           # Production config
│   └── deployments.json      # Production deployments
└── dev/
    ├── config.json           # Dev config (inherits from default)
    └── deployments.json      # Dev deployments
```

## Troubleshooting

### Error: "Profile not found: default"

This means you haven't run the setup wizard yet or the configuration is in the wrong location.

**Solution:**

```bash
npx @quiltdata/benchling-webhook@latest setup
```

### Error: Legacy configuration detected

If you try to use old configuration files, you'll see:

```
Configuration format changed in v0.7.0.
Your old configuration files are not compatible.

Please run setup wizard to create new configuration:
  npx @quiltdata/benchling-webhook@latest setup
```

**Solution:** Follow the migration steps above. There is no automatic conversion.

### Missing secrets in AWS Secrets Manager

After reconfiguration, sync secrets:

```bash
npm run setup:sync-secrets
```

### Deployment tracking missing

If `deployments.json` doesn't exist, it will be created automatically on first deployment:

```bash
npx @quiltdata/benchling-webhook@latest deploy --profile default --stage prod
```

### Profile inheritance not working

Ensure `_inherits` field is set correctly:

```bash
# Check dev profile
cat ~/.config/benchling-webhook/dev/config.json | grep "_inherits"

# Should show:
# "_inherits": "default"
```

If missing, manually edit the file or re-run setup wizard:

```bash
npx @quiltdata/benchling-webhook@latest setup-profile dev --inherit
```

## FAQ

### Q: Can I keep v0.6.x and v0.7.0 configurations side-by-side?

**A:** Yes! The old configuration files are completely ignored by v0.7.0. You can keep both versions installed:

```bash
# Use v0.6.3 (old config)
npx @quiltdata/benchling-webhook@0.6.3 deploy

# Use v0.7.0 (new config)
npx @quiltdata/benchling-webhook@0.7.0 deploy
```

### Q: Can I automate the migration?

**A:** No. The configuration structure changed too significantly for safe automated migration. Manual reconfiguration ensures you understand the new architecture and verify all settings.

### Q: Do I need to update my Benchling app?

**A:** No. The Benchling app configuration (OAuth scopes, webhook subscriptions) remains unchanged. Only the local configuration structure changed.

### Q: Will my existing deployments break?

**A:** No. Existing AWS infrastructure continues running. The v0.7.0 changes only affect:

1. Local configuration file locations
2. CLI commands and flags
3. Deployment tracking format

Your deployed ECS services, API Gateway, and other AWS resources are unaffected.

### Q: What if I can't remember my v0.6.x settings?

**A:** Check your AWS Secrets Manager:

```bash
aws secretsmanager get-secret-value --secret-id benchling-webhook-secrets --region us-east-1
```

Also check your CloudFormation stack parameters:

```bash
aws cloudformation describe-stacks --stack-name BenchlingWebhookStack --region us-east-1
```

### Q: Can I roll back to v0.6.x?

**A:** Yes. Since v0.7.0 doesn't modify v0.6.x configuration files, you can:

```bash
# Roll back to v0.6.3
npm install -g @quiltdata/benchling-webhook@0.6.3

# Continue using old configuration
npx @quiltdata/benchling-webhook@0.6.3 deploy
```

## Getting Help

If you encounter issues during migration:

1. Check this migration guide thoroughly
2. Verify your backup files are intact
3. Review [CLAUDE.md](./CLAUDE.md) for detailed configuration documentation
4. Check [GitHub Issues](https://github.com/quiltdata/benchling-webhook/issues) for similar problems
5. Create a new issue with:
   - Your v0.6.x configuration (redact secrets!)
   - Error messages
   - Steps you've tried

## Summary

Version 0.7.0 is a major architectural improvement that requires manual reconfiguration. While this may seem inconvenient, the new architecture provides:

- **Clearer separation** of profiles and stages
- **Better isolation** between environments
- **Deployment history** for rollback and debugging
- **Explicit inheritance** reducing configuration duplication
- **Simpler codebase** for future maintenance

The migration process takes 15-30 minutes and provides a more maintainable, scalable configuration system for multi-environment deployments.
