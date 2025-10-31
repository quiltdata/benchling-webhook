# Development Deployment Workflow

This document describes how to deploy a development version of the Benchling webhook stack using a specific Docker image tag.

## Overview

The `cdk:dev` workflow allows you to:
1. Create a timestamped development git tag (e.g., `v0.5.3-20251030T123456Z`)
2. Push the tag to GitHub, triggering CI to build a Docker image for x86_64 (AWS-compatible)
3. Wait for the CI/CD pipeline to complete
4. Deploy a CDK stack that uses that specific CI-built image instead of `latest`

This is useful for testing changes before making a production release.

**IMPORTANT**: This workflow uses CI-built images (x86_64), NOT local builds. Local ARM builds from Mac would fail in AWS which runs on x86_64 architecture.

## Quick Start

```bash
npm run cdk:dev
```

This single command will:
- ✅ Check for uncommitted changes (must have clean working directory)
- ✅ Create a dev git tag with timestamp
- ✅ Push the tag to GitHub origin (triggers CI/CD)
- ✅ Wait for CI to build and push Docker image (x86_64) to ECR
- ✅ Deploy CDK stack using the CI-built image tag

**Typical runtime**: 5-10 minutes (most time is waiting for CI to build the image)

## Manual Usage

If you need more control, you can run the steps manually:

### 1. Create and push a dev tag

```bash
npm run release:dev
```

This creates a tag like `v0.5.3-20251030T123456Z` and pushes it to GitHub, which triggers CI.

### 2. Wait for CI to build Docker image

Monitor the CI workflow at: https://github.com/quiltdata/benchling-webhook/actions

The CI workflow will:
- Run tests
- Build Docker image for linux/amd64 (x86_64)
- Push to ECR with version tag
- Create GitHub release

### 3. Deploy with specific image tag

Once CI completes, deploy with the full timestamped version:

```bash
npx @quiltdata/benchling-webhook deploy --image-tag 0.5.3-20251030T123456Z --yes
```

Or using the CLI shorthand:

```bash
npm run cli -- --image-tag 0.5.3-20251030T123456Z --yes
```

**IMPORTANT**: You must use the **full timestamped version** (e.g., `0.5.3-20251030T123456Z`) to deploy the specific CI-built image. Using just the base version (e.g., `0.5.3`) will deploy `latest` instead of your dev image.

**Note**: Use the version without the 'v' prefix (e.g., `0.5.3-...` not `v0.5.3-...`)

## Image Tag Configuration

The image tag can be specified in multiple ways (in order of precedence):

1. **CLI flag**: `--image-tag dev`
2. **Environment variable**: `IMAGE_TAG=dev` in `.env`
3. **Default**: `latest`

## Examples

### Deploy using a specific dev version

```bash
npm run cli -- --image-tag 0.5.3-20251030T123456Z --yes
```

### Deploy using latest

```bash
npm run cli -- --yes
# or
npm run cli -- --image-tag latest --yes
```

### Set image tag in .env file

```bash
echo "IMAGE_TAG=0.5.3-20251030T123456Z" >> .env
npm run cli -- --yes
```

## How It Works

### Git Tags

The dev workflow creates timestamped git tags to ensure uniqueness:
- Format: `v{version}-{timestamp}`
- Example: `v0.5.3-20251030T123456Z`
- Timestamp format: ISO 8601 without separators

### Docker Images

CI builds and pushes images to ECR with multiple tags:
- Version tag: `quiltdata/benchling:0.5.3-20251030T123456Z`
- Latest tag: `quiltdata/benchling:latest`

**Architecture**: CI always builds for `linux/amd64` (x86_64) which is what AWS Fargate uses. Local ARM builds are NOT used.

### CDK Deployment

The CDK stack uses the specified image tag when creating the ECS Fargate service. The deployment flow:
1. CLI option → Config → Stack props → CloudFormation parameter
2. CloudFormation `ImageTag` parameter → Fargate container image
3. Stack version → Container environment variable `BENCHLING_WEBHOOK_VERSION`

The `ImageTag` CloudFormation parameter allows runtime updates without redeploying the entire stack - you can update just the container image by changing this parameter.

## Architecture

```
┌──────────────────┐
│  npm run cdk:dev │
└────────┬─────────┘
         │
         ├─ 1. Create dev tag (v0.5.3-{timestamp})
         ├─ 2. Push tag to GitHub
         │
         ├─ 3. GitHub Actions CI (linux/amd64)
         │   ├─ Run tests
         │   ├─ Build Docker image
         │   ├─ Push to ECR
         │   └─ Create GitHub release
         │
         ├─ 4. Wait for CI to complete (polls GitHub API)
         │
         └─ 5. Deploy CDK with --image-tag
                │
                ├─ benchling-webhook-stack.ts
                ├─ fargate-service.ts
                └─ ECS Task Definition
                   └─ ContainerImage.fromEcrRepository(repo, tag)
```

## Troubleshooting

### Error: "You have uncommitted changes"

The dev workflow requires a clean working directory. Commit or stash your changes:

```bash
git add .
git commit -m "feat: my changes"
npm run cdk:dev
```

### Error: "Tag already exists"

Dev tags include timestamps and should be unique. If you see this error, wait a second and try again, or manually create a tag with a different name.

### Error: "Docker image not found"

The CI workflow must complete successfully before you can deploy. Check:

1. **CI Workflow Status**: https://github.com/quiltdata/benchling-webhook/actions
2. **ECR Repository**:
   ```bash
   aws ecr list-images --repository-name quiltdata/benchling --region us-east-1
   ```
3. **Image Tag**: Verify the image exists with your version tag

If CI failed, fix the issue, create a new dev tag, and try again.

### Error: "Timeout waiting for CI workflow"

The `cdk:dev` script waits up to 15 minutes for CI to complete. If it times out:

1. Check the CI workflow manually: https://github.com/quiltdata/benchling-webhook/actions
2. Once CI completes, deploy manually:
   ```bash
   npm run cli -- --image-tag 0.5.3-20251030T123456Z --yes
   ```

### Deployment succeeds but uses wrong Docker image

If the deployment completes successfully but the CloudFormation output shows `DockerImageUri: .../:latest` instead of your dev tag:

**Cause**: The `--image-tag` parameter is missing the timestamp portion. The script needs the full version string.

**Solution**: Ensure you're passing the complete timestamped version:
```bash
# ❌ Wrong - missing timestamp
npm run cli -- --image-tag 0.5.3 --yes

# ✅ Correct - full timestamped version
npm run cli -- --image-tag 0.5.3-20251030T123456Z --yes
```

**Verification**: After deployment, check the deployed image:
```bash
# Check CloudFormation parameter
aws cloudformation describe-stacks --stack-name BenchlingWebhookStack \
  --query 'Stacks[0].Parameters[?ParameterKey==`ImageTag`].ParameterValue' \
  --output text

# Check ECS task definition
aws ecs describe-task-definition --task-definition benchling-webhook-task \
  --query 'taskDefinition.containerDefinitions[0].image' \
  --output text
```

The image should show your full timestamped tag, not `latest`.

### Setting GITHUB_TOKEN for rate limiting

If you hit GitHub API rate limits, set a GitHub token:

```bash
export GITHUB_TOKEN=ghp_your_token_here
npm run cdk:dev
```

This increases the rate limit from 60 to 5000 requests per hour.

## Production Deployment

For production releases, use the standard workflow:

```bash
npm run release      # Create production tag (no timestamp)
# CI/CD pipeline automatically builds and deploys
```

The production workflow uses `latest` tag by default.

## Related Commands

- `npm run release` - Create production release tag
- `npm run release:dev` - Create dev release tag only (no Docker/CDK)
- `npm run docker-push` - Build and push Docker image manually
- `npm run cdk` - Run tests and deploy with latest image

## Configuration Reference

### CLI Options

- `--image-tag <tag>` - Docker image tag to deploy (default: latest)
- `--yes` - Skip confirmation prompts
- `--env-file <path>` - Path to .env file (default: .env)

### Environment Variables

- `IMAGE_TAG` - Default image tag if not specified via CLI
- `ECR_REPOSITORY_NAME` - ECR repository name (default: quiltdata/benchling)
- `AWS_REGION` - AWS region for ECR (default: us-east-1)

## Files Modified

- [bin/cli.ts](bin/cli.ts) - Added `--image-tag` CLI option
- [bin/cdk-dev.js](bin/cdk-dev.js) - New dev deployment script
- [lib/utils/config.ts](lib/utils/config.ts) - Added imageTag config field
- [lib/benchling-webhook-stack.ts](lib/benchling-webhook-stack.ts) - Pass imageTag to Fargate service
- [lib/fargate-service.ts](lib/fargate-service.ts) - Use imageTag prop
- [bin/benchling-webhook.ts](bin/benchling-webhook.ts) - Pass imageTag to stack
- [bin/commands/deploy.ts](bin/commands/deploy.ts) - Display imageTag in deployment plan
- [package.json](package.json) - Added `cdk:dev` npm script
