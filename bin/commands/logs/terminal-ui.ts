/**
 * Terminal UI layer using blessed for rich multi-section dashboard
 */

import blessed from "blessed";
import type { LogGroupSection, StatusIndicator } from "./types";
import type { LogGroupInfo as ConfigLogGroupInfo } from "../../../lib/types/config";
import { formatLocalTime, formatLocalDateTime, getLocalTimezone } from "../../../lib/utils/time-format";
import { PriorityOrderingStrategy } from "./priority-ordering";

export class LogsDashboard {
    private screen: blessed.Widgets.Screen;
    private sections: Map<string, LogGroupWidget>;
    private header: blessed.Widgets.BoxElement;
    private summary: blessed.Widgets.BoxElement;
    private profile: string;
    private region: string;
    private since: string;
    private priorityStrategy: PriorityOrderingStrategy;

    constructor(profile: string, region: string, since: string) {
        this.profile = profile;
        this.region = region;
        this.since = since;
        this.priorityStrategy = new PriorityOrderingStrategy();

        this.screen = blessed.screen({
            smartCSR: true,
            title: "Benchling Webhook Logs",
            fullUnicode: true,
        });

        this.sections = new Map();
        this.header = this.createHeader();
        this.summary = this.createSummary();

        this.setupEventHandlers();
    }

    private createHeader(): blessed.Widgets.BoxElement {
        const timeStr = formatLocalDateTime(new Date());
        const timezone = getLocalTimezone();

        const header = blessed.box({
            parent: this.screen,
            top: 0,
            left: 0,
            width: "100%",
            height: 4,
            border: {
                type: "line",
            },
            style: {
                border: {
                    fg: "cyan",
                },
            },
            tags: true,
        });

        header.setContent(
            `{bold}Benchling Webhook Logs{/bold}                    ${timeStr} (${timezone})\n\n` +
            `Profile: {cyan-fg}${this.profile}{/}  Region: {cyan-fg}${this.region}{/}  Since: {cyan-fg}Last ${this.since}{/}`,
        );

        return header;
    }

    private createSummary(): blessed.Widgets.BoxElement {
        const summary = blessed.box({
            parent: this.screen,
            bottom: 0,
            left: 0,
            width: "100%",
            height: 4,
            border: {
                type: "line",
            },
            style: {
                border: {
                    fg: "white",
                },
            },
            label: " Summary ",
            tags: true,
        });

        return summary;
    }

    private setupEventHandlers(): void {
        // Quit on Escape, q, or Ctrl-C
        this.screen.key(["escape", "q", "C-c"], () => {
            this.exit();
        });

        // Refresh screen on resize
        this.screen.on("resize", () => {
            this.screen.render();
        });
    }

    public createSection(logGroupInfo: ConfigLogGroupInfo, position: number, totalSections: number): void {
        const priority = this.priorityStrategy.calculatePriority(logGroupInfo);
        const widget = new LogGroupWidget(
            this.screen,
            logGroupInfo,
            position,
            totalSections,
            priority,
            this.priorityStrategy,
        );

        this.sections.set(logGroupInfo.name, widget);
    }

    public updateSection(logGroupName: string, update: Partial<LogGroupSection>): void {
        const widget = this.sections.get(logGroupName);
        if (!widget) return;

        widget.update(update);
        this.screen.render();
    }

    public updateSummary(totalLogs: number, errors: number, warnings: number, info: number): void {
        const totalGroups = this.sections.size;

        this.summary.setContent(
            `Total: {cyan-fg}${totalLogs}{/} logs across {cyan-fg}${totalGroups}{/} groups\n` +
            `Errors: {red-fg}${errors}{/}   Warnings: {yellow-fg}${warnings}{/}   Info: {cyan-fg}${info}{/}`,
        );

        this.screen.render();
    }

    public render(): void {
        this.screen.render();
    }

    public exit(): void {
        this.screen.destroy();
        process.exit(0);
    }

    public getSections(): Map<string, LogGroupWidget> {
        return this.sections;
    }
}

class LogGroupWidget {
    private box: blessed.Widgets.BoxElement;
    private statusText: blessed.Widgets.TextElement;
    private healthBox: blessed.Widgets.BoxElement;
    private logsBox: blessed.Widgets.BoxElement;
    private progressText: blessed.Widgets.TextElement;
    private logGroupInfo: ConfigLogGroupInfo;
    private priority: number;
    private priorityStrategy: PriorityOrderingStrategy;

    constructor(
        parent: blessed.Widgets.Screen,
        logGroupInfo: ConfigLogGroupInfo,
        position: number,
        totalSections: number,
        priority: number,
        priorityStrategy: PriorityOrderingStrategy,
    ) {
        this.logGroupInfo = logGroupInfo;
        this.priority = priority;
        this.priorityStrategy = priorityStrategy;

        // Calculate heights
        const headerHeight = 4;
        const summaryHeight = 4;
        const screenHeight = typeof parent.height === "number" ? parent.height : 40;
        const availableHeight = screenHeight - headerHeight - summaryHeight;
        const sectionHeight = Math.floor(availableHeight / totalSections);
        const top = headerHeight + (position * sectionHeight);

        const borderColor = priorityStrategy.getBorderColor(priority);
        const badge = priorityStrategy.getPriorityBadge(priority);
        const label = badge ? ` ${badge} ${logGroupInfo.displayName} ` : ` ${logGroupInfo.displayName} `;

        this.box = blessed.box({
            parent,
            top,
            left: 0,
            width: "100%",
            height: sectionHeight,
            border: {
                type: "line",
            },
            style: {
                border: {
                    fg: borderColor,
                },
            },
            label,
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            scrollbar: {
                ch: "█",
                track: {
                    bg: "gray",
                },
                style: {
                    inverse: true,
                },
            },
        });

        this.createSubWidgets();
    }

    private createSubWidgets(): void {
        // Status line at top
        this.statusText = blessed.text({
            parent: this.box,
            top: 0,
            left: 1,
            width: "100%-2",
            height: 1,
            tags: true,
            content: "{gray-fg}○{/} {dim}Pending...{/}",
        });

        // Health checks section
        this.healthBox = blessed.box({
            parent: this.box,
            top: 2,
            left: 1,
            width: "100%-2",
            height: "shrink",
            tags: true,
            content: "",
        });

        // Application logs section
        this.logsBox = blessed.box({
            parent: this.box,
            top: 5,
            left: 1,
            width: "100%-2",
            height: "100%-7",
            tags: true,
            scrollable: true,
            content: "",
        });

        // Progress indicator
        this.progressText = blessed.text({
            parent: this.box,
            bottom: 0,
            left: 1,
            width: "100%-2",
            height: 1,
            tags: true,
            content: "",
        });
    }

    public update(data: Partial<LogGroupSection>): void {
        if (data.header) {
            this.updateStatus(data.header.status, data.header.lastUpdate);
        }

        if (data.healthChecks) {
            this.updateHealthChecks(data.healthChecks);
        }

        if (data.applicationLogs) {
            this.updateLogs(data.applicationLogs);
        }

        if (data.progressIndicator) {
            this.updateProgress(data.progressIndicator);
        }
    }

    private updateStatus(status: StatusIndicator, lastUpdate: string): void {
        const icon = this.getStatusIcon(status);
        const color = this.getStatusColor(status);
        const statusLabel = this.getStatusLabel(status);

        this.statusText.setContent(
            `{${color}-fg}${icon}{/} {${color}-fg}${statusLabel}{/}` +
            `{|}Last update: {dim}${lastUpdate}{/}`,
        );
    }

    private updateHealthChecks(healthChecks: LogGroupSection["healthChecks"]): void {
        if (!healthChecks.visible || healthChecks.entries.length === 0) {
            this.healthBox.setContent("");
            return;
        }

        const lines: string[] = ["{bold}{dim}Health Checks:{/}{/}"];

        for (const health of healthChecks.entries) {
            const statusIcon = health.status === "success" ? "{green-fg}✓{/}" :
                health.status === "failure" ? "{red-fg}✗{/}" :
                    "{yellow-fg}?{/}";
            const statusText = health.status === "success" ? "{green-fg}HEALTHY{/}" :
                health.status === "failure" ? "{red-fg}FAILED{/}" :
                    "{yellow-fg}UNKNOWN{/}";
            const statusCode = health.statusCode ? ` (${health.statusCode})` : "";
            const timeAgo = this.formatTimeAgo(health.lastSeen);

            lines.push(
                `  ${statusIcon} {cyan-fg}${health.endpoint}{/}: ${statusText}${statusCode} @ {dim}${timeAgo}{/} {magenta-fg}×${health.count}{/}`,
            );
        }

        this.healthBox.setContent(lines.join("\n"));
    }

    private updateLogs(applicationLogs: LogGroupSection["applicationLogs"]): void {
        if (applicationLogs.state === "loading") {
            this.logsBox.setContent("{dim}Loading...{/}");
            return;
        }

        if (applicationLogs.state === "error") {
            this.logsBox.setContent("{red-fg}Error loading logs{/}");
            return;
        }

        if (applicationLogs.count === 0) {
            this.logsBox.setContent("{dim}No log entries found{/}");
            return;
        }

        const lines: string[] = [
            `{bold}{dim}Application Logs ({/}{cyan-fg}${applicationLogs.count}{/}{dim} entries, ${applicationLogs.streams.length} streams):{/}{/}`,
            "",
        ];

        // Display grouped by stream
        for (const stream of applicationLogs.streams.slice(0, 3)) { // Show top 3 streams
            lines.push(`{bold}{blue-fg}${stream.displayName}{/}{/} {dim}· ${stream.patterns.length} patterns:{/}`);

            for (const pattern of stream.patterns.slice(0, 2)) { // Show top 2 patterns per stream
                const firstTime = formatLocalTime(pattern.firstSeen);
                const lastTime = formatLocalTime(pattern.lastSeen);
                const timeRange = pattern.count > 1 ? `${firstTime} → ${lastTime}` : firstTime;

                // Determine badge
                const sample = pattern.sample || "";
                let badge = "";
                if (sample.includes("ERROR") || sample.includes("CRITICAL")) {
                    badge = "{red-fg}{bold}[ERROR]{/}{/}";
                } else if (sample.includes("WARNING") || sample.includes("WARN")) {
                    badge = "{yellow-fg}{bold}[WARN]{/}{/}";
                } else if (sample.includes("INFO")) {
                    badge = "{cyan-fg}[INFO]{/}";
                }

                const countBadge = pattern.count > 1 ? `{magenta-fg}×${pattern.count}{/}` : "";

                lines.push(`  {dim}${timeRange}{/} ${badge} ${countBadge}`);
                lines.push(`    ${this.truncate(sample, 100)}`);
            }

            if (stream.patterns.length > 2) {
                lines.push(`  {dim}... ${stream.patterns.length - 2} more patterns{/}`);
            }

            lines.push("");
        }

        if (applicationLogs.streams.length > 3) {
            lines.push(`{dim}... ${applicationLogs.streams.length - 3} more streams{/}`);
        }

        this.logsBox.setContent(lines.join("\n"));
    }

    private updateProgress(progressIndicator: LogGroupSection["progressIndicator"]): void {
        if (!progressIndicator.visible) {
            this.progressText.setContent("");
            return;
        }

        this.progressText.setContent(`{dim}${progressIndicator.text}{/}`);
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

    private getStatusColor(status: StatusIndicator): string {
        const colors = {
            pending: "gray",
            fetching: "cyan",
            complete: "green",
            error: "red",
        };
        return colors[status] || "gray";
    }

    private getStatusLabel(status: StatusIndicator): string {
        const labels = {
            pending: "Pending",
            fetching: "Fetching...",
            complete: "Complete",
            error: "Error",
        };
        return labels[status] || "Unknown";
    }

    private formatTimeAgo(timestamp: number): string {
        const now = Date.now();
        const diffMs = now - timestamp;
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);

        if (diffSecs < 60) return `${diffSecs}s ago`;
        if (diffMins < 60) return `${diffMins}m ago`;
        return `${diffHours}h ago`;
    }

    private truncate(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + "...";
    }
}
