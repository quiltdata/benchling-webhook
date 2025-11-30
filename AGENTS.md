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
npm run test:native          # Local FastAPI (mocked) integration tests
```

#### Before creating PR

```bash
npm run test:native           # Verify integration works
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
- [lib/rest-api-gateway.ts](lib/rest-api-gateway.ts) - REST API v1 + VPC Link + Resource Policy
- [lib/network-load-balancer.ts](lib/network-load-balancer.ts) - Network Load Balancer with health checks
- [lib/ecr-repository.ts](lib/ecr-repository.ts) - Docker registry
- [lib/xdg-config.ts](lib/xdg-config.ts) - XDG configuration management
- [lib/types/](lib/types/) - TypeScript type definitions

### CLI & Automation

#### `bin/` — Executable CLI tools & automation scripts (JavaScript/TypeScript)

- [bin/cli.ts](bin/cli.ts) - Main CLI entry point (`benchling-webhook` command)
- [bin/version.ts](bin/version.ts) - Version management and release tagging (`npm run version`)
- [bin/dev-deploy.ts](bin/dev-deploy.ts) - Dev deployment workflow
- [bin/send-event.js](bin/send-event.js) - Test event sender
- [bin/commands/](bin/commands/) - CLI command implementations

### Setup & Configuration

#### `scripts/` — Interactive setup & configuration scripts (TypeScript, run via ts-node)

- [scripts/install-wizard.ts](scripts/install-wizard.ts) - Interactive setup wizard (`npm run setup`)
- [scripts/config/wizard.ts](scripts/config/wizard.ts) - Interactive prompts module
- [scripts/config/validator.ts](scripts/config/validator.ts) - Configuration validation module
- [scripts/infer-quilt-config.ts](scripts/infer-quilt-config.ts) - Quilt catalog inference (`npm run setup:infer`)
- [scripts/sync-secrets.ts](scripts/sync-secrets.ts) - AWS Secrets Manager sync (`npm run setup:sync-secrets`)
- [scripts/config-health-check.ts](scripts/config-health-check.ts) - Configuration validation (`npm run setup:health`)

### Application

#### `docker/` — FastAPI webhook processor (Python)

- See [docker/README.md](docker/README.md) for details

#### Key Distinction

##### `bin/` — CLI tools & compiled scripts (production runtime, often `.js`)

##### `scripts/` — Development-time setup scripts (TypeScript, via ts-node)

---

## Architecture (v1.0.0)

AWS CDK application deploying auto-scaling webhook processor:

### Components

- **REST API Gateway v1** → Public HTTPS endpoint with CloudWatch logging and resource policy
- **Resource Policy** → IP allowlisting (free, applied when `webhookAllowList` configured)
- **VPC Link** → Private connection between API Gateway and VPC
- **Network Load Balancer** → Internal load balancer with health checks
- **ECS Fargate** → FastAPI application on port 8080 (auto-scales 2-10 tasks)
- **S3** → Payload and package storage
- **SQS** → Quilt package creation queue
- **Secrets Manager** → Benchling OAuth credentials
- **CloudWatch** → Centralized logging and monitoring

### Flow Diagram

```text
Internet
  ↓
REST API Gateway v1 + Resource Policy (IP filtering)
  ↓
VPC Link
  ↓
Network Load Balancer (internal)
  ↓
ECS Fargate Tasks (FastAPI on port 8080)
  |
  | HMAC signature verification
  | Process webhook payload
  ↓
S3 + SQS → Quilt Package Creation
```

### Security Model

**Single Authentication Layer: FastAPI HMAC Verification**

- All webhook requests MUST have valid HMAC signatures computed over raw request body
- FastAPI uses Benchling SDK to verify signatures against secret from Secrets Manager
- This is the ONLY layer that validates webhook authenticity
- Invalid signatures return 403 Forbidden

**Optional Network Layer: Resource Policy IP Filtering**

- Applied when `webhookAllowList` is configured (free, no additional cost)
- Blocks unknown IPs at API Gateway edge
- Does NOT perform authentication (IP ≠ identity)
- Health endpoints always exempt from IP filtering
- When not configured: All IPs allowed

**Why REST API v1 instead of HTTP API v2?**

REST API v1 provides resource policies which:

1. Enable free IP filtering (vs $7/month for WAF with HTTP API v2)
2. Support fine-grained access control per endpoint
3. Allow health endpoint exemption from IP filtering
4. Are natively integrated with API Gateway (no separate service)

See [spec/2025-11-26-architecture/11-arch-30.md](spec/2025-11-26-architecture/11-arch-30.md) for detailed architectural analysis.

### Cost Analysis

**Monthly Fixed Costs (us-east-1):**

| Component | Cost |
|-----------|------|
| REST API v1 | $0.00 |
| Resource Policy | $0.00 |
| VPC Link | $0.00 |
| Network Load Balancer | $16.20 |
| ECS Fargate (2 tasks) | $14.50 |
| NAT Gateway | $32.40 |
| **Total** | **$63.10** |

**Variable Costs (per million requests):**

| Component | Cost |
|-----------|------|
| REST API v1 | ~$3.50 |
| Resource Policy | $0.00 |
| ECS Fargate | Included in fixed cost |
| **Total Variable** | **~$3.50** |

**Trade-offs:**

- -$5.10/month vs previous WAF-based architecture (eliminates WAF cost)
- +$2.50/million requests vs HTTP API v2 (REST API is more expensive per request)
- Resource Policy is free and provides same IP filtering as WAF
- Break-even point: ~2 million requests/month (most deployments use < 100k/month)

---

## Testing Strategy

### Primary Workflow

```bash
# 1. Fast feedback during development (30 seconds)
npm run test                 # Lint + typecheck + unit tests (no Docker, mocked AWS)

# 2. Local integration testing (2 minutes)
npm run test:local           # Build + run Docker dev container + test webhooks

# 3. Remote deployment testing (via CI or manual)
npm run test:dev             # Test deployed dev stack via API Gateway (auto-deploys if needed)
```

### Available Test Commands

```bash
# Local testing (no deployment)
npm run test                 # Unit tests: lint + typecheck + TS + Python
npm run test:local           # Docker dev container (hot-reload, port 8082)
npm run test:local:prod      # Docker prod container (production mode, port 8083)
npm run test:native          # Native FastAPI with mocked AWS (no Docker, port 8080)

# Remote deployment testing
npm run test:dev             # Deployed dev stack via API Gateway (auto-deploys if needed)
npm run test:prod            # Deployed prod stack via API Gateway

# Component testing (debugging)
npm run test:ts              # TypeScript tests only
npm run test:python          # Python unit tests only
npm run lint                 # Auto-fix formatting
```

### Quick Reference

| Command | Docker? | AWS? | When to Use |
|---------|---------|------|-------------|
| `test` | No | Mocked | Daily development, pre-commit |
| `test:local` | Yes (dev) | Real | Before PR, local integration testing |
| `test:local:prod` | Yes (prod) | Real | Test prod Docker config locally |
| `test:native` | No | Mocked | Quick FastAPI testing without Docker |
| `test:dev` | Remote | Real | CI/CD, verify deployed dev stack |
| `test:prod` | Remote | Real | After production deployment |

---

## Configuration (v0.7.0+)

### XDG Configuration Model

#### Profile-Based Configuration

Version 0.7.0 introduces a completely redesigned configuration architecture with profile-based configuration and per-profile deployment tracking.

**Directory structure:**

```text
~/.config/benchling-webhook/
├── default/
│   ├── config.json          # All configuration for default profile
│   └── deployments.json     # Deployment history for default profile
├── dev/
│   ├── config.json          # All configuration for dev profile
│   └── deployments.json     # Deployment history for dev profile
└── prod/
    ├── config.json          # All configuration for prod profile
    └── deployments.json     # Deployment history for prod profile
```

#### Key Concepts

**Profile**: A named set of configuration values (credentials, Quilt settings, Benchling settings)

- Examples: `default`, `dev`, `prod`, `staging`
- Stored in `~/.config/benchling-webhook/{profile}/config.json`
- Each profile has its own deployment tracking

**Stage**: An API Gateway deployment target

- Examples: `dev`, `prod`, `staging`, `test`
- Multiple stages can be deployed per profile
- Tracked in `~/.config/benchling-webhook/{profile}/deployments.json`

**Independence**: Profiles and stages are independent - you can deploy any profile to any stage

#### Configuration File Structure

Each profile's `config.json` contains:

```json
{
  "quilt": {
    "stackArn": "arn:aws:cloudformation:...",
    "catalog": "https://example.quiltdata.com",
    "bucket": "quilt-example",
    "database": "quilt_example",
    "queueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-queue",
    "region": "us-east-1"
  },
  "benchling": {
    "tenant": "example",
    "clientId": "...",
    "secretArn": "arn:aws:secretsmanager:...",
    "appDefinitionId": "app_...",
    "testEntryId": "etr_..."
  },
  "packages": {
    "bucket": "benchling-packages",
    "prefix": "benchling",
    "metadataKey": "experiment_id"
  },
  "deployment": {
    "region": "us-east-1",
    "account": "123456789012",
    "imageTag": "latest"
  },
  "logging": {
    "level": "INFO"
  },
  "security": {
    "enableVerification": true
  },
  "_metadata": {
    "version": "0.7.0",
    "createdAt": "2025-11-04T10:00:00Z",
    "updatedAt": "2025-11-04T10:00:00Z",
    "source": "wizard"
  }
}
```

#### Profile Inheritance

Profiles can inherit from other profiles to reduce duplication:

```json
{
  "_inherits": "default",
  "benchling": {
    "appDefinitionId": "app_dev_123"
  },
  "deployment": {
    "imageTag": "latest"
  }
}
```

When read with inheritance, the profile is deep-merged with its parent profile.

#### Deployment Tracking

Each profile's `deployments.json` tracks deployment history:

```json
{
  "active": {
    "dev": {
      "endpoint": "https://xxx.execute-api.us-east-1.amazonaws.com/dev",
      "imageTag": "latest",
      "deployedAt": "2025-11-04T10:30:00Z"
    },
    "prod": {
      "endpoint": "https://xxx.execute-api.us-east-1.amazonaws.com/prod",
      "imageTag": "0.7.0",
      "deployedAt": "2025-11-03T14:20:00Z"
    }
  },
  "history": [
    {
      "stage": "dev",
      "timestamp": "2025-11-04T10:30:00Z",
      "imageTag": "latest",
      "endpoint": "https://...",
      "stackName": "BenchlingWebhookStack",
      "region": "us-east-1"
    }
  ]
}
```

### Configuration Flow

1. `npm run setup` prompts for settings → stores in `~/.config/benchling-webhook/default/config.json`
2. npm scripts read profile configuration via `XDGConfig.readProfile(profile)`
3. Secrets synced to AWS Secrets Manager
4. Deployment outputs written to `~/.config/benchling-webhook/{profile}/deployments.json`

### Setup Wizard Behavior

#### Initial Setup

When running `npm run setup` for the first time:

- Wizard prompts for all required configuration
- Attempts to infer Quilt configuration from AWS
- Validates Benchling credentials in real-time
- Saves all settings to `~/.config/benchling-webhook/{profile}/config.json`

#### Re-running Setup (Idempotent)

When running `npm run setup` on an existing profile:

- **Loads existing configuration** from `{profile}/config.json`
- **Uses previous values as defaults** for all prompts
- Allows you to accept existing values (press Enter) or override them
- Updates only the fields you change
- Preserves `_metadata.createdAt` but updates `_metadata.updatedAt`

**Example workflow:**

```bash
# First run - enter all values
npm run setup

# Later - change only deployment region
npm run setup
# (Press Enter to accept existing values until "AWS Deployment Region" prompt)
# (Enter new region, then accept remaining defaults)

```

This idempotent behavior means you can safely re-run `npm run setup` to:

- Update a single configuration value
- Fix validation errors
- Re-sync secrets after rotation
- Add optional fields like `testEntryId`

### Setup Commands

```bash
npm run setup                # Interactive wizard (creates/updates default profile)
npm run setup:infer          # Infer Quilt config from catalog
npm run setup:sync-secrets   # Sync secrets to AWS Secrets Manager
npm run setup:health         # Validate configuration
```

### XDGConfig API (v0.7.0)

The new XDGConfig API is profile-first:

```typescript
class XDGConfig {
  // Configuration Management
  readProfile(profile: string): ProfileConfig
  writeProfile(profile: string, config: ProfileConfig): void
  deleteProfile(profile: string): void
  listProfiles(): string[]
  profileExists(profile: string): boolean

  // Deployment Tracking
  getDeployments(profile: string): DeploymentHistory
  recordDeployment(profile: string, deployment: DeploymentRecord): void
  getActiveDeployment(profile: string, stage: string): DeploymentRecord | null

  // Profile Inheritance
  readProfileWithInheritance(profile: string, baseProfile?: string): ProfileConfig

  // Validation
  validateProfile(config: ProfileConfig): ValidationResult
}
```

### Required Configuration

Stored in AWS Secrets Manager and referenced in profile config:

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `benchling.tenant` | Yes | - | Benchling tenant name |
| `benchling.clientId` | Yes | - | OAuth client ID |
| `benchling.clientSecret` | Via Secrets Manager | - | OAuth client secret |
| `benchling.secretArn` | Yes | - | AWS Secrets Manager ARN |
| `benchling.appDefinitionId` | Yes | - | Benchling app identifier |
| `benchling.testEntryId` | No | - | Test entry ID for validation |
| `quilt.stackArn` | Yes | - | CloudFormation stack ARN |
| `quilt.catalog` | Yes | - | Quilt catalog URL |
| `quilt.bucket` | Yes | - | S3 bucket for packages |
| `quilt.database` | Yes | - | Glue Data Catalog database |
| `quilt.queueUrl` | Yes | - | SQS queue URL |
| `packages.bucket` | Yes | - | S3 bucket for package storage |
| `packages.prefix` | No | `benchling` | S3 key prefix |
| `packages.metadataKey` | No | `experiment_id` | Package metadata key |
| `security.enableVerification` | No | `true` | Enable webhook signature verification |
| `security.webhookAllowList` | No | `""` | IP allowlist (comma-separated) |
| `logging.level` | No | `INFO` | Python logging level |

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
  --profile default \
  --stage prod \
  --image-tag <version> \
  --yes
```

---

## Monitoring & Debugging

### Logs

**CloudWatch Log Groups:**

- `/aws/apigateway/benchling-webhook-rest` - API Gateway access logs
- `/ecs/benchling-webhook` - ECS container logs (FastAPI application with HMAC verification)

**View logs:**

```bash
# API Gateway access logs
aws logs tail /aws/apigateway/benchling-webhook-rest --follow

# ECS application logs (includes HMAC verification)
aws logs tail /ecs/benchling-webhook --follow

# All logs (integrated command)
npx @quiltdata/benchling-webhook logs --profile default
```

### Health Checks

- `/health` - General health
- `/health/ready` - Readiness probe
- `/health/live` - Liveness probe

### Metrics

- **CloudWatch Metrics:**
  - ECS tasks running/desired
  - API Gateway 4xx/5xx errors
  - NLB healthy/unhealthy targets
  - ECS CPU/memory utilization
  - Resource policy blocked requests (403 responses)

- **Deployment outputs:** `~/.config/benchling-webhook/{profile}/deployments.json`

---

## Configuration Failure Modes

| Failure | Cause | Mitigation |
|----------|--------|-------------|
| Missing profile | Profile not found | Run `npm run setup` to create profile |
| Missing Quilt catalog | Quilt3 not configured | Run `quilt3 config` and retry |
| Profile config corrupted | Manual file edit | Validate JSON schema; re-run `npm run setup` |
| AWS auth error | Invalid credentials | Check `AWS_PROFILE` and region |
| Docker build failure | Outdated base image | Auto-pull latest base before build |
| Secrets not synced | Secrets Manager unreachable | Validate IAM permissions; retry sync with backoff |
| CDK stack drift | Manual AWS changes | Run `cdk diff` preflight; warn on drift detection |
| Legacy config detected | Upgrading from v0.6.x | Display migration message; see MIGRATION.md |
| 403 Forbidden (HMAC) | Invalid signature | Check ECS logs for HMAC verification errors; verify Benchling secret |
| 403 Forbidden (Resource Policy) | IP not in allowlist | Add IP to webhookAllowList or remove IP filtering |
| NLB unhealthy targets | ECS health check failing | Check ECS logs and container health status |

---

## Coding Standards

- **TypeScript**: 4-space indent, double quotes, trailing commas, required semicolons
- **Types**: Avoid `any`; explicit return types on exports
- **Commits**: Conventional format `type(scope): summary`
- **PRs**: Include test results and deployment notes

---

## Operational Principles

- **Profile-Based Configuration**: Each profile is self-contained with its own settings and deployment tracking
- **Profile/Stage Independence**: Deploy any profile to any stage for maximum flexibility
- **Single Source of Truth**: Profile's `config.json` defines all configuration
- **Per-Profile Deployment Tracking**: Each profile tracks its own deployments independently
- **Fail Fast**: Validation before deployment prevents partial stacks
- **Idempotence**: Re-running `npm run setup` updates existing profile
- **Observability**: Every stage logs explicit diagnostics to CloudWatch
- **Separation of Concerns**: npm orchestrates, TypeScript/Python implement
- **Simplicity Over Complexity**: Single authentication layer (FastAPI HMAC), optional network filtering (Resource Policy)

---

## Security

- **HMAC Signature Verification**: Single authentication layer in FastAPI (raw body access required)
- **Optional Resource Policy IP Filtering**: Block unknown IPs at API Gateway edge (free, no additional cost)
- **Secrets in AWS Secrets Manager**: Credentials never stored in code
- **Private Network**: ECS tasks in private subnets, no public IPs
- **VPC Link**: Encrypted connection between API Gateway and NLB
- **Container Scanning**: ECR image scanning enabled
- **Least-Privilege IAM**: Task roles limited to required permissions
- **TLS 1.2+ Encryption**: All API Gateway endpoints
- **CloudWatch Logging**: Audit trail for HMAC verification and resource policy decisions

---

## Prerequisites

- AWS Account with IAM permissions
- AWS CLI v2.x configured
- Node.js >= 18.0.0
- Docker
- Quilt Stack (S3 bucket + SQS queue)
- Benchling Account with app creation permissions

---

## Migration from v0.6.x

Version 0.7.0 is a BREAKING CHANGE release. See [MIGRATION.md](./MIGRATION.md) for detailed upgrade instructions.

**Key changes:**

- Configuration moved from `~/.config/benchling-webhook/default.json` to `~/.config/benchling-webhook/default/config.json`
- Deployment tracking moved from shared `deploy.json` to per-profile `deployments.json`
- Profiles moved from `profiles/{name}/default.json` to `{name}/config.json`
- Three-tier config system (user/derived/deploy) simplified to single `config.json`
- Profile inheritance now explicit via `_inherits` field

---

## License

Apache-2.0 - See [LICENSE](LICENSE) file for details
