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

### 2. Configure Benchling Secrets

Create a JSON file with your Benchling credentials:

```bash
cat > benchling-secrets.json << EOF
{
  "client_id": "your-benchling-client-id",
  "client_secret": "your-benchling-client-secret",
  "tenant": "your-tenant"
}
EOF
```

> **Important**: Never commit secrets to version control. Add `benchling-secrets.json` to `.gitignore`.

**See [Secrets Configuration Guide](./docs/SECRETS_CONFIGURATION.md) for detailed configuration options**

### 3. Deploy to AWS

```bash
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets @benchling-secrets.json \
  --catalog your-catalog.quiltdata.com
```

The interactive wizard will auto-detect or request configuration information, deploy to AWS, and test the webhook automatically.

### 4. Install in Benchling

After deployment, you'll receive a webhook URL. Set it in your Benchling app settings and [install the app](https://docs.benchling.com/docs/getting-started-benchling-apps#installing-your-app) in your tenant.

## Usage

In Benchling: Create entry → Insert Canvas → "Quilt Integration" → Create/Update package

## Configuration

### Secrets Management (v0.6.0+)

The webhook supports multiple ways to configure Benchling credentials:

#### Option 1: Inline JSON
```bash
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets '{"client_id":"xxx","client_secret":"yyy","tenant":"company"}'
```

#### Option 2: JSON File (Recommended)
```bash
npx @quiltdata/benchling-webhook deploy --benchling-secrets @benchling-secrets.json
```

#### Option 3: AWS Secrets Manager ARN
```bash
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-creds"
```

#### Option 4: Environment Variable
```bash
export BENCHLING_SECRETS='{"client_id":"xxx","client_secret":"yyy","tenant":"company"}'
npx @quiltdata/benchling-webhook deploy
```

**📖 [Complete Secrets Configuration Guide](./docs/SECRETS_CONFIGURATION.md)**

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

**Secrets Configuration**:
- `--benchling-secrets <value>` - Benchling secrets (ARN, JSON, or @file)

**Quilt Configuration**:
- `--catalog <url>` - Quilt catalog URL
- `--bucket <name>` - S3 bucket for data

**AWS Configuration**:
- `--profile <name>` - AWS profile to use
- `--region <region>` - AWS region to deploy to
- `--image-tag <tag>` - Docker image tag to deploy (default: latest)

**Deployment Options**:
- `--env-file <path>` - Path to .env file (default: .env)
- `--yes` - Skip confirmation prompts
- `--no-bootstrap-check` - Skip CDK bootstrap verification
- `--require-approval <level>` - CDK approval level (default: never)

### Deprecated Parameters (v0.6.0+)

> ⚠️ **Warning**: The following parameters are deprecated and will be removed in v1.0.0

- `--tenant` - Use `--benchling-secrets` instead
- `--client-id` - Use `--benchling-secrets` instead
- `--client-secret` - Use `--benchling-secrets` instead
- `--app-id` - Use `--benchling-secrets` instead

**Migration guide**: See [Secrets Configuration - Migration Guide](./docs/SECRETS_CONFIGURATION.md#migration-guide)

## Documentation

- 📖 [Secrets Configuration Guide](./docs/SECRETS_CONFIGURATION.md) - Comprehensive secrets management documentation
- 📖 [Architecture Decision Record: Secrets Management](./docs/ADR-001-SECRETS-MANAGEMENT.md) - Design decisions and rationale
- 📖 [CHANGELOG.md](./CHANGELOG.md) - Version history and release notes

## Development

For local development and contributing:

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install

# Test CLI locally (note the -- separator for passing args)
npm run cli -- --help
npm run cli -- deploy

npm test        # Run tests
npm run build   # Build package
```

### Running Tests

```bash
# Run all tests (TypeScript + Python)
npm test

# Run TypeScript tests only
npm run test:ts

# Run Python tests only
npm run test:python

# Type checking
npm run typecheck

# Linting
npm run lint
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
