# IP Whitelisting Status - Current Implementation

**Date:** 2025-12-20
**Branch:** 297-ip-whitelisting-should-cover-external-health-checks
**Status:** Documentation of current behavior

## Executive Summary

IP whitelisting (allowlisting) is currently implemented via **REST API Gateway Resource Policy** and applies **only to webhook endpoints**. Health endpoints are **intentionally exempted** to allow external monitoring and NLB health checks. There are **no differences in whitelisting behavior between dev and prod** - the same logic applies to all deployment stages.

## Architecture Overview

### Security Layers

The system implements a **two-layer security model**:

1. **Optional Network Layer: Resource Policy IP Filtering**
   - Applied when `security.webhookAllowList` is configured in profile
   - Blocks unknown IPs at API Gateway edge (before reaching application)
   - **Free** - no additional AWS costs
   - Health endpoints always exempt from IP filtering

2. **Required Authentication Layer: FastAPI HMAC Verification**
   - All webhook requests must have valid HMAC signatures
   - Verification happens in FastAPI application using Benchling SDK
   - This is the **primary authentication mechanism**
   - Invalid signatures return 403 Forbidden

### Why REST API v1?

REST API Gateway v1 was chosen specifically for its resource policy support, which provides:

- Free IP filtering (vs $7/month for WAF with HTTP API v2)
- Fine-grained access control per endpoint
- Native integration with API Gateway (no separate service)
- Ability to exempt health endpoints from restrictions

See [spec/2025-11-26-architecture/11-arch-30.md](../2025-11-26-architecture/11-arch-30.md) for detailed architectural analysis.

## Configuration

### Profile Configuration

IP whitelisting is configured per profile in `~/.config/benchling-webhook/{profile}/config.json`:

```json
{
  "security": {
    "webhookAllowList": "192.168.1.0/24,10.0.0.0/8",
    "enableVerification": true
  }
}
```

- **`webhookAllowList`**: Comma-separated list of IP addresses/CIDR blocks
  - Empty string or omitted = No IP filtering (all IPs allowed)
  - Example: `"59.0.1.1,203.0.113.0/24"`
- **`enableVerification`**: Enable/disable HMAC signature verification
  - Default: `true`
  - Should only be disabled for testing

### Environment Variable Propagation

Configuration flows from profile to CDK stack via environment variables:

```
Profile Config (security.webhookAllowList)
  ↓ XDGConfig.readProfileWithInheritance()
Deploy Command (config.security.webhookAllowList)
  ↓ buildCdkEnv() - sets WEBHOOK_ALLOW_LIST env var
CDK Subprocess (process.env.WEBHOOK_ALLOW_LIST)
  ↓ bin/benchling-webhook.ts - reads env var
ProfileConfig construction (security.webhookAllowList)
  ↓ Pass to BenchlingWebhookStack
RestApiGateway construct (props.config.security)
  ↓ Build resource policy
API Gateway Resource Policy (deployed)
```

**Key file:** [bin/commands/deploy.ts](../../bin/commands/deploy.ts) (lines 635-641)

```typescript
// Pass security configuration if specified in profile
if (config.security?.webhookAllowList) {
    env.WEBHOOK_ALLOW_LIST = config.security.webhookAllowList;
}
if (config.security?.enableVerification !== undefined) {
    env.ENABLE_WEBHOOK_VERIFICATION = config.security.enableVerification.toString();
}
```

See [spec/2025-11-26-architecture/16-webhook-allowlist-fix.md](../2025-11-26-architecture/16-webhook-allowlist-fix.md) for the fix that enabled this propagation.

## Endpoint Coverage

### Implementation Location

**File:** [lib/rest-api-gateway.ts](../../lib/rest-api-gateway.ts) (lines 57-134)

### When IP Filtering is DISABLED (No allowlist configured)

```typescript
if (allowedIps.length === 0) {
    // Single statement allowing all requests from anywhere
    policyStatements.push(
        new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: ["execute-api:Invoke"],
            resources: ["execute-api:/*"],
        }),
    );
}
```

**Result:** All endpoints accessible from any IP address.

### When IP Filtering is ENABLED (Allowlist configured)

Two policy statements are created:

#### Statement 1: Health Endpoints (EXEMPT from IP filtering)

```typescript
// Statement 1: Health endpoints always accessible (no IP restriction)
policyStatements.push(
    new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ["execute-api:Invoke"],
        resources: [
            // Direct health endpoints (for NLB health checks)
            "execute-api:/*/GET/health",
            "execute-api:/*/GET/health/ready",
            "execute-api:/*/GET/health/live",
            // Stage-prefixed health endpoints (for API Gateway requests)
            "execute-api:/*/GET/*/health",
            "execute-api:/*/GET/*/health/ready",
            "execute-api:/*/GET/*/health/live",
        ],
    }),
);
```

**Covered endpoints:**

- `GET /health` - General health check
- `GET /health/ready` - Readiness probe
- `GET /health/live` - Liveness probe
- `GET /{stage}/health` - Stage-prefixed health check
- `GET /{stage}/health/ready` - Stage-prefixed readiness
- `GET /{stage}/health/live` - Stage-prefixed liveness

**Why exempt?**

1. NLB health checks must reach the application from internal AWS IPs
2. External monitoring services (Pingdom, Datadog, etc.) need access
3. Health checks do not process sensitive data or trigger business logic
4. Health checks do not require authentication

#### Statement 2: Webhook Endpoints (IP RESTRICTED)

```typescript
// Statement 2: Webhook endpoints with IP restrictions
policyStatements.push(
    new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ["execute-api:Invoke"],
        resources: [
            // Direct webhook endpoints
            "execute-api:/*/POST/event",
            "execute-api:/*/POST/lifecycle",
            "execute-api:/*/POST/canvas",
            // Stage-prefixed webhook endpoints
            "execute-api:/*/POST/*/event",
            "execute-api:/*/POST/*/lifecycle",
            "execute-api:/*/POST/*/canvas",
        ],
        conditions: {
            IpAddress: {
                "aws:SourceIp": allowedIps,
            },
        },
    }),
);
```

**Covered endpoints:**

- `POST /event` - Entry webhook events (create, update, archive)
- `POST /lifecycle` - App lifecycle events (install, uninstall)
- `POST /canvas` - Canvas block rendering requests
- `POST /{stage}/event` - Stage-prefixed entry webhooks
- `POST /{stage}/lifecycle` - Stage-prefixed lifecycle events
- `POST /{stage}/canvas` - Stage-prefixed canvas blocks

**Why restricted?**

1. Process sensitive data from Benchling
2. Trigger business logic (package creation, SQS messaging)
3. Require HMAC authentication (verified in FastAPI)
4. Should only receive traffic from known Benchling IPs

### Endpoints NOT Covered by Resource Policy

The following endpoint is **not mentioned** in the resource policy:

- `GET /config` - Configuration introspection endpoint (no stage-prefixed version)

**Location:** [docker/src/app.py:549](../../docker/src/app.py#L549)

**Implication:** When IP filtering is enabled, this endpoint is **blocked** because it doesn't match any ALLOW statement in the resource policy. This is likely unintentional but may be acceptable since it's a debug/introspection endpoint.

## FastAPI Route Implementation

### Flexible Route Handling

FastAPI implements **duplicate routes** to support both direct and stage-prefixed paths:

**Example from [docker/src/app.py](../../docker/src/app.py):**

```python
# Direct paths (for NLB health checks)
@app.get("/health")
async def health():
    return {"status": "healthy"}

# Stage-prefixed paths (for API Gateway)
@app.get("/{stage}/health")
async def health_with_stage(stage: str):
    return {"status": "healthy"}
```

**Why both?**

- API Gateway with HTTP_PROXY forwards complete path including stage: `/prod/health`
- NLB health checks use direct path without stage: `/health`
- Both must work simultaneously

See [spec/2025-11-26-architecture/13-fastapi-flexible-routes.md](../2025-11-26-architecture/13-fastapi-flexible-routes.md) for detailed explanation.

### All Webhook Endpoints

| Endpoint Pattern | FastAPI Routes | Resource Policy Coverage |
|-----------------|----------------|-------------------------|
| Health checks | `/health`, `/{stage}/health` | ✅ EXEMPT (all IPs) |
| Health ready | `/health/ready`, `/{stage}/health/ready` | ✅ EXEMPT (all IPs) |
| Health live | `/health/live`, `/{stage}/health/live` | ✅ EXEMPT (all IPs) |
| Entry webhooks | `/event`, `/{stage}/event` | ✅ RESTRICTED |
| Lifecycle webhooks | `/lifecycle`, `/{stage}/lifecycle` | ✅ RESTRICTED |
| Canvas blocks | `/canvas`, `/{stage}/canvas` | ✅ RESTRICTED |
| Config introspection | `/config` (no stage version) | ❌ BLOCKED when filtering enabled |

## Stage-Specific Behavior

### Stage Determination

**File:** [lib/benchling-webhook-stack.ts](../../lib/benchling-webhook-stack.ts) (lines 292-293)

```typescript
// Get stage from environment or default to prod
const stage = process.env.STAGE || "prod";
```

The stage is passed to deployment via:

- `STAGE` environment variable set by deploy command
- Defaults to `"prod"` if not specified
- Common values: `"dev"`, `"prod"`, `"staging"`

### No Stage-Specific Whitelisting Differences

**Key Point:** The IP whitelisting behavior is **identical across all stages** (dev, prod, staging, etc.).

**Why?**

1. Resource policy logic in [lib/rest-api-gateway.ts](../../lib/rest-api-gateway.ts) does not reference `props.stage`
2. Allowlist is read from `props.config.security.webhookAllowList` which is stage-agnostic
3. Each profile can be deployed to multiple stages with the same security config

**Example:**

```bash
# Deploy default profile to dev stage
npm run deploy:dev -- --profile default

# Deploy default profile to prod stage
npm run deploy:prod -- --profile default
```

Both deployments use the same `~/.config/benchling-webhook/default/config.json` which has a single `security.webhookAllowList` value. There is no mechanism to specify different allowlists per stage within a single profile.

### Per-Stage Allowlists (Workaround)

To have different allowlists for dev vs prod, use **separate profiles**:

```bash
# Profile: dev (with internal test IPs)
~/.config/benchling-webhook/dev/config.json:
{
  "security": {
    "webhookAllowList": "10.0.0.0/8,172.16.0.0/12"
  }
}

# Profile: prod (with Benchling production IPs)
~/.config/benchling-webhook/prod/config.json:
{
  "security": {
    "webhookAllowList": "192.168.1.0/24"
  }
}

# Deploy different profiles to different stages
npm run deploy:dev -- --profile dev --stage dev
npm run deploy:prod -- --profile prod --stage prod
```

## Logging and Observability

### CDK Synthesis Logs

During deployment, the resource policy logic logs its decisions:

**When IP filtering is disabled:**

```
Resource Policy IP filtering: DISABLED (no webhookAllowList configured)
All endpoints accessible from any IP
```

**When IP filtering is enabled:**

```
Resource Policy IP filtering: ENABLED
Allowed IPs: 59.0.1.1, 203.0.113.0/24
Health endpoints exempt from IP filtering (always accessible)
Created 2 resource policy statements
  - Statement 1: Health endpoints (no IP restriction)
  - Statement 2: Webhook endpoints (IP restricted)
```

**Location:** [lib/rest-api-gateway.ts](../../lib/rest-api-gateway.ts) (lines 80-134)

### Deployment Plan Output

The deploy command displays security settings before deployment:

```
Security Settings:
  Webhook Verification:    ENABLED
  IP Filtering:            ENABLED (Resource Policy)
                           Allowed IPs: 59.0.1.1, 203.0.113.0/24
```

**Location:** [bin/commands/deploy.ts](../../bin/commands/deploy.ts) (lines 710-728)

### Runtime Logs

**API Gateway Access Logs:**

- Log group: `/aws/apigateway/benchling-webhook-rest`
- Shows 403 responses when IP is blocked by resource policy
- Includes source IP, request path, status code

**ECS Container Logs:**

- Log group: `/ecs/benchling-webhook`
- Shows HMAC verification results (separate from IP filtering)
- Only logs requests that pass resource policy

**Key distinction:** Resource policy blocks at API Gateway edge, so blocked requests never reach ECS container and don't appear in application logs.

## Testing IP Filtering

### Manual Verification Steps

1. **Deploy with IP allowlist:**

   ```bash
   npm run setup -- --profile test-ip
   # Configure webhookAllowList: "1.2.3.4"
   npm run deploy:dev -- --profile test-ip
   ```

2. **Verify health endpoints are accessible:**

   ```bash
   # Should succeed from any IP
   curl https://xxx.execute-api.us-east-1.amazonaws.com/dev/health
   ```

3. **Verify webhook endpoints are blocked:**

   ```bash
   # Should return 403 Forbidden if your IP is not in allowlist
   curl -X POST https://xxx.execute-api.us-east-1.amazonaws.com/dev/event \
     -H "Content-Type: application/json" \
     -d '{"test": true}'
   ```

4. **Check API Gateway resource policy:**
   - AWS Console → API Gateway → REST APIs
   - Select "BenchlingWebhookRestAPI"
   - Resource Policy tab → Verify IP conditions

### Automated Testing

Current test coverage:

- **Unit tests:** [test/rest-api-gateway.test.ts](../../test/rest-api-gateway.test.ts)
  - Verifies resource policy generation logic
  - Tests both enabled and disabled states
  - Validates statement structure

**Gap:** No integration tests that actually verify IP blocking behavior at runtime.

## Known Issues and Limitations

### 1. `/config` Endpoint Blocked

**Issue:** The `GET /config` endpoint is blocked when IP filtering is enabled because it's not included in either resource policy statement.

**Impact:** Low - this is a debug endpoint not used by Benchling webhooks.

**Fix:** Add to health endpoint exemption statement if access is needed.

### 2. No Per-Stage Allowlists

**Issue:** Single profile cannot have different allowlists for dev vs prod stages.

**Workaround:** Use separate profiles per stage/environment.

**Rationale:** Design decision to keep profiles simple and stage-agnostic.

### 3. CloudFormation Parameter Bloat

**Context:** The resource policy is defined in CDK code, not via CloudFormation parameters, so IP allowlist cannot be updated via stack update alone - requires CDK re-synthesis and redeployment.

**Impact:** Medium - changing allowlist requires full deployment (~5 minutes).

**Alternative approach:** Could use WAF IP sets (dynamic updates) but costs $7/month vs $0 for resource policy.

## Security Posture Summary

### Defense in Depth

The system implements **defense in depth** with two independent security layers:

1. **Network Layer (Resource Policy)**: Blocks unknown IPs at edge
   - Fast rejection (no Lambda or container overhead)
   - Prevents DDoS from arbitrary IPs
   - Free with REST API v1

2. **Application Layer (HMAC)**: Verifies webhook authenticity
   - Validates Benchling signatures
   - Single source of truth for authentication
   - Cannot be bypassed by IP spoofing

### Threat Model

**Protected against:**

- ✅ Webhook injection from external attackers
- ✅ Replay attacks (HMAC includes timestamp)
- ✅ DDoS from non-allowlisted IPs
- ✅ Unauthorized access to webhook endpoints

**Not protected against:**

- ⚠️ Compromised Benchling OAuth credentials (HMAC still validates)
- ⚠️ Man-in-the-middle (mitigated by TLS 1.2+)
- ⚠️ Attacks from allowlisted IPs (must still pass HMAC)

### Recommendations

1. **Health endpoints:** Continue exempting from IP filtering - required for operational monitoring
2. **Webhook endpoints:** Always require both IP allowlist AND HMAC verification in production
3. **Config endpoint:** Decide if this needs access and add to resource policy if so
4. **Stage-specific allowlists:** Use separate profiles if dev and prod need different IPs

## Related Documentation

- [Architecture: REST API v1 + Resource Policy](../2025-11-26-architecture/11-arch-30.md)
- [Implementation: Webhook Allowlist Fix](../2025-11-26-architecture/16-webhook-allowlist-fix.md)
- [Implementation: Flexible Routes](../2025-11-26-architecture/13-fastapi-flexible-routes.md)
- [Security Model](../../CLAUDE.md#security-model)
- [Configuration](../../CLAUDE.md#configuration-v070)

## Changelog

- **2025-12-20:** Initial documentation of IP whitelisting status
