# XDG Configuration CLI - Centralized Management

## Overview

This document describes the new centralized Python-based CLI for XDG configuration management, which replaces the previous dual TypeScript/Python implementation to ensure consistency and eliminate bugs from field name mismatches.

## Problem Statement

The previous implementation had XDG configuration logic duplicated between TypeScript and Python, leading to:

1. **Field name mismatches**: TypeScript wrote `benchlingSecrets` (plural) while Python expected `benchlingSecretArn`
2. **Secret format inconsistency**: TypeScript wrote SCREAMING_SNAKE_CASE (`BENCHLING_TENANT`) while Python expected snake_case (`tenant`)
3. **Region detection bugs**: Python looked for `awsRegion` while XDG had `cdkRegion`/`quiltRegion`
4. **Maintenance overhead**: Changes required updates in both TypeScript and Python

## Solution: Centralized Python CLI

A single Python CLI (`benchling-webhook-config`) now serves as the single source of truth for all XDG operations, with:

- **Pydantic schemas** for type-safe validation
- **Field name aliasing** (automatic camelCase ↔ snake_case conversion)
- **TypeScript wrapper** for seamless integration with npm scripts
- **Comprehensive CLI** for all configuration operations

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TypeScript (npm scripts)                  │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           lib/xdg-cli-wrapper.ts                        │ │
│  │  Type-safe TypeScript wrapper for Python CLI            │ │
│  │  - XDGCLIWrapper.read<UserConfig>()                     │ │
│  │  - XDGCLIWrapper.write(config)                          │ │
│  │  - XDGCLIWrapper.merge(updates)                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                            │                                  │
│                            │ execSync()                       │
│                            ▼                                  │
└─────────────────────────────────────────────────────────────┘
                             │
┌─────────────────────────────────────────────────────────────┐
│                     Python CLI (docker/)                      │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │        docker/scripts/benchling-webhook-config          │ │
│  │               (executable entry point)                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                            │                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              docker/src/xdg_cli.py                      │ │
│  │  Click-based CLI with commands:                         │ │
│  │  - read, write, merge, validate                         │ │
│  │  - get, set, export, list                               │ │
│  └────────────────────────────────────────────────────────┘ │
│                            │                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           docker/src/config_schema.py                   │ │
│  │  Pydantic models with field aliasing:                   │ │
│  │  - UserConfig, DerivedConfig, DeploymentConfig          │ │
│  │  - BenchlingSecret (for Secrets Manager)                │ │
│  │  - Automatic camelCase ↔ snake_case conversion          │ │
│  └────────────────────────────────────────────────────────┘ │
│                            │                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │            docker/src/xdg_config.py                     │ │
│  │  Low-level XDG file I/O operations                      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## CLI Commands

### Basic Operations

```bash
# Read configuration
benchling-webhook-config read [--profile default] [--type user|derived|deploy]

# Write configuration
benchling-webhook-config write '{"key": "value"}' [--profile default] [--type user]

# Merge into existing config
benchling-webhook-config merge '{"key": "value"}' [--profile default]

# Validate configuration
benchling-webhook-config validate [--profile default] [--type user|derived|deploy|all]
```

### Field Operations

```bash
# Get a field value
benchling-webhook-config get benchlingTenant [--profile default]
benchling-webhook-config get _metadata.version

# Set a field value
benchling-webhook-config set benchlingTenant my-tenant [--profile default]
benchling-webhook-config set cdkRegion us-west-2
```

### Profile Management

```bash
# List all profiles
benchling-webhook-config list [--verbose]

# Export complete configuration
benchling-webhook-config export [--profile default] [--type complete]
```

## TypeScript Integration

The TypeScript wrapper provides type-safe access to the Python CLI:

```typescript
import { XDGCLIWrapper } from "./lib/xdg-cli-wrapper";

// Read configuration with type safety
const userConfig = XDGCLIWrapper.read<UserConfig>({ type: "user" });

// Write configuration
XDGCLIWrapper.write({ benchlingTenant: "my-tenant" }, { type: "user" });

// Merge updates
XDGCLIWrapper.merge({ cdkRegion: "us-west-2" }, { type: "user" });

// Get specific field
const tenant = XDGCLIWrapper.get("benchlingTenant");

// Set specific field
XDGCLIWrapper.set("cdkRegion", "us-west-2");

// Validate configuration
const isValid = XDGCLIWrapper.validate({ type: "user" });
```

## Field Name Aliasing

Pydantic models automatically handle field name conversion:

| Python (snake_case)      | TypeScript (camelCase)    | Alias             |
|--------------------------|---------------------------|-------------------|
| `benchling_tenant`       | `benchlingTenant`         | ✓                 |
| `benchling_secret_arn`   | `benchlingSecretArn`      | ✓                 |
| `cdk_region`             | `cdkRegion`               | ✓                 |
| `quilt_stack_arn`        | `quiltStackArn`           | ✓                 |
| `pkg_prefix`             | `pkgPrefix`               | ✓                 |

Both field names are accepted when reading/writing, ensuring backward compatibility.

## Secrets Manager Format

The CLI ensures consistent secret format for AWS Secrets Manager:

```json
{
  "tenant": "my-tenant",
  "client_id": "abc123",
  "client_secret": "secret",
  "app_definition_id": "appdef_xyz",
  "user_bucket": "my-bucket",
  "pkg_prefix": "benchling",
  "pkg_key": "experiment_id",
  "log_level": "INFO",
  "enable_webhook_verification": "true",
  "webhook_allow_list": "",
  "queue_arn": "arn:aws:sqs:..."
}
```

All fields use **snake_case** (not SCREAMING_SNAKE_CASE) to match Python expectations.

## Migration Path

### Phase 1: ✅ Implemented (Current State)

1. ✅ Create Pydantic schema models with field aliasing
2. ✅ Implement Python CLI with Click framework
3. ✅ Create TypeScript wrapper for CLI
4. ✅ Fix existing bugs (field names, region detection)
5. ✅ Add dependencies (pydantic, click)

### Phase 2: Future Work

1. Update TypeScript XDGConfig class to delegate to CLI wrapper
2. Refactor sync-secrets.ts to use CLI wrapper
3. Update all npm scripts to use CLI
4. Add comprehensive integration tests
5. Add CLI usage examples to documentation
6. Consider deprecating old TypeScript XDGConfig methods

## Benefits

1. **Single Source of Truth**: All XDG logic in one place (Python)
2. **Type Safety**: Pydantic validation ensures data integrity
3. **Field Name Consistency**: Automatic aliasing prevents mismatches
4. **Better Testing**: Easier to test one implementation
5. **Schema Validation**: Catch configuration errors early
6. **CLI Flexibility**: Direct command-line access for debugging
7. **TypeScript Integration**: Seamless integration via wrapper

## Testing

```bash
# Test CLI directly
cd docker
uv run python scripts/benchling-webhook-config --help
uv run python scripts/benchling-webhook-config read --type user
uv run python scripts/benchling-webhook-config validate

# Test from TypeScript (future)
npm run config:read
npm run config:validate
```

## Files Created

- `docker/src/config_schema.py` - Pydantic models with field aliasing
- `docker/src/xdg_cli.py` - Click-based CLI implementation
- `docker/scripts/benchling-webhook-config` - Executable entry point
- `lib/xdg-cli-wrapper.ts` - TypeScript wrapper for CLI
- `docs/xdg-cli-migration.md` - This documentation

## Dependencies Added

```toml
# docker/pyproject.toml
dependencies = [
    ...
    "pydantic>=2.0.0",
    "click>=8.1.0",
]
```

## Next Steps

1. Update npm scripts to use new CLI wrapper
2. Add integration tests for CLI + TypeScript wrapper
3. Update CLAUDE.md with new workflow
4. Consider adding CLI to package.json bin field
5. Add examples to README.md
