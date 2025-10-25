#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = '../enterprise/benchling/.scratch/dist';
const TARGET_DIR = './docker';
const ECR_REPO = 'quiltdata/benchling';
const AWS_REGION = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';

function getCurrentArchitecture() {
  // Get the architecture of the current machine
  const arch = process.arch; // e.g., 'arm64', 'x64'
  // Normalize to Docker-style naming
  if (arch === 'x64') return 'amd64';
  if (arch === 'arm64') return 'arm64';
  return arch;
}

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

  // Extract version from zip filename
  // Format: benchling-quilt-integration-{VERSION}-{HASH}.zip
  const versionMatch = latestZip.match(/benchling-quilt-integration-(\d+\.\d+\.\d+)-/);
  let extractedVersion = null;
  if (versionMatch) {
    extractedVersion = versionMatch[1];
    console.log(`Detected version: ${extractedVersion}`);
  }

  // Extract the latest zip
  const zipPath = path.join(sourcePath, latestZip);
  execSync(`unzip -q -o "${zipPath}" -d "${targetPath}"`, { stdio: 'inherit' });

  console.log(`✓ Successfully synced and expanded ${latestZip} to ${TARGET_DIR}`);

  // Update package.json version to match the distribution
  if (extractedVersion) {
    const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const oldVersion = packageJson.version;

    if (oldVersion !== extractedVersion) {
      packageJson.version = extractedVersion;
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
      console.log(`✓ Updated package.json version: ${oldVersion} → ${extractedVersion}`);
    } else {
      console.log(`✓ Package.json version already matches: ${extractedVersion}`);
    }
  } else {
    console.log('⚠ Warning: Could not extract version from zip filename');
  }
}

function getECRLogin() {
  console.log('Logging into ECR...');
  try {
    const loginCmd = `aws ecr get-login-password --region ${AWS_REGION}`;
    const password = execSync(loginCmd, { encoding: 'utf-8' }).trim();

    // Extract account ID from ECR repository
    const accountId = execSync(`aws sts get-caller-identity --query Account --output text`, { encoding: 'utf-8' }).trim();
    const ecrRegistry = `${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com`;

    execSync(`echo "${password}" | docker login --username AWS --password-stdin ${ecrRegistry}`, { stdio: 'inherit' });
    console.log('✓ Successfully logged into ECR');
    return { ecrRegistry, accountId };
  } catch (error) {
    console.error('Error logging into ECR:', error.message);
    process.exit(1);
  }
}

function dockerBuild(repositoryName = ECR_REPO, force = false) {
  console.log('Building Docker image...');

  // Check if docker directory exists
  const dockerPath = path.resolve(__dirname, '..', TARGET_DIR);
  if (!fs.existsSync(dockerPath)) {
    console.error(`Error: Docker directory ${TARGET_DIR} not found. Run 'sync' first.`);
    process.exit(1);
  }

  // Check if Dockerfile exists
  const dockerfilePath = path.join(dockerPath, 'Dockerfile');
  if (!fs.existsSync(dockerfilePath)) {
    console.error(`Error: Dockerfile not found at ${dockerfilePath}`);
    process.exit(1);
  }

  // Get version from package.json
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'));
  const version = packageJson.version || 'latest';

  const { ecrRegistry } = getECRLogin();
  const imageTag = `${ecrRegistry}/${repositoryName}:${version}`;
  const latestTag = `${ecrRegistry}/${repositoryName}:latest`;

  // Check if image already exists locally and is up to date
  if (!force) {
    try {
      const latestExists = execSync(`docker images -q ${latestTag}`, { encoding: 'utf-8' }).trim();
      const versionExists = execSync(`docker images -q ${imageTag}`, { encoding: 'utf-8' }).trim();
      if (latestExists && versionExists) {
        console.log(`✓ Image ${latestTag} already exists locally, skipping build`);
        return;
      } else if (latestExists && !versionExists) {
        // Latest exists but version tag is missing, just retag
        console.log(`✓ Retagging existing image as ${imageTag}`);
        execSync(`docker tag ${latestExists} ${imageTag}`, { stdio: 'inherit' });
        return;
      }
    } catch (e) {
      // Image doesn't exist, continue with build
    }
  }

  try {
    console.log(`Building image: ${imageTag}`);
    execSync(`docker build -t ${imageTag} -t ${latestTag} ${dockerPath}`, { stdio: 'inherit' });
    console.log(`✓ Successfully built ${imageTag}`);
    console.log(`✓ Also tagged as ${latestTag}`);
  } catch (error) {
    console.error('Error building Docker image:', error.message);
    process.exit(1);
  }
}

function dockerPush(repositoryName = ECR_REPO) {
  console.log(`\n=== Docker Push: ${repositoryName} ===\n`);

  // Check architecture for regular push (not dev)
  if (repositoryName === ECR_REPO) {
    const currentArch = getCurrentArchitecture();
    if (currentArch !== 'amd64') {
      console.error(`✗ Error: Regular push requires amd64 architecture`);
      console.error(`  Current architecture: ${currentArch}`);
      console.error(`  Use 'npm run docker-dev' for architecture-specific builds`);
      process.exit(1);
    }
  }

  // Step 1: Build if needed
  console.log('Step 1: Building image...');
  dockerBuild(repositoryName, false);

  // Step 2: Push to ECR
  console.log('\nStep 2: Pushing to ECR...');

  // Get version from package.json
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'));
  const version = packageJson.version || 'latest';

  const { ecrRegistry } = getECRLogin();
  const imageTag = `${ecrRegistry}/${repositoryName}:${version}`;
  const latestTag = `${ecrRegistry}/${repositoryName}:latest`;

  try {
    console.log(`Pushing ${imageTag}...`);
    execSync(`docker push ${imageTag}`, { stdio: 'inherit' });
    console.log(`✓ Successfully pushed ${imageTag}`);

    console.log(`Pushing ${latestTag}...`);
    execSync(`docker push ${latestTag}`, { stdio: 'inherit' });
    console.log(`✓ Successfully pushed ${latestTag}`);
  } catch (error) {
    console.error('Error pushing Docker image:', error.message);
    process.exit(1);
  }

  // Step 3: Verify with check
  console.log('\nStep 3: Verifying push...');
  dockerCheckSingleWrapper(repositoryName);
}

function dockerCheckSingleWrapper(repositoryName) {
  console.log('Checking ECR image information...\n');

  try {
    // Get account ID
    const accountId = execSync(`aws sts get-caller-identity --query Account --output text`, { encoding: 'utf-8' }).trim();
    const ecrRegistry = `${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com`;

    console.log(`Registry: ${ecrRegistry}`);
    console.log(`Region: ${AWS_REGION}`);

    const success = dockerCheckSingle(repositoryName, ecrRegistry);
    if (!success) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Error checking ECR:', error.message);
    process.exit(1);
  }
}

function dockerCheckSingle(repositoryName, ecrRegistry, showHeader = true) {
  if (showHeader) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Repository: ${repositoryName}`);
    console.log(`${'='.repeat(80)}\n`);
  }

  try {
    // List all images in the repository
    console.log('=== Available Images ===');
    const listImagesCmd = `aws ecr list-images --repository-name ${repositoryName} --region ${AWS_REGION} --output json 2>&1`;
    let imagesOutput;
    try {
      imagesOutput = execSync(listImagesCmd, { encoding: 'utf-8' });
    } catch (error) {
      if (error.message && error.message.includes('RepositoryNotFoundException')) {
        console.error('✗ Repository not found\n');
        return false;
      }
      throw error;
    }

    const images = JSON.parse(imagesOutput);

    if (!images.imageIds || images.imageIds.length === 0) {
      console.error('✗ Repository is empty\n');
      return false;
    }

    const tags = images.imageIds
      .filter(img => img.imageTag)
      .map(img => img.imageTag)
      .sort();
    console.log(`Total images: ${images.imageIds.length}`);
    console.log(`Tags: ${tags.join(', ')}\n`);

    // Get detailed information for the latest tag
    console.log('=== Latest Image Details ===');
    const describeCmd = `aws ecr describe-images --repository-name ${repositoryName} --image-ids imageTag=latest --region ${AWS_REGION} --output json`;
    let describeOutput;
    try {
      describeOutput = execSync(describeCmd, { encoding: 'utf-8' });
    } catch (error) {
      console.error('✗ Image with tag "latest" not found in repository');
      process.exit(1);
    }

    const imageDetails = JSON.parse(describeOutput);

    if (!imageDetails.imageDetails || imageDetails.imageDetails.length === 0) {
      console.error('✗ No details found for image with tag "latest"');
      process.exit(1);
    }

    const detail = imageDetails.imageDetails[0];
    console.log(`Image Tag: latest`);
    console.log(`Digest: ${detail.imageDigest}`);
    console.log(`Pushed: ${new Date(detail.imagePushedAt).toLocaleString()}`);
    console.log(`Size: ${(detail.imageSizeInBytes / (1024 * 1024)).toFixed(2)} MB`);

    if (detail.artifactMediaType) {
      console.log(`Media Type: ${detail.artifactMediaType}`);
    }

    if (detail.imageTags) {
      console.log(`All tags: ${detail.imageTags.join(', ')}`);
    }

    // Get manifest to extract architecture information
    console.log('\n=== Architecture Information ===');
    const manifestCmd = `aws ecr batch-get-image --repository-name ${repositoryName} --image-ids imageTag=latest --region ${AWS_REGION} --accepted-media-types "application/vnd.docker.distribution.manifest.v2+json" "application/vnd.oci.image.manifest.v1+json" "application/vnd.docker.distribution.manifest.list.v2+json" "application/vnd.oci.image.index.v1+json" --output json`;
    let manifestOutput;
    try {
      manifestOutput = execSync(manifestCmd, { encoding: 'utf-8' });
    } catch (error) {
      console.error('✗ Failed to retrieve image manifest from ECR');
      process.exit(1);
    }

    const manifestData = JSON.parse(manifestOutput);

    if (!manifestData.images || manifestData.images.length === 0) {
      console.error('✗ No manifest data found for image');
      process.exit(1);
    }

    const manifest = JSON.parse(manifestData.images[0].imageManifest);

    // Check if it's a manifest list (multi-arch)
    if (manifest.manifests) {
      console.log('Multi-architecture image:');
      manifest.manifests.forEach((m, index) => {
        console.log(`  Platform ${index + 1}: ${m.platform.os}/${m.platform.architecture}`);
        if (m.platform.variant) {
          console.log(`    Variant: ${m.platform.variant}`);
        }
      });
    } else if (manifest.config) {
      // Single architecture image
      // Try to get architecture from manifest directly
      if (manifest.architecture || manifest.os) {
        console.log(`Architecture: ${manifest.architecture || 'unknown'}`);
        console.log(`OS: ${manifest.os || 'unknown'}`);
      } else {
        console.error('✗ Unable to determine architecture from manifest');
        process.exit(1);
      }
    } else {
      console.error('✗ Unsupported manifest format');
      process.exit(1);
    }

    console.log('✓ Check complete\n');
    return true;
  } catch (error) {
    console.error(`✗ Error: ${error.message}\n`);
    return false;
  }
}

function dockerCheck(repositoryName = null) {
  console.log('Checking ECR image information...\n');

  try {
    // Get account ID
    const accountId = execSync(`aws sts get-caller-identity --query Account --output text`, { encoding: 'utf-8' }).trim();
    const ecrRegistry = `${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com`;

    console.log(`Registry: ${ecrRegistry}`);
    console.log(`Region: ${AWS_REGION}`);

    // If specific repository requested, check only that one
    if (repositoryName) {
      dockerCheckSingle(repositoryName, ecrRegistry);
      return;
    }

    // Otherwise check all three repositories
    const repositories = [
      ECR_REPO,
      `${ECR_REPO}-arm64`,
      `${ECR_REPO}-amd64`
    ];

    let anySuccess = false;
    for (const repo of repositories) {
      const success = dockerCheckSingle(repo, ecrRegistry);
      if (success) anySuccess = true;
    }

    if (!anySuccess) {
      console.error('\n✗ No repositories found');
      process.exit(1);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('Summary: Checked all repositories');
    console.log(`${'='.repeat(80)}`);

  } catch (error) {
    console.error('Error checking ECR:', error.message);
    process.exit(1);
  }
}

function dockerDev() {
  const arch = getCurrentArchitecture();
  const devRepo = `${ECR_REPO}-${arch}`;
  console.log(`\n=== Docker Dev Build (${arch}) ===`);
  console.log(`Using architecture-specific repository: ${devRepo}\n`);

  dockerPush(devRepo);
}

// Parse command
const command = process.argv[2] || 'sync';

switch (command) {
  case 'sync':
    dockerSync();
    break;
  case 'build':
    dockerBuild();
    break;
  case 'push':
    dockerPush();
    break;
  case 'check':
    dockerCheck();
    break;
  case 'dev':
    dockerDev();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log('Usage: docker.js [sync|build|push|check|dev]');
    console.log('');
    console.log('Commands:');
    console.log('  sync   - Sync and extract latest build from enterprise repository');
    console.log('  build  - Build Docker image and tag for ECR');
    console.log('  push   - Build (if needed), push to ECR, and verify with check (amd64 only)');
    console.log('  check  - Display information about images in ECR (including architecture)');
    console.log('  dev    - Like push, but uses arch-specific repository (e.g., quiltdata/benchling-arm64)');
    console.log('');
    console.log('Notes:');
    console.log('  - Regular push (to quiltdata/benchling) requires amd64 architecture');
    console.log('  - Use dev command for arm64 or other architectures');
    console.log('');
    console.log('Environment variables:');
    console.log('  CDK_DEFAULT_REGION - AWS region (checked first)');
    console.log('  AWS_REGION         - AWS region (fallback)');
    console.log(`  Current region: ${AWS_REGION}`);
    process.exit(1);
}
