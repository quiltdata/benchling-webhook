# IP Filtering Guide

**Version:** 1.0.0
**Date:** 2025-12-02
**Status:** Production Ready

## Overview

The Benchling Webhook service implements IP-based access control using AWS API Gateway resource policies. This provides free, edge-level filtering that blocks unauthorized IPs before they reach your infrastructure.

## Architecture

```text
Internet Request
  ↓
REST API Gateway v1
  • Resource Policy evaluates source IP
  • Blocked IPs → 403 Forbidden (at edge)
  • Allowed IPs → Continue to VPC
  ↓
VPC Link → NLB → ECS Fargate
  • FastAPI performs HMAC verification
  • Invalid signature → 403 Forbidden (from application)
  • Valid signature → Process webhook
```

## Two-Layer Security Model

### Layer 1: IP Filtering (Network Layer)

- **Technology**: REST API Gateway resource policy
- **Cost**: Free (no additional charges)
- **Where**: AWS edge locations
- **What**: Blocks requests from unknown IP addresses
- **Not Authentication**: IP address ≠ identity verification
- **Always Exempt**: Health endpoints (`/health`, `/health/ready`, `/health/live`)

### Layer 2: HMAC Verification (Application Layer)

- **Technology**: FastAPI with Benchling SDK
- **Where**: ECS Fargate containers
- **What**: Verifies cryptographic signature over request body
- **Authentication**: Proves webhook came from Benchling
- **Required**: All webhook endpoints (`/event`, `/lifecycle`, `/canvas`)

## Configuration

### Setting IP Allowlist

Add allowed IPs to your profile configuration:

```bash
# Interactive wizard
npm run setup

# Manual edit
vim ~/.config/benchling-webhook/default/config.json
```

Configuration format:

```json
{
  "security": {
    "webhookAllowList": "192.168.1.0/24,10.0.0.0/8",
    "enableVerification": true
  }
}
```

### IP Format Examples

```json
// Single IP
"webhookAllowList": "203.0.113.45/32"

// Multiple IPs (comma-separated)
"webhookAllowList": "203.0.113.45/32,198.51.100.0/24"

// CIDR blocks
"webhookAllowList": "192.168.1.0/24,10.0.0.0/8,172.16.0.0/12"

// Mixed (spaces are trimmed automatically)
"webhookAllowList": "203.0.113.45/32, 192.168.1.0/24 , 10.0.0.0/8"

// Disabled (empty string or omit field)
"webhookAllowList": ""
```

### Deployment

After updating configuration, deploy the changes:

```bash
# Deploy to dev
npm run deploy:dev -- --yes

# Deploy to production
npm run deploy:prod -- --image-tag <version> --yes
```

## Endpoints and IP Filtering

### Always Accessible (No IP Restriction)

These endpoints are EXEMPT from IP filtering to support monitoring and health checks:

- `GET /health` - General health check
- `GET /health/ready` - Readiness probe
- `GET /health/live` - Liveness probe
- `GET /{stage}/health` - Stage-prefixed variants
- `GET /{stage}/health/ready`
- `GET /{stage}/health/live`

**Why**: Monitoring systems need reliable access regardless of IP.

### IP Restricted (When Allowlist Configured)

These endpoints require source IP to be in allowlist:

- `POST /event` - Benchling entry/canvas events
- `POST /lifecycle` - Lifecycle state changes
- `POST /canvas` - Canvas events
- `POST /{stage}/event` - Stage-prefixed variants
- `POST /{stage}/lifecycle`
- `POST /{stage}/canvas`

**Why**: Webhooks should only come from known Benchling servers.

## Troubleshooting

### Scenario 1: Request Blocked by IP Filter

**Symptom**: HTTP 403 Forbidden response, immediate return (< 100ms)

**CloudWatch Logs Query**:
```sql
fields @timestamp, @message, ip, status, httpMethod, resourcePath
| filter status = 403
| filter httpMethod = "POST"
| sort @timestamp desc
| limit 20
```

**Diagnosis**:
- Check source IP in CloudWatch access logs (`/aws/apigateway/benchling-webhook-rest`)
- Compare against configured allowlist
- Verify CIDR notation is correct

**Resolution**:
1. Identify correct Benchling IP addresses
2. Add to `security.webhookAllowList` in profile config
3. Redeploy: `npm run deploy:dev -- --yes`
4. Verify: `curl -I https://<endpoint>/health` (should return 200)

### Scenario 2: Request Blocked by HMAC Verification

**Symptom**: HTTP 403 Forbidden response, slower return (~500ms), after passing IP filter

**CloudWatch Logs Query**:
```sql
fields @timestamp, @message
| filter @logGroup = "/ecs/benchling-webhook"
| filter @message like /HMAC verification failed/
| sort @timestamp desc
| limit 20
```

**Diagnosis**:
- Request passed IP filter (source IP is allowed)
- FastAPI rejected due to invalid HMAC signature
- Check ECS container logs (`/ecs/benchling-webhook`)

**Resolution**:
1. Verify Benchling webhook secret matches AWS Secrets Manager
2. Check secret ARN in profile config: `benchling.secretArn`
3. Sync secrets: `npm run setup:sync-secrets`
4. Test with valid HMAC: Use Benchling UI to trigger webhook

### Scenario 3: Health Endpoint Blocked

**Symptom**: Health endpoint returns 403 even though it should be exempt

**Diagnosis**: This should NEVER happen. If it does, resource policy is misconfigured.

**Verification**:
```bash
# Check deployed resource policy
aws apigateway get-rest-api --rest-api-id <api-id> --query 'policy' --output json | jq
```

Expected policy structure:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": [
        "execute-api:/*/GET/health",
        "execute-api:/*/GET/*/health"
      ]
      // NO Condition block for health endpoints
    },
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": ["execute-api:/*/POST/event", ...],
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": ["192.168.1.0/24"]
        }
      }
    }
  ]
}
```

**Resolution**: Redeploy stack to fix resource policy.

### Scenario 4: Unknown Benchling IP Addresses

**Problem**: Don't know which IPs Benchling uses for webhooks

**Solution**: Deploy without IP filtering first, then discover IPs

```bash
# 1. Deploy without IP filter
# Edit config: "webhookAllowList": ""
npm run deploy:dev -- --yes

# 2. Trigger test webhook from Benchling UI

# 3. Check API Gateway access logs for source IPs
aws logs tail /aws/apigateway/benchling-webhook-rest --follow

# 4. Extract unique IPs from successful POST requests
aws logs filter-log-events \
  --log-group-name /aws/apigateway/benchling-webhook-rest \
  --filter-pattern '{ $.httpMethod = "POST" && $.status = 200 }' \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --query 'events[*].message' \
  | jq -r 'fromjson | .ip' \
  | sort -u

# 5. Add IPs to allowlist and redeploy
```

### Scenario 5: Testing IP Filtering

**Verification Steps**:

```bash
# 1. Deploy with your IP in allowlist
# Edit config: "webhookAllowList": "$(curl -s https://api.ipify.org)/32"
npm run deploy:dev -- --yes

# 2. Test health endpoint (should work from anywhere)
curl -I https://<endpoint>/dev/health
# Expected: 200 OK

# 3. Test webhook endpoint with invalid HMAC (should reach FastAPI)
curl -X POST https://<endpoint>/dev/event \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'
# Expected: 403 Forbidden (from FastAPI, not API Gateway)
# Check ECS logs for HMAC verification message

# 4. Test from blocked IP (use VPN or proxy)
curl -X POST https://<endpoint>/dev/event \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'
# Expected: 403 Forbidden (immediate, from API Gateway)
# Check API Gateway access logs for policy block
```

## Distinguishing API Gateway 403 vs FastAPI 403

### API Gateway 403 (Resource Policy Block)

**Characteristics**:
- **Fast response**: < 100ms (blocked at edge)
- **Generic message**: "Missing Authentication Token" or "Forbidden"
- **Logged in**: `/aws/apigateway/benchling-webhook-rest`
- **Response headers**: `x-amzn-ErrorType: MissingAuthenticationTokenException` or `AccessDeniedException`

**CloudWatch Log Entry**:
```json
{
  "ip": "203.0.113.45",
  "requestTime": "02/Dec/2025:10:30:00 +0000",
  "httpMethod": "POST",
  "resourcePath": "/dev/event",
  "status": 403,
  "protocol": "HTTP/1.1",
  "responseLength": 42
}
```

### FastAPI 403 (HMAC Verification Failure)

**Characteristics**:
- **Slower response**: ~500ms (reached application)
- **Detailed message**: JSON error response from FastAPI
- **Logged in**: `/ecs/benchling-webhook` (container logs)
- **Response headers**: `content-type: application/json`

**CloudWatch Log Entry** (ECS):
```text
2025-12-02 10:30:00 INFO HMAC verification failed for request from 192.168.1.10
2025-12-02 10:30:00 INFO Expected signature: abc123..., Received: def456...
```

## Operational Procedures

### Adding New IP to Allowlist

```bash
# 1. Edit profile configuration
vim ~/.config/benchling-webhook/default/config.json

# 2. Add new IP to webhookAllowList (comma-separated)
"webhookAllowList": "192.168.1.0/24,10.0.0.0/8,NEW_IP/32"

# 3. Deploy changes
npm run deploy:dev -- --yes

# 4. Verify new IP can access
curl -I https://<endpoint>/dev/event
```

### Removing IP Filtering

```bash
# 1. Edit profile configuration
vim ~/.config/benchling-webhook/default/config.json

# 2. Set webhookAllowList to empty string
"webhookAllowList": ""

# 3. Deploy changes
npm run deploy:dev -- --yes

# 4. Verify all IPs can access
# (Resource policy switches to single "allow all" statement)
```

### Auditing Blocked Requests

**Daily Report** (last 24 hours of 403s):
```bash
aws logs filter-log-events \
  --log-group-name /aws/apigateway/benchling-webhook-rest \
  --filter-pattern '{ $.status = 403 }' \
  --start-time $(date -u -d '24 hours ago' +%s)000 \
  | jq -r '.events[].message | fromjson | "\(.ip) - \(.httpMethod) \(.resourcePath) - \(.requestTime)"' \
  | sort | uniq -c | sort -rn
```

**Top Blocked IPs**:
```bash
aws logs filter-log-events \
  --log-group-name /aws/apigateway/benchling-webhook-rest \
  --filter-pattern '{ $.status = 403 }' \
  --start-time $(date -u -d '7 days ago' +%s)000 \
  | jq -r '.events[].message | fromjson | .ip' \
  | sort | uniq -c | sort -rn | head -20
```

### Verifying Deployed Configuration

```bash
# Get API Gateway ID
aws apigateway get-rest-apis --query 'items[?name==`BenchlingWebhookRestAPI`].id' --output text

# Get resource policy
aws apigateway get-rest-api --rest-api-id <api-id> --query 'policy' --output json | jq

# Check for IP conditions
aws apigateway get-rest-api --rest-api-id <api-id> --query 'policy' --output json \
  | jq '.Statement[].Condition.IpAddress["aws:SourceIp"]'
```

## Best Practices

### 1. Start Permissive, Then Restrict

Deploy without IP filtering initially:
```json
"webhookAllowList": ""
```

Monitor for 24-48 hours to discover Benchling IPs, then add allowlist.

### 2. Use CIDR Blocks, Not Single IPs

Bad:
```json
"webhookAllowList": "203.0.113.45/32,203.0.113.46/32,203.0.113.47/32"
```

Good:
```json
"webhookAllowList": "203.0.113.0/24"
```

### 3. Document IP Sources

Add comments in profile config:
```json
{
  "_comment": "IP allowlist: Benchling webhooks from us-east-1 region",
  "security": {
    "webhookAllowList": "203.0.113.0/24,198.51.100.0/24"
  }
}
```

### 4. Test After Every Change

Always test both health endpoints and webhook endpoints after deployment:
```bash
# Health (should always work)
curl -I https://<endpoint>/dev/health

# Webhook (should return 403 from HMAC, proving IP passed)
curl -X POST https://<endpoint>/dev/event -d '{"test":"data"}'
```

### 5. Monitor Regularly

Set up CloudWatch alarms for:
- High rate of 403 responses (possible Benchling IP change)
- Zero successful webhooks (allowlist too restrictive)
- 403s from previously successful IPs (IP rotation)

## Cost Analysis

### IP Filtering Costs

| Method | Monthly Cost | Setup Complexity |
|--------|--------------|------------------|
| **Resource Policy** | $0.00 | Low (config field) |
| AWS WAF | $7.60 + $1/million requests | High (separate construct) |
| Security Group | Not applicable (ECS is private) | N/A |

**Conclusion**: Resource policy provides free IP filtering with minimal complexity.

### Cost Savings vs WAF

- Small deployment (100K requests/month): **Save $7.60/month**
- Medium deployment (1M requests/month): **Save $8.60/month**
- Large deployment (10M requests/month): **Save $17.60/month**

## Security Considerations

### What IP Filtering Provides

- **Edge-level blocking**: Reduces attack surface
- **Cost reduction**: Blocked requests don't reach ECS (no processing cost)
- **Log reduction**: Fewer invalid requests in application logs
- **DDoS mitigation**: Unknown IPs blocked at edge

### What IP Filtering Does NOT Provide

- **Authentication**: IP address is not identity verification
- **Authorization**: IP filtering does not check permissions
- **Protection against compromised sources**: If Benchling server is compromised, IP filter allows attack
- **Complete security**: Always pair with HMAC verification

### Defense in Depth

Both layers are required for security:

1. **IP Filtering** (optional but recommended): Reduces attack surface
2. **HMAC Verification** (required): Authenticates webhook sender

**Do NOT disable HMAC verification** even with IP filtering enabled:
```json
{
  "security": {
    "webhookAllowList": "203.0.113.0/24",
    "enableVerification": true  // REQUIRED
  }
}
```

## Migration from Previous Versions

### v0.9.x → v1.0.0

Previous versions used HTTP API v2 with optional WAF. Version 1.0.0 migrates to REST API v1 with resource policies.

**Changes**:
- API Gateway type: HTTP API v2 → REST API v1
- IP filtering: WAF (paid) → Resource policy (free)
- Configuration: Same (`security.webhookAllowList`)
- Behavior: Identical (403 for blocked IPs)

**Migration steps**:
1. Update to v1.0.0: `npm install -g @quiltdata/benchling-webhook@latest`
2. No config changes required (same `webhookAllowList` field)
3. Deploy: `npm run deploy:dev -- --yes`
4. Verify: Test health endpoint and webhook endpoint
5. Monitor: Check CloudWatch logs for 403s

**Rollback** (if issues):
```bash
# Option 1: Disable IP filtering temporarily
# Edit config: "webhookAllowList": ""
npm run deploy:dev -- --yes

# Option 2: Rollback to v0.9.x
npm install -g @quiltdata/benchling-webhook@0.9.x
npm run deploy:dev -- --yes
```

## FAQ

**Q: Do I need to configure IP filtering?**
A: No, it's optional. When `webhookAllowList` is empty, all IPs are allowed (HMAC still required).

**Q: How do I find Benchling's webhook IPs?**
A: Deploy without IP filter, trigger test webhook, check API Gateway access logs.

**Q: Can I use IP filtering without HMAC verification?**
A: Technically yes, but strongly discouraged. HMAC verification is the primary security layer.

**Q: Will IP filtering break health checks?**
A: No, health endpoints are always exempt from IP filtering.

**Q: What happens if Benchling changes their IPs?**
A: Webhooks will be blocked (403). Monitor CloudWatch logs and update allowlist.

**Q: Can I use domain names instead of IPs?**
A: No, resource policies only support IP addresses and CIDR blocks.

**Q: How do I test IP filtering locally?**
A: You cannot test resource policies locally. Deploy to dev environment and test via API Gateway.

**Q: Does IP filtering cost extra?**
A: No, REST API Gateway resource policies are free.

**Q: How many IPs can I add to allowlist?**
A: Resource policy limit is 10KB JSON. Practical limit: ~200 CIDR blocks.

**Q: Can I use IPv6 addresses?**
A: Yes, resource policies support both IPv4 and IPv6.

## Related Documentation

- [REST API v1 Architecture](../spec/2025-11-26-architecture/11-arch-30.md)
- [Security Model](../CLAUDE.md#security)
- [Configuration Guide](../CLAUDE.md#configuration-v070)
- [Troubleshooting Guide](../README.md#troubleshooting)

## Support

For issues or questions:
- GitHub Issues: https://github.com/quiltdata/benchling-webhook/issues
- Architecture Specs: `/spec/2025-11-26-architecture/`
- CloudWatch Logs: Check `/aws/apigateway/benchling-webhook-rest` and `/ecs/benchling-webhook`
