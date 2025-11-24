/**
 * Persistent cache manager for log data
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import type { FilteredLogEvent } from "@aws-sdk/client-cloudwatch-logs";
import type { HealthCheckSummary } from "../logs";
import type { PersistentLogsCache, CachedLogGroup } from "./types";

export class LogsCacheManager {
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
            console.warn(`Failed to load cache: ${(error as Error).message}`);
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
                "utf-8",
            );
            renameSync(tempPath, this.cachePath);
            this.cache = cache;
        } catch (error) {
            console.warn(`Failed to save cache: ${(error as Error).message}`);
        }
    }

    /**
     * Update cache with fresh data from a log group
     */
    public updateGroup(
        logGroupName: string,
        displayName: string,
        logs: FilteredLogEvent[],
        healthSummary: HealthCheckSummary[],
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
            displayName: displayName,
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

    /**
     * Get cached data for a log group
     */
    public getGroup(logGroupName: string): CachedLogGroup | null {
        if (!this.cache) {
            return null;
        }

        return this.cache.groups[logGroupName] || null;
    }

    /**
     * Get all cached groups
     */
    public getAllGroups(): Record<string, CachedLogGroup> {
        if (!this.cache) {
            return {};
        }

        return this.cache.groups;
    }

    /**
     * Clear all cached data
     */
    public clear(): void {
        this.cache = this.createEmptyCache();
    }

    /**
     * Get current cache object
     */
    public getCache(): PersistentLogsCache | null {
        return this.cache;
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
            "logs-cache.json",
        );
    }
}
