# XDG Launch Specification: Unified Configuration Bridge

**Issue**: #206 - Service envars

**Component**: `bin/xdg-launch.ts`

**Date**: 2025-11-16

**Status**: TECHNICAL SPECIFICATION

## Overview

The XDG Launch tool provides a unified configuration bridge between XDG-based profile configuration (`~/.config/benchling-webhook/{profile}/config.json`) and runtime execution environments (native Flask, Docker local, Docker production). It eliminates the need for `.env` files and manual environment variable management by reading configuration from XDG profiles and passing it directly to execution contexts.

## Goals

### Primary Goals

1. **Unified Launch Interface**: Single command to launch any execution mode with profile-based configuration
2. **XDG as Single Source of Truth**: All configuration read from `~/.config/benchling-webhook/{profile}/config.json`
3. **Zero .env Files**: Eliminate manual environment variable file management
4. **Mode Flexibility**: Support native Flask, Docker dev, and Docker production modes
5. **Breaking Change Alignment**: Full integration with service-specific environment variable architecture

### Secondary Goals

1. **Developer Experience**: Simple, intuitive commands for local development
2. **Profile Awareness**: Respect profile system for multi-environment workflows
3. **Clear Error Messages**: Fail fast with actionable validation errors
4. **Test Integration**: Support test mode for automated testing workflows

## Architecture

### Command-Line Interface

```bash
# Syntax
npx ts-node bin/xdg-launch.ts [OPTIONS]

# Examples
npx ts-node bin/xdg-launch.ts --mode native --profile dev
npx ts-node bin/xdg-launch.ts --mode docker --profile default
npx ts-node bin/xdg-launch.ts --mode docker-dev --profile dev --verbose
npx ts-node bin/xdg-launch.ts --mode native --profile dev --test
```

### Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--mode` | Yes | - | Execution mode: `native`, `docker`, `docker-dev` |
| `--profile` | No | `default` | XDG profile name to load configuration from |
| `--port` | No | Mode-specific | Override default port (native: 5001, docker: 5003, docker-dev: 5002) |
| `--verbose` | No | `false` | Enable verbose logging output |
| `--test` | No | `false` | Run in test mode (start, run tests, exit) |

### Execution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Parse Command-Line Arguments                                 │
│    - Validate mode, profile, options                            │
│    - Set defaults for unspecified options                       │
└────────────────────┬────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│ 2. Load XDG Profile Configuration                               │
│    - Read ~/.config/benchling-webhook/{profile}/config.json    │
│    - Validate profile exists and is well-formed                │
│    - Handle inheritance if _inherits field present             │
└────────────────────┬────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│ 3. Build Environment Variable Map                               │
│    - Map XDG config fields to service environment variables    │
│    - Include mode-specific variables (FLASK_ENV, LOG_LEVEL)    │
│    - Preserve existing process.env variables                   │
│    - Add runtime flags (verbose, test mode)                    │
└────────────────────┬────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│ 4. Validate Required Configuration                              │
│    - Check all required service variables present              │
│    - Validate formats (URLs, ARNs, database names)             │
│    - Fail fast with actionable error messages                  │
└────────────────────┬────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│ 5. Launch Execution Mode                                        │
│    ┌───────────────┬───────────────┬─────────────────────────┐ │
│    │ Native Flask  │ Docker Prod   │ Docker Dev              │ │
│    │ - spawn uv    │ - spawn       │ - spawn docker-compose  │ │
│    │   run python  │   docker-     │   --profile dev         │ │
│    │   -m src.app  │   compose up  │ - Mount volumes         │ │
│    │ - Pass env    │   app         │ - Hot reload enabled    │ │
│    │   vars        │ - Pass env    │ - Pass env vars         │ │
│    └───────────────┴───────────────┴─────────────────────────┘ │
└────────────────────┬────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│ 6. Stream Output and Monitor Process                            │
│    - Forward stdout/stderr to console                           │
│    - Handle Ctrl+C gracefully                                   │
│    - Exit with process exit code                                │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration Mapping

### XDG Profile → Environment Variables

```typescript
// Input: ~/.config/benchling-webhook/{profile}/config.json
{
  "quilt": {
      "stackArn": "arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/e51b0c10-10c9-11ee-9b41-12fda87498a3",
      "catalog": "nightly.quilttest.com",
      "database": "userathenadatabase-mbq1ihawbzb7",
      "workgroup": "quilt-staging-workgroup",
      "queueUrl": "https://sqs.us-east-1.amazonaws.com/712023778557/quilt-staging-PackagerQueue-d5NmglefXjDn",
      "region": "us-east-1",
      "icebergWorkgroup": "quilt-staging-Iceberg",
      "icebergDatabase": "icebergdatabase-v9cxuqnwjj5a"
  },
  "benchling": {
    "tenant": "example",
    "secretArn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-creds-abc123"
  },
  "packages": {
    "bucket": "benchling-packages",
    "prefix": "benchling",
    "metadataKey": "experiment_id"
  },
  "deployment": {
    "region": "us-east-1"
  },
  "logging": {
    "level": "INFO"
  },
  "security": {
    "enableVerification": true
  }
}

// Output: Environment Variables
{
  // Quilt Services (NEW - service-specific)
  QUILT_WEB_HOST: "quilt.example.com",
  ATHENA_USER_DATABASE: "userathena-XXXX",
  ATHENA_WORKGROUP: "primary",
  ICEBERG_DATABASE: "quilt_iceberg_catalog",  // empty string if not in config
  ICEBERG_WORKGROUP: "quilt_iceberg_workgroup",  // empty string if not in config
  PACKAGER_SQS_URL: "https://sqs.us-east-1.amazonaws.com/123456789012/packager-queue-XXXX",

  // AWS Configuration
  AWS_REGION: "us-east-1",
  AWS_DEFAULT_REGION: "us-east-1",

  // Benchling Configuration
  BENCHLING_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-creds-abc123",
  BENCHLING_LOG_LEVEL: "INFO",

  // Application Configuration
  ENABLE_WEBHOOK_VERIFICATION: "false", // dev mode ONLY

  // Mode-specific variables (set based on --mode)
  FLASK_ENV: "development" | "production",
  FLASK_DEBUG: "true" | "false"
}
```

## Execution Modes

### Mode: `native`

**Purpose**: Run Flask application directly on host using `uv`

**Process**: `uv run python -m src.app`

**Working Directory**: `docker/`

**Environment Variables**:

```typescript
{
  ...serviceVars,
  FLASK_ENV: "development",
  FLASK_DEBUG: "true",
  // Optional: BENCHLING_TEST_MODE: "true" if --test flag
}
```

**Port**: 5001 (default, override with `--port`)

**Use Cases**:

- Local development without Docker
- Debugging with IDE
- Quick iteration cycles
- Integration tests with mocked AWS

**Requirements**:

- `uv` installed
- Python 3.12+
- AWS credentials configured (`~/.aws/credentials`)

---

### Mode: `docker`

**Purpose**: Run production Docker container locally

**Process**: `docker-compose up app`

**Working Directory**: `docker/`

**Environment Variables**:

```typescript
{
  ...serviceVars,
  FLASK_ENV: "production",
  LOG_LEVEL: config.logging.level || "INFO"
}
```

**Port**: 5003 (default, override with `--port`)

**Use Cases**:

- Test production configuration locally
- Validate Docker build
- Performance testing
- Pre-deployment verification

**Requirements**:

- Docker installed and running
- Built Docker image (or will build on-demand)
- AWS credentials mounted (`~/.aws:/home/appuser/.aws:ro`)

---

### Mode: `docker-dev`

**Purpose**: Run Docker container with hot-reload for development

**Process**: `docker-compose --profile dev up app-dev`

**Working Directory**: `docker/`

**Environment Variables**:

```typescript
{
  ...serviceVars,
  FLASK_ENV: "development",
  LOG_LEVEL: config.logging.level || "DEBUG",
  ENABLE_WEBHOOK_VERIFICATION: "false"  // Disabled for easier local testing
}
```

**Port**: 5002 (default, override with `--port`)

**Volume Mounts**:

- `./src:/app/src` - Hot reload source code
- `./pyproject.toml:/app/pyproject.toml`
- `./uv.lock:/app/uv.lock`
- `~/.aws:/home/appuser/.aws:ro` - AWS credentials

**Use Cases**:

- Local development with hot reload
- Docker-based debugging
- Testing container-specific issues
- Development without `uv` on host

**Requirements**:

- Docker installed and running
- AWS credentials mounted

## Implementation Details

### File Structure

```
bin/
└── xdg-launch.ts          # Main entry point
    ├── parseArguments()   # CLI argument parsing
    ├── loadProfile()      # XDG profile loading
    ├── buildEnvVars()     # Environment variable mapping
    ├── validateConfig()   # Configuration validation
    ├── launchNative()     # Native Flask launcher
    ├── launchDocker()     # Docker production launcher
    └── launchDockerDev()  # Docker dev launcher
```

### Key Functions

#### `parseArguments()`

```typescript
interface LaunchOptions {
  mode: 'native' | 'docker' | 'docker-dev';
  profile: string;
  port?: number;
  verbose: boolean;
  test: boolean;
}

function parseArguments(argv: string[]): LaunchOptions {
  // Parse command-line arguments using yargs or minimist
  // Validate required options
  // Apply defaults
  // Return typed options object
}
```

#### `loadProfile()`

```typescript
function loadProfile(profileName: string): ProfileConfig {
  // Use XDGConfig to load profile
  const xdg = new XDGConfig();

  // Read profile with inheritance
  if (!xdg.profileExists(profileName)) {
    throw new Error(`Profile not found: ${profileName}`);
  }

  // Return resolved profile configuration
  return xdg.readProfile(profileName);
}
```

#### `buildEnvVars()`

```typescript
function buildEnvVars(
  config: ProfileConfig,
  mode: LaunchOptions['mode'],
  options: LaunchOptions
): Record<string, string> {
  const envVars: Record<string, string> = {
    // Preserve existing process.env
    ...process.env,

    // Quilt Services (NEW - service-specific)
    QUILT_WEB_HOST: config.quilt.catalog,
    ATHENA_USER_DATABASE: config.quilt.database,
    PACKAGER_SQS_URL: config.quilt.queueUrl,
    ICEBERG_DATABASE: config.quilt.icebergDatabase || '',

    // AWS Configuration
    AWS_REGION: config.deployment.region,
    AWS_DEFAULT_REGION: config.deployment.region,

    // Benchling Configuration
    BENCHLING_SECRET_ARN: config.benchling.secretArn,
    BENCHLING_TENANT: config.benchling.tenant,

    // Package Configuration
    PACKAGE_BUCKET: config.packages.bucket,
    PACKAGE_PREFIX: config.packages.prefix,
    PACKAGE_METADATA_KEY: config.packages.metadataKey,

    // Application Configuration
    LOG_LEVEL: config.logging.level,
    ENABLE_WEBHOOK_VERIFICATION: String(config.security.enableVerification),
  };

  // Mode-specific variables
  if (mode === 'native' || mode === 'docker-dev') {
    envVars.FLASK_ENV = 'development';
    envVars.FLASK_DEBUG = 'true';
  } else {
    envVars.FLASK_ENV = 'production';
  }

  // Test mode flag
  if (options.test) {
    envVars.BENCHLING_TEST_MODE = 'true';
  }

  return envVars;
}
```

#### `validateConfig()`

```typescript
function validateConfig(envVars: Record<string, string>): void {
  // Required service variables
  const required = [
    'QUILT_WEB_HOST',
    'ATHENA_USER_DATABASE',
    'PACKAGER_SQS_URL',
    'AWS_REGION',
    'BENCHLING_SECRET_ARN',
    'BENCHLING_TENANT',
    'PACKAGE_BUCKET',
  ];

  const missing = required.filter(key => !envVars[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration:\n` +
      missing.map(key => `  - ${key}`).join('\n') +
      `\n\nCheck profile configuration at:\n` +
      `  ~/.config/benchling-webhook/{profile}/config.json`
    );
  }

  // Format validation
  if (!envVars.PACKAGER_SQS_URL.match(/^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d+\/.+/)) {
    throw new Error(`Invalid SQS URL format: ${envVars.PACKAGER_SQS_URL}`);
  }

  if (!envVars.BENCHLING_SECRET_ARN.startsWith('arn:aws:secretsmanager:')) {
    throw new Error(`Invalid Secrets Manager ARN: ${envVars.BENCHLING_SECRET_ARN}`);
  }
}
```

#### `launchNative()`

```typescript
function launchNative(
  envVars: Record<string, string>,
  options: LaunchOptions
): void {
  const { spawn } = require('child_process');

  const port = options.port || 5001;
  envVars.PORT = String(port);

  console.log(`🚀 Launching native Flask (port ${port})...`);

  if (options.verbose) {
    console.log('\nEnvironment Variables:');
    Object.entries(envVars)
      .filter(([key]) => !key.includes('SECRET'))
      .forEach(([key, value]) => console.log(`  ${key}=${value}`));
  }

  const proc = spawn('uv', ['run', 'python', '-m', 'src.app'], {
    cwd: path.join(__dirname, '..', 'docker'),
    env: envVars,
    stdio: 'inherit',
  });

  proc.on('exit', (code) => {
    process.exit(code || 0);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    proc.kill('SIGTERM');
  });
}
```

#### `launchDocker()` and `launchDockerDev()`

Similar structure to `launchNative()` but:

- Spawn `docker-compose` instead of `uv`
- Pass env vars via `--env-file` or process env
- Use service name `app` or `app-dev`
- Handle Docker-specific options

## Integration with npm Scripts

### Updated package.json

```json
{
  "scripts": {
    "launch": "ts-node bin/xdg-launch.ts",
    "dev": "npm run launch -- --mode native --profile dev",
    "dev:docker": "npm run launch -- --mode docker-dev --profile dev",
    "test:native": "npm run launch -- --mode native --profile dev --test",
    "test:local": "npm run launch -- --mode docker-dev --profile dev --test",
    "docker:prod": "npm run launch -- --mode docker --profile default"
  }
}
```

### Usage Examples

```bash
# Local development with native Flask
npm run dev

# Local development with Docker hot-reload
npm run dev:docker

# Run tests with native Flask
npm run test:native

# Run tests with Docker
npm run test:local

# Test production Docker build
npm run docker:prod

# Custom profile and port
npm run launch -- --mode native --profile staging --port 8000
```

## Error Handling

### Profile Not Found

```
❌ Error: Profile not found: 'staging'

Available profiles:
  - default
  - dev
  - prod

Create a new profile:
  npm run setup -- --profile staging
```

### Missing Required Configuration

```
❌ Error: Missing required configuration:
  - PACKAGER_SQS_URL
  - ATHENA_USER_DATABASE

Check profile configuration at:
  ~/.config/benchling-webhook/dev/config.json

Required fields:
  quilt.queueUrl - SQS queue URL for package creation
  quilt.database - Athena database name for catalog metadata

Run setup wizard to configure:
  npm run setup -- --profile dev
```

### Invalid Configuration Format

```
❌ Error: Invalid SQS URL format: not-a-url

Expected format:
  https://sqs.{region}.amazonaws.com/{account}/{queue-name}

Example:
  https://sqs.us-east-1.amazonaws.com/123456789012/packager-queue
```

## Testing Strategy

### Unit Tests

**File**: `test/xdg-launch.test.ts`

**Coverage**:

- Argument parsing
- Profile loading
- Environment variable mapping
- Configuration validation
- Error handling

**Approach**: Mock XDGConfig, file system, and child process spawning

### Integration Tests

**Scenarios**:

1. Launch native Flask with valid profile
2. Launch Docker dev with valid profile
3. Launch Docker prod with valid profile
4. Handle missing profile gracefully
5. Handle invalid configuration gracefully
6. Validate environment variable mapping
7. Test mode flag propagation

**Approach**: Use test profiles, mock AWS credentials

## Migration from run_native.py

### Deprecation Plan

1. **Phase 1**: Introduce `xdg-launch.ts` alongside `run_native.py`
   - Both tools coexist
   - Update npm scripts to use `xdg-launch.ts`
   - Document new approach

2. **Phase 2**: Deprecate `run_native.py`
   - Add deprecation warning to `run_native.py`
   - Update all documentation to use `xdg-launch.ts`
   - Provide migration guide

3. **Phase 3**: Remove `run_native.py`
   - Delete file
   - Remove references
   - Update CHANGELOG

### Migration Guide for Users

```markdown
## Migrating from run_native.py to xdg-launch.ts

**Old approach**:
```bash
python scripts/run_native.py --profile dev
```

**New approach**:

```bash
npm run dev
# or
npx ts-node bin/xdg-launch.ts --mode native --profile dev
```

**Benefits**:

- Consistent interface across all launch modes
- Better integration with npm workflows
- TypeScript type safety
- No manual environment variable management

```

## Dependencies

### Required Libraries

- `yargs` or `minimist` - Command-line argument parsing
- `child_process` (Node.js built-in) - Process spawning
- Existing `XDGConfig` class - Profile loading

### Required Tools

**Runtime**:
- Node.js 18+
- TypeScript 5+

**For Native Mode**:
- `uv` (Python package manager)
- Python 3.12+

**For Docker Modes**:
- Docker
- Docker Compose

## Security Considerations

### Sensitive Data Handling

1. **Never log secrets**: Filter `SECRET` and `PASSWORD` from verbose output
2. **Secure credential passing**: Use environment variables, not command-line args
3. **AWS credentials**: Mount `~/.aws` read-only in Docker modes
4. **Secrets Manager**: Reference ARN only, not secret values

### Validation

1. **Profile validation**: Ensure profile exists before loading
2. **Format validation**: Validate URLs, ARNs, database names
3. **Required fields**: Fail fast if required configuration missing
4. **Explicit permissions**: Document AWS permissions needed

## Performance Considerations

### Startup Time

**Target**: < 2 seconds from command to process running

**Optimization**:
- Lazy-load dependencies
- Cache XDGConfig instances
- Validate configuration in parallel with process spawn
- Use `spawn` instead of `exec` for streaming output

### Resource Usage

- Minimal memory footprint (< 50 MB for xdg-launch process itself)
- Clean process cleanup on exit
- No background processes left running

## Success Criteria

### Functional

- ✅ Launch native Flask with profile-based configuration
- ✅ Launch Docker dev with hot reload
- ✅ Launch Docker prod with production settings
- ✅ All service environment variables passed correctly
- ✅ Clear error messages for misconfigurations
- ✅ Graceful shutdown on Ctrl+C
- ✅ Support test mode for automated testing

### Non-Functional

- ✅ Startup time < 2 seconds
- ✅ Clear, actionable error messages
- ✅ Zero `.env` file management
- ✅ Consistent interface across modes
- ✅ Integration with existing npm workflows

### Developer Experience

- ✅ Simple commands (`npm run dev`)
- ✅ Verbose mode for debugging
- ✅ Profile-aware for multi-environment workflows
- ✅ TypeScript type safety

## Future Enhancements

### Potential Additions (Out of Scope for v1.0)

1. **Interactive Mode**: Prompt for profile if not specified
2. **Config Override**: Command-line flags to override config values
3. **Service Health Checks**: Validate service connectivity before launch
4. **Log Streaming**: Built-in log viewer with filtering
5. **Multi-Service**: Launch multiple services simultaneously
6. **Watch Mode**: Auto-restart on configuration changes

## References

- [03-specifications.md](./03-specifications.md) - Service environment variable specifications
- [04-phases.md](./04-phases.md) - Implementation phases
- [lib/xdg-config.ts](../../lib/xdg-config.ts) - XDG configuration management
- [docker/docker-compose.yml](../../docker/docker-compose.yml) - Docker service definitions
