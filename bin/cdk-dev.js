#!/usr/bin/env node

/**
 * Development deployment workflow script
 *
 * This script:
 * 1. Creates a dev git tag with timestamp (v{version}-{timestamp})
 * 2. Pushes Docker image to ECR with that tag
 * 3. Deploys CDK stack using that specific image tag
 *
 * Usage:
 *   npm run cdk:dev
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Read package.json for version
const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

function run(command, options = {}) {
  console.log(`\n$ ${command}\n`);
  try {
    return execSync(command, {
      stdio: 'inherit',
      ...options
    });
  } catch (error) {
    console.error(`\n❌ Command failed: ${command}`);
    process.exit(1);
  }
}

function main() {
  console.log('🚀 Starting development deployment workflow...');
  console.log('');

  // 1. Check for uncommitted changes
  console.log('Step 1: Checking for uncommitted changes...');
  try {
    execSync('git diff-index --quiet HEAD --', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ You have uncommitted changes');
    console.error('   Commit or stash your changes before creating a dev deployment');
    process.exit(1);
  }
  console.log('✅ Working directory is clean');

  // 2. Generate dev tag name
  const version = pkg.version;
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const devTag = `v${version}-${timestamp}`;

  console.log('');
  console.log(`Step 2: Creating dev tag: ${devTag}`);

  // Check if tag already exists
  try {
    execSync(`git rev-parse ${devTag}`, { stdio: 'ignore' });
    console.error(`❌ Tag ${devTag} already exists`);
    process.exit(1);
  } catch (e) {
    // Tag doesn't exist, continue
  }

  // Create tag
  const message = `Development release ${devTag}\n\nThis is a pre-release for testing purposes.`;
  run(`git tag -a ${devTag} -m "${message}"`);
  console.log(`✅ Created git tag ${devTag}`);

  // 3. Push tag to origin
  console.log('');
  console.log(`Step 3: Pushing tag to origin...`);
  run(`git push origin ${devTag}`);
  console.log(`✅ Pushed tag ${devTag} to origin`);

  // 4. Build and push Docker image with dev tag
  console.log('');
  console.log(`Step 4: Building and pushing Docker image with tag ${devTag}...`);
  process.chdir(path.join(__dirname, '..', 'docker'));
  run(`make push-local VERSION=${devTag}`);
  console.log(`✅ Docker image pushed to ECR`);

  // 5. Deploy CDK stack with dev image tag
  console.log('');
  console.log(`Step 5: Deploying CDK stack with image tag ${devTag}...`);
  process.chdir(path.join(__dirname, '..'));
  run(`npm run cli -- --image-tag ${devTag} --yes`);

  console.log('');
  console.log('✅ Development deployment complete!');
  console.log('');
  console.log(`Dev tag: ${devTag}`);
  console.log(`Image tag: ${devTag}`);
  console.log('');
  console.log('Monitor CI/CD pipeline at: https://github.com/quiltdata/benchling-webhook/actions');
}

main();
