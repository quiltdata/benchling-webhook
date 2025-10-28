#!/usr/bin/env node

/**
 * Release management script - creates and pushes git tags
 *
 * Usage:
 *   node bin/release.js         # Create production release from current version
 *   node bin/release.js dev     # Create dev release with timestamp from current version
 *   node bin/release.js --no-push  # Create tag but don't push
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

function createGitTag(version, isDev, noPush) {
  let tagName = `v${version}`;

  // For dev releases, append timestamp to make unique
  if (isDev) {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    tagName = `v${version}-${timestamp}`;
  }

  const tagType = isDev ? 'pre-release (dev)' : 'release';

  // Check if tag already exists
  try {
    execSync(`git rev-parse ${tagName}`, { stdio: 'ignore' });
    console.error(`❌ Tag ${tagName} already exists`);
    process.exit(1);
  } catch (e) {
    // Tag doesn't exist, continue
  }

  // Create tag
  const message = isDev
    ? `Development ${tagType} ${tagName}\n\nThis is a pre-release for testing purposes.`
    : `Release ${tagName}`;

  execSync(`git tag -a ${tagName} -m "${message}"`, { stdio: 'inherit' });
  console.log(`✅ Created git tag ${tagName}`);

  // Push tag unless --no-push is specified
  if (!noPush) {
    console.log('');
    console.log(`Pushing tag ${tagName} to origin...`);
    try {
      execSync(`git push origin ${tagName}`, { stdio: 'inherit' });
      console.log(`✅ Pushed tag ${tagName} to origin`);
      console.log('');
      console.log('CI/CD pipeline will now:');
      console.log('  - Run all tests');
      console.log('  - Build and push Docker image to ECR');
      console.log('  - Create GitHub release');
      if (!isDev) {
        console.log('  - Publish to NPM (production releases only)');
      }
      console.log('  - Publish to GitHub Packages');
      console.log('');
      console.log('Monitor progress at: https://github.com/quiltdata/benchling-webhook/actions');
    } catch (error) {
      console.error(`❌ Failed to push tag ${tagName}`);
      console.error('You can manually push with: git push origin ' + tagName);
      process.exit(1);
    }
  } else {
    console.log('');
    console.log('Tag created but not pushed (--no-push specified)');
    console.log(`To push later: git push origin ${tagName}`);
  }
}

function main() {
  const args = process.argv.slice(2);

  // Check for uncommitted changes
  try {
    execSync('git diff-index --quiet HEAD --', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ You have uncommitted changes');
    console.error('   Commit or stash your changes before creating a release');
    process.exit(1);
  }

  const isDev = args.includes('dev');
  const noPush = args.includes('--no-push');
  const version = pkg.version;

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Current version:', version);
    console.log('');
    console.log('Usage: node bin/release.js [dev] [--no-push]');
    console.log('');
    console.log('Commands:');
    console.log('  (no args)  - Create production release tag and push');
    console.log('  dev        - Create dev release tag with timestamp and push');
    console.log('');
    console.log('Options:');
    console.log('  --no-push  - Create tag but do not push to origin');
    console.log('');
    console.log('Examples:');
    console.log('  node bin/release.js              # Create v0.4.12 and push');
    console.log('  node bin/release.js dev          # Create v0.4.12-20251027T123456Z and push');
    console.log('  node bin/release.js --no-push    # Create tag but don\'t push');
    process.exit(0);
  }

  console.log(`Creating ${isDev ? 'dev' : 'production'} release from version: ${version}`);
  console.log('');

  createGitTag(version, isDev, noPush);
}

main();
