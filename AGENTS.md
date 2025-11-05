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
npm run test:dev             # Verify dev deployment works
```

#### Release (maintainers only)

```bash
npm run version:tag          # Create version tag (triggers CI)
# Wait for CI to build and test
npm run deploy:prod --quilt-stack-arn <arn> --benchling-secret <name> --yes
# Production tests run automatically after deploy:prod completes
```

### Git & GitHub (via `gh` CLI)

```bash
gh pr create                 # Create pull request
gh pr list                   # List your PRs
gh pr view                   # View PR details
gh pr checks                 # Check CI status

gh issue create -t "TITLE" -b "BODY"                     # Create an issue
gh issue list --label "bug"                              # List issues (filterable)
gh issue view <number>                                   # View issue details
gh issue comment <number> -b "COMMENT"                   # Add a comment to an issue
gh issue close <number>                                  # Close an issue

gh workflow list                                          # List GitHub Actions workflows
gh workflow view <workflow.yml>                          # Show workflow details
gh workflow run <workflow.yml> --ref main                # Trigger a workflow run
gh run list --workflow=<workflow.yml> --branch main      # List recent runs for a workflow
gh run view <run-id>                                     # View run status and logs
gh run rerun <run-id>                                    # Rerun a workflow run
gh run watch <run-id>                                    # Stream run logs
gh run download <run-id> --dir ./artifacts               # Download run artifacts
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
- [bin/version.ts](bin/version.ts) - Version management and release tagging (`npm run version`)
- [bin/dev-deploy.ts](bin/dev-deploy.ts) - Dev deployment workflow
- [bin/check-logs.ts](bin/check-logs.ts) - CloudWatch log viewer
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

### Single-Stack Multi-Environment Design

AWS CDK application deploying auto-scaling webhook processor with support for parallel dev and production environments:

```
Single AWS Stack: BenchlingWebhookStack
├── API Gateway (shared)
│   ├── Stage: dev  → https://xxx.execute-api.us-east-1.amazonaws.com/dev/*
│   └── Stage: prod → https://xxx.execute-api.us-east-1.amazonaws.com/prod/*
│
├── ALB (shared)
│   ├── Target Group: dev-targets  → Routes to dev ECS service
│   └── Target Group: prod-targets → Routes to prod ECS service
│
├── ECS Cluster: benchling-webhook-cluster (shared)
│   ├── Service: benchling-webhook-dev
│   │   ├── Task Definition: dev (imageTag: latest)
│   │   ├── Secret: quiltdata/benchling-webhook/dev/tenant
│   │   └── Auto-scaling: 1-3 tasks
│   │
│   └── Service: benchling-webhook-prod
│       ├── Task Definition: prod (imageTag: v0.6.3)
│       ├── Secret: quiltdata/benchling-webhook/default/tenant
│       └── Auto-scaling: 2-10 tasks
│
├── VPC (shared)
├── S3 → Payload and package storage
├── SQS → Quilt package creation queue
├── Secrets Manager → Environment-specific Benchling OAuth credentials
└── CloudWatch → Logging and monitoring (per-service logs)
```

**Request Flow:**
```
Benchling → API Gateway (stage: dev/prod) → ALB → Target Group → ECS Service → S3 + SQS
```

**Key Benefits:**
- Cost-effective: Shared ALB, NAT Gateway, VPC (~15-45% increase vs separate stacks)
- Isolated: Separate containers, secrets, and target groups per environment
- Flexible: Different Benchling apps and Quilt stacks per environment
- Simple: Single CloudFormation stack to manage

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
npm run test:dev             # Dev deployment integration (auto-deploys if needed)
npm run test:prod            # Production deployment integration (via API Gateway)

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
- **CI/CD**: `npm run test:dev` (auto-deploys dev stack if needed, then tests)
- **After production deploy**: `npm run test:prod` (runs automatically via deploy:prod)
- **Debugging only**: Individual test commands or Docker make targets

### Environment-Specific Testing

Tests automatically use the correct endpoint based on profile:

```bash
# Test dev environment
npm run test:dev              # Uses endpoint from deploy.json["dev"]

# Test prod environment
npm run test:prod             # Uses endpoint from deploy.json["prod"]
```

### Auto-Deployment (v0.6.3+)

`npm run test:dev` now automatically deploys when:

- No `deploy.json` exists
- No `dev` section in `deploy.json`
- Python source files are newer than deployment timestamp

Disable with `SKIP_AUTO_DEPLOY=1 npm run test:dev`

---

## Configuration (v0.6.0+)

### XDG Configuration Model

#### Single Source of Truth

- User settings stored in `~/.config/benchling-webhook/`
- Avoids `.env` files and environment variable pollution
- Secrets synced to AWS Secrets Manager

#### Configuration Structure

```
~/.config/benchling-webhook/
├── default.json    # Production profile (required)
├── dev.json        # Development profile (optional)
└── deploy.json     # Deployment tracking (both environments)
```

#### Profile: default.json (Production)

```json
{
  "profile": "default",
  "benchlingTenant": "my-company",
  "benchlingAppDefinitionId": "app_PROD_12345",
  "benchlingClientId": "client_xyz",
  "benchlingClientSecret": "secret_abc",
  "quiltStackArn": "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-prod/...",
  "benchlingSecret": "quiltdata/benchling-webhook/default/my-company",
  "imageTag": "0.6.3"
}
```

#### Profile: dev.json (Development, Optional)

```json
{
  "profile": "dev",
  "benchlingTenant": "my-company",
  "benchlingAppDefinitionId": "app_DEV_67890",
  "benchlingClientId": "client_xyz",
  "benchlingClientSecret": "secret_abc",
  "quiltStackArn": "arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/...",
  "benchlingSecret": "quiltdata/benchling-webhook/dev/my-company",
  "imageTag": "latest"
}
```

**Key Differences:**
- `benchlingAppDefinitionId`: Different app IDs allow side-by-side Benchling apps
- `quiltStackArn`: Can point to different Quilt environments
- `benchlingSecret`: Different secrets in Secrets Manager
- `imageTag`: Dev uses `latest`, prod uses semantic versions

#### Deployment Tracking: deploy.json

```json
{
  "dev": {
    "endpoint": "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
    "imageTag": "latest",
    "deployedAt": "2025-11-04T12:00:00.000Z",
    "stackName": "BenchlingWebhookStack",
    "stage": "dev"
  },
  "prod": {
    "endpoint": "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
    "imageTag": "0.6.3",
    "deployedAt": "2025-11-04T12:00:00.000Z",
    "stackName": "BenchlingWebhookStack",
    "stage": "prod"
  }
}
```

#### Configuration Flow

1. `npm run setup` prompts for settings → stores in XDG
2. npm scripts read from XDG for CDK operations
3. Secrets synced to AWS Secrets Manager
4. Deployment outputs written back to XDG config

### Setup Commands

```bash
npm run setup                # Interactive wizard (one-time setup)
npm run setup:profile dev    # Create dev profile (interactive)
npm run setup:infer          # Infer Quilt config from catalog
npm run setup:sync-secrets   # Sync secrets to AWS Secrets Manager
npm run setup:health         # Validate configuration
```

### Profile Management

```bash
# Create new profile
npm run setup:profile <name>         # Interactive profile creation

# Use specific profile
npm run deploy:dev --profile dev     # Deploy using dev profile
npm run deploy:prod --profile default # Deploy using default profile
npm run test:dev --profile dev       # Test using dev profile
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
npm run version:tag          # Creates version tag, pushes to GitHub
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

### Multi-Environment Workflow Examples

#### Example 1: End Users (Production Only)

```bash
# Setup (one-time)
npm run setup

# Deploy production
npm run deploy:prod

# Test production
npm run test:prod
```

No profile awareness needed - uses `default` profile automatically.

#### Example 2: Maintainers (Dev + Production)

```bash
# Initial setup (one-time)
npm run setup                      # Create production profile
npm run setup:profile dev          # Create dev profile

# Edit ~/.config/benchling-webhook/dev.json
# - Set benchlingAppDefinitionId: "app_DEV_67890"
# - Set imageTag: "latest"

# Deploy both environments
npm run deploy:dev --profile dev   # Deploy dev stage
npm run deploy:prod                # Deploy prod stage

# Both environments running simultaneously!
npm run test:dev                   # Test dev stage
npm run test:prod                  # Test prod stage
```

#### Example 3: Testing Changes Before Production

```bash
# Make code changes
git checkout -b feature/new-feature

# Deploy to dev for testing
npm run deploy:dev --profile dev
npm run test:dev

# After validation, deploy to production
npm run deploy:prod
npm run test:prod
```

---

## Monitoring & Debugging

### Logs

```bash
# View logs for all services
aws logs tail /ecs/benchling-webhook --follow

# View logs for specific environment
aws logs tail /ecs/benchling-webhook-dev --follow
aws logs tail /ecs/benchling-webhook-prod --follow
```

### Health Checks

- `/health` - General health
- `/health/ready` - Readiness probe

### Metrics

- CloudWatch: ECS tasks, API Gateway, ALB health (per-service metrics)
- Deployment outputs: `~/.config/benchling-webhook/deploy.json`

### Environment-Specific Endpoints

```bash
# Get dev endpoint
jq -r '.dev.endpoint' ~/.config/benchling-webhook/deploy.json

# Get prod endpoint
jq -r '.prod.endpoint' ~/.config/benchling-webhook/deploy.json
```

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
| Profile not found | Dev profile missing | Only deploy prod stage; prompt to create profile |
| Wrong profile for environment | User error | Validate profile matches target environment |

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
- **Environment Isolation**: Separate containers, secrets, and logs per environment

---

## Security

- Secrets in AWS Secrets Manager (separate secrets per environment)
- IP-based access control (API Gateway)
- Container scanning (ECR)
- Least-privilege IAM roles (per-service)
- TLS 1.2+ encryption
- Network isolation via separate target groups

### Security Considerations for Multi-Environment

**Isolation Levels:**
- Separate ECS services (different containers)
- Separate IAM roles (least privilege)
- Separate Secrets Manager secrets (dev/prod isolation)
- Separate target groups (network isolation)
- Separate CloudWatch logs (audit trail)

**Acceptable Trade-offs:**
- Shared VPC (cost optimization)
- Shared ECS cluster (cost optimization)
- Same AWS account (not multi-account compliance)

**Recommendation:** For strict compliance requirements, use separate AWS accounts (existing approach still supported).

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
