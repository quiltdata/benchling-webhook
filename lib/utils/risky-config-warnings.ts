import chalk from "chalk";

/**
 * Configuration choices that are allowed but widen who can see or do what through the
 * integration. Setup, secret and validation commands print these loudly whenever such a
 * choice is made or found, so the administrator makes it knowingly.
 */
export interface RiskyConfigInput {
    /** Package bucket; empty or undefined means bucketless mode. */
    bucket?: string | null;
    /** Webhook signature verification; only an explicit false (or "false"/"0") counts as off. */
    enableVerification?: boolean | string | null;
}

export const BUCKETLESS_WARNING = [
    "NO PACKAGE BUCKET (bucketless mode)",
    "Without a package bucket, any Benchling user who can open an entry can browse",
    "linked packages in every bucket this stack can read, whether or not they have",
    "Quilt access to those buckets.",
    "Set a package bucket unless that is intended.",
];

export const VERIFICATION_OFF_WARNING = [
    "WEBHOOK SIGNATURE VERIFICATION IS OFF",
    "Anyone who can reach the webhook endpoint can send events that package entries",
    "and change canvases, without a valid Benchling signature.",
    "Turn verification back on unless that is intended.",
];

export function isVerificationOff(value: RiskyConfigInput["enableVerification"]): boolean {
    if (value === false) {
        return true;
    }
    if (typeof value === "string") {
        return ["false", "0"].includes(value.trim().toLowerCase());
    }
    return false;
}

/** The warnings that apply, each as lines (first line is the headline). */
export function riskyConfigWarnings(input: RiskyConfigInput): string[][] {
    const warnings: string[][] = [];
    if (!input.bucket || !String(input.bucket).trim()) {
        warnings.push(BUCKETLESS_WARNING);
    }
    if (isVerificationOff(input.enableVerification)) {
        warnings.push(VERIFICATION_OFF_WARNING);
    }
    return warnings;
}

/** Render one warning as a boxed block. */
export function formatRiskyConfigWarning(lines: string[]): string {
    const width = Math.max(...lines.map((line) => line.length)) + 4;
    const rule = "!".repeat(width + 2);
    const body = lines.map((line, i) => {
        const text = `!  ${line.padEnd(width - 2)}!`;
        return i === 0 ? chalk.red(chalk.bold(text)) : chalk.red(text);
    });
    return ["", chalk.red(rule), ...body, chalk.red(rule), ""].join("\n");
}

/** Print every applicable warning to stderr; returns how many were printed. */
export function printRiskyConfigWarnings(
    input: RiskyConfigInput,
    write: (message: string) => void = (message) => console.warn(message),
): number {
    const warnings = riskyConfigWarnings(input);
    for (const lines of warnings) {
        write(formatRiskyConfigWarning(lines));
    }
    return warnings.length;
}
