/**
 * Benchling-specific normalization helpers.
 */

/**
 * Normalize Benchling tenant input to the bare tenant slug.
 *
 * Accepts:
 * - acme
 * - acme.benchling.com
 * - https://acme.benchling.com
 */
export function normalizeBenchlingTenant(value: string): string {
    let normalized = value.trim();

    if (!normalized) {
        return "";
    }

    if (/^https?:\/\//i.test(normalized)) {
        try {
            normalized = new URL(normalized).hostname;
        } catch {
            normalized = normalized.replace(/^https?:\/\//i, "");
        }
    }

    normalized = normalized
        .replace(/^https?:\/\//i, "")
        .split("/")[0]
        .replace(/\.+$/, "")
        .trim();

    const benchlingSuffix = ".benchling.com";
    if (normalized.toLowerCase().endsWith(benchlingSuffix)) {
        normalized = normalized.slice(0, -benchlingSuffix.length);
    }

    return normalized;
}
