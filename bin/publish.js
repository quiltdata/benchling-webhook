#!/usr/bin/env node

/**
 * NPM publish script with dev/prod modes
 *
 * By default, publishes with 'dev' tag (prerelease).
 * Use --prod to publish as 'latest' (production).
 * Use --check to view current package status without publishing.
 *
 * Prerequisites:
 * 1. You must have an NPM access token with publish permissions
 * 2. Set the token as environment variable: NPM_TOKEN=your_token_here
 *
 * Usage:
 *   npm run publish                      # Publish as dev (prerelease)
 *   npm run publish -- --prod            # Publish as latest (production)
 *   npm run publish -- --check           # Check package status only
 *   npm run publish -- --dry-run         # Test without publishing
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NPMRC_PATH = path.join(__dirname, '..', '.npmrc');
const NPMRC_BACKUP_PATH = path.join(__dirname, '..', '.npmrc.backup');

function getPackageInfo() {
  const packagePath = path.join(__dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
}

function checkPackageStatus() {
  const pkg = getPackageInfo();

  console.log('📦 Package Status');
  console.log('═'.repeat(50));
  console.log('Name:    ', pkg.name);
  console.log('Version: ', pkg.version);
  console.log('');

  try {
    console.log('Checking npm registry...');
    const registryInfo = execSync(`npm view ${pkg.name} --json`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const registryData = JSON.parse(registryInfo);
    const versions = Array.isArray(registryData.versions) ? registryData.versions : [registryData.version];
    const latestVersion = registryData['dist-tags']?.latest || 'unknown';
    const devVersion = registryData['dist-tags']?.dev || 'none';

    console.log('');
    console.log('Published Versions:', versions.length);
    console.log('Latest (prod):     ', latestVersion);
    console.log('Dev (prerelease):  ', devVersion);
    console.log('');

    if (versions.includes(pkg.version)) {
      console.log(`⚠️  Version ${pkg.version} is already published`);
    } else {
      console.log(`✅ Version ${pkg.version} is ready to publish`);
    }

    console.log('');
    console.log(`View at: https://www.npmjs.com/package/${pkg.name}`);

  } catch (error) {
    if (error.message.includes('E404')) {
      console.log('');
      console.log('📭 Package not yet published to npm');
      console.log('   Run without --check to publish');
    } else {
      console.error('');
      console.error('❌ Error checking registry:', error.message);
    }
  }
}

function validateToken() {
  const token = process.env.NPM_TOKEN;

  if (!token) {
    console.error('❌ Error: NPM_TOKEN environment variable is not set');
    console.error('');
    console.error('Usage:');
    console.error('  NPM_TOKEN=your_token_here npm run publish');
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

function validateGitState(isDryRun) {
  // Check for uncommitted changes
  try {
    execSync('git diff-index --quiet HEAD --', { stdio: 'ignore' });
  } catch (e) {
    console.error('⚠️  Warning: You have uncommitted changes');
    console.error('   It is recommended to commit changes before publishing');
    console.error('');

    // Skip prompt in dry-run mode
    if (isDryRun) {
      console.log('   Continuing with dry-run...');
      console.log('');
      return Promise.resolve();
    }

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

function buildPackage() {
  const rootDir = path.join(__dirname, '..');
  const distDir = path.join(rootDir, 'dist');

  console.log('🔨 Building package...');
  console.log('');

  // Clean dist directory
  if (fs.existsSync(distDir)) {
    console.log('   Cleaning dist/');
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  // Compile TypeScript
  console.log('   Compiling TypeScript...');
  try {
    execSync('npx tsc --outDir dist --declaration --declarationMap --sourceMap --noEmit false --inlineSourceMap false', {
      cwd: rootDir,
      stdio: 'inherit'
    });
    console.log('');
    console.log('✅ Build completed successfully');
    console.log('');
  } catch (error) {
    console.error('');
    console.error('❌ Build failed');
    throw error;
  }
}

function cleanBuildArtifacts() {
  const distDir = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(distDir)) {
    console.log('🧹 Cleaning build artifacts...');
    fs.rmSync(distDir, { recursive: true, force: true });
  }
}

function publishPackage(isDryRun, isProd) {
  const pkg = getPackageInfo();
  const tag = isProd ? 'latest' : 'dev';

  console.log('📦 Publishing package: ' + pkg.name);
  console.log('📌 Version: ' + pkg.version);
  console.log('🏷️  Tag: ' + tag + (isProd ? ' (production)' : ' (prerelease)'));
  console.log('');

  let publishCmd = 'npm publish --access public';

  if (isDryRun) {
    publishCmd += ' --dry-run';
    console.log('🔍 Running in dry-run mode (no actual publish)');
    console.log('');
  }

  publishCmd += ` --tag ${tag}`;

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
      console.log('');
      if (!isProd) {
        console.log('   📝 Note: Published as prerelease (dev tag)');
        console.log('   To install: npm install ' + pkg.name + '@dev');
        console.log('   To publish as production: npm run publish -- --prod');
      }
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
    const pkg = getPackageInfo();

    console.log('📦 NPM Publish');
    console.log('');
    console.log('Current package:', pkg.name);
    console.log('Current version:', pkg.version);
    console.log('');
    console.log('Usage:');
    console.log('  npm run publish [options]');
    console.log('');
    console.log('Options:');
    console.log('  --check      Check current package status on npm (no publish)');
    console.log('  --prod       Publish as production (tag: latest)');
    console.log('  --dry-run    Test the publish process without actually publishing');
    console.log('  --help, -h   Show this help message');
    console.log('');
    console.log('Default Behavior:');
    console.log('  Without --prod, publishes with "dev" tag (prerelease)');
    console.log('');
    console.log('Examples:');
    console.log('  npm run publish                    # Publish as dev (prerelease)');
    console.log('  npm run publish -- --prod          # Publish as latest (production)');
    console.log('  npm run publish -- --check         # Check status only');
    console.log('  npm run publish -- --dry-run       # Test without publishing');
    console.log('  npm run publish -- --prod --dry-run # Test prod publish');
    console.log('');
    console.log('Getting an NPM token:');
    console.log('  1. Visit: https://www.npmjs.com/settings/[your-username]/tokens');
    console.log('  2. Click "Generate New Token"');
    console.log('  3. Choose "Automation" (for CI/CD) or "Publish" (for manual use)');
    console.log('  4. Set as environment variable: export NPM_TOKEN=npm_xxxxx');
    process.exit(0);
  }

  // Handle --check flag (no auth needed)
  if (args.includes('--check')) {
    checkPackageStatus();
    return;
  }

  const isDryRun = args.includes('--dry-run');
  const isProd = args.includes('--prod');

  console.log('🚀 NPM Publish Script');
  console.log('═'.repeat(50));

  // Validate token
  const token = validateToken();

  // Validate git state
  await validateGitState(isDryRun);

  try {
    // Build package
    buildPackage();

    // Create .npmrc with token
    createNpmrc(token);

    // Publish package
    publishPackage(isDryRun, isProd);
  } catch (error) {
    console.error('');
    console.error('Publishing failed');
    process.exit(1);
  } finally {
    // Always restore the original .npmrc
    restoreNpmrc();

    // Clean build artifacts (keep repo clean) unless --keep-dist is specified
    if (!args.includes('--keep-dist')) {
      cleanBuildArtifacts();
    }
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  restoreNpmrc();
  process.exit(1);
});
