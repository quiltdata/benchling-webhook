# Benchling Webhook Integration for Quilt

Connects Benchling lab notebook entries to Quilt data packages via webhooks.

## Prerequisites

- Node.js 18+ with `npx` ([download](https://nodejs.org))
- [AWS credentials](https://docs.aws.amazon.com/cli/v1/userguide/cli-configure-files.html) configured
- Existing [Quilt deployment](https://www.quilt.bio/install)
- Benchling tenant with OAuth app configured

## Quick Start

Run the guided setup wizard:

```bash
npx @quiltdata/benchling-webhook@latest
```

The wizard will:

1. Detect your Quilt stack from AWS CloudFormation
2. Collect and validate your Benchling credentials
3. Sync secrets to AWS Secrets Manager
4. Deploy to AWS

After deployment, install the webhook URL in your [Benchling app settings](https://docs.benchling.com/docs/getting-started-benchling-apps#installing-your-app).

## Usage

In Benchling: Create entry → Insert Canvas → "Quilt Integration" → Create/Update package

## Multi-Environment Deployments

The Benchling webhook supports running development and production environments simultaneously using API Gateway stages and configuration profiles.

### For End Users (Single Environment)

Most users only need production:

```bash
npx @quiltdata/benchling-webhook@latest        # Setup production
npx @quiltdata/benchling-webhook@latest deploy # Deploy production
npx @quiltdata/benchling-webhook@latest test   # Test production
```

### For Maintainers (Dev + Production)

Create side-by-side dev and production environments:

```bash
# Initial setup (one-time)
npx @quiltdata/benchling-webhook@latest                   # Setup production profile
npx @quiltdata/benchling-webhook@latest setup-profile dev # Setup dev profile

# Edit ~/.config/benchling-webhook/dev.json
# - Set different benchlingAppDefinitionId for dev Benchling app
# - Set imageTag: "latest" for dev, semantic version for prod

# Deploy both environments
npx @quiltdata/benchling-webhook@latest deploy --profile dev   # Deploy dev
npx @quiltdata/benchling-webhook@latest deploy --profile default # Deploy prod

# Both environments running simultaneously!
npx @quiltdata/benchling-webhook@latest test --profile dev    # Test dev
npx @quiltdata/benchling-webhook@latest test --profile default # Test prod
```

### Architecture

```
Single AWS Stack: BenchlingWebhookStack
├── API Gateway (shared)
│   ├── Stage: dev  → https://xxx.amazonaws.com/dev/event
│   └── Stage: prod → https://xxx.amazonaws.com/prod/event
├── ALB (shared)
│   ├── Target Group: dev-targets  → ECS Service: benchling-webhook-dev
│   └── Target Group: prod-targets → ECS Service: benchling-webhook-prod
├── ECS Cluster (shared)
│   ├── Service: benchling-webhook-dev  (imageTag: latest)
│   └── Service: benchling-webhook-prod (imageTag: v0.6.3)
└── VPC, Secrets Manager, CloudWatch (shared)
```

### Configuration Profiles

Profiles are stored in `~/.config/benchling-webhook/`:

```
default.json    # Production profile (required)
dev.json        # Development profile (optional)
deploy.json     # Deployment tracking
```

**Key differences between profiles:**
- `benchlingAppDefinitionId` - Different Benchling app IDs for dev/prod
- `imageTag` - Dev uses `latest`, prod uses semantic versions (e.g., `v0.6.3`)
- `benchlingSecret` - Separate AWS Secrets Manager secrets
- `quiltStackArn` - Can point to different Quilt environments

### Cost Information

Running both dev and production environments increases infrastructure costs:

| Configuration | Monthly Cost | Notes |
|---------------|--------------|-------|
| **Single environment** | $70-100 | Production only |
| **Dual environment** | $85-145 | +15-45% for dev environment |

**Cost breakdown:**
- ALB: ~$23 (shared between environments)
- NAT Gateway: ~$32 (shared between environments)
- ECS Fargate: ~$15-45 per environment (scales with usage)

The multi-environment architecture shares expensive infrastructure (ALB, NAT Gateway, VPC) while maintaining separate containers for isolation.

## Additional Commands

```bash
npx @quiltdata/benchling-webhook@latest --help           # Show all commands
npx @quiltdata/benchling-webhook@latest deploy           # Deploy (uses default profile)
npx @quiltdata/benchling-webhook@latest deploy --profile dev # Deploy dev profile
npx @quiltdata/benchling-webhook@latest test             # Test integration
npx @quiltdata/benchling-webhook@latest test --profile dev   # Test dev profile
npx @quiltdata/benchling-webhook@latest manifest         # Generate app manifest
npx @quiltdata/benchling-webhook@latest setup-profile dev    # Create dev profile
```

## Resources

- [Changelog](./CHANGELOG.md) - Version history
- [Report Issues](https://github.com/quiltdata/benchling-webhook/issues)

## License

Apache-2.0
