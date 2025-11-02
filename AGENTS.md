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

## 2. Architecture Principles (v0.6.0+)

### 2.0 Technology Stack

- **Makefile** → Top-level orchestration (environment-agnostic)
- **npm** → CDK infrastructure and implementation scripts
- **Python** → Docker container application
- **XDG** → Configuration storage (`~/.config/benchling-webhook/`)

### 2.1 Configuration Model

**XDG-Compliant Storage:**
- User settings stored in `~/.config/benchling-webhook/default.json`
- Avoids `.env` files and environment variable pollution
- Single source of truth for credentials and deployment artifacts

**Configuration Flow:**
1. `make install` prompts for user settings → stores in XDG
2. npm scripts read from XDG for CDK operations
3. Secrets synced to AWS Secrets Manager
4. Deployment outputs written back to XDG config

---

## 3. Ideal Developer Workflow

### 3.1 One-Command Bootstrap

```bash
make install
```

This command must:

1. Install Node.js and Python dependencies
2. Create XDG-compliant folder (`~/.config/benchling-webhook/`)
3. Auto-infer Quilt catalog from `~/.quilt3/config.yml` (or prompt)
4. Prompt interactively for Benchling credentials (tenant, client ID/secret, app definition ID)
5. Validate Benchling credentials and bucket access
6. Create or sync secrets to AWS Secrets Manager
7. Generate `~/.config/benchling-webhook/default.json` with QuiltStackArn and BenchlingSecretArn

If any step fails validation, the script exits with explicit diagnostics (e.g., "Cannot find Quilt catalog in ~/.quilt3/config.yml").

### 3.2 Daily Development Loop

```bash
make test
```

- **Lint** → `npm run lint` + `make -C docker lint`
- **Typecheck** → Verifies TS interfaces
- **Unit tests** → Mocked tests for TypeScript and Python
- **Code quality** → Confirms local functional correctness

Commits follow `type(scope): summary` and PRs must include:

- Verified local tests (`make test`)
- Integration test results (`make test-local`)
- Deployment notes or configuration deltas

---

## 4. Testing Tiers

### 4.1 Unit Tests (`make test`)

- Runs linters for TypeScript and Python
- Executes mocked unit tests (no external dependencies)
- Validates code quality and local correctness

**Commands:**
- TypeScript: `npm run test:ts`
- Python: `make -C docker test-unit`

### 4.2 Local Integration (`make test-local`)

- Builds local Docker image (`make -C docker build`)
- Pulls credentials from AWS Secrets Manager
- Runs Flask webhook with **real Benchling payloads**
- Tests end-to-end flow without cloud deployment

### 4.3 Remote Integration (`make test-remote`)

CI workflow:
1. Build and push **dev** Docker image to ECR (not `latest`)
2. CDK synthesizes and deploys **dev stack** (isolated)
3. Execute remote integration tests: API Gateway → ALB → Fargate → S3/SQS
4. Validate secrets, IAM roles, and networking across deployed stack

### 4.4 Release (`make release`)

Production promotion (CI-only):
1. Called after successful `make test-remote`
2. Promotes verified image + stack to **production**
3. Generates `deploy.json` with endpoint, image URI, and stack outputs

### 4.5 Tagging (`make tag`)

Version management:
- Creates and pushes version tag (triggers release pipeline)
- Tags Docker image and CDK stack: `benchling-webhook:vX.Y.Z`

---

## 5. Secret Environment Variables

**Required secrets** (stored in AWS Secrets Manager and XDG config):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BENCHLING_APP_DEFINITION_ID` | Yes | - | Benchling app identifier |
| `BENCHLING_CLIENT_ID` | Yes | - | OAuth client ID |
| `BENCHLING_CLIENT_SECRET` | Yes | - | OAuth client secret |
| `BENCHLING_PKG_BUCKET` | Yes | - | S3 bucket for packages |
| `BENCHLING_TENANT` | Yes | - | Benchling tenant name |
| `BENCHLING_TEST_ENTRY` | No | - | Test entry ID for validation |
| `BENCHLING_ENABLE_WEBHOOK_VERIFICATION` | No | `true` | Enable signature verification |
| `BENCHLING_LOG_LEVEL` | No | `INFO` | Python logging level |
| `BENCHLING_PKG_KEY` | No | `experiment_id` | Package metadata key |
| `BENCHLING_PKG_PREFIX` | No | `benchling` | S3 key prefix |
| `BENCHLING_WEBHOOK_ALLOW_LIST` | No | `""` | IP allowlist (comma-separated) |

---

## 6. Configuration Failure Modes

| Failure | Cause | Mitigation |
|----------|--------|-------------|
| Missing Quilt catalog | Quilt3 not configured | Prompt user to run `quilt3 config` and retry |
| XDG config corrupted | Manual file edit | Validate JSON schema on read; re-run `make install` |
| AWS auth error | Invalid credentials | Check `AWS_PROFILE` and region before operations |
| Docker build failure | Outdated base image | Auto-pull latest base before build |
| Secrets not synced | Secrets Manager unreachable | Validate IAM permissions; retry sync with backoff |
| CDK stack drift | Manual AWS changes | Run `cdk diff` preflight; warn on drift detection |
| Missing secret variables | Incomplete `make install` | Schema validation before secrets sync |

---

## 7. Operational Principles

- **Single Source of Truth:** XDG config defines the environment
- **Fail Fast:** Validation before deployment prevents partial stacks
- **Idempotence:** Re-running `make install` never breaks working setup
- **Observability:** Every stage logs explicit diagnostics to CloudWatch
- **Separation of Concerns:** Makefile orchestrates, npm/Python implement

---

## 8. Future Goals

- Interactive configuration assistant with self-healing defaults
- Declarative environment lockfile (`benchling.env.json`)
- Integrated smoke tests for cross-service health
- Automatic credential rotation via Secrets Manager
