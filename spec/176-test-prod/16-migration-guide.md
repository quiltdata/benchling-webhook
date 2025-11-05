# Multi-Environment Migration Guide

**Target Audience**: Existing Benchling Webhook users upgrading to multi-environment support

**Version**: v0.7.0+

**Last Updated**: 2025-11-04

---

## Overview

This guide helps existing users migrate to the new multi-environment architecture that supports running development and production environments simultaneously.

**What's New:**
- API Gateway stages (dev and prod)
- Configuration profiles for different environments
- Simultaneous deployment of dev and prod services
- Independent testing and deployment workflows

**What's the Same:**
- Existing production deployments continue working
- No changes to Benchling integration or webhook URLs
- Same AWS resources (VPC, ECS cluster, ALB)
- XDG configuration structure remains compatible

---

## Do I Need to Migrate?

### No Migration Required If:

You are an end user who:
- Only runs production deployments
- Uses `npx @quiltdata/benchling-webhook@latest` for setup
- Deploys with default settings
- Does not need a separate development environment

**Action**: Update to latest version. Everything continues working as before.

```bash
npx @quiltdata/benchling-webhook@latest deploy
npx @quiltdata/benchling-webhook@latest test
```

### Optional Migration If:

You are a maintainer or developer who:
- Wants to test changes before production deployment
- Needs separate Benchling apps for dev and prod
- Wants to validate updates in isolated environment
- Develops features that require live testing

**Action**: Follow migration steps below to add dev environment.

---

## Migration Scenarios

### Scenario 1: Production-Only User (No Action Required)

**Before (v0.6.x)**:
```bash
npx @quiltdata/benchling-webhook@latest        # Setup
npx @quiltdata/benchling-webhook@latest deploy # Deploy
npx @quiltdata/benchling-webhook@latest test   # Test
```

**After (v0.7.0+)**:
```bash
npx @quiltdata/benchling-webhook@latest        # Setup (same)
npx @quiltdata/benchling-webhook@latest deploy # Deploy (same)
npx @quiltdata/benchling-webhook@latest test   # Test (same)
```

**What Changed**: Nothing! Your workflow is identical.

**Under the Hood**: The stack now creates a `prod` API Gateway stage and routes to `benchling-webhook-prod` ECS service, but this is transparent to you.

---

### Scenario 2: Add Dev Environment (Maintainers)

**Goal**: Add a development environment alongside existing production.

**Time Required**: 15 minutes

**Prerequisites**:
- Existing production deployment (v0.6.x)
- Benchling dev app created (different app ID from production)
- (Optional) Separate Quilt stack for dev environment

#### Step 1: Verify Current Production Setup

```bash
# Check your current configuration
cat ~/.config/benchling-webhook/default.json

# Verify production is deployed
cat ~/.config/benchling-webhook/deploy.json
```

**Expected**: You should see production configuration in `default.json` and deployment info in `deploy.json`.

#### Step 2: Update to Latest Version

```bash
# If installed globally
npm update -g @quiltdata/benchling-webhook

# If using npx (recommended)
npx @quiltdata/benchling-webhook@latest --version
```

**Expected**: Version v0.7.0 or higher.

#### Step 3: Create Dev Profile

```bash
npx @quiltdata/benchling-webhook@latest setup-profile dev
```

**Prompts**:
1. Benchling App Definition ID: Enter your **dev** app ID (e.g., `app_DEV_67890`)
2. Docker image tag: Enter `latest` (dev uses latest builds)
3. Quilt Stack ARN: Use same as prod, or different staging stack
4. Other settings: Copy from production profile

**Output**:
```
✅ Created profile: ~/.config/benchling-webhook/dev.json
```

#### Step 4: Edit Dev Profile (Optional)

```bash
# Edit dev-specific settings
nano ~/.config/benchling-webhook/dev.json
```

**Common Changes**:
- `benchlingAppDefinitionId`: Different app ID for dev
- `imageTag`: `"latest"` for dev, semantic version for prod
- `quiltStackArn`: Point to staging Quilt stack (optional)
- `benchlingSecret`: Auto-generated with dev profile name

**Example**:
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

#### Step 5: Sync Dev Secrets to AWS

```bash
npx @quiltdata/benchling-webhook@latest setup --profile dev
```

This creates a new secret in AWS Secrets Manager:
- `quiltdata/benchling-webhook/dev/my-company`

**Verify**:
```bash
aws secretsmanager describe-secret --secret-id quiltdata/benchling-webhook/dev/my-company
```

#### Step 6: Deploy Dev Environment

```bash
npx @quiltdata/benchling-webhook@latest deploy --profile dev
```

**What Happens**:
1. Builds Docker image with `latest` tag
2. Pushes to ECR
3. Updates CloudFormation stack (adds dev service and stage)
4. Creates `benchling-webhook-dev` ECS service
5. Creates `dev` API Gateway stage
6. Writes deployment info to `deploy.json`

**Expected Output**:
```
✅ Deployment complete
   Dev endpoint: https://abc123.execute-api.us-east-1.amazonaws.com/dev

Next steps:
1. Install webhook URL in Benchling dev app
2. Test with: npx @quiltdata/benchling-webhook@latest test --profile dev
```

#### Step 7: Test Dev Environment

```bash
npx @quiltdata/benchling-webhook@latest test --profile dev
```

**Expected**: Tests pass against dev endpoint.

#### Step 8: Verify Production Unchanged

```bash
npx @quiltdata/benchling-webhook@latest test --profile default
```

**Expected**: Production still works. Both environments are now running simultaneously!

---

### Scenario 3: Repository Developers (Advanced)

**Goal**: Set up local development environment with both dev and prod profiles.

**Time Required**: 20 minutes

**Prerequisites**:
- Repository cloned locally
- AWS credentials configured
- Docker installed

#### Step 1: Clone and Setup

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm run setup
```

#### Step 2: Create Dev Profile

```bash
npm run setup:profile dev
```

Edit `~/.config/benchling-webhook/dev.json` as needed.

#### Step 3: Local Testing

```bash
# Fast unit tests
npm run test

# Local Docker integration
npm run test:local
```

#### Step 4: Deploy Dev Environment

```bash
npm run deploy:dev
```

This uses the dev profile automatically (no `--profile` flag needed).

#### Step 5: Test Dev Deployment

```bash
npm run test:dev
```

#### Step 6: Deploy Production (When Ready)

```bash
# Tag version
npm run version:tag

# Wait for CI to build

# Deploy to production
npm run deploy:prod
```

---

## Configuration File Mapping

### Before (v0.6.x)

```
~/.config/benchling-webhook/
├── default.json    # All settings
└── deploy.json     # Single environment tracking
```

**deploy.json structure:**
```json
{
  "endpoint": "https://...",
  "imageTag": "0.6.3",
  "deployedAt": "2025-11-04T12:00:00.000Z"
}
```

### After (v0.7.0+)

```
~/.config/benchling-webhook/
├── default.json    # Production profile (unchanged)
├── dev.json        # Development profile (new, optional)
└── deploy.json     # Multi-environment tracking
```

**deploy.json structure:**
```json
{
  "prod": {
    "endpoint": "https://.../prod",
    "imageTag": "0.6.3",
    "deployedAt": "2025-11-04T12:00:00.000Z",
    "stackName": "BenchlingWebhookStack",
    "stage": "prod"
  },
  "dev": {
    "endpoint": "https://.../dev",
    "imageTag": "latest",
    "deployedAt": "2025-11-04T12:00:00.000Z",
    "stackName": "BenchlingWebhookStack",
    "stage": "dev"
  }
}
```

---

## AWS Resource Changes

### Before (v0.6.x)

```
BenchlingWebhookStack
├── API Gateway
│   └── Stage: prod (only)
├── ALB
│   └── Target Group: (single)
└── ECS Service: benchling-webhook (single)
```

### After (v0.7.0+)

```
BenchlingWebhookStack
├── API Gateway
│   ├── Stage: prod
│   └── Stage: dev (if dev profile exists)
├── ALB
│   ├── Target Group: prod-targets
│   └── Target Group: dev-targets (if dev profile exists)
├── ECS Service: benchling-webhook-prod
└── ECS Service: benchling-webhook-dev (if dev profile exists)
```

**Key Points**:
- Same stack name (`BenchlingWebhookStack`)
- No data loss or downtime during migration
- Dev resources only created if dev profile exists

---

## Cost Impact

### Production-Only (No Migration)

**Before**: ~$70-100/month
**After**: ~$70-100/month
**Change**: No change

### Production + Development

**Before**: ~$70-100/month (production only)
**After**: ~$85-145/month (production + dev)
**Change**: +$15-45/month (+15-45%)

**Cost Breakdown**:
| Resource | Single Env | Dual Env | Change |
|----------|-----------|----------|--------|
| ALB | $23 | $23 | Shared |
| NAT Gateway | $32 | $32 | Shared |
| ECS Fargate | $15-45 | $30-90 | +$15-45 |
| **Total** | **$70-100** | **$85-145** | **+15-45%** |

---

## Rollback Procedure

If you encounter issues, you can rollback to production-only mode:

### Option 1: Remove Dev Profile (Keep Infrastructure)

```bash
# Stop using dev profile
rm ~/.config/benchling-webhook/dev.json

# Redeploy (will only deploy prod)
npx @quiltdata/benchling-webhook@latest deploy
```

**Result**: Dev ECS service stops receiving traffic but remains in stack.

### Option 2: Full Rollback (Remove Dev Infrastructure)

```bash
# 1. Remove dev profile
rm ~/.config/benchling-webhook/dev.json

# 2. Update stack to remove dev resources
npx @quiltdata/benchling-webhook@latest deploy --remove-dev

# 3. Verify production works
npx @quiltdata/benchling-webhook@latest test
```

**Result**: Dev ECS service and API Gateway stage removed from stack.

### Option 3: Downgrade Version

```bash
# Install previous version
npm install -g @quiltdata/benchling-webhook@0.6.3

# Deploy previous version
benchling-webhook deploy
```

**Result**: Stack returns to v0.6.x configuration.

---

## Troubleshooting

### Issue: "Profile not found" error

**Symptom**:
```
Error: Profile 'dev' not found in ~/.config/benchling-webhook/
```

**Solution**:
```bash
# Create missing profile
npx @quiltdata/benchling-webhook@latest setup-profile dev
```

---

### Issue: Dev endpoint returns 404

**Symptom**: Dev endpoint URL returns 404 Not Found

**Diagnosis**:
```bash
# Check if dev stage exists
aws apigateway get-stages --rest-api-id <api-id>

# Check if dev service is running
aws ecs list-services --cluster benchling-webhook-cluster
```

**Solution**:
```bash
# Redeploy to ensure dev stage is created
npx @quiltdata/benchling-webhook@latest deploy --profile dev
```

---

### Issue: Production endpoint changed

**Symptom**: Existing Benchling webhook URL no longer works

**Diagnosis**:
```bash
# Check new production endpoint
jq -r '.prod.endpoint' ~/.config/benchling-webhook/deploy.json
```

**Solution**: Update webhook URL in Benchling app settings to new endpoint with `/prod` path.

**Before**: `https://abc123.execute-api.us-east-1.amazonaws.com/event`
**After**: `https://abc123.execute-api.us-east-1.amazonaws.com/prod/event`

---

### Issue: Secrets not synced for dev profile

**Symptom**: Dev deployment fails with "Secret not found"

**Diagnosis**:
```bash
# Check if dev secret exists
aws secretsmanager describe-secret --secret-id quiltdata/benchling-webhook/dev/my-company
```

**Solution**:
```bash
# Sync secrets for dev profile
npx @quiltdata/benchling-webhook@latest setup --profile dev
```

---

### Issue: Higher AWS costs than expected

**Symptom**: AWS bill increased significantly after upgrade

**Diagnosis**:
```bash
# Check running services
aws ecs list-services --cluster benchling-webhook-cluster

# Check service task count
aws ecs describe-services --cluster benchling-webhook-cluster --services benchling-webhook-dev
```

**Solution**:
If you don't need dev environment:
```bash
# Remove dev profile to reduce costs
rm ~/.config/benchling-webhook/dev.json
npx @quiltdata/benchling-webhook@latest deploy
```

Or adjust dev auto-scaling to lower minimums in CDK configuration.

---

## Backward Compatibility

### Existing Commands (Unchanged)

All existing commands continue working:

```bash
npx @quiltdata/benchling-webhook@latest        # Setup (uses default profile)
npx @quiltdata/benchling-webhook@latest deploy # Deploy (uses default profile)
npx @quiltdata/benchling-webhook@latest test   # Test (uses default profile)
```

### New Optional Flags

New `--profile` flag is optional:

```bash
npx @quiltdata/benchling-webhook@latest deploy --profile dev
npx @quiltdata/benchling-webhook@latest test --profile dev
```

### Repository npm Scripts

For developers working in the repository:

**Unchanged**:
```bash
npm run test              # Unit tests
npm run test:local        # Local integration
npm run deploy:prod       # Production deployment
npm run test:prod         # Production tests
```

**New**:
```bash
npm run setup:profile dev # Create dev profile
npm run deploy:dev        # Dev deployment
npm run test:dev          # Dev tests
```

---

## Best Practices

### Profile Naming

- `default`: Always production
- `dev`: Development environment
- `staging`: Optional staging environment
- Custom names: Supported but document clearly

### Image Tagging

- **Dev**: Use `latest` for rapid iteration
- **Prod**: Use semantic versions (e.g., `v0.7.0`)
- **Staging**: Use release candidates (e.g., `v0.7.0-rc.1`)

### Benchling App Setup

- Create separate Benchling apps for dev and prod
- Use descriptive names (e.g., "Quilt Integration - Dev")
- Document which app ID maps to which profile

### Testing Workflow

```bash
# 1. Local development
npm run test
npm run test:local

# 2. Deploy to dev
npm run deploy:dev

# 3. Test dev deployment
npm run test:dev

# 4. After validation, deploy to prod
npm run deploy:prod

# 5. Test prod deployment
npm run test:prod
```

---

## FAQ

### Q: Will my production deployment be affected?

**A**: No. Existing production deployments continue working without changes. The migration only adds new dev infrastructure if you create a dev profile.

### Q: Do I need to recreate my Benchling app?

**A**: No. Your existing Benchling app continues working with the production environment. Only create a new Benchling app if you want a separate dev environment.

### Q: Can I use the same Quilt stack for dev and prod?

**A**: Yes. Both profiles can point to the same Quilt stack. Packages will be stored in the same S3 bucket but can be distinguished by metadata or prefixes.

### Q: What happens if I don't create a dev profile?

**A**: Nothing changes. The system behaves exactly as before, deploying only the production environment.

### Q: Can I have more than two environments?

**A**: Yes. You can create profiles for `staging`, `qa`, etc. Each profile gets its own API Gateway stage and ECS service.

### Q: Do I need separate AWS accounts?

**A**: No. Multi-environment support runs everything in one AWS account and one CloudFormation stack. For strict compliance, separate AWS accounts are still supported.

### Q: How do I monitor dev vs prod separately?

**A**: CloudWatch logs are separated by service:
- Dev: `/ecs/benchling-webhook-dev`
- Prod: `/ecs/benchling-webhook-prod`

### Q: Can I delete the dev environment later?

**A**: Yes. Delete the dev profile and redeploy. The dev resources will be removed from the stack.

---

## Next Steps

After successful migration:

1. **Update CI/CD**: Modify GitHub Actions or deployment scripts to use new profile flags
2. **Document URLs**: Update internal documentation with dev and prod webhook URLs
3. **Train Team**: Share this guide with team members who deploy webhooks
4. **Monitor Costs**: Track AWS costs for first month to verify budget alignment
5. **Provide Feedback**: Report issues or suggestions to improve multi-environment support

---

## Support

- **Issues**: [GitHub Issues](https://github.com/quiltdata/benchling-webhook/issues)
- **Discussions**: [GitHub Discussions](https://github.com/quiltdata/benchling-webhook/discussions)
- **Documentation**: [README.md](../../README.md) and [CLAUDE.md](../../CLAUDE.md)
- **Specification**: [13-multi-environment-architecture-spec.md](./13-multi-environment-architecture-spec.md)
