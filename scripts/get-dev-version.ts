#!/usr/bin/env node

/**
 * Get the most recent dev version tag (without 'v' prefix)
 *
 * Usage:
 *   node scripts/get-dev-version.ts
 *
 * Returns the most recent dev tag in format: 0.7.2-20251106T010445Z
 * Dev tags match pattern: v{version}-{timestamp}Z where timestamp is YYYYMMDDTHHMMSS
 *
 * Exit codes:
 *   0 - Success, prints version to stdout
 *   1 - No dev tags found
 */

import { execSync } from "child_process";

function getLatestDevVersion(): string | null {
    try {
        // Get all tags matching dev pattern: v{version}-{timestamp}Z
        // Pattern: v0.7.2-20251106T010445Z
        const tags = execSync("git tag --list", { encoding: "utf8" })
            .trim()
            .split("\n")
            .filter(tag => /^v\d+\.\d+\.\d+-\d{8}T\d{6}Z$/.test(tag));

        if (tags.length === 0) {
            return null;
        }

        // Sort by timestamp (newest first)
        // Extract timestamp from tag for sorting
        tags.sort((a, b) => {
            const timestampA = a.match(/(\d{8}T\d{6}Z)$/)?.[1] || "";
            const timestampB = b.match(/(\d{8}T\d{6}Z)$/)?.[1] || "";
            return timestampB.localeCompare(timestampA);
        });

        // Return latest tag without 'v' prefix
        return tags[0].substring(1);
    } catch {
        return null;
    }
}

function main(): void {
    const version = getLatestDevVersion();

    if (!version) {
        console.error("❌ No dev tags found");
        console.error("   Dev tags should match pattern: v{version}-{timestamp}Z");
        console.error("   Example: v0.7.2-20251106T010445Z");
        console.error("");
        console.error("   Create a dev tag with: npm run version:tag:dev");
        process.exit(1);
    }

    // Output just the version (without 'v' prefix)
    console.log(version);
}

main();
