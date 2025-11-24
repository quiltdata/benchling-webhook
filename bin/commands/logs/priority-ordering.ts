/**
 * Priority ordering strategy for log groups
 */

import type { LogGroupInfo as ConfigLogGroupInfo } from "../../../lib/types/config";

export interface LogGroupPriority {
    group: ConfigLogGroupInfo;
    priority: number;
    sortKey: string;
}

export class PriorityOrderingStrategy {
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

    /**
     * Get priority badge for display
     */
    getPriorityBadge(priority: number): string {
        if (priority >= 1000) return "⭐";  // Star for main app
        if (priority >= 900) return "🔹";   // Diamond for ECS
        return "";  // No badge for lower priority
    }

    /**
     * Get border color based on priority
     */
    getBorderColor(priority: number): string {
        if (priority >= 1000) return "cyan";
        if (priority >= 900) return "blue";
        return "white";
    }
}
