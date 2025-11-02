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

# Benchling Webhook Agents Guide (CLAUDE.md)

## 1. Mission

Define the optimal workflow for development, testing, and deployment of the Benchling Webhook system, ensuring predictable automation and resilience to configuration errors.

---

## 2. Ideal Developer Workflow

### 2.1 One-Command Bootstrap

Developers should be able to run:

```bash
npx @quiltdata/benchling-webhook
```

This command must:

1. Detect the Quilt3 catalog and infer stack parameters.
2. Validate AWS and Docker environments.
3. Prompt interactively for Benchling credentials.
4. Generate `.env` and `.env.deploy` with all required fields.

If any inferred value fails validation, the script exits with explicit diagnostics (e.g., “Cannot find Quilt catalog in ~/.quilt3/config.yml”).

### 2.2 Daily Development Loop

```bash
npm run build && npm run lint && npm run typecheck
make -C docker test-local
```

- **Lint** → ensures code quality.
- **Typecheck** → verifies interfaces between TS & Python layers.
- **Local tests** → run Flask service with simulated Benchling payloads.

Commits follow `type(scope): summary` and PRs must include:

- Verified local tests
- Deployment notes or configuration deltas

---

## 3. Testing Tiers

### 3.1 Unit Tests

- TypeScript: `npm run test:ts`
- Python: `make -C docker test-unit`

### 3.2 Integration Tests

- Local Docker validation: `make -C docker test-local`
- ECR validation: `make -C docker test-ecr`

### 3.3 System Tests

- `npm run cdk:dev` to deploy isolated stack.
- `make -C docker test-integration` to verify cross-stack events.

### 3.4 CI/CD Pipeline

Automated steps:

1. Lint and typecheck
2. Run tests and build image
3. Push to ECR
4. Deploy via CDK if all checks pass

---

## 4. Configuration Failure Modes

| Failure | Cause | Mitigation |
|----------|--------|-------------|
| Missing Quilt catalog | Quilt3 not configured | Prompt user to run `quilt3 config` and retry |
| Incomplete `.env` | Skipped prompt step | Add schema validation before deploy |
| AWS auth error | Invalid credentials | Check AWS_PROFILE and region before CDK deploy |
| Docker build failure | Outdated base image | Auto-pull latest base before build |
| Secrets not found | Not synced to AWS Secrets Manager | Run `npm run secrets:sync` automatically before deploy |
| CDK stack drift | Manual AWS changes | Add drift detection preflight via `cdk diff` |

---

## 5. Operational Principles

- **Single Source of Truth:** Quilt catalog defines the environment.
- **Fail Fast:** Validation before deployment prevents partial stacks.
- **Idempotence:** Re-running bootstrap should never break a working setup.
- **Observability:** Every stage logs explicit diagnostics to CloudWatch.

---

## 6. Future Goals

- Interactive configuration assistant with self-healing defaults.
- Declarative environment lockfile (`benchling.env.json`).
- Integrated smoke tests for cross-service health.
