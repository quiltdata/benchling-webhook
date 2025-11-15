# CLI Quick Reference Card

One-page reference for the `@quiltdata/benchling-webhook` CLI.

## Installation

```bash
# No installation needed - use npx!
npx @quiltdata/benchling-webhook <command>
```

## Commands

### init - Interactive Setup
```bash
npx @quiltdata/benchling-webhook init [options]

Options:
  --output <path>    Output file (default: .env)
  --force            Overwrite existing file
  --minimal          Only prompt for required values
  --infer            Auto-infer values from catalog
```

### deploy - Deploy to AWS
```bash
npx @quiltdata/benchling-webhook deploy [options]

Options:
  --catalog <url>          Quilt catalog URL
  --bucket <name>          S3 bucket name
  --tenant <name>          Benchling tenant
  --client-id <id>         Benchling client ID
  --client-secret <secret> Benchling client secret
  --app-id <id>            Benchling app ID
  --env-file <path>        .env file path (default: .env)
  --no-bootstrap-check     Skip CDK bootstrap check
  --profile <name>         AWS profile
  --region <region>        AWS region
  --yes                    Skip confirmation
```

### validate - Check Configuration
```bash
npx @quiltdata/benchling-webhook validate [options]

Options:
  --env-file <path>    .env file path (default: .env)
  --verbose            Show detailed info
```

## Quick Workflows

### First-Time Setup
```bash
# 1. Interactive setup
npx @quiltdata/benchling-webhook init

# 2. Deploy
npx @quiltdata/benchling-webhook deploy
```

### Deploy Without .env File
```bash
npx @quiltdata/benchling-webhook deploy \
  --catalog quilt-catalog.company.com \
  --bucket my-bucket \
  --tenant company \
  --client-id client_abc123 \
  --client-secret secret_xyz789 \
  --app-id appdef_123456 \
  --yes
```

### Update Existing Deployment
```bash
# Edit .env
nano .env

# Validate
npx @quiltdata/benchling-webhook validate

# Deploy
npx @quiltdata/benchling-webhook deploy
```

### Multi-Environment
```bash
# Create configs
npx @quiltdata/benchling-webhook init --output .env.dev
npx @quiltdata/benchling-webhook init --output .env.prod

# Deploy each
npx @quiltdata/benchling-webhook deploy --env-file .env.dev
npx @quiltdata/benchling-webhook deploy --env-file .env.prod
```

## Configuration

### Required Values
```bash
QUILT_CATALOG=quilt-catalog.company.com
QUILT_USER_BUCKET=my-data-bucket
BENCHLING_TENANT=company
BENCHLING_CLIENT_ID=client_abc123
BENCHLING_CLIENT_SECRET=secret_xyz789
BENCHLING_APP_DEFINITION_ID=appdef_123456
```

### Auto-Inferred Values
```bash
# These are discovered automatically:
CDK_DEFAULT_ACCOUNT=123456789012
CDK_DEFAULT_REGION=us-east-1
QUEUE_NAME=QuiltStack-PackagerQueue-ABC123
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/QuiltStack-PackagerQueue-ABC123
QUILT_DATABASE=quilt_db
```

### Priority Order
1. CLI options (`--catalog`, etc.)
2. Environment variables (`QUILT_CATALOG`, etc.)
3. .env file
4. Inferred values
5. Defaults

## Common Issues

### Missing Configuration
```bash
# Error: Missing QUILT_CATALOG
# Fix:
npx @quiltdata/benchling-webhook init
```

### CDK Not Bootstrapped
```bash
# Error: CDK not bootstrapped
# Fix:
npx cdk bootstrap aws://123456789012/us-east-1
```

### AWS Credentials Not Configured
```bash
# Error: No AWS credentials
# Fix:
aws configure
# Or:
export AWS_PROFILE=your-profile
```

### Cannot Infer from Catalog
```bash
# Warning: Could not infer configuration
# Fix: Manually add to .env:
CDK_DEFAULT_ACCOUNT=123456789012
CDK_DEFAULT_REGION=us-east-1
QUEUE_NAME=YourQueueName
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/YourQueueName
QUILT_DATABASE=your_db
```

## CI/CD

### GitHub Actions
```yaml
- name: Deploy
  env:
    QUILT_CATALOG: ${{ secrets.QUILT_CATALOG }}
    BENCHLING_CLIENT_ID: ${{ secrets.BENCHLING_CLIENT_ID }}
    BENCHLING_CLIENT_SECRET: ${{ secrets.BENCHLING_CLIENT_SECRET }}
  run: npx @quiltdata/benchling-webhook deploy --yes
```

### GitLab CI
```yaml
deploy:
  script:
    - npx @quiltdata/benchling-webhook deploy --yes
```

### Docker
```dockerfile
FROM node:18-slim
WORKDIR /app
COPY .env .env
CMD ["npx", "@quiltdata/benchling-webhook", "deploy", "--yes"]
```

## Programmatic Usage

```typescript
import {
  createStack,
  checkCdkBootstrap,
  inferConfiguration,
} from '@quiltdata/benchling-webhook';
import { loadConfigSync, validateConfig } from '@quiltdata/benchling-webhook/utils';

// Load config
const config = loadConfigSync({ envFile: '.env' });

// Infer values
const result = await inferConfiguration(config.quiltCatalog);
Object.assign(config, result.inferredVars);

// Validate
const validation = validateConfig(config);
if (!validation.valid) throw new Error('Invalid config');

// Check bootstrap
const bootstrap = await checkCdkBootstrap(config.cdkAccount, config.cdkRegion);
if (!bootstrap.bootstrapped) throw new Error('Not bootstrapped');

// Deploy
const deployment = createStack(config);
```

## Help

```bash
# General help
npx @quiltdata/benchling-webhook --help

# Command help
npx @quiltdata/benchling-webhook init --help
npx @quiltdata/benchling-webhook deploy --help
npx @quiltdata/benchling-webhook validate --help

# Version
npx @quiltdata/benchling-webhook --version

# Validate with details
npx @quiltdata/benchling-webhook validate --verbose
```

## Links

- **GitHub**: https://github.com/quiltdata/benchling-webhook
- **npm**: https://www.npmjs.com/package/@quiltdata/benchling-webhook
- **Issues**: https://github.com/quiltdata/benchling-webhook/issues
- **Docs**: https://github.com/quiltdata/benchling-webhook#readme

## Tips

💡 **Use `--verbose`** when troubleshooting:
```bash
npx @quiltdata/benchling-webhook validate --verbose
```

💡 **Pin versions** in CI/CD:
```bash
npx @quiltdata/benchling-webhook@0.6.0 deploy
```

💡 **Test before deploying**:
```bash
npx @quiltdata/benchling-webhook validate && \
npx @quiltdata/benchling-webhook deploy
```

💡 **Skip confirmation** in scripts:
```bash
npx @quiltdata/benchling-webhook deploy --yes
```

💡 **Use AWS profiles** for multi-account:
```bash
npx @quiltdata/benchling-webhook deploy --profile production
```

---

Print this page and keep it handy! 📋
