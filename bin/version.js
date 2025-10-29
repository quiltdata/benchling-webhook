#!/usr/bin/env node

/**
 * Version management script - bumps version numbers across all files
 *
 * Usage:
 *   node bin/version.js          # Show all three version files
 *   node bin/version.js patch    # 0.4.7 -> 0.4.8
 *   node bin/version.js minor    # 0.4.7 -> 0.5.0
 *   node bin/version.js major    # 0.4.7 -> 1.0.0
 *   node bin/version.js sync     # Force TOML and YAML to match JSON version
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packagePath = path.join(__dirname, '..', 'package.json');
const pyprojectPath = path.join(__dirname, '..', 'docker', 'pyproject.toml');
const appManifestPath = path.join(__dirname, '..', 'docker', 'app-manifest.yaml');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

function readPyprojectVersion() {
  const content = fs.readFileSync(pyprojectPath, 'utf8');
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

function readAppManifestVersion() {
  const content = fs.readFileSync(appManifestPath, 'utf8');
  const match = content.match(/^\s*version:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3])
  };
}

function formatVersion(ver) {
  return `${ver.major}.${ver.minor}.${ver.patch}`;
}

function bumpVersion(currentVersion, bumpType) {
  const ver = parseVersion(currentVersion);

  switch (bumpType) {
    case 'major':
      ver.major++;
      ver.minor = 0;
      ver.patch = 0;
      break;
    case 'minor':
      ver.minor++;
      ver.patch = 0;
      break;
    case 'patch':
      ver.patch++;
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

function main() {
  const args = process.argv.slice(2);

  // No args: display all three versions
  if (args.length === 0) {
    const jsonVersion = pkg.version;
    const tomlVersion = readPyprojectVersion();
    const yamlVersion = readAppManifestVersion();

    console.log('Version files:');
    console.log(`  package.json:              ${jsonVersion}`);
    console.log(`  docker/pyproject.toml:     ${tomlVersion}`);
    console.log(`  docker/app-manifest.yaml:  ${yamlVersion}`);

    if (jsonVersion === tomlVersion && jsonVersion === yamlVersion) {
      console.log('\n✅ All versions are in sync');
    } else {
      console.log('\n⚠️  Versions are out of sync! Run "node bin/version.js sync" to fix.');
    }
    process.exit(0);
  }

  // Help
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Current version:', pkg.version);
    console.log('');
    console.log('Usage: node bin/version.js [command]');
    console.log('');
    console.log('Commands:');
    console.log('  (no args)  - Display all three version files');
    console.log('  major      - Bump major version (1.0.0 -> 2.0.0)');
    console.log('  minor      - Bump minor version (0.4.7 -> 0.5.0)');
    console.log('  patch      - Bump patch version (0.4.7 -> 0.4.8)');
    console.log('  sync       - Force TOML and YAML to match JSON version');
    console.log('');
    console.log('This script updates version numbers in:');
    console.log('  - package.json');
    console.log('  - docker/pyproject.toml');
    console.log('  - docker/app-manifest.yaml');
    console.log('');
    console.log('To create a release tag, use: npm run release or npm run release:dev');
    process.exit(0);
  }

  const bumpType = args[0];

  // Sync command - force TOML and YAML to match JSON
  if (bumpType === 'sync') {
    const jsonVersion = pkg.version;
    const tomlVersion = readPyprojectVersion();
    const yamlVersion = readAppManifestVersion();

    console.log('Syncing versions to match package.json:');
    console.log(`  package.json:              ${jsonVersion}`);
    console.log(`  docker/pyproject.toml:     ${tomlVersion} -> ${jsonVersion}`);
    console.log(`  docker/app-manifest.yaml:  ${yamlVersion} -> ${jsonVersion}`);
    console.log('');

    try {
      updatePyprojectVersion(jsonVersion);
      updateAppManifestVersion(jsonVersion);

      // Check if version files have changes
      let hasChanges = false;
      try {
        execSync('git diff --quiet docker/pyproject.toml docker/app-manifest.yaml', { stdio: 'ignore' });
      } catch (e) {
        hasChanges = true;
      }

      if (hasChanges) {
        execSync('git add docker/pyproject.toml docker/app-manifest.yaml', { stdio: 'inherit' });
        execSync(`git commit -m "chore: sync versions to ${jsonVersion}"`, { stdio: 'inherit' });
        console.log('✅ Committed version sync');
      } else {
        console.log('✅ All versions already in sync (no changes to commit)');
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
    process.exit(0);
  }

  // Check for uncommitted changes
  try {
    execSync('git diff-index --quiet HEAD --', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ You have uncommitted changes');
    console.error('   Commit or stash your changes before bumping version');
    process.exit(1);
  }

  try {
    const currentVersion = pkg.version;
    const newVersion = bumpVersion(currentVersion, bumpType);

    console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);
    console.log('');

    // Update all version files
    updatePackageVersion(newVersion);
    updatePyprojectVersion(newVersion);
    updateAppManifestVersion(newVersion);

    // Commit the changes
    execSync('git add package.json docker/pyproject.toml docker/app-manifest.yaml', { stdio: 'inherit' });
    execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
    console.log(`✅ Committed version change`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Push changes: git push');
    console.log('  2. Create release: npm run release (or npm run release:dev for dev release)');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
