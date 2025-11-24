# Logs Dashboard - Technical Specification

## Executive Summary

This specification defines a comprehensive logs dashboard that provides real-time, multi-section terminal UI with persistent caching and progressive enhancement. The dashboard immediately renders a full-page skeleton layout, then dynamically populates each section as log data streams in from parallel CloudWatch fetches.

**Key Innovation**: Skeleton-first rendering with independent section updates, eliminating the current single-line spinner limitation.

---

## 1. Architecture Overview

### 1.1 Core Design Principles

1. **Skeleton-First Rendering**: Draw complete dashboard structure before data arrives
2. **Progressive Enhancement**: Show cached data → update with fresh data → maintain live state
3. **Independent Section Updates**: Each log group updates its section without affecting others
4. **Persistent XDG Caching**: Cache survives command restarts via `~/.config/benchling-webhook/{profile}/logs-cache.json`
5. **Zero Flicker**: Use blessed or ink for terminal UI that supports in-place updates

### 1.2 Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Command Layer                        │
│  (bin/commands/logs.ts - orchestration & option parsing)    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Dashboard Controller                       │
│   - Lifecycle management (init → render → update → exit)    │
│   - Coordinates UI updates with data fetches                │
│   - Manages persistent cache read/write                     │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
┌───────────────────────┐      ┌──────────────────────────┐
│   Terminal UI Layer   │      │   Data Fetcher Layer     │
│   (blessed/ink)       │      │   (CloudWatch client)    │
│                       │      │                          │
│  - Layout manager     │      │  - Parallel fetch        │
│  - Section widgets    │      │  - Stream discovery      │
│  - Progress spinners  │      │  - Event pagination      │
│  - Dynamic updates    │      │  - Error handling        │
└───────────────────────┘      └──────────────────────────┘
            │                               │
            └───────────────┬───────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Persistent Cache Layer                      │
│  (XDG-compliant filesystem storage)                          │
│   ~/.config/benchling-webhook/{profile}/logs-cache.json     │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Data Flow

```
User Command
    │
    ▼
Load Cache ────────────────┐
    │                      │
    ▼                      ▼
Render Skeleton ────> Show Cached Data (if available)
    │                      │
    ▼                      │
Start Parallel Fetches     │
    │                      │
    ├──> LogGroup 1 ───────┤
    ├──> LogGroup 2 ───────┼──> Update Section (real-time)
    ├──> LogGroup 3 ───────┤
    └──> LogGroup N ───────┘
         │
         ▼
    Save Cache
         │
         ▼
    Show Summary
```

---

## 2. UI Layout Structure

### 2.1 Full-Page Dashboard Layout

```
╭────────────────────────────────────────────────────────────────╮
│ Benchling Webhook Logs                    2025-11-22 15:30 PST│
│                                                                │
│ Profile: dev          Region: us-east-1      Since: Last 5m   │
│ Cache: 3/5 groups cached (oldest: 15:25 PST)                  │
╰────────────────────────────────────────────────────────────────╯

╭─ benchling/benchling (ECS Container) ──────────────────────────╮
│ Status: ⟳ Fetching...                      Last update: 15:29  │
│                                                                │
│ Health Checks:                                                 │
│   ✓ /health: HEALTHY (200) @ 15s ago ×42                      │
│                                                                │
│ Application Logs (Loading...):                                 │
│   ○ Discovering streams...                                     │
╰────────────────────────────────────────────────────────────────╯

╭─ api-gateway/access-logs ──────────────────────────────────────╮
│ Status: ✔ Complete (87 logs)               Last update: 15:30  │
│                                                                │
│ Health Checks:                                                 │
│   ✓ GET /health: HEALTHY (200) @ 12s ago ×156                 │
│                                                                │
│ Application Logs (87 entries, 2 patterns):                     │
│   15:29:45 → 15:30:12 [INFO] ×45                               │
│     POST /webhook - Entry created: [ENTRY_ID]                  │
│                                                                │
│   15:28:10 → 15:29:32 [WARN] ×42                               │
│     Rate limit approaching: [ID] requests in [ID]ms            │
╰────────────────────────────────────────────────────────────────╯

╭─ api-gateway/execution-logs ───────────────────────────────────╮
│ Status: ⟳ Fetching stream 3/8              Last update: 15:30  │
│                                                                │
│ Application Logs (32 logs so far):                             │
│   ◐ Loading...                                                 │
╰────────────────────────────────────────────────────────────────╯

╭─ Summary ──────────────────────────────────────────────────────╮
│ Total: 119 logs across 5 groups                                │
│ Errors: 0   Warnings: 42   Info: 77                            │
│                                                                │
│ ⟳ Auto-refresh in 8s (Ctrl+C to exit)                         │
╰────────────────────────────────────────────────────────────────╯
```

### 2.2 Section Anatomy

Each log group section contains:

```typescript
interface LogGroupSection {
    header: {
        title: string;          // e.g., "benchling/benchling (ECS Container)"
        status: StatusIndicator; // ○ pending | ◐ loading | ✔ complete | ✖ error
        lastUpdate: string;      // Timestamp of last data update
    };
    healthChecks: {
        visible: boolean;        // Show/hide health check summary
        entries: HealthCheckSummary[];
    };
    applicationLogs: {
        state: "loading" | "loaded" | "error";
        count: number;           // Total non-health logs
        patterns: GroupedLogEntry[];
        streams: LogStreamGroup[];
    };
    progressIndicator: {
        visible: boolean;
        text: string;            // "Discovering streams...", "Stream 3/8", etc.
    };
}
```

### 2.3 Dynamic Status Indicators

- **○ Pending**: Gray circle - waiting to start
- **◐ Fetching**: Cyan rotating spinner - actively fetching
- **✔ Complete**: Green checkmark - fetch complete
- **✖ Error**: Red X - fetch failed
- **⟳ Refreshing**: Gray rotating - auto-refresh countdown

---

## 3. Terminal UI Implementation

### 3.1 Recommended Library: `blessed`

**Why blessed over ora?**

| Feature | ora | blessed |
|---------|-----|---------|
| Multi-section layout | ❌ | ✅ |
| Independent updates | ❌ | ✅ |
| Complex layouts | ❌ | ✅ |
| In-place editing | Limited | Full |
| Event handling | ❌ | ✅ |
| Scrolling | ❌ | ✅ |

**Alternative: `ink`** (React-style components for terminal)
- Pros: Declarative, component-based, TypeScript-friendly
- Cons: Heavier dependency, more opinionated
- Use if: Team prefers React-style mental model

### 3.2 blessed Architecture

```typescript
import blessed from "blessed";

class LogsDashboard {
    private screen: blessed.Widgets.Screen;
    private sections: Map<string, LogGroupWidget>;
    private header: blessed.Widgets.BoxElement;
    private summary: blessed.Widgets.BoxElement;

    constructor() {
        this.screen = blessed.screen({
            smartCSR: true,      // Optimize cursor movement
            title: "Benchling Logs",
            fullUnicode: true,   // Support spinners
        });

        this.initializeLayout();
        this.setupEventHandlers();
    }

    private initializeLayout(): void {
        // Draw skeleton immediately
        this.header = this.createHeader();
        this.sections = new Map();
        this.summary = this.createSummary();

        this.screen.render(); // Initial render shows structure
    }

    public updateSection(
        logGroupName: string,
        update: Partial<LogGroupSection>
    ): void {
        const widget = this.sections.get(logGroupName);
        if (!widget) return;

        widget.update(update);
        this.screen.render(); // Re-render only changed section
    }
}
```

### 3.3 Widget Structure

```typescript
class LogGroupWidget {
    private box: blessed.Widgets.BoxElement;
    private statusText: blessed.Widgets.TextElement;
    private healthBox: blessed.Widgets.BoxElement;
    private logsBox: blessed.Widgets.BoxElement;
    private progressSpinner: blessed.Widgets.LoadingElement;

    constructor(
        parent: blessed.Widgets.Screen,
        options: LogGroupWidgetOptions
    ) {
        this.box = blessed.box({
            parent,
            top: options.top,
            left: 0,
            width: "100%",
            height: options.height,
            border: {
                type: "line",
                fg: "cyan",
            },
            label: ` ${options.displayName} `,
            tags: true, // Enable color tags: {cyan-fg}text{/}
        });

        this.createSubWidgets();
    }

    public update(data: Partial<LogGroupSection>): void {
        // Update individual widgets without full re-render
        if (data.header?.status) {
            this.updateStatus(data.header.status);
        }
        if (data.applicationLogs) {
            this.updateLogs(data.applicationLogs);
        }
        // ... etc
    }

    private updateStatus(status: StatusIndicator): void {
        const icon = this.getStatusIcon(status);
        const color = this.getStatusColor(status);
        this.statusText.setContent(`{${color}-fg}${icon}{/} ${status}`);
    }

    private getStatusIcon(status: StatusIndicator): string {
        const icons = {
            pending: "○",
            fetching: "◐",
            complete: "✔",
            error: "✖",
        };
        return icons[status] || "○";
    }
}
```

### 3.4 Dynamic Height Management

```typescript
interface LayoutManager {
    calculateSectionHeights(
        logGroups: ConfigLogGroupInfo[]
    ): Map<string, number>;

    expandSection(logGroupName: string): void;
    collapseSection(logGroupName: string): void;

    // Auto-calculate based on content
    autoResizeSection(
        logGroupName: string,
        content: LogGroupSection
    ): void;
}

class DynamicLayoutManager implements LayoutManager {
    private minHeight = 8;    // Minimum lines per section
    private maxHeight = 30;   // Maximum before scrolling

    calculateSectionHeights(
        logGroups: ConfigLogGroupInfo[]
    ): Map<string, number> {
        const screenHeight = process.stdout.rows;
        const headerHeight = 6;
        const summaryHeight = 5;
        const availableHeight = screenHeight - headerHeight - summaryHeight;

        // Distribute available height proportionally
        const baseHeight = Math.floor(
            availableHeight / logGroups.length
        );

        return new Map(
            logGroups.map((lg) => [lg.name, Math.max(baseHeight, this.minHeight)])
        );
    }
}
```

---

## 4. Persistent Caching Strategy

### 4.1 Cache File Structure

**Location**: `~/.config/benchling-webhook/{profile}/logs-cache.json`

```typescript
interface PersistentLogsCache {
    version: string;           // Cache schema version: "1.0"
    lastUpdated: string;       // ISO timestamp
    profile: string;           // Profile name for validation
    groups: Record<string, CachedLogGroup>;
}

interface CachedLogGroup {
    name: string;
    displayName: string;

    // Timestamp tracking
    lastSeenTimestamp: number;      // Newest log timestamp
    lastFetchTime: number;          // When cache was written
    oldestRetrieved: number;        // Oldest log timestamp in cache

    // Cached data (limited to prevent huge files)
    recentLogs: FilteredLogEvent[]; // Last 100 logs (most recent)
    healthSummary: HealthCheckSummary[];

    // Statistics
    totalLogsCount: number;
    errorCount: number;
    warningCount: number;
    streamCount: number;
}
```

### 4.2 Cache Operations

```typescript
class LogsCacheManager {
    private profile: string;
    private cachePath: string;
    private cache: PersistentLogsCache | null = null;

    constructor(profile: string) {
        this.profile = profile;
        this.cachePath = this.getCachePath(profile);
    }

    /**
     * Load cache from disk (called on dashboard init)
     */
    public load(): PersistentLogsCache | null {
        if (!existsSync(this.cachePath)) {
            return null;
        }

        try {
            const data = readFileSync(this.cachePath, "utf-8");
            const cache = JSON.parse(data) as PersistentLogsCache;

            // Validate cache version and profile
            if (cache.version !== "1.0" || cache.profile !== this.profile) {
                console.warn("Cache version mismatch, invalidating...");
                return null;
            }

            this.cache = cache;
            return cache;
        } catch (error) {
            console.warn(`Failed to load cache: ${error.message}`);
            return null;
        }
    }

    /**
     * Save cache to disk (called periodically and on exit)
     */
    public save(cache: PersistentLogsCache): void {
        const cacheDir = dirname(this.cachePath);

        if (!existsSync(cacheDir)) {
            mkdirSync(cacheDir, { recursive: true });
        }

        try {
            // Atomic write: temp file + rename
            const tempPath = `${this.cachePath}.tmp`;
            writeFileSync(
                tempPath,
                JSON.stringify(cache, null, 2),
                "utf-8"
            );
            renameSync(tempPath, this.cachePath);
        } catch (error) {
            console.warn(`Failed to save cache: ${error.message}`);
        }
    }

    /**
     * Update cache with fresh data from a log group
     */
    public updateGroup(
        logGroupName: string,
        logs: FilteredLogEvent[],
        healthSummary: HealthCheckSummary[]
    ): void {
        if (!this.cache) {
            this.cache = this.createEmptyCache();
        }

        // Keep only most recent 100 logs to limit cache size
        const recentLogs = logs
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, 100);

        const timestamps = logs.map(e => e.timestamp || 0).filter(t => t > 0);
        const newestTimestamp = Math.max(...timestamps, 0);
        const oldestTimestamp = Math.min(...timestamps, Date.now());

        const existing = this.cache.groups[logGroupName];

        this.cache.groups[logGroupName] = {
            name: logGroupName,
            displayName: existing?.displayName || logGroupName,
            lastSeenTimestamp: newestTimestamp,
            lastFetchTime: Date.now(),
            oldestRetrieved: existing
                ? Math.min(existing.oldestRetrieved, oldestTimestamp)
                : oldestTimestamp,
            recentLogs,
            healthSummary,
            totalLogsCount: logs.length,
            errorCount: this.countByLevel(logs, "ERROR"),
            warningCount: this.countByLevel(logs, "WARN"),
            streamCount: new Set(logs.map(e => e.logStreamName)).size,
        };

        this.cache.lastUpdated = new Date().toISOString();
    }

    private createEmptyCache(): PersistentLogsCache {
        return {
            version: "1.0",
            lastUpdated: new Date().toISOString(),
            profile: this.profile,
            groups: {},
        };
    }

    private countByLevel(logs: FilteredLogEvent[], level: string): number {
        return logs.filter(e => e.message?.includes(level)).length;
    }

    private getCachePath(profile: string): string {
        return join(
            homedir(),
            ".config",
            "benchling-webhook",
            profile,
            "logs-cache.json"
        );
    }
}
```

### 4.3 Cache Invalidation Strategy

```typescript
interface CacheInvalidationStrategy {
    /**
     * When to invalidate cache entries
     */
    shouldInvalidate(cached: CachedLogGroup): boolean;
}

class TimeBasedInvalidation implements CacheInvalidationStrategy {
    private maxAge: number; // milliseconds

    constructor(maxAgeMinutes = 60) {
        this.maxAge = maxAgeMinutes * 60 * 1000;
    }

    shouldInvalidate(cached: CachedLogGroup): boolean {
        const age = Date.now() - cached.lastFetchTime;
        return age > this.maxAge;
    }
}

class SizeBasedInvalidation implements CacheInvalidationStrategy {
    private maxSizeMB: number;

    constructor(maxSizeMB = 10) {
        this.maxSizeMB = maxSizeMB;
    }

    shouldInvalidate(cached: CachedLogGroup): boolean {
        // Estimate size (each log ~500 bytes)
        const estimatedSize = cached.recentLogs.length * 500;
        return estimatedSize > this.maxSizeMB * 1024 * 1024;
    }
}
```

### 4.4 Cache-First Data Flow

```typescript
class LogsDashboardController {
    private cacheManager: LogsCacheManager;
    private dashboard: LogsDashboard;

    async initialize(): Promise<void> {
        // Phase 1: Load cache immediately
        const cache = this.cacheManager.load();

        // Phase 2: Render skeleton with cached data
        if (cache) {
            for (const [name, group] of Object.entries(cache.groups)) {
                this.dashboard.updateSection(name, {
                    header: {
                        title: group.displayName,
                        status: "pending",
                        lastUpdate: formatLocalTime(group.lastFetchTime),
                    },
                    healthChecks: {
                        visible: true,
                        entries: group.healthSummary,
                    },
                    applicationLogs: {
                        state: "loaded",
                        count: group.totalLogsCount,
                        patterns: this.groupCachedLogs(group.recentLogs),
                        streams: [],
                    },
                });
            }
        }

        // Phase 3: Start fresh fetches (updates happen in real-time)
        await this.fetchAllLogsInParallel();
    }

    private async fetchAllLogsInParallel(): Promise<void> {
        const promises = this.logGroups.map(async (logGroup) => {
            // Update status: fetching
            this.dashboard.updateSection(logGroup.name, {
                header: { status: "fetching" },
            });

            try {
                const logs = await this.fetchLogsFromGroup(logGroup);

                // Update with fresh data
                this.dashboard.updateSection(logGroup.name, {
                    header: {
                        status: "complete",
                        lastUpdate: formatLocalTime(Date.now()),
                    },
                    applicationLogs: {
                        state: "loaded",
                        count: logs.length,
                        patterns: groupLogEntries(logs),
                        streams: groupLogEntriesByStream(logs),
                    },
                });

                // Update cache
                this.cacheManager.updateGroup(
                    logGroup.name,
                    logs,
                    extractHealthCheckSummary(logs)
                );
            } catch (error) {
                this.dashboard.updateSection(logGroup.name, {
                    header: {
                        status: "error",
                        lastUpdate: formatLocalTime(Date.now()),
                    },
                });
            }
        });

        await Promise.all(promises);

        // Save cache after all fetches complete
        this.cacheManager.save(this.buildCacheSnapshot());
    }
}
```

---

## 5. Progressive Enhancement Approach

### 5.1 Three-Phase Rendering

```typescript
enum RenderPhase {
    SKELETON = "skeleton",     // Empty layout structure
    CACHED = "cached",         // Show cached data (if available)
    LIVE = "live",             // Fresh data from CloudWatch
}

class ProgressiveRenderer {
    /**
     * Phase 1: Skeleton
     * - Draw all section boxes immediately
     * - Show "Loading..." placeholders
     * - No data yet
     */
    renderSkeleton(logGroups: ConfigLogGroupInfo[]): void {
        for (const lg of logGroups) {
            this.dashboard.createSection(lg.name, {
                header: {
                    title: lg.displayName,
                    status: "pending",
                    lastUpdate: "—",
                },
                healthChecks: { visible: false, entries: [] },
                applicationLogs: {
                    state: "loading",
                    count: 0,
                    patterns: [],
                    streams: [],
                },
                progressIndicator: {
                    visible: true,
                    text: "Waiting to start...",
                },
            });
        }
    }

    /**
     * Phase 2: Cached
     * - Populate sections with cached data
     * - Show last update timestamp
     * - Indicate data is stale
     */
    renderCached(cache: PersistentLogsCache): void {
        for (const [name, group] of Object.entries(cache.groups)) {
            const staleness = this.calculateStaleness(group.lastFetchTime);

            this.dashboard.updateSection(name, {
                header: {
                    status: "pending",
                    lastUpdate: `${formatLocalTime(group.lastFetchTime)} (cached, ${staleness})`,
                },
                healthChecks: {
                    visible: true,
                    entries: group.healthSummary,
                },
                applicationLogs: {
                    state: "loaded",
                    count: group.totalLogsCount,
                    patterns: this.groupCachedLogs(group.recentLogs),
                    streams: [],
                },
                progressIndicator: {
                    visible: true,
                    text: "Refreshing...",
                },
            });
        }
    }

    /**
     * Phase 3: Live
     * - Replace cached data with fresh data
     * - Update timestamps
     * - Hide progress indicators
     */
    renderLive(
        logGroupName: string,
        freshData: LogGroupSection
    ): void {
        this.dashboard.updateSection(logGroupName, {
            ...freshData,
            progressIndicator: { visible: false, text: "" },
        });
    }

    private calculateStaleness(lastFetchTime: number): string {
        const age = Date.now() - lastFetchTime;
        const minutes = Math.floor(age / 60000);
        if (minutes < 1) return "just now";
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        return `${hours}h ago`;
    }
}
```

### 5.2 Smooth Transitions

```typescript
class TransitionManager {
    /**
     * Fade transition when replacing cached with fresh data
     */
    transitionCachedToLive(
        logGroupName: string,
        cachedData: LogGroupSection,
        freshData: LogGroupSection
    ): void {
        // Brief visual indicator that data was refreshed
        this.dashboard.flashSection(logGroupName, {
            borderColor: "green",
            duration: 200, // ms
        });

        // Update content
        this.dashboard.updateSection(logGroupName, freshData);
    }

    /**
     * Spinner animation while fetching
     */
    animateFetchProgress(logGroupName: string): AnimationHandle {
        const frames = ["◐", "◓", "◑", "◒"];
        let frameIndex = 0;

        const interval = setInterval(() => {
            this.dashboard.updateSectionStatus(logGroupName, {
                icon: frames[frameIndex],
            });
            frameIndex = (frameIndex + 1) % frames.length;
        }, 100);

        return {
            stop: () => clearInterval(interval),
        };
    }
}

interface AnimationHandle {
    stop: () => void;
}
```

---

## 6. Priority Ordering Logic

### 6.1 Log Group Priority System

```typescript
interface LogGroupPriority {
    group: ConfigLogGroupInfo;
    priority: number;  // Higher = more important
    sortKey: string;
}

class PriorityOrderingStrategy {
    /**
     * Calculate priority for log group
     * Priority rules (highest to lowest):
     * 1. benchling/benchling (main application) = 1000
     * 2. ECS container logs = 900
     * 3. API Gateway execution logs = 800
     * 4. API Gateway access logs = 700
     * 5. Alphabetical = 0-699
     */
    calculatePriority(logGroup: ConfigLogGroupInfo): number {
        // Rule 1: Main benchling application
        if (
            logGroup.name.includes("/benchling") &&
            logGroup.name.includes("benchling/benchling")
        ) {
            return 1000;
        }

        // Rule 2: ECS container logs
        if (logGroup.type === "ecs") {
            return 900;
        }

        // Rule 3: API Gateway execution logs
        if (logGroup.type === "api-exec") {
            return 800;
        }

        // Rule 4: API Gateway access logs
        if (logGroup.type === "api") {
            return 700;
        }

        // Rule 5: Alphabetical (convert to numeric)
        return this.alphabeticalPriority(logGroup.displayName);
    }

    private alphabeticalPriority(name: string): number {
        // Map first 3 chars to number (0-699 range)
        const chars = name.toLowerCase().substring(0, 3);
        let priority = 0;
        for (let i = 0; i < chars.length; i++) {
            const code = chars.charCodeAt(i) - 97; // a=0, z=25
            priority += code * Math.pow(26, 2 - i);
        }
        return Math.min(priority, 699);
    }

    /**
     * Sort log groups by priority
     */
    sort(logGroups: ConfigLogGroupInfo[]): ConfigLogGroupInfo[] {
        return logGroups
            .map((group) => ({
                group,
                priority: this.calculatePriority(group),
                sortKey: `${String(this.calculatePriority(group)).padStart(4, "0")}-${group.displayName}`,
            }))
            .sort((a, b) => b.priority - a.priority)
            .map((item) => item.group);
    }
}
```

### 6.2 Visual Priority Indicators

```typescript
class VisualPriorityIndicators {
    /**
     * Apply visual styling based on priority
     */
    applyStyling(
        widget: LogGroupWidget,
        logGroup: ConfigLogGroupInfo,
        priority: number
    ): void {
        if (priority >= 1000) {
            // Highest priority: bright border + bold label
            widget.setBorderColor("cyan");
            widget.setLabelStyle({ bold: true, fg: "cyan" });
        } else if (priority >= 900) {
            // High priority: normal border
            widget.setBorderColor("blue");
            widget.setLabelStyle({ bold: false, fg: "blue" });
        } else {
            // Normal priority: dim border
            widget.setBorderColor("gray");
            widget.setLabelStyle({ bold: false, fg: "gray" });
        }
    }

    /**
     * Show priority badge in section header
     */
    renderPriorityBadge(priority: number): string {
        if (priority >= 1000) return "⭐";  // Star for main app
        if (priority >= 900) return "🔹";   // Diamond for ECS
        return "";  // No badge for lower priority
    }
}
```

---

## 7. Implementation Notes

### 7.1 Dependencies to Add

```json
{
  "dependencies": {
    "blessed": "^0.1.81",
    "blessed-contrib": "^4.11.0"  // Optional: charts, gauges
  },
  "devDependencies": {
    "@types/blessed": "^0.1.25"
  }
}
```

**Alternative**: Replace `blessed` with `ink` if React-style preferred:

```json
{
  "dependencies": {
    "ink": "^5.0.0",
    "react": "^18.0.0"
  }
}
```

### 7.2 File Structure

```
bin/commands/
├── logs.ts                      # Main command entry (existing)
├── logs/
│   ├── dashboard-controller.ts  # Orchestrates dashboard lifecycle
│   ├── cache-manager.ts         # Persistent cache operations
│   ├── terminal-ui.ts           # blessed/ink UI layer
│   ├── log-fetcher.ts           # CloudWatch fetch logic (extract from logs.ts)
│   ├── priority-ordering.ts     # Log group priority system
│   └── types.ts                 # Shared types
```

### 7.3 Backward Compatibility

```typescript
/**
 * Entry point maintains backward compatibility
 * with existing CLI options
 */
export async function logsCommand(
    options: LogsCommandOptions = {}
): Promise<LogsResult> {
    // Detect if terminal supports advanced UI
    const supportsAdvancedUI = process.stdout.isTTY && !process.env.CI;

    if (supportsAdvancedUI) {
        // Use new dashboard
        return new LogsDashboardController(options).run();
    } else {
        // Fall back to simple text output (existing implementation)
        return logsCommandLegacy(options);
    }
}
```

### 7.4 Testing Strategy

```typescript
describe("LogsDashboard", () => {
    describe("Rendering", () => {
        it("should render skeleton immediately", () => {
            const dashboard = new LogsDashboard(mockConfig);
            dashboard.initialize();

            expect(dashboard.getSections().size).toBe(3);
            expect(dashboard.getSections().get("benchling/benchling").status)
                .toBe("pending");
        });

        it("should populate with cached data", () => {
            const cache = loadMockCache();
            const dashboard = new LogsDashboard(mockConfig);

            dashboard.renderCached(cache);

            expect(dashboard.getSections().get("benchling/benchling").logs.length)
                .toBe(cache.groups["benchling/benchling"].recentLogs.length);
        });

        it("should update section independently", () => {
            const dashboard = new LogsDashboard(mockConfig);
            const initialRender = dashboard.getScreenContent();

            dashboard.updateSection("benchling/benchling", {
                header: { status: "complete" },
            });

            const updatedRender = dashboard.getScreenContent();

            // Only benchling section changed
            expect(updatedRender).not.toBe(initialRender);
            expect(dashboard.getSections().get("api-gateway/access").status)
                .toBe("pending"); // Other sections unchanged
        });
    });

    describe("Cache", () => {
        it("should save cache after fetch", async () => {
            const cacheManager = new LogsCacheManager("dev");
            const controller = new LogsDashboardController(mockConfig, cacheManager);

            await controller.fetchAllLogs();

            expect(existsSync(cacheManager.cachePath)).toBe(true);
            const savedCache = cacheManager.load();
            expect(Object.keys(savedCache.groups).length).toBe(3);
        });

        it("should load cache on startup", () => {
            writeMockCache("dev");

            const cacheManager = new LogsCacheManager("dev");
            const cache = cacheManager.load();

            expect(cache).not.toBeNull();
            expect(cache.profile).toBe("dev");
            expect(cache.version).toBe("1.0");
        });
    });

    describe("Priority Ordering", () => {
        it("should prioritize benchling/benchling first", () => {
            const logGroups = [
                { name: "api-gateway/access", displayName: "API Access", type: "api" },
                { name: "tf-dev-bench-benchling/benchling", displayName: "Benchling", type: "ecs" },
                { name: "api-gateway/execution", displayName: "API Exec", type: "api-exec" },
            ];

            const ordered = new PriorityOrderingStrategy().sort(logGroups);

            expect(ordered[0].name).toBe("tf-dev-bench-benchling/benchling");
        });
    });
});
```

### 7.5 Performance Considerations

```typescript
class PerformanceOptimizations {
    /**
     * Debounce rapid UI updates to prevent flicker
     */
    private debounceRender = debounce(() => {
        this.screen.render();
    }, 50);

    /**
     * Batch multiple section updates into single render
     */
    batchUpdate(updates: Array<[string, Partial<LogGroupSection>]>): void {
        for (const [name, update] of updates) {
            this.updateSectionInternal(name, update);
        }
        this.debounceRender();
    }

    /**
     * Virtual scrolling for large log lists
     */
    renderVisibleLogsOnly(
        logs: FilteredLogEvent[],
        scrollPosition: number,
        viewportHeight: number
    ): FilteredLogEvent[] {
        const startIndex = scrollPosition;
        const endIndex = startIndex + viewportHeight;
        return logs.slice(startIndex, endIndex);
    }

    /**
     * Memory management: limit cached logs
     */
    limitCacheSize(cache: PersistentLogsCache, maxSizeMB = 10): void {
        const maxEvents = Math.floor((maxSizeMB * 1024 * 1024) / 500);

        for (const group of Object.values(cache.groups)) {
            if (group.recentLogs.length > maxEvents) {
                group.recentLogs = group.recentLogs.slice(0, maxEvents);
            }
        }
    }
}

function debounce<T extends (...args: unknown[]) => void>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}
```

---

## 8. Error Handling & Edge Cases

### 8.1 Error States

```typescript
interface ErrorHandlingStrategy {
    handleFetchError(
        logGroupName: string,
        error: Error
    ): void;

    handleCacheCorruption(
        profile: string,
        error: Error
    ): void;

    handleRenderError(
        component: string,
        error: Error
    ): void;
}

class GracefulErrorHandler implements ErrorHandlingStrategy {
    handleFetchError(logGroupName: string, error: Error): void {
        // Show error in section, don't crash entire dashboard
        this.dashboard.updateSection(logGroupName, {
            header: {
                status: "error",
                lastUpdate: formatLocalTime(Date.now()),
            },
            applicationLogs: {
                state: "error",
                count: 0,
                patterns: [],
                streams: [],
            },
            progressIndicator: {
                visible: true,
                text: `Error: ${error.message}`,
            },
        });

        // Log full error to debug file
        this.logError("fetch", logGroupName, error);
    }

    handleCacheCorruption(profile: string, error: Error): void {
        // Warn user but continue without cache
        console.warn(
            chalk.yellow(
                `⚠️  Cache corrupted for profile '${profile}', starting fresh...`
            )
        );

        // Delete corrupted cache
        const cachePath = getCachePath(profile);
        if (existsSync(cachePath)) {
            unlinkSync(cachePath);
        }
    }

    handleRenderError(component: string, error: Error): void {
        // Fall back to simple text mode
        console.error(
            chalk.red(
                `❌ UI rendering failed (${component}): ${error.message}`
            )
        );
        console.log(chalk.dim("Falling back to simple text output...\n"));

        // Use legacy text-based output
        process.env.LOGS_FALLBACK_MODE = "true";
    }
}
```

### 8.2 Edge Cases

```typescript
class EdgeCaseHandling {
    /**
     * No log groups configured
     */
    handleNoLogGroups(): void {
        this.dashboard.showEmptyState({
            title: "No Log Groups",
            message: "Stack hasn't been deployed yet.",
            action: "Run: npm run deploy -- --profile dev --stage dev",
        });
    }

    /**
     * All log groups are empty
     */
    handleAllEmpty(logGroups: LogGroupInfo[]): void {
        this.dashboard.showEmptyState({
            title: "No Logs Found",
            message: "No log entries in requested time range.",
            suggestions: [
                "Try expanding time range: --since 1h",
                "Check if service is running",
                "Verify webhook events are being sent",
            ],
        });
    }

    /**
     * Terminal too small
     */
    handleSmallTerminal(): void {
        const minWidth = 80;
        const minHeight = 24;

        if (
            process.stdout.columns < minWidth ||
            process.stdout.rows < minHeight
        ) {
            console.warn(
                chalk.yellow(
                    `⚠️  Terminal too small (${process.stdout.columns}x${process.stdout.rows}).`
                )
            );
            console.log(
                chalk.dim(
                    `   Recommended: ${minWidth}x${minHeight} or larger.`
                )
            );
            console.log(chalk.dim("   Some content may be truncated.\n"));
        }
    }

    /**
     * Network timeout
     */
    async handleNetworkTimeout(
        logGroupName: string,
        retryCount: number
    ): Promise<void> {
        this.dashboard.updateSection(logGroupName, {
            progressIndicator: {
                visible: true,
                text: `Network timeout, retrying (${retryCount}/3)...`,
            },
        });

        await sleep(1000 * retryCount); // Exponential backoff
    }
}
```

---

## 9. Future Enhancements

### 9.1 Interactive Features

```typescript
/**
 * Keyboard shortcuts for interactive dashboard
 */
class InteractiveFeatures {
    setupKeyboardHandlers(): void {
        this.screen.key("up", () => this.scrollUp());
        this.screen.key("down", () => this.scrollDown());
        this.screen.key("e", () => this.expandSection());
        this.screen.key("c", () => this.collapseSection());
        this.screen.key("r", () => this.refreshAll());
        this.screen.key("f", () => this.toggleFilterMode());
        this.screen.key("h", () => this.toggleHealthChecks());
        this.screen.key("q", () => this.exit());
        this.screen.key(["escape", "C-c"], () => this.exit());
    }

    /**
     * Mouse support for clicking sections
     */
    setupMouseHandlers(): void {
        this.screen.enableMouse();

        for (const [name, widget] of this.sections.entries()) {
            widget.on("click", () => {
                this.expandSection(name);
            });
        }
    }
}
```

### 9.2 Advanced Visualizations

```typescript
/**
 * Use blessed-contrib for charts
 */
import contrib from "blessed-contrib";

class AdvancedVisualizations {
    /**
     * Log rate over time (sparkline)
     */
    renderLogRateChart(logs: FilteredLogEvent[]): void {
        const line = contrib.line({
            style: { line: "yellow", text: "green", baseline: "black" },
            label: "Logs/min",
        });

        const data = this.aggregateLogsByMinute(logs);
        line.setData([
            { title: "Rate", x: data.times, y: data.counts, style: { line: "cyan" } },
        ]);
    }

    /**
     * Log level distribution (donut chart)
     */
    renderLogLevelDonut(logs: FilteredLogEvent[]): void {
        const donut = contrib.donut({
            label: "Log Levels",
            radius: 8,
            arcWidth: 3,
        });

        const levels = this.countByLevel(logs);
        donut.setData([
            { percent: levels.error, label: "Error", color: "red" },
            { percent: levels.warn, label: "Warn", color: "yellow" },
            { percent: levels.info, label: "Info", color: "cyan" },
        ]);
    }
}
```

### 9.3 Export & Sharing

```typescript
class ExportFeatures {
    /**
     * Export current view to HTML
     */
    exportToHTML(logGroups: LogGroupInfo[], outputPath: string): void {
        const html = this.generateHTML(logGroups);
        writeFileSync(outputPath, html, "utf-8");
        console.log(chalk.green(`✔ Exported to ${outputPath}`));
    }

    /**
     * Export to JSON for programmatic access
     */
    exportToJSON(logGroups: LogGroupInfo[], outputPath: string): void {
        const json = JSON.stringify(logGroups, null, 2);
        writeFileSync(outputPath, json, "utf-8");
        console.log(chalk.green(`✔ Exported to ${outputPath}`));
    }

    /**
     * Share via temporary URL (upload to S3)
     */
    async shareViaURL(logGroups: LogGroupInfo[]): Promise<string> {
        const html = this.generateHTML(logGroups);
        const key = `logs/${Date.now()}.html`;
        await this.uploadToS3(html, key);
        return `https://logs.benchling-webhook.com/${key}`;
    }
}
```

---

## 10. Migration Plan

### 10.1 Phase 1: blessed Integration (Week 1)

- [ ] Add blessed dependency
- [ ] Create basic dashboard layout
- [ ] Implement skeleton rendering
- [ ] Test on existing log data

### 10.2 Phase 2: Cache Integration (Week 1)

- [ ] Implement persistent cache manager
- [ ] Add cache load/save operations
- [ ] Test cache invalidation
- [ ] Verify XDG compliance

### 10.3 Phase 3: Progressive Enhancement (Week 2)

- [ ] Implement three-phase rendering
- [ ] Add smooth transitions
- [ ] Test with real CloudWatch data
- [ ] Performance profiling

### 10.4 Phase 4: Priority Ordering (Week 2)

- [ ] Implement priority calculation
- [ ] Add visual priority indicators
- [ ] Test with various log group configs
- [ ] Document priority rules

### 10.5 Phase 5: Polish & Testing (Week 3)

- [ ] Error handling
- [ ] Edge case testing
- [ ] Documentation
- [ ] User feedback collection

---

## 11. Success Metrics

### 11.1 Performance Metrics

- **Skeleton Render Time**: < 100ms
- **Cache Load Time**: < 200ms
- **First Paint Time**: < 300ms (skeleton + cache)
- **Live Data Time**: < 5s (parallel fetches)
- **Memory Usage**: < 100MB (with cache)

### 11.2 User Experience Metrics

- **Perceived Load Time**: "Instant" (skeleton renders immediately)
- **Data Freshness**: Real-time updates as fetches complete
- **Cache Hit Rate**: > 80% for repeat views
- **Error Recovery**: Graceful degradation, no crashes

### 11.3 Code Quality Metrics

- **Test Coverage**: > 85%
- **Type Safety**: 100% TypeScript strict mode
- **Documentation**: All public APIs documented
- **Maintainability**: Clear separation of concerns

---

## Appendix A: blessed Quick Reference

```typescript
// Create screen
const screen = blessed.screen({
    smartCSR: true,
    title: "My App",
});

// Create box
const box = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "50%",
    height: "50%",
    border: { type: "line" },
    label: " Title ",
    tags: true, // Enable color tags
});

// Update content
box.setContent("{cyan-fg}Hello{/} {bold}World{/}");

// Render
screen.render();

// Event handling
screen.key(["escape", "q", "C-c"], () => process.exit(0));

// Scrollable box
const list = blessed.list({
    parent: screen,
    scrollable: true,
    mouse: true,
    keys: true,
    vi: true, // vi-style navigation
});
```

## Appendix B: Alternative - ink Reference

```typescript
import React from "react";
import { render, Box, Text } from "ink";

const Dashboard = () => (
    <Box flexDirection="column">
        <Box borderStyle="round" borderColor="cyan">
            <Text color="cyan" bold>Benchling Logs</Text>
        </Box>
        <LogSection name="benchling/benchling" />
        <LogSection name="api-gateway/access" />
    </Box>
);

const LogSection = ({ name }) => (
    <Box flexDirection="column" borderStyle="single">
        <Text>{name}</Text>
        <Text dimColor>Loading...</Text>
    </Box>
);

render(<Dashboard />);
```

---

**End of Specification**

**Document Version**: 1.0
**Last Updated**: 2025-11-22
**Author**: JavaScript Pro Agent
**Status**: Ready for Implementation
