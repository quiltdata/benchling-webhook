#!/usr/bin/env node

/**
 * Development deployment workflow script
 *
 * This script:
 * 1. Creates a dev git tag with timestamp (v{version}-{timestamp})
 * 2. Pushes the tag to GitHub (triggers CI to build Docker image)
 * 3. Waits for CI/CD pipeline to complete (monitors GitHub Actions)
 * 4. Deploys CDK stack using the CI-built image tag
 *
 * Usage:
 *   npm run cdk:dev
 *
 * IMPORTANT: This uses CI-built images (x86_64), NOT local builds.
 * Local ARM builds would fail in AWS which runs on x86_64.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Read package.json for version
const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

function run(command, options = {}) {
  const silent = options.silent || false;
  if (!silent) {
    console.log(`\n$ ${command}\n`);
  }
  try {
    return execSync(command, {
      stdio: silent ? 'pipe' : 'inherit',
      encoding: 'utf-8',
      ...options
    });
  } catch (error) {
    if (!silent) {
      console.error(`\n❌ Command failed: ${command}`);
    }
    if (options.allowFailure) {
      return null;
    }
    process.exit(1);
  }
}

function getGitHubRepo() {
  const remote = run('git remote get-url origin', { silent: true }).trim();
  // Parse github.com:org/repo or https://github.com/org/repo
  const match = remote.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
  if (!match) {
    throw new Error('Could not parse GitHub repository from git remote');
  }
  return { owner: match[1], repo: match[2] };
}

async function waitForWorkflow(tag, owner, repo, timeoutMinutes = 15) {
  console.log('');
  console.log(`Waiting for CI workflow to complete (timeout: ${timeoutMinutes} minutes)...`);
  console.log(`Monitor at: https://github.com/${owner}/${repo}/actions`);
  console.log('');

  const startTime = Date.now();
  const timeoutMs = timeoutMinutes * 60 * 1000;
  let attempt = 0;

  // GitHub API requires user agent
  const headers = {
    'User-Agent': 'benchling-webhook-cli',
    'Accept': 'application/vnd.github+json'
  };

  // Add GitHub token if available (increases rate limit)
  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken) {
    headers['Authorization'] = `Bearer ${githubToken}`;
  }

  while (Date.now() - startTime < timeoutMs) {
    attempt++;

    try {
      // Get workflow runs for the tag
      const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?event=push&head_sha=${tag}`;

      const response = await new Promise((resolve, reject) => {
        https.get(url, { headers }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`GitHub API returned ${res.statusCode}: ${data}`));
            }
          });
        }).on('error', reject);
      });

      if (response.workflow_runs && response.workflow_runs.length > 0) {
        const run = response.workflow_runs[0]; // Most recent run
        const status = run.status;
        const conclusion = run.conclusion;

        process.stdout.write(`\r  Attempt ${attempt}: Status=${status}, Conclusion=${conclusion || 'pending'}...`);

        if (status === 'completed') {
          console.log('\n');
          if (conclusion === 'success') {
            console.log(`✅ CI workflow completed successfully!`);
            console.log(`   Run: ${run.html_url}`);
            return true;
          } else {
            console.error(`\n❌ CI workflow failed with conclusion: ${conclusion}`);
            console.error(`   Run: ${run.html_url}`);
            console.error('   Please check the workflow logs and fix any issues.');
            process.exit(1);
          }
        }
      } else {
        process.stdout.write(`\r  Attempt ${attempt}: Waiting for workflow to start...`);
      }
    } catch (error) {
      // API errors are non-fatal, just retry
      if (attempt % 10 === 0) {
        console.log(`\n  Warning: ${error.message}`);
      }
    }

    // Wait 10 seconds between checks
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  console.error('\n\n❌ Timeout waiting for CI workflow to complete');
  console.error(`   Waited ${timeoutMinutes} minutes`);
  console.error(`   Check status at: https://github.com/${owner}/${repo}/actions`);
  console.error('\n   Once the workflow completes, you can deploy manually with:');
  console.error(`   npm run cli -- --image-tag ${tag} --yes`);
  process.exit(1);
}

async function main() {
  console.log('🚀 Starting development deployment workflow...');
  console.log('');
  console.log('This workflow uses CI-built Docker images (x86_64 for AWS).');
  console.log('Local ARM builds are NOT used as they would fail in AWS.');
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

  // 3. Push tag to origin (triggers CI)
  console.log('');
  console.log(`Step 3: Pushing tag to origin (this triggers CI/CD)...`);
  run(`git push origin ${devTag}`);
  console.log(`✅ Pushed tag ${devTag} to origin`);
  console.log('   CI will now build Docker image for x86_64 (AWS-compatible)');

  // Get GitHub repo info for API calls
  const { owner, repo } = getGitHubRepo();

  // 4. Wait for CI to complete
  console.log('');
  console.log(`Step 4: Waiting for CI to build Docker image...`);

  // Get the commit SHA for the tag
  const commitSha = run(`git rev-parse ${devTag}`, { silent: true }).trim();

  await waitForWorkflow(commitSha, owner, repo);

  // 5. Deploy CDK stack with CI-built image tag
  console.log('');
  console.log(`Step 5: Deploying CDK stack with CI-built image...`);
  process.chdir(path.join(__dirname, '..'));
  run(`npm run cli -- --image-tag ${version} --yes`);

  console.log('');
  console.log('✅ Development deployment complete!');
  console.log('');
  console.log(`Dev tag: ${devTag}`);
  console.log(`Image tag: ${version} (built by CI for x86_64)`);
  console.log('');
  console.log(`Monitor workflow: https://github.com/${owner}/${repo}/actions`);
  console.log(`View release: https://github.com/${owner}/${repo}/releases/tag/${devTag}`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
