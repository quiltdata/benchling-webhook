# Migration Guide

## v1.0.0: HTTP API v2 with Lambda Authorizer (2025-11-28)

Version 1.0.0 restores Lambda Authorizer for proper HMAC signature verification. This requires HTTP API v2 (not REST API) because REST API Lambda Authorizers cannot access the request body, which is required to verify Benchling webhook signatures.

### Why This Migration Is Required

**Technical Reason:**
- Benchling HMAC signatures are computed over the **entire request body**
- Lambda Authorizer needs body to verify: `HMAC(secret, body) == signature`
- REST API Lambda Authorizers **cannot access request body** (only headers/query params)
- HTTP API v2 Lambda Authorizers **can access request body** via `event['body']` field
- Result: HTTP API v2 is the only architecture that supports proper webhook signature verification

### What Changed

**Architecture:**
- **Before (v0.9.0):** HTTP API v2 → VPC Link → Cloud Map → ECS (no authorizer)
- **After (v1.0.0):** HTTP API v2 → Lambda Authorizer → VPC Link → Cloud Map → ECS

**Components Added:**
- Lambda Authorizer for HMAC signature verification
- CloudWatch log group `/aws/lambda/BenchlingWebhookAuthorizer`

**Endpoint URL Format (no change from v0.9.0):**
- Format: `https://{api-id}.execute-api.{region}.amazonaws.com/webhook`
- No stage prefix in URL path

**Security:**
- Defense-in-depth: Both Lambda Authorizer and FastAPI verify HMAC signatures
- Invalid signatures rejected at Lambda layer (403 Forbidden) before reaching ECS
- Detailed logging in CloudWatch for all authorization attempts

### Upgrade Steps

**1. Backup Configuration**

```bash
cp ~/.config/benchling-webhook/{profile}/config.json ~/backup-config.json
```

**2. Destroy Old Stack**

The stack must be destroyed and recreated to add the Lambda Authorizer (in-place update not supported).

```bash
npx cdk destroy --profile {profile} --context stage={stage}
```

**3. Deploy New Stack**

```bash
# For production
npm run deploy:prod -- --profile default --yes

# For dev
npm run deploy:dev -- --profile dev --yes

# For custom profiles
npm run deploy:{stage} -- --profile {profile} --yes
```

**4. Update Benchling Webhook URL**

The endpoint URL format is the same as v0.9.0, but you'll have a new API Gateway ID:

- Copy new endpoint from deployment output
- Update in Benchling app configuration
- Format: `https://{api-id}.execute-api.{region}.amazonaws.com/webhook`

**5. Verify Deployment**

```bash
# Test the deployment
npm run test:{stage} -- --profile {profile}

# Check Lambda Authorizer logs
aws logs tail /aws/lambda/BenchlingWebhookAuthorizer --follow

# Check ECS application logs
aws logs tail /ecs/benchling-webhook --follow
```

### Monitoring

**New Log Groups:**

- `/aws/lambda/BenchlingWebhookAuthorizer` - Lambda Authorizer logs (HMAC verification)
- `/aws/apigateway/benchling-webhook-http` - API Gateway access logs (existing)
- `/ecs/benchling-webhook` - ECS container logs (existing)

**View all logs:**

```bash
npx @quiltdata/benchling-webhook logs --profile {profile}
```

### Troubleshooting

**403 Forbidden Errors:**

If webhooks are rejected with 403 status:

1. Check Lambda Authorizer logs:
   ```bash
   aws logs tail /aws/lambda/BenchlingWebhookAuthorizer --follow
   ```

2. Verify Benchling secret matches deployed secret:
   ```bash
   aws secretsmanager get-secret-value --secret-id {secretArn} --query SecretString
   ```

3. Test HMAC verification locally:
   ```bash
   npm run test:lambda-bundle
   ```

**Missing Lambda Authorizer:**

If Lambda Authorizer is not created during deployment:

1. Check CDK synthesis output for errors
2. Verify IAM permissions allow Lambda creation
3. Check CloudFormation events for stack creation failures

### Rollback

To roll back to v0.9.0 (no Lambda Authorizer):

1. Destroy v1.0.0 stack:
   ```bash
   npx cdk destroy --profile {profile} --context stage={stage}
   ```

2. Deploy v0.9.0:
   ```bash
   npm install @quiltdata/benchling-webhook@0.9.0
   npm run deploy:{stage} -- --profile {profile} --yes
   ```

3. Update Benchling webhook URL to the v0.9.0 endpoint

**Note:** v0.9.0 does not have Lambda Authorizer, so all HMAC verification happens in FastAPI only.

### Cost Impact

- **Monthly savings:** -$16.20 (NLB removed, no new costs from Lambda Authorizer)
- **Lambda costs:** ~$0.20 per million invocations (negligible for typical webhook volumes)

---

## v0.9.0: HTTP API + VPC Link (2025-11-24)

This release replaces the REST API + ALB architecture with an HTTP API that connects to ECS through a VPC Link and Cloud Map. The FastAPI service now listens on port **8080**. These changes require a fresh stack because REST and HTTP APIs cannot be swapped in-place.

### Automatic Detection

**v0.9.0 automatically detects v0.8.x stacks** and prevents in-place updates. If you attempt to deploy v0.9.0 over a v0.8.x stack, the deployment will fail with clear instructions on how to migrate safely.

### What Changed

- API Gateway **HTTP API** + **VPC Link** + **Cloud Map** replace REST API + ALB
- Fargate tasks register in `benchling.local` and serve FastAPI on port **8080**
- New API access log group: `/aws/apigateway/benchling-webhook-http`
- ALB resources (listeners, target groups, log bucket) removed

### Upgrade Steps

1. **Prepare downtime window**: the stack must be recreated to switch from REST to HTTP API.

2. **Destroy the existing v0.8.x stack** (REST API cannot be migrated in-place):

   ```bash
   npx @quiltdata/benchling-webhook destroy --profile <profile> --stage <stage>
   ```

3. **Deploy v0.9.0**:

   ```bash
   # For production
   npx @quiltdata/benchling-webhook deploy --stage prod

   # For dev
   npx @quiltdata/benchling-webhook deploy --stage dev --profile dev
   ```

4. **Update Benchling webhook URL** in your Benchling app to the new HTTP API endpoint output by the stack.

5. **Validate** (for local testing with source code):
   - `npm run test:local` (Docker dev on port 8082)
   - `npm run test:local:prod` (Docker prod on port 8083)
   - `npm run test:native` (native FastAPI on port 8080)

6. **Monitor logs**:
   - API access logs: `/aws/apigateway/benchling-webhook-http`
   - Container logs: stack-named log group

### Local Development Notes

- FastAPI default port is now **8080** (set via `PORT` env var).
- Docker Compose maps to ports **8082** (dev) and **8083** (prod).
- Update any local curl scripts or tunnels that assumed port 5000.

### Rollback

If you need to roll back:

1. Re-deploy the previous 0.8.x stack from the corresponding tag.
2. Point Benchling back to the prior webhook URL.
3. Restore any port 5000 assumptions in local scripts if required.
