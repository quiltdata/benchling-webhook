# Add WAF for IP Filtering (v1.0.0)

**Date**: 2025-11-28
**Status**: Required
**Prerequisite**: [07-restore-http-gateway.md](07-restore-http-gateway.md) - Requires HTTP API v2
**Context**: WAF provides defense-in-depth IP filtering at AWS edge, complementing Lambda Authorizer HMAC verification.

---

## Problem Statement

Current architecture relies solely on Lambda Authorizer for security. Adding WAF provides an additional security layer at the AWS edge.

**Current (after restoring HTTP API v2):**

```
Internet → HTTP API v2 → Lambda Authorizer (HMAC) → VPC Link → ECS
```

**Target (with WAF):**

```
Internet → WAF (IP filter) → HTTP API v2 → Lambda Authorizer (HMAC) → VPC Link → ECS
```

---

## Why WAF is Required

### Defense-in-Depth Security

**Three Independent Security Layers:**

1. **WAF (Network Layer)** - Edge-level IP filtering
   - Blocks requests from unauthorized IPs before they reach API Gateway
   - No Lambda invocation cost for blocked requests
   - No API Gateway request cost for blocked requests
   - DDoS protection, rate limiting, managed rules

2. **Lambda Authorizer (Authentication Layer)** - HMAC signature verification
   - Validates webhook signatures over request body
   - Blocks invalid/forged requests even from allowed IPs
   - Isolated from business logic (minimal AWS permissions)

3. **FastAPI (Application Layer)** - Redundant HMAC verification
   - Final validation before business logic execution
   - Protection if Lambda is compromised or bypassed

### WAF Advantages Over Resource Policies

| Feature | REST API Resource Policy | HTTP API v2 + WAF |
|---------|-------------------------|-------------------|
| IP filtering | Limited (10KB policy) | Unlimited (10,000 IPs) |
| Rate limiting | Not available | Per-IP rate limits |
| DDoS protection | Basic | Advanced Layer 7 |
| Managed rules | Not available | SQL injection, XSS, etc. |
| Geographic blocking | Not available | Country-level blocking |
| Logging detail | Basic | Detailed per-rule logs |
| Cost per block | API Gateway charged | Blocked at edge (cheaper) |

---

## What Needs to Happen

### 1. Create WAF Web ACL

**New Construct:** `lib/waf-web-acl.ts`

**Web ACL Configuration:**

- Name: `BenchlingWebhookWebACL`
- Scope: `REGIONAL` (for API Gateway in us-east-1, us-west-2, etc.)
- Associated resource: HTTP API Gateway ARN
- Default action: `BLOCK` (deny-by-default security posture)
- CloudWatch metrics: Enabled

**Rules to Add (Priority Order):**

#### Rule 1: Health Check Exception (Priority 10)

- **Action:** Allow `/health`, `/health/ready`, `/health/live`
- **Rationale:** Health checks should work regardless of IP (for monitoring)
- **Implementation:** Path-based rule matching health endpoints

#### Rule 2: IP Allowlist (Priority 20)

- **Action:** Allow requests from allowed IPs
- **IP Set:** Created from `config.security.webhookAllowList`
- **Supports:** IPv4 CIDR blocks (e.g., `192.168.1.0/24`)
- **Capacity:** Up to 10,000 IP addresses

#### Rule 3: Rate Limiting (Priority 30, Optional)

- **Action:** Block if > threshold requests per 5 minutes from single IP
- **Scope:** Per-IP address
- **Configuration:** `config.security.rateLimitPerIp` (default: 100)
- **Fallback:** COUNT mode if disabled (logs but doesn't block)

#### Rule 4: AWS Managed Rules (Priority 40, Optional)

- **Rule Set:** `AWSManagedRulesCommonRuleSet`
- **Protection:** SQL injection, XSS, known bad inputs
- **Configuration:** `config.security.enableManagedRules` (default: false)
- **Mode:** BLOCK or COUNT (configurable for testing)

### 2. Create IP Set Resource

**Resource Type:** `AWS::WAFv2::IPSet`

**Configuration:**

- Name: `BenchlingWebhookIPSet`
- Scope: `REGIONAL`
- IP version: IPv4
- Addresses: Parse from `config.security.webhookAllowList`

**Parsing Logic:**

```typescript
const ipAllowList = config.security.webhookAllowList
    ?.split(",")
    .map((ip) => ip.trim())
    .filter((ip) => ip.length > 0)
    .map((ip) => {
        // Ensure CIDR notation (add /32 if not specified)
        return ip.includes("/") ? ip : `${ip}/32`;
    }) || [];
```

**Validation:**

- Each entry must be valid IPv4 CIDR
- Maximum 10,000 entries
- If empty, WAF blocks all traffic except health checks (fail-safe)

### 3. Associate WAF with HTTP API Gateway

**CDK Integration in `lib/http-api-gateway.ts`:**

Add WAF association after creating HTTP API:

```typescript
// Create WAF Web ACL
const webAcl = new WafWebAcl(scope, "WafWebAcl", {
    ipAllowList: props.config.security.webhookAllowList || "",
    rateLimitPerIp: props.config.security.rateLimitPerIp || 100,
    enableManagedRules: props.config.security.enableManagedRules || false,
});

// Associate WAF with HTTP API
new wafv2.CfnWebACLAssociation(scope, "WafAssociation", {
    resourceArn: this.api.apiArn,
    webAclArn: webAcl.arn,
});
```

**Key Points:**

- WAF evaluates requests BEFORE they reach Lambda Authorizer
- Blocked requests never invoke Lambda (cost savings)
- Allowed requests proceed to Lambda Authorizer for HMAC verification

### 4. Configure WAF Logging

**Log Destination:** CloudWatch Logs

**Log Group:**

- Name: `/aws/waf/benchling-webhook`
- Retention: 7 days
- Format: JSON (includes IP, action, rule matched)

**Logged Data:**

- Request timestamp
- Client IP address
- HTTP method and path
- Matched rule (allow/block)
- Action taken (ALLOW/BLOCK/COUNT)
- Request headers (webhook-id, webhook-signature)
- Terminating rule ID

**Sample Log Entry:**

```json
{
  "timestamp": 1234567890,
  "action": "BLOCK",
  "terminatingRuleId": "BenchlingWebhookIPAllowlist",
  "httpRequest": {
    "clientIp": "203.0.113.45",
    "uri": "/webhook",
    "httpMethod": "POST",
    "headers": [
      {"name": "webhook-signature", "value": "abc123..."}
    ]
  },
  "ruleGroupList": []
}
```

### 5. Add Configuration Fields

**New Config Schema:**

```typescript
interface SecurityConfig {
    webhookAllowList?: string;           // Existing - now used by WAF
    enableVerification?: boolean;        // Existing - controls Lambda + FastAPI
    rateLimitPerIp?: number;             // NEW - WAF rate limit (req per 5min)
    enableManagedRules?: boolean;        // NEW - AWS managed rules
    geoBlockList?: string;               // NEW - Country codes (e.g., "CN,RU")
}
```

**Example Config:**

```json
{
    "security": {
        "webhookAllowList": "192.168.1.0/24,10.0.0.0/8",
        "enableVerification": true,
        "rateLimitPerIp": 100,
        "enableManagedRules": false,
        "geoBlockList": ""
    }
}
```

### 6. Update Setup Wizard

**Prompt for WAF Configuration in `scripts/install-wizard.ts`:**

```typescript
// Rate limit configuration
const rateLimitResponse = await prompts({
    type: "number",
    name: "rateLimitPerIp",
    message: "Rate limit per IP (requests per 5 minutes)",
    initial: existingConfig?.security?.rateLimitPerIp || 100,
    min: 10,
    max: 10000,
});

// AWS managed rules (optional, disabled by default)
const managedRulesResponse = await prompts({
    type: "confirm",
    name: "enableManagedRules",
    message: "Enable AWS managed rules (SQL injection, XSS protection)?",
    initial: existingConfig?.security?.enableManagedRules || false,
});
```

---

## What NOT to Change

### Keep Unchanged

- HTTP API v2 Gateway construct (just add WAF association)
- Lambda Authorizer function and configuration
- FastAPI HMAC verification (defense-in-depth)
- VPC configuration
- ECS Fargate service
- Cloud Map service discovery
- Profile-based configuration system

### Defense-in-Depth Layers

All three layers remain active:

1. **WAF** - IP filtering, rate limiting, managed rules (edge)
2. **Lambda Authorizer** - HMAC signature validation (API Gateway)
3. **FastAPI Verification** - Redundant HMAC check (application)

---

## Request Flow with WAF

### Successful Request (All Layers Pass)

```
1. Benchling → HTTPS POST to HTTP API Gateway
2. WAF: Check IP against allowlist
   → IP in allowlist → ALLOW (logged to CloudWatch)
3. WAF: Check rate limit for IP
   → Under threshold → ALLOW
4. WAF: Apply managed rules (if enabled)
   → No malicious patterns → ALLOW
5. HTTP API Gateway: Invoke Lambda Authorizer
6. Lambda Authorizer: Verify HMAC signature over request body
   → Valid signature → {"isAuthorized": true}
7. HTTP API Gateway: Forward to VPC Link
8. VPC Link → Cloud Map → ECS Fargate
9. FastAPI: Verify HMAC signature (redundant check)
   → Valid signature → Process webhook
10. Return 200 OK to Benchling
```

### Failed Request (Blocked by WAF)

```
1. Benchling → HTTPS POST
2. WAF: Check IP against allowlist
   → IP NOT in allowlist → BLOCK (403 Forbidden)
3. WAF: Log blocked request to /aws/waf/benchling-webhook
4. Request NEVER reaches:
   - API Gateway (no request cost)
   - Lambda Authorizer (no invocation cost)
   - ECS Fargate
5. Return 403 Forbidden to Benchling
```

### Failed Request (Blocked by Lambda Authorizer)

```
1. Benchling → HTTPS POST
2. WAF: IP in allowlist → ALLOW
3. HTTP API Gateway: Invoke Lambda Authorizer
4. Lambda Authorizer: Verify HMAC signature
   → Invalid signature → {"isAuthorized": false}
5. HTTP API Gateway: Return 403 Forbidden
6. Request NEVER reaches ECS Fargate
7. Logged to /aws/lambda/BenchlingWebhookAuthorizer
```

**Key Insight:** WAF blocks at edge (cheaper), Lambda Authorizer blocks at API Gateway (protects ECS).

---

## Testing Requirements

### Unit Tests

- WAF Web ACL construct creates correct resources
- IP Set parsing handles various CIDR formats
- Rate limit rule created with correct threshold
- Health check exception rule allows unauthenticated paths
- Managed rules configured correctly (if enabled)

### Integration Tests

- Deploy stack with WAF enabled
- Request from allowed IP + valid HMAC → 200 OK
- Request from blocked IP → 403 Forbidden (from WAF, not Lambda)
- Request from allowed IP + invalid HMAC → 403 Forbidden (from Lambda)
- Rate limit exceeded → 429 Too Many Requests
- Health check from any IP → 200 OK
- Verify WAF logs written to CloudWatch

### Security Tests

- SQL injection payload blocked (if managed rules enabled)
- XSS payload blocked (if managed rules enabled)
- DDoS simulation handled gracefully
- Geographic blocking works (if configured)
- Bypassing WAF impossible (no direct API Gateway access)

---

## Monitoring & Alerting

### CloudWatch Metrics

**WAF Metrics:**

- `AllowedRequests` - Count of requests allowed by WAF
- `BlockedRequests` - Count of requests blocked by WAF
- `CountedRequests` - Count of requests in COUNT mode (testing)

**Lambda Metrics:**

- `Invocations` - Should equal WAF `AllowedRequests`
- `Errors` - Lambda authorizer failures
- `Duration` - HMAC verification time

**API Gateway Metrics:**

- `Count` - Should equal Lambda `Invocations` with `isAuthorized=true`
- `4XXError` - Client errors (403 from Lambda)
- `5XXError` - Server errors (should be zero)

### CloudWatch Alarms

**Critical Alerts:**

- **Blocked Request Spike** - Alert if blocked requests > 100/min (possible attack)
- **Lambda Errors** - Alert if Lambda error rate > 1% (authorizer broken)
- **Rate Limit Exceeded** - Alert if rate limit blocks occur (legitimate traffic?)

**Warning Alerts:**

- **Managed Rule Blocks** - Alert if malicious patterns detected
- **Geographic Blocks** - Alert if geo-blocking triggered (unexpected traffic)

### Log Insights Queries

**Top Blocked IPs:**

```sql
fields @timestamp, httpRequest.clientIp, action
| filter action = "BLOCK"
| stats count() by httpRequest.clientIp
| sort count desc
| limit 10
```

**Blocked Request Distribution:**

```sql
fields @timestamp, terminatingRuleId, action
| filter action = "BLOCK"
| stats count() by terminatingRuleId
```

**Rate Limit Violations:**

```sql
fields @timestamp, httpRequest.clientIp, terminatingRuleId
| filter terminatingRuleId = "RateLimitRule"
| stats count() by httpRequest.clientIp
```

---

## Cost Impact

### WAF Costs (us-east-1)

- **Web ACL:** $5.00/month (base)
- **Rules:** $1.00/month per rule (4 rules = $4.00/month)
- **Requests:** $0.60 per million requests analyzed
- **Logging:** CloudWatch Logs ingestion (~$0.50/GB)

### Total Additional Cost

- **Fixed:** ~$9.00/month
- **Variable:** ~$0.60 per million requests

### Cost Comparison (per million requests)

| Architecture | Fixed | Variable | Total |
|--------------|-------|----------|-------|
| **REST API + Lambda Authorizer + NLB** | $16.20/mo | $3.70/M | $19.90 |
| **HTTP API v2 + Lambda Authorizer** | $0/mo | $1.20/M | $1.20 |
| **HTTP API v2 + Lambda + WAF** | $9.00/mo | $1.80/M | $10.80 |

**Net Savings vs REST API:** -$9.10/month + -$1.90/M requests

**Trade-off:** Slightly higher cost than HTTP API alone, but provides edge-level security with DDoS protection and rate limiting.

---

## Configuration Examples

### Minimal (IP Allowlist Only)

```json
{
    "security": {
        "webhookAllowList": "192.168.1.0/24",
        "enableVerification": true
    }
}
```

WAF rules: Health check exception + IP allowlist

### Standard (IP + Rate Limiting)

```json
{
    "security": {
        "webhookAllowList": "192.168.1.0/24,10.0.0.0/8",
        "enableVerification": true,
        "rateLimitPerIp": 100
    }
}
```

WAF rules: Health check + IP allowlist + rate limiting

### Maximum (All Features)

```json
{
    "security": {
        "webhookAllowList": "192.168.1.0/24,10.0.0.0/8",
        "enableVerification": true,
        "rateLimitPerIp": 100,
        "enableManagedRules": true,
        "geoBlockList": "CN,RU,KP"
    }
}
```

WAF rules: Health check + IP allowlist + rate limiting + managed rules + geo-blocking

---

## Rollout Strategy

### Phase 1: Test Mode (COUNT Mode)

- Deploy WAF with default action: `COUNT` (logs but doesn't block)
- Monitor logs for false positives
- Verify allowed IPs work correctly
- Duration: 1 week

### Phase 2: Block Mode (BLOCK Mode)

- Change default action to `BLOCK`
- Deploy to dev environment first
- Verify blocked requests return 403
- Monitor for legitimate traffic blocks

### Phase 3: Production Rollout

- Deploy to production with confidence
- Monitor metrics and logs closely
- Adjust rate limits if needed

---

## Rollback Plan

### Emergency Disable WAF

```bash
# Remove WAF association from API Gateway
aws wafv2 disassociate-web-acl \
  --resource-arn <api-gateway-arn> \
  --region us-east-1

# Traffic flows normally (Lambda Authorizer still validates HMAC)
```

### Full Rollback

- Deploy previous CDK version without WAF construct
- WAF Web ACL and IP Set deleted
- API Gateway no longer associated with WAF
- Defense-in-depth reduced to: Lambda Authorizer + FastAPI verification

---

## Migration from Current State

### No User Action Required

- WAF deployment is transparent to users
- Existing `webhookAllowList` configuration reused
- No endpoint URL changes
- No Benchling webhook URL updates needed

### Automatic Migration

1. Read existing `config.security.webhookAllowList`
2. Create IP Set from existing values
3. Create WAF Web ACL with IP Set rule
4. Associate WAF with HTTP API Gateway
5. Existing traffic continues working

---

## Success Criteria

- [ ] WAF Web ACL created and associated with HTTP API
- [ ] IP Set populated from configuration
- [ ] Health check endpoints accessible without IP filtering
- [ ] Blocked requests return 403 at edge (before Lambda Authorizer)
- [ ] WAF logs written to CloudWatch
- [ ] Rate limiting works (429 after threshold)
- [ ] Managed rules block malicious payloads (if enabled)
- [ ] Defense-in-depth: WAF + Lambda Authorizer + FastAPI layers
- [ ] Cost reduced vs. REST API architecture

---

## Documentation Updates

### Files to Update

1. **CLAUDE.md**
   - Add WAF architecture section
   - Update security model (edge + authentication + application layers)
   - Document WAF configuration fields

2. **README.md**
   - Update architecture diagram (add WAF before HTTP API)
   - Add monitoring section for WAF logs
   - Document cost breakdown

3. **lib/types/config.ts**
   - Add new WAF-related config fields
   - Document `rateLimitPerIp` parameter
   - Document `enableManagedRules` flag

4. **scripts/install-wizard.ts**
   - Add WAF configuration prompts
   - Validate rate limit values
   - Explain managed rules trade-offs

---

## Architecture Diagram

### Final Architecture (v1.0.0)

```
Internet
    ↓
┌─────────────────────────────────────────────────┐
│ AWS WAF (Regional)                              │
│ ├─ Health check exception                       │
│ ├─ IP allowlist (10,000 addresses)             │
│ ├─ Rate limiting (100 req/5min per IP)         │
│ └─ AWS managed rules (SQL injection, XSS)      │
│                                                 │
│ Action: BLOCK (deny-by-default)                │
│ Logs: /aws/waf/benchling-webhook               │
└─────────────────────────────────────────────────┘
    ↓ (only allowed IPs)
┌─────────────────────────────────────────────────┐
│ HTTP API Gateway v2                             │
│ ├─ Lambda Authorizer (HMAC with body access)   │
│ ├─ VPC Link integration                        │
│ └─ CloudWatch access logs                      │
└─────────────────────────────────────────────────┘
    ↓ (only authenticated requests)
┌─────────────────────────────────────────────────┐
│ VPC Link                                        │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ Cloud Map Service Discovery                     │
│ (benchling.local)                               │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ Private VPC                                     │
│  ├─ ECS Fargate Service                         │
│  │  - FastAPI application (port 8080)          │
│  │  - HMAC verification (redundant)            │
│  │  - Business logic                           │
│  │                                             │
│  ├─ NAT Gateway (for ECS egress)                │
│  └─ Security Groups                             │
└─────────────────────────────────────────────────┘
```

**Security Layers:**

1. **WAF** - IP filtering, rate limiting, DDoS protection (AWS edge)
2. **Lambda Authorizer** - HMAC signature verification (API Gateway)
3. **FastAPI** - Redundant HMAC validation (application)

---

## References

- AWS WAF Documentation: <https://docs.aws.amazon.com/waf/>
- HTTP API v2 Integration: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-protect.html>
- WAFv2 IP Sets: <https://docs.aws.amazon.com/waf/latest/developerguide/waf-ip-set-managing.html>
- Prerequisite: [07-restore-http-gateway.md](07-restore-http-gateway.md)
- Architecture History: [03-arch-26.md](03-arch-26.md)
