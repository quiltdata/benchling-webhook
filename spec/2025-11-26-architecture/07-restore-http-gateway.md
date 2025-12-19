# Restore HTTP Gateway with Lambda Authorizer (v0.9.0)

**Date**: 2025-11-28
**Status**: Required
**Context**: THIS branch (`http-gateway`) has REST API + Lambda Authorizer. REST API Lambda Authorizers CANNOT access request body, breaking HMAC verification. Must restore HTTP API v2 from `sync-architecture` branch.

---

## Problem Statement

The current architecture (REST API + Lambda Authorizer) has a critical limitation:

**REST API Lambda Authorizers cannot access the request body.**

This breaks HMAC signature verification because:
1. Benchling HMAC signatures are computed over the **entire request body**
2. Lambda Authorizer needs body to verify: `HMAC(secret, body) == signature`
3. REST API only provides headers/query params to Lambda Authorizer
4. Result: Lambda Authorizer cannot verify signatures → **Security broken**

**HTTP API v2 Lambda Authorizers CAN access the request body** via the `body` field in the Lambda event.

---

## Why HTTP API v2 is Required

### REST API Lambda Authorizer Event (No Body Access):
```json
{
  "type": "REQUEST",
  "methodArn": "arn:aws:execute-api:...",
  "headers": {
    "webhook-signature": "abc123...",
    "webhook-id": "msg_123",
    "webhook-timestamp": "1234567890"
  },
  "queryStringParameters": {},
  "pathParameters": {},
  "requestContext": {...}
  // ❌ NO "body" field
}
```

### HTTP API v2 Lambda Authorizer Event (Has Body Access):
```json
{
  "version": "2.0",
  "type": "REQUEST",
  "routeArn": "arn:aws:execute-api:...",
  "identitySource": ["header.webhook-signature"],
  "headers": {
    "webhook-signature": "abc123...",
    "webhook-id": "msg_123",
    "webhook-timestamp": "1234567890"
  },
  "body": "{\"eventType\":\"entry.created\",\"entry\":{...}}",
  // ✅ Body is available for HMAC verification
  "requestContext": {...}
}
```

**Critical Difference:** HTTP API v2 includes `body` field → Lambda can verify HMAC over full payload.

---

## What Needs to Happen

### 1. Restore HTTP API v2 Gateway

**Remove:**
- `lib/rest-api-gateway.ts` (current REST API construct)

**Restore from `sync-architecture` branch:**
- `lib/http-api-gateway.ts` (HTTP API v2 construct)
  - HTTP API v2 API Gateway
  - VPC Link connecting directly to Cloud Map service (no NLB needed)
  - Access logging to CloudWatch
  - Lambda Authorizer integration (v2 format with body access)

**Key Architecture Change:**
- REST API: VPC Link → NLB → ECS
- HTTP API v2: VPC Link → Cloud Map → ECS (simpler, no NLB)

### 2. Adapt Lambda Authorizer for HTTP API v2

**Keep Lambda Authorizer but update for HTTP API v2:**

**Changes Required:**
- Update Lambda handler to parse HTTP API v2 event format (not REST API format)
- Access request body via `event['body']` (base64-encoded for binary, or string)
- Return HTTP API v2 authorizer response format (not REST API policy document)
- Update authorizer configuration in API Gateway (v2 uses different attachment method)

**Event Format Differences:**

| Field | REST API | HTTP API v2 |
| ------- | ---------- | ------------- |
| Body access | ❌ Not available | ✅ `event['body']` |
| Version | `"1.0"` | `"2.0"` |
| Route identifier | `methodArn` | `routeArn` |
| Response format | IAM policy document | Simple JSON context |
| Identity source | Headers only | Headers + body possible |

**HTTP API v2 Authorizer Response Format:**
```json
{
  "isAuthorized": true,  // or false
  "context": {
    "webhookId": "msg_123",
    "tenantId": "example"
  }
}
```

**REST API Response Format (OLD - don't use):**
```json
{
  "principalId": "user",
  "policyDocument": {
    "Version": "2012-10-17",
    "Statement": [...]
  }
}
```

### 3. Remove Network Load Balancer

**Removed Components:**
- Network Load Balancer (NLB)
- NLB target group
- NLB listener

**Rationale:** HTTP API v2 VPC Link can connect directly to Cloud Map service discovery, eliminating the need for NLB.

**Cost Savings:** -$16.20/month (NLB removal)

### 4. Update Lambda Authorizer Code

**File:** `docker/src/lambda_authorizer.py`

**Required Changes:**

```python
def handler(event, context):
    """
    HTTP API v2 Lambda Authorizer (REQUEST type with body access)
    """
    # Parse HTTP API v2 event format
    version = event.get('version')  # Should be "2.0"
    if version != "2.0":
        raise ValueError(f"Unexpected event version: {version}")

    # Extract headers
    headers = event.get('headers', {})
    webhook_signature = headers.get('webhook-signature')
    webhook_id = headers.get('webhook-id')
    webhook_timestamp = headers.get('webhook-timestamp')

    # ✅ Access request body (key difference from REST API)
    body = event.get('body', '')

    # Verify HMAC signature over body
    expected_signature = compute_hmac(secret, body)

    if not hmac.compare_digest(expected_signature, webhook_signature):
        # Return HTTP API v2 denial format
        return {
            "isAuthorized": False
        }

    # Return HTTP API v2 authorization format
    return {
        "isAuthorized": True,
        "context": {
            "webhookId": webhook_id,
            "timestamp": webhook_timestamp
        }
    }
```

**Key Changes:**
- Check `event['version'] == "2.0"`
- Access body via `event['body']`
- Return `{"isAuthorized": bool}` instead of IAM policy document
- Simpler response format

### 5. Update Stack Construct

**File:** `lib/benchling-webhook-stack.ts`

**Changes:**
- Import `HttpApiGateway` instead of `RestApiGateway`
- Pass Lambda Authorizer function to HTTP API construct
- Remove NLB-related references
- Update endpoint URL output format

**Before (REST API):**
```typescript
this.api = new RestApiGateway(this, "RestApiGateway", {
    vpc: vpc,
    cloudMapService: this.fargateService.cloudMapService,
    serviceSecurityGroup: this.fargateService.service.connections.securityGroups[0],
    config: config,
    ecsService: this.fargateService.service,
});
```

**After (HTTP API v2):**
```typescript
this.api = new HttpApiGateway(this, "HttpApiGateway", {
    vpc: vpc,
    cloudMapService: this.fargateService.cloudMapService,
    serviceSecurityGroup: this.fargateService.service.connections.securityGroups[0],
    config: config,
    // Pass Lambda Authorizer to HTTP API v2
    authorizerFunction: lambdaAuthorizer,
});
```

### 6. Detect and Handle Legacy 0.8.0 Stacks

**Problem:** v0.8.0 used REST API Gateway. Upgrading to v0.9.0 HTTP API v2 requires stack destruction (cannot update in-place).

**Detection Logic:**
When deploying, check if existing stack uses REST API:
- Query CloudFormation stack resources
- Look for `AWS::ApiGateway::RestApi` (v0.8.x indicator)
- If found → Warn user and prompt to destroy stack first

**Prompt:**
```
⚠️  BREAKING CHANGE DETECTED

Your existing stack uses v0.8.x architecture (REST API Gateway).
v0.9.0 uses HTTP API v2 (required for Lambda Authorizer body access).

Technical reason: REST API Lambda Authorizers cannot access request body,
breaking HMAC signature verification. HTTP API v2 provides body access.

Stack resources that will be REPLACED:
  - API Gateway REST API → HTTP API v2
  - Network Load Balancer → (removed, direct VPC Link)
  - Endpoint URL format → (stage removed from path)

You must destroy the existing stack before deploying v0.9.0:

  npx cdk destroy --profile {profile} --context stage={stage}

After destruction, redeploy with:

  npm run deploy:{stage} -- --profile {profile} --yes

Update your Benchling webhook URL after deployment.

Continue with deployment? (y/N)
```

**Safeguard:**
If user declines, abort deployment with error:
```
Deployment aborted. Run destroy command to proceed with v0.9.0 upgrade.
```

### 7. Migration from 0.8.0 Workflow

**Step 1: Backup Configuration**
```bash
cp ~/.config/benchling-webhook/{profile}/config.json ~/backup-config.json
```

**Step 2: Destroy Old Stack**
```bash
npx cdk destroy --profile {profile} --context stage={stage}
```

**Step 3: Deploy New Stack**
```bash
npm run deploy:{stage} -- --profile {profile} --yes
```

**Step 4: Update Benchling Webhook URL**
- Copy new endpoint from deployment output
- Update in Benchling app configuration
- New format: `https://{api-id}.execute-api.{region}.amazonaws.com/webhook`

**Step 5: Verify**
```bash
npm run test:{stage} -- --profile {profile}
```

---

## What NOT to Change

### Keep Unchanged:
- VPC configuration (auto-create or existing VPC lookup)
- ECS Fargate service definition
- Docker image (FastAPI application - no webhook verification removal)
- Cloud Map service discovery
- Security group configuration
- Profile-based configuration system
- Deployment tracking (`deployments.json`)
- Setup wizard (`scripts/install-wizard.ts`)

### FastAPI Application:
- **DO NOT remove webhook verification from FastAPI**
- Keep `docker/src/webhook_verification.py` module
- Keep verification dependency on endpoints (defense-in-depth)
- FastAPI still validates HMAC even though Lambda does too
- Rationale: Two layers of verification (Lambda blocks at edge, FastAPI validates again)

### Configuration Fields:
- `security.webhookAllowList` - Will be used by WAF (next spec)
- `security.enableVerification` - Controls both Lambda and FastAPI verification
- All other config fields remain unchanged

---

## Defense-in-Depth Architecture

With HTTP API v2 + Lambda Authorizer + FastAPI verification:

```
Internet
    ↓
┌─────────────────────────────────────┐
│ HTTP API Gateway v2                 │
│ - Lambda Authorizer (HMAC with body)│
│ - Blocks invalid signatures at edge │
└─────────────────────────────────────┘
    ↓ (only authenticated requests)
┌─────────────────────────────────────┐
│ VPC Link                            │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Cloud Map Service Discovery         │
│ (benchling.local)                   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Private VPC                         │
│  ├─ ECS Fargate Service             │
│  │  - FastAPI application           │
│  │  - HMAC verification (redundant) │
│  │  - Business logic                │
│  │                                  │
│  ├─ NAT Gateway (for ECS egress)    │
│  └─ Security Groups                 │
└─────────────────────────────────────┘
```

**Security Layers:**
1. **Lambda Authorizer** - HMAC verification at API Gateway (blocks invalid requests)
2. **FastAPI Verification** - Redundant HMAC check in application (defense-in-depth)
3. **VPC Isolation** - Private subnets, no public IPs

**Key Point:** Even though Lambda Authorizer verifies HMAC, FastAPI keeps its verification too. If Lambda is compromised or bypassed, FastAPI still protects the application.

---

## Breaking Changes

### User-Facing Changes:

1. **Endpoint URL Format**
   - Old: `https://xxx.execute-api.region.amazonaws.com/prod/webhook`
   - New: `https://yyy.execute-api.region.amazonaws.com/webhook`
   - Stage prefix removed from path (HTTP API v2 uses default stage)

2. **Stack Recreation Required**
   - REST API → HTTP API v2 (cannot update in-place)
   - Must destroy and recreate stack
   - New API Gateway ID assigned

3. **Lambda Authorizer Event Format**
   - Internal change (not visible to users)
   - Lambda now receives v2.0 event format with body access
   - HMAC verification now actually works

### Non-Breaking:
- All configuration fields remain compatible
- Profile structure unchanged
- Secrets Manager format unchanged
- Docker image compatibility maintained
- FastAPI verification logic unchanged (still validates HMAC)

---

## Testing Requirements

### Pre-Deployment Tests:
- Verify HTTP API Gateway construct compiles
- Verify Lambda Authorizer adapted for v2.0 event format
- CDK synth succeeds with HTTP API v2
- Unit tests for Lambda Authorizer with body access

### Post-Deployment Tests:
- Health check endpoints work (unauthenticated)
- Valid HMAC signature → 200 OK
- Invalid HMAC signature → 401 Unauthorized (from Lambda, before reaching FastAPI)
- Tampered body → 401 Unauthorized (HMAC doesn't match)
- Verify Lambda logs show successful/failed HMAC verifications
- Verify FastAPI still validates HMAC (defense-in-depth)

### Lambda Authorizer Tests:
- Lambda receives body in event (HTTP API v2 format)
- Lambda computes HMAC over body correctly
- Valid signature → `{"isAuthorized": true}`
- Invalid signature → `{"isAuthorized": false}`
- Missing headers → `{"isAuthorized": false}`
- Malformed body → `{"isAuthorized": false}`

### Migration Tests:
- Deploy v0.8.0 stack → Detect legacy architecture
- User prompted to destroy → Aborts if declined
- Destroy → Deploy v0.9.0 → Verify new endpoint works
- Update Benchling URL → Test webhook flow

---

## Documentation Updates

### Files to Update:

1. **MIGRATION.md** (create if missing)
   - v0.8.0 → v0.9.0 upgrade guide
   - Stack destruction instructions
   - Endpoint URL update instructions
   - Explanation of HTTP API v2 requirement (body access for HMAC)

2. **CHANGELOG.md**
   - Document breaking changes
   - REST API → HTTP API v2
   - Lambda Authorizer adapted for body access
   - Explain HMAC verification now works correctly

3. **CLAUDE.md**
   - Update architecture section
   - Explain HTTP API v2 + Lambda Authorizer with body access
   - Update cost analysis (remove NLB)
   - Document defense-in-depth layers

4. **README.md**
   - Update architecture diagram
   - Show Lambda Authorizer with body access
   - Update monitoring section (Lambda logs)

---

## Cost Impact

### Components Removed:
- Network Load Balancer: -$16.20/month

### Components Changed:
- REST API → HTTP API v2: No cost change (~$1.00/million for HTTP v2)
- Lambda Authorizer: Same cost (~$0.20/million)

### Total Cost Change:
- Fixed: -$16.20/month (NLB removal)
- Variable: No change (Lambda still runs, same invocation cost)

**Net Savings:** ~$16.20/month

---

## HTTP API v2 Lambda Authorizer Configuration

**Authorizer Type:** REQUEST (not TOKEN)

**Identity Sources:**
- `$request.header.webhook-signature`
- `$request.header.webhook-id`
- `$request.header.webhook-timestamp`

**Payload Format:** 2.0 (provides body access)

**Enable Simple Responses:** true (use `{"isAuthorized": bool}` format)

**Authorizer Caching:** Disabled (each request must be verified)

**Integration:**
```typescript
const authorizer = new apigatewayv2.HttpLambdaAuthorizer(
    "WebhookAuthorizer",
    lambdaFunction,
    {
        authorizerName: "WebhookAuthorizer",
        identitySource: [
            "$request.header.webhook-signature",
            "$request.header.webhook-id",
            "$request.header.webhook-timestamp"
        ],
        responseTypes: [apigatewayv2.HttpLambdaResponseType.SIMPLE],
        resultsCacheTtl: cdk.Duration.seconds(0), // No caching
    }
);

// Attach to routes
api.addRoutes({
    path: "/webhook",
    methods: [apigatewayv2.HttpMethod.POST],
    integration: vpcLinkIntegration,
    authorizer: authorizer, // Lambda validates before forwarding
});
```

---

## Success Criteria

- [ ] HTTP API v2 construct restored from `sync-architecture`
- [ ] Lambda Authorizer adapted for HTTP API v2 event format (v2.0 with body)
- [ ] Lambda Authorizer successfully verifies HMAC over request body
- [ ] Network Load Balancer removed (VPC Link → Cloud Map direct)
- [ ] Invalid signatures blocked at API Gateway (never reach ECS)
- [ ] FastAPI still validates HMAC (defense-in-depth maintained)
- [ ] Legacy stack detection prompts user to destroy
- [ ] Migration workflow documented
- [ ] All tests pass
- [ ] Cost reduced by ~$16.20/month
- [ ] Ready for WAF integration (next spec)

---

## References

- HTTP API v2 Lambda Authorizers: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html
- Lambda Event Format (v2.0): https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html
- Architecture History: [01-arch-24.md](01-arch-24.md) - Original HTTP API design
- Current State: [03-arch-26.md](03-arch-26.md) - REST API + Lambda Authorizer (broken)
- Sync Branch: `sync-architecture` - Contains HTTP API v2 implementation
- Related: [08-add-waf.md](08-add-waf.md) - WAF integration (next step)
