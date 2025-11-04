# CLI Specification for npx-Ready Benchling Webhook Deployment

## Overview

Transform `@quiltdata/benchling-webhook` into an npx-executable CLI tool that allows users to deploy CDK infrastructure without cloning the repository. The package should remain importable as a library while providing a seamless CLI experience.

## Goal

Enable users to run:

```bash
npx @quiltdata/benchling-webhook deploy
```

And either:

- **a) Have it just work** - Deploy successfully if all configuration is available
- **b) Tell them what to do first** - Provide clear guidance on missing requirements

## Design Principles

1. **Zero Repository Access** - Users should not need to clone or even know about the GitHub repo
2. **Progressive Disclosure** - Show help/guidance naturally when needed
3. **Dual-Mode Operation** - Works as both CLI and importable library
4. **Env-First Configuration** - Prioritize `.env` files while supporting CLI flags
5. **Smart Defaults** - Infer what can be inferred, prompt for the rest
6. **Fail Fast, Fail Clear** - Error messages should guide users to solutions

---

## Architecture

### File Structure

```tree
benchling-webhook/
├── bin/
│   ├── cli.ts                    # NEW: Main CLI entry point
│   ├── benchling-webhook.ts      # REFACTORED: Core deployment logic (no CLI)
│   ├── get-env.ts                # TBD: Should this move to lib/utils?
│   └── commands/                 # NEW: CLI command implementations
│       ├── deploy.ts
│       ├── init.ts
│       ├── validate.ts
│       └── help.ts
├── lib/
│   ├── index.ts                  # Library exports (unchanged)
│   ├── benchling-webhook-stack.ts
│   └── utils/
│       ├── config.ts             # NEW: Config loading/validation
│       ├── help-formatter.ts     # NEW: Help text rendering
│       └── env-loader.ts         # NEW: .env file handling
├── package.json                  # UPDATED: Add CLI dependencies
├── README.md                     # UPDATED: Add npx usage
└── spec/cli/
    ├── CLI_SPEC.md               # This document
    ├── REFACTORING_GUIDE.md      # Implementation steps
    └── EXAMPLES.md               # Usage examples
```

### Package Configuration

**package.json Changes:**

```json
{
  "name": "@quiltdata/benchling-webhook",
  "version": "0.6.0",
  "main": "dist/lib/index.js",
  "types": "dist/lib/index.d.ts",
  "bin": {
    "benchling-webhook": "./dist/bin/cli.js"
  },
  "files": [
    "dist/",
    "README.md",
    "LICENSE",
    "env.template"
  ],
  "dependencies": {
    "commander": "^12.0.0",
    "dotenv": "^17.2.3",
    "dotenv-expand": "^11.0.0",
    "chalk": "^4.1.2",
    "ora": "^5.4.1",
    "enquirer": "^2.4.1",
    "boxen": "^5.1.2"
  }
}
```

**Key Points:**

- `bin` entry points to compiled CLI
- `main` still points to library exports
- Include `env.template` in published package
- Add CLI-focused dependencies

---

## CLI Interface

### Command Structure

```bash
npx @quiltdata/benchling-webhook <command> [options]
```

### Commands

#### 1. `deploy` (default)

Deploy the CDK stack with configuration from `.env` and/or CLI options.

```bash
npx @quiltdata/benchling-webhook deploy [options]

Options:
  --catalog <url>                 Quilt catalog URL (or QUILT_CATALOG env var)
  --bucket <name>                 S3 bucket for data (or QUILT_USER_BUCKET env var)
  --tenant <name>                 Benchling tenant (or BENCHLING_TENANT env var)
  --client-id <id>                Benchling client ID (or BENCHLING_CLIENT_ID env var)
  --client-secret <secret>        Benchling client secret (or BENCHLING_CLIENT_SECRET env var)
  --app-id <id>                   Benchling app definition ID (or BENCHLING_APP_DEFINITION_ID env var)
  --env-file <path>               Load environment from file (default: .env)
  --no-bootstrap-check            Skip CDK bootstrap verification
  --require-approval <level>      CDK approval level (never|any-change|broadening) [default: never]
  --profile <name>                AWS profile to use
  --region <region>               AWS region to deploy to
  --yes                           Skip confirmation prompts
  -h, --help                      Display help for command
```

**Behavior:**

1. Load `.env` file if present (or file specified by `--env-file`)
2. Merge CLI options (CLI options override .env values)
3. Attempt to infer missing values from catalog (via `get-env.ts` logic)
4. Validate required parameters
5. Display deployment plan
6. Prompt for confirmation (unless `--yes`)
7. Execute CDK deployment
8. Save deployment outputs to `.env.deploy`

#### 2. `init`

Initialize configuration interactively.

```bash
npx @quiltdata/benchling-webhook init [options]

Always will Only prompt for required values AND infer values from catalog

Options:
  --output <path>                 Output file path (default: .env)
  --force                         Overwrite existing file
  -h, --help                      Display help for command
```

**Behavior:**

1. Check if `.env` exists (warn if `--force` not set)
2. Prompt for required values interactively:
   - Quilt catalog URL
   - S3 bucket name
   - Benchling tenant
   - Benchling credentials (client ID, secret, app ID)
3. If `--infer` flag: attempt to infer additional values from catalog
4. Write to `.env` (or specified path)
5. Display next steps

**Interactive Prompts:**

```log
Welcome to Benchling Webhook Integration Setup!

Let's configure your deployment. You'll need:
  • Access to your Quilt catalog
  • An S3 bucket for storing data
  • Benchling API credentials

Press Ctrl+C at any time to cancel.

? Enter your Quilt catalog URL: [quilt-catalog.company.com]
? Enter your S3 data bucket name: [my-data-bucket]
? Enter your Benchling tenant: [company]
? Enter Benchling client ID: [client_xxxxx]
? Enter Benchling client secret: [***************]
? Enter Benchling app definition ID: [appdef_xxxxx]

✓ Configuration saved to .env

Attempting to infer additional configuration...
✓ Found CDK account: 123456789012
✓ Found region: us-east-1
✓ Found SQS queue: QuiltStack-PackagerQueue-ABC123

Next steps:
  1. Review .env and verify all values
  2. Run: npx @quiltdata/benchling-webhook deploy
```

#### 3. `validate`

Validate configuration without deploying.

```bash
npx @quiltdata/benchling-webhook validate [options]

Options:
  --env-file <path>               Load environment from file (default: .env)
  --verbose                       Show detailed validation info
  -h, --help                      Display help for command
```

**Behavior:**

1. Load configuration from `.env` (or specified file)
2. Validate all required parameters
3. Test AWS credentials
4. Verify CDK bootstrap status
5. Check catalog accessibility
6. Attempt to infer missing values
7. Display validation report

**Output Example:**

```log
Validating configuration...

✓ Configuration file found: .env
✓ AWS credentials configured (account: 123456789012)
✓ CDK bootstrapped in us-east-1
✓ Quilt catalog accessible: quilt-catalog.company.com
✓ S3 bucket exists and accessible: my-data-bucket
✓ SQS queue found: QuiltStack-PackagerQueue-ABC123

Required parameters:
  ✓ QUILT_CATALOG
  ✓ QUILT_USER_BUCKET
  ✓ BENCHLING_TENANT
  ✓ BENCHLING_CLIENT_ID
  ✓ BENCHLING_CLIENT_SECRET
  ✓ BENCHLING_APP_DEFINITION_ID

Inferred parameters:
  ✓ CDK_DEFAULT_ACCOUNT (from AWS STS)
  ✓ CDK_DEFAULT_REGION (from catalog)
  ✓ QUEUE_NAME (from stack outputs)
  ✓ SQS_QUEUE_URL (from stack outputs)
  ✓ QUILT_DATABASE (from stack outputs)

Configuration is valid! Ready to deploy.
```

#### 4. `help` / `--help`

Display help with formatted README content.

```bash
npx @quiltdata/benchling-webhook help
npx @quiltdata/benchling-webhook --help
```

**Behavior:**

1. Display formatted CLI usage
2. Show quick start guide
3. Include link to full documentation
4. Display examples

---

## Configuration Loading Strategy

### Priority Order (highest to lowest)

1. **CLI flags** - Explicit command-line options
2. **Environment variables** - Already set in shell
3. **.env file** - Project-local configuration
4. **Inferred values** - Auto-discovered from catalog
5. **Defaults** - Hardcoded fallbacks

### Loading Flow

```typescript
async function loadConfig(cliOptions: CommandOptions): Promise<Config> {
  // 1. Load .env file (if present)
  const envFile = cliOptions.envFile || '.env';
  const dotenvVars = loadDotenv(envFile);

  // 2. Merge with process.env
  const envVars = { ...dotenvVars, ...process.env };

  // 3. Attempt inference from catalog
  let inferredVars = {};
  const catalog = cliOptions.catalog || envVars.QUILT_CATALOG;
  if (catalog) {
    try {
      const result = await inferStackConfig(`https://${catalog}`);
      inferredVars = result.inferredVars;
    } catch (error) {
      // Log warning but continue
      console.warn(`Could not infer config: ${error.message}`);
    }
  }

  // 4. Merge in priority order
  const config = {
    ...DEFAULT_CONFIG,
    ...inferredVars,
    ...envVars,
    ...cliOptions  // CLI options override everything
  };

  // 5. Validate required fields
  validateConfig(config);

  return config;
}
```

### Required Parameters

**Must be provided by user (cannot be inferred):**

- `QUILT_CATALOG` - Quilt catalog URL
- `QUILT_USER_BUCKET` - User's data bucket
- `BENCHLING_TENANT` - Benchling tenant name
- `BENCHLING_CLIENT_ID` - OAuth client ID
- `BENCHLING_CLIENT_SECRET` - OAuth client secret

**Conditionally required:**

- `BENCHLING_APP_DEFINITION_ID` - Required if `ENABLE_WEBHOOK_VERIFICATION=true` (default)

**Auto-inferred (from catalog config):**

- `CDK_DEFAULT_ACCOUNT` - From AWS STS
- `CDK_DEFAULT_REGION` - From catalog config
- `QUEUE_NAME` - From stack outputs
- `SQS_QUEUE_URL` - From stack outputs
- `QUILT_DATABASE` - From stack outputs

### Validation Rules

```typescript
interface ValidationRule {
  required: boolean;
  canInfer: boolean;
  validate?: (value: string) => boolean;
  errorMessage?: string;
}

const VALIDATION_RULES: Record<string, ValidationRule> = {
  QUILT_CATALOG: {
    required: true,
    canInfer: false,
    validate: (v) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v),
    errorMessage: 'Must be a valid domain name'
  },
  QUILT_USER_BUCKET: {
    required: true,
    canInfer: false,
    validate: (v) => /^[a-z0-9.-]{3,63}$/.test(v),
    errorMessage: 'Must be a valid S3 bucket name'
  },
  BENCHLING_TENANT: {
    required: true,
    canInfer: false
  },
  BENCHLING_CLIENT_ID: {
    required: true,
    canInfer: false
  },
  BENCHLING_CLIENT_SECRET: {
    required: true,
    canInfer: false
  },
  BENCHLING_APP_DEFINITION_ID: {
    required: (config) => config.ENABLE_WEBHOOK_VERIFICATION !== 'false',
    canInfer: false
  },
  CDK_DEFAULT_ACCOUNT: {
    required: true,
    canInfer: true
  },
  CDK_DEFAULT_REGION: {
    required: true,
    canInfer: true
  },
  QUEUE_NAME: {
    required: true,
    canInfer: true
  },
  SQS_QUEUE_URL: {
    required: true,
    canInfer: true
  },
  QUILT_DATABASE: {
    required: true,
    canInfer: true
  }
};
```

---

## Error Handling & User Guidance

### Missing Configuration

When required parameters are missing:

```
❌ Configuration Error

Missing required parameters:
  • QUILT_CATALOG - Your Quilt catalog URL
  • BENCHLING_CLIENT_ID - Your Benchling OAuth client ID
  • BENCHLING_CLIENT_SECRET - Your Benchling OAuth client secret

To fix this, you can either:

1. Run the interactive setup:
   npx @quiltdata/benchling-webhook init

2. Create a .env file manually:
   QUILT_CATALOG=your-catalog.company.com
   BENCHLING_CLIENT_ID=client_xxxxx
   BENCHLING_CLIENT_SECRET=secret_xxxxx
   ... (see full template at: env.template)

3. Pass values as CLI options:
   npx @quiltdata/benchling-webhook deploy --catalog your-catalog.company.com \
     --client-id client_xxxxx --client-secret secret_xxxxx

For more information, see:
  npx @quiltdata/benchling-webhook help
  https://github.com/quiltdata/benchling-webhook#readme
```

### CDK Not Bootstrapped

```
❌ CDK Bootstrap Error

CDK is not bootstrapped for account 123456789012 in region us-east-1.

Before deploying, you need to bootstrap CDK:
  npx cdk bootstrap aws://123456789012/us-east-1

Or with environment variables:
  export CDK_DEFAULT_ACCOUNT=123456789012
  export CDK_DEFAULT_REGION=us-east-1
  npx cdk bootstrap

What is CDK bootstrap?
  It creates necessary AWS resources (S3 bucket, IAM roles) that CDK
  needs to deploy CloudFormation stacks. This is a one-time setup per
  AWS account/region combination.

Learn more: https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html
```

### AWS Credentials Not Configured

```
❌ AWS Credentials Error

No AWS credentials found. Please configure AWS access:

Option 1: AWS CLI
  aws configure

Option 2: Environment variables
  export AWS_ACCESS_KEY_ID=your_access_key
  export AWS_SECRET_ACCESS_KEY=your_secret_key
  export AWS_REGION=us-east-1

Option 3: AWS Profile
  npx @quiltdata/benchling-webhook deploy --profile your-profile

Learn more: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-quickstart.html
```

### Catalog Unreachable

```
⚠️  Warning: Could not connect to catalog

Could not fetch configuration from: https://quilt-catalog.company.com

Possible causes:
  • Catalog URL is incorrect
  • Network connectivity issues
  • Catalog is not publicly accessible
  • AWS credentials lack necessary permissions

You can:
  1. Verify the catalog URL is correct
  2. Check your network connection
  3. Manually specify inferred values in .env:
     CDK_DEFAULT_ACCOUNT=123456789012
     CDK_DEFAULT_REGION=us-east-1
     QUEUE_NAME=QuiltStack-PackagerQueue-ABC123
     SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/QuiltStack-PackagerQueue-ABC123
     QUILT_DATABASE=quilt_db

Continue anyway? (values must be in .env) [y/N]
```

---

## Help Display

### Main Help Screen

When user runs `npx @quiltdata/benchling-webhook` with no args or `--help`:

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║  Benchling Webhook Integration for Quilt                                    ║
║  Deploy Benchling lab notebook integration to AWS                           ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

USAGE
  npx @quiltdata/benchling-webhook <command> [options]

COMMANDS
  deploy          Deploy the CDK stack (default command)
  init            Initialize configuration interactively
  validate        Validate configuration without deploying
  help            Display this help message

OPTIONS
  -h, --help      Display help for command
  --version       Display version number

QUICK START

  1. Initialize configuration:
     $ npx @quiltdata/benchling-webhook init

  2. Review and edit .env file

  3. Deploy to AWS:
     $ npx @quiltdata/benchling-webhook deploy

EXAMPLES

  # Interactive setup and deploy
  npx @quiltdata/benchling-webhook init
  npx @quiltdata/benchling-webhook deploy

  # Deploy with CLI options
  npx @quiltdata/benchling-webhook deploy \
    --catalog quilt-catalog.company.com \
    --bucket my-data-bucket \
    --tenant company

  # Validate configuration
  npx @quiltdata/benchling-webhook validate

PREREQUISITES

  • Existing Quilt deployment in AWS
  • Node.js 18+ and npm
  • AWS CLI configured
  • Benchling account and API credentials

DOCUMENTATION

  Full docs: https://github.com/quiltdata/benchling-webhook#readme
  Issues:    https://github.com/quiltdata/benchling-webhook/issues

VERSION
  @quiltdata/benchling-webhook v0.6.0
```

### Command-Specific Help

Each command should show contextual help:

```bash
npx @quiltdata/benchling-webhook deploy --help
```

Output:

```
Deploy the Benchling webhook integration stack to AWS

USAGE
  npx @quiltdata/benchling-webhook deploy [options]

OPTIONS
  --catalog <url>                 Quilt catalog URL
  --bucket <name>                 S3 bucket for data
  --tenant <name>                 Benchling tenant
  --client-id <id>                Benchling OAuth client ID
  --client-secret <secret>        Benchling OAuth client secret
  --app-id <id>                   Benchling app definition ID
  --env-file <path>               Environment file (default: .env)
  --no-bootstrap-check            Skip CDK bootstrap verification
  --require-approval <level>      CDK approval level [default: never]
  --profile <name>                AWS profile name
  --region <region>               AWS region
  --yes                           Skip confirmation prompts
  -h, --help                      Display this help

DESCRIPTION
  Deploys AWS infrastructure for receiving Benchling webhooks and creating
  Quilt packages. Configuration is loaded from .env file and/or CLI options.

  Required configuration:
    • QUILT_CATALOG - Your Quilt catalog URL
    • QUILT_USER_BUCKET - S3 bucket for storing data
    • BENCHLING_TENANT - Your Benchling tenant name
    • BENCHLING_CLIENT_ID - OAuth client ID
    • BENCHLING_CLIENT_SECRET - OAuth client secret
    • BENCHLING_APP_DEFINITION_ID - Benchling app definition ID

  The following values are auto-inferred from your catalog:
    • CDK_DEFAULT_ACCOUNT, CDK_DEFAULT_REGION
    • QUEUE_NAME, SQS_QUEUE_URL, QUILT_DATABASE

EXAMPLES
  # Deploy with .env file
  npx @quiltdata/benchling-webhook deploy

  # Deploy with CLI options
  npx @quiltdata/benchling-webhook deploy \
    --catalog quilt-catalog.company.com \
    --bucket my-data-bucket

  # Deploy with custom env file
  npx @quiltdata/benchling-webhook deploy --env-file .env.production

  # Deploy without confirmation
  npx @quiltdata/benchling-webhook deploy --yes
```

---

## Refactoring Plan for `bin/benchling-webhook.ts`

### Current Issues

1. **Monolithic** - All logic in one file (config loading, validation, CDK execution)
2. **CLI-coupled** - Uses console.log/error directly, preventing library usage
3. **Exit-heavy** - Uses process.exit() which kills the process
4. **Not testable** - Can't easily mock or test individual functions

### Refactoring Strategy

**Split into layers:**

1. **CLI Layer** (`bin/cli.ts`) - Handles command-line interface
2. **Command Layer** (`bin/commands/*.ts`) - Implements each command
3. **Core Layer** (`bin/benchling-webhook.ts`) - Pure deployment logic
4. **Util Layer** (`lib/utils/*.ts`) - Reusable utilities

### New `bin/cli.ts`

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { deployCommand } from './commands/deploy';
import { initCommand } from './commands/init';
import { validateCommand } from './commands/validate';

const program = new Command();

program
  .name('benchling-webhook')
  .description('Benchling Webhook Integration for Quilt')
  .version(require('../package.json').version);

program
  .command('deploy', { isDefault: true })
  .description('Deploy the CDK stack')
  .option('--catalog <url>', 'Quilt catalog URL')
  .option('--bucket <name>', 'S3 bucket for data')
  .option('--tenant <name>', 'Benchling tenant')
  .option('--client-id <id>', 'Benchling client ID')
  .option('--client-secret <secret>', 'Benchling client secret')
  .option('--app-id <id>', 'Benchling app definition ID')
  .option('--env-file <path>', 'Environment file path', '.env')
  .option('--no-bootstrap-check', 'Skip CDK bootstrap check')
  .option('--require-approval <level>', 'CDK approval level', 'never')
  .option('--profile <name>', 'AWS profile')
  .option('--region <region>', 'AWS region')
  .option('--yes', 'Skip confirmation prompts')
  .action(deployCommand);

program
  .command('init')
  .description('Initialize configuration interactively')
  .option('--output <path>', 'Output file path', '.env')
  .option('--force', 'Overwrite existing file')
  .option('--minimal', 'Only prompt for required values')
  .option('--infer', 'Attempt to infer values from catalog')
  .action(initCommand);

program
  .command('validate')
  .description('Validate configuration')
  .option('--env-file <path>', 'Environment file path', '.env')
  .option('--verbose', 'Show detailed validation info')
  .action(validateCommand);

program.parse();
```

### Refactored `bin/benchling-webhook.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import { BenchlingWebhookStack } from '../lib/benchling-webhook-stack';
import { Config } from '../lib/utils/config';

/**
 * Core deployment function - no CLI coupling
 * Can be called programmatically or from CLI
 */
export async function deploy(config: Config): Promise<DeploymentResult> {
  const app = new cdk.App();

  const stack = new BenchlingWebhookStack(app, 'BenchlingWebhookStack', {
    env: {
      account: config.cdkAccount,
      region: config.cdkRegion,
    },
    bucketName: config.quiltUserBucket,
    queueName: config.queueName,
    environment: 'production',
    prefix: config.pkgPrefix || 'benchling',
    benchlingClientId: config.benchlingClientId,
    benchlingClientSecret: config.benchlingClientSecret,
    benchlingTenant: config.benchlingTenant,
    quiltCatalog: config.quiltCatalog,
    quiltDatabase: config.quiltDatabase,
    webhookAllowList: config.webhookAllowList,
    logLevel: config.logLevel || 'INFO',
    createEcrRepository: config.createEcrRepository === 'true',
    ecrRepositoryName: config.ecrRepositoryName || 'quiltdata/benchling',
  });

  return {
    app,
    stack,
    stackName: stack.stackName,
    stackId: stack.stackId,
  };
}

/**
 * Check CDK bootstrap status
 * Returns null if bootstrapped, error message if not
 */
export async function checkBootstrap(
  account: string,
  region: string
): Promise<BootstrapStatus> {
  try {
    const result = execSync(
      `aws cloudformation describe-stacks --region ${region} --stack-name CDKToolkit --query "Stacks[0].StackStatus" --output text 2>&1`,
      { encoding: 'utf-8' }
    );

    const stackStatus = result.trim();

    if (
      stackStatus.includes('does not exist') ||
      stackStatus.includes('ValidationError')
    ) {
      return {
        bootstrapped: false,
        message: `CDK is not bootstrapped for account ${account} in region ${region}`,
        command: `npx cdk bootstrap aws://${account}/${region}`,
      };
    }

    if (!stackStatus.includes('COMPLETE')) {
      return {
        bootstrapped: true,
        warning: `CDKToolkit stack is in state: ${stackStatus}`,
      };
    }

    return {
      bootstrapped: true,
      status: stackStatus,
    };
  } catch (error) {
    return {
      bootstrapped: false,
      message: `Could not verify CDK bootstrap status: ${(error as Error).message}`,
    };
  }
}

export interface DeploymentResult {
  app: cdk.App;
  stack: BenchlingWebhookStack;
  stackName: string;
  stackId: string;
}

export interface BootstrapStatus {
  bootstrapped: boolean;
  message?: string;
  command?: string;
  warning?: string;
  status?: string;
}
```

### New `lib/utils/config.ts`

```typescript
import { config as dotenvConfig } from 'dotenv';
import { expand as dotenvExpand } from 'dotenv-expand';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { inferStackConfig } from '../../bin/get-env';

export interface Config {
  // Quilt
  quiltCatalog: string;
  quiltUserBucket: string;
  quiltDatabase: string;

  // Benchling
  benchlingTenant: string;
  benchlingClientId: string;
  benchlingClientSecret: string;
  benchlingAppDefinitionId?: string;

  // AWS
  cdkAccount: string;
  cdkRegion: string;
  awsProfile?: string;

  // SQS
  queueName: string;
  sqsQueueUrl: string;

  // Optional
  pkgPrefix?: string;
  logLevel?: string;
  webhookAllowList?: string;
  enableWebhookVerification?: string;
  createEcrRepository?: string;
  ecrRepositoryName?: string;
}

export interface ConfigOptions {
  envFile?: string;
  catalog?: string;
  bucket?: string;
  tenant?: string;
  clientId?: string;
  clientSecret?: string;
  appId?: string;
  profile?: string;
  region?: string;
}

/**
 * Load configuration from multiple sources
 */
export async function loadConfig(
  options: ConfigOptions = {}
): Promise<Config> {
  // 1. Load .env file
  const envFile = resolve(options.envFile || '.env');
  const dotenvVars: Record<string, string> = {};

  if (existsSync(envFile)) {
    const result = dotenvConfig({ path: envFile });
    if (result.parsed) {
      Object.assign(dotenvVars, result.parsed);
      dotenvExpand(result);
    }
  }

  // 2. Merge with process.env
  const envVars = { ...dotenvVars, ...process.env };

  // 3. Attempt to infer from catalog
  let inferredVars: Record<string, string> = {};
  const catalog = options.catalog || envVars.QUILT_CATALOG;

  if (catalog) {
    try {
      const result = await inferStackConfig(`https://${catalog.replace(/^https?:\/\//, '')}`);
      inferredVars = result.inferredVars;
    } catch (error) {
      // Inference failure is not fatal - we'll validate later
      console.warn(`Warning: Could not infer config from catalog: ${(error as Error).message}`);
    }
  }

  // 4. Build config with priority order
  const config: Partial<Config> = {
    // Quilt
    quiltCatalog: options.catalog || envVars.QUILT_CATALOG || inferredVars.QUILT_CATALOG,
    quiltUserBucket: options.bucket || envVars.QUILT_USER_BUCKET,
    quiltDatabase: envVars.QUILT_DATABASE || inferredVars.QUILT_DATABASE,

    // Benchling
    benchlingTenant: options.tenant || envVars.BENCHLING_TENANT,
    benchlingClientId: options.clientId || envVars.BENCHLING_CLIENT_ID,
    benchlingClientSecret: options.clientSecret || envVars.BENCHLING_CLIENT_SECRET,
    benchlingAppDefinitionId: options.appId || envVars.BENCHLING_APP_DEFINITION_ID,

    // AWS
    cdkAccount: envVars.CDK_DEFAULT_ACCOUNT || inferredVars.CDK_DEFAULT_ACCOUNT,
    cdkRegion: options.region || envVars.CDK_DEFAULT_REGION || inferredVars.CDK_DEFAULT_REGION,
    awsProfile: options.profile || envVars.AWS_PROFILE,

    // SQS
    queueName: envVars.QUEUE_NAME || inferredVars.QUEUE_NAME,
    sqsQueueUrl: envVars.SQS_QUEUE_URL || inferredVars.SQS_QUEUE_URL,

    // Optional
    pkgPrefix: envVars.PKG_PREFIX || 'benchling',
    logLevel: envVars.LOG_LEVEL || 'INFO',
    webhookAllowList: envVars.WEBHOOK_ALLOW_LIST,
    enableWebhookVerification: envVars.ENABLE_WEBHOOK_VERIFICATION,
    createEcrRepository: envVars.CREATE_ECR_REPOSITORY,
    ecrRepositoryName: envVars.ECR_REPOSITORY_NAME,
  };

  return config as Config;
}

/**
 * Validate configuration
 */
export function validateConfig(config: Partial<Config>): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // Required user-provided values
  const required = [
    'quiltCatalog',
    'quiltUserBucket',
    'benchlingTenant',
    'benchlingClientId',
    'benchlingClientSecret',
  ];

  for (const field of required) {
    if (!config[field as keyof Config]) {
      errors.push({
        field,
        message: `${field} is required`,
        canInfer: false,
      });
    }
  }

  // Conditional requirement
  if (
    config.enableWebhookVerification !== 'false' &&
    !config.benchlingAppDefinitionId
  ) {
    errors.push({
      field: 'benchlingAppDefinitionId',
      message: 'BENCHLING_APP_DEFINITION_ID is required when webhook verification is enabled',
      canInfer: false,
    });
  }

  // Required inferred values
  const inferrable = [
    'cdkAccount',
    'cdkRegion',
    'queueName',
    'sqsQueueUrl',
    'quiltDatabase',
  ];

  for (const field of inferrable) {
    if (!config[field as keyof Config]) {
      errors.push({
        field,
        message: `${field} could not be inferred`,
        canInfer: true,
      });
    }
  }

  // Warnings
  if (config.enableWebhookVerification === 'false') {
    warnings.push('Webhook verification is disabled - not recommended for production');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  field: string;
  message: string;
  canInfer: boolean;
}
```

### New `bin/commands/deploy.ts`

```typescript
import { deploy, checkBootstrap } from '../benchling-webhook';
import { loadConfig, validateConfig } from '../../lib/utils/config';
import { execSync } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';

export async function deployCommand(options: any) {
  console.log(
    boxen('Benchling Webhook Deployment', {
      padding: 1,
      borderColor: 'blue',
      borderStyle: 'round',
    })
  );
  console.log();

  // 1. Load configuration
  const spinner = ora('Loading configuration...').start();
  let config;

  try {
    config = await loadConfig(options);
    spinner.succeed('Configuration loaded');
  } catch (error) {
    spinner.fail('Failed to load configuration');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  // 2. Validate configuration
  spinner.start('Validating configuration...');
  const validation = validateConfig(config);

  if (!validation.valid) {
    spinner.fail('Configuration validation failed');
    console.log();

    console.error(chalk.red.bold('❌ Configuration Error\n'));
    console.error('Missing required parameters:');

    for (const error of validation.errors) {
      console.error(chalk.red(`  • ${error.field} - ${error.message}`));
    }

    console.log();
    console.log(chalk.yellow('To fix this, you can:'));
    console.log('  1. Run: npx @quiltdata/benchling-webhook init');
    console.log('  2. Create a .env file with required values');
    console.log('  3. Pass values as CLI options');
    console.log();
    console.log('For help: npx @quiltdata/benchling-webhook help');

    process.exit(1);
  }

  spinner.succeed('Configuration validated');

  if (validation.warnings.length > 0) {
    console.log();
    console.log(chalk.yellow('⚠️  Warnings:'));
    for (const warning of validation.warnings) {
      console.log(chalk.yellow(`  • ${warning}`));
    }
  }

  // 3. Check CDK bootstrap
  if (options.bootstrapCheck !== false) {
    spinner.start('Checking CDK bootstrap status...');

    const bootstrapStatus = await checkBootstrap(
      config.cdkAccount,
      config.cdkRegion
    );

    if (!bootstrapStatus.bootstrapped) {
      spinner.fail('CDK is not bootstrapped');
      console.log();

      console.error(chalk.red.bold('❌ CDK Bootstrap Error\n'));
      console.error(bootstrapStatus.message);
      console.log();
      console.log('To bootstrap CDK, run:');
      console.log(chalk.cyan(`  ${bootstrapStatus.command}`));
      console.log();

      process.exit(1);
    }

    if (bootstrapStatus.warning) {
      spinner.warn(`CDK bootstrap: ${bootstrapStatus.warning}`);
    } else {
      spinner.succeed(`CDK is bootstrapped (${bootstrapStatus.status})`);
    }
  }

  // 4. Display deployment plan
  console.log();
  console.log(chalk.bold('Deployment Plan:'));
  console.log(chalk.gray('─'.repeat(80)));
  console.log(`  Stack:   BenchlingWebhookStack`);
  console.log(`  Account: ${config.cdkAccount}`);
  console.log(`  Region:  ${config.cdkRegion}`);
  console.log(`  Catalog: ${config.quiltCatalog}`);
  console.log(`  Bucket:  ${config.quiltUserBucket}`);
  console.log(chalk.gray('─'.repeat(80)));
  console.log();

  // 5. Confirm (unless --yes)
  if (!options.yes) {
    const { confirm } = await import('enquirer');
    const response: any = await confirm({
      message: 'Proceed with deployment?',
      initial: true,
    });

    if (!response) {
      console.log(chalk.yellow('Deployment cancelled'));
      process.exit(0);
    }
  }

  // 6. Deploy
  spinner.start('Deploying stack...');

  try {
    const result = await deploy(config);

    // Execute CDK deploy
    const cdkCommand = `npx cdk deploy --require-approval ${options.requireApproval}`;
    execSync(cdkCommand, { stdio: 'inherit' });

    spinner.succeed('Stack deployed successfully');

    console.log();
    console.log(
      boxen(
        `${chalk.green('✓')} Deployment completed successfully!\n\n` +
        `Stack: ${chalk.cyan(result.stackName)}\n` +
        `Region: ${chalk.cyan(config.cdkRegion)}\n\n` +
        `Next steps:\n` +
        `  1. Configure your Benchling app\n` +
        `  2. Set the webhook URL from AWS console\n` +
        `  3. Test the integration`,
        { padding: 1, borderColor: 'green' }
      )
    );

  } catch (error) {
    spinner.fail('Deployment failed');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}
```

---

## Testing Strategy

### Unit Tests

```typescript
// lib/utils/config.test.ts
describe('loadConfig', () => {
  it('should load from .env file', async () => {
    const config = await loadConfig({ envFile: '.env.test' });
    expect(config.quiltCatalog).toBe('test-catalog.company.com');
  });

  it('should prioritize CLI options over .env', async () => {
    const config = await loadConfig({
      envFile: '.env.test',
      catalog: 'override-catalog.company.com',
    });
    expect(config.quiltCatalog).toBe('override-catalog.company.com');
  });

  it('should infer values from catalog', async () => {
    const config = await loadConfig({ catalog: 'test-catalog.company.com' });
    expect(config.cdkAccount).toBeDefined();
    expect(config.queueName).toBeDefined();
  });
});

describe('validateConfig', () => {
  it('should fail with missing required values', () => {
    const result = validateConfig({});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(5);
  });

  it('should pass with all required values', () => {
    const result = validateConfig({
      quiltCatalog: 'test.com',
      quiltUserBucket: 'bucket',
      benchlingTenant: 'tenant',
      benchlingClientId: 'id',
      benchlingClientSecret: 'secret',
      cdkAccount: '123456789012',
      cdkRegion: 'us-east-1',
      queueName: 'queue',
      sqsQueueUrl: 'https://...',
      quiltDatabase: 'db',
    });
    expect(result.valid).toBe(true);
  });
});
```

### Integration Tests

```typescript
// bin/commands/deploy.test.ts
describe('deploy command', () => {
  it('should fail with missing config', async () => {
    await expect(deployCommand({})).rejects.toThrow();
  });

  it('should succeed with valid config', async () => {
    const result = await deployCommand({
      envFile: '.env.test',
      yes: true,
      bootstrapCheck: false,
    });
    expect(result).toBeDefined();
  });
});
```

---

## Documentation Updates

### README.md Updates

**Add new "Quick Install" section:**

```markdown
## Quick Install

### Option 1: npx (Recommended)

No need to clone the repository! Deploy directly using npx:

```bash
# Interactive setup
npx @quiltdata/benchling-webhook init
npx @quiltdata/benchling-webhook deploy

# Or provide configuration inline
npx @quiltdata/benchling-webhook deploy \
  --catalog quilt-catalog.company.com \
  --bucket my-data-bucket \
  --tenant company \
  --client-id client_xxxxx \
  --client-secret secret_xxxxx \
  --app-id appdef_xxxxx
```

### Option 2: Local Development

For customization or development:

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install
npm run deploy
```

## Usage

### CLI Commands

Run `npx @quiltdata/benchling-webhook --help` for full CLI documentation.

**Initialize configuration:**

```bash
npx @quiltdata/benchling-webhook init
```

**Deploy to AWS:**

```bash
npx @quiltdata/benchling-webhook deploy
```

**Validate configuration:**

```bash
npx @quiltdata/benchling-webhook validate
```

### Configuration

Configuration can be provided via:

1. `.env` file (recommended for local development)
2. CLI options (recommended for CI/CD)
3. Environment variables

**Required values:**

- `QUILT_CATALOG` - Your Quilt catalog URL
- `QUILT_USER_BUCKET` - S3 bucket for storing data
- `BENCHLING_TENANT` - Your Benchling tenant name
- `BENCHLING_CLIENT_ID` - Benchling OAuth client ID
- `BENCHLING_CLIENT_SECRET` - Benchling OAuth client secret
- `BENCHLING_APP_DEFINITION_ID` - Benchling app definition ID

**Auto-inferred values:**
The following are automatically discovered from your Quilt catalog:

- AWS account and region
- SQS queue name and URL
- Quilt database name

See [env.template](env.template) for all options.

```

**Update "Programmatic Usage" section:**

```markdown
## Programmatic Usage

This package can also be imported and used as a library:

```typescript
import { deploy, checkBootstrap } from '@quiltdata/benchling-webhook';
import { loadConfig } from '@quiltdata/benchling-webhook/utils';

async function main() {
  // Load configuration
  const config = await loadConfig({
    catalog: 'my-catalog.company.com',
    bucket: 'my-data-bucket',
    // ... other options
  });

  // Check CDK bootstrap
  const bootstrapStatus = await checkBootstrap(
    config.cdkAccount,
    config.cdkRegion
  );

  if (!bootstrapStatus.bootstrapped) {
    throw new Error(bootstrapStatus.message);
  }

  // Deploy
  const result = await deploy(config);
  console.log(`Deployed stack: ${result.stackName}`);
}

main();
```

```

---

## Migration Path

### For Existing Users

Users who have already cloned the repo can continue using it as before. The CLI changes are backwards-compatible:

**Old way (still works):**
```bash
git clone ...
cd benchling-webhook
npm install
source .env
npm run deploy
```

**New way:**

```bash
npx @quiltdata/benchling-webhook deploy
```

### For New Users

New users should be directed to the `npx` approach in all documentation:

1. Update README.md to show `npx` first
2. Update AGENTS.md quick start guide
3. Add migration guide for existing users

---

## Build & Publish Configuration

### TypeScript Build

Update `tsconfig.json` to compile CLI files:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["bin/**/*", "lib/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### Pre-publish Script

Add to `package.json`:

```json
{
  "scripts": {
    "prepublish": "npm run build && npm run test",
    "build": "tsc",
    "postbuild": "chmod +x dist/bin/cli.js"
  }
}
```

### npm Package Files

Ensure `package.json` includes:

```json
{
  "files": [
    "dist/",
    "README.md",
    "LICENSE",
    "env.template"
  ]
}
```

---

## Success Metrics

The CLI implementation is successful if:

1. **User can run from scratch:**

   ```bash
   npx @quiltdata/benchling-webhook init
   npx @quiltdata/benchling-webhook deploy
   ```

   Should work without ANY manual file editing (if all credentials are provided interactively)

2. **Error messages are actionable:**
   Every error should tell the user exactly what to do next

3. **Zero configuration discovery:**
   User only needs to provide Benchling credentials + Quilt catalog URL.
   Everything else should be inferred.

4. **Library usage still works:**
   Package can still be imported and used programmatically

5. **Help is comprehensive:**
   `--help` at any level provides clear, formatted guidance

---

## Open Questions

1. **Should we support reading Benchling credentials from AWS Secrets Manager?**
   - Pro: More secure, no .env file needed
   - Con: Extra AWS permissions required

2. **Should `init` command support OAuth flow for Benchling credentials?**
   - Pro: Better UX, no manual credential copying
   - Con: Requires running local web server

3. **Should we provide a `destroy` command?**
   - Pro: Easy cleanup
   - Con: Dangerous if misused

4. **Should we add a `status` command to check deployment health?**
   - Pro: Useful for monitoring
   - Con: Scope creep

5. **Should we support multiple profiles/environments?**

   ```bash
   npx @quiltdata/benchling-webhook deploy --env production
   ```

   - Pro: Easier multi-environment management
   - Con: Adds complexity

---

## Next Steps

1. **Review this spec** - Get feedback from team
2. **Create implementation tasks** - Break down into discrete PRs
3. **Implement core refactoring** - Split bin/benchling-webhook.ts
4. **Add CLI layer** - Implement commander-based interface
5. **Add interactive init** - Implement enquirer-based setup
6. **Update documentation** - README, AGENTS.md, etc.
7. **Test with real deployments** - Dogfood the new CLI
8. **Publish beta version** - Get user feedback
9. **Iterate based on feedback** - Refine UX

---

## Appendix: Key Dependencies

### CLI Libraries

- **commander** - Command-line argument parsing
- **enquirer** - Interactive prompts
- **chalk** - Terminal colors
- **ora** - Spinner/progress indicators
- **boxen** - Terminal boxes for emphasis
- **dotenv** + **dotenv-expand** - Environment variable loading

### Why These?

- **commander**: Industry standard, well-maintained, great TypeScript support
- **enquirer**: Better UX than inquirer, smaller bundle size
- **chalk**: Most popular terminal coloring library
- **ora**: Beautiful spinners with promise support
- **boxen**: Clean way to emphasize important messages
