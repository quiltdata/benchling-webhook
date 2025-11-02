#!/usr/bin/env ts-node

/**
 * Create or update Benchling webhook secret in AWS Secrets Manager
 *
 * Usage:
 *   npm run config
 *   npm run config -- --secret-name benchling-webhook-dev --region us-east-1
 *   npm run config -- --secret-name benchling-webhook-prod --region us-east-1 --env-file .env.prod
 *
 * Default secret name: @quiltdata/benchling-webhook (package name)
 *
 * Required parameters (from .env file or environment):
 *   BENCHLING_TENANT
 *   BENCHLING_CLIENT_ID
 *   BENCHLING_CLIENT_SECRET
 *   BENCHLING_APP_DEFINITION_ID
 *   BENCHLING_PKG_PREFIX
 *   BENCHLING_PKG_KEY
 *   BENCHLING_USER_BUCKET
 *   BENCHLING_LOG_LEVEL
 *   BENCHLING_ENABLE_WEBHOOK_VERIFICATION
 *   BENCHLING_WEBHOOK_ALLOW_LIST
 */

import { Command } from 'commander';
import { config as dotenvConfig } from 'dotenv';
import { expand as dotenvExpand } from 'dotenv-expand';
import {
  SecretsManagerClient,
  CreateSecretCommand,
  UpdateSecretCommand,
  DescribeSecretCommand,
  ResourceNotFoundException
} from '@aws-sdk/client-secrets-manager';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface BenchlingSecretData {
  tenant: string;
  client_id: string;
  client_secret: string;
  app_definition_id: string;
  pkg_prefix: string;
  pkg_key: string;
  user_bucket: string;
  log_level: string;
  enable_webhook_verification: string;
  webhook_allow_list: string;
}

const REQUIRED_PARAMS = [
  'BENCHLING_TENANT',
  'BENCHLING_CLIENT_ID',
  'BENCHLING_CLIENT_SECRET',
  'BENCHLING_APP_DEFINITION_ID',
  'BENCHLING_PKG_PREFIX',
  'BENCHLING_PKG_KEY',
  'BENCHLING_USER_BUCKET',
  'BENCHLING_LOG_LEVEL',
  'BENCHLING_ENABLE_WEBHOOK_VERIFICATION',
  'BENCHLING_WEBHOOK_ALLOW_LIST',
];

const VALID_LOG_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];

function loadEnvFile(envFile?: string): void {
  const envPath = envFile || '.env';

  if (!fs.existsSync(envPath)) {
    console.log(chalk.yellow(`ℹ️  No .env file found at ${envPath}, using environment variables only`));
    return;
  }

  console.log(chalk.blue(`📄 Loading environment from ${envPath}`));
  const myEnv = dotenvConfig({ path: envPath });
  dotenvExpand(myEnv);
}

function validateParameters(params: Record<string, string>): BenchlingSecretData {
  // WEBHOOK_ALLOW_LIST can be empty string (no restrictions)
  // All others must be non-empty
  const missing = REQUIRED_PARAMS.filter(param => {
    if (param === 'BENCHLING_WEBHOOK_ALLOW_LIST') {
      return params[param] === undefined; // Only fail if undefined, not empty string
    }
    return !params[param];
  });

  if (missing.length > 0) {
    console.error(chalk.red(`❌ Missing required parameters: ${missing.join(', ')}`));
    console.log(chalk.yellow('\nExpected parameters (from .env or environment):'));
    REQUIRED_PARAMS.forEach(param => {
      const value = params[param];
      const status = value !== undefined ? '✓' : '✗';
      console.log(chalk.yellow(`  ${param}=${status}`));
    });
    process.exit(1);
  }

  // Validate log level
  const logLevel = params.BENCHLING_LOG_LEVEL.toUpperCase();
  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    console.error(chalk.red(`❌ Invalid log level: ${params.BENCHLING_LOG_LEVEL}`));
    console.log(chalk.yellow(`Valid levels: ${VALID_LOG_LEVELS.join(', ')}`));
    process.exit(1);
  }

  // Validate boolean
  const verification = params.BENCHLING_ENABLE_WEBHOOK_VERIFICATION.toLowerCase();
  if (!['true', 'false', '1', '0'].includes(verification)) {
    console.error(chalk.red(`❌ Invalid boolean value for BENCHLING_ENABLE_WEBHOOK_VERIFICATION: ${params.BENCHLING_ENABLE_WEBHOOK_VERIFICATION}`));
    console.log(chalk.yellow(`Valid values: true, false, 1, 0`));
    process.exit(1);
  }

  // Build secret data (convert SCREAMING_SNAKE_CASE to snake_case)
  return {
    tenant: params.BENCHLING_TENANT,
    client_id: params.BENCHLING_CLIENT_ID,
    client_secret: params.BENCHLING_CLIENT_SECRET,
    app_definition_id: params.BENCHLING_APP_DEFINITION_ID,
    pkg_prefix: params.BENCHLING_PKG_PREFIX,
    pkg_key: params.BENCHLING_PKG_KEY,
    user_bucket: params.BENCHLING_USER_BUCKET,
    log_level: logLevel,
    enable_webhook_verification: verification,
    webhook_allow_list: params.BENCHLING_WEBHOOK_ALLOW_LIST,
  };
}

async function secretExists(client: SecretsManagerClient, secretName: string): Promise<boolean> {
  try {
    await client.send(new DescribeSecretCommand({ SecretId: secretName }));
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return false;
    }
    throw error;
  }
}

async function createOrUpdateSecret(
  secretName: string,
  region: string,
  secretData: BenchlingSecretData,
  dryRun: boolean
): Promise<void> {
  const client = new SecretsManagerClient({ region });
  const secretString = JSON.stringify(secretData, null, 2);

  if (dryRun) {
    console.log(chalk.blue('\n🔍 DRY RUN MODE - No changes will be made\n'));
    console.log(chalk.cyan('Secret Name:'), secretName);
    console.log(chalk.cyan('Region:'), region);
    console.log(chalk.cyan('Secret Content:'));
    console.log(chalk.gray(secretString));
    return;
  }

  const exists = await secretExists(client, secretName);

  if (exists) {
    console.log(chalk.blue(`📝 Updating existing secret: ${secretName}`));
    await client.send(new UpdateSecretCommand({
      SecretId: secretName,
      SecretString: secretString,
    }));
    console.log(chalk.green(`✅ Secret updated successfully`));
  } else {
    console.log(chalk.blue(`🆕 Creating new secret: ${secretName}`));
    const result = await client.send(new CreateSecretCommand({
      Name: secretName,
      Description: 'Benchling webhook runtime configuration (10 parameters)',
      SecretString: secretString,
    }));
    console.log(chalk.green(`✅ Secret created successfully`));
    console.log(chalk.cyan(`ARN: ${result.ARN}`));
  }

  console.log(chalk.green(`\n✨ Secret ${exists ? 'updated' : 'created'}: ${secretName}`));
  console.log(chalk.yellow(`\nTo use this secret in deployment:`));
  console.log(chalk.gray(`  npm run cli -- deploy \\`));
  console.log(chalk.gray(`    --quilt-stack-arn <your-quilt-stack-arn> \\`));
  console.log(chalk.gray(`    --benchling-secret ${secretName}`));
}

async function main() {
  const program = new Command();

  program
    .name('npm run config')
    .description('Create or update Benchling webhook secret in AWS Secrets Manager')
    .option('-s, --secret-name <name>', 'Secret name (defaults to package name)', '@quiltdata/benchling-webhook')
    .option('-r, --region <region>', 'AWS region', 'us-east-1')
    .option('-e, --env-file <path>', '.env file path', '.env')
    .option('-d, --dry-run', 'Show what would be created without making changes', false)
    .parse(process.argv);

  const options = program.opts();

  console.log(chalk.bold.blue('\n🔐 Benchling Webhook Secret Configuration\n'));

  // Load environment
  loadEnvFile(options.envFile);

  // Gather parameters from environment
  const params: Record<string, string> = {};
  REQUIRED_PARAMS.forEach(param => {
    const value = process.env[param];
    // Special handling for WEBHOOK_ALLOW_LIST - allow empty string
    if (param === 'BENCHLING_WEBHOOK_ALLOW_LIST' && value === undefined) {
      params[param] = ''; // Default to empty string for allowlist
    } else {
      params[param] = value || '';
    }
  });

  // Validate and build secret data
  const secretData = validateParameters(params);

  console.log(chalk.green('\n✓ All parameters validated'));
  console.log(chalk.blue(`\nParameters to be stored in secret:`));
  console.log(chalk.gray(`  tenant: ${secretData.tenant}`));
  console.log(chalk.gray(`  client_id: ${secretData.client_id.substring(0, 4)}***`));
  console.log(chalk.gray(`  client_secret: ***`));
  console.log(chalk.gray(`  app_definition_id: ${secretData.app_definition_id}`));
  console.log(chalk.gray(`  pkg_prefix: ${secretData.pkg_prefix}`));
  console.log(chalk.gray(`  pkg_key: ${secretData.pkg_key}`));
  console.log(chalk.gray(`  user_bucket: ${secretData.user_bucket}`));
  console.log(chalk.gray(`  log_level: ${secretData.log_level}`));
  console.log(chalk.gray(`  enable_webhook_verification: ${secretData.enable_webhook_verification}`));
  console.log(chalk.gray(`  webhook_allow_list: ${secretData.webhook_allow_list || '(empty)'}`));

  // Create or update secret
  await createOrUpdateSecret(
    options.secretName,
    options.region,
    secretData,
    options.dryRun
  );
}

main().catch(error => {
  console.error(chalk.red(`\n❌ Error: ${error.message}`));
  if (error.code === 'ResourceNotFoundException') {
    console.log(chalk.yellow('\nMake sure the AWS region is correct and you have necessary permissions.'));
  } else if (error.name === 'CredentialsProviderError') {
    console.log(chalk.yellow('\nAWS credentials not found. Please configure AWS CLI or set environment variables.'));
  }
  process.exit(1);
});
