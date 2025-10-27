#!/usr/bin/env node
/**
 * Synchronize version between package.json and docker/pyproject.toml
 * The source of truth is docker/pyproject.toml
 */

const fs = require('fs');
const path = require('path');

const PYPROJECT_PATH = path.join(__dirname, '..', 'docker', 'pyproject.toml');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');

function extractVersionFromPyproject(content) {
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error('Could not find version in pyproject.toml');
  }
  return match[1];
}

function main() {
  // Read pyproject.toml
  const pyprojectContent = fs.readFileSync(PYPROJECT_PATH, 'utf-8');
  const version = extractVersionFromPyproject(pyprojectContent);

  console.log(`Version from docker/pyproject.toml: ${version}`);

  // Read package.json
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
  const oldVersion = packageJson.version;

  if (oldVersion === version) {
    console.log(`✓ Versions already match: ${version}`);
    return;
  }

  // Update package.json
  packageJson.version = version;
  fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(packageJson, null, 2) + '\n');

  console.log(`✓ Updated package.json version: ${oldVersion} → ${version}`);
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
