/**
 * Utility functions for log processing
 */

import type { FilteredLogEvent } from "@aws-sdk/client-cloudwatch-logs";
import type { GroupedLogEntry, LogStreamGroup, HealthCheckSummary } from "../logs";

/**
 * Check if a log message is a health check
 */
export function isHealthCheck(message: string): boolean {
    return message.includes("/health") ||
           message.includes("/health/ready") ||
           message.includes("ELB-HealthChecker");
}

/**
 * Extract a pattern from a log message for grouping
 */
export function extractLogPattern(message: string): string {
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
export function groupLogEntries(entries: FilteredLogEvent[]): GroupedLogEntry[] {
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
 * Extract health check summaries from log entries
 */
export function extractHealthCheckSummary(entries: FilteredLogEvent[]): HealthCheckSummary[] {
    const healthChecks = new Map<string, HealthCheckSummary>();

    for (const entry of entries) {
        if (!entry.message || !entry.timestamp || !isHealthCheck(entry.message)) continue;

        // Parse endpoint and status code
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
export function groupLogEntriesByStream(entries: FilteredLogEvent[]): LogStreamGroup[] {
    const streamGroups = new Map<string, FilteredLogEvent[]>();

    // First, group by log stream (excluding health checks)
    for (const entry of entries) {
        if (!entry.logStreamName) continue;
        if (entry.message && isHealthCheck(entry.message)) continue;

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
 * Count non-health log entries
 */
export function countNonHealthEntries(entries: FilteredLogEvent[]): number {
    return entries.filter(e => e.message && !isHealthCheck(e.message)).length;
}
