# Benchling Webhook Integration - Complete Guide

Complete deployment and operational guide for the Benchling webhook integration with Quilt.

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

**Request Flow:** Benchling → API Gateway → ALB → Fargate (Flask app) → S3 + SQS

### Code Organization

- **Infrastructure (CDK)**: `bin/` and `lib/` contain TypeScript CDK code for AWS deployment
  - `lib/benchling-webhook-stack.ts` - Main stack orchestrating all components
  - `lib/fargate-service.ts` - ECS Fargate service running Flask in Docker
  - `lib/alb-api-gateway.ts` - API Gateway with HTTP integration to ALB
  - `lib/ecr-repository.ts` - Docker image repository
- **Application (Python)**: `docker/` contains Flask webhook processor
  - See [docker/README.md](docker/README.md) for application development

## Prerequisites

- **AWS Account** with appropriate IAM permissions
- **AWS CLI** v2.x configured with credentials
- **Node.js** >= 18.0.0
- **Docker** for container builds
- **Quilt Stack** deployed with S3 bucket and SQS queue configured
- **Benchling Account** with app creation permissions

## Installation

### 1. Clone and Install

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install
```

### 2. Configure Environment

#### Option A: Auto-infer from Quilt Catalog (Recommended)

If you have an existing Quilt deployment, you can automatically infer most configuration values:

```bash
# Infer config from your Quilt catalog
npm run get-env -- https://quilt-catalog.yourcompany.com --write

# Review the generated env.inferred file
cat env.inferred

# Copy to .env and fill in Benchling credentials
cp env.inferred .env
# Then edit .env to add your Benchling-specific values
```

The script will:

- Fetch `config.json` from your Quilt catalog
- Query AWS CloudFormation to find your Quilt stack
- Extract bucket names, queue names, region, and account ID
- Generate a `.env.inferred` file with pre-filled AWS/Quilt configuration

**Note:** You'll still need to manually add Benchling credentials (tenant, client ID, client secret, etc.).

#### Option B: Manual Configuration

```bash
cp env.template .env
```

Edit `.env` with your configuration:

**Required Variables** (you must provide these):

| Variable | Description |
|----------|-------------|
| `QUILT_CATALOG` | Quilt catalog URL (e.g., `quilt-catalog.yourcompany.com`) |
| `QUILT_USER_BUCKET` | Your S3 bucket for Benchling exports |
| `BENCHLING_TENANT` | Benchling subdomain (e.g., `myorg` from `myorg.benchling.com`) |
| `BENCHLING_CLIENT_ID` | OAuth client ID from Benchling app |
| `BENCHLING_CLIENT_SECRET` | OAuth client secret from Benchling app |
| `BENCHLING_API_KEY` | API key for Benchling access |
| `BENCHLING_APP_DEFINITION_ID` | App definition ID for webhook verification |

**Auto-Inferred Variables** (automatically determined from your Quilt catalog):

| Variable | How It's Inferred |
|----------|-------------------|
| `CDK_DEFAULT_ACCOUNT` | From AWS STS (your current account) |
| `CDK_DEFAULT_REGION` | From catalog config.json |
| `QUEUE_NAME` | From Quilt stack outputs |
| `SQS_QUEUE_URL` | From Quilt stack outputs |
| `QUILT_DATABASE` | From Quilt stack outputs |

**Optional Variables** (have sensible defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_ALLOW_LIST` | (empty) | Comma-separated IP allowlist |
| `PREFIX` | `benchling` | S3 key prefix |
| `ENABLE_WEBHOOK_VERIFICATION` | `true` | Verify webhook signatures |
| `ECR_REPOSITORY_NAME` | `quiltdata/benchling` | Custom ECR repo name |

See [doc/PARAMETERS.md](doc/PARAMETERS.md) for complete reference.

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

## Development

### Common Commands

**Development:**
- `npm run build` - Compile TypeScript
- `npm run test` - Run Jest tests
- `npm run lint` - Apply ESLint

**Deployment:**
- `npm run deploy` - Test + deploy (outputs to `.env.deploy`)
- `npm run docker-push` - Build and push Docker images
- `npm run docker-check` - Validate Docker images
- `npm run release` - Create production release

**Python App:**
- See [docker/README.md](docker/README.md) or run `make help` in docker/ directory

### Coding Style

- **TypeScript**: 4-space indent, double quotes, trailing commas, required semicolons
- **Types**: Avoid `any` in production; explicit return types on exports
- **Organization**: Separate CDK constructs in `lib/`; application code in `docker/`

### Commits & PRs

- Use Conventional Commits: `type(scope): summary`
- Keep commits focused; update `package-lock.json` when needed
- Include test results and deployment considerations in PRs

## Security Best Practices

- OAuth credentials stored in AWS Secrets Manager
- IP-based access control via API Gateway resource policies
- Container images scanned for vulnerabilities via Amazon ECR
- IAM roles follow least-privilege principle
- All traffic encrypted in transit (TLS 1.2+)
- CloudWatch logs encrypted at rest

## Monitoring & Troubleshooting

### Monitoring

- **CloudWatch Logs**: `/ecs/benchling-webhook`
- **ECS Task Metrics**: CPU, memory, task count
- **API Gateway Metrics**: Request count, latency, 4XX/5XX errors
- **ALB Target Health**: Monitor unhealthy targets

### Health Endpoints

- `/health` - General health check
- `/health/ready` - Readiness probe

### Debugging

- **Deployment**: Check `.env.deploy` for outputs
- **Logs**: `npm run logs` or `aws logs tail /ecs/benchling-webhook --follow`
- **Events**: `npm run event` to send test events

## License

Apache-2.0 - See [LICENSE](LICENSE) file for details
