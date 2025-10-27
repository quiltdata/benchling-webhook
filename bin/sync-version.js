#!/usr/bin/env node
/**
 * Synchronize version between package.json, docker/pyproject.toml, and docker/app-manifest.yaml
 * The source of truth is docker/pyproject.toml
 */

const fs = require('fs');
const path = require('path');

const PYPROJECT_PATH = path.join(__dirname, '..', 'docker', 'pyproject.toml');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');
const APP_MANIFEST_PATH = path.join(__dirname, '..', 'docker', 'app-manifest.yaml');

function extractVersionFromPyproject(content) {
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error('Could not find version in pyproject.toml');
  }
  return match[1];
}

function updateAppManifest(version) {
  const content = fs.readFileSync(APP_MANIFEST_PATH, 'utf-8');
  const updatedContent = content.replace(
    /^version:\s*.+$/m,
    `version: ${version}`
  );
  
  if (content !== updatedContent) {
    fs.writeFileSync(APP_MANIFEST_PATH, updatedContent);
    return true;
  }
  return false;
}

function main() {
  // Read pyproject.toml
  const pyprojectContent = fs.readFileSync(PYPROJECT_PATH, 'utf-8');
  const version = extractVersionFromPyproject(pyprojectContent);

  console.log(`Version from docker/pyproject.toml: ${version}`);

  // Update package.json
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
  const oldVersion = packageJson.version;

  if (oldVersion !== version) {
    packageJson.version = version;
    fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(packageJson, null, 2) + '\n');
    console.log(`✓ Updated package.json version: ${oldVersion} → ${version}`);
  } else {
    console.log(`✓ package.json version already matches: ${version}`);
  }

  // Update app-manifest.yaml
  if (updateAppManifest(version)) {
    console.log(`✓ Updated app-manifest.yaml version to: ${version}`);
  } else {
    console.log(`✓ app-manifest.yaml version already matches: ${version}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

module.exports = { extractVersionFromPyproject };
