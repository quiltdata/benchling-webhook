# Logs Discovery Fix - Multi-Container Support

**Date:** 2025-11-21
**Status:** ✅ COMPLETED
**Issue:** Setup wizard was not discovering all container logs from multi-container ECS services

## Problem Statement

The setup wizard's log discovery was only finding logs from the FIRST container in each ECS task definition, missing application logs from additional containers. This was because:

1. `discoverECSServices()` only checked `containerDefinitions[0]`
2. Multi-container services (like benchling with nginx + app) have logs in separate streams
3. ECS log stream naming follows pattern: `{awslogs-stream-prefix}/{container-name}/{task-id}`
4. We were only saving the `awslogs-stream-prefix` without the `/{container-name}` part

### Specific Example

The `tf-dev-bench-benchling` service has TWO containers:
- Container 1: `nginx` with stream prefix `benchling-nginx` → streams like `benchling-nginx/nginx/{taskId}`
- Container 2: `benchling` with stream prefix `benchling` → streams like `benchling/benchling/{taskId}`

The discovery was only finding Container 1 (nginx), missing all the actual application logs in Container 2 (benchling).

## Root Causes

### 1. Only Checking First Container
**File:** `lib/utils/ecs-service-discovery.ts:94`

```typescript
// BEFORE (WRONG):
const logConfig = taskDefResponse.taskDefinition?.containerDefinitions?.[0]?.logConfiguration;
```

This only looked at the first container, missing all subsequent containers in multi-container task definitions.

### 2. Incomplete Stream Prefix
**File:** `lib/utils/ecs-service-discovery.ts:202`

```typescript
// BEFORE (WRONG):
const logStreamPrefix = logConfig.options?.["awslogs-stream-prefix"];
// This gives us "benchling" but streams are "benchling/benchling/*"
```

We were only saving the `awslogs-stream-prefix` value, but ECS actually creates streams using the pattern `{prefix}/{container-name}/{task-id}`.

### 3. Return Structure
**File:** `lib/utils/ecs-service-discovery.ts`

The function returned one `ECSServiceInfo` per SERVICE, but we needed one per CONTAINER.

## Solution

### 1. Iterate Through ALL Containers

**File:** `lib/utils/ecs-service-discovery.ts`

```typescript
// AFTER (CORRECT):
// Iterate through ALL containers in the task definition
const containers = taskDefResponse.taskDefinition?.containerDefinitions || [];
for (const container of containers) {
    const logConfig = container.logConfiguration;
    if (logConfig?.logDriver === "awslogs") {
        const logGroup = logConfig.options?.["awslogs-group"];
        const awslogsStreamPrefix = logConfig.options?.["awslogs-stream-prefix"];

        // ECS log streams follow the pattern: {awslogs-stream-prefix}/{container-name}/{task-id}
        // So we need to construct the full prefix including the container name
        const fullStreamPrefix = awslogsStreamPrefix && container.name
            ? `${awslogsStreamPrefix}/${container.name}`
            : awslogsStreamPrefix;

        if (logGroup && fullStreamPrefix) {
            services.push({
                serviceName: svc.serviceName || "unknown",
                containerName: container.name,
                logGroup,
                logStreamPrefix: fullStreamPrefix,
            });
        }
    }
}
```

### 2. Updated Interface

**File:** `lib/utils/ecs-service-discovery.ts`

```typescript
export interface ECSServiceInfo {
    serviceName: string;
    containerName?: string;  // NEW: Track which container this is
    logGroup?: string;
    logStreamPrefix?: string;
}
```

### 3. Pass Stream Prefix to AWS API

**File:** `bin/commands/logs.ts`

```typescript
const command = new FilterLogEventsCommand({
    logGroupName,
    startTime,
    filterPattern,
    limit,
    logStreamNamePrefix, // NEW: Filter by container's stream prefix
});
```

### 4. Update Phase 2 Display Names

**File:** `lib/wizard/phase2-stack-query.ts`

```typescript
// Create a descriptive name using service + container
const displayName = svc.containerName
    ? `${svc.serviceName}/${svc.containerName}`
    : svc.serviceName;

logGroups.push({
    name: svc.logGroup,
    type: "ecs",
    displayName: `${displayName} (ECS)`,
    streamPrefix: svc.logStreamPrefix,  // Now includes container name!
});
```

## Files Modified

1. **`lib/utils/ecs-service-discovery.ts`**
   - Added `containerName` to `ECSServiceInfo` interface
   - Changed to iterate through ALL containers, not just `[0]`
   - Construct full stream prefix: `{awslogs-stream-prefix}/{container-name}`
   - Return one entry per CONTAINER instead of per SERVICE

2. **`lib/wizard/types.ts`**
   - Added `logGroups?: LogGroupInfo[]` to `StackQueryResult`
   - Import `LogGroupInfo` from config types

3. **`lib/wizard/phase2-stack-query.ts`**
   - Added log group discovery logic after stack query
   - Build descriptive names with service/container format
   - Display discovered log streams during setup
   - Return log groups in `StackQueryResult`

4. **`lib/wizard/phase6-integrated-mode.ts`**
   - Save discovered log groups to `deployment.logGroups` in config
   - Display discovered log groups at end of setup
   - Show format: `{service}/{container} (ECS): {log-group}`

5. **`bin/commands/logs.ts`**
   - Added `logStreamNamePrefix` parameter to `fetchLogsFromGroup()`
   - Pass stream prefix from config to AWS FilterLogEventsCommand
   - This filters logs to only the specific container's streams

6. **`bin/cli.ts`**
   - Increased default log limit from 5 to 20 entries
   - More useful logs visible by default

## Additional Improvements Made

### 1. Better Health Check Detection

**File:** `bin/commands/logs.ts`

```typescript
// Before: Only caught /health endpoints
function isHealthCheck(message: string): boolean {
    return message.includes("/health") || message.includes("/health/ready");
}

// After: Also catches ELB health checker traffic
function isHealthCheck(message: string): boolean {
    return message.includes("/health") ||
           message.includes("/health/ready") ||
           message.includes("ELB-HealthChecker");
}
```

### 2. More Compact Log Output

**File:** `bin/commands/logs.ts`

```
Before:
tf-dev-bench-benchling (ECS):
  Log Group: tf-dev-bench

  Application Logs:
    16 entries, 2 log streams

    registry/nginx-catalog/fe02783dfbf14d21aa6dcbfe6bf36b85:
      Stream: registry/nginx-catalog/fe02783dfbf14d21aa6dcbfe6bf36b85
      Entries: 9, unique patterns: 7

After:
tf-dev-bench-benchling (ECS) (tf-dev-bench)

  Application Logs (16 entries, 2 streams):

    registry/nginx-catalog/fe02783dfbf14d21aa6dcbfe6bf36b85 · 7 patterns:
```

Saved 4 lines per log group, allowing more actual log content to be displayed.

### 3. Increased Default Limit

Default log entries per group increased from 5 to 20, showing more useful information without manual `--limit` flags.

## Testing Results

### Before Fix
```bash
npm run setup -- --profile bench --yes
# Output:
Discovering CloudWatch log groups...
✓ Log Group: tf-dev-bench  # Only found nginx container
✓ Log Group: tf-dev-bench  # Duplicate entries
✓ Log Group: tf-dev-bench
```

### After Fix
```bash
npm run setup -- --profile bench --yes
# Output:
Discovering CloudWatch log groups...
✓ Log Stream: benchling-nginx/nginx → tf-dev-bench
✓ Log Stream: benchling/benchling → tf-dev-bench      # NOW FOUND!
✓ Log Stream: bulk_loader/bucket_scanner → tf-dev-bench
✓ Log Stream: registry/nginx-catalog → tf-dev-bench

# Saved configuration:
[
  {
    "name": "tf-dev-bench",
    "type": "ecs",
    "displayName": "tf-dev-bench-benchling/nginx (ECS)",
    "streamPrefix": "benchling-nginx/nginx"
  },
  {
    "name": "tf-dev-bench",
    "type": "ecs",
    "displayName": "tf-dev-bench-benchling/benchling (ECS)",
    "streamPrefix": "benchling/benchling"  # CORRECT PREFIX!
  },
  ...
]
```

### Logs Command Works
```bash
npm run setup -- logs --profile bench --timer 0 --since 1h

# Now correctly filters logs by stream prefix:
# - benchling-nginx/nginx/* streams for nginx container
# - benchling/benchling/* streams for benchling container (APPLICATION LOGS!)
```

## Architecture Insight

### ECS Log Stream Naming Convention

When ECS creates log streams, it follows this pattern:

```
{awslogs-stream-prefix}/{container-name}/{task-id}
```

**Example:**
- Task Definition specifies:
  - Container name: `benchling`
  - awslogs-stream-prefix: `benchling`
- ECS creates streams like:
  - `benchling/benchling/f91ebcd6994a4d35bbddeebb50026e28`
  - `benchling/benchling/3ffb9a82081c4d63b72019b68ce70bb1`

**Therefore:**
- We must construct the full prefix: `{prefix}/{container-name}`
- This allows FilterLogEventsCommand to find the right streams
- Without this, the logs command queries the wrong stream prefix and finds nothing

## Impact

✅ **Setup wizard now discovers ALL container logs**, not just the first container
✅ **Logs command correctly filters by stream prefix** to show container-specific logs
✅ **Application logs from multi-container services** (like benchling webhook processor) are now visible
✅ **Better UX with compact output** - more logs visible in terminal
✅ **ELB health checks filtered out** - only real application logs shown
✅ **Higher default limit** (20 vs 5) - more useful information by default

## Verification

To verify the fix is working:

```bash
# 1. Run setup to discover logs
npm run setup -- --profile YOUR_PROFILE --yes

# 2. Check saved configuration
cat ~/.config/benchling-webhook/YOUR_PROFILE/config.json | jq '.deployment.logGroups'

# 3. Verify stream prefixes include container names
# Should see entries like:
#   "streamPrefix": "benchling/benchling"
#   "streamPrefix": "benchling-nginx/nginx"

# 4. View logs
npm run setup -- logs --profile YOUR_PROFILE --timer 0 --since 1h

# 5. Verify you see logs from ALL containers, including application logs
```

## Key Learning

**When working with multi-container ECS services:**
- Each container has its own log configuration
- Stream prefixes must include the container name to match ECS's naming
- Always iterate through ALL containers in a task definition
- Don't assume `containerDefinitions[0]` is the only or most important container

## Related Issues

- Fixes incomplete logs refactoring where log discovery was moved into setup
- Resolves issue where actual webhook processing logs weren't visible
- Addresses user report that logs from `https://us-east-2.console.aws.amazon.com/ecs/v2/clusters/tf-dev-bench/services/tf-dev-bench-benchling/logs` weren't showing up in CLI

## Status

✅ **COMPLETE** - All changes implemented, tested, and working correctly

The setup wizard now properly discovers logs from all containers in multi-container ECS services, and the logs command correctly displays them using the proper stream prefix filtering.
