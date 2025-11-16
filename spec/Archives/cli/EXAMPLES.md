# CLI Usage Examples

## Table of Contents

- [Quick Start](#quick-start)
- [First-Time Setup](#first-time-setup)
- [Deployment Scenarios](#deployment-scenarios)
- [Configuration Management](#configuration-management)
- [Troubleshooting](#troubleshooting)
- [CI/CD Integration](#cicd-integration)
- [Advanced Usage](#advanced-usage)

---

## Quick Start

### Absolute Beginner (Zero to Deployed)

```bash
# Step 1: Interactive setup (creates .env file)
npx @quiltdata/benchling-webhook init

# Step 2: Review the generated .env file
cat .env

# Step 3: Deploy
npx @quiltdata/benchling-webhook deploy

# That's it! 🎉
```

### Experienced User (One Command)

```bash
# Deploy with all options inline (no .env file needed)
npx @quiltdata/benchling-webhook deploy \
  --catalog quilt-catalog.company.com \
  --bucket my-data-bucket \
  --tenant mycompany \
  --client-id client_abc123 \
  --client-secret secret_xyz789 \
  --app-id appdef_123456 \
  --yes
```

---

## First-Time Setup

### Scenario 1: I Have Nothing Configured

```bash
# Run interactive setup
npx @quiltdata/benchling-webhook init

# The tool will prompt you for:
# - Quilt catalog URL
# - S3 bucket name
# - Benchling tenant
# - Benchling credentials

# It will also try to infer AWS settings automatically
```

**What you'll see:**

```
╭─────────────────────────────────╮
│                                 │
│  Benchling Webhook Setup        │
│                                 │
╰─────────────────────────────────╯

Let's configure your deployment. You'll need:
  • Access to your Quilt catalog
  • An S3 bucket for storing data
  • Benchling API credentials

Press Ctrl+C at any time to cancel.

? Quilt catalog URL (domain only): quilt-catalog.mycompany.com
? S3 data bucket name: mycompany-data-bucket
? Benchling tenant (XXX if you login to XXX.benchling.com): mycompany
? Benchling OAuth client ID: client_abc123xyz
? Benchling OAuth client secret: [hidden]
? Benchling app definition ID: appdef_abc123xyz

✓ Configuration saved to .env

Inferring additional configuration from catalog...
✓ Found CDK account: 123456789012
✓ Found region: us-east-1
✓ Found SQS queue: QuiltStack-PackagerQueue-ABC123

╭────────────────────────────────────────────╮
│                                            │
│  ✓ Configuration saved!                   │
│                                            │
│  File: /path/to/.env                      │
│                                            │
│  Next steps:                               │
│    1. Review .env and verify all values   │
│    2. Run: npx @quiltdata/benchling-      │
│       webhook deploy                       │
│    3. Configure your Benchling app        │
│                                            │
│  For help: npx @quiltdata/benchling-      │
│  webhook --help                            │
│                                            │
╰────────────────────────────────────────────╯
```

### Scenario 2: I Already Have a .env File

```bash
# Validate existing configuration
npx @quiltdata/benchling-webhook validate

# If validation passes, deploy
npx @quiltdata/benchling-webhook deploy
```

### Scenario 3: I Want to Override Existing .env

```bash
# Force overwrite with new configuration
npx @quiltdata/benchling-webhook init --force
```

---

## Deployment Scenarios

### Basic Deployment

```bash
# Deploy using .env file in current directory
npx @quiltdata/benchling-webhook deploy

# You'll be prompted to confirm:
# ✓ Configuration loaded and inferred
# ✓ Configuration validated
# ✓ CDK is bootstrapped (CREATE_COMPLETE)
#
# Deployment Plan
# ────────────────────────────────────────────
#   Stack:    BenchlingWebhookStack
#   Account:  123456789012
#   Region:   us-east-1
#   Catalog:  quilt-catalog.mycompany.com
#   Bucket:   mycompany-data-bucket
# ────────────────────────────────────────────
#
# ? Proceed with deployment? (Y/n)
```

### Deploy Without Confirmation

```bash
# For automation/CI/CD - skip confirmation prompt
npx @quiltdata/benchling-webhook deploy --yes
```

### Deploy with Custom .env File

```bash
# Use a different environment file
npx @quiltdata/benchling-webhook deploy --env-file .env.production
```

### Deploy to Specific Region

```bash
# Override region from .env
npx @quiltdata/benchling-webhook deploy --region us-west-2
```

### Deploy with AWS Profile

```bash
# Use a specific AWS profile
npx @quiltdata/benchling-webhook deploy --profile production

# Or set environment variable
export AWS_PROFILE=production
npx @quiltdata/benchling-webhook deploy
```

### Deploy with All Inline Options

```bash
# No .env file needed - everything as flags
npx @quiltdata/benchling-webhook deploy \
  --catalog quilt-catalog.company.com \
  --bucket my-data-bucket \
  --tenant mycompany \
  --client-id client_abc123 \
  --client-secret secret_xyz789 \
  --app-id appdef_123456 \
  --region us-east-1 \
  --yes
```

---

## Configuration Management

### View Current Configuration

```bash
# Validate shows all configuration values
npx @quiltdata/benchling-webhook validate --verbose
```

**Output:**

```
╭─────────────────────────────────╮
│                                 │
│  Configuration Validation       │
│                                 │
╰─────────────────────────────────╯

✓ Configuration loaded from: .env
✓ Configuration inferred from catalog
✓ Configuration is valid

Configuration Summary:
────────────────────────────────────────────

Required user values:
  ✓ quiltCatalog: quilt-catalog.mycompany.com
  ✓ quiltUserBucket: mycompany-data-bucket
  ✓ benchlingTenant: mycompany
  ✓ benchlingClientId: client_abc123
  ✓ benchlingClientSecret: ********
  ✓ benchlingAppDefinitionId: appdef_abc123

Inferred values:
  ✓ cdkAccount: 123456789012
  ✓ cdkRegion: us-east-1
  ✓ queueName: QuiltStack-PackagerQueue-ABC123
  ✓ sqsQueueUrl: https://sqs.us-east-1.amazonaws.com/123456789012/QuiltStack-PackagerQueue-ABC123
  ✓ quiltDatabase: quilt_catalog_mycompany_com_db

✓ AWS credentials configured (account: 123456789012)
✓ CDK is bootstrapped (CREATE_COMPLETE)

────────────────────────────────────────────

╭────────────────────────────────────╮
│                                    │
│  ✓ Configuration is valid!        │
│                                    │
│  Ready to deploy.                 │
│                                    │
│  Run: npx @quiltdata/benchling-   │
│  webhook deploy                    │
│                                    │
╰────────────────────────────────────╯
```

### Generate Configuration for Multiple Environments

```bash
# Create staging configuration
npx @quiltdata/benchling-webhook init --output .env.staging --infer

# Create production configuration
npx @quiltdata/benchling-webhook init --output .env.production --infer

# Deploy to staging
npx @quiltdata/benchling-webhook deploy --env-file .env.staging

# Deploy to production
npx @quiltdata/benchling-webhook deploy --env-file .env.production
```

### Export Configuration from Existing Deployment

```bash
# If you already have a Quilt catalog, infer everything automatically
npx @quiltdata/benchling-webhook init --infer

# This will:
# 1. Prompt for minimal required values (Benchling credentials)
# 2. Fetch config.json from your catalog
# 3. Query CloudFormation for stack details
# 4. Generate complete .env file
```

---

## Troubleshooting

### Check What's Wrong

```bash
# Validate configuration with verbose output
npx @quiltdata/benchling-webhook validate --verbose
```

### Missing Required Values

**Problem:**

```
❌ Configuration Error

Missing required parameters:
  • Benchling OAuth client ID - OAuth client ID from your Benchling app
  • Benchling OAuth client secret - OAuth client secret from your Benchling app
```

**Solution:**

```bash
# Option 1: Run init to set up interactively
npx @quiltdata/benchling-webhook init

# Option 2: Add to .env file
echo "BENCHLING_CLIENT_ID=client_abc123" >> .env
echo "BENCHLING_CLIENT_SECRET=secret_xyz789" >> .env

# Option 3: Pass as CLI options
npx @quiltdata/benchling-webhook deploy \
  --client-id client_abc123 \
  --client-secret secret_xyz789
```

### CDK Not Bootstrapped

**Problem:**

```
❌ CDK Bootstrap Error

CDK is not bootstrapped for account 123456789012 in region us-east-1.
```

**Solution:**

```bash
# Bootstrap CDK (one-time setup per account/region)
npx cdk bootstrap aws://123456789012/us-east-1

# Then deploy
npx @quiltdata/benchling-webhook deploy
```

### AWS Credentials Not Configured

**Problem:**

```
✗ AWS credentials not configured

To configure AWS credentials, run:
  aws configure
```

**Solution:**

```bash
# Option 1: Configure AWS CLI
aws configure
# (Enter your access key, secret key, region)

# Option 2: Use environment variables
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1

# Option 3: Use AWS profile
export AWS_PROFILE=your-profile-name
```

### Cannot Infer Configuration from Catalog

**Problem:**

```
⚠ Configuration loaded (inference failed: Could not connect to catalog)
```

**Solution:**

```bash
# Manually add inferred values to .env
cat >> .env << EOF
CDK_DEFAULT_ACCOUNT=123456789012
CDK_DEFAULT_REGION=us-east-1
QUEUE_NAME=QuiltStack-PackagerQueue-ABC123
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/QuiltStack-PackagerQueue-ABC123
QUILT_DATABASE=quilt_db
EOF

# Then deploy
npx @quiltdata/benchling-webhook deploy
```

### Wrong Bucket or Catalog

**Problem:** Deployed with wrong configuration

**Solution:**

```bash
# Update .env with correct values
nano .env

# Validate before redeploying
npx @quiltdata/benchling-webhook validate

# Deploy updated configuration
npx @quiltdata/benchling-webhook deploy
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Deploy Benchling Webhook

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Deploy Benchling Webhook
        env:
          QUILT_CATALOG: ${{ secrets.QUILT_CATALOG }}
          QUILT_USER_BUCKET: ${{ secrets.QUILT_USER_BUCKET }}
          BENCHLING_TENANT: ${{ secrets.BENCHLING_TENANT }}
          BENCHLING_CLIENT_ID: ${{ secrets.BENCHLING_CLIENT_ID }}
          BENCHLING_CLIENT_SECRET: ${{ secrets.BENCHLING_CLIENT_SECRET }}
          BENCHLING_APP_DEFINITION_ID: ${{ secrets.BENCHLING_APP_DEFINITION_ID }}
        run: |
          npx @quiltdata/benchling-webhook deploy --yes
```

### GitLab CI

```yaml
deploy:
  stage: deploy
  image: node:18
  script:
    - npm install -g npm@latest
    - |
      npx @quiltdata/benchling-webhook deploy \
        --catalog $QUILT_CATALOG \
        --bucket $QUILT_USER_BUCKET \
        --tenant $BENCHLING_TENANT \
        --client-id $BENCHLING_CLIENT_ID \
        --client-secret $BENCHLING_CLIENT_SECRET \
        --app-id $BENCHLING_APP_DEFINITION_ID \
        --yes
  only:
    - main
```

### Jenkins

```groovy
pipeline {
    agent any

    environment {
        AWS_REGION = 'us-east-1'
    }

    stages {
        stage('Deploy') {
            steps {
                withCredentials([
                    string(credentialsId: 'aws-access-key', variable: 'AWS_ACCESS_KEY_ID'),
                    string(credentialsId: 'aws-secret-key', variable: 'AWS_SECRET_ACCESS_KEY'),
                    string(credentialsId: 'quilt-catalog', variable: 'QUILT_CATALOG'),
                    string(credentialsId: 'benchling-client-id', variable: 'BENCHLING_CLIENT_ID'),
                    string(credentialsId: 'benchling-client-secret', variable: 'BENCHLING_CLIENT_SECRET')
                ]) {
                    sh '''
                        npx @quiltdata/benchling-webhook deploy \
                          --catalog $QUILT_CATALOG \
                          --bucket my-data-bucket \
                          --tenant mycompany \
                          --client-id $BENCHLING_CLIENT_ID \
                          --client-secret $BENCHLING_CLIENT_SECRET \
                          --app-id appdef_123456 \
                          --yes
                    '''
                }
            }
        }
    }
}
```

### Docker

```dockerfile
FROM node:18-slim

WORKDIR /app

# Install AWS CLI
RUN apt-get update && apt-get install -y \
    python3-pip \
    && pip3 install awscli \
    && rm -rf /var/lib/apt/lists/*

# Copy configuration
COPY .env .env

# Deploy
CMD ["npx", "@quiltdata/benchling-webhook", "deploy", "--yes"]
```

**Run:**

```bash
# Build
docker build -t benchling-webhook-deploy .

# Run with AWS credentials
docker run --rm \
  -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
  benchling-webhook-deploy
```

---

## Advanced Usage

### Multi-Environment Deployment

```bash
# Create environment-specific configs
npx @quiltdata/benchling-webhook init --output .env.dev
npx @quiltdata/benchling-webhook init --output .env.staging
npx @quiltdata/benchling-webhook init --output .env.prod

# Deploy to each environment
npx @quiltdata/benchling-webhook deploy --env-file .env.dev
npx @quiltdata/benchling-webhook deploy --env-file .env.staging
npx @quiltdata/benchling-webhook deploy --env-file .env.prod
```

### Deploy with Custom CDK Options

```bash
# Deploy with CDK approval requirements
npx @quiltdata/benchling-webhook deploy --require-approval broadening

# Deploy without bootstrap check (if you know it's already done)
npx @quiltdata/benchling-webhook deploy --no-bootstrap-check
```

### Use as Imported Module

**setup.ts:**

```typescript
import {
  createStack,
  checkCdkBootstrap,
  inferConfiguration,
} from '@quiltdata/benchling-webhook';
import { loadConfigSync, validateConfig } from '@quiltdata/benchling-webhook/utils';

async function main() {
  // Load config
  const config = loadConfigSync({ envFile: '.env.production' });

  // Infer additional values
  if (config.quiltCatalog) {
    const inferred = await inferConfiguration(config.quiltCatalog);
    Object.assign(config, inferred.inferredVars);
  }

  // Validate
  const validation = validateConfig(config);
  if (!validation.valid) {
    console.error('Configuration invalid:', validation.errors);
    process.exit(1);
  }

  // Check bootstrap
  const bootstrap = await checkCdkBootstrap(config.cdkAccount!, config.cdkRegion!);
  if (!bootstrap.bootstrapped) {
    console.error('CDK not bootstrapped:', bootstrap.message);
    process.exit(1);
  }

  // Create stack
  const result = createStack(config as Config);
  console.log('Stack created:', result.stackName);

  // Deploy using CDK
  // ... your custom deployment logic ...
}

main();
```

### Programmatic Configuration Generation

**generate-configs.ts:**

```typescript
import { writeFileSync } from 'fs';

// Generate configs for multiple tenants
const tenants = ['acme', 'globex', 'initech'];

for (const tenant of tenants) {
  const config = `
QUILT_CATALOG=${tenant}-catalog.mycompany.com
QUILT_USER_BUCKET=${tenant}-data-bucket
BENCHLING_TENANT=${tenant}
BENCHLING_CLIENT_ID=\${${tenant.toUpperCase()}_CLIENT_ID}
BENCHLING_CLIENT_SECRET=\${${tenant.toUpperCase()}_CLIENT_SECRET}
BENCHLING_APP_DEFINITION_ID=\${${tenant.toUpperCase()}_APP_ID}
`;

  writeFileSync(`.env.${tenant}`, config.trim());
  console.log(`Created .env.${tenant}`);
}
```

**Deploy all:**

```bash
# Generate configs
npx ts-node generate-configs.ts

# Deploy each tenant
for env in .env.*; do
  echo "Deploying ${env}..."
  npx @quiltdata/benchling-webhook deploy --env-file $env --yes
done
```

### Pre-flight Checks Script

**pre-deploy.sh:**

```bash
#!/bin/bash
set -e

echo "=== Pre-Deployment Checks ==="

# 1. Validate configuration
echo "Checking configuration..."
npx @quiltdata/benchling-webhook validate --verbose

# 2. Check AWS access
echo "Checking AWS access..."
aws sts get-caller-identity

# 3. Check CDK bootstrap
echo "Checking CDK bootstrap..."
aws cloudformation describe-stacks \
  --stack-name CDKToolkit \
  --query 'Stacks[0].StackStatus' \
  --output text

# 4. Check S3 bucket exists
echo "Checking S3 bucket..."
BUCKET=$(grep QUILT_USER_BUCKET .env | cut -d= -f2)
aws s3 ls s3://$BUCKET

# 5. Check Quilt catalog
echo "Checking Quilt catalog..."
CATALOG=$(grep QUILT_CATALOG .env | cut -d= -f2)
curl -f https://$CATALOG/config.json > /dev/null

echo "=== All checks passed! ==="
echo "Ready to deploy."
```

### Deployment with Health Check

**deploy-and-verify.sh:**

```bash
#!/bin/bash
set -e

# Deploy
echo "Deploying..."
npx @quiltdata/benchling-webhook deploy --yes

# Wait for stack to be ready
echo "Waiting for stack to stabilize..."
sleep 30

# Get webhook URL from stack outputs
WEBHOOK_URL=$(aws cloudformation describe-stacks \
  --stack-name BenchlingWebhookStack \
  --query 'Stacks[0].Outputs[?OutputKey==`WebhookUrl`].OutputValue' \
  --output text)

# Health check
echo "Checking webhook health..."
curl -f ${WEBHOOK_URL}/health

echo "Deployment successful and verified!"
```

### Rollback on Failure

**safe-deploy.sh:**

```bash
#!/bin/bash

# Get current stack status
CURRENT_STATUS=$(aws cloudformation describe-stacks \
  --stack-name BenchlingWebhookStack \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NONE")

echo "Current stack status: $CURRENT_STATUS"

# Deploy with error handling
if npx @quiltdata/benchling-webhook deploy --yes; then
  echo "Deployment successful!"
else
  echo "Deployment failed! Rolling back..."

  if [ "$CURRENT_STATUS" != "NONE" ]; then
    aws cloudformation cancel-update-stack --stack-name BenchlingWebhookStack || true

    echo "Waiting for rollback to complete..."
    aws cloudformation wait stack-rollback-complete --stack-name BenchlingWebhookStack

    echo "Rollback completed"
  fi

  exit 1
fi
```

---

## Common Workflows

### Workflow 1: New Project Setup

```bash
# 1. Initialize configuration
npx @quiltdata/benchling-webhook init --infer

# 2. Review generated .env
cat .env

# 3. Make any manual adjustments
nano .env

# 4. Validate configuration
npx @quiltdata/benchling-webhook validate --verbose

# 5. Bootstrap CDK (if needed)
# (validate command will tell you if this is needed)
npx cdk bootstrap

# 6. Deploy
npx @quiltdata/benchling-webhook deploy

# 7. Test webhook
curl https://your-webhook-url/health
```

### Workflow 2: Update Existing Deployment

```bash
# 1. Validate current configuration
npx @quiltdata/benchling-webhook validate

# 2. Update .env with new values
nano .env

# 3. Validate changes
npx @quiltdata/benchling-webhook validate

# 4. Deploy update
npx @quiltdata/benchling-webhook deploy
```

### Workflow 3: Clone Configuration from Another Environment

```bash
# 1. Export configuration from existing deployment
# (manually or use AWS Console to get values)

# 2. Create new .env file
cp .env.prod .env.staging

# 3. Update environment-specific values
nano .env.staging

# 4. Deploy to new environment
npx @quiltdata/benchling-webhook deploy --env-file .env.staging
```

### Workflow 4: Migrate from Repository-Based to npx

**Old way:**

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install
source .env
npm run deploy
```

**New way:**

```bash
# Just copy your .env file to a new directory
mkdir benchling-webhook-deploy
cd benchling-webhook-deploy
cp /path/to/old/.env .env

# Deploy
npx @quiltdata/benchling-webhook deploy
```

---

## Tips and Best Practices

### Tip 1: Keep Credentials Secure

```bash
# Never commit .env files
echo ".env*" >> .gitignore

# Use AWS Secrets Manager for CI/CD
aws secretsmanager create-secret \
  --name benchling-webhook/credentials \
  --secret-string file://.env
```

### Tip 2: Use Separate AWS Accounts for Environments

```bash
# Development account
export AWS_PROFILE=dev
npx @quiltdata/benchling-webhook deploy --env-file .env.dev

# Production account
export AWS_PROFILE=prod
npx @quiltdata/benchling-webhook deploy --env-file .env.prod
```

### Tip 3: Test Configuration Before Deploying

```bash
# Always validate first
npx @quiltdata/benchling-webhook validate --verbose

# Only deploy if validation passes
npx @quiltdata/benchling-webhook validate && \
  npx @quiltdata/benchling-webhook deploy
```

### Tip 4: Use Version Pinning in CI/CD

```bash
# Pin to specific version for reproducibility
npx @quiltdata/benchling-webhook@0.6.0 deploy --yes

# Or install globally first
npm install -g @quiltdata/benchling-webhook@0.6.0
benchling-webhook deploy --yes
```

### Tip 5: Automate Multi-Environment Deployments

**deploy-all.sh:**

```bash
#!/bin/bash

ENVIRONMENTS="dev staging prod"

for ENV in $ENVIRONMENTS; do
  echo "Deploying to $ENV..."

  if npx @quiltdata/benchling-webhook deploy --env-file .env.$ENV --yes; then
    echo "✓ $ENV deployment successful"
  else
    echo "✗ $ENV deployment failed"
    exit 1
  fi

  echo ""
done

echo "All environments deployed successfully!"
```

---

## FAQ

### Q: Do I need to clone the repository?

**A:** No! That's the whole point of the CLI. Just run:

```bash
npx @quiltdata/benchling-webhook init
npx @quiltdata/benchling-webhook deploy
```

### Q: Can I still use the old method?

**A:** Yes, the old method still works:

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install
npm run deploy
```

### Q: Where does npx download the package?

**A:** npx downloads to a temporary cache. You don't need to worry about it.

### Q: Can I use this in CI/CD?

**A:** Absolutely! See the [CI/CD Integration](#cicd-integration) section.

### Q: How do I update to the latest version?

**A:** npx always uses the latest version by default. To pin a version:

```bash
npx @quiltdata/benchling-webhook@0.6.0 deploy
```

### Q: Can I deploy to multiple regions?

**A:** Yes, use different .env files or CLI options:

```bash
npx @quiltdata/benchling-webhook deploy --region us-west-2
npx @quiltdata/benchling-webhook deploy --region eu-west-1
```

### Q: How do I debug issues?

**A:** Use the validate command with verbose output:

```bash
npx @quiltdata/benchling-webhook validate --verbose
```

### Q: Can I use this as a library in my code?

**A:** Yes! See [Advanced Usage](#advanced-usage) for examples.

---

## Getting Help

```bash
# General help
npx @quiltdata/benchling-webhook --help

# Command-specific help
npx @quiltdata/benchling-webhook deploy --help
npx @quiltdata/benchling-webhook init --help
npx @quiltdata/benchling-webhook validate --help

# Validate configuration and see detailed errors
npx @quiltdata/benchling-webhook validate --verbose

# GitHub issues
# https://github.com/quiltdata/benchling-webhook/issues

# Documentation
# https://github.com/quiltdata/benchling-webhook#readme
```
