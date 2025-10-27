# Release Notes

## Version Format

Versions follow semantic versioning: `MAJOR.MINOR.PATCH`

Each release is tagged with:
- Git tag: `vX.Y.Z`
- Docker image: `ACCOUNT.dkr.ecr.REGION.amazonaws.com/quiltdata/benchling:X.Y.Z`
- Docker image: `ACCOUNT.dkr.ecr.REGION.amazonaws.com/quiltdata/benchling:latest`

## Current Release: v0.4.7

### Docker Image
- **Repository**: `712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling`
- **Tags**: `0.4.7`, `latest`
- **Architecture**: `linux/amd64`
- **Build Date**: 2025-10-26

### Changes
- Migrated from Lambda to Fargate for webhook processing
- Added ECR repository construct with public access configuration
- Enhanced deployment script with output capture to `.env.deploy`
- Added comprehensive Docker image management and health checking
- Improved CDK stack with better outputs and configuration options

### Infrastructure
- **Service**: AWS Fargate on ECS
- **API Gateway**: REST API with ALB integration
- **Auto-scaling**: 2-10 tasks based on CPU/Memory
- **Health Checks**: `/health` and `/health/ready` endpoints
- **Monitoring**: CloudWatch Container Insights enabled

### Deployment
```bash
# Deploy with the new deployment script
npm run deploy

# Or deploy with CDK directly
npm run cdk

# View deployment outputs
cat .env.deploy
```

### Docker Image Management
```bash
# Check ECR repository and image details
npm run docker-check

# Build and push new image
npm run docker-push

# Test image locally
npm run docker-health
```

## Release History

### v0.4.7 (2025-10-26)
- Fargate migration complete
- Docker image management improvements
- Enhanced deployment workflow

### Previous Versions
See git tags for complete history: `git tag -l`

## Creating a New Release

1. **Update Version**
   ```bash
   # Version is automatically synced from docker sync
   npm run docker-sync
   ```

2. **Build and Push Docker Image**
   ```bash
   npm run docker-push
   ```

3. **Verify Image**
   ```bash
   npm run docker-check
   ```

4. **Update Release Notes**
   - Update this file with changes
   - Include Docker image URI and tags
   - Document any breaking changes

5. **Create Git Tag**
   ```bash
   VERSION=$(node -e "console.log(require('./package.json').version)")
   git tag -a "v$VERSION" -m "Release v$VERSION"
   git push origin "v$VERSION"
   ```

6. **Deploy to Production**
   ```bash
   npm run deploy
   ```

## Docker Image Information by Release

| Version | Docker Tag | ECR URI | Release Date |
|---------|------------|---------|--------------|
| 0.4.7   | 0.4.7, latest | 712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:0.4.7 | 2025-10-26 |

## Rollback Procedure

To rollback to a previous version:

1. **Identify the version to rollback to**
   ```bash
   npm run docker-check
   ```

2. **Update the CDK stack to use the specific version**
   ```bash
   # Edit lib/benchling-webhook-stack.ts
   # Change: ecrImageUri = "...benchling:0.4.6"  # Use desired version
   ```

3. **Deploy the rollback**
   ```bash
   npm run deploy
   ```

## Support and Documentation

- **GitHub**: https://github.com/quiltdata/benchling-webhook
- **Issues**: https://github.com/quiltdata/benchling-webhook/issues
- **Documentation**: See README.md

## Breaking Changes

### v0.4.7
- Migrated from Lambda to Fargate (requires redeployment)
- New environment variables structure
- ECR repository configuration changes
