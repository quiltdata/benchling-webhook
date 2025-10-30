# Development Deployment Workflow

This document describes how to deploy a development version of the Benchling webhook stack using a specific Docker image tag.

## Overview

The `cdk:dev` workflow allows you to:
1. Create a timestamped development git tag (e.g., `v0.5.3-20251030T123456Z`)
2. Build and push a Docker image with that tag to ECR
3. Deploy a CDK stack that uses that specific image instead of `latest`

This is useful for testing changes before making a production release.

## Quick Start

```bash
npm run cdk:dev
```

This single command will:
- ✅ Check for uncommitted changes (must have clean working directory)
- ✅ Create a dev git tag with timestamp
- ✅ Push the tag to origin
- ✅ Build and push Docker image to ECR with the dev tag
- ✅ Deploy CDK stack using the dev image tag

## Manual Usage

If you need more control, you can run the steps manually:

### 1. Create and push a dev tag

```bash
npm run release:dev
```

This creates a tag like `v0.5.3-20251030T123456Z` and pushes it to GitHub.

### 2. Build and push Docker image with specific tag

```bash
cd docker
make push-local VERSION=v0.5.3-20251030T123456Z
cd ..
```

### 3. Deploy with specific image tag

```bash
npx @quiltdata/benchling-webhook deploy --image-tag v0.5.3-20251030T123456Z --yes
```

Or using the CLI shorthand:

```bash
npm run cli -- --image-tag v0.5.3-20251030T123456Z --yes
```

## Image Tag Configuration

The image tag can be specified in multiple ways (in order of precedence):

1. **CLI flag**: `--image-tag dev`
2. **Environment variable**: `IMAGE_TAG=dev` in `.env`
3. **Default**: `latest`

## Examples

### Deploy using a specific dev version

```bash
npm run cli -- --image-tag v0.5.3-20251030T123456Z --yes
```

### Deploy using latest

```bash
npm run cli -- --yes
# or
npm run cli -- --image-tag latest --yes
```

### Set image tag in .env file

```bash
echo "IMAGE_TAG=v0.5.3-20251030T123456Z" >> .env
npm run cli -- --yes
```

## How It Works

### Git Tags

The dev workflow creates timestamped git tags to ensure uniqueness:
- Format: `v{version}-{timestamp}`
- Example: `v0.5.3-20251030T123456Z`
- Timestamp format: ISO 8601 without separators

### Docker Images

Images are pushed to ECR with multiple tags:
- Version tag: `quiltdata/benchling-arm64:v0.5.3-20251030T123456Z`
- Latest tag: `quiltdata/benchling-arm64:latest`

The architecture suffix (`-arm64` or `-amd64`) is automatically added based on your system.

### CDK Deployment

The CDK stack uses the specified image tag when creating the ECS Fargate service. The image tag is passed through:
1. CLI option → Config → Stack props → Fargate service

## Architecture

```
┌──────────────────┐
│  npm run cdk:dev │
└────────┬─────────┘
         │
         ├─ 1. Create dev tag (v0.5.3-{timestamp})
         ├─ 2. Push tag to GitHub
         ├─ 3. Build & push Docker image with tag
         └─ 4. Deploy CDK with --image-tag
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

Make sure the image was successfully pushed to ECR:

```bash
cd docker
make push-local VERSION=v0.5.3-20251030T123456Z
```

Check ECR repositories:

```bash
aws ecr describe-repositories --region us-east-1
aws ecr list-images --repository-name quiltdata/benchling-arm64 --region us-east-1
```

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
