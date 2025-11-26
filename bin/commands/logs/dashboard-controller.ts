/**
 * Dashboard controller orchestrating the lifecycle of the logs dashboard
 */

import type { FilteredLogEvent } from "@aws-sdk/client-cloudwatch-logs";
import pLimit from "p-limit";
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

            this.dashboard.updateSection(lg.displayName, {
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
        const FETCH_TIMEOUT_MS = 180000; // 3 minute timeout (increased from 60s to allow AWS SDK retries)
        const MAX_CONCURRENT_FETCHES = 2; // Limit concurrency to avoid CloudWatch API throttling (5 TPS limit)
        const STAGGER_DELAY_MS = 500; // Stagger start times to smooth out API call bursts

        // Create concurrency limiter
        const limit = pLimit(MAX_CONCURRENT_FETCHES);

        const fetchPromises = this.sortedLogGroups.map(async (logGroup, index) => {
            // Stagger start times to avoid burst at t=0
            await new Promise(resolve => setTimeout(resolve, index * STAGGER_DELAY_MS));

            // Wrap fetch in concurrency limiter
            return limit(async () => {
                const startTime = Date.now();

                // Create timeout promise
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error(`Timeout after ${FETCH_TIMEOUT_MS / 1000} seconds`)), FETCH_TIMEOUT_MS);
                });

                // Progress update interval - update elapsed time every 500ms
                const progressInterval = setInterval(() => {
                    const elapsed = Math.floor((Date.now() - startTime) / 1000);
                    this.dashboard.updateSection(logGroup.displayName, {
                        progressIndicator: {
                            visible: true,
                            text: `Fetching logs... (${elapsed}s)`,
                        },
                    });
                }, 500);

                // Create fetch promise
                const fetchPromise = (async (): Promise<{ success: boolean; logs?: FilteredLogEvent[]; error?: unknown }> => {
                // Update status: fetching
                    this.dashboard.updateSection(logGroup.displayName, {
                        header: {
                            title: logGroup.displayName,
                            status: "fetching",
                            lastUpdate: formatLocalTime(Date.now()),
                        },
                        progressIndicator: {
                            visible: true,
                            text: "Fetching logs... (0s)",
                        },
                    });

                    try {
                        const logs = await this.options.fetchLogsFunction(logGroup);

                        // Clear progress interval on success
                        clearInterval(progressInterval);

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

                        this.dashboard.updateSection(logGroup.displayName, section);

                        // Update cache
                        this.cacheManager.updateGroup(
                            logGroup.displayName,
                            logGroup.displayName,
                            logs,
                            healthSummary,
                        );

                        return { success: true, logs };
                    } catch (error) {
                    // Clear progress interval on error
                        clearInterval(progressInterval);

                        // Update with error status
                        this.dashboard.updateSection(logGroup.displayName, {
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
                })();

                // Race fetch against timeout
                try {
                    return await Promise.race([fetchPromise, timeoutPromise]);
                } catch (error) {
                // Clear progress interval on timeout
                    clearInterval(progressInterval);

                    // Handle timeout or other errors
                    this.dashboard.updateSection(logGroup.displayName, {
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
                            text: `Timeout: ${(error as Error).message}`,
                        },
                    });

                    return { success: false, error };
                } finally {
                // Ensure interval is always cleared
                    clearInterval(progressInterval);
                }
            }); // Close limit() wrapper
        }); // Close map()

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
