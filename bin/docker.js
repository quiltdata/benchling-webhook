#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = '../enterprise/benchling/.scratch/dist';
const TARGET_DIR = './docker';

function dockerSync() {
  console.log('Starting docker-sync...');

  // Check if source directory exists
  const sourcePath = path.resolve(__dirname, '..', SOURCE_DIR);
  if (!fs.existsSync(sourcePath)) {
    console.error(`Error: Source directory ${SOURCE_DIR} not found`);
    process.exit(1);
  }

  // Remove old docker directory
  const targetPath = path.resolve(__dirname, '..', TARGET_DIR);
  if (fs.existsSync(targetPath)) {
    console.log(`Removing old ${TARGET_DIR} directory...`);
    execSync(`rm -rf "${targetPath}"`, { stdio: 'inherit' });
  }

  // Create fresh docker directory
  fs.mkdirSync(targetPath, { recursive: true });

  // Find the latest zip file
  const zipFiles = fs.readdirSync(sourcePath)
    .filter(file => file.endsWith('.zip'))
    .map(file => ({
      name: file,
      time: fs.statSync(path.join(sourcePath, file)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  if (zipFiles.length === 0) {
    console.error(`Error: No zip files found in ${SOURCE_DIR}`);
    process.exit(1);
  }

  const latestZip = zipFiles[0].name;
  console.log(`Extracting ${latestZip}...`);

  // Extract the latest zip
  const zipPath = path.join(sourcePath, latestZip);
  execSync(`unzip -q -o "${zipPath}" -d "${targetPath}"`, { stdio: 'inherit' });

  console.log(`✓ Successfully synced and expanded ${latestZip} to ${TARGET_DIR}`);
}

// Parse command
const command = process.argv[2] || 'sync';

switch (command) {
  case 'sync':
    dockerSync();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log('Usage: docker.js [sync]');
    process.exit(1);
}
