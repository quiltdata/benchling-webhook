#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = '../enterprise/benchling/.scratch/dist';
const TARGET_DIR = './docker';
const ECR_REPO = 'quiltdata/benchling';
const AWS_REGION = process.env.AWS_REGION || 'us-east-2';

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

function dockerBuild() {
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
  const imageTag = `${ecrRegistry}/${ECR_REPO}:${version}`;
  const latestTag = `${ecrRegistry}/${ECR_REPO}:latest`;

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

function dockerPush() {
  console.log('Pushing Docker image to ECR...');

  // Get version from package.json
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'));
  const version = packageJson.version || 'latest';

  const { ecrRegistry } = getECRLogin();
  const imageTag = `${ecrRegistry}/${ECR_REPO}:${version}`;
  const latestTag = `${ecrRegistry}/${ECR_REPO}:latest`;

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
}

function dockerCheck() {
  console.log('Checking ECR image information...\n');

  // Get version from package.json
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'));
  const version = packageJson.version || 'latest';

  try {
    // Get account ID
    const accountId = execSync(`aws sts get-caller-identity --query Account --output text`, { encoding: 'utf-8' }).trim();
    const ecrRegistry = `${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com`;

    console.log(`Repository: ${ECR_REPO}`);
    console.log(`Registry: ${ecrRegistry}`);
    console.log(`Region: ${AWS_REGION}\n`);

    // List all images in the repository
    console.log('=== Available Images ===');
    const listImagesCmd = `aws ecr list-images --repository-name ${ECR_REPO} --region ${AWS_REGION} --output json`;
    const imagesOutput = execSync(listImagesCmd, { encoding: 'utf-8' });
    const images = JSON.parse(imagesOutput);

    if (!images.imageIds || images.imageIds.length === 0) {
      console.error('✗ No images found in repository');
      console.error(`Repository ${ECR_REPO} is empty or does not exist`);
      process.exit(1);
    }

    const tags = images.imageIds
      .filter(img => img.imageTag)
      .map(img => img.imageTag)
      .sort();
    console.log(`Total images: ${images.imageIds.length}`);
    console.log(`Tags: ${tags.join(', ')}\n`);

    // Get detailed information for the latest tag
    console.log('=== Latest Image Details ===');
    const describeCmd = `aws ecr describe-images --repository-name ${ECR_REPO} --image-ids imageTag=latest --region ${AWS_REGION} --output json`;
    const describeOutput = execSync(describeCmd, { encoding: 'utf-8' });
    const imageDetails = JSON.parse(describeOutput);

    if (imageDetails.imageDetails && imageDetails.imageDetails.length > 0) {
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
    }

    // Get manifest to extract architecture information
    console.log('\n=== Architecture Information ===');
    const manifestCmd = `aws ecr batch-get-image --repository-name ${ECR_REPO} --image-ids imageTag=latest --region ${AWS_REGION} --accepted-media-types "application/vnd.docker.distribution.manifest.v2+json" "application/vnd.oci.image.manifest.v1+json" "application/vnd.docker.distribution.manifest.list.v2+json" "application/vnd.oci.image.index.v1+json" --output json`;
    const manifestOutput = execSync(manifestCmd, { encoding: 'utf-8' });
    const manifestData = JSON.parse(manifestOutput);

    if (manifestData.images && manifestData.images.length > 0) {
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
        const configCmd = `aws ecr batch-get-image --repository-name ${ECR_REPO} --image-ids imageDigest=${manifest.config.digest} --region ${AWS_REGION} --output json 2>/dev/null || echo '{}'`;
        try {
          const configOutput = execSync(configCmd, { encoding: 'utf-8' });
          const configData = JSON.parse(configOutput);

          // Try to get architecture from image config
          if (manifest.architecture || manifest.os) {
            console.log(`Architecture: ${manifest.architecture || 'unknown'}`);
            console.log(`OS: ${manifest.os || 'unknown'}`);
          } else {
            // Fallback: inspect local image if it exists
            try {
              const inspectCmd = `docker inspect ${ecrRegistry}/${ECR_REPO}:latest --format '{{.Architecture}}/{{.Os}}' 2>/dev/null || echo 'Not available locally'`;
              const inspectOutput = execSync(inspectCmd, { encoding: 'utf-8' }).trim();
              if (inspectOutput !== 'Not available locally') {
                console.log(`Architecture/OS: ${inspectOutput}`);
                console.log('(from local image inspection)');
              } else {
                console.log('Architecture: Check manifest config for details');
              }
            } catch (e) {
              console.log('Architecture: Unable to determine');
            }
          }
        } catch (e) {
          console.log('Architecture: Unable to retrieve config');
        }
      }
    }

    // Check current version tag
    console.log(`\n=== Current Version (${version}) ===`);
    try {
      const versionCmd = `aws ecr describe-images --repository-name ${ECR_REPO} --image-ids imageTag=${version} --region ${AWS_REGION} --output json`;
      const versionOutput = execSync(versionCmd, { encoding: 'utf-8' });
      const versionDetails = JSON.parse(versionOutput);

      if (versionDetails.imageDetails && versionDetails.imageDetails.length > 0) {
        const detail = versionDetails.imageDetails[0];
        console.log(`✓ Version ${version} exists in ECR`);
        console.log(`  Pushed: ${new Date(detail.imagePushedAt).toLocaleString()}`);
        console.log(`  Digest: ${detail.imageDigest}`);
      }
    } catch (e) {
      console.log(`✗ Version ${version} not found in ECR`);
    }

    console.log('\n✓ Check complete');
  } catch (error) {
    console.error('Error checking ECR:', error.message);
    process.exit(1);
  }
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
  default:
    console.error(`Unknown command: ${command}`);
    console.log('Usage: docker.js [sync|build|push|check]');
    console.log('');
    console.log('Commands:');
    console.log('  sync   - Sync and extract latest build from enterprise repository');
    console.log('  build  - Build Docker image and tag for ECR');
    console.log('  push   - Push Docker image to ECR repository');
    console.log('  check  - Display information about images in ECR (including architecture)');
    console.log('');
    console.log('Environment variables:');
    console.log(`  AWS_REGION - AWS region (default: ${AWS_REGION})`);
    process.exit(1);
}
