# Release Notes - v0.4.12

## Benchling Webhook Integration for Quilt

Serverless webhook processor that connects Benchling lab notebook entries to Quilt data packages, enabling seamless data versioning and tracking for scientific workflows.

### Docker Images

**Latest Release (v0.4.12):**
- Production: `public.ecr.aws/quiltdata/benchling:0.4.12`
- Latest: `public.ecr.aws/quiltdata/benchling:latest`

## What's New in v0.4.12

### Added
- Dev release workflow with timestamped pre-release tags for testing CI/CD pipeline

### Changed
- Refactored release script to separate version bumping from tag creation
- version.js now outputs just the version number when called with no arguments

## Architecture Overview

This AWS CDK application deploys a highly available, auto-scaling webhook processor using:

- **Amazon API Gateway** → Routes HTTPS webhooks with IP-based access control
- **Application Load Balancer (ALB)** → Distributes traffic across container instances
- **AWS Fargate on Amazon ECS** → Runs containerized webhook processor (auto-scales 2-10 tasks)
- **Amazon S3** → Stores webhook payloads and package data
- **Amazon SQS** → Queues package creation requests for Quilt
- **AWS Secrets Manager** → Securely stores Benchling OAuth credentials
- **Amazon CloudWatch** → Provides centralized logging and monitoring
- **AWS IAM** → Enforces least-privilege access controls

## Prerequisites

- **AWS Account** with appropriate IAM permissions
- **AWS CLI** v2.x configured with credentials
- **Node.js** >= 18.0.0
- **Docker** for container builds
- **Quilt Stack** deployed with S3 bucket and SQS queue configured
- **Benchling Account** with app creation permissions

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install
```

### 2. Configure Environment

```bash
cp env.template .env
```

Edit `.env` with your configuration:

| Variable | Required | Description |
|----------|----------|-------------|
| `CDK_DEFAULT_ACCOUNT` | ✅ | AWS Account ID (12 digits) |
| `CDK_DEFAULT_REGION` | ✅ | AWS Region (e.g., `us-east-1`) |
| `BUCKET_NAME` | ✅ | S3 bucket connected to Quilt |
| `QUEUE_NAME` | ✅ | SQS queue from Quilt stack |
| `BENCHLING_TENANT` | ✅ | Benchling subdomain (e.g., `myorg` from `myorg.benchling.com`) |
| `BENCHLING_CLIENT_ID` | ✅ | OAuth client ID from Benchling app |
| `BENCHLING_CLIENT_SECRET` | ✅ | OAuth client secret from Benchling app |
| `QUILT_DATABASE` | ✅ | Athena database name for Quilt catalog |
| `WEBHOOK_ALLOW_LIST` | ⚪ | Comma-separated IP allowlist |
| `PREFIX` | ⚪ | S3 key prefix (default: `benchling`) |
| `QUILT_CATALOG` | ⚪ | Quilt catalog URL (default: `open.quiltdata.com`) |

### 3. Deploy Infrastructure

```bash
# Bootstrap CDK (first time only)
source .env
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION

# Deploy stack
npm run deploy
```

The webhook URL will be saved to `.env.deploy`:

```bash
WEBHOOK_ENDPOINT=https://abc123.execute-api.us-east-1.amazonaws.com/prod
```

## Post-Deployment Configuration

### Configure Benchling App

1. **Create App**: Benchling → Developer Console → Apps → Create app → From manifest
2. **Upload Manifest**: Use `app-manifest.yaml` from this repository
3. **Set Credentials**: Create Client Secret → Copy ID and Secret to `.env`
4. **Configure Webhook**: Overview → Webhook URL → Paste URL from `.env.deploy`
5. **Install App**: Version History → Install → Activate
6. **Grant Permissions**: Tenant Admin → Organizations → Apps → Add app → Set role to Admin

### Verify Deployment

```bash
# Health check
source .env.deploy
curl $WEBHOOK_ENDPOINT/health

# Monitor logs
aws logs tail /ecs/benchling-webhook --follow
```

## Usage

1. **Create Entry** in Benchling notebook
2. **Insert Canvas** → Select "Quilt Integration"
3. **Create Package** → Generates versioned Quilt package
4. **Add Files** → Attach experimental data
5. **Update Package** → Creates new version with attachments

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