# Remove Health Endpoint Exemption from IP Whitelisting

**Date:** 2025-12-20
**Status:** Proposed
**Issue:** Customer requirement to block external health checks in production deployments

## Problem Statement

Current implementation exempts health endpoints from IP filtering to allow:

1. External monitoring services (Pingdom, Datadog, etc.) access
2. NLB health checks from internal AWS IPs

**Customer requirement:** Block external `/health` endpoint access when IP whitelisting is enabled.

**Initial concern:** Would this break NLB health checks?

## Architecture Clarification

**Key insight:** NLB health checks **do NOT go through API Gateway**.

```
External monitoring (e.g., Pingdom)
  ↓
REST API Gateway (PUBLIC, with Resource Policy) ← IP filtering applies here
  ↓
VPC Link (encrypted tunnel into VPC)
  ↓
Network Load Balancer (INTERNAL, in private subnets) ← Health checks originate here
  ↓ (direct connection, bypasses API Gateway)
ECS Fargate Tasks (private subnets)
```

**NLB health check path:**

- NLB → ECS tasks (direct TCP connection on port 80)
- Request: `GET /health` (direct path, no stage prefix)
- **Never touches API Gateway or Resource Policy**

**External monitoring path:**

- Internet → API Gateway → VPC Link → NLB → ECS
- Request: `GET /prod/health` (stage-prefixed)
- **Subject to API Gateway Resource Policy**

## Solution

**Remove health endpoint exemption** from API Gateway resource policy without breaking NLB health checks.

### Current Behavior (2 statements)

**Statement 1:** Health endpoints exempt (any IP)

```typescript
resources: [
    "execute-api:/*/GET/health",
    "execute-api:/*/GET/health/ready",
    "execute-api:/*/GET/health/live",
    "execute-api:/*/GET/*/health",
    "execute-api:/*/GET/*/health/ready",
    "execute-api:/*/GET/*/health/live",
]
// No IP condition - always accessible
```

**Statement 2:** Webhook endpoints restricted

```typescript
resources: [
    "execute-api:/*/POST/event",
    "execute-api:/*/POST/lifecycle",
    "execute-api:/*/POST/canvas",
    "execute-api:/*/POST/*/event",
    "execute-api:/*/POST/*/lifecycle",
    "execute-api:/*/POST/*/canvas",
]
conditions: {
    IpAddress: { "aws:SourceIp": allowedIps }
}
```

### Proposed Behavior (1 statement)

**Single statement:** All endpoints restricted when allowlist configured

```typescript
resources: [
    "execute-api:/*"  // All endpoints including health
]
conditions: {
    IpAddress: { "aws:SourceIp": allowedIps }
}
```

### Impact Analysis

**When `webhookAllowList` is empty (dev profile default):**

- ✅ All endpoints accessible from any IP
- ✅ External health checks work
- ✅ NLB health checks work

**When `webhookAllowList` is configured (prod profile):**

- ✅ External health checks **blocked** (customer requirement met)
- ✅ NLB health checks **continue working** (bypass API Gateway)
- ✅ Webhook endpoints restricted to allowlisted IPs
- ✅ Benchling traffic from allowlisted IPs continues working

## Implementation Plan

### 1. Modify Resource Policy Logic

**File:** `lib/rest-api-gateway.ts` (lines 64-134)

**Changes:**

```typescript
// When IP filtering is enabled
if (allowedIps.length > 0) {
    // Single statement: All endpoints restricted to allowlisted IPs
    policyStatements.push(
        new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: ["execute-api:Invoke"],
            resources: ["execute-api:/*"],  // All endpoints
            conditions: {
                IpAddress: {
                    "aws:SourceIp": allowedIps,
                },
            },
        }),
    );

    console.log("Resource Policy IP filtering: ENABLED");
    console.log(`Allowed IPs: ${allowedIps.join(", ")}`);
    console.log("All endpoints (including health) restricted to allowlisted IPs");
    console.log("Note: NLB health checks bypass API Gateway and continue working");
}
```

**Remove:**

- Lines 86-102: Statement 1 (health exemption)
- Lines 104-134: Statement 2 (webhook restrictions)

**Simplification:** Single unified policy statement for all endpoints.

### 2. Update Dev Profile Default

**File:** `scripts/install-wizard.ts` (or relevant setup wizard location)

**Add convention:** When creating `dev` profile, set `security.webhookAllowList = ""` by default.

```typescript
// When profile === "dev"
const defaultSecurity: SecurityConfig = {
    webhookAllowList: "",  // No IP filtering for dev
    enableVerification: true,  // HMAC still required
};
```

**Documentation update:** Add note explaining dev/prod conventions.

### 3. Update Tests

**File:** `test/rest-api-gateway.test.ts`

**Update test expectations:**

- When allowlist empty: Single statement allowing all IPs
- When allowlist configured: Single statement with IP conditions (no health exemption)
- Verify statement count changes from 2 to 1

### 4. Update Documentation

**Files to update:**

1. **`spec/297-ip-whitelisting/01-whitelist-status.md`**
   - Update "Statement 1" and "Statement 2" sections
   - Change to single unified statement
   - Update "Why exempt?" reasoning (remove NLB justification)

2. **`CLAUDE.md`** (project documentation)
   - Section: "Security Model" → Update resource policy description
   - Section: "Configuration" → Document dev profile convention

3. **`README.md`**
   - Update security overview
   - Clarify health endpoint behavior

### 5. Logging Updates

**Update console logs in deployment:**

**Before:**

```
Resource Policy IP filtering: ENABLED
Allowed IPs: 59.0.1.1
Health endpoints exempt from IP filtering (always accessible)
Created 2 resource policy statements
  - Statement 1: Health endpoints (no IP restriction)
  - Statement 2: Webhook endpoints (IP restricted)
```

**After:**

```
Resource Policy IP filtering: ENABLED
Allowed IPs: 59.0.1.1
All endpoints restricted to allowlisted IPs
NLB health checks unaffected (bypass API Gateway)
```

## Testing Strategy

### Unit Tests

1. **Resource policy generation:**
   - Verify single statement when allowlist configured
   - Verify `resources: ["execute-api:/*"]`
   - Verify IP conditions present

2. **Dev profile creation:**
   - Verify `webhookAllowList = ""` by default
   - Verify can be overridden

### Integration Tests

1. **Dev deployment (no allowlist):**

   ```bash
   npm run setup -- --profile dev
   npm run deploy:dev -- --profile dev
   curl https://xxx.execute-api.us-east-1.amazonaws.com/dev/health
   # Should succeed from any IP
   ```

2. **Prod deployment (with allowlist):**

   ```bash
   npm run setup -- --profile prod
   # Configure webhookAllowList: "203.0.113.0/24"
   npm run deploy:prod -- --profile prod

   # From non-allowlisted IP
   curl https://xxx.execute-api.us-east-1.amazonaws.com/prod/health
   # Should return 403 Forbidden

   # From allowlisted IP
   curl https://xxx.execute-api.us-east-1.amazonaws.com/prod/health
   # Should succeed
   ```

3. **NLB health checks (verify still working):**
   - Check ECS task health in AWS Console
   - Verify targets healthy in NLB target group
   - Check CloudWatch metrics for healthy target count

## Migration Strategy

### Backward Compatibility

**Breaking change:** Existing deployments with `webhookAllowList` configured will start blocking external health checks.

**Migration path:**

1. **Announce change:** Include in CHANGELOG and release notes
2. **Version bump:** Consider this a minor breaking change (v1.x.x)
3. **User action:** Users who need external health checks should:
   - Remove `webhookAllowList` (disable IP filtering), OR
   - Add monitoring service IPs to allowlist

### Rollout Plan

1. **Phase 1:** Update code and tests
2. **Phase 2:** Deploy to internal dev environment
3. **Phase 3:** Verify NLB health checks working
4. **Phase 4:** Release new version with migration notes
5. **Phase 5:** Update customer deployments

## Security Considerations

### Improved Security Posture

**Before:**

- Health endpoints always accessible from any IP
- Information disclosure: Service availability, response times
- Potential reconnaissance vector

**After:**

- Health endpoints protected by IP filtering in production
- Reduced attack surface
- Defense in depth: HMAC + IP filtering for all endpoints

### Trade-offs

**Pros:**

- Blocks external health checks (customer requirement)
- Simpler resource policy (1 statement vs 2)
- Consistent security model (all endpoints treated equally)
- NLB health checks unaffected

**Cons:**

- External monitoring services need allowlist access
- Cannot use public health check services (unless IPs allowlisted)
- Slightly less flexible than per-endpoint policies

## Alternatives Considered

### Alternative 1: Keep Health Exemption (Rejected)

**Why rejected:** Doesn't meet customer requirement to block external health checks.

### Alternative 2: Stage-Specific Health Exemption

**Approach:** Exempt health in dev, restrict in prod.

**Why rejected:** Adds complexity without clear benefit. Dev profile convention (no allowlist) achieves same goal more simply.

### Alternative 3: Separate Health Allowlist

**Approach:** Two separate allowlists - one for webhooks, one for health.

**Why rejected:** Over-engineered. Most deployments want same IP restrictions for all endpoints.

## Success Criteria

1. ✅ External health checks blocked when IP filtering enabled
2. ✅ NLB health checks continue working
3. ✅ Dev profile defaults to no IP filtering
4. ✅ Existing webhook functionality unchanged
5. ✅ All tests passing
6. ✅ Documentation updated
7. ✅ Migration guide provided

## Related Issues

- [Issue #297](https://github.com/quiltdata/benchling-webhook/issues/297) - IP whitelisting should cover external health checks
- [spec/297-ip-whitelisting/01-whitelist-status.md](./01-whitelist-status.md) - Current implementation analysis

## Changelog Entry

```markdown
### Changed
- **BREAKING:** IP whitelisting now applies to all endpoints including health checks
- Health endpoints are no longer automatically exempted from resource policy IP filtering
- External monitoring services must be added to webhookAllowList or IP filtering disabled
- NLB health checks continue working (bypass API Gateway)

### Added
- Dev profile defaults to no IP filtering (`webhookAllowList = ""`)
- Simplified resource policy logic (single statement instead of two)

### Migration
- If you use external health check services: Add their IPs to `webhookAllowList` or disable IP filtering
- If you don't need external health checks: No action required
- NLB health checks are unaffected by this change
```
