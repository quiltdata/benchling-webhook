# Spec: Remove Secret Caching for Instant Rotation (v1.2.0)

**Status:** In Progress
**Author:** Ernest
**Date:** 2025-12-16

## Problem

Current architecture caches Benchling secrets in memory at container startup and never refreshes them. This requires **ECS service restarts** after any secret update (commit 488bc19), causing:

1. **Downtime during rotation** - Container restarts required
2. **Slow response to security incidents** - Cannot instantly rotate compromised credentials
3. **Operational complexity** - Must orchestrate ECS restarts after secret changes
4. **Unnecessary coupling** - Secret Manager calls are fast (~100-500ms), not 40 seconds like JWKS

## Solution: Fetch Secrets On-Demand Per Request

Fetch fresh secrets from AWS Secrets Manager on **every webhook request**, enabling instant rotation without container restarts.

### Architecture Changes

#### Before (v1.1.0)

```tree
Container Startup:
  ├─ Fetch secrets from Secrets Manager (1x)
  ├─ Cache in Config instance
  └─ Use cached values forever

Webhook Request:
  └─ Use cached secrets (no Secrets Manager call)

Secret Rotation:
  ├─ Update AWS Secrets Manager
  ├─ Restart ECS service (commit 488bc19)
  └─ Container fetches new secrets at startup
```

#### After (v1.2.0)

```tree
Container Startup:
  ├─ Initialize Config (no secret fetch yet)
  ├─ Fetch secrets ONCE for JWKS pre-warming only
  └─ Pre-warm JWKS cache with startup app_definition_id

Webhook Request (EVERY TIME):
  ├─ Fetch fresh secrets from Secrets Manager (~100-500ms)
  ├─ Verify webhook signature with fresh app_definition_id
  └─ Process webhook with fresh credentials

Secret Rotation:
  ├─ Update AWS Secrets Manager
  └─ Next webhook request uses new secrets (instant!)
```

## Implementation Details

### 1. Config Class Refactoring

**File:** `docker/src/config.py`

**Changes:**

- Move secret fetching from `__post_init__()` to new `get_benchling_secrets()` method
- Store Secrets Manager client for on-demand fetching
- Keep environment variables cached (they don't change)
- Add `apply_benchling_secrets()` to update instance fields after fetch

**Key Design:**

```python
class Config:
    # Environment variables (cached at startup)
    quilt_catalog: str
    aws_region: str

    # Secret infrastructure (not the secrets themselves)
    _benchling_secret_name: str
    _sm_client: object

    def get_benchling_secrets(self) -> BenchlingSecretData:
        """Fetch fresh secrets on EVERY call (no caching)."""
        return fetch_benchling_secret(
            self._sm_client,
            self.aws_region,
            self._benchling_secret_name
        )
```

### 2. Webhook Verification Updates

**File:** `docker/src/app.py`

**Function:** `verify_webhook_signature()`

**Changes:**

```python
async def verify_webhook_signature(request, config, jwks_fetcher):
    # NEW: Fetch fresh secrets at start of every webhook verification
    secrets = config.get_benchling_secrets()
    config.apply_benchling_secrets(secrets)

    # Use freshly fetched app_definition_id
    app_definition_id = secrets.app_definition_id

    # Continue with verification using fresh app_definition_id
    verify(app_definition_id, body_str, headers, jwk_function=jwks_fetcher)
```

**Latency Impact:** Adds ~100-500ms to webhook processing (acceptable overhead).

### 3. JWKS Cache Management

**Critical:** JWKS keys are still cached (40-second fetch penalty in VPC), but cache must be invalidated when `app_definition_id` changes.

**Changes:**

```python
# Track current app_definition_id to detect rotation
jwks_cache: Dict[str, Any] = {}
current_app_definition_id: Dict[str, str] = {"id": ""}

def _jwks_fetcher_with_caching(app_definition_id: str) -> Any:
    # Detect app_definition_id change and invalidate cache
    if current_app_definition_id["id"] != app_definition_id:
        logger.warning("app_definition_id changed - invalidating JWKS cache")
        jwks_cache.clear()
        current_app_definition_id["id"] = app_definition_id

    # Continue with normal caching logic
    if app_definition_id not in jwks_cache:
        jwks_cache[app_definition_id] = jwks_by_app_definition(...)

    return jwks_cache[app_definition_id]
```

**Why This Matters:**

- If `app_definition_id` changes from `app_dev_123` to `app_prod_456`
- Old JWKS cache has keys for `app_dev_123`
- Without invalidation, verification fails with wrong keys

### 4. Startup Behavior

**Pre-warming JWKS cache still happens:**

```python
def _initialize_runtime():
    config = get_config()  # No secrets fetched yet

    # Fetch secrets ONCE for JWKS pre-warming
    startup_secrets = config.get_benchling_secrets()
    config.apply_benchling_secrets(startup_secrets)

    # Pre-warm JWKS cache (40-second operation)
    if startup_secrets.app_definition_id:
        jwks_fetcher_with_caching(startup_secrets.app_definition_id)

    # Create Benchling client with startup secrets
    benchling = create_benchling_client()
```

**Why fetch at startup if we fetch per-request?**

- **JWKS pre-warming:** Avoids 40-second delay on first webhook
- **Fail-fast validation:** Detects invalid secrets before webhooks arrive
- **First webhook performance:** First request doesn't pay startup cost

## Edge Cases & Handling

### Edge Case 1: Secret Fetch Failure During Webhook

**Scenario:** Secrets Manager is unavailable or secret is deleted during webhook processing.

**Handling:**

```python
try:
    secrets = config.get_benchling_secrets()
except SecretsManagerError as exc:
    logger.error("Failed to fetch secrets during webhook verification")
    raise WebhookVerificationError("secret_fetch_failed", str(exc))
```

**Result:** Webhook returns 403 Forbidden with clear error message.

**Recovery:** Fix Secrets Manager issue; next webhook succeeds automatically.

### Edge Case 2: app_definition_id Changes Mid-Request

**Scenario:** Secret rotates between:

1. Webhook verification (fetches `app_dev_123`)
2. Webhook processing (different request fetches `app_prod_456`)

**Handling:** Each part of the request fetches fresh secrets independently:

- Verification uses fresh fetch
- Processing uses separate fresh fetch
- If app_definition_id differs, JWKS cache invalidated on next call

**Result:** Slight inconsistency possible but webhook processing completes with secrets from verification call.

**Mitigation:** Store fetched secrets in request context if consistency required (future enhancement).

### Edge Case 3: JWKS Cache Invalidation During Concurrent Requests

**Scenario:**

1. Request A fetches secrets with `app_dev_123`, enters verification
2. Request B fetches secrets with `app_prod_456`, invalidates JWKS cache
3. Request A tries to use JWKS cache (now empty or has wrong keys)

**Handling:** JWKS fetcher checks `app_definition_id` before returning cached keys:

```python
if current_app_definition_id["id"] != app_definition_id:
    jwks_cache.clear()  # Invalidate
    current_app_definition_id["id"] = app_definition_id

# Re-fetch keys if cache was invalidated
if app_definition_id not in jwks_cache:
    jwks_cache[app_definition_id] = jwks_by_app_definition(...)
```

**Result:** Request A re-fetches JWKS keys (40-second delay) but uses correct keys.

**Impact:** First request after rotation pays 40-second JWKS fetch penalty.

### Edge Case 4: Gunicorn Worker Preloading

**Scenario:** With `gunicorn --preload`, app is loaded once before forking workers.

**Current Behavior:**

- JWKS cache pre-warmed in parent process
- Cache shared across workers via copy-on-write
- Workers inherit pre-warmed cache

**New Behavior:**

- JWKS cache still pre-warmed in parent
- Each worker fetches secrets independently per-request
- JWKS cache remains shared until first rotation

**Handling:** No changes needed; copy-on-write semantics handle this correctly.

### Edge Case 5: Rapid Secret Rotation

**Scenario:** Secrets rotated multiple times within seconds.

**Handling:**

- Each webhook request fetches current secret value at time of request
- No eventual consistency issues (Secrets Manager is strongly consistent)
- JWKS cache may thrash if `app_definition_id` changes frequently

**Result:** System handles gracefully; each request uses correct secrets.

**Note:** Frequent `app_definition_id` changes cause repeated 40-second JWKS fetches.

### Edge Case 6: client_secret Rotation Without app_definition_id Change

**Scenario:** Only `client_secret` rotates; `app_definition_id` stays the same.

**Handling:**

- Webhook verification continues using cached JWKS keys (correct behavior)
- Fresh `client_secret` used for Benchling API authentication
- No JWKS cache invalidation needed (same app)

**Result:** Seamless rotation without any cache invalidation.

### Edge Case 7: Secrets Manager Eventual Consistency

**Scenario:** AWS Secrets Manager updates might not be immediately consistent across regions.

**Reality:** Secrets Manager is **strongly consistent** within a region (source: AWS docs).

**Handling:** No special handling needed; fresh fetch always gets current value.

**Cross-Region:** If using cross-region replication, brief inconsistency possible.

### Edge Case 8: Container Startup Without Secrets

**Scenario:** Container starts but Secrets Manager is unreachable.

**Current Handling (v1.1.0):**

```python
try:
    config = get_config()  # Fails during __post_init__
except SecretsManagerError:
    record_startup_problem(exc, "config")
    # Container enters degraded mode
```

**New Handling (v1.2.0):**

```python
config = get_config()  # Succeeds (no secret fetch)

# Pre-warming attempt
try:
    startup_secrets = config.get_benchling_secrets()
except SecretsManagerError:
    logger.warning("Failed to fetch secrets for pre-warming")
    # Container starts anyway, will fetch per-request

# Health endpoint returns 200 OK (degraded mode)
```

**Result:** Container starts successfully, enters degraded mode, retries on each webhook.

## Performance Analysis

### Latency Impact

**Per-webhook overhead:** ~100-500ms for Secrets Manager API call

**Typical webhook processing time:**

- JWKS fetch (first request): ~40,000ms (cached after)
- Secret fetch (every request): ~100-500ms (NEW)
- Webhook verification: ~10-50ms
- Payload processing: ~500-2000ms
- **Total: ~600-2500ms** (secret fetch is ~4-20% overhead)

**Verdict:** Acceptable overhead for instant rotation capability.

### Secrets Manager API Costs

**Current (v1.1.0):** 1 API call per container startup

- 10 containers restarted daily = 10 API calls/day
- **Cost:** ~$0.0004/day ($0.012/month)

**New (v1.2.0):** 1 API call per webhook request

- 10,000 webhooks/day = 10,000 API calls/day
- **Cost:** ~$0.40/day ($12/month)

**Trade-off:** +$12/month for instant rotation without downtime.

**Mitigation (future):** Add short-lived TTL cache (5-15 minutes) if cost becomes issue.

## Deployment Strategy

### Phase 1: Implementation (Current)

- ✅ Refactor `Config` class with `get_benchling_secrets()`
- ✅ Update `verify_webhook_signature()` to fetch per-request
- ✅ Add JWKS cache invalidation on `app_definition_id` change
- ✅ Update startup to pre-warm JWKS with fresh secret fetch

### Phase 2: Testing

- Test secret rotation without restart
- Test `app_definition_id` rotation with JWKS cache invalidation
- Test concurrent requests during rotation
- Test degraded mode with Secrets Manager unreachable

### Phase 3: Remove ECS Restart Logic

**File:** `lib/wizard/phase6-integrated-mode.ts`, `lib/wizard/phase7-standalone-mode.ts`

**Change:** Make ECS restart **optional** with CLI flag:

```bash
npm run setup -- --restart-ecs    # Explicit opt-in
npm run setup                      # No restart (default in v1.2.0+)
```

**Rationale:** With on-demand secret fetching, restarts are no longer required.

**Backward Compatibility:** Keep restart logic for users who want immediate effect (e.g., log level changes).

## Open Questions

### Q1: Should we add a TTL cache for secrets?

**Trade-off:**

- **Pro:** Reduces Secrets Manager API calls (cost savings)
- **Pro:** Reduces latency (~100-500ms → ~0ms for cached requests)
- **Con:** Delays rotation by TTL duration (e.g., 5 minutes)
- **Con:** Adds complexity

**Decision:** Start with no TTL cache (Option C: per-request fetch). Add TTL later if cost/latency becomes issue.

### Q2: What if multiple secrets change simultaneously?

**Scenario:** Admin updates both `client_secret` AND `app_definition_id` in quick succession.

**Handling:** Each webhook request fetches atomically consistent state from Secrets Manager.

**Result:** Some requests use old values, some use new, but each request is self-consistent.

### Q3: Should we cache secrets per-request (request context)?

**Scenario:** Webhook verification and processing fetch secrets separately within same request.

**Current:** Each part fetches independently (2 Secrets Manager calls per webhook).

**Alternative:** Fetch once per request, store in request context.

**Decision:** Start without request-level caching. Add if profiling shows significant overhead.

### Q4: Should JWKS cache have a TTL?

**Current:** JWKS keys cached forever until `app_definition_id` changes.

**Alternative:** Add TTL (e.g., 24 hours) to automatically refresh JWKS keys.

**Rationale:**

- **Pro:** Handles JWKS key rotation by Benchling
- **Con:** Adds complexity
- **Con:** 40-second re-fetch penalty every 24 hours

**Decision:** Keep infinite cache. JWKS key rotation by Benchling is rare; can invalidate cache manually if needed.

## Success Criteria

- ✅ Secrets fetched on every webhook request
- ✅ JWKS cache invalidated when `app_definition_id` changes
- ✅ JWKS cache still pre-warmed at startup (avoids 40s first request)
- ✅ Secret rotation works without ECS restart
- ✅ Webhook latency increases by <500ms on average
- ✅ No webhook failures during secret rotation
- ✅ Clear error messages if secret fetch fails

## Rollback Plan

If issues arise:

1. Revert `docker/src/config.py` to v1.1.0 (cache secrets at startup)
2. Revert `docker/src/app.py` verification changes
3. Re-enable mandatory ECS restarts after secret updates
4. Deploy new Docker image with reverted changes

## References

- Commit 488bc19: "fix(setup): restart ECS services after secret updates"
- Commit 3da2ecf: "fix(webhook): add JWKS caching to eliminate 40s delays"
- AWS Secrets Manager pricing: $0.40 per 10,000 API calls
- AWS Secrets Manager consistency: Strong consistency within region
