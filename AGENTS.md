# Benchling Webhook - Developer & Agent Guide

## Quick Start: Daily Development Workflow

### Essential Commands

#### Setup (one-time)

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm run setup                # Interactive wizard: deps + XDG config + secrets
```

#### Daily development

```bash
npm run test                 # Fast unit tests (lint + typecheck + mocked tests)
npm run test:local           # Local Docker integration (when needed)
```

#### Before creating PR

```bash
npm run test:local           # Verify integration works
git commit -m "type(scope): description"
gh pr create
npm run test:remote           # Verify deployment works
```

#### Release (maintainers only)

```bash
npm run release:tag          # Create version tag (triggers CI)
# Wait for CI to build and test
npm run deploy:prod --quilt-stack-arn <arn> --benchling-secret <name> --yes
```

### Git & GitHub (via `gh` CLI)

```bash
gh pr create                 # Create pull request
gh pr list                   # List your PRs
gh pr view                   # View PR details
gh pr checks                 # Check CI status
```

---

## Code Organization

### Infrastructure & Build

#### `lib/` — CDK infrastructure constructs (TypeScript)

- [lib/benchling-webhook-stack.ts](lib/benchling-webhook-stack.ts) - Main orchestration
- [lib/fargate-service.ts](lib/fargate-service.ts) - ECS Fargate service
- [lib/alb-api-gateway.ts](lib/alb-api-gateway.ts) - API Gateway + ALB
- [lib/ecr-repository.ts](lib/ecr-repository.ts) - Docker registry
- [lib/xdg-config.ts](lib/xdg-config.ts) - XDG configuration management
- [lib/types/](lib/types/) - TypeScript type definitions

### CLI & Automation

#### `bin/` — Executable CLI tools & automation scripts (JavaScript/TypeScript)

- [bin/cli.ts](bin/cli.ts) - Main CLI entry point (`benchling-webhook` command)
- [bin/version.js](bin/version.js) - Version management (`npm run version`)
- [bin/release.js](bin/release.js) - Release automation
- [bin/dev-deploy.ts](bin/dev-deploy.ts) - Dev deployment workflow
- [bin/check-logs.js](bin/check-logs.js) - CloudWatch log viewer
- [bin/send-event.js](bin/send-event.js) - Test event sender
- [bin/commands/](bin/commands/) - CLI command implementations

### Setup & Configuration

#### `scripts/` — Interactive setup & configuration scripts (TypeScript, run via ts-node)

- [scripts/install-wizard.ts](scripts/install-wizard.ts) - Interactive setup wizard (`npm run setup`)
- [scripts/infer-quilt-config.ts](scripts/infer-quilt-config.ts) - Quilt catalog inference (`npm run setup:infer`)
- [scripts/sync-secrets.ts](scripts/sync-secrets.ts) - AWS Secrets Manager sync (`npm run setup:sync-secrets`)
- [scripts/config-health-check.ts](scripts/config-health-check.ts) - Configuration validation (`npm run setup:health`)

### Application

#### `docker/` — Flask webhook processor (Python)

- See [docker/README.md](docker/README.md) for details

#### Key Distinction

##### `bin/` — CLI tools & compiled scripts (production runtime, often `.js`)

##### `scripts/` — Development-time setup scripts (TypeScript, via ts-node)

---

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

---

## Testing Strategy

### The Single Path (Use This)

```bash
# 1. Fast feedback during development
npm run test                 # Unit tests: lint + typecheck + mocked tests (30 seconds)

# 2. Verify integration before PR
npm run test:local           # Local Docker + real Benchling (2 minutes)

# 3. CI verifies remote deployment
# (Automatic on PR - deploys dev stack, tests via API Gateway)
```

### Available Test Commands

```bash
# Primary workflow
npm run test                 # All unit tests (lint + typecheck + TS + Python)
npm run test:local           # Local integration (Docker + real Benchling)
npm run test:remote          # Remote integration (deploy dev + test API Gateway)

# Individual components (for debugging)
npm run build:typecheck      # TypeScript type checking only
npm run test:ts              # Jest tests only
npm run test:python          # Python unit tests only
npm run lint                 # Linting and auto-fix

# Low-level Docker commands (rarely needed)
make -C docker test-unit     # Python unit tests
make -C docker test-local    # Local Flask server
make -C docker test-ecr      # ECR image validation
```

### When to Use What

- **Daily development**: `npm run test` (fast, no external deps)
- **Before committing**: `npm run test` + verify changes work
- **Before PR**: `npm run test:local` (ensure integration works)
- **CI/CD**: `npm run test:remote` (full deployment test)
- **Debugging only**: Individual test commands or Docker make targets

---

## Configuration (v0.6.0+)

### XDG Configuration Model

#### Single Source of Truth

- User settings stored in `~/.config/benchling-webhook/default.json`
- Avoids `.env` files and environment variable pollution
- Secrets synced to AWS Secrets Manager

#### Configuration Flow

1. `npm run setup` prompts for settings → stores in XDG
2. npm scripts read from XDG for CDK operations
3. Secrets synced to AWS Secrets Manager
4. Deployment outputs written back to XDG config

### Setup Commands

```bash
npm run setup                # Interactive wizard (one-time setup)
npm run setup:infer          # Infer Quilt config from catalog
npm run setup:sync-secrets   # Sync secrets to AWS Secrets Manager
npm run setup:health         # Validate configuration
```

### Required Secrets

Stored in AWS Secrets Manager and XDG config:

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

## Deployment Workflows

### Development Deployment

```bash
npm run deploy:dev           # Test + build + deploy dev stack + verify
```

This runs:

1. `npm run test` - Fast unit tests
2. Build and push dev Docker image
3. Deploy to dev stack
4. Run integration tests

### Production Release

#### Step 1: Tag and trigger CI

```bash
npm run release:tag          # Creates version tag, pushes to GitHub
```

This triggers CI to:

- Run all tests
- Build production Docker image (x86_64)
- Push to ECR with version tag
- Publish to npm
- Create GitHub release

#### Step 2: Deploy to production

```bash
npm run deploy:prod -- \
  --quilt-stack-arn <arn> \
  --benchling-secret <name> \
  --image-tag <version> \
  --yes
```

### Local Release (Alternative)

```bash
npm run release              # Test + tag + Docker push (local only)
```

This runs:

1. `npm run test` - All unit tests
2. `node bin/release.js` - Create git tag
3. `make -C docker push-ci` - Build and push Docker image

---

## Monitoring & Debugging

### Logs

```bash
aws logs tail /ecs/benchling-webhook --follow
```

### Health Checks

- `/health` - General health
- `/health/ready` - Readiness probe

### Metrics

- CloudWatch: ECS tasks, API Gateway, ALB health
- Deployment outputs: `<XDG>/deploy/default.json` file

---

## Configuration Failure Modes

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

## Coding Standards

- **TypeScript**: 4-space indent, double quotes, trailing commas, required semicolons
- **Types**: Avoid `any`; explicit return types on exports
- **Commits**: Conventional format `type(scope): summary`
- **PRs**: Include test results and deployment notes

---

## Operational Principles

- **Single Source of Truth**: XDG config defines the environment
- **Fail Fast**: Validation before deployment prevents partial stacks
- **Idempotence**: Re-running `npm run setup` never breaks working setup
- **Observability**: Every stage logs explicit diagnostics to CloudWatch
- **Separation of Concerns**: npm orchestrates, TypeScript/Python implement

---

## Security

- Secrets in AWS Secrets Manager
- IP-based access control (API Gateway)
- Container scanning (ECR)
- Least-privilege IAM roles
- TLS 1.2+ encryption

---

## Prerequisites

- AWS Account with IAM permissions
- AWS CLI v2.x configured
- Node.js >= 18.0.0
- Docker
- Quilt Stack (S3 bucket + SQS queue)
- Benchling Account with app creation permissions

---

## License

Apache-2.0 - See [LICENSE](LICENSE) file for details
