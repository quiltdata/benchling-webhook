/**
 * Types for logs dashboard implementation
 */

import type { FilteredLogEvent } from "@aws-sdk/client-cloudwatch-logs";
import type { GroupedLogEntry, LogStreamGroup, HealthCheckSummary } from "../logs";

export type StatusIndicator = "pending" | "fetching" | "complete" | "error";

export interface LogGroupSection {
    header: {
        title: string;
        status: StatusIndicator;
        lastUpdate: string;
    };
    healthChecks: {
        visible: boolean;
        entries: HealthCheckSummary[];
    };
    applicationLogs: {
        state: "loading" | "loaded" | "error";
        count: number;
        patterns: GroupedLogEntry[];
        streams: LogStreamGroup[];
    };
    progressIndicator: {
        visible: boolean;
        text: string;
    };
}

export interface PersistentLogsCache {
    version: string;
    lastUpdated: string;
    profile: string;
    groups: Record<string, CachedLogGroup>;
}

export interface CachedLogGroup {
    name: string;
    displayName: string;
    lastSeenTimestamp: number;
    lastFetchTime: number;
    oldestRetrieved: number;
    recentLogs: FilteredLogEvent[];
    healthSummary: HealthCheckSummary[];
    totalLogsCount: number;
    errorCount: number;
    warningCount: number;
    streamCount: number;
}
