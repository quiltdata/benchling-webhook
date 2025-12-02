# Webhook AllowList Configuration Fix

**Date:** 2025-12-02
**Status:** Resolved
**Issue:** `webhookAllowList` from profile config was not being applied during deployment

## Problem Summary

The `webhookAllowList` value stored in profile configuration (`~/.config/benchling-webhook/{profile}/config.json`) was not propagating to the CDK stack during deployment. The value appeared correctly in the deployment plan output but the CDK synthesis logs showed "Resource Policy IP filtering: DISABLED (no webhookAllowList configured)".

## Root Cause

**Location:** `bin/commands/deploy.ts:608-633`

The deploy command was loading profile configuration correctly and displaying it in the deployment plan, but was **not passing security configuration to the CDK subprocess as environment variables**.

The CDK app entry point (`bin/benchling-webhook.ts`) was already prepared to receive these values via `process.env.WEBHOOK_ALLOW_LIST` and `process.env.ENABLE_WEBHOOK_VERIFICATION`, but the deploy command never set them when spawning the CDK subprocess.

## Configuration Flow Break Point

```
Profile Config (security.webhookAllowList = "59.0.1.1")
  ↓ XDGConfig.readProfileWithInheritance()
Deploy Command (config.security.webhookAllowList = "59.0.1.1") ✅
  ↓ Display deployment plan
Deployment Plan Output (IP Filtering: ENABLED with IPs) ✅
  ↓ execSync with env variables
❌ BREAK: No WEBHOOK_ALLOW_LIST environment variable set
  ↓
CDK App (process.env.WEBHOOK_ALLOW_LIST = undefined → "") ❌
  ↓ ProfileConfig construction
Stack Constructor (config.security.webhookAllowList = "") ❌
  ↓ Pass to REST API Gateway construct
REST API Gateway (allowedIps.length = 0) ❌
  ↓ Condition check fails
Resource Policy (IP filtering DISABLED) ❌
```

## Solution

**File:** `bin/commands/deploy.ts`
**Lines:** 635-641 (new code added)

Added environment variable passing for security configuration, following the same pattern used for VPC configuration:

```typescript
// Pass security configuration if specified in profile
if (config.security?.webhookAllowList) {
    env.WEBHOOK_ALLOW_LIST = config.security.webhookAllowList;
}
if (config.security?.enableVerification !== undefined) {
    env.ENABLE_WEBHOOK_VERIFICATION = config.security.enableVerification.toString();
}
```

This code was inserted after the VPC configuration block (line 633) and before the `execSync(cdkCommand, ...)` call (line 643).

## Why This Fix Works

1. **Follows existing pattern:** Uses the same approach as VPC configuration (lines 617-633)
2. **Minimal change:** Only 8 lines of code added, no refactoring required
3. **Backward compatible:** Works with both profiles that have and don't have `webhookAllowList`
4. **Already prepared:** CDK app entry point already had code to read these environment variables
5. **Safe:** Only passes values when they exist in profile config (uses optional chaining)

## Files Modified

### Primary Change
- [`bin/commands/deploy.ts`](../../bin/commands/deploy.ts) - Added security config environment variable passing (lines 635-641)

### Files That Already Worked Correctly (No Changes)
- [`bin/benchling-webhook.ts`](../../bin/benchling-webhook.ts) - Already reads `WEBHOOK_ALLOW_LIST` from env (line 207)
- [`lib/rest-api-gateway.ts`](../../lib/rest-api-gateway.ts) - Already has logic to use `webhookAllowList` (lines 36-62)
- [`lib/benchling-webhook-stack.ts`](../../lib/benchling-webhook-stack.ts) - Already passes config to REST API Gateway (line 283)
- [`lib/types/config.ts`](../../lib/types/config.ts) - Already defines `SecurityConfig` interface

## Testing

### Manual Verification Steps

1. **Setup profile with IP allowlist:**
   ```bash
   npm run setup -- --profile dev --yes
   # Verify shows: Webhook Allow List: 59.0.1.1 (from existing config)
   ```

2. **Deploy and verify CDK synthesis:**
   ```bash
   npm run setup -- deploy --profile dev
   # Deployment plan should show: IP Filtering: ENABLED (Resource Policy)
   #                                Allowed IPs: 59.0.1.1
   # CDK synthesis should show: Resource Policy IP filtering: ENABLED
   #                             Allowed IPs: 59.0.1.1
   ```

3. **Verify deployed resource policy:**
   - Check API Gateway console in AWS
   - Resource policy should include IP-based conditions
   - Health endpoints should remain accessible from any IP

### Expected Behavior

**Before fix:**
- Deployment plan showed correct IP allowlist
- CDK synthesis logged "DISABLED (no webhookAllowList configured)"
- Deployed API Gateway had no IP restrictions

**After fix:**
- Deployment plan shows correct IP allowlist
- CDK synthesis logs "ENABLED" with IP list
- Deployed API Gateway has resource policy with IP restrictions

## Related Documentation

- [Architecture Spec: REST API v1 + Resource Policy](./11-arch-30.md) - Original architecture decision
- [Investigation Spec](./15-webhook-allowlist-investigation.md) - Detailed investigation process
- [Security Model](../../CLAUDE.md#security-model) - Documentation of IP filtering approach

## Lessons Learned

1. **Environment variable passing is critical:** When using `execSync` to spawn CDK subprocess, all configuration must be explicitly passed via environment variables
2. **Pattern consistency matters:** Following the existing VPC config pattern made the fix obvious and easy to implement
3. **Deployment plan is not CDK context:** Just because deployment plan displays a value doesn't mean CDK process receives it
4. **Defensive coding pays off:** CDK app entry point was already prepared to receive these values, making the fix trivial

## Future Improvements

Consider adding:
1. **Unit tests** for deploy command environment variable setting
2. **Integration tests** for IP filtering behavior
3. **Configuration validation** that warns if profile config has values that won't propagate
4. **Debug logging** showing which environment variables are passed to CDK subprocess
