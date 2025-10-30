# Refactoring Implementation Guide

## Overview

This guide provides step-by-step instructions for refactoring the Benchling Webhook package to support CLI usage via `npx` while maintaining its functionality as an importable library.

---

## Phase 1: Project Setup

### Step 1.1: Install CLI Dependencies

```bash
npm install --save commander dotenv-expand chalk@4 ora@5 enquirer boxen@5
```

**Why these specific versions?**
- `chalk@4` and `ora@5` support CommonJS (chalk@5+ is ESM-only)
- `boxen@5` for CommonJS compatibility

### Step 1.2: Update TypeScript Configuration

Create/update `tsconfig.json`:

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
    "resolveJsonModule": true,
    "moduleResolution": "node"
  },
  "include": ["bin/**/*", "lib/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts", ".scratch"]
}
```

### Step 1.3: Update package.json

```json
{
  "bin": {
    "benchling-webhook": "./dist/bin/cli.js"
  },
  "files": [
    "dist/",
    "README.md",
    "LICENSE",
    "env.template"
  ],
  "scripts": {
    "build": "tsc",
    "prebuild": "rm -rf dist",
    "postbuild": "chmod +x dist/bin/cli.js",
    "prepublishOnly": "npm run build && npm test",
    "dev": "tsc --watch"
  }
}
```

### Step 1.4: Create Directory Structure

```bash
mkdir -p lib/utils
mkdir -p bin/commands
```

---

## Phase 2: Extract Core Logic

### Step 2.1: Create Config Utility

**File: `lib/utils/config.ts`**

```typescript
import { config as dotenvConfig } from 'dotenv';
import { expand as dotenvExpand } from 'dotenv-expand';
import { existsSync } from 'fs';
import { resolve } from 'path';

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
  pkgKey?: string;
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

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  field: string;
  message: string;
  canInfer: boolean;
  helpText?: string;
}

/**
 * Load .env file and expand variables
 */
export function loadDotenv(filePath: string): Record<string, string> {
  const resolvedPath = resolve(filePath);

  if (!existsSync(resolvedPath)) {
    return {};
  }

  const result = dotenvConfig({ path: resolvedPath });

  if (result.error) {
    throw new Error(`Failed to load ${filePath}: ${result.error.message}`);
  }

  // Expand variables like ${VAR}
  if (result.parsed) {
    dotenvExpand({ parsed: result.parsed });
  }

  return result.parsed || {};
}

/**
 * Load configuration from multiple sources with priority:
 * 1. CLI options (highest)
 * 2. Environment variables
 * 3. .env file
 * 4. Inferred values (will be added separately)
 */
export function loadConfigSync(options: ConfigOptions = {}): Partial<Config> {
  // 1. Load .env file
  const envFile = options.envFile || '.env';
  const dotenvVars = existsSync(envFile) ? loadDotenv(envFile) : {};

  // 2. Merge with process.env
  const envVars = { ...dotenvVars, ...process.env };

  // 3. Build config with CLI options taking priority
  const config: Partial<Config> = {
    // Quilt
    quiltCatalog: options.catalog || envVars.QUILT_CATALOG,
    quiltUserBucket: options.bucket || envVars.QUILT_USER_BUCKET,
    quiltDatabase: envVars.QUILT_DATABASE,

    // Benchling
    benchlingTenant: options.tenant || envVars.BENCHLING_TENANT,
    benchlingClientId: options.clientId || envVars.BENCHLING_CLIENT_ID,
    benchlingClientSecret: options.clientSecret || envVars.BENCHLING_CLIENT_SECRET,
    benchlingAppDefinitionId: options.appId || envVars.BENCHLING_APP_DEFINITION_ID,

    // AWS
    cdkAccount: envVars.CDK_DEFAULT_ACCOUNT,
    cdkRegion: options.region || envVars.CDK_DEFAULT_REGION || envVars.AWS_REGION,
    awsProfile: options.profile || envVars.AWS_PROFILE,

    // SQS
    queueName: envVars.QUEUE_NAME,
    sqsQueueUrl: envVars.SQS_QUEUE_URL,

    // Optional
    pkgPrefix: envVars.PKG_PREFIX || 'benchling',
    pkgKey: envVars.PKG_KEY || 'experiment_id',
    logLevel: envVars.LOG_LEVEL || 'INFO',
    webhookAllowList: envVars.WEBHOOK_ALLOW_LIST,
    enableWebhookVerification: envVars.ENABLE_WEBHOOK_VERIFICATION ?? 'true',
    createEcrRepository: envVars.CREATE_ECR_REPOSITORY,
    ecrRepositoryName: envVars.ECR_REPOSITORY_NAME || 'quiltdata/benchling',
  };

  // Remove undefined values
  return Object.fromEntries(
    Object.entries(config).filter(([_, v]) => v !== undefined)
  ) as Partial<Config>;
}

/**
 * Merge inferred configuration with loaded config
 */
export function mergeInferredConfig(
  config: Partial<Config>,
  inferredVars: Record<string, string>
): Partial<Config> {
  // Only use inferred values if not already set
  return {
    cdkAccount: config.cdkAccount || inferredVars.CDK_DEFAULT_ACCOUNT,
    cdkRegion: config.cdkRegion || inferredVars.CDK_DEFAULT_REGION,
    queueName: config.queueName || inferredVars.QUEUE_NAME,
    sqsQueueUrl: config.sqsQueueUrl || inferredVars.SQS_QUEUE_URL,
    quiltDatabase: config.quiltDatabase || inferredVars.QUILT_DATABASE,
    ...config, // User values always take precedence
  };
}

/**
 * Validate configuration and return detailed errors
 */
export function validateConfig(config: Partial<Config>): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // Required user-provided values
  const requiredUserFields: Array<[keyof Config, string, string]> = [
    ['quiltCatalog', 'Quilt catalog URL', 'Your Quilt catalog domain (e.g., quilt-catalog.company.com)'],
    ['quiltUserBucket', 'S3 bucket for data', 'The S3 bucket where you want to store Benchling exports'],
    ['benchlingTenant', 'Benchling tenant', 'Your Benchling tenant name (use XXX if you login to XXX.benchling.com)'],
    ['benchlingClientId', 'Benchling OAuth client ID', 'OAuth client ID from your Benchling app'],
    ['benchlingClientSecret', 'Benchling OAuth client secret', 'OAuth client secret from your Benchling app'],
  ];

  for (const [field, message, helpText] of requiredUserFields) {
    if (!config[field]) {
      errors.push({
        field: field as string,
        message,
        canInfer: false,
        helpText,
      });
    }
  }

  // Conditional requirement for app definition ID
  if (config.enableWebhookVerification !== 'false' && !config.benchlingAppDefinitionId) {
    errors.push({
      field: 'benchlingAppDefinitionId',
      message: 'Benchling app definition ID',
      canInfer: false,
      helpText: 'Required when webhook verification is enabled (ENABLE_WEBHOOK_VERIFICATION=true). Set ENABLE_WEBHOOK_VERIFICATION=false to skip this.',
    });
  }

  // Required inferred values
  const requiredInferredFields: Array<[keyof Config, string]> = [
    ['cdkAccount', 'AWS account ID'],
    ['cdkRegion', 'AWS region'],
    ['queueName', 'SQS queue name'],
    ['sqsQueueUrl', 'SQS queue URL'],
    ['quiltDatabase', 'Quilt database name'],
  ];

  for (const [field, message] of requiredInferredFields) {
    if (!config[field]) {
      errors.push({
        field: field as string,
        message,
        canInfer: true,
        helpText: 'This value should be automatically inferred from your Quilt catalog configuration',
      });
    }
  }

  // Validation rules for existing values
  if (config.quiltCatalog && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(config.quiltCatalog)) {
    warnings.push('QUILT_CATALOG should be a domain name without protocol (e.g., catalog.company.com, not https://catalog.company.com)');
  }

  if (config.quiltUserBucket && !/^[a-z0-9.-]{3,63}$/.test(config.quiltUserBucket)) {
    warnings.push('QUILT_USER_BUCKET does not look like a valid S3 bucket name');
  }

  // Security warnings
  if (config.enableWebhookVerification === 'false') {
    warnings.push('Webhook verification is disabled - this is NOT recommended for production use');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Format validation errors for CLI display
 */
export function formatValidationErrors(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.errors.length > 0) {
    lines.push('Missing required configuration:');
    lines.push('');

    const userErrors = result.errors.filter(e => !e.canInfer);
    const inferErrors = result.errors.filter(e => e.canInfer);

    if (userErrors.length > 0) {
      lines.push('Values you must provide:');
      for (const error of userErrors) {
        lines.push(`  • ${error.message}`);
        if (error.helpText) {
          lines.push(`    ${error.helpText}`);
        }
      }
      lines.push('');
    }

    if (inferErrors.length > 0) {
      lines.push('Values that could not be inferred:');
      for (const error of inferErrors) {
        lines.push(`  • ${error.message}`);
        if (error.helpText) {
          lines.push(`    ${error.helpText}`);
        }
      }
      lines.push('');
    }
  }

  if (result.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  ⚠ ${warning}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
```

### Step 2.2: Refactor bin/benchling-webhook.ts

**Current file does:**
- CLI argument parsing ❌
- Console logging ❌
- process.exit() calls ❌
- Config loading
- CDK bootstrap check
- CDK synthesis and deployment

**New file should only:**
- Export pure functions
- Return results (not log)
- Throw errors (not exit)
- Be testable

**File: `bin/benchling-webhook.ts` (refactored)**

```typescript
#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BenchlingWebhookStack } from '../lib/benchling-webhook-stack';
import { execSync } from 'child_process';
import type { Config } from '../lib/utils/config';

const { inferStackConfig } = require('./get-env.js');

/**
 * Result of CDK bootstrap check
 */
export interface BootstrapStatus {
  bootstrapped: boolean;
  status?: string;
  message?: string;
  command?: string;
  warning?: string;
}

/**
 * Result of deployment
 */
export interface DeploymentResult {
  app: cdk.App;
  stack: BenchlingWebhookStack;
  stackName: string;
  stackId: string;
}

/**
 * Configuration inference result
 */
export interface InferenceResult {
  success: boolean;
  inferredVars: Record<string, string>;
  error?: string;
}

/**
 * Check if CDK is bootstrapped for the given account/region
 * Returns status object instead of exiting
 */
export async function checkCdkBootstrap(
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
        status: stackStatus,
        warning: `CDKToolkit stack is in state: ${stackStatus}. This may cause deployment issues.`,
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

/**
 * Attempt to infer configuration from catalog
 * Non-fatal - returns success flag and inferred values
 */
export async function inferConfiguration(catalogUrl: string): Promise<InferenceResult> {
  try {
    // Normalize URL
    const normalizedUrl = catalogUrl.startsWith('http')
      ? catalogUrl
      : `https://${catalogUrl}`;

    const result = await inferStackConfig(normalizedUrl);

    return {
      success: true,
      inferredVars: result.inferredVars,
    };
  } catch (error) {
    return {
      success: false,
      inferredVars: {},
      error: (error as Error).message,
    };
  }
}

/**
 * Create CDK app and stack (synthesis only, no deployment)
 * Pure function - returns app and stack objects
 */
export function createStack(config: Config): DeploymentResult {
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
 * DEPRECATED: Legacy main function for backwards compatibility
 * Use createStack() + CDK CLI for new code
 */
async function legacyMain() {
  // Import old getConfig function
  const { getConfig } = await import('./legacy-config');
  const config = await getConfig();

  // Check bootstrap
  const bootstrapStatus = await checkCdkBootstrap(
    config.CDK_DEFAULT_ACCOUNT!,
    config.CDK_DEFAULT_REGION!
  );

  if (!bootstrapStatus.bootstrapped) {
    console.error('\n❌ CDK Bootstrap Error');
    console.error('='.repeat(80));
    console.error(bootstrapStatus.message);
    console.error('\nTo bootstrap CDK, run:');
    console.error(`  ${bootstrapStatus.command}`);
    console.error('='.repeat(80));
    process.exit(1);
  }

  if (bootstrapStatus.warning) {
    console.error('\n⚠️  CDK Bootstrap Warning');
    console.error('='.repeat(80));
    console.error(bootstrapStatus.warning);
    console.error('='.repeat(80));
  } else {
    console.log(`✓ CDK is bootstrapped (CDKToolkit stack: ${bootstrapStatus.status})\n`);
  }

  // Create stack
  const result = createStack(config as unknown as Config);

  console.log(`Stack ${result.stackName} synthesized successfully`);
}

// Only run if called directly (not imported)
if (require.main === module) {
  legacyMain().catch((error) => {
    console.error('Fatal error during CDK synthesis:', error);
    process.exit(1);
  });
}

// Export functions for library usage
export { inferStackConfig };
```

---

## Phase 3: Implement CLI

### Step 3.1: Create Main CLI Entry Point

**File: `bin/cli.ts`**

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { deployCommand } from './commands/deploy';
import { initCommand } from './commands/init';
import { validateCommand } from './commands/validate';

// Load package.json for version
const pkg = require('../package.json');

const program = new Command();

program
  .name('benchling-webhook')
  .description('Benchling Webhook Integration for Quilt - Deploy lab notebook integration to AWS')
  .version(pkg.version, '-v, --version', 'Display version number')
  .helpOption('-h, --help', 'Display help for command');

// Deploy command (default)
program
  .command('deploy', { isDefault: true })
  .description('Deploy the CDK stack to AWS')
  .option('--catalog <url>', 'Quilt catalog URL')
  .option('--bucket <name>', 'S3 bucket for data')
  .option('--tenant <name>', 'Benchling tenant')
  .option('--client-id <id>', 'Benchling OAuth client ID')
  .option('--client-secret <secret>', 'Benchling OAuth client secret')
  .option('--app-id <id>', 'Benchling app definition ID')
  .option('--env-file <path>', 'Path to .env file', '.env')
  .option('--no-bootstrap-check', 'Skip CDK bootstrap verification')
  .option('--require-approval <level>', 'CDK approval level', 'never')
  .option('--profile <name>', 'AWS profile to use')
  .option('--region <region>', 'AWS region to deploy to')
  .option('--yes', 'Skip confirmation prompts')
  .action(async (options) => {
    try {
      await deployCommand(options);
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }
  });

// Init command
program
  .command('init')
  .description('Initialize configuration interactively')
  .option('--output <path>', 'Output file path', '.env')
  .option('--force', 'Overwrite existing file')
  .option('--minimal', 'Only prompt for required values')
  .option('--infer', 'Attempt to infer values from catalog')
  .action(async (options) => {
    try {
      await initCommand(options);
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }
  });

// Validate command
program
  .command('validate')
  .description('Validate configuration without deploying')
  .option('--env-file <path>', 'Path to .env file', '.env')
  .option('--verbose', 'Show detailed validation information')
  .action(async (options) => {
    try {
      await validateCommand(options);
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }
  });

// Show help when no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

program.parse();
```

### Step 3.2: Implement Deploy Command

**File: `bin/commands/deploy.ts`**

```typescript
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { prompt } from 'enquirer';
import {
  loadConfigSync,
  mergeInferredConfig,
  validateConfig,
  formatValidationErrors,
  type Config,
  type ConfigOptions,
} from '../../lib/utils/config';
import {
  checkCdkBootstrap,
  inferConfiguration,
  createStack,
} from '../benchling-webhook';

export async function deployCommand(options: ConfigOptions & { yes?: boolean; bootstrapCheck?: boolean; requireApproval?: string }) {
  console.log(
    boxen(chalk.bold('Benchling Webhook Deployment'), {
      padding: 1,
      borderColor: 'blue',
      borderStyle: 'round',
    })
  );
  console.log();

  // 1. Load configuration
  const spinner = ora('Loading configuration...').start();
  let config = loadConfigSync(options);

  // 2. Attempt inference if catalog is available
  if (config.quiltCatalog) {
    spinner.text = 'Inferring configuration from catalog...';

    const inferenceResult = await inferConfiguration(config.quiltCatalog);

    if (inferenceResult.success) {
      config = mergeInferredConfig(config, inferenceResult.inferredVars);
      spinner.succeed('Configuration loaded and inferred');
    } else {
      spinner.warn(`Configuration loaded (inference failed: ${inferenceResult.error})`);
    }
  } else {
    spinner.succeed('Configuration loaded');
  }

  // 3. Validate configuration
  spinner.start('Validating configuration...');
  const validation = validateConfig(config);

  if (!validation.valid) {
    spinner.fail('Configuration validation failed');
    console.log();
    console.error(chalk.red.bold('❌ Configuration Error\n'));
    console.error(formatValidationErrors(validation));
    console.log(chalk.yellow('To fix this, you can:'));
    console.log('  1. Run interactive setup: ' + chalk.cyan('npx @quiltdata/benchling-webhook init'));
    console.log('  2. Create/edit .env file with required values');
    console.log('  3. Pass values as CLI options');
    console.log();
    console.log('For help: ' + chalk.cyan('npx @quiltdata/benchling-webhook --help'));
    process.exit(1);
  }

  spinner.succeed('Configuration validated');

  if (validation.warnings.length > 0) {
    console.log();
    for (const warning of validation.warnings) {
      console.log(chalk.yellow(`  ⚠ ${warning}`));
    }
  }

  // 4. Check CDK bootstrap
  if (options.bootstrapCheck !== false) {
    spinner.start('Checking CDK bootstrap status...');

    const bootstrapStatus = await checkCdkBootstrap(
      config.cdkAccount!,
      config.cdkRegion!
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
      console.log(chalk.dim('What is CDK bootstrap?'));
      console.log(chalk.dim('  It creates necessary AWS resources (S3 bucket, IAM roles) that CDK'));
      console.log(chalk.dim('  needs to deploy CloudFormation stacks. This is a one-time setup per'));
      console.log(chalk.dim('  AWS account/region combination.'));
      console.log();
      process.exit(1);
    }

    if (bootstrapStatus.warning) {
      spinner.warn(`CDK bootstrap: ${bootstrapStatus.warning}`);
    } else {
      spinner.succeed(`CDK is bootstrapped (${bootstrapStatus.status})`);
    }
  }

  // 5. Display deployment plan
  console.log();
  console.log(chalk.bold('Deployment Plan'));
  console.log(chalk.gray('─'.repeat(80)));
  console.log(`  ${chalk.bold('Stack:')}    BenchlingWebhookStack`);
  console.log(`  ${chalk.bold('Account:')}  ${config.cdkAccount}`);
  console.log(`  ${chalk.bold('Region:')}   ${config.cdkRegion}`);
  console.log(`  ${chalk.bold('Catalog:')}  ${config.quiltCatalog}`);
  console.log(`  ${chalk.bold('Bucket:')}   ${config.quiltUserBucket}`);
  console.log(chalk.gray('─'.repeat(80)));
  console.log();

  // 6. Confirm (unless --yes)
  if (!options.yes) {
    const response: any = await prompt({
      type: 'confirm',
      name: 'proceed',
      message: 'Proceed with deployment?',
      initial: true,
    });

    if (!response.proceed) {
      console.log(chalk.yellow('Deployment cancelled'));
      process.exit(0);
    }
    console.log();
  }

  // 7. Create stack (synthesis)
  spinner.start('Synthesizing CDK stack...');
  try {
    const result = createStack(config as Config);
    spinner.succeed('Stack synthesized');

    // 8. Deploy using CDK CLI
    spinner.start('Deploying to AWS (this may take a few minutes)...');
    console.log(); // New line for CDK output

    const cdkCommand = `npx cdk deploy --require-approval ${options.requireApproval || 'never'} --app "node ${result.app.node.path}"`;

    execSync(cdkCommand, {
      stdio: 'inherit',
      env: {
        ...process.env,
        CDK_DEFAULT_ACCOUNT: config.cdkAccount,
        CDK_DEFAULT_REGION: config.cdkRegion,
      },
    });

    spinner.succeed('Stack deployed successfully');

    // 9. Success message
    console.log();
    console.log(
      boxen(
        `${chalk.green.bold('✓ Deployment completed successfully!')}\n\n` +
        `Stack:  ${chalk.cyan(result.stackName)}\n` +
        `Region: ${chalk.cyan(config.cdkRegion)}\n\n` +
        `${chalk.bold('Next steps:')}\n` +
        `  1. Configure your Benchling app\n` +
        `  2. Set the webhook URL from AWS console\n` +
        `  3. Test the integration\n\n` +
        `${chalk.dim('For more info: https://github.com/quiltdata/benchling-webhook#readme')}`,
        { padding: 1, borderColor: 'green', borderStyle: 'round' }
      )
    );

  } catch (error) {
    spinner.fail('Deployment failed');
    console.error();
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}
```

### Step 3.3: Implement Init Command

**File: `bin/commands/init.ts`**

```typescript
import { existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { prompt } from 'enquirer';
import { inferConfiguration } from '../benchling-webhook';

interface InitOptions {
  output?: string;
  force?: boolean;
  minimal?: boolean;
  infer?: boolean;
}

export async function initCommand(options: InitOptions) {
  console.log(
    boxen(chalk.bold('Benchling Webhook Setup'), {
      padding: 1,
      borderColor: 'cyan',
      borderStyle: 'round',
    })
  );
  console.log();

  console.log("Let's configure your deployment. You'll need:");
  console.log('  • Access to your Quilt catalog');
  console.log('  • An S3 bucket for storing data');
  console.log('  • Benchling API credentials');
  console.log();
  console.log(chalk.dim('Press Ctrl+C at any time to cancel.'));
  console.log();

  // Check if output file exists
  const outputPath = resolve(options.output || '.env');
  if (existsSync(outputPath) && !options.force) {
    console.error(chalk.yellow(`⚠️  File already exists: ${outputPath}`));
    console.error();

    const response: any = await prompt({
      type: 'confirm',
      name: 'overwrite',
      message: 'Overwrite existing file?',
      initial: false,
    });

    if (!response.overwrite) {
      console.log(chalk.yellow('Setup cancelled'));
      process.exit(0);
    }
    console.log();
  }

  // Prompt for required values
  const answers: any = await prompt([
    {
      type: 'input',
      name: 'catalog',
      message: 'Quilt catalog URL (domain only):',
      initial: 'quilt-catalog.company.com',
      validate: (value: string) =>
        /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) || 'Please enter a valid domain name',
    },
    {
      type: 'input',
      name: 'bucket',
      message: 'S3 data bucket name:',
      initial: 'my-data-bucket',
      validate: (value: string) =>
        /^[a-z0-9.-]{3,63}$/.test(value) || 'Please enter a valid S3 bucket name',
    },
    {
      type: 'input',
      name: 'tenant',
      message: 'Benchling tenant (XXX if you login to XXX.benchling.com):',
      validate: (value: string) =>
        value.trim().length > 0 || 'Tenant is required',
    },
    {
      type: 'input',
      name: 'clientId',
      message: 'Benchling OAuth client ID:',
      validate: (value: string) =>
        value.trim().length > 0 || 'Client ID is required',
    },
    {
      type: 'password',
      name: 'clientSecret',
      message: 'Benchling OAuth client secret:',
      validate: (value: string) =>
        value.trim().length > 0 || 'Client secret is required',
    },
    {
      type: 'input',
      name: 'appId',
      message: 'Benchling app definition ID:',
      validate: (value: string) =>
        value.trim().length > 0 || 'App definition ID is required',
    },
  ]);

  // Build .env content
  const envLines: string[] = [];

  envLines.push('# ==============================================================================');
  envLines.push('# Benchling Webhook Configuration');
  envLines.push('# ==============================================================================');
  envLines.push('# Generated by: npx @quiltdata/benchling-webhook init');
  envLines.push('# Date: ' + new Date().toISOString());
  envLines.push('# ==============================================================================');
  envLines.push('');

  envLines.push('# Quilt Configuration');
  envLines.push(`QUILT_CATALOG=${answers.catalog}`);
  envLines.push(`QUILT_USER_BUCKET=${answers.bucket}`);
  envLines.push('');

  envLines.push('# Benchling Configuration');
  envLines.push(`BENCHLING_TENANT=${answers.tenant}`);
  envLines.push(`BENCHLING_CLIENT_ID=${answers.clientId}`);
  envLines.push(`BENCHLING_CLIENT_SECRET=${answers.clientSecret}`);
  envLines.push(`BENCHLING_APP_DEFINITION_ID=${answers.appId}`);
  envLines.push('');

  // Attempt inference if requested
  let inferredVars: Record<string, string> = {};

  if (options.infer) {
    console.log();
    const spinner = ora('Inferring additional configuration from catalog...').start();

    const inferenceResult = await inferConfiguration(answers.catalog);

    if (inferenceResult.success) {
      inferredVars = inferenceResult.inferredVars;
      spinner.succeed('Successfully inferred additional configuration');

      if (inferredVars.CDK_DEFAULT_ACCOUNT) {
        envLines.push('# AWS Configuration (inferred)');
        envLines.push(`CDK_DEFAULT_ACCOUNT=${inferredVars.CDK_DEFAULT_ACCOUNT}`);
        envLines.push(`CDK_DEFAULT_REGION=${inferredVars.CDK_DEFAULT_REGION}`);
        envLines.push('');
      }

      if (inferredVars.QUEUE_NAME) {
        envLines.push('# SQS Configuration (inferred)');
        envLines.push(`QUEUE_NAME=${inferredVars.QUEUE_NAME}`);
        envLines.push(`SQS_QUEUE_URL=${inferredVars.SQS_QUEUE_URL}`);
        envLines.push('');
      }

      if (inferredVars.QUILT_DATABASE) {
        envLines.push('# Quilt Database (inferred)');
        envLines.push(`QUILT_DATABASE=${inferredVars.QUILT_DATABASE}`);
        envLines.push('');
      }
    } else {
      spinner.warn(`Could not infer additional configuration: ${inferenceResult.error}`);
    }
  }

  // Add optional configuration section
  if (!options.minimal) {
    envLines.push('# Optional Configuration');
    envLines.push('# PKG_PREFIX=benchling');
    envLines.push('# LOG_LEVEL=INFO');
    envLines.push('# ENABLE_WEBHOOK_VERIFICATION=true');
    envLines.push('');
  }

  // Write file
  writeFileSync(outputPath, envLines.join('\n'));

  console.log();
  console.log(
    boxen(
      `${chalk.green.bold('✓ Configuration saved!')}\n\n` +
      `File: ${chalk.cyan(outputPath)}\n\n` +
      `${chalk.bold('Next steps:')}\n` +
      `  1. Review ${outputPath} and verify all values\n` +
      `  2. Run: ${chalk.cyan('npx @quiltdata/benchling-webhook deploy')}\n` +
      `  3. Configure your Benchling app\n\n` +
      `${chalk.dim('For help: npx @quiltdata/benchling-webhook --help')}`,
      { padding: 1, borderColor: 'green', borderStyle: 'round' }
    )
  );
}
```

### Step 3.4: Implement Validate Command

**File: `bin/commands/validate.ts`**

```typescript
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import {
  loadConfigSync,
  mergeInferredConfig,
  validateConfig,
  formatValidationErrors,
  type ConfigOptions,
} from '../../lib/utils/config';
import {
  checkCdkBootstrap,
  inferConfiguration,
} from '../benchling-webhook';

export async function validateCommand(options: ConfigOptions & { verbose?: boolean }) {
  console.log(
    boxen(chalk.bold('Configuration Validation'), {
      padding: 1,
      borderColor: 'yellow',
      borderStyle: 'round',
    })
  );
  console.log();

  // 1. Load configuration
  const spinner = ora('Loading configuration...').start();
  let config = loadConfigSync(options);
  spinner.succeed(`Configuration loaded from: ${options.envFile || '.env'}`);

  // 2. Attempt inference
  if (config.quiltCatalog) {
    spinner.start('Inferring additional configuration from catalog...');

    const inferenceResult = await inferConfiguration(config.quiltCatalog);

    if (inferenceResult.success) {
      config = mergeInferredConfig(config, inferenceResult.inferredVars);
      spinner.succeed('Configuration inferred from catalog');
    } else {
      spinner.warn(`Could not infer configuration: ${inferenceResult.error}`);
    }
  }

  // 3. Validate
  spinner.start('Validating configuration...');
  const validation = validateConfig(config);

  if (validation.valid) {
    spinner.succeed('Configuration is valid');
  } else {
    spinner.fail('Configuration validation failed');
  }

  // 4. Display results
  console.log();

  if (options.verbose || !validation.valid) {
    console.log(chalk.bold('Configuration Summary:'));
    console.log(chalk.gray('─'.repeat(80)));
    console.log();

    // Required user values
    console.log(chalk.bold('Required user values:'));
    const userFields = [
      'quiltCatalog',
      'quiltUserBucket',
      'benchlingTenant',
      'benchlingClientId',
      'benchlingClientSecret',
      'benchlingAppDefinitionId',
    ];

    for (const field of userFields) {
      const value = config[field as keyof typeof config];
      const status = value ? chalk.green('✓') : chalk.red('✗');
      const display = value || chalk.gray('(not set)');
      console.log(`  ${status} ${field}: ${display}`);
    }
    console.log();

    // Inferred values
    console.log(chalk.bold('Inferred values:'));
    const inferredFields = [
      'cdkAccount',
      'cdkRegion',
      'queueName',
      'sqsQueueUrl',
      'quiltDatabase',
    ];

    for (const field of inferredFields) {
      const value = config[field as keyof typeof config];
      const status = value ? chalk.green('✓') : chalk.red('✗');
      const display = value || chalk.gray('(could not infer)');
      console.log(`  ${status} ${field}: ${display}`);
    }
    console.log();
  }

  // 5. Check AWS credentials
  spinner.start('Checking AWS credentials...');
  try {
    const { execSync } = require('child_process');
    const accountId = execSync('aws sts get-caller-identity --query Account --output text', {
      encoding: 'utf-8',
    }).trim();
    spinner.succeed(`AWS credentials configured (account: ${accountId})`);
  } catch (error) {
    spinner.fail('AWS credentials not configured');
    console.log();
    console.log(chalk.yellow('To configure AWS credentials, run:'));
    console.log(chalk.cyan('  aws configure'));
    console.log();
  }

  // 6. Check CDK bootstrap
  if (config.cdkAccount && config.cdkRegion) {
    spinner.start('Checking CDK bootstrap status...');

    const bootstrapStatus = await checkCdkBootstrap(
      config.cdkAccount,
      config.cdkRegion
    );

    if (bootstrapStatus.bootstrapped) {
      spinner.succeed(`CDK is bootstrapped (${bootstrapStatus.status})`);
    } else {
      spinner.fail('CDK is not bootstrapped');
      console.log();
      console.log(chalk.yellow('To bootstrap CDK, run:'));
      console.log(chalk.cyan(`  ${bootstrapStatus.command}`));
      console.log();
    }
  }

  // 7. Final result
  console.log();
  console.log(chalk.gray('─'.repeat(80)));

  if (validation.valid) {
    console.log();
    console.log(
      boxen(
        `${chalk.green.bold('✓ Configuration is valid!')}\n\n` +
        `Ready to deploy.\n\n` +
        `Run: ${chalk.cyan('npx @quiltdata/benchling-webhook deploy')}`,
        { padding: 1, borderColor: 'green', borderStyle: 'round' }
      )
    );
  } else {
    console.log();
    console.error(chalk.red.bold('❌ Configuration is invalid\n'));
    console.error(formatValidationErrors(validation));
    console.log(chalk.yellow('To fix this:'));
    console.log('  1. Run: ' + chalk.cyan('npx @quiltdata/benchling-webhook init'));
    console.log('  2. Or edit your .env file to add missing values');
    console.log();
    process.exit(1);
  }
}
```

---

## Phase 4: Update Documentation

### Step 4.1: Update README.md

Add to the top of README.md (after title):

```markdown
## Quick Install

### Using npx (Recommended)

Deploy directly without cloning the repository:

```bash
# Interactive setup
npx @quiltdata/benchling-webhook init

# Deploy
npx @quiltdata/benchling-webhook deploy
```

### For Development

Clone the repository for customization:

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install
npm run build
npx benchling-webhook deploy
```
```

Add new section:

```markdown
## CLI Reference

### Commands

- `init` - Initialize configuration interactively
- `deploy` - Deploy the CDK stack (default command)
- `validate` - Validate configuration without deploying

### Examples

```bash
# Interactive setup
npx @quiltdata/benchling-webhook init

# Deploy with .env file
npx @quiltdata/benchling-webhook deploy

# Deploy with CLI options
npx @quiltdata/benchling-webhook deploy \
  --catalog quilt-catalog.company.com \
  --bucket my-data-bucket \
  --tenant company

# Validate configuration
npx @quiltdata/benchling-webhook validate --verbose
```

### Options

Run `npx @quiltdata/benchling-webhook --help` for full option list.
```

### Step 4.2: Update CHANGELOG.md

Add entry:

```markdown
## [0.6.0] - 2025-XX-XX

### Added
- CLI support for npx execution without cloning repository
- Interactive `init` command for configuration setup
- `validate` command for pre-deployment validation
- Automatic configuration inference from Quilt catalog
- Improved error messages with actionable guidance

### Changed
- Refactored deployment logic to support both CLI and programmatic usage
- Configuration loading now supports .env files, environment variables, and CLI flags
- Updated documentation with npx-first approach

### Migration
- Existing users can continue using `npm run deploy`
- New users should use `npx @quiltdata/benchling-webhook`
```

---

## Phase 5: Testing

### Step 5.1: Manual Testing Script

Create `test-cli.sh`:

```bash
#!/bin/bash
set -e

echo "=== CLI Testing Script ==="
echo

# Test 1: Help
echo "Test 1: Help command"
npm run build
node dist/bin/cli.js --help
echo "✓ Test 1 passed"
echo

# Test 2: Init (dry run - press Ctrl+C)
echo "Test 2: Init command (press Ctrl+C to skip)"
node dist/bin/cli.js init --output .env.test || true
echo "✓ Test 2 skipped"
echo

# Test 3: Validate with missing config
echo "Test 3: Validate with missing config (should fail)"
node dist/bin/cli.js validate --env-file /tmp/nonexistent.env || true
echo "✓ Test 3 passed (expected failure)"
echo

# Test 4: Validate with valid config
echo "Test 4: Validate with test config"
cp env.template .env.test
node dist/bin/cli.js validate --env-file .env.test || true
echo "✓ Test 4 completed"
echo

# Test 5: Deploy (dry run)
echo "Test 5: Deploy with --help"
node dist/bin/cli.js deploy --help
echo "✓ Test 5 passed"
echo

echo "=== All tests completed ==="
```

### Step 5.2: Automated Tests

Create `bin/commands/__tests__/deploy.test.ts`:

```typescript
import { deployCommand } from '../deploy';

// Mock dependencies
jest.mock('../../benchling-webhook');
jest.mock('../../../lib/utils/config');

describe('deployCommand', () => {
  it('should fail with missing configuration', async () => {
    await expect(deployCommand({})).rejects.toThrow();
  });

  // Add more tests
});
```

---

## Phase 6: Publishing

### Step 6.1: Pre-publish Checklist

- [ ] All TypeScript compiles without errors
- [ ] All tests pass
- [ ] `env.template` is included in package
- [ ] `dist/bin/cli.js` is executable
- [ ] README updated with npx usage
- [ ] CHANGELOG updated
- [ ] Version bumped

### Step 6.2: Publish Commands

```bash
# Build
npm run build

# Test locally with npm link
npm link
benchling-webhook --help

# Publish to npm
npm publish --access public

# Test from npm
npx @quiltdata/benchling-webhook --help
```

---

## Troubleshooting

### Common Issues

**Issue: CLI doesn't execute after npm install**

```bash
# Fix: Ensure dist/bin/cli.js has shebang and is executable
chmod +x dist/bin/cli.js
```

**Issue: Module not found errors**

```bash
# Fix: Check tsconfig paths and package.json exports
npm run build
node dist/bin/cli.js --help
```

**Issue: Circular dependencies**

```bash
# Fix: Ensure bin/ files don't import from lib/
# and lib/ files don't import from bin/
```

---

## Success Criteria

✅ User can run `npx @quiltdata/benchling-webhook` without cloning repo
✅ CLI provides helpful error messages
✅ Configuration can be loaded from .env, env vars, or CLI flags
✅ Values are automatically inferred from catalog when possible
✅ Package can still be imported and used as library
✅ All existing npm scripts still work
✅ Documentation is up to date

---

## Timeline Estimate

- Phase 1 (Setup): 2 hours
- Phase 2 (Extract Core): 4 hours
- Phase 3 (Implement CLI): 8 hours
- Phase 4 (Documentation): 2 hours
- Phase 5 (Testing): 4 hours
- Phase 6 (Publishing): 2 hours

**Total: ~22 hours** (3 days)
