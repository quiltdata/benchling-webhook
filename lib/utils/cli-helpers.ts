/**
 * CLI Helper Utilities
 *
 * Shared utilities for CLI commands (sleep, clear screen, etc.)
 *
 * @module utils/cli-helpers
 */

/**
 * Sleep for a specified duration
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clear the terminal screen and move cursor to top
 */
export function clearScreen(): void {
    process.stdout.write("\x1b[2J\x1b[H");
}

/**
 * Parse a timer value (string or number) and returns interval in milliseconds
 * Returns null if timer is disabled (0 or non-numeric string)
 *
 * @param timer - Timer value in seconds (number or string) or undefined
 * @returns Milliseconds or null if disabled
 */
export function parseTimerValue(timer?: string | number): number | null {
    if (timer === undefined) return 10000; // Default 10 seconds

    const numValue = typeof timer === "string" ? parseFloat(timer) : timer;

    // If NaN or 0, disable timer
    if (isNaN(numValue) || numValue === 0) {
        return null;
    }

    // Return milliseconds
    return numValue * 1000;
}
