# Deployment Guide

## Quick Deployment Checklist

- [ ] Environment variables configured in `.env`
- [ ] AWS credentials configured
- [ ] Docker image built and pushed to ECR
- [ ] CDK bootstrap completed (first time only)
- [ ] Deploy using enhanced deployment script
- [ ] Verify deployment outputs in `.env.deploy`
- [ ] Configure webhook URL in Benchling
- [ ] Test webhook endpoint

## Deployment Methods

### Method 1: Enhanced Deployment Script (Recommended)

The enhanced deployment script automatically captures all CDK outputs to `.env.deploy`:

```bash
# Load environment
source .env

# Deploy with tests
npm run deploy

# Or deploy without tests (faster)
npm run deploy:skip-tests

# View captured outputs
cat .env.deploy
```

**Benefits:**
- Automatically captures webhook endpoint URL
- Saves Docker image information
- Records deployment timestamp
- Easy to reference for Benchling configuration

### Method 2: Direct CDK Deployment

```bash
source .env
npm run cdk
```

### Method 3: Using npx

```bash
npx benchling-webhook-deploy
```

## Post-Deployment

After deployment, you'll find key information in `.env.deploy`:

```bash
# View webhook endpoint for Benchling configuration
cat .env.deploy | grep WEBHOOK_ENDPOINT

# View Docker image being used
cat .env.deploy | grep DOCKER_IMAGE_URI

# View ECS service information
cat .env.deploy | grep ECS_
```

## Webhook Endpoint Configuration

1. Get webhook endpoint:
   ```bash
   source .env.deploy
   echo $WEBHOOK_ENDPOINT
   ```

2. Configure in Benchling:
   - Go to Benchling Developer Console
   - Navigate to your app
   - Set Webhook URL to the value from `WEBHOOK_ENDPOINT`

## Verification

```bash
# Test health endpoint
source .env.deploy
curl $WEBHOOK_ENDPOINT/health

# Expected response: 200 OK
```

## Rollback

If you need to rollback to a previous version:

1. Check available versions:
   ```bash
   npm run docker-check
   ```

2. Update CDK stack to use specific version:
   - Edit `lib/benchling-webhook-stack.ts`
   - Change image tag to desired version

3. Redeploy:
   ```bash
   npm run deploy
   ```

## Monitoring

### View Logs

```bash
source .env.deploy
aws logs tail /ecs/benchling-webhook --follow --region $CDK_REGION
```

### Check Service Status

```bash
source .env.deploy
aws ecs describe-services \
  --cluster $ECS_CLUSTER_NAME \
  --services $ECS_SERVICE_NAME \
  --region $CDK_REGION
```

## Troubleshooting

### Deployment Fails

1. Check environment variables:
   ```bash
   source .env
   env | grep CDK
   ```

2. Verify AWS credentials:
   ```bash
   aws sts get-caller-identity
   ```

3. Check CDK diff:
   ```bash
   npm run diff
   ```

### Docker Image Issues

1. Verify image exists:
   ```bash
   npm run docker-check
   ```

2. Rebuild if needed:
   ```bash
   npm run docker-push
   ```

### Service Not Responding

1. Check ECS tasks:
   ```bash
   source .env.deploy
   aws ecs list-tasks --cluster $ECS_CLUSTER_NAME
   ```

2. View container logs:
   ```bash
   aws logs tail /ecs/benchling-webhook --region $CDK_REGION
   ```

3. Check ALB health:
   ```bash
   source .env.deploy
   curl http://$ALB_DNS_NAME/health
   ```

## Best Practices

1. **Always use the deployment script** to capture outputs
2. **Keep `.env.deploy` in sync** with your current deployment
3. **Test locally first** using `npm run docker-health`
4. **Monitor logs** after deployment for any errors
5. **Version your Docker images** properly
6. **Document changes** in RELEASE_NOTES.md

## Security Checklist

- [ ] Benchling credentials stored in Secrets Manager
- [ ] IP allowlist configured if needed
- [ ] ECR image scanning enabled
- [ ] Security groups properly configured
- [ ] IAM roles follow least privilege
- [ ] CloudWatch logging enabled

## Performance Optimization

- Auto-scaling configured: 2-10 tasks
- CPU target: 70%
- Memory target: 80%
- Health check grace period: 60s
- Deregistration delay: 30s

Monitor and adjust these settings based on your workload.
