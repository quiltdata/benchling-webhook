#!/usr/bin/env node

/**
 * Version management script for releases
 *
 * Usage:
 *   node bin/version.js patch        # 0.4.7 -> 0.4.8
 *   node bin/version.js minor        # 0.4.7 -> 0.5.0
 *   node bin/version.js major        # 0.4.7 -> 1.0.0
 *   node bin/version.js dev          # 0.4.7 -> 0.4.8-dev.0
 *   node bin/version.js dev-bump     # 0.4.8-dev.0 -> 0.4.8-dev.1
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packagePath = path.join(__dirname, '..', 'package.json');
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

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Current version:', pkg.version);
    console.log('');
    console.log('Usage: node bin/version.js <bump-type> [--no-tag]');
    console.log('');
    console.log('Bump types:');
    console.log('  major      - Bump major version (1.0.0 -> 2.0.0)');
    console.log('  minor      - Bump minor version (0.4.7 -> 0.5.0)');
    console.log('  patch      - Bump patch version (0.4.7 -> 0.4.8)');
    console.log('  dev        - Create/bump dev version (0.4.7 -> 0.4.8-dev.0 or 0.4.8-dev.0 -> 0.4.8-dev.1)');
    console.log('  dev-bump   - Bump dev counter only (0.4.8-dev.0 -> 0.4.8-dev.1)');
    console.log('');
    console.log('Options:');
    console.log('  --no-tag   - Update package.json only, do not create git tag');
    process.exit(0);
  }

  const bumpType = args[0];
  const noTag = args.includes('--no-tag');

  try {
    const currentVersion = pkg.version;
    const newVersion = bumpVersion(currentVersion, bumpType);
    const isDev = newVersion.includes('-dev.');

    console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);
    console.log('');

    // Check for uncommitted changes
    try {
      execSync('git diff-index --quiet HEAD --', { stdio: 'ignore' });
    } catch (e) {
      console.error('❌ You have uncommitted changes');
      console.error('   Commit or stash your changes before creating a release');
      process.exit(1);
    }

    // Update package.json
    updatePackageVersion(newVersion);

    // Commit the version change
    execSync('git add package.json', { stdio: 'inherit' });
    execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
    console.log(`✅ Committed version change`);
    console.log('');

    // Create tag unless --no-tag is specified
    if (!noTag) {
      createGitTag(newVersion, isDev);
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
