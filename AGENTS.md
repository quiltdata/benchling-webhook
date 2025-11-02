# Benchling Webhook Integration - Developer Guide

## Quick Start: Daily Development Workflow

### Essential Commands

**Git & GitHub** (via `gh` CLI):

```bash
gh pr create                  # Create pull request
gh pr list                    # List your PRs
gh pr view                    # View PR details
gh pr checks                  # Check CI status
```

**Test & Build:**

```bash
npm run test                  # Full test suite (TS + Python)
npm run typecheck            # TypeScript type checking only
make -C docker lint          # Auto-fix Python formatting
make -C docker test-unit     # Python unit tests
```

**Local Development:**

```bash
make -C docker test-local    # Test with local Flask server
npm run build                # Compile TypeScript
npm run lint                 # Apply ESLint
```

**Deploy:**

```bash
npm run deploy               # Full deployment (test + deploy)
npm run cdk:dev              # Dev deployment with timestamp
```

### Code Organization

- **Infrastructure (CDK)**: `bin/` + `lib/` - TypeScript AWS deployment
  - [lib/benchling-webhook-stack.ts](lib/benchling-webhook-stack.ts) - Main orchestration
  - [lib/fargate-service.ts](lib/fargate-service.ts) - ECS Fargate service
  - [lib/alb-api-gateway.ts](lib/alb-api-gateway.ts) - API Gateway + ALB
  - [lib/ecr-repository.ts](lib/ecr-repository.ts) - Docker registry
- **Application (Python)**: `docker/` - Flask webhook processor
  - See [docker/README.md](docker/README.md) for details

### Coding Standards

- **TypeScript**: 4-space indent, double quotes, trailing commas, required semicolons
- **Types**: Avoid `any`; explicit return types on exports
- **Commits**: Conventional format `type(scope): summary`
- **PRs**: Include test results and deployment notes

## Architecture

AWS CDK application deploying auto-scaling webhook processor:

- **API Gateway** → HTTPS webhook routing with IP filtering
- **ALB** → Load balancing across containers
- **Fargate (ECS)** → Flask app (auto-scales 2-10 tasks)
- **S3** → Payload and package storage
- **SQS** → Quilt package creation queue
- **Secrets Manager** → Benchling OAuth credentials
- **CloudWatch** → Logging and monitoring

**Flow:** Benchling → API Gateway → ALB → Fargate → S3 + SQS

## Setup & Installation

### Prerequisites

- AWS Account with IAM permissions
- AWS CLI v2.x configured
- Node.js >= 18.0.0
- Docker
- Quilt Stack (S3 bucket + SQS queue)
- Benchling Account with app creation permissions

### 1. Install

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install
```

### 2. Configure (Choose One)

**Option A: Auto-infer from Quilt Catalog** (Recommended)

```bash
npm run get-env -- https://quilt-catalog.yourcompany.com --write
cp env.inferred .env
# Edit .env to add Benchling credentials
```

**Option B: Manual**

```bash
cp env.template .env
# Edit .env with all values
```

**Required Variables:** `QUILT_CATALOG`, `QUILT_USER_BUCKET`, `BENCHLING_TENANT`, `BENCHLING_CLIENT_ID`, `BENCHLING_CLIENT_SECRET`, `BENCHLING_APP_DEFINITION_ID`

See [docs/PARAMETERS.md](docs/PARAMETERS.md) for complete reference.

### 3. Deploy

```bash
source .env
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION  # First time only
npm run deploy  # Creates .env.deploy with webhook URL
```

### 4. Configure Benchling App

1. Create app from `app-manifest.yaml`
2. Set webhook URL from `.env.deploy`
3. Copy credentials to `.env`
4. Install and grant admin permissions

### 5. Verify

```bash
source .env.deploy
curl $WEBHOOK_ENDPOINT/health
aws logs tail /ecs/benchling-webhook --follow
```

## Usage Flow

Entry → Insert Canvas → Quilt Integration → Create Package → Add Files → Update

## Testing Reference

### Quick Test Commands

```bash
npm run test                  # Full suite (TS + Python)
npm run typecheck            # TypeScript only
npm run test:ts              # Jest tests
make -C docker test-unit     # Python unit tests
make -C docker test-local    # Integration with local server
make -C docker test          # Full Python suite
```

### Test Workflows

**Local Development:**

```bash
make -C docker check-env && make -C docker install  # Setup
make -C docker lint && npm run typecheck            # Code quality
npm run test:ts && make -C docker test-unit         # Unit tests
make -C docker test-local                           # Integration
```

**CI/CD:**

```bash
npm run test-ci              # Fast TS checks
make -C docker test-unit     # Python tests
npm run docker-check         # Docker validation
make -C docker test-integration  # Full integration
```

**Pre-deployment:**

```bash
npm run test                 # All tests
make -C docker test          # Python suite
make -C docker test-ecr      # ECR image validation
```

### Additional Test Commands

See [docker/README.md](docker/README.md) or `make -C docker help` for:

- Credential verification (`test-benchling`, `test-query`)
- Health checks (`health-local`, `health-dev`, `health-prod`)
- Environment-specific tests (`test-dev`, `test-prod`, `test-ecr`)

## Monitoring & Debugging

**Logs:** `aws logs tail /ecs/benchling-webhook --follow`

**Health:** `/health` (general), `/health/ready` (readiness)

**Metrics:** CloudWatch for ECS tasks, API Gateway, ALB health

**Deployment:** Check `.env.deploy` for outputs

## Security

- Secrets in AWS Secrets Manager
- IP-based access control (API Gateway)
- Container scanning (ECR)
- Least-privilege IAM roles
- TLS 1.2+ encryption

## License

Apache-2.0 - See [LICENSE](LICENSE) file for details
