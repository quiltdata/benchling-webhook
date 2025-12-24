# Benchling Webhook - Agent Guide

## Policy

- Always allow: `npm install`, `npm test`, `npm run setup`, git operations, `gh` commands
- Always fix IDE diagnostics after edits
- Docker images ALWAYS pull from centralized ECR: `712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:latest`

## Key Repository Commands

### Development Workflow

```bash
npm run setup                # Interactive config wizard (one-time)
npm run test                 # Fast unit tests (pre-commit)
npm run test:local           # Local Docker integration tests
npm run test:dev             # Test deployed dev stack
```

### Release Workflow (Maintainers)

```bash
npm run version:tag          # Create git tag → triggers CI → builds Docker image
npm run deploy:prod          # Deploy to production
```

### Key Files

- [lib/types/stack-config.ts](lib/types/stack-config.ts) - Minimal CDK stack configuration interface
- [lib/utils/config-transform.ts](lib/utils/config-transform.ts) - ProfileConfig → StackConfig transformation
- [lib/benchling-webhook-stack.ts](lib/benchling-webhook-stack.ts) - Main CDK stack
- [bin/commands/deploy.ts](bin/commands/deploy.ts) - Deployment orchestration
- [docker/](docker/) - FastAPI webhook processor (Python)

## High-Level Architecture

**Flow:** API Gateway (REST v1) → VPC Link → Network Load Balancer → ECS Fargate (FastAPI) → S3 + SQS

**Configuration:** Profile-based XDG config in `~/.config/benchling-webhook/{profile}/config.json`

**Key Concepts:**

- **Profile** - Named config set (e.g., `default`, `sales`, `dev`)
- **Stage** - API Gateway deployment target (e.g., `dev`, `prod`)
- **StackConfig** - Minimal interface for CDK stack (v0.10.0+, decoupled from ProfileConfig)

**Security:**

- Primary: HMAC signature verification in FastAPI
- Optional: Resource Policy IP filtering (free, when `webhookAllowList` configured)

## Configuration v0.10.0+

**Breaking Change:** Removed unused Iceberg fields (`quilt.athenaUserPolicy`, `quilt.athenaResultsBucketPolicy`, `quilt.athenaResultsBucket`)

**New Architecture:**

- CDK stack uses minimal `StackConfig` interface (only required fields)
- `config-transform.ts` converts ProfileConfig → StackConfig
- Eliminated subprocess env var round-trip
- Deployment flow: deploy.ts passes config via stdin to CDK

## Common Patterns

### Creating a PR

```bash
npm run test                 # Ensure tests pass
git commit -m "type(scope): description"
gh pr create                 # Creates PR with conventional format
```

### Checking Logs

```bash
npm run logs -- --profile default
# Checks both API Gateway and ECS container logs
```

### Multi-Stack Deployments

```bash
npm run deploy:prod -- --profile sales --yes
# Creates: BenchlingWebhookStack-sales
```

## Troubleshooting

| Issue                  | Solution                                                   |
| ---------------------- | ---------------------------------------------------------- |
| Missing profile        | Run `npm run setup`                                        |
| 403 Forbidden (HMAC)   | Check ECS logs for signature errors                        |
| 403 Forbidden (IP)     | Add IP to `webhookAllowList` or disable filtering          |
| Stack name conflict    | Use unique `stackName` per profile in config.json          |

## Documentation

- [CLAUDE.md](CLAUDE.md) - Comprehensive project documentation
- [CHANGELOG.md](CHANGELOG.md) - Release notes and migration guides
- [spec/](spec/) - Architecture specs and implementation details
- [docker/README.md](docker/README.md) - FastAPI application documentation
