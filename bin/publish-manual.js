#!/usr/bin/env node

/**
 * Manual NPM publish script using access token
 *
 * This script allows manual publishing to npmjs.org using an NPM access token.
 * It's useful for:
 * - Local testing of the publish process
 * - Manual releases when CI/CD is unavailable
 * - Emergency hotfix releases
 *
 * Prerequisites:
 * 1. You must have an NPM access token with publish permissions
 * 2. Set the token as environment variable: NPM_TOKEN=your_token_here
 *
 * Usage:
 *   NPM_TOKEN=your_token npm run publish:manual
 *   NPM_TOKEN=your_token npm run publish:manual -- --dry-run
 *   NPM_TOKEN=your_token npm run publish:manual -- --tag beta
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NPMRC_PATH = path.join(__dirname, '..', '.npmrc');
const NPMRC_BACKUP_PATH = path.join(__dirname, '..', '.npmrc.backup');

function validateToken() {
  const token = process.env.NPM_TOKEN;

  if (!token) {
    console.error('❌ Error: NPM_TOKEN environment variable is not set');
    console.error('');
    console.error('Usage:');
    console.error('  NPM_TOKEN=your_token_here npm run publish:manual');
    console.error('');
    console.error('To get an NPM access token:');
    console.error('  1. Go to https://www.npmjs.com/settings/[your-username]/tokens');
    console.error('  2. Click "Generate New Token"');
    console.error('  3. Select "Automation" type for CI/CD or "Publish" for manual use');
    console.error('  4. Copy the token and use it with this script');
    process.exit(1);
  }

  return token;
}

function validateGitState() {
  // Check for uncommitted changes
  try {
    execSync('git diff-index --quiet HEAD --', { stdio: 'ignore' });
  } catch (e) {
    console.error('⚠️  Warning: You have uncommitted changes');
    console.error('   It is recommended to commit changes before publishing');
    console.error('');

    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      readline.question('Continue anyway? (y/N): ', (answer) => {
        readline.close();
        if (answer.toLowerCase() !== 'y') {
          console.log('Aborted');
          process.exit(1);
        }
        resolve();
      });
    });
  }
}

function createNpmrc(token) {
  // Backup existing .npmrc if it exists
  if (fs.existsSync(NPMRC_PATH)) {
    console.log('📋 Backing up existing .npmrc');
    fs.copyFileSync(NPMRC_PATH, NPMRC_BACKUP_PATH);
  }

  // Create .npmrc with token
  const npmrcContent = `//registry.npmjs.org/:_authToken=${token}\nregistry=https://registry.npmjs.org/\n`;
  fs.writeFileSync(NPMRC_PATH, npmrcContent, { mode: 0o600 });
  console.log('✅ Created .npmrc with authentication token');
}

function restoreNpmrc() {
  // Remove the temporary .npmrc
  if (fs.existsSync(NPMRC_PATH)) {
    fs.unlinkSync(NPMRC_PATH);
  }

  // Restore backup if it exists
  if (fs.existsSync(NPMRC_BACKUP_PATH)) {
    console.log('📋 Restoring original .npmrc');
    fs.renameSync(NPMRC_BACKUP_PATH, NPMRC_PATH);
  }
}

function publishPackage(isDryRun, tag) {
  const packagePath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  console.log('');
  console.log('📦 Publishing package: ' + pkg.name);
  console.log('📌 Version: ' + pkg.version);
  if (tag) {
    console.log('🏷️  Tag: ' + tag);
  }
  console.log('');

  let publishCmd = 'npm publish --access public';

  if (isDryRun) {
    publishCmd += ' --dry-run';
    console.log('🔍 Running in dry-run mode (no actual publish)');
    console.log('');
  }

  if (tag) {
    publishCmd += ` --tag ${tag}`;
  }

  try {
    execSync(publishCmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });

    if (isDryRun) {
      console.log('');
      console.log('✅ Dry run completed successfully');
      console.log('   Remove --dry-run to publish for real');
    } else {
      console.log('');
      console.log('✅ Package published successfully!');
      console.log(`   View at: https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`);
    }
  } catch (error) {
    console.error('');
    console.error('❌ Failed to publish package');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    console.log('📦 Manual NPM Publish');
    console.log('');
    console.log('Current package:', pkg.name);
    console.log('Current version:', pkg.version);
    console.log('');
    console.log('Usage:');
    console.log('  NPM_TOKEN=token npm run publish:manual [options]');
    console.log('');
    console.log('Options:');
    console.log('  --dry-run    Test the publish process without actually publishing');
    console.log('  --tag TAG    Publish with a specific dist-tag (e.g., beta, next, latest)');
    console.log('  --help, -h   Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  NPM_TOKEN=npm_xxx npm run publish:manual');
    console.log('  NPM_TOKEN=npm_xxx npm run publish:manual -- --dry-run');
    console.log('  NPM_TOKEN=npm_xxx npm run publish:manual -- --tag beta');
    console.log('');
    console.log('Getting an NPM token:');
    console.log('  1. Visit: https://www.npmjs.com/settings/[your-username]/tokens');
    console.log('  2. Click "Generate New Token"');
    console.log('  3. Choose "Automation" (for CI/CD) or "Publish" (for manual use)');
    console.log('  4. Copy the token (it starts with "npm_")');
    process.exit(0);
  }

  const isDryRun = args.includes('--dry-run');
  const tagIndex = args.indexOf('--tag');
  const tag = tagIndex !== -1 && args[tagIndex + 1] ? args[tagIndex + 1] : null;

  console.log('🚀 Manual NPM Publish Script');
  console.log('═'.repeat(50));

  // Validate token
  const token = validateToken();

  // Validate git state
  await validateGitState();

  try {
    // Create .npmrc with token
    createNpmrc(token);

    // Publish package
    publishPackage(isDryRun, tag);
  } catch (error) {
    console.error('');
    console.error('Publishing failed');
    process.exit(1);
  } finally {
    // Always restore the original .npmrc
    restoreNpmrc();
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  restoreNpmrc();
  process.exit(1);
});
