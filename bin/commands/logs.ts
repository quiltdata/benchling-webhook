#!/usr/bin/env node
/**
 * Logs Command
 *
 * View CloudWatch logs for deployed Benchling webhook integration.
 * Supports ECS container logs, API Gateway access logs, and execution logs.
 *
 * @module commands/logs
 */

import chalk from "chalk";
import ora, { type Ora } from "ora";
import {
    CloudWatchLogsClient,
    FilterLogEventsCommand,
    DescribeLogStreamsCommand,
    type FilteredLogEvent,
    type LogStream,
} from "@aws-sdk/client-cloudwatch-logs";
import { fromIni } from "@aws-sdk/credential-providers";
import { XDGConfig } from "../../lib/xdg-config";
import type { XDGBase } from "../../lib/xdg-base";
import type { LogGroupInfo as ConfigLogGroupInfo } from "../../lib/types/config";
import { parseTimeRange, formatLocalDateTime, formatLocalTime, getLocalTimezone } from "../../lib/utils/time-format";
import { sleep, clearScreen, parseTimerValue } from "../../lib/utils/cli-helpers";

/**
 * Configuration constants for log fetching
 */
const LOGS_CONFIG = {
    MAX_PAGES_PER_STREAM: 10,      // Max pagination rounds per stream
    CLOUDWATCH_MAX_EVENTS: 1000,   // CloudWatch API limit per request
    MAX_STREAMS_TO_DISCOVER: 100,  // Safety limit for stream discovery
    MAX_TOTAL_EVENTS: 50000,       // Memory safety limit
    EARLY_STOP_TIME_BUFFER: 60000, // 1 minute buffer for time range coverage
} as const;

/**
 * Cache for tracking last seen timestamps per log group
 */
interface LogGroupCache {
    lastSeenTimestamp: number;
    lastFetchTime: number;
    oldestRetrieved: number;
}

/**
 * Global cache map (session-scoped)
 */
const LOG_CACHE = new Map<string, LogGroupCache>();

export interface LogsCommandOptions {
    profile?: string;
    stage?: string;
    awsProfile?: string;
    type?: string;
    since?: string;
    filter?: string;
    follow?: boolean;
    tail?: number;
    configStorage?: XDGBase;
    timer?: string | number;
    limit?: number;
}

export interface LogsResult {
    success: boolean;
    error?: string;
    logGroups?: LogGroupInfo[];
}

export interface LogGroupInfo {
    name: string;
    displayName: string;
    entries: FilteredLogEvent[];
}

export interface GroupedLogEntry {
    pattern: string;
    count: number;
    firstSeen: number;
    lastSeen: number;
    entries: FilteredLogEvent[];
    sample?: string;
}

export interface LogStreamGroup {
    streamName: string;
    displayName: string;
    entries: FilteredLogEvent[];
    patterns: GroupedLogEntry[];
}

export interface HealthCheckSummary {
    endpoint: string;
    status: "success" | "failure" | "unknown";
    lastSeen: number;
    count: number;
    statusCode?: number;
}

/**
 * Get cache key for a log group
 */
function getCacheKey(logGroupName: string, streamPrefix?: string): string {
    return streamPrefix ? `${logGroupName}:${streamPrefix}` : logGroupName;
}

/**
 * Get start time considering cache
 */
function getStartTime(
    logGroupName: string,
    since: string,
    streamPrefix?: string,
    useCache = true,
): number {
    if (!useCache) {
        return Date.now() - parseTimeRange(since);
    }

    const cacheKey = getCacheKey(logGroupName, streamPrefix);
    const cached = LOG_CACHE.get(cacheKey);

    if (cached) {
        // For incremental fetch: start from last seen timestamp
        return cached.lastSeenTimestamp;
    }

    // Initial fetch: use full time range
    return Date.now() - parseTimeRange(since);
}

/**
 * Update cache after fetching logs
 */
function updateCache(
    logGroupName: string,
    events: FilteredLogEvent[],
    streamPrefix?: string,
): void {
    if (events.length === 0) return;

    const cacheKey = getCacheKey(logGroupName, streamPrefix);
    const timestamps = events.map(e => e.timestamp || 0).filter(t => t > 0);

    if (timestamps.length === 0) return;

    const newestTimestamp = Math.max(...timestamps);
    const oldestTimestamp = Math.min(...timestamps);

    const existing = LOG_CACHE.get(cacheKey);

    LOG_CACHE.set(cacheKey, {
        lastSeenTimestamp: newestTimestamp,
        lastFetchTime: Date.now(),
        oldestRetrieved: existing ? Math.min(existing.oldestRetrieved, oldestTimestamp) : oldestTimestamp,
    });
}

/**
 * Get cache statistics for display
 */
function getCacheStats(
    logGroupName: string,
    streamPrefix?: string,
): { isCached: boolean; lastFetchTime?: number; oldestRetrieved?: number } {
    const cacheKey = getCacheKey(logGroupName, streamPrefix);
    const cached = LOG_CACHE.get(cacheKey);

    if (!cached) {
        return { isCached: false };
    }

    return {
        isCached: true,
        lastFetchTime: cached.lastFetchTime,
        oldestRetrieved: cached.oldestRetrieved,
    };
}

/**
 * Get log groups from profile configuration
 */
function getLogGroupsFromConfig(
    profile: string,
    configStorage: XDGBase,
): { region: string; logGroups: ConfigLogGroupInfo[] } | null {
    try {
        const config = configStorage.readProfile(profile);
        if (!config.deployment?.region) {
            return null;
        }

        const region = config.deployment.region;
        const logGroups = config.deployment.logGroups || [];

        if (logGroups.length === 0) {
            console.warn(chalk.yellow(`⚠️  No log groups found in profile '${profile}' configuration.`));
            console.warn(chalk.dim("   This means the stack hasn't been deployed yet."));
            console.warn(chalk.dim(`   Run: npm run deploy -- --profile ${profile} --stage dev`));
            return null;
        }

        return { region, logGroups };
    } catch (error) {
        console.warn(chalk.yellow(`⚠️  Could not read profile '${profile}': ${(error as Error).message}`));
    }
    return null;
}

/**
 * Discover all log streams matching a prefix, sorted by recency
 */
async function discoverLogStreams(
    logsClient: CloudWatchLogsClient,
    logGroupName: string,
    logStreamNamePrefix: string | undefined,
    _startTime: number,
    spinner?: Ora,
): Promise<LogStream[]> {
    const streams: LogStream[] = [];
    let nextToken: string | undefined;

    try {
        // Paginate through all matching streams
        while (true) {
            // Note: AWS doesn't allow orderBy when using logStreamNamePrefix
            // We'll sort results after fetching all streams
            const command = new DescribeLogStreamsCommand({
                logGroupName,
                logStreamNamePrefix,
                nextToken,
            });

            const response = await logsClient.send(command);

            if (response.logStreams) {
                // Include all streams - CloudWatch's startTime filter will handle time range
                // Don't filter by lastEventTime as it might exclude streams that ended before
                // "now" but had events during the requested time window
                streams.push(...response.logStreams);

                // Update spinner with progress
                if (spinner) {
                    spinner.text = `Discovering streams... found ${streams.length}`;
                }
            }

            nextToken = response.nextToken;
            if (!nextToken) break;

            // Safety limit: stop after discovering maximum streams
            if (streams.length >= LOGS_CONFIG.MAX_STREAMS_TO_DISCOVER) {
                if (spinner) {
                    spinner.warn(chalk.yellow(
                        `Reached max stream limit (${LOGS_CONFIG.MAX_STREAMS_TO_DISCOVER}). ` +
                        "Some older streams may not be searched.",
                    ));
                }
                break;
            }
        }

        // Sort streams by lastEventTimestamp (newest first) since we couldn't use orderBy with prefix
        streams.sort((a, b) => (b.lastEventTimestamp || 0) - (a.lastEventTimestamp || 0));

        if (spinner) {
            spinner.text = `Found ${streams.length} stream${streams.length !== 1 ? "s" : ""}`;
        }
    } catch (error) {
        if ((error as Error).name === "ResourceNotFoundException") {
            if (spinner) {
                spinner.fail(chalk.red(`Log group not found: ${logGroupName}`));
            }
            return [];
        }
        // Re-throw unexpected errors
        throw error;
    }

    return streams;
}

/**
 * Fetch all logs from a single specific stream
 */
async function fetchLogsFromStream(
    logsClient: CloudWatchLogsClient,
    logGroupName: string,
    logStreamName: string,
    startTime: number,
    filterPattern?: string,
): Promise<FilteredLogEvent[]> {
    const events: FilteredLogEvent[] = [];
    let nextToken: string | undefined;
    let pageCount = 0;

    try {
        while (pageCount < LOGS_CONFIG.MAX_PAGES_PER_STREAM) {
            const command = new FilterLogEventsCommand({
                logGroupName,
                logStreamNames: [logStreamName], // Query specific stream
                startTime,
                filterPattern,
                limit: LOGS_CONFIG.CLOUDWATCH_MAX_EVENTS, // CloudWatch max per request
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
    } catch (error) {
        // Log warning but don't fail entire operation for single stream
        console.warn(chalk.yellow(
            `Warning: Failed to fetch from stream ${logStreamName}: ${(error as Error).message}`,
        ));
        // Return whatever events we collected before the error
    }

    return events;
}

/**
 * Fetch logs from a single log group using two-phase approach:
 * Phase 1: Discover all streams matching prefix
 * Phase 2: Query each stream until finding enough non-health logs
 */
async function fetchLogsFromGroup(
    logGroupName: string,
    region: string,
    since: string,
    limit: number,
    filterPattern?: string,
    awsProfile?: string,
    logStreamNamePrefix?: string,
    spinner?: Ora,
    useCache = true,
): Promise<FilteredLogEvent[]> {
    try {
        const clientConfig: {
            region: string;
            credentials?: ReturnType<typeof fromIni>;
            maxAttempts?: number;
            retryMode?: string;
        } = {
            region,
            maxAttempts: 3,           // Built-in retry for transient errors
            retryMode: "adaptive",    // Adaptive retry mode handles rate limiting
        };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }
        const logsClient = new CloudWatchLogsClient(clientConfig);

        // Get start time considering cache
        const cacheStats = getCacheStats(logGroupName, logStreamNamePrefix);
        const startTime = getStartTime(logGroupName, since, logStreamNamePrefix, useCache);
        const isIncrementalFetch = cacheStats.isCached && useCache;

        if (spinner) {
            const fetchType = isIncrementalFetch ? "incremental" : "initial";
            const timeAgo = isIncrementalFetch
                ? formatTimeAgo(cacheStats.lastFetchTime || Date.now())
                : `last ${since}`;
            spinner.text = `${logGroupName} - ${fetchType} fetch (${timeAgo})`;
        }

        const allEvents: FilteredLogEvent[] = [];

        // Phase 1: Discover all streams matching prefix
        if (spinner) {
            spinner.text = `${logGroupName} - discovering streams...`;
        }

        const streams = await discoverLogStreams(
            logsClient,
            logGroupName,
            logStreamNamePrefix,
            startTime,
            spinner,
        );

        if (streams.length === 0) {
            if (spinner) {
                spinner.warn(chalk.yellow(
                    `${logGroupName} - No log streams found matching prefix: ${logStreamNamePrefix || "(all)"}`,
                ));
            }
            return [];
        }

        // Phase 2: Query each stream until we have enough logs AND covered time range
        for (let i = 0; i < streams.length; i++) {
            const stream = streams[i];

            if (!stream.logStreamName) {
                continue;
            }

            const nonHealthCount = allEvents.filter(e =>
                e.message && !isHealthCheck(e.message),
            ).length;

            if (spinner) {
                const oldestSoFar = allEvents.length > 0
                    ? Math.min(...allEvents.map(e => e.timestamp || Date.now()))
                    : Date.now();
                spinner.text = `${logGroupName} - stream ${i + 1}/${streams.length} | ${nonHealthCount}/${limit} logs | oldest: ${formatLocalTime(oldestSoFar)}`;
            }

            const streamEvents = await fetchLogsFromStream(
                logsClient,
                logGroupName,
                stream.logStreamName,
                startTime,
                filterPattern,
            );

            allEvents.push(...streamEvents);

            // Memory safety: cap total events to prevent OOM
            if (allEvents.length >= LOGS_CONFIG.MAX_TOTAL_EVENTS) {
                if (spinner) {
                    spinner.warn(chalk.yellow(
                        `${logGroupName} - Reached max event limit (${LOGS_CONFIG.MAX_TOTAL_EVENTS})`,
                    ));
                }
                break;
            }

            // Early stopping: have enough logs AND searched back to requested time
            const updatedNonHealthCount = allEvents.filter(e =>
                e.message && !isHealthCheck(e.message),
            ).length;

            if (updatedNonHealthCount >= limit) {
                const oldestLogTime = Math.min(
                    ...allEvents.map(e => e.timestamp || Date.now()),
                );

                // Stop if we've searched back to within buffer time of target
                if (oldestLogTime <= startTime + LOGS_CONFIG.EARLY_STOP_TIME_BUFFER) {
                    if (spinner) {
                        spinner.text = `${logGroupName} - found ${updatedNonHealthCount} logs (early stop)`;
                    }
                    break;
                }
            }
        }

        // Sort all events by timestamp (newest first) after aggregation
        allEvents.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // Update cache with new events
        if (useCache && allEvents.length > 0) {
            updateCache(logGroupName, allEvents, logStreamNamePrefix);
        }

        if (spinner) {
            const nonHealthCount = allEvents.filter(e =>
                e.message && !isHealthCheck(e.message),
            ).length;
            const oldestTimestamp = allEvents.length > 0
                ? Math.min(...allEvents.map(e => e.timestamp || Date.now()))
                : Date.now();
            spinner.text = `${logGroupName} - ✓ ${nonHealthCount} logs (back to ${formatLocalTime(oldestTimestamp)})`;
        }

        return allEvents;
    } catch (error) {
        if (spinner) {
            spinner.fail(chalk.red(`${logGroupName} - ${(error as Error).message}`));
        }
        return [];
    }
}

/**
 * Extract a pattern from a log message for grouping
 */
function extractLogPattern(message: string): string {
    // Normalize the message for pattern matching
    let pattern = message.trim();

    // Replace IP addresses with [IP]
    pattern = pattern.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP]");

    // Replace timestamps like [20/Nov/2025 20:08:08] with [TIMESTAMP]
    pattern = pattern.replace(/\[\d{2}\/\w{3}\/\d{4}\s+\d{2}:\d{2}:\d{2}\]/g, "[TIMESTAMP]");

    // Replace UUIDs with [UUID]
    pattern = pattern.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[UUID]");

    // Replace entry IDs like etr_xxx with [ENTRY_ID]
    pattern = pattern.replace(/etr_[A-Za-z0-9]+/g, "[ENTRY_ID]");

    // Replace numeric IDs with [ID]
    pattern = pattern.replace(/\b\d{6,}\b/g, "[ID]");

    return pattern;
}

/**
 * Group log entries by pattern
 */
function groupLogEntries(entries: FilteredLogEvent[]): GroupedLogEntry[] {
    const groups = new Map<string, GroupedLogEntry>();

    for (const entry of entries) {
        if (!entry.message || !entry.timestamp) continue;

        const pattern = extractLogPattern(entry.message);

        if (!groups.has(pattern)) {
            groups.set(pattern, {
                pattern,
                count: 0,
                firstSeen: entry.timestamp,
                lastSeen: entry.timestamp,
                entries: [],
                sample: entry.message.trim(),
            });
        }

        const group = groups.get(pattern)!;
        group.count++;
        group.entries.push(entry);
        group.firstSeen = Math.min(group.firstSeen, entry.timestamp);
        group.lastSeen = Math.max(group.lastSeen, entry.timestamp);
    }

    // Sort groups by last seen (most recent first)
    return Array.from(groups.values()).sort((a, b) => b.lastSeen - a.lastSeen);
}

/**
 * Check if a log message is a health check
 */
function isHealthCheck(message: string): boolean {
    return message.includes("/health") ||
           message.includes("/health/ready") ||
           message.includes("ELB-HealthChecker");
}

/**
 * Count non-health log entries
 */
function countNonHealthEntries(entries: FilteredLogEvent[]): number {
    return entries.filter(e => e.message && !isHealthCheck(e.message)).length;
}

/**
 * Extract health check summaries from log entries
 */
function extractHealthCheckSummary(entries: FilteredLogEvent[]): HealthCheckSummary[] {
    const healthChecks = new Map<string, HealthCheckSummary>();

    for (const entry of entries) {
        if (!entry.message || !entry.timestamp || !isHealthCheck(entry.message)) continue;

        // Parse endpoint and status code
        // Example: INFO:werkzeug:127.0.0.1 - - [20/Nov/2025 20:08:08] "GET /health HTTP/1.1" 200 -
        const endpointMatch = entry.message.match(/"GET\s+(\/health[^\s]*)\s+HTTP/);
        const statusMatch = entry.message.match(/HTTP\/[\d.]+"\s+(\d{3})\s/);

        if (!endpointMatch) continue;

        const endpoint = endpointMatch[1];
        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : undefined;
        const status = statusCode && statusCode >= 200 && statusCode < 300 ? "success" :
            statusCode ? "failure" : "unknown";

        if (!healthChecks.has(endpoint)) {
            healthChecks.set(endpoint, {
                endpoint,
                status,
                lastSeen: entry.timestamp,
                count: 0,
                statusCode,
            });
        }

        const summary = healthChecks.get(endpoint)!;
        summary.count++;
        summary.lastSeen = Math.max(summary.lastSeen, entry.timestamp);

        // Update status to worst case (failure > unknown > success)
        if (status === "failure" || (status === "unknown" && summary.status === "success")) {
            summary.status = status;
            summary.statusCode = statusCode;
        }
    }

    return Array.from(healthChecks.values()).sort((a, b) => b.lastSeen - a.lastSeen);
}

/**
 * Group log entries by log stream first, then by pattern (excluding health checks)
 */
function groupLogEntriesByStream(entries: FilteredLogEvent[]): LogStreamGroup[] {
    const streamGroups = new Map<string, FilteredLogEvent[]>();

    // First, group by log stream (excluding health checks)
    for (const entry of entries) {
        if (!entry.logStreamName) continue;
        if (entry.message && isHealthCheck(entry.message)) continue; // Skip health checks

        if (!streamGroups.has(entry.logStreamName)) {
            streamGroups.set(entry.logStreamName, []);
        }
        streamGroups.get(entry.logStreamName)!.push(entry);
    }

    // Then group each stream's entries by pattern
    const result: LogStreamGroup[] = [];
    for (const [streamName, streamEntries] of streamGroups.entries()) {
        const patterns = groupLogEntries(streamEntries);

        // Extract a friendly display name from stream name
        // ECS stream names typically look like: ecs/benchling-webhook/abc123def456
        let displayName = streamName;
        const ecsMatch = streamName.match(/ecs\/[^/]+\/([a-f0-9]+)/);
        if (ecsMatch) {
            displayName = `Task ${ecsMatch[1].substring(0, 8)}`;
        }

        result.push({
            streamName,
            displayName,
            entries: streamEntries,
            patterns,
        });
    }

    // Sort by most recent activity
    return result.sort((a, b) => {
        const aLatest = Math.max(...a.entries.map(e => e.timestamp || 0));
        const bLatest = Math.max(...b.entries.map(e => e.timestamp || 0));
        return bLatest - aLatest;
    });
}

/**
 * Format time ago string
 */
function formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return `${diffSecs}s ago`;
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
}

/**
 * Display logs in organized sections with stream and pattern grouping
 */
function displayLogs(
    logGroups: LogGroupInfo[],
    profile: string,
    region: string,
    since: string,
    limit: number,
    oldestTimestamp: number,
    logGroupsConfig: ConfigLogGroupInfo[],
): void {
    const timeStr = formatLocalDateTime(new Date());
    const timezone = getLocalTimezone();

    console.log(chalk.bold(`\nLogs for Profile: ${profile} @ ${timeStr} (${timezone})\n`));
    console.log(chalk.dim("─".repeat(80)));
    console.log(`${chalk.bold("Region:")} ${chalk.cyan(region)}  ${chalk.bold("Initial Time Range:")} ${chalk.cyan(`Last ${since}`)}`);
    console.log(`${chalk.bold("Searched back to:")} ${chalk.cyan(formatLocalDateTime(new Date(oldestTimestamp)))}`);
    console.log(`${chalk.bold("Showing:")} ${chalk.cyan(`Last ~${limit} entries per log group`)}`);

    // Show cache statistics
    const cachedGroups = logGroupsConfig.filter(lg =>
        getCacheStats(lg.name, lg.streamPrefix).isCached,
    );
    if (cachedGroups.length > 0) {
        const oldestCached = Math.min(
            ...cachedGroups.map(lg => getCacheStats(lg.name, lg.streamPrefix).oldestRetrieved || Date.now()),
        );
        console.log(`${chalk.bold("Cache:")} ${chalk.cyan(`${cachedGroups.length} group${cachedGroups.length !== 1 ? "s" : ""} cached`)} ${chalk.dim(`(oldest: ${formatLocalDateTime(new Date(oldestCached))})`)}`);
    }

    console.log(chalk.dim("─".repeat(80)));
    console.log("");

    // Display each log group in its own section
    for (const logGroup of logGroups) {
        console.log(chalk.bold(`${logGroup.displayName}`) + chalk.dim(` (${logGroup.name})`));

        if (logGroup.entries.length === 0) {
            console.log(chalk.dim("  No log entries found\n"));
            continue;
        }

        // Extract health check summary
        const healthSummaries = extractHealthCheckSummary(logGroup.entries);

        // Display health check summary as subheading
        if (healthSummaries.length > 0) {
            console.log(chalk.bold.dim("\n  Health Checks:"));
            for (const health of healthSummaries) {
                const statusIcon = health.status === "success" ? chalk.green("✓") :
                    health.status === "failure" ? chalk.red("✗") :
                        chalk.yellow("?");
                const statusText = health.status === "success" ? chalk.green("HEALTHY") :
                    health.status === "failure" ? chalk.red("FAILED") :
                        chalk.yellow("UNKNOWN");
                const timeAgo = formatTimeAgo(health.lastSeen);
                const statusCode = health.statusCode ? ` (${health.statusCode})` : "";

                console.log(`    ${statusIcon} ${chalk.cyan(health.endpoint)}: ${statusText}${statusCode} @ ${chalk.dim(timeAgo)} ${chalk.dim.magenta(`×${health.count}`)}`);
            }
            console.log("");
        }

        // Group entries by log stream (excluding health checks)
        const streamGroups = groupLogEntriesByStream(logGroup.entries);
        const nonHealthCount = streamGroups.reduce((sum, s) => sum + s.entries.length, 0);

        if (nonHealthCount === 0) {
            console.log(chalk.dim("  No non-health log entries found\n"));
            continue;
        }

        console.log(chalk.bold.dim(`  Application Logs (${nonHealthCount} entries, ${streamGroups.length} streams):\n`));

        // Display each stream's grouped entries
        for (const stream of streamGroups) {
            // Compact stream header: only show display name and pattern count
            console.log(chalk.bold.blue(`    ${stream.displayName}`) + chalk.dim(` · ${stream.patterns.length} patterns:`));

            // Display grouped patterns for this stream
            for (const group of stream.patterns) {
                const firstTime = formatLocalTime(group.firstSeen);
                const lastTime = formatLocalTime(group.lastSeen);
                const timeRange = group.count > 1 ? `${firstTime} → ${lastTime}` : firstTime;

                // Color code by log level if detectable
                const sample = group.sample || "";
                let messageColor = chalk.white;
                let badge = "";

                if (sample.includes("ERROR") || sample.includes("CRITICAL")) {
                    messageColor = chalk.red;
                    badge = chalk.red.bold("[ERROR]");
                } else if (sample.includes("WARNING") || sample.includes("WARN")) {
                    messageColor = chalk.yellow;
                    badge = chalk.yellow.bold("[WARN]");
                } else if (sample.includes("INFO")) {
                    messageColor = chalk.cyan;
                    badge = chalk.cyan("[INFO]");
                } else if (sample.includes("DEBUG")) {
                    messageColor = chalk.dim;
                    badge = chalk.dim("[DEBUG]");
                }

                // Display count badge if more than 1
                const countBadge = group.count > 1 ? chalk.bold.magenta(`×${group.count}`) : "";

                console.log(`      ${chalk.dim(timeRange)} ${badge} ${countBadge}`);
                console.log(`        ${messageColor(sample)}`);

                // Show additional context for important messages (errors/warnings)
                if (group.count > 1 && (sample.includes("ERROR") || sample.includes("WARNING"))) {
                    console.log(chalk.dim(`        (${group.count} occurrences between ${firstTime} and ${lastTime})`));
                }

                console.log("");
            }
        }
    }

    console.log(chalk.dim("─".repeat(80)));
}


/**
 * Fetch logs from all relevant log groups (parallel implementation with spinners)
 */
async function fetchAllLogs(
    logGroupsFromConfig: ConfigLogGroupInfo[],
    region: string,
    since: string,
    limit: number,
    type: string,
    filterPattern?: string,
    awsProfile?: string,
    useCache = true,
): Promise<LogGroupInfo[]> {
    // Filter log groups by type if specified
    const filteredLogGroups = type === "all"
        ? logGroupsFromConfig
        : logGroupsFromConfig.filter((lg) => lg.type === type);

    // Show summary before starting
    const cacheStatus = filteredLogGroups.map(lg => ({
        name: lg.displayName,
        cached: getCacheStats(lg.name, lg.streamPrefix).isCached,
    }));

    const cachedCount = cacheStatus.filter(s => s.cached).length;
    const fetchMode = useCache && cachedCount > 0
        ? `${cachedCount}/${filteredLogGroups.length} cached`
        : "initial fetch";

    console.log(chalk.dim(`\nFetching logs from ${filteredLogGroups.length} log group${filteredLogGroups.length !== 1 ? "s" : ""} (${fetchMode})...\n`));

    // Create a spinner for each log group and fetch in parallel
    const fetchPromises = filteredLogGroups.map(async (logGroupInfo) => {
        const spinner = ora({
            text: `${logGroupInfo.displayName} - starting...`,
            color: "cyan",
        }).start();

        try {
            const entries = await fetchLogsFromGroup(
                logGroupInfo.name,
                region,
                since,
                limit,
                filterPattern,
                awsProfile,
                logGroupInfo.streamPrefix,
                spinner,
                useCache,
            );

            // Sort by timestamp descending (most recent first) and limit
            const sortedEntries = entries
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                .slice(0, limit);

            const nonHealthCount = sortedEntries.filter(e =>
                e.message && !isHealthCheck(e.message),
            ).length;

            spinner.succeed(chalk.green(
                `${logGroupInfo.displayName} - ${nonHealthCount} logs retrieved`,
            ));

            return {
                name: logGroupInfo.name,
                displayName: logGroupInfo.displayName,
                entries: sortedEntries,
            };
        } catch (error) {
            spinner.fail(chalk.red(
                `${logGroupInfo.displayName} - ${(error as Error).message}`,
            ));
            return {
                name: logGroupInfo.name,
                displayName: logGroupInfo.displayName,
                entries: [],
            };
        }
    });

    // Wait for all log groups to finish fetching in parallel
    const result = await Promise.all(fetchPromises);

    console.log(""); // Add blank line after spinners

    return result;
}

/**
 * Logs command implementation
 */
export async function logsCommand(options: LogsCommandOptions = {}): Promise<LogsResult> {
    const {
        profile = "default",
        awsProfile,
        type = "all",
        since = "5m",
        filter,
        follow = false,
        timer,
        limit = 50,
        configStorage,
    } = options;

    // Validate log type
    if (!["ecs", "api", "api-exec", "all"].includes(type)) {
        const errorMsg = "Invalid log type. Must be 'ecs', 'api', 'api-exec', or 'all'";
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }

    // Validate follow mode (not supported with new implementation)
    if (follow) {
        const errorMsg = "Follow mode (--follow) is not supported. Use --timer to auto-refresh logs.";
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        console.log(chalk.dim("Example: benchling-webhook logs --timer 5\n"));
        return { success: false, error: errorMsg };
    }

    const xdg = configStorage || new XDGConfig();

    // Check profile exists
    if (!xdg.profileExists(profile)) {
        const errorMsg = `Profile '${profile}' not found. Run setup first.`;
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }

    try {
        // Get log groups from profile configuration
        const configInfo = getLogGroupsFromConfig(profile, xdg);
        if (!configInfo) {
            const errorMsg = `Could not load log groups for profile '${profile}'.`;
            console.error(chalk.red(`\n❌ ${errorMsg}\n`));
            return { success: false, error: errorMsg };
        }

        const { region, logGroups } = configInfo;

        // Parse timer value
        const refreshInterval = parseTimerValue(timer);

        // Setup Ctrl+C handler for graceful exit
        let shouldExit = false;
        const exitHandler = (): void => {
            shouldExit = true;
            console.log(chalk.dim("\n\n⚠️  Interrupted by user. Exiting...\n"));
            process.exit(0);
        };
        process.on("SIGINT", exitHandler);

        let result: LogsResult = { success: true };
        let isFirstRun = true;

        // Watch loop
        while (true) {
            // Clear screen on subsequent runs
            if (!isFirstRun && refreshInterval) {
                clearScreen();
            }

            // Fetch logs from all relevant log groups (pagination handles finding logs)
            const fetchedLogGroups = await fetchAllLogs(
                logGroups,
                region,
                since,
                limit,
                type,
                filter,
                awsProfile,
            );

            // Check if any log group has entries
            const totalEntries = fetchedLogGroups.reduce((sum, lg) => sum + lg.entries.length, 0);
            const nonHealthEntries = fetchedLogGroups.reduce((sum, lg) => sum + countNonHealthEntries(lg.entries), 0);
            const hasLogGroups = fetchedLogGroups.length > 0;

            // If no log groups found at all, show error and exit
            if (!hasLogGroups) {
                console.error(chalk.red("\n❌ No log groups available for fetching."));
                console.log(chalk.dim("   This means the CloudWatch log groups don't exist in AWS yet."));
                console.log(chalk.dim(`   Run: npm run deploy -- --profile ${profile} --stage dev\n`));

                // Don't loop if there are no log groups
                if (!refreshInterval) {
                    break;
                }

                // Wait before retrying
                const totalSeconds = Math.floor(refreshInterval / 1000);
                const spinner = ora({
                    text: chalk.dim(`⟳ Retrying in ${totalSeconds} second${totalSeconds !== 1 ? "s" : ""}... (Ctrl+C to exit)`),
                    color: "gray",
                }).start();

                for (let i = totalSeconds; i > 0; i--) {
                    spinner.text = chalk.dim(`⟳ Retrying in ${i} second${i !== 1 ? "s" : ""}... (Ctrl+C to exit)`);
                    await sleep(1000);
                    if (shouldExit) break;
                }

                spinner.stop();

                if (shouldExit) {
                    break;
                }

                isFirstRun = false;
                continue;
            }

            // Calculate oldest timestamp we searched back to
            const oldestTimestamp = totalEntries > 0
                ? Math.min(...fetchedLogGroups.flatMap(lg => lg.entries.map(e => e.timestamp || Date.now())))
                : Date.now() - parseTimeRange(since);

            // Display logs
            displayLogs(fetchedLogGroups, profile, region, since, limit, oldestTimestamp, logGroups);

            result.logGroups = fetchedLogGroups;

            // Show helpful message if no non-health logs found
            if (totalEntries > 0 && nonHealthEntries === 0) {
                console.log(chalk.yellow("\n💡 No application logs found (only health checks)."));
                console.log(chalk.dim(`   Searched ${totalEntries} log entries back to ${new Date(oldestTimestamp).toISOString()}`));
                console.log(chalk.dim("   This could mean:"));
                console.log(chalk.dim("   - The service hasn't received any webhook requests recently"));
                console.log(chalk.dim("   - Only health checks have been running\n"));
            }

            // Check if we should exit (no timer)
            if (!refreshInterval) {
                break;
            }

            // Show countdown with live updates
            const totalSeconds = Math.floor(refreshInterval / 1000);
            const spinner = ora({
                text: chalk.dim(`⟳ Refreshing in ${totalSeconds} second${totalSeconds !== 1 ? "s" : ""}... (Ctrl+C to exit)`),
                color: "gray",
            }).start();

            for (let i = totalSeconds; i > 0; i--) {
                spinner.text = chalk.dim(`⟳ Refreshing in ${i} second${i !== 1 ? "s" : ""}... (Ctrl+C to exit)`);
                await sleep(1000);
                if (shouldExit) break;
            }

            spinner.stop();

            if (shouldExit) {
                break;
            }

            isFirstRun = false;
        }

        // Clean up handler
        process.off("SIGINT", exitHandler);

        return result;
    } catch (error) {
        const errorMsg = (error as Error).message;
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return { success: false, error: errorMsg };
    }
}
