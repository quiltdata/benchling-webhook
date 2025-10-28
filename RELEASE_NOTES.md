# Release Notes - v0.4.12

## Docker Images

**Latest Release (v0.4.12):**
- Production: `public.ecr.aws/quiltdata/benchling:0.4.12`
- Latest: `public.ecr.aws/quiltdata/benchling:latest`

## What's New in v0.4.12

### Added
- Dev release workflow with timestamped pre-release tags for testing CI/CD pipeline

### Changed
- Refactored release script to separate version bumping from tag creation
- version.js now outputs just the version number when called with no arguments

---

# Benchling Webhook Integration for Quilt

Connects Benchling lab notebook entries to Quilt data packages via webhooks.

## Quick Install

**Prerequisites:** AWS account, Node.js 18+, Docker, existing Quilt deployment

```bash
# 1. Clone and install
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install

# 2. Configure (auto-infer from Quilt catalog)
npm run infer-config -- https://your-catalog.quiltdata.com --write
cp .env.inferred .env
# Edit .env to add Benchling credentials

# 3. Deploy
source .env
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION  # first time only
npm run deploy

# 4. Configure Benchling app
# - Create app from app-manifest.yaml
# - Set webhook URL from .env.deploy
# - Install and activate

# 5. Verify
source .env.deploy
curl $WEBHOOK_ENDPOINT/health
```

## Usage

1. Create entry in Benchling
2. Insert Canvas → "Quilt Integration"
3. Click "Create" to make package
4. Add files and click "Update package"

## Documentation

- [AGENTS.md](AGENTS.md) - Complete deployment guide, architecture, configuration
- [docker/README.md](docker/README.md) - Development workflows
- [doc/RELEASE.md](doc/RELEASE.md) - Release process

## Recent Changes

### v0.4.11
- Added version synchronization test to ensure package.json, docker/pyproject.toml, and docker/app-manifest.yaml remain in sync
- app-manifest.yaml now published as GitHub release asset for Benchling App installations
- Fixed version bump script to update all three version files
- Fixed `docker-validate` to ensure ECR repository is publicly accessible

### v0.4.10
- Added Canvas error notification section to display warnings and errors to users
- Added Athena permissions to ECS task role for Quilt queries
- Fixed Canvas error handling for AWS permission issues

### v0.4.9
- Integrated release workflow into CI pipeline for automated GitHub releases
- Updated Python to 3.14 in CI workflows
- Streamlined release process with automated tagging and publishing

### v0.4.8
- **Infrastructure Migration**: Migrated from Lambda to Docker/Fargate for improved scalability
- **Improved Deployment**: Streamlined Docker-based deployment workflow
- **Enhanced Testing**: Added comprehensive test commands

## Security Best Practices

- OAuth credentials stored in AWS Secrets Manager
- IP-based access control via API Gateway resource policies
- Container images scanned for vulnerabilities via Amazon ECR
- IAM roles follow least-privilege principle
- All traffic encrypted in transit (TLS 1.2+)
- CloudWatch logs encrypted at rest

## Monitoring & Troubleshooting

- **CloudWatch Logs**: `/ecs/benchling-webhook`
- **ECS Task Metrics**: CPU, memory, task count
- **API Gateway Metrics**: Request count, latency, 4XX/5XX errors
- **ALB Target Health**: Monitor unhealthy targets

## Support

- **Issues**: [GitHub Issues](https://github.com/quiltdata/benchling-webhook/issues)
- **Documentation**: [Full Documentation](https://github.com/quiltdata/benchling-webhook)
- **Release History**: [CHANGELOG.md](CHANGELOG.md)

## License

Apache-2.0 - See [LICENSE](LICENSE) file for details