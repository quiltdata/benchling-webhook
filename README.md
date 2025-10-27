# quilt-benchling-webhook

API Gateway for processing Benchling Events using AWS Fargate

## Overview

This project implements a serverless webhook processor for Benchling events using AWS services:

- **API Gateway** receives webhook events from Benchling
- **Application Load Balancer** routes traffic to Fargate tasks
- **AWS Fargate** runs the webhook processing Docker container
- **S3** stores event data and entry details
- **SQS** handles notifications to the Quilt packaging system
- **ECR** stores Docker images with version management

## Project Structure

The codebase is organized as follows:

- `lib/benchling-webhook-stack.ts` - Main CDK stack definition
- `lib/fargate-service.ts` - ECS Fargate service construct
- `lib/alb-api-gateway.ts` - API Gateway with ALB integration
- `lib/ecr-repository.ts` - ECR repository with public access configuration
- `bin/benchling-webhook.ts` - CDK app entry point
- `bin/deploy.sh` - Enhanced deployment script with output capture
- `bin/docker.js` - Docker image management utilities
- `bin/create-release.sh` - Release creation and tagging script

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- AWS CLI configured with appropriate credentials
- Docker (for local testing and image management)
- An AWS account with ECR, ECS, and CDK permissions

### Installation

```bash
# Clone the repository
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook

# Install dependencies
npm install

# Bootstrap CDK (first time only)
npx cdk bootstrap aws://ACCOUNT-ID/REGION
```

## Configuration

Create a `.env` file with the following content:

```bash
export CDK_DEFAULT_ACCOUNT=XXXXXXXXXXXX
export CDK_DEFAULT_REGION=us-west-2
export BUCKET_NAME=bucket-in-that-region
export PREFIX=benchling
export QUILT_CATALOG=stable.quilttest.com
export QUEUE_NAME=tf-stable-PackagerQueue-4g1PXC9992vI
export BENCHLING_TENANT=<YOUR_BENCHLING_TENANT>
export BENCHLING_CLIENT_ID=<YOUR_BENCHLING_APP_CLIENT_ID>
export BENCHLING_CLIENT_SECRET=<YOUR_BENCHLING_CLIENT_SECRET>
export WEBHOOK_ALLOW_LIST="203.0.113.10,198.51.100.5" # optional: comma-separated source IPs

# Optional: ECR repository configuration
export CREATE_ECR_REPOSITORY=false  # Set to true to create new ECR repo
export ECR_REPOSITORY_NAME=quiltdata/benchling
```

### Configuration Notes

**IMPORTANT - S3 Bucket Region:** The `BUCKET_NAME` must be an S3 bucket located in the **same region** as `CDK_DEFAULT_REGION`. If you specify a bucket in a different region, the packaging state machine will fail with a `PermanentRedirect` error. The bucket must also be connected to your Quilt stack.

- **QUEUE_NAME**: Choose the name of the "PackagerQueue" in your Quilt stack. This will allow the BenchlingWebhookStack to send messages to the Quilt Packaging Engine
- **BENCHLING_TENANT**: Use XXX if you login to benchling at XXX.benchling.com
- **WEBHOOK_ALLOW_LIST**: Set to the public IPs Benchling uses for webhook delivery to add an IP-based guardrail around signature verification. Leave unset to accept Benchling traffic from any source.

## Deployment

### Using the Enhanced Deployment Script

The deployment script automatically captures CDK outputs to `.env.deploy` for easy reference:

```bash
# Load environment variables
source .env

# Deploy with tests
npm run deploy

# Deploy without tests (faster)
npm run deploy:skip-tests

# View deployment outputs
cat .env.deploy
```

The deployment will output key information including:
- Webhook endpoint URL (use this in Benchling configuration)
- Docker image URI
- ECS cluster and service names
- Deployment timestamp and metadata

### Using CDK Directly

```bash
source .env
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
npx cdk deploy
```

### Using npx (as an npm package)

You can deploy this as a package using npx:

```bash
# From the project directory
npx benchling-webhook-deploy
```

## Docker Image Management

### Building and Pushing Images

```bash
# Sync latest code from enterprise repository
npm run docker-sync

# Build Docker image
npm run docker-build

# Build and push to ECR
npm run docker-push

# Check ECR repository status and verify public access
npm run docker-check

# Test image locally with health checks
npm run docker-health
```

### ECR Repository Configuration

The ECR repository can be configured with public read access for easier deployment:

```bash
# Check if repository has public access
npm run docker-check

# The output will show:
# ✓ Repository has public read access enabled
# or
# ⚠ Repository does not have public read access
```

To enable public access, set `CREATE_ECR_REPOSITORY=true` in your `.env` file and redeploy.

## Creating Releases

### Automated Release Process (Recommended)

The project includes a CI/CD workflow that automatically publishes releases when you push a version tag:

```bash
# 1. Update version in package.json (if needed)
npm version patch  # or minor, or major

# 2. Create and push release tag
bash bin/create-release.sh

# This script will:
# - Check for uncommitted changes
# - Verify Docker image exists in ECR (or build it)
# - Update RELEASE_NOTES.md
# - Create a git tag with release information
# - Show instructions for pushing

# 3. Push the tag to trigger the release workflow
git push origin vX.Y.Z

# The GitHub Actions workflow will automatically:
# ✓ Build and test the package
# ✓ Build and push Docker image to ECR
# ✓ Create GitHub Release with release notes
# ✓ Publish package to NPM (if NPM_TOKEN secret is configured)
# ✓ Publish package to GitHub Packages
```

### What Gets Published

When you push a version tag (e.g., `v0.5.0`), the release workflow publishes:

1. **NPM Package**: `quilt-benchling-webhook@X.Y.Z`
   - Installable via: `npm install quilt-benchling-webhook`
   - Or directly: `npx quilt-benchling-webhook`

2. **GitHub Package**: `@quiltdata/quilt-benchling-webhook@X.Y.Z`
   - Available at: `https://github.com/quiltdata/benchling-webhook/pkgs/npm/quilt-benchling-webhook`

3. **Docker Image**: Tagged in ECR with version and `latest`
   - `ACCOUNT.dkr.ecr.REGION.amazonaws.com/quiltdata/benchling:X.Y.Z`
   - `ACCOUNT.dkr.ecr.REGION.amazonaws.com/quiltdata/benchling:latest`

4. **GitHub Release**: With release notes and Docker image information

### Manual Release Process

If you need to release manually without the CI/CD workflow:

1. **Update Version**
   ```bash
   npm run docker-sync  # Version auto-synced from docker build
   ```

2. **Build and Push Docker Image**
   ```bash
   npm run docker-push
   ```

3. **Create Git Tag**
   ```bash
   VERSION=$(node -e "console.log(require('./package.json').version)")
   git tag -a "v$VERSION" -m "Release v$VERSION"
   git push origin "v$VERSION"
   ```

4. **Deploy**
   ```bash
   npm run deploy
   ```

### GitHub Secrets Configuration

For the automated release workflow to work, configure these secrets in your GitHub repository settings:

**Required:**
- `AWS_ACCESS_KEY_ID` - AWS credentials for ECR access
- `AWS_SECRET_ACCESS_KEY` - AWS credentials for ECR access

**Optional:**
- `NPM_TOKEN` - For publishing to NPM registry (if you want public NPM releases)
- `GITHUB_TOKEN` - Automatically provided by GitHub Actions

To configure secrets:
1. Go to repository Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add each secret with its value

### Release Information

Each release includes:
- Git tag: `vX.Y.Z`
- Docker image tags: `X.Y.Z` and `latest`
- Full release notes in `RELEASE_NOTES.md`
- Deployment metadata in `.env.deploy`
- NPM package: `quilt-benchling-webhook@X.Y.Z`
- GitHub Package: `@quiltdata/quilt-benchling-webhook@X.Y.Z`

See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for detailed release history and Docker image information for each version.

## Benchling Setup

1. Create an [App Manifest](./app-manifest.yaml) that subscribes to the desired events
2. In Benchling, go to lower left Profile -> Feature Settings -> Developer Console
3. Apps -> Create app -> From manifest
   1. Select Public
   2. Add app manifest
   3. Create
4. Create Client Secret
5. Copy `BENCHLING_CLIENT_ID` and `BENCHLING_CLIENT_SECRET` to `.env`
6. Go to Overview -> Webhook URL
   1. Click edit
   2. Paste in the webhook endpoint from `.env.deploy`
   3. Save
7. Go to Version History -> Install
8. Click "View app in workspace"
9. Click "Activate"
10. Go to Profile -> Tenant Admin console
    1. Verify it is in Apps
    2. Go to Organizations -> "your org"
11. Go to "Apps" tab
    1. Start typing 'benchling-webhook' in the search box
    2. Click "Add app"
    3. Select the app
    4. Change the 'Role' to 'Admin'

## Usage

1. Create a new entry in the Benchling app
    1. Go to the "Benchling" tab
    2. Click "Create > Entry -> Blank entry"
    3. Set a name
    4. Click "Create"
2. Add the Canvas app to the entry
    1. Select "Insert -> Canvas" from the Toolbar
    2. Select "Quilt Integration"
    3. Click "Insert"
3. In the Canvas section
    1. Click "Create" (wait a few seconds for it to create)
    2. Wait a bit for the package to be asynchronously created
    3. Command-Click "Quilt Catalog" to open the package in a new window
4. Drag in an attachment to the Benchling entry
    1. Click "Update package" to create a new version

## Testing

```bash
# Run tests
npm test

# Test webhook endpoint
export WEBHOOK_ENDPOINT=$(cat .env.deploy | grep WEBHOOK_ENDPOINT | cut -d'=' -f2)
curl $WEBHOOK_ENDPOINT/health

# Test with sample payload
curl -X POST $WEBHOOK_ENDPOINT/event \
  -H "Content-Type: application/json" \
  -d @test/entry-updated.json
```

## Monitoring and Operations

### View Deployment Outputs

```bash
# Quick view of key outputs
cat .env.deploy

# All CDK outputs
cat cdk-outputs.json
```

### Monitor ECS Service

```bash
# Get service information from .env.deploy
source .env.deploy

# Check service status
aws ecs describe-services \
  --cluster $ECS_CLUSTER_NAME \
  --services $ECS_SERVICE_NAME \
  --region $CDK_REGION

# View container logs
aws logs tail /ecs/benchling-webhook --follow
```

### Health Checks

The service provides two health check endpoints:

- `/health` - Basic health check
- `/health/ready` - Readiness check (includes downstream dependencies)

```bash
source .env.deploy
curl $WEBHOOK_ENDPOINT/health
curl $WEBHOOK_ENDPOINT/health/ready
```

## Troubleshooting

### Deployment Issues

1. **Check environment variables**
   ```bash
   source .env
   env | grep CDK
   env | grep BENCHLING
   ```

2. **View deployment logs**
   ```bash
   # Logs are printed during deployment
   npm run deploy
   ```

3. **Check CDK diff**
   ```bash
   npm run diff
   ```

### Docker Image Issues

1. **Check ECR repository**
   ```bash
   npm run docker-check
   ```

2. **Verify image architecture**
   ```bash
   # Should show linux/amd64
   npm run docker-check
   ```

3. **Test image locally**
   ```bash
   npm run docker-health
   ```

### Service Issues

1. **Check ECS task status**
   ```bash
   source .env.deploy
   aws ecs list-tasks --cluster $ECS_CLUSTER_NAME
   ```

2. **View container logs**
   ```bash
   aws logs tail /ecs/benchling-webhook --follow
   ```

3. **Check ALB health**
   ```bash
   source .env.deploy
   curl http://$ALB_DNS_NAME/health
   ```

## Development

### Available Commands

```bash
# Build TypeScript
npm run build

# Watch for changes
npm run watch

# Lint code
npm run lint

# Clean build artifacts
npm run clean

# Synthesize CloudFormation template
npm run synth

# Compare deployed stack with current state
npm run diff
```

### Project Commands

- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and compile
- `npm run test` - Run unit tests
- `npm run deploy` - Deploy with output capture
- `npm run deploy:skip-tests` - Deploy without running tests
- `npm run cdk` - Run CDK deploy (legacy)
- `npm run lint` - Run ESLint
- `npm run docker-sync` - Sync latest Docker build
- `npm run docker-build` - Build Docker image
- `npm run docker-push` - Build and push to ECR
- `npm run docker-check` - Check ECR repository and images
- `npm run docker-health` - Test image locally
- `npm run synth` - Synthesize CloudFormation template
- `npm run diff` - Compare deployed vs current state

## Architecture

### Infrastructure Components

- **API Gateway**: REST API endpoint for webhook ingestion
- **Application Load Balancer**: Distributes traffic to Fargate tasks
- **ECS Fargate**: Runs containerized webhook processor
  - Auto-scaling: 2-10 tasks based on CPU/Memory
  - Health checks on `/health` and `/health/ready`
  - Container Insights enabled for monitoring
- **ECR**: Stores versioned Docker images
  - Lifecycle policy: keeps last 10 images
  - Public read access configurable
  - Image scanning on push
- **Secrets Manager**: Stores Benchling credentials
- **CloudWatch**: Logs and metrics

### Deployment Workflow

1. Code changes pushed to repository
2. Docker image built and tagged with version
3. Image pushed to ECR
4. CDK deployment updates Fargate service
5. ECS performs rolling update with health checks
6. Outputs captured to `.env.deploy`

## Security

- Benchling credentials stored in AWS Secrets Manager
- Optional IP allowlist for webhook sources
- ECR image scanning enabled
- IAM least-privilege policies
- VPC security groups restrict network access

## License

Apache-2.0

## Support

- **GitHub**: https://github.com/quiltdata/benchling-webhook
- **Issues**: https://github.com/quiltdata/benchling-webhook/issues
- **Release Notes**: [RELEASE_NOTES.md](./RELEASE_NOTES.md)
