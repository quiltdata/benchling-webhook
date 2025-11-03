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

**Setup & Configuration:**

```bash
npm run setup                # Install deps + configure XDG + sync secrets
npm run setup:infer          # Infer Quilt config from catalog
npm run setup:sync-secrets   # Sync secrets to AWS Secrets Manager
npm run setup:health         # Validate configuration
```

**Test & Build:**

```bash
npm run test                 # Unit tests (lint + typecheck + mocked tests)
npm run test:local           # Local integration (Docker + real Benchling)
npm run test:remote          # Remote integration (deploy dev stack + test)
npm run build:typecheck      # TypeScript type checking only
npm run lint                 # Linting and formatting
npm run build                # Compile TypeScript
```

**Release:**

```bash
npm run release:tag          # Create version tag and push (triggers CI)
npm run release              # Promote to production (CI-only)
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
npm run setup  # Interactive wizard: deps + XDG config + secrets sync
```

This command:
- Installs Node.js and Python dependencies
- Creates XDG-compliant folder (`~/.config/benchling-webhook/`)
- Auto-infers Quilt catalog from `~/.quilt3/config.yml` (or prompts)
- Prompts for Benchling credentials (tenant, client ID/secret, app definition ID)
- Validates Benchling credentials and bucket access
- Creates or syncs secrets to AWS Secrets Manager
- Generates `~/.config/benchling-webhook/default.json` with QuiltStackArn and BenchlingSecretArn

### 2. Test Locally

```bash
npm run test        # Unit tests (lint + typecheck + mocked)
npm run test:local  # Integration with local Docker + real Benchling
```

### 3. Deploy

```bash
npm run test:remote  # Deploys dev stack, runs integration tests
npm run release      # Promotes to production (after tests pass)
```

### 4. Verify

```bash
# Configuration health check
npm run setup:health

# Check CloudWatch logs
aws logs tail /ecs/benchling-webhook --follow
```

## Usage Flow

Entry → Insert Canvas → Quilt Integration → Create Package → Add Files → Update

## Testing Reference

### Quick Test Commands

```bash
npm run test                 # Unit tests (lint + typecheck + TS + Python)
npm run test:local           # Local integration (build Docker + real Benchling)
npm run test:remote          # Remote integration (deploy dev + test via API Gateway)
npm run build:typecheck      # TypeScript type checking only
npm run test:ts              # Jest tests only
npm run test:python          # Python unit tests only
npm run lint                 # Linting and auto-fix
```

### Test Workflows

**Local Development:**

```bash
npm run setup              # One-time setup (deps + config + secrets)
npm run test                 # Fast unit tests (no Docker, no AWS)
npm run test:local           # Integration test with local Docker
```

**CI/CD:**

```bash
npm run test:ci              # Fast checks (typecheck + test:ts)
npm run test:remote          # Full remote integration (builds dev stack)
npm run release              # Promotes to production (after tests pass)
```

**Pre-deployment:**

```bash
npm run test                 # Verify local changes
npm run test:local           # Verify Docker + Benchling integration
npm run test:remote          # Verify full stack deployment
```

### Additional Test Commands

See [docker/README.md](docker/README.md) or `make -C docker help` for low-level Docker commands:

- `make -C docker test-unit` - Python unit tests only
- `make -C docker test-local` - Local Flask server integration
- `make -C docker test-ecr` - ECR image validation

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
npm run setup
```

This command:

1. Installs Node.js and Python dependencies
2. Creates XDG-compliant folder (`~/.config/benchling-webhook/`)
3. Auto-infers Quilt catalog from `~/.quilt3/config.yml` (or prompts)
4. Prompts interactively for Benchling credentials (tenant, client ID/secret, app definition ID)
5. Validates Benchling credentials and bucket access
6. Creates or syncs secrets to AWS Secrets Manager
7. Generates `~/.config/benchling-webhook/default.json` with QuiltStackArn and BenchlingSecretArn

If any step fails validation, the script exits with explicit diagnostics (e.g., "Cannot find Quilt catalog in ~/.quilt3/config.yml").

### 3.2 Daily Development Loop

```bash
npm run test
```

- **Lint** → `npm run lint` (includes `make -C docker lint`)
- **Typecheck** → Verifies TS interfaces
- **Unit tests** → Mocked tests for TypeScript and Python
- **Code quality** → Confirms local functional correctness

Commits follow `type(scope): summary` and PRs must include:

- Verified local tests (`npm run test`)
- Integration test results (`npm run test:local`)
- Deployment notes or configuration deltas

---

## 4. Testing Tiers

### 4.1 Unit Tests (`npm run test`)

- Runs linters for TypeScript and Python
- Executes mocked unit tests (no external dependencies)
- Validates code quality and local correctness

**Commands:**

- All: `npm run test` (lint + typecheck + test:ts + test:python)
- TypeScript: `npm run test:ts`
- Python: `npm run test:python`

### 4.2 Local Integration (`npm run test:local`)

- Builds local Docker image (`make -C docker build`)
- Pulls credentials from AWS Secrets Manager
- Runs Flask webhook with **real Benchling payloads**
- Tests end-to-end flow without cloud deployment

### 4.3 Remote Integration (`npm run test:remote`)

CI workflow:

1. Builds and pushes **dev** Docker image to ECR (not `latest`)
2. CDK synthesizes and deploys **dev stack** (isolated)
3. Executes remote integration tests: API Gateway → ALB → Fargate → S3/SQS
4. Validates secrets, IAM roles, and networking across deployed stack

### 4.4 Release (`npm run release`)

Production promotion (CI-only):

1. Called after successful `npm run test:remote`
2. Promotes verified image + stack to **production**
3. Generates `deploy.json` with endpoint, image URI, and stack outputs

### 4.5 Tagging (`npm run tag`)

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
| XDG config corrupted | Manual file edit | Validate JSON schema on read; re-run `npm run setup` |
| AWS auth error | Invalid credentials | Check `AWS_PROFILE` and region before operations |
| Docker build failure | Outdated base image | Auto-pull latest base before build |
| Secrets not synced | Secrets Manager unreachable | Validate IAM permissions; retry sync with backoff |
| CDK stack drift | Manual AWS changes | Run `cdk diff` preflight; warn on drift detection |
| Missing secret variables | Incomplete `npm run setup` | Schema validation before secrets sync |

---

## 7. Operational Principles

- **Single Source of Truth:** XDG config defines the environment
- **Fail Fast:** Validation before deployment prevents partial stacks
- **Idempotence:** Re-running `npm run setup` never breaks working setup
- **Observability:** Every stage logs explicit diagnostics to CloudWatch
- **Separation of Concerns:** npm orchestrates, TypeScript/Python implement

---

## 8. Future Goals

- Interactive configuration assistant with self-healing defaults
- Declarative environment lockfile (`benchling.env.json`)
- Integrated smoke tests for cross-service health
- Automatic credential rotation via Secrets Manager
