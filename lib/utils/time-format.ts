/**
 * Time Formatting Utilities
 *
 * Shared utilities for formatting timestamps in a consistent way
 * across the CLI commands.
 *
 * @module utils/time-format
 */

/**
 * Format a date/time in local timezone with consistent format
 *
 * @param date - Date to format (Date object, ISO string, or timestamp)
 * @param includeSeconds - Whether to include seconds in the output
 * @returns Formatted date/time string
 */
export function formatLocalDateTime(
    date: Date | string | number,
    includeSeconds = true,
): string {
    const dateObj = typeof date === "string" || typeof date === "number" ? new Date(date) : date;

    const options: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    };

    if (includeSeconds) {
        options.second = "2-digit";
    }

    return dateObj.toLocaleString("en-US", options);
}

/**
 * Format time only (HH:MM:SS) in local timezone
 *
 * @param date - Date to format (Date object, ISO string, or timestamp)
 * @param includeSeconds - Whether to include seconds in the output
 * @returns Formatted time string
 */
export function formatLocalTime(
    date: Date | string | number,
    includeSeconds = true,
): string {
    const dateObj = typeof date === "string" || typeof date === "number" ? new Date(date) : date;

    const options: Intl.DateTimeFormatOptions = {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    };

    if (includeSeconds) {
        options.second = "2-digit";
    }

    return dateObj.toLocaleTimeString("en-US", options);
}

/**
 * Get the local timezone name
 *
 * @returns Timezone name (e.g., "America/Los_Angeles")
 */
export function getLocalTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Format a relative time (e.g., "2 minutes ago", "in 5 seconds")
 *
 * @param date - Date to compare (Date object, ISO string, or timestamp)
 * @param baseDate - Base date to compare against (defaults to now)
 * @returns Formatted relative time string
 */
export function formatRelativeTime(
    date: Date | string | number,
    baseDate: Date = new Date(),
): string {
    const dateObj = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
    const diffMs = dateObj.getTime() - baseDate.getTime();
    const absDiffMs = Math.abs(diffMs);

    const seconds = Math.floor(absDiffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    let value: number;
    let unit: string;

    if (days > 0) {
        value = days;
        unit = days === 1 ? "day" : "days";
    } else if (hours > 0) {
        value = hours;
        unit = hours === 1 ? "hour" : "hours";
    } else if (minutes > 0) {
        value = minutes;
        unit = minutes === 1 ? "minute" : "minutes";
    } else {
        value = seconds;
        unit = seconds === 1 ? "second" : "seconds";
    }

    if (diffMs < 0) {
        return `${value} ${unit} ago`;
    } else {
        return `in ${value} ${unit}`;
    }
}

/**
 * Parse a time range string (e.g., "5m", "1h", "2d") to milliseconds
 *
 * @param since - Time range string
 * @returns Milliseconds
 */
export function parseTimeRange(since: string): number {
    const match = since.match(/^(\d+)([mhd])$/);
    if (!match) {
        throw new Error(`Invalid time format: ${since}. Use format like "5m", "1h", or "2d"`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
    case "m":
        return value * 60 * 1000;
    case "h":
        return value * 60 * 60 * 1000;
    case "d":
        return value * 24 * 60 * 60 * 1000;
    default:
        throw new Error(`Invalid time unit: ${unit}`);
    }
}

/**
 * Format milliseconds to human-readable time range string
 *
 * @param ms - Milliseconds
 * @returns Human-readable string (e.g., "5m", "2h", "3d")
 */
export function formatTimeRange(ms: number): string {
    const minutes = ms / (60 * 1000);
    const hours = minutes / 60;
    const days = hours / 24;

    if (days >= 1) {
        return `${Math.round(days)}d`;
    } else if (hours >= 1) {
        return `${Math.round(hours)}h`;
    } else {
        return `${Math.round(minutes)}m`;
    }
}
