/**
 * Dashboard controller orchestrating the lifecycle of the logs dashboard
 */

import type { FilteredLogEvent } from "@aws-sdk/client-cloudwatch-logs";
import { LogsCacheManager } from "./cache-manager";
import { LogsDashboard } from "./terminal-ui";
import { PriorityOrderingStrategy } from "./priority-ordering";
import type { LogGroupSection } from "./types";
import type { LogGroupInfo as ConfigLogGroupInfo } from "../../../lib/types/config";
import { formatLocalTime } from "../../../lib/utils/time-format";
import {
    extractHealthCheckSummary,
    groupLogEntriesByStream,
    isHealthCheck,
} from "./log-utils";

export interface DashboardOptions {
    profile: string;
    region: string;
    since: string;
    logGroups: ConfigLogGroupInfo[];
    fetchLogsFunction: (logGroupInfo: ConfigLogGroupInfo) => Promise<FilteredLogEvent[]>;
}

export class LogsDashboardController {
    private cacheManager: LogsCacheManager;
    private dashboard: LogsDashboard;
    private priorityStrategy: PriorityOrderingStrategy;
    private options: DashboardOptions;
    private sortedLogGroups: ConfigLogGroupInfo[];

    constructor(options: DashboardOptions) {
        this.options = options;
        this.cacheManager = new LogsCacheManager(options.profile);
        this.dashboard = new LogsDashboard(options.profile, options.region, options.since);
        this.priorityStrategy = new PriorityOrderingStrategy();

        // Sort log groups by priority
        this.sortedLogGroups = this.priorityStrategy.sort(options.logGroups);
    }

    /**
     * Initialize the dashboard
     * Phase 1: Load cache
     * Phase 2: Render skeleton
     * Phase 3: Show cached data
     * Phase 4: Start fresh fetches
     */
    public async initialize(): Promise<void> {
        // Phase 1: Load cache from disk
        const cache = this.cacheManager.load();

        // Phase 2: Render skeleton with sections for each log group
        this.renderSkeleton();

        // Phase 3: Populate with cached data if available
        if (cache) {
            this.renderCached(cache);
        }

        // Phase 4: Fetch fresh data from CloudWatch
        await this.fetchAllLogsInParallel();

        // Update summary
        this.updateSummary();

        // Save cache
        const currentCache = this.cacheManager.getCache();
        if (currentCache) {
            this.cacheManager.save(currentCache);
        }
    }

    /**
     * Phase 1: Render skeleton - empty layout structure
     */
    private renderSkeleton(): void {
        for (let i = 0; i < this.sortedLogGroups.length; i++) {
            const lg = this.sortedLogGroups[i];
            this.dashboard.createSection(lg, i, this.sortedLogGroups.length);

            this.dashboard.updateSection(lg.name, {
                header: {
                    title: lg.displayName,
                    status: "pending",
                    lastUpdate: "—",
                },
                healthChecks: {
                    visible: false,
                    entries: [],
                },
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

        this.dashboard.render();
    }

    /**
     * Phase 2: Populate with cached data
     */
    private renderCached(cache: ReturnType<typeof this.cacheManager.getCache>): void {
        if (!cache) return;

        for (const [name, group] of Object.entries(cache.groups)) {
            const staleness = this.calculateStaleness(group.lastFetchTime);

            this.dashboard.updateSection(name, {
                header: {
                    title: group.displayName,
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
                    patterns: [],
                    streams: groupLogEntriesByStream(group.recentLogs),
                },
                progressIndicator: {
                    visible: true,
                    text: "Refreshing...",
                },
            });
        }

        this.dashboard.render();
    }

    /**
     * Phase 3: Fetch fresh data from all log groups in parallel
     */
    private async fetchAllLogsInParallel(): Promise<void> {
        const fetchPromises = this.sortedLogGroups.map(async (logGroup) => {
            // Update status: fetching
            this.dashboard.updateSection(logGroup.name, {
                header: {
                    title: logGroup.displayName,
                    status: "fetching",
                    lastUpdate: formatLocalTime(Date.now()),
                },
                progressIndicator: {
                    visible: true,
                    text: "Fetching logs...",
                },
            });

            try {
                const logs = await this.options.fetchLogsFunction(logGroup);

                // Extract health checks and non-health logs
                const healthSummary = extractHealthCheckSummary(logs);
                const nonHealthLogs = logs.filter(e => e.message && !isHealthCheck(e.message));

                // Update with fresh data
                const section: Partial<LogGroupSection> = {
                    header: {
                        title: logGroup.displayName,
                        status: "complete",
                        lastUpdate: formatLocalTime(Date.now()),
                    },
                    healthChecks: {
                        visible: healthSummary.length > 0,
                        entries: healthSummary,
                    },
                    applicationLogs: {
                        state: "loaded",
                        count: nonHealthLogs.length,
                        patterns: [],
                        streams: groupLogEntriesByStream(nonHealthLogs),
                    },
                    progressIndicator: {
                        visible: false,
                        text: "",
                    },
                };

                this.dashboard.updateSection(logGroup.name, section);

                // Update cache
                this.cacheManager.updateGroup(
                    logGroup.name,
                    logGroup.displayName,
                    logs,
                    healthSummary,
                );

                return { success: true, logs };
            } catch (error) {
                // Update with error status
                this.dashboard.updateSection(logGroup.name, {
                    header: {
                        title: logGroup.displayName,
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
                        text: `Error: ${(error as Error).message}`,
                    },
                });

                return { success: false, error };
            }
        });

        await Promise.all(fetchPromises);
    }

    /**
     * Update summary section with aggregate statistics
     */
    private updateSummary(): void {
        const cache = this.cacheManager.getCache();
        if (!cache) return;

        let totalLogs = 0;
        let errors = 0;
        let warnings = 0;
        let info = 0;

        for (const group of Object.values(cache.groups)) {
            totalLogs += group.totalLogsCount;
            errors += group.errorCount;
            warnings += group.warningCount;
            // Info is everything else
            info += group.totalLogsCount - group.errorCount - group.warningCount;
        }

        this.dashboard.updateSummary(totalLogs, errors, warnings, info);
    }

    /**
     * Calculate staleness indicator
     */
    private calculateStaleness(lastFetchTime: number): string {
        const age = Date.now() - lastFetchTime;
        const minutes = Math.floor(age / 60000);
        if (minutes < 1) return "just now";
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        return `${hours}h ago`;
    }

    /**
     * Graceful exit handler
     */
    public exit(): void {
        // Save cache before exiting
        const cache = this.cacheManager.getCache();
        if (cache) {
            this.cacheManager.save(cache);
        }

        this.dashboard.exit();
    }
}
