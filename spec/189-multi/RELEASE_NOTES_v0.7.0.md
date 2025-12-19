# Release Notes: v0.7.0

**Release Date:** 2025-11-04

---

## BREAKING CHANGE WARNING

Version 0.7.0 introduces a **complete redesign of the configuration architecture**. This is a breaking change release with **NO automatic migration** from v0.6.x.

**You must manually reconfigure your deployment using the setup wizard.**

---

## What's New

### Profile-Based Configuration Architecture

Version 0.7.0 replaces the legacy configuration system with a clean, profile-based architecture:

- **Single `config.json` per profile** - Replaces the confusing three-tier system (user/derived/deploy)
- **Per-profile deployment tracking** - Each profile tracks its own deployments independently
- **Profile/stage independence** - Deploy any profile to any stage (e.g., dev profile to prod stage)
- **Profile inheritance** - Reduce duplication by inheriting from base profiles
- **Deployment history** - Track all deployments with rollback capability

### New Directory Structure

**v0.7.0:**
```
~/.config/benchling-webhook/
├── default/
│   ├── config.json          # All configuration for default profile
│   └── deployments.json     # Deployment history for default profile
├── dev/
│   ├── config.json          # All configuration for dev profile
│   └── deployments.json     # Deployment history for dev profile
└── prod/
    ├── config.json
    └── deployments.json
```

### Key Improvements

1. **Clearer structure** - All profiles at the same directory level
2. **Better isolation** - Each profile has its own configuration and deployment tracking
3. **Flexible workflows** - Deploy any profile to any stage for testing or blue/green deployments
4. **Deployment history** - See past deployments with timestamps, image tags, and metadata
5. **Easier setup** - Inherit from default profile, override only what's different
6. **Modular wizard** - Install wizard refactored into focused modules (~40% code reduction)

---

## Migration Required

### Before Upgrading

1. **Backup your configuration:**
   ```bash
   cat ~/.config/benchling-webhook/default.json > ~/benchling-v0.6-backup.json
   cat ~/.config/benchling-webhook/deploy.json >> ~/benchling-v0.6-deploy.json
   ```

2. **Document your deployment endpoints** from `deploy.json`

3. **Note any profile-specific settings** from `profiles/*/default.json`

### After Upgrading

1. **Install v0.7.0:**
   ```bash
   npm install -g @quiltdata/benchling-webhook@0.7.0
   # or
   npx @quiltdata/benchling-webhook@0.7.0
   ```

2. **Run setup wizard:**
   ```bash
   npx @quiltdata/benchling-webhook@latest setup
   ```
   Reference your backup file to re-enter settings.

3. **For multi-environment setups, create additional profiles:**
   ```bash
   npx @quiltdata/benchling-webhook@latest setup-profile dev --inherit
   ```

4. **Deploy and test:**
   ```bash
   npx @quiltdata/benchling-webhook@latest deploy --profile default --stage prod
   npx @quiltdata/benchling-webhook@latest test --profile default
   ```

5. **Optional: Clean up old configuration files**
   - Old files remain for reference but are not used by v0.7.0
   - Can be safely deleted after verifying new deployment works

---

## What Changed

### Configuration File Locations

| v0.6.x | v0.7.0 |
| -------- | -------- |
| `~/.config/benchling-webhook/default.json` | `~/.config/benchling-webhook/default/config.json` |
| `~/.config/benchling-webhook/profiles/dev/default.json` | `~/.config/benchling-webhook/dev/config.json` |
| `~/.config/benchling-webhook/deploy.json` (shared) | `~/.config/benchling-webhook/{profile}/deployments.json` (per-profile) |

### XDGConfig API Changes

**Removed:**
- `readConfig(type)` / `writeConfig(type, config)`
- `readProfileConfig(type, profile)` / `writeProfileConfig(type, config, profile)`
- `ConfigType` enum (`user`, `derived`, `deploy`)

**Added:**
- `readProfile(profile)` / `writeProfile(profile, config)`
- `deleteProfile(profile)` / `listProfiles()`
- `profileExists(profile)`
- `getDeployments(profile)` / `recordDeployment(profile, deployment)`
- `getActiveDeployment(profile, stage)`
- `readProfileWithInheritance(profile, baseProfile)`

### Configuration Schema

**Old (v0.6.x):**
```json
{
  "quiltStackArn": "...",
  "benchlingTenant": "...",
  "imageTag": "latest"
}
```

**New (v0.7.0):**
```json
{
  "quilt": { "stackArn": "...", ... },
  "benchling": { "tenant": "...", ... },
  "packages": { "bucket": "...", ... },
  "deployment": { "imageTag": "latest", ... },
  "_metadata": { "version": "0.7.0", ... }
}
```

---

## Why This Breaking Change?

The v0.6.x configuration system had accumulated significant technical debt:

1. **Directory structure chaos** - Mix of root-level and nested configuration files
2. **Shared deployment tracking** - Single `deploy.json` conflated profiles with stages
3. **Unclear profile/stage separation** - Couldn't deploy dev profile to prod stage
4. **Over-engineered** - Three-tier config system (user/derived/deploy) rarely used correctly
5. **Manual profile merging** - Fallback logic scattered across codebase

Version 0.7.0 provides a **clean foundation** for future development with:

- Clear separation of concerns (profile vs stage)
- Profile isolation (no cross-profile conflicts)
- Explicit inheritance (opt-in, not magical)
- Deployment history (visibility and rollback)
- Maintainable codebase (40% reduction in wizard code)

---

## Detailed Migration Guide

For complete step-by-step migration instructions, see:

**[MIGRATION.md](../../MIGRATION.md)**

This guide includes:
- Field name mapping table (v0.6.x → v0.7.0)
- Example migration scenarios
- Troubleshooting common issues
- FAQ

---

## Compatibility Notes

### Existing Deployments

Your existing AWS infrastructure (ECS services, API Gateway, ALB, etc.) continues running. The v0.7.0 changes only affect:

1. Local configuration file locations
2. CLI commands and flags
3. Deployment tracking format

**No changes to deployed infrastructure are required.**

### Benchling App Configuration

Your Benchling app configuration (OAuth scopes, webhook subscriptions) remains unchanged. Only the local CLI configuration structure changed.

### Rollback Support

You can roll back to v0.6.x at any time:

```bash
npm install -g @quiltdata/benchling-webhook@0.6.3
npx @quiltdata/benchling-webhook@0.6.3 deploy
```

Old configuration files are not modified by v0.7.0, so rollback is safe.

---

## New Features

### Profile Inheritance

Create dev profile inheriting from default:

```bash
npx @quiltdata/benchling-webhook@latest setup-profile dev --inherit
```

Override only what's different:

```json
{
  "_inherits": "default",
  "benchling": {
    "appDefinitionId": "app_dev_123"
  },
  "deployment": {
    "imageTag": "latest"
  }
}
```

### Deployment History

Track all deployments per profile:

```json
{
  "active": {
    "prod": {
      "endpoint": "https://xxx.amazonaws.com/prod",
      "imageTag": "0.7.0",
      "deployedAt": "2025-11-04T10:00:00Z"
    }
  },
  "history": [
    {
      "stage": "prod",
      "timestamp": "2025-11-04T10:00:00Z",
      "imageTag": "0.7.0",
      "endpoint": "https://xxx.amazonaws.com/prod",
      "stackName": "BenchlingWebhookStack",
      "region": "us-east-1"
    }
  ]
}
```

### Profile/Stage Independence

Deploy any profile to any stage:

```bash
# Test dev config in prod stage
npx @quiltdata/benchling-webhook@latest deploy --profile dev --stage prod

# Blue/green deployment with different profiles
npx @quiltdata/benchling-webhook@latest deploy --profile blue --stage prod
npx @quiltdata/benchling-webhook@latest deploy --profile green --stage prod
```

---

## Documentation

All documentation has been updated for v0.7.0:

- **[README.md](../../README.md)** - Updated quick start, configuration structure, multi-environment setup
- **[CLAUDE.md](../../CLAUDE.md)** - Updated XDG configuration model, API reference, operational principles
- **[MIGRATION.md](../../MIGRATION.md)** - Complete migration guide from v0.6.x to v0.7.0
- **[CHANGELOG.md](../../CHANGELOG.md)** - Full changelog with breaking changes highlighted

---

## Getting Help

If you encounter issues during migration:

1. **Check migration guide:** [MIGRATION.md](../../MIGRATION.md)
2. **Verify backup files** are intact
3. **Review configuration docs:** [CLAUDE.md](../../CLAUDE.md)
4. **Search existing issues:** [GitHub Issues](https://github.com/quiltdata/benchling-webhook/issues)
5. **Create new issue** with:
   - Your v0.6.x configuration (redact secrets!)
   - Error messages
   - Steps you've tried

---

## Timeline

The migration process takes **15-30 minutes** depending on your setup complexity:

- **Single environment:** 15 minutes
- **Multi-environment (dev + prod):** 30 minutes

---

## Thank You

Thank you for using the Benchling Webhook integration for Quilt. This release represents a significant architectural improvement that will make the project more maintainable and scalable for future development.

We understand that breaking changes require effort from users. We've tried to make the migration as smooth as possible with:

- Clear documentation
- Detailed migration guide
- Helpful error messages
- Safe rollback options

If you have feedback or questions about this release, please reach out via [GitHub Issues](https://github.com/quiltdata/benchling-webhook/issues).

---

## Full Changelog

See [CHANGELOG.md](../../CHANGELOG.md) for complete list of changes.

---

**Released by:** Quilt Data Team
**Version:** 0.7.0
**Date:** 2025-11-04
**License:** Apache-2.0
