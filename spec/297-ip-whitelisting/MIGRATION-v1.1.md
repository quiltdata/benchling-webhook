# Migration Guide: v1.0.x to v1.1.0

## Breaking Change: Health Endpoint IP Filtering

Starting with version 1.1.0, health endpoints are **NO LONGER exempt** from IP whitelisting when `webhookAllowList` is configured.

### What Changed

**Before (v1.0.x)**:
```text
webhookAllowList = "203.0.113.0/24"

Results:
- POST /event → Restricted to 203.0.113.0/24
- POST /lifecycle → Restricted to 203.0.113.0/24
- GET /health → Accessible from ANY IP (exempted)
```

**After (v1.1.0+)**:
```text
webhookAllowList = "203.0.113.0/24"

Results:
- POST /event → Restricted to 203.0.113.0/24
- POST /lifecycle → Restricted to 203.0.113.0/24
- GET /health → Restricted to 203.0.113.0/24 (NO LONGER EXEMPTED)
```

### Why This Change

**Customer requirement**: Block external access to health endpoints in production deployments.

**Security benefit**: Reduces information disclosure - service availability and response times no longer exposed to any IP.

**Architecture clarification**: NLB health checks never needed exemption because they:
- Originate from within VPC (internal NLB)
- Connect directly to ECS tasks on port 8080
- Use path `/health` without stage prefix
- Never traverse API Gateway or resource policy

## Who Is Affected

### Affected Users

You are affected if:
1. You have `security.webhookAllowList` configured in your profile
2. You use external monitoring services (Pingdom, Datadog, StatusCake, etc.)
3. Your monitoring service IPs are NOT in your current allowlist

### Not Affected Users

You are NOT affected if:
1. You don't have `webhookAllowList` configured (IP filtering disabled)
2. Your monitoring service IPs are already in your allowlist
3. You only use CloudWatch alarms (no external monitoring)

## Migration Paths

### Path 1: Add Monitoring IPs to Allowlist (Recommended)

**Best for**: Production environments that need both IP filtering and external monitoring

**Steps**:

1. **Identify monitoring service IPs**
   ```bash
   # Check monitoring service documentation for IP ranges
   # Examples:
   # - Pingdom: https://help.pingdom.com/hc/en-us/articles/203682601
   # - Datadog: https://docs.datadoghq.com/api/latest/ip-ranges/
   ```

2. **Update profile configuration**
   ```bash
   vim ~/.config/benchling-webhook/prod/config.json
   ```

   ```json
   {
     "security": {
       "webhookAllowList": "203.0.113.0/24,MONITORING_IP_1/32,MONITORING_IP_2/32"
     }
   }
   ```

3. **Redeploy**
   ```bash
   npm run deploy:prod -- --profile prod --yes
   ```

4. **Verify**
   ```bash
   # Test health endpoint from monitoring service
   curl -I https://your-endpoint.execute-api.region.amazonaws.com/prod/health

   # Expected: 200 OK
   # If 403: Check monitoring IP is correct and in allowlist
   ```

### Path 2: Disable IP Filtering (Development/Staging)

**Best for**: Non-production environments where IP filtering is not required

**Steps**:

1. **Update profile configuration**
   ```bash
   vim ~/.config/benchling-webhook/dev/config.json
   ```

   ```json
   {
     "security": {
       "webhookAllowList": "",
       "enableVerification": true
     }
   }
   ```

2. **Redeploy**
   ```bash
   npm run deploy:dev -- --profile dev --yes
   ```

**Note**: HMAC verification remains active even with IP filtering disabled.

### Path 3: Use CloudWatch Alarms (No External Monitoring)

**Best for**: AWS-native monitoring without external services

**Steps**:

1. Create CloudWatch alarm for ECS unhealthy target count
2. Create CloudWatch alarm for API Gateway 5xx errors
3. No configuration changes needed
4. NLB health checks continue working (bypass API Gateway)

## Testing Your Migration

### Test 1: Verify NLB Health Checks

**Check ECS task health in AWS Console**:
```bash
aws ecs describe-tasks \
  --cluster BenchlingWebhookCluster \
  --tasks $(aws ecs list-tasks --cluster BenchlingWebhookCluster --query 'taskArns[0]' --output text) \
  --query 'tasks[0].healthStatus'
```

**Expected**: `HEALTHY`

**Why this works**: NLB health checks bypass API Gateway, connect directly to ECS tasks.

### Test 2: Verify External Monitoring Access

**From monitoring service or allowlisted IP**:
```bash
curl -I https://your-endpoint.execute-api.region.amazonaws.com/prod/health
```

**Expected**: `HTTP/2 200` with `{"status": "healthy"}`

**If 403 Forbidden**: Monitoring IP not in allowlist.

### Test 3: Verify Blocked Access (Optional)

**From non-allowlisted IP (VPN/proxy)**:
```bash
curl -I https://your-endpoint.execute-api.region.amazonaws.com/prod/health
```

**Expected**: `HTTP/2 403` (blocked by API Gateway resource policy)

**This proves IP filtering is working correctly**.

## Troubleshooting

### Problem: Monitoring service shows endpoint down

**Symptom**: External monitoring reports 403 Forbidden on /health endpoint

**Diagnosis**:
```bash
# Check API Gateway access logs
aws logs tail /aws/apigateway/benchling-webhook-rest \
  --follow \
  --filter-pattern '{ $.status = 403 }'
```

**Resolution**: Add monitoring service IP to webhookAllowList

### Problem: NLB shows unhealthy targets

**Symptom**: ECS tasks marked unhealthy, service degraded

**Diagnosis**: NLB health checks should NEVER be affected by this change
```bash
# Check ECS task health
aws ecs describe-services \
  --cluster BenchlingWebhookCluster \
  --services benchling-webhook \
  --query 'services[0].events[0:5]'
```

**Resolution**: This is NOT related to IP filtering change. Check:
- ECS task logs for application errors
- Container health check configuration
- Security group rules

### Problem: Unsure if monitoring IPs are correct

**Symptom**: Need to discover monitoring service IPs

**Resolution**:
```bash
# Temporarily disable IP filtering
vim ~/.config/benchling-webhook/prod/config.json
# Set: "webhookAllowList": ""

# Redeploy
npm run deploy:prod -- --profile prod --yes

# Check access logs for health endpoint requests
aws logs tail /aws/apigateway/benchling-webhook-rest --format short | grep 'GET.*health'

# Identify monitoring service IPs in logs
# Add to allowlist and re-enable filtering
```

## Rollback Procedure

If migration causes issues:

### Emergency: Deploy v1.0.x

```bash
# Deploy specific v1.0.x version
npm run deploy:prod -- --profile prod --image-tag 1.0.7 --yes
```

### Quick Fix: Disable IP Filtering

```bash
# Edit config
vim ~/.config/benchling-webhook/prod/config.json

# Remove allowlist
"security": {
  "webhookAllowList": ""
}

# Redeploy current version
npm run deploy:prod -- --profile prod --yes
```

**Note**: HMAC verification remains active as primary authentication.

## Verification Checklist

Before completing migration:

- [ ] Identified all monitoring services using health endpoints
- [ ] Obtained IP ranges for all monitoring services
- [ ] Added monitoring IPs to webhookAllowList OR disabled filtering
- [ ] Redeployed stack successfully
- [ ] Verified monitoring services can access /health endpoint (200 OK)
- [ ] Verified NLB health checks show healthy targets
- [ ] Verified Benchling webhooks continue working
- [ ] Updated runbooks/documentation with new monitoring IPs

## FAQ

**Q: Will this break my Benchling webhooks?**
A: No. Benchling webhook IPs should already be in your allowlist. Only health endpoint monitoring is affected.

**Q: Do I need to update anything if I don't use external monitoring?**
A: No. NLB health checks bypass API Gateway and continue working. CloudWatch alarms unaffected.

**Q: Can I still use IP filtering for webhooks but not for health endpoints?**
A: No. v1.1.0 applies IP filtering consistently to all endpoints for simplified security model.

**Q: What if my monitoring service IP changes?**
A: Update webhookAllowList in profile config and redeploy. Consider using CIDR ranges if provider publishes them.

**Q: Is this change optional?**
A: No. This is a breaking change in v1.1.0+. If you upgrade, you must migrate.

## Support

If you encounter issues during migration:

1. Check troubleshooting section above
2. Review [spec/297-ip-whitelisting/02-remove-health-exemption.md](spec/297-ip-whitelisting/02-remove-health-exemption.md)
3. Check CloudWatch logs: `/aws/apigateway/benchling-webhook-rest`
4. Contact support with:
   - Profile configuration (redact secrets)
   - CloudWatch log excerpts
   - Monitoring service used
   - Expected vs actual behavior

---

**Migration Version**: 1.1.0
**Last Updated**: 2025-12-21
