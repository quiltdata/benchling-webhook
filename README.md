# Benchling Webhook Integration for Quilt

Connects Benchling lab notebook entries to Quilt data packages via webhooks.

## Prerequisites

- `npx` from Node.js 18+ ([download](https://nodejs.org))
- [AWS credentials](https://docs.aws.amazon.com/cli/v1/userguide/cli-configure-files.html) configured
- Existing [Quilt deployment](https://www.quilt.bio/install)
- Benchling tenant with OAuth app configured

## Setup

### 1. Create Benchling App

```bash
npx @quiltdata/benchling-webhook manifest
```

Follow the displayed instructions to [upload the manifest](https://docs.benchling.com/docs/getting-started-benchling-apps#creating-an-app-from-a-manifest) to Benchling and get your App Definition ID.

### 2. Store Benchling Secrets in AWS Secrets Manager

Create a secret in AWS Secrets Manager with your Benchling credentials:

```bash
aws secretsmanager create-secret \
  --name benchling-webhook-credentials \
  --description "Benchling OAuth credentials" \
  --secret-string '{
    "client_id": "your-benchling-client-id",
    "client_secret": "your-benchling-client-secret",
    "tenant": "your-tenant",
    "app_definition_id": "your-app-definition-id"
  }'
```

> **Note**: The secret must contain `client_id`, `client_secret`, and `tenant`. The `app_definition_id` is optional but recommended.

### 3. Deploy to AWS (Secrets-Only Mode - v0.6.0+)

**Recommended: Secrets-Only Mode** - Minimal configuration, all settings resolved from AWS:

```bash
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc123" \
  --benchling-secret "benchling-webhook-credentials"
```

That's it! The deployment automatically resolves:
- Quilt catalog URL from your stack
- S3 bucket configuration
- Athena database name
- SQS queue ARN
- AWS region and account

**Alternative: Legacy Mode** - For existing deployments or manual configuration:

```bash
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets @benchling-secrets.json \
  --catalog your-catalog.quiltdata.com
```

**See [Secrets Configuration Guide](./docs/SECRETS_CONFIGURATION.md) and [Migration Guide](./docs/MIGRATION_GUIDE_V06.md) for more options**

### 4. Install in Benchling

After deployment, you'll receive a webhook URL. Set it in your Benchling app settings and [install the app](https://docs.benchling.com/docs/getting-started-benchling-apps#installing-your-app) in your tenant.

## Usage

In Benchling: Create entry → Insert Canvas → "Quilt Integration" → Create/Update package

## Configuration

### Deployment Modes (v0.6.0+)

#### Secrets-Only Mode (Recommended)

The simplest deployment method - just provide two parameters:

```bash
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn "arn:aws:cloudformation:region:account:stack/QuiltStack/id" \
  --benchling-secret "my-secret-name"
```

**Benefits**:
- ✅ Minimal configuration - only 2 parameters needed
- ✅ Centralized secrets in AWS Secrets Manager
- ✅ Automatic configuration resolution from CloudFormation
- ✅ No manual parameter updates when infrastructure changes
- ✅ Better security - no secrets in CI/CD pipelines

**How to find your Quilt Stack ARN**:
```bash
# List your CloudFormation stacks
aws cloudformation describe-stacks --query 'Stacks[?contains(StackName, `Quilt`)].StackId'

# Or from the AWS Console → CloudFormation → Stack Details → Stack info → ARN
```

#### Legacy Mode

For existing deployments or manual configuration:

```bash
# Option 1: Inline JSON
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets '{"client_id":"xxx","client_secret":"yyy","tenant":"company"}' \
  --catalog your-catalog.quiltdata.com

# Option 2: JSON File
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets @benchling-secrets.json \
  --catalog your-catalog.quiltdata.com

# Option 3: AWS Secrets Manager ARN
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets "arn:aws:secretsmanager:region:account:secret:name" \
  --catalog your-catalog.quiltdata.com
```

**📖 [Complete Configuration Guide](./docs/SECRETS_CONFIGURATION.md)**
**📖 [Migration Guide to v0.6.0](./docs/MIGRATION_GUIDE_V06.md)**

### Secret Format

**Required fields**:
- `client_id`: Benchling OAuth client ID
- `client_secret`: Benchling OAuth client secret
- `tenant`: Benchling tenant name (e.g., "company" for company.benchling.com)

**Optional fields**:
- `app_definition_id`: Benchling app definition ID
- `api_url`: Custom Benchling API URL

**Example**:
```json
{
  "client_id": "abc123",
  "client_secret": "secret_key",
  "tenant": "mycompany",
  "app_definition_id": "app_def_123"
}
```

### Updating Secrets

To update Benchling credentials after deployment:

**Method 1: Update in AWS Secrets Manager (Recommended)**
```bash
aws secretsmanager update-secret \
  --secret-id benchling-webhook/credentials \
  --secret-string '{"client_id":"new_id","client_secret":"new_secret","tenant":"company"}'

# Restart ECS service to pick up changes
aws ecs update-service \
  --cluster benchling-webhook-cluster \
  --service benchling-webhook-service \
  --force-new-deployment
```

**Method 2: Redeploy Stack**
```bash
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets @updated-secrets.json
```

## All Available Commands

For all available commands, run:

```bash
npx @quiltdata/benchling-webhook --help
```

### Commands

- `deploy` - Deploy the CDK stack to AWS (default command)
- `init` - Initialize configuration interactively
- `validate` - Validate configuration without deploying
- `test` - Test the deployed webhook endpoint
- `manifest` - Generate Benchling app manifest file

### Deploy Options

```bash
npx @quiltdata/benchling-webhook deploy [options]
```

**Secrets-Only Mode (v0.6.0+ - Recommended)**:
- `--quilt-stack-arn <arn>` - ARN of Quilt CloudFormation stack
- `--benchling-secret <name>` - Name or ARN of Benchling secret in Secrets Manager

**Legacy Mode Configuration**:
- `--benchling-secrets <value>` - Benchling secrets (ARN, JSON, or @file)
- `--catalog <url>` - Quilt catalog URL
- `--bucket <name>` - S3 bucket for data

**AWS Configuration**:
- `--profile <name>` - AWS profile to use
- `--region <region>` - AWS region to deploy to (auto-detected in secrets-only mode)
- `--image-tag <tag>` - Docker image tag to deploy (default: latest)

**Deployment Options**:
- `--env-file <path>` - Path to .env file (default: .env)
- `--yes` - Skip confirmation prompts
- `--no-bootstrap-check` - Skip CDK bootstrap verification
- `--require-approval <level>` - CDK approval level (default: never)

### Deprecated Parameters (v0.6.0+)

> ⚠️ **Warning**: The following parameters are deprecated and will be removed in v1.0.0

- `--tenant` - Use `--benchling-secrets` or secrets-only mode instead
- `--client-id` - Use `--benchling-secrets` or secrets-only mode instead
- `--client-secret` - Use `--benchling-secrets` or secrets-only mode instead
- `--app-id` - Use `--benchling-secrets` or secrets-only mode instead

**Migration guide**: See [Migration Guide to v0.6.0](./docs/MIGRATION_GUIDE_V06.md)

## Documentation

- 📖 [Secrets Configuration Guide](./docs/SECRETS_CONFIGURATION.md) - Comprehensive secrets management documentation
- 📖 [Architecture Decision Record: Secrets Management](./docs/ADR-001-SECRETS-MANAGEMENT.md) - Design decisions and rationale
- 📖 [CHANGELOG.md](./CHANGELOG.md) - Version history and release notes

## Development

For local development and contributing:

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook

# Install dependencies and configure (interactive)
npm run setup

# Build package
npm run build
```

### Testing Workflow

```bash
# 1. Run unit tests (lint + typecheck + mocked tests)
npm run test

# 2. Run local integration tests (builds Docker, uses real Benchling payloads)
npm run test:local

# 3. Run remote integration tests (deploys dev stack, tests through API Gateway)
npm run test:remote

# Individual test commands
npm run test-ts      # TypeScript tests only
npm run test:python  # Python unit tests only
npm run typecheck    # Type checking only
npm run lint         # Linting only
```

### Release Workflow

```bash
# Create and push version tag (triggers release pipeline)
npm run tag

# CI will run:
# - npm run test:remote (builds dev image, deploys dev stack, tests)
# - npm run release (promotes to production after tests pass)
```

## Troubleshooting

### Common Issues

**Error: "Invalid secret ARN format"**
- Verify ARN format: `arn:aws:secretsmanager:region:account:secret:name`
- See [Troubleshooting Guide](./docs/SECRETS_CONFIGURATION.md#troubleshooting)

**Error: "Missing required field: client_id"**
- Check secret JSON includes all required fields: `client_id`, `client_secret`, `tenant`
- Validate JSON syntax: `echo '{"client_id":"..."}' | jq .`

**Deprecation Warning**
- Migrate to `--benchling-secrets` parameter
- See [Migration Guide](./docs/SECRETS_CONFIGURATION.md#migration-guide)

**For more help**: See [Secrets Configuration - Troubleshooting](./docs/SECRETS_CONFIGURATION.md#troubleshooting)

## Security

- Secrets are stored in AWS Secrets Manager with encryption at rest
- Secrets are masked in all CLI output
- CloudFormation parameters use `noEcho: true`
- IAM policies grant least-privilege access
- CloudTrail logs all secret access for audit

**Best Practices**:
- Never commit secrets to version control
- Use AWS Secrets Manager for production deployments
- Rotate secrets regularly
- Review IAM policies periodically

**For detailed security guidance**: See [Secrets Configuration - Security](./docs/SECRETS_CONFIGURATION.md#security-best-practices)

## Support

- 🐛 [Report Issues](https://github.com/quiltdata/benchling-webhook/issues)
- 📧 Security vulnerabilities: security@quiltdata.com
- 📖 [Documentation](./docs/)
- 💬 [Discussions](https://github.com/quiltdata/benchling-webhook/discussions)

## License

Apache-2.0

## Version

Current version: 0.5.4 (see [CHANGELOG.md](./CHANGELOG.md))

Next version: 0.6.0 (secrets management integration)
