#!/usr/bin/env node

/**
 * Version management script for releases
 *
 * Usage:
 *   node bin/version.js release      # Create production release tag from current version, push tag
 *   node bin/version.js dev          # Create dev release tag from current version, push tag
 *   node bin/version.js patch        # 0.4.7 -> 0.4.8
 *   node bin/version.js minor        # 0.4.7 -> 0.5.0
 *   node bin/version.js major        # 0.4.7 -> 1.0.0
 *   node bin/version.js dev-bump     # 0.4.8-dev.0 -> 0.4.8-dev.1
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packagePath = path.join(__dirname, '..', 'package.json');
const pyprojectPath = path.join(__dirname, '..', 'docker', 'pyproject.toml');
const appManifestPath = path.join(__dirname, '..', 'docker', 'app-manifest.yaml');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    dev: match[4] ? parseInt(match[4]) : null
  };
}

function formatVersion(ver) {
  let version = `${ver.major}.${ver.minor}.${ver.patch}`;
  if (ver.dev !== null) {
    version += `-dev.${ver.dev}`;
  }
  return version;
}

function bumpVersion(currentVersion, bumpType) {
  const ver = parseVersion(currentVersion);

  switch (bumpType) {
    case 'major':
      ver.major++;
      ver.minor = 0;
      ver.patch = 0;
      ver.dev = null;
      break;
    case 'minor':
      ver.minor++;
      ver.patch = 0;
      ver.dev = null;
      break;
    case 'patch':
      ver.patch++;
      ver.dev = null;
      break;
    case 'dev':
      // If already a dev version, increment dev counter
      // Otherwise, bump patch and add dev.0
      if (ver.dev !== null) {
        ver.dev++;
      } else {
        ver.patch++;
        ver.dev = 0;
      }
      break;
    case 'dev-bump':
      // Only bump dev counter, error if not a dev version
      if (ver.dev === null) {
        throw new Error('Cannot bump dev counter on non-dev version. Use "dev" instead.');
      }
      ver.dev++;
      break;
    default:
      throw new Error(`Unknown bump type: ${bumpType}`);
  }

  return formatVersion(ver);
}

function updatePackageVersion(newVersion) {
  pkg.version = newVersion;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ Updated package.json to version ${newVersion}`);
}

function updatePyprojectVersion(newVersion) {
  let content = fs.readFileSync(pyprojectPath, 'utf8');
  content = content.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`);
  fs.writeFileSync(pyprojectPath, content);
  console.log(`✅ Updated docker/pyproject.toml to version ${newVersion}`);
}

function updateAppManifestVersion(newVersion) {
  let content = fs.readFileSync(appManifestPath, 'utf8');
  content = content.replace(/^(\s*)version:\s*.+$/m, `$1version: ${newVersion}`);
  fs.writeFileSync(appManifestPath, content);
  console.log(`✅ Updated docker/app-manifest.yaml to version ${newVersion}`);
}

function createGitTag(version, isDev) {
  const tagName = `v${version}`;
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
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Review the tag: git show ${tagName}`);
  console.log(`  2. Push the tag:   git push origin ${tagName}`);
  console.log('');
  console.log('This will trigger the CI/CD pipeline to:');
  console.log('  - Run all tests');
  console.log('  - Build and push Docker image to ECR');
  console.log('  - Create GitHub release');
  if (!isDev) {
    console.log('  - Publish to NPM (production releases only)');
  }
  console.log('  - Publish to GitHub Packages');
}

function pushTag(tagName) {
  console.log(`Pushing tag ${tagName} to origin...`);
  try {
    execSync(`git push origin ${tagName}`, { stdio: 'inherit' });
    console.log(`✅ Pushed tag ${tagName} to origin`);
    console.log('');
    console.log('CI/CD pipeline will now:');
    console.log('  - Run all tests');
    console.log('  - Build and push Docker image to ECR');
    console.log('  - Create GitHub release');
    console.log('  - Publish to NPM (production releases only)');
    console.log('  - Publish to GitHub Packages');
    console.log('');
    console.log('Monitor progress at: https://github.com/quiltdata/benchling-webhook/actions');
  } catch (error) {
    console.error(`❌ Failed to push tag ${tagName}`);
    console.error('You can manually push with: git push origin ' + tagName);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Current version:', pkg.version);
    console.log('');
    console.log('Usage: node bin/version.js <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  release    - Create production release tag from current version and push');
    console.log('  dev        - Create dev release tag from current version and push');
    console.log('');
    console.log('Version Bump Commands:');
    console.log('  major      - Bump major version (1.0.0 -> 2.0.0)');
    console.log('  minor      - Bump minor version (0.4.7 -> 0.5.0)');
    console.log('  patch      - Bump patch version (0.4.7 -> 0.4.8)');
    console.log('  dev-bump   - Bump dev counter only (0.4.8-dev.0 -> 0.4.8-dev.1)');
    console.log('');
    console.log('Options:');
    console.log('  --no-tag   - Update package.json only, do not create git tag');
    console.log('  --no-push  - Create tag but do not push to origin');
    process.exit(0);
  }

  const command = args[0];
  const noTag = args.includes('--no-tag');
  const noPush = args.includes('--no-push');

  // Handle simplified commands
  let bumpType;
  let autoPush = false;
  let skipVersionBump = false;

  if (command === 'release') {
    bumpType = null;
    autoPush = true;
    skipVersionBump = true;
  } else if (command === 'dev') {
    bumpType = null;
    autoPush = true;
    skipVersionBump = true;
  } else {
    bumpType = command;
  }

  try {
    const currentVersion = pkg.version;
    let newVersion;

    if (skipVersionBump) {
      // For release and dev commands, use current version without bumping
      newVersion = currentVersion;
      console.log(`Using current version: ${currentVersion}`);
      console.log('');
    } else {
      // For other commands, bump the version
      newVersion = bumpVersion(currentVersion, bumpType);
      console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);
      console.log('');
    }

    const isDev = newVersion.includes('-dev.');

    // Check for uncommitted changes
    try {
      execSync('git diff-index --quiet HEAD --', { stdio: 'ignore' });
    } catch (e) {
      console.error('❌ You have uncommitted changes');
      console.error('   Commit or stash your changes before creating a release');
      process.exit(1);
    }

    // Update all version files and commit only if we're bumping the version
    if (!skipVersionBump) {
      updatePackageVersion(newVersion);
      updatePyprojectVersion(newVersion);
      updateAppManifestVersion(newVersion);
      execSync('git add package.json docker/pyproject.toml docker/app-manifest.yaml', { stdio: 'inherit' });
      execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
      console.log(`✅ Committed version change`);
      console.log('');
    }

    // Create tag unless --no-tag is specified
    if (!noTag) {
      const tagName = `v${newVersion}`;
      createGitTag(newVersion, isDev);

      // Auto-push if this is a release or dev command and --no-push is not specified
      if (autoPush && !noPush) {
        pushTag(tagName);
      }
    } else {
      console.log('Skipped tag creation (--no-tag specified)');
      console.log('To create tag later: git tag -a v' + newVersion + ' -m "Release v' + newVersion + '"');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
