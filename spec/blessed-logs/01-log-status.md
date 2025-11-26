# Log Detection Algorithm - Current Status

## Overview

This document describes the current implementation of log detection and fetching in `bin/commands/logs.ts` as of the current codebase state.

## Architecture

The log fetching system uses a **two-phase approach**:

### Phase 1: Stream Discovery
- Discovers all log streams matching a prefix (or all streams if no prefix)
- Sorts streams by `lastEventTimestamp` (newest first)
- Safety limit: 500 streams maximum (`MAX_STREAMS_TO_DISCOVER`)
- Location: `discoverLogStreams()` function (lines 286-354)

### Phase 2: Sequential Stream Querying
- Queries each discovered stream sequentially until criteria met
- Location: `fetchLogsFromGroup()` function (lines 408-558)

## Current Implementation Details

### Stream Discovery (`discoverLogStreams()`)

**Input:**
- `logGroupName` - CloudWatch log group
- `logStreamNamePrefix` - Optional prefix filter (e.g., "benchling/benchling")
- `startTime` - Used for context but NOT applied during discovery
- `spinner` - Optional progress indicator

**Process:**
1. Paginate through ALL streams matching prefix using `DescribeLogStreamsCommand`
2. Cannot use `orderBy` when using `logStreamNamePrefix` (AWS API limitation)
3. No time-based filtering during discovery - includes ALL streams regardless of age
4. Safety limit stops at 500 streams with warning
5. Manual sort by `lastEventTimestamp` after fetching (newest first)

**Issues:**
- ⚠️ **Does NOT filter by time range** - retrieves all streams even if they ended years ago
- ⚠️ **Inefficient** - May fetch hundreds of old, irrelevant streams
- ⚠️ **No early stopping** - Always fetches up to 500 streams even if first 10 have enough logs

### Log Fetching (`fetchLogsFromStream()`)

**Input:**
- `logGroupName` - CloudWatch log group
- `logStreamName` - Specific stream to query
- `startTime` - Time range filter (applied here)
- `filterPattern` - Optional CloudWatch filter pattern

**Process:**
1. Queries specific stream with `FilterLogEventsCommand`
2. Paginates up to 10 pages per stream (`MAX_PAGES_PER_STREAM`)
3. CloudWatch limit: 1000 events per request (`CLOUDWATCH_MAX_EVENTS`)
4. Max 10,000 events per stream (10 pages × 1000 events)

**Issues:**
- ⚠️ **Fetches ALL events** from stream regardless of limit
- ⚠️ **No deduplication** - Health checks counted and fetched, filtered later

### Orchestration (`fetchLogsFromGroup()`)

**Input:**
- `logGroupName` - CloudWatch log group
- `region` - AWS region
- `since` - Time range string (e.g., "5m", "1h")
- `limit` - Target number of non-health logs
- `filterPattern` - Optional CloudWatch filter
- `logStreamNamePrefix` - Optional prefix filter
- `useCache` - Whether to use incremental fetch cache

**Process:**

1. **Cache Check** (lines 438-448):
   - If cached: start from `lastSeenTimestamp` (incremental)
   - If not cached: start from `Date.now() - parseTimeRange(since)` (full range)

2. **Stream Discovery** (lines 452-472):
   - Discovers all matching streams (no time filter)
   - Returns empty array if none found

3. **Sequential Stream Processing** (lines 475-531):
   ```typescript
   for (let i = 0; i < streams.length; i++) {
       // Count non-health logs so far
       const nonHealthCount = allEvents.filter(e =>
           e.message && !isHealthCheck(e.message)
       ).length;

       // Fetch from this stream
       const streamEvents = await fetchLogsFromStream(...);
       allEvents.push(...streamEvents);

       // Memory safety check
       if (allEvents.length >= MAX_TOTAL_EVENTS) break;

       // Early stopping logic
       if (updatedNonHealthCount >= limit) {
           const oldestLogTime = Math.min(...timestamps);
           if (oldestLogTime <= startTime + EARLY_STOP_TIME_BUFFER) {
               break; // Stop if we've searched back far enough
           }
       }
   }
   ```

4. **Post-Processing** (lines 533-549):
   - Sort all events by timestamp (newest first)
   - Update cache with new events
   - Return all collected events

**Issues:**
- ⚠️ **Sequential processing** - Slow, no parallelization
- ⚠️ **Early stopping criteria problematic**:
  - Requires BOTH enough non-health logs AND time coverage
  - If recent streams only have health checks, keeps fetching old streams
  - Buffer logic (`EARLY_STOP_TIME_BUFFER`) adds 1 minute tolerance
- ⚠️ **Memory inefficient** - Accumulates up to 50,000 events before filtering

### Health Check Detection

**Function:** `isHealthCheck()` (lines 621-625)

```typescript
function isHealthCheck(message: string): boolean {
    return message.includes("/health") ||
           message.includes("/health/ready") ||
           message.includes("ELB-HealthChecker");
}
```

**Applied:**
- During display only (not during fetching)
- Counted during early stopping logic
- Filtered out in final display

**Issues:**
- ⚠️ **Late filtering** - Health checks still fetched and counted toward API limits
- ⚠️ **No CloudWatch filter** - Could use `filterPattern` to exclude at API level

### Caching System

**Cache Structure:**
```typescript
interface LogGroupCache {
    lastSeenTimestamp: number;    // Newest log we've seen
    lastFetchTime: number;        // When we last fetched
    oldestRetrieved: number;      // Oldest log we've retrieved
}
```

**Persistent Storage:**
- Location: `~/.config/benchling-webhook/{profile}/logs-cache.json`
- Updated after each fetch (line 537-539)
- Used to enable incremental fetching

**Cache Logic:**
- First fetch: Retrieve last `since` time range
- Subsequent fetches: Only retrieve logs newer than `lastSeenTimestamp`
- Tracks `oldestRetrieved` to know how far back we've searched

**Issues:**
- ⚠️ **No cache invalidation** - Old cache entries never expire
- ⚠️ **Cache key collisions** - Same key used for different prefixes?
- ⚠️ **Not shared across processes** - Each invocation reads/writes independently

## Critical Problems

### 1. Stream Discovery is Blind to Time

```typescript
// discoverLogStreams() fetches ALL streams regardless of time
const streams = await discoverLogStreams(...);
// NO filtering by startTime during discovery!
```

**Impact:**
- Fetches streams that ended days/weeks/months ago
- Wastes API calls on irrelevant streams
- Slows down discovery phase

**Example Scenario:**
- Service has 100 streams from last 30 days
- User requests logs from last 5 minutes
- Discovery phase fetches all 100 streams
- Then queries each stream sequentially until finding recent logs

### 2. Sequential Stream Processing

```typescript
for (let i = 0; i < streams.length; i++) {
    const streamEvents = await fetchLogsFromStream(...);
    // Wait for each stream before starting next
}
```

**Impact:**
- Each stream query takes 100-500ms
- 100 streams = 10-50 seconds of sequential queries
- No parallelization despite AWS allowing concurrent requests

### 3. Early Stopping Logic is Flawed

```typescript
if (updatedNonHealthCount >= limit) {
    const oldestLogTime = Math.min(...allEvents);
    if (oldestLogTime <= startTime + EARLY_STOP_TIME_BUFFER) {
        break; // Only stops if BOTH conditions met
    }
}
```

**Issues:**
- If recent streams only have health checks, continues fetching indefinitely
- Time coverage requirement (`oldestLogTime <= startTime + buffer`) is too strict
- Should prioritize getting `limit` logs over perfect time coverage

**Example Scenario:**
- User requests 50 logs from last 5 minutes
- First 20 streams only have health checks (last 2 minutes)
- Algorithm keeps fetching older streams to satisfy time coverage
- Should stop after collecting 50 non-health logs regardless of age

### 4. Health Checks Fetched Then Discarded

```typescript
// Fetch ALL events including health checks
const streamEvents = await fetchLogsFromStream(...);
allEvents.push(...streamEvents);

// Later: filter out health checks for counting
const nonHealthCount = allEvents.filter(e =>
    e.message && !isHealthCheck(e.message)
).length;
```

**Impact:**
- Wastes API quota on health check logs
- Increases CloudWatch costs
- Could use `filterPattern` to exclude at source

### 5. Memory Accumulation

```typescript
// Accumulates up to 50,000 events in memory
if (allEvents.length >= LOGS_CONFIG.MAX_TOTAL_EVENTS) {
    break;
}
```

**Impact:**
- High memory usage for large log volumes
- Still processes all events even if only need 50

### 6. No Parallelization in Multi-Group Fetch

The `fetchAllLogs()` function (lines 918-1079) does run log groups in parallel:

```typescript
const fetchPromises = sortedLogGroups.map(async (logGroupInfo) => {
    // Each log group fetched in parallel
    return await fetchLogsFromGroup(...);
});
await Promise.all(fetchPromises);
```

✅ **This part is good** - Multiple log groups are queried concurrently.

❌ **But within each log group** - Streams are queried sequentially.

## Performance Characteristics

### Best Case Scenario
- Single active stream with recent logs
- No health checks
- **Time:** ~1-2 seconds

### Typical Case
- 10-20 active streams
- Mix of application and health check logs
- **Time:** ~5-10 seconds

### Worst Case
- 500 streams (hitting max limit)
- Mostly health checks or old streams
- **Time:** ~60-120 seconds (can timeout)

## Dashboard Integration

The dashboard mode (lines 1163-1203) uses the same underlying fetch logic:

```typescript
const dashboardController = new LogsDashboardController({
    fetchLogsFunction: async (logGroupInfo: ConfigLogGroupInfo) => {
        return await fetchLogsFromGroup(...);
    },
});
```

**Issues:**
- Dashboard refresh inherits all performance problems
- Auto-refresh can be very slow
- No incremental update strategy for dashboard

## Configuration Constants

```typescript
const LOGS_CONFIG = {
    MAX_PAGES_PER_STREAM: 10,           // Max pagination per stream
    CLOUDWATCH_MAX_EVENTS: 1000,        // AWS API limit per request
    MAX_STREAMS_TO_DISCOVER: 500,       // Max streams to discover
    MAX_TOTAL_EVENTS: 50000,            // Memory safety limit
    EARLY_STOP_TIME_BUFFER: 60000,      // 1 minute buffer for time coverage
};
```

## Summary of Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| No time filtering in stream discovery | 🔴 Critical | Fetches hundreds of irrelevant streams |
| Sequential stream processing | 🔴 Critical | 10-60 second delays for multiple streams |
| Flawed early stopping logic | 🔴 Critical | May fetch far more logs than needed |
| Health checks fetched then discarded | 🟡 Medium | Wastes API quota and CloudWatch costs |
| No cache invalidation | 🟡 Medium | Stale cache entries accumulate |
| Memory accumulation | 🟡 Medium | High memory for large log volumes |
| No parallelization within group | 🔴 Critical | Bottleneck for multi-stream groups |

## Recommendations

1. **Filter streams by time during discovery** - Skip streams with `lastEventTimestamp < startTime`
2. **Parallelize stream queries** - Query multiple streams concurrently (e.g., 5-10 at a time)
3. **Simplify early stopping** - Stop when `limit` reached, ignore time coverage requirement
4. **Use CloudWatch filter patterns** - Exclude health checks at API level
5. **Implement cache expiration** - Clear cache entries older than 24 hours
6. **Add stream batching** - Process streams in batches with progress tracking

## Testing Evidence

Based on the codebase:
- No unit tests found for log fetching algorithms
- Integration tests exist but don't measure performance
- No benchmarks for different stream counts or log volumes

## Next Steps

1. Document proposed improvements in separate spec
2. Create benchmarks to measure current performance
3. Implement fixes incrementally with tests
4. Validate improvements against real deployments
