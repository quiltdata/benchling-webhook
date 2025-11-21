# Specification: Fix Log Stream Pagination for ECS Task Restarts

## Overview

The logs command currently fails to find logs from ECS tasks that have restarted. CloudWatch's `FilterLogEventsCommand` with `logStreamNamePrefix` only paginates within the most recent log stream, missing logs from previous task instances.

## Problem Statement

### Current Behavior

When an ECS task restarts (due to deployment, scaling, or failure), CloudWatch creates a new log stream:
- Old task: `benchling/benchling/abc123def456`
- New task: `benchling/benchling/xyz789abc012`

The current implementation uses `FilterLogEventsCommand` with:
```typescript
{
  logGroupName: "tf-dev-bench",
  logStreamNamePrefix: "benchling/benchling",
  startTime: Date.now() - parseTimeRange(since),
  nextToken: ...
}
```

**Issue**: When `nextToken` becomes `undefined`, it means CloudWatch has exhausted the **current (newest) stream**, but there are older streams from previous tasks that haven't been searched.

### Real-World Impact

```bash
$ npm run setup -- logs --profile bench
# Searched 60 log entries back to 2025-11-21T22:32:26.897Z
# Current time: 2025-11-21T22:38:15Z

💡 No application logs found (only health checks).
   Searched 60 log entries back to 2025-11-21T22:32:26.897Z
```

**Problem**: Only searched back ~6 minutes despite having logs from 15 minutes ago. The logs exist but are in an older stream from a previous task that was replaced.

### Root Cause

CloudWatch's pagination behavior with `logStreamNamePrefix`:
1. Finds all streams matching the prefix
2. **Paginates within the most recent stream first**
3. When that stream is exhausted (`nextToken = undefined`), pagination stops
4. **Never searches older streams** from previous task instances

## Requirements

### Functional Requirements

1. **FR1**: Search ALL log streams matching a container's prefix, not just the most recent
2. **FR2**: Find logs from previous ECS task instances (after restarts/deployments)
3. **FR3**: Continue pagination across multiple streams until finding requested number of non-health logs
4. **FR4**: Maintain per-container isolation (don't mix logs from different containers)
5. **FR5**: Stop searching once enough non-health logs are found (performance optimization)

### Non-Functional Requirements

1. **NFR1**: Performance - Minimize CloudWatch API calls
2. **NFR2**: Cost - Don't scan more logs than necessary
3. **NFR3**: Reliability - Handle missing/empty streams gracefully
4. **NFR4**: Backward Compatibility - No changes to command interface or output format

## Goals

1. **Fix stream discovery**: Enumerate all matching streams before querying
2. **Cross-stream pagination**: Query streams from newest to oldest until finding logs
3. **Efficient stopping**: Stop early once enough non-health logs are collected
4. **Maintain filtering**: Still filter to specific containers using streamPrefix

## Non-Goals

- Changing the command-line interface
- Changing the output format
- Adding new log filtering capabilities
- Optimizing health check filtering (separate concern)
- Changing how streamPrefix is stored in config

## User Stories

### Story 1: Finding Logs After Task Restart

**As a** developer debugging a webhook issue
**I want** to see logs from before the last ECS task restart
**So that** I can understand what happened before the failure

**Acceptance Criteria:**
- Logs from old task instances (abc123) are found
- Logs from new task instances (xyz789) are found
- Logs are ordered by timestamp (newest first)
- Searches back to requested time range (e.g., `--since 30m`)

### Story 2: Multi-Container Log Isolation

**As a** operator monitoring a multi-container service (nginx + app)
**I want** to see logs from each container separately
**So that** I can isolate issues to specific components

**Acceptance Criteria:**
- `benchling-nginx/nginx` logs don't include `benchling/benchling` logs
- Each container shows logs from ALL its task restarts
- Display names correctly identify each container

### Story 3: Performance with Frequent Restarts

**As a** team with auto-scaling enabled
**I want** logs command to be fast even with many task restarts
**So that** I'm not waiting minutes for log output

**Acceptance Criteria:**
- Stops searching once enough non-health logs are found
- Doesn't enumerate all streams if recent streams have enough logs
- Minimizes CloudWatch API calls

## Technical Design

### Architecture Overview

**Current Implementation** (BROKEN):
```
fetchLogsFromGroup()
└── FilterLogEventsCommand({ logStreamNamePrefix: "benchling/benchling" })
    ├── Returns logs from newest stream
    ├── nextToken = undefined when stream exhausted
    └── STOPS (misses old streams)
```

**New Implementation** (FIXED):
```
fetchLogsFromGroup()
├── Phase 1: Discover Streams
│   └── DescribeLogStreamsCommand({ logStreamNamePrefix: "benchling/benchling" })
│       └── Returns: ["benchling/benchling/abc123", "benchling/benchling/xyz789", ...]
│       └── Sort by lastEventTime (newest first)
│
└── Phase 2: Query Streams
    ├── For each stream (newest to oldest):
    │   └── FilterLogEventsCommand({ logStreamNames: [streamName] })
    │       └── Paginate within this stream
    │       └── Collect non-health logs
    │
    └── Stop when: enough logs OR all streams searched
```

### Algorithm

```typescript
async function fetchLogsFromGroup(
    logGroupName: string,
    region: string,
    since: string,
    limit: number,
    filterPattern?: string,
    awsProfile?: string,
    logStreamNamePrefix?: string,
): Promise<FilteredLogEvent[]> {
    const logsClient = new CloudWatchLogsClient(...);
    const startTime = Date.now() - parseTimeRange(since);
    const allEvents: FilteredLogEvent[] = [];

    // Phase 1: Discover all streams matching prefix
    const streams = await discoverLogStreams(
        logsClient,
        logGroupName,
        logStreamNamePrefix,
        startTime
    );

    // Phase 2: Query each stream until we have enough logs
    for (const stream of streams) {
        const streamEvents = await fetchLogsFromStream(
            logsClient,
            logGroupName,
            stream.logStreamName,
            startTime,
            filterPattern
        );

        allEvents.push(...streamEvents);

        // Stop if we have enough non-health logs
        const nonHealthCount = allEvents.filter(e =>
            e.message && !isHealthCheck(e.message)
        ).length;

        if (nonHealthCount >= limit) {
            break;
        }
    }

    return allEvents;
}
```

### New Functions

#### 1. `discoverLogStreams()`

**Purpose**: Find all log streams matching a prefix, sorted by recency

**Signature**:
```typescript
async function discoverLogStreams(
    logsClient: CloudWatchLogsClient,
    logGroupName: string,
    logStreamNamePrefix: string | undefined,
    startTime: number,
): Promise<LogStream[]>
```

**Implementation**:
```typescript
async function discoverLogStreams(
    logsClient: CloudWatchLogsClient,
    logGroupName: string,
    logStreamNamePrefix: string | undefined,
    startTime: number,
): Promise<LogStream[]> {
    const streams: LogStream[] = [];
    let nextToken: string | undefined;

    // Paginate through all matching streams
    while (true) {
        const command = new DescribeLogStreamsCommand({
            logGroupName,
            logStreamNamePrefix,
            orderBy: "LastEventTime", // Newest first
            descending: true,
            nextToken,
        });

        const response = await logsClient.send(command);

        if (response.logStreams) {
            // Only include streams with events in our time range
            const recentStreams = response.logStreams.filter(stream =>
                stream.lastEventTime && stream.lastEventTime >= startTime
            );
            streams.push(...recentStreams);
        }

        nextToken = response.nextToken;
        if (!nextToken) break;
    }

    return streams;
}
```

**Why `orderBy: "LastEventTime"`?**
- Ensures we search newest streams first
- Increases likelihood of finding logs quickly
- Allows early stopping once enough logs are found

**Why filter by `lastEventTime >= startTime`?**
- Avoids searching very old streams that can't have logs in our time range
- Performance optimization - reduces streams to query

#### 2. `fetchLogsFromStream()`

**Purpose**: Fetch all logs from a single specific stream

**Signature**:
```typescript
async function fetchLogsFromStream(
    logsClient: CloudWatchLogsClient,
    logGroupName: string,
    logStreamName: string,
    startTime: number,
    filterPattern?: string,
): Promise<FilteredLogEvent[]>
```

**Implementation**:
```typescript
async function fetchLogsFromStream(
    logsClient: CloudWatchLogsClient,
    logGroupName: string,
    logStreamName: string,
    startTime: number,
    filterPattern?: string,
): Promise<FilteredLogEvent[]> {
    const events: FilteredLogEvent[] = [];
    let nextToken: string | undefined;
    const maxPages = 10; // Limit per stream to prevent runaway queries
    let pageCount = 0;

    while (pageCount < maxPages) {
        const command = new FilterLogEventsCommand({
            logGroupName,
            logStreamNames: [logStreamName], // Query specific stream
            startTime,
            filterPattern,
            limit: 1000, // CloudWatch max
            nextToken,
        });

        const response = await logsClient.send(command);

        if (response.events && response.events.length > 0) {
            events.push(...response.events);
        }

        nextToken = response.nextToken;
        pageCount++;

        if (!nextToken) break;
    }

    return events;
}
```

**Why `maxPages = 10` per stream?**
- 10 pages × 1000 events = 10,000 events max per stream
- Prevents infinite loops on corrupted streams
- Typical stream has < 1000 events in a reasonable time window

### Updated Imports

```typescript
import {
    CloudWatchLogsClient,
    FilterLogEventsCommand,
    DescribeLogStreamsCommand, // NEW
    type FilteredLogEvent,
    type LogStream,             // NEW
} from "@aws-sdk/client-cloudwatch-logs";
```

### Changes to Existing Code

**File**: `bin/commands/logs.ts`

**Function**: `fetchLogsFromGroup()` (lines 119-182)

**Changes**:
1. Remove direct `FilterLogEventsCommand` with `logStreamNamePrefix`
2. Add call to `discoverLogStreams()` to enumerate streams
3. Loop through streams calling `fetchLogsFromStream()` for each
4. Aggregate results and check non-health count
5. Stop early if enough non-health logs are collected

### Data Flow

```
User runs: npm run setup -- logs --profile bench

CLI
└── logsCommand()
    └── fetchAllLogs()
        └── For each logGroupInfo:
            └── fetchLogsFromGroup(
                    logGroupName: "tf-dev-bench",
                    streamPrefix: "benchling/benchling"
                )
                ├── discoverLogStreams()
                │   └── DescribeLogStreamsCommand
                │       └── Returns: [
                │           { logStreamName: "benchling/benchling/xyz789", lastEventTime: 1732227600 },
                │           { logStreamName: "benchling/benchling/abc123", lastEventTime: 1732226700 }
                │       ]
                │
                └── For each stream:
                    ├── fetchLogsFromStream("benchling/benchling/xyz789")
                    │   └── FilterLogEventsCommand({ logStreamNames: ["...xyz789"] })
                    │       └── Returns 30 events (25 health + 5 app logs)
                    │
                    └── fetchLogsFromStream("benchling/benchling/abc123")
                        └── FilterLogEventsCommand({ logStreamNames: ["...abc123"] })
                            └── Returns 50 events (45 health + 5 app logs)
                            └── Total: 10 non-health logs → STOP (limit reached)
```

## Implementation Plan

### Phase 1: Add Stream Discovery (3 hours)

1. ✅ Add `DescribeLogStreamsCommand` to imports
2. ✅ Implement `discoverLogStreams()` function
3. ✅ Add unit tests for stream discovery
4. ✅ Handle pagination in stream discovery
5. ✅ Filter streams by time range

### Phase 2: Implement Per-Stream Fetching (3 hours)

1. ✅ Implement `fetchLogsFromStream()` function
2. ✅ Replace `logStreamNamePrefix` with `logStreamNames` parameter
3. ✅ Add per-stream pagination
4. ✅ Add maxPages limit per stream
5. ✅ Add unit tests

### Phase 3: Update Main Fetch Logic (2 hours)

1. ✅ Refactor `fetchLogsFromGroup()` to use new functions
2. ✅ Add cross-stream aggregation logic
3. ✅ Implement early stopping when enough logs found
4. ✅ Update error handling
5. ✅ Add integration tests

### Phase 4: Testing (3 hours)

1. ✅ Unit tests for `discoverLogStreams()`
2. ✅ Unit tests for `fetchLogsFromStream()`
3. ✅ Integration test with multiple streams
4. ✅ Test early stopping behavior
5. ✅ Test with missing/empty streams
6. ✅ Test with very old streams (time filter)

### Phase 5: Documentation (1 hour)

1. ✅ Update code comments
2. ✅ Add rationale for two-phase approach
3. ✅ Document performance considerations
4. ✅ Update troubleshooting guide

**Total Estimated Time**: 12 hours

## Testing Strategy

### Unit Tests

**New File**: `test/bin/commands/logs-pagination.test.ts`

```typescript
describe("discoverLogStreams", () => {
    it("should find all streams matching prefix");
    it("should sort streams by lastEventTime descending");
    it("should filter out streams older than startTime");
    it("should handle pagination in stream list");
    it("should handle empty stream list");
});

describe("fetchLogsFromStream", () => {
    it("should fetch all events from a single stream");
    it("should paginate within stream");
    it("should respect maxPages limit");
    it("should handle empty stream");
    it("should apply filterPattern");
});

describe("fetchLogsFromGroup (refactored)", () => {
    it("should search multiple streams in order");
    it("should stop early when limit reached");
    it("should aggregate events from multiple streams");
    it("should handle mix of empty and populated streams");
    it("should respect time range across streams");
});
```

### Integration Tests

```bash
# Test with logs across multiple task restarts
npm run setup -- logs --profile bench --since 30m

# Expected: Finds logs from both old and new task instances
# Expected: Shows correct count of non-health logs
# Expected: Searches back to full 30m time range
```

### Manual Testing Scenarios

**Scenario 1: Recent Task Restart**
1. Deploy new version (triggers task restart)
2. Wait for new task to start
3. Run `logs --since 30m`
4. ✅ Should show logs from BOTH old and new tasks

**Scenario 2: Multiple Restarts**
1. Trigger 3 task restarts in 20 minutes
2. Run `logs --since 30m`
3. ✅ Should show logs from ALL 3 task instances

**Scenario 3: Old Logs Only**
1. Make update 1 hour ago
2. No activity since
3. Current task stream is mostly health checks
4. Run `logs --since 2h`
5. ✅ Should find logs from old task before restart

**Scenario 4: Performance with Many Streams**
1. Service with 10+ task restarts
2. Run `logs --tail 20`
3. ✅ Should stop after finding 20 logs (not search all streams)
4. ✅ Should complete in < 5 seconds

## Performance Considerations

### API Call Analysis

**Before (BROKEN)**:
```
FilterLogEventsCommand with logStreamNamePrefix
├── 1 API call for newest stream
└── Misses old streams entirely
= 1 API call (but incomplete results)
```

**After (FIXED)**:
```
DescribeLogStreamsCommand (stream discovery)
├── 1 API call per 50 streams (pagination)
└── Typical: 1-2 API calls

FilterLogEventsCommand per stream
├── 1 API call per 1000 events per stream
└── Early stopping when limit reached

Typical case (2 streams, 50 logs needed):
├── 1 DescribeLogStreamsCommand
├── 1 FilterLogEventsCommand (stream 1)
└── 1 FilterLogEventsCommand (stream 2)
= 3 API calls (complete results)
```

### Cost Analysis

CloudWatch Logs pricing (us-east-1, as of 2025):
- API calls: $0.01 per 1000 requests
- Data scanned: $0.005 per GB

**Before**: 1 API call, incomplete data (effectively infinite cost if logs don't exist where searched)
**After**: 3-5 API calls, complete data

**Net Impact**: +2-4 API calls per logs command = +$0.00002-$0.00004 per invocation ≈ **negligible**

### Optimization: Early Stopping

```typescript
// Stop if we have enough non-health logs
const nonHealthCount = allEvents.filter(e =>
    e.message && !isHealthCheck(e.message)
).length;

if (nonHealthCount >= limit) {
    break; // Don't search more streams
}
```

**Why?**
- If first 2 streams have enough logs, don't search stream 3-10
- Saves API calls and time
- Most common case: recent logs in newest stream

**Example**:
- Request 50 logs
- Stream 1 (newest): 40 non-health logs
- Stream 2: 15 non-health logs
- **Stop** - we have 55 logs, don't search stream 3+

## Edge Cases & Error Handling

### Edge Case 1: No Streams Found

**Scenario**: `streamPrefix` doesn't match any streams (typo in config)

**Handling**:
```typescript
const streams = await discoverLogStreams(...);
if (streams.length === 0) {
    console.warn(chalk.yellow(
        `No log streams found matching prefix: ${logStreamNamePrefix}\n` +
        `This could mean:\n` +
        `  - No tasks have run yet\n` +
        `  - The streamPrefix in config is incorrect\n` +
        `  - Tasks haven't logged anything yet`
    ));
    return [];
}
```

### Edge Case 2: All Streams Empty

**Scenario**: Streams exist but have no events in time range

**Handling**:
- `fetchLogsFromStream()` returns empty array
- Aggregate across all streams
- Final result: empty array
- Display "No logs found" message (existing behavior)

### Edge Case 3: Stream Discovery Pagination Fails

**Scenario**: `DescribeLogStreamsCommand` throws error

**Handling**:
```typescript
try {
    const streams = await discoverLogStreams(...);
} catch (error) {
    console.warn(chalk.dim(
        `Could not discover log streams: ${error.message}\n` +
        `Falling back to prefix-based search (may miss old logs)`
    ));
    // Fall back to old behavior for this container
    return fetchLogsLegacy(...);
}
```

### Edge Case 4: Very Large Number of Streams

**Scenario**: Service with 100+ task restarts (long-running, frequent deployments)

**Handling**:
- `DescribeLogStreamsCommand` automatically paginates (50 streams per page)
- Time filter prevents searching very old streams
- Early stopping prevents scanning all streams
- **Worst case**: Search 10-20 streams before finding enough logs

### Edge Case 5: Time Range Extends Beyond Oldest Stream

**Scenario**: Request `--since 7d` but oldest stream is 3d old

**Handling**:
- Search all discovered streams
- Return what's available
- Display actual time range searched (existing behavior)

## Success Metrics

1. **Completeness**: Find logs from ALL task instances in time range (not just newest)
2. **Performance**: < 5 seconds for typical query (2-3 streams)
3. **Cost**: < $0.0001 per invocation (negligible CloudWatch API costs)
4. **Reliability**: Handle missing/empty streams gracefully
5. **Backward Compatibility**: No changes to command interface or output format

## Rollout Plan

1. **Implementation**: 12 hours (see Implementation Plan)
2. **Code Review**: Review with team
3. **Unit Testing**: Automated tests for all new functions
4. **Integration Testing**: Manual testing with real deployments
5. **Beta Testing**: Deploy to internal dev environment
6. **Release**: Include in next patch version (0.8.8)
7. **Monitor**: Track CloudWatch API call costs and performance

## Appendix A: CloudWatch API Comparison

### `FilterLogEventsCommand` Parameters

| Parameter | Type | Description | Old Code | New Code |
|-----------|------|-------------|----------|----------|
| `logGroupName` | string | Required | ✅ | ✅ |
| `logStreamNames` | string[] | Specific streams | ❌ | ✅ (single stream) |
| `logStreamNamePrefix` | string | Prefix filter | ✅ | ❌ (removed) |
| `startTime` | number | Time range start | ✅ | ✅ |
| `endTime` | number | Time range end | ❌ | ❌ |
| `filterPattern` | string | Log filter | ✅ | ✅ |
| `limit` | number | Max events per page | ✅ | ✅ |
| `nextToken` | string | Pagination | ✅ | ✅ |

**Key Change**: Use `logStreamNames: [specificStream]` instead of `logStreamNamePrefix`

**Why?**
- `logStreamNamePrefix` paginates **within a single stream**
- `logStreamNames` allows **querying specific streams** explicitly
- Gives us full control over which streams to search

### `DescribeLogStreamsCommand` Parameters

| Parameter | Type | Description | Usage |
|-----------|------|-------------|-------|
| `logGroupName` | string | Required | ✅ |
| `logStreamNamePrefix` | string | Prefix filter | ✅ |
| `orderBy` | string | Sort order | ✅ `LastEventTime` |
| `descending` | boolean | Newest first | ✅ `true` |
| `limit` | number | Max streams per page | ✅ (default 50) |
| `nextToken` | string | Pagination | ✅ |

**Purpose**: Enumerate all streams before querying

## Appendix B: Real-World Log Stream Examples

### Example 1: Single-Container Service

```
Log Group: /ecs/benchling-webhook
Streams:
  benchling-webhook/BenchlingWebhookContainer/abc123def456  (current)
  benchling-webhook/BenchlingWebhookContainer/xyz789abc012  (old)
  benchling-webhook/BenchlingWebhookContainer/123456789abc  (older)
```

**Config streamPrefix**: `"benchling-webhook/BenchlingWebhookContainer"`
**Matches**: All 3 streams ✅

### Example 2: Multi-Container Service (Benchling Integration)

```
Log Group: tf-dev-bench
Streams:
  benchling-nginx/nginx/abc123           (nginx current)
  benchling-nginx/nginx/xyz789           (nginx old)
  benchling/benchling/def456             (app current)
  benchling/benchling/uvw987             (app old)
  bulk_loader/bucket_scanner/ghi123      (scanner current)
  registry/nginx-catalog/jkl456          (catalog current)
```

**Config streamPrefixes**:
- `"benchling-nginx/nginx"` → Matches only nginx streams ✅
- `"benchling/benchling"` → Matches only app streams ✅
- `"bulk_loader/bucket_scanner"` → Matches only scanner stream ✅
- `"registry/nginx-catalog"` → Matches only catalog stream ✅

**Per-container isolation maintained** ✅

### Example 3: Frequent Restarts (Auto-Scaling)

```
Log Group: /ecs/benchling-webhook
Streams (last 2 hours):
  benchling-webhook/.../task-15  14:35:00 - 14:38:00
  benchling-webhook/.../task-14  14:30:00 - 14:35:00
  benchling-webhook/.../task-13  14:25:00 - 14:30:00
  benchling-webhook/.../task-12  14:20:00 - 14:25:00
  ... (many more)
```

**Query**: `--since 30m` (looking for logs from 14:08:00 onwards)

**Behavior**:
- Discover streams sorted by `lastEventTime`
- Search task-15 first (most recent)
- Continue to task-14, task-13, task-12...
- **Stop early** once 50 non-health logs found
- **Don't search** all older streams unnecessarily

## Appendix C: Rationale for Two-Phase Approach

### Why Not Just Remove `logStreamNamePrefix`?

**Option A: Remove prefix entirely**
```typescript
// Don't filter by stream prefix at all
FilterLogEventsCommand({
    logGroupName,
    startTime,
    // No logStreamNamePrefix
})
```

**Problems**:
- ❌ Mixes logs from ALL containers (nginx + app + scanner)
- ❌ Can't isolate logs per container
- ❌ Breaks user expectation of per-container views

### Why Not Use `logStreamNamePrefix` with More Pagination?

**Option B: Just increase pagination limit**
```typescript
// Keep using prefix, but paginate more
const maxPages = 1000; // Instead of 100
while (pageCount < maxPages) {
    FilterLogEventsCommand({ logStreamNamePrefix, nextToken })
}
```

**Problems**:
- ❌ CloudWatch still only paginates within single stream
- ❌ `nextToken = undefined` still means "end of current stream"
- ❌ Never searches additional streams regardless of pagination

### Why Two-Phase (Discover + Query)?

**Option C: Discover streams, then query each**
```typescript
// Phase 1: Enumerate streams
const streams = DescribeLogStreamsCommand({ logStreamNamePrefix })

// Phase 2: Query each stream
for (const stream of streams) {
    FilterLogEventsCommand({ logStreamNames: [stream] })
}
```

**Benefits**:
- ✅ Full control over which streams to search
- ✅ Can search streams in priority order (newest first)
- ✅ Can stop early when enough logs found
- ✅ Maintains per-container filtering
- ✅ Works across task restarts

**This is the optimal solution.**

---

**Document Status**: Ready for Implementation
**Last Updated**: 2025-11-21
**Author**: Claude (Sonnet 4.5)
**Related Issue**: Follow-up to Spec 18 (Logs Command)
**Dependencies**: Spec 18 (Logs Command)
