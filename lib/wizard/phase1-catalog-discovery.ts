/**
 * Phase 1: Catalog Discovery
 *
 * Detects and confirms the Quilt catalog DNS name.
 * Does NOT query AWS - only reads local quilt3 config.
 *
 * @module wizard/phase1-catalog-discovery
 */

import { execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import { CatalogDiscoveryResult } from "./types";

/**
 * Phase 1 options
 */
export interface CatalogDiscoveryOptions {
    /** Non-interactive mode (skip prompts) */
    yes?: boolean;
    /** Catalog URL provided via CLI */
    catalogUrl?: string;
    /** Existing catalog from loaded profile (takes precedence over detection) */
    existingCatalog?: string;
}

/**
 * Attempts to detect catalog from quilt3 CLI config
 *
 * @returns Catalog URL from quilt3 config, or null if not found
 */
function detectQuilt3Catalog(): string | null {
    try {
        const output = execSync("quilt3 config", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "ignore"],
        });
        const catalogUrl = output.trim();

        if (catalogUrl && catalogUrl.startsWith("http")) {
            return catalogUrl;
        }

        return null;
    } catch {
        // quilt3 command not available or failed
        return null;
    }
}

/**
 * Normalizes catalog URL to DNS format (removes protocol, trailing slash)
 *
 * @param catalogUrl - Raw catalog URL
 * @returns Normalized DNS name
 */
function normalizeCatalogDns(catalogUrl: string): string {
    return catalogUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * Validates catalog DNS format
 *
 * @param catalogDns - Catalog DNS to validate
 * @returns True if valid, error message otherwise
 */
function validateCatalogDns(catalogDns: string): boolean | string {
    const trimmed = catalogDns.trim();
    if (trimmed.length === 0) {
        return "Catalog DNS name is required";
    }

    // Basic DNS validation (allow alphanumeric, dots, hyphens)
    if (!/^[a-zA-Z0-9.-]+$/.test(trimmed)) {
        return "Invalid DNS name format";
    }

    return true;
}

/**
 * Phase 1: Catalog Discovery
 *
 * Responsibilities:
 * - Check existing config first (highest priority)
 * - Read quilt3 CLI config as fallback
 * - Ask user to confirm detected catalog
 * - If not confirmed, prompt for manual entry
 * - Return confirmed catalog DNS
 *
 * Priority order:
 * 1. CLI argument (--catalog-url)
 * 2. Existing profile config
 * 3. quilt3 CLI detection
 * 4. Manual entry prompt
 *
 * @param options - Catalog discovery options
 * @returns Catalog discovery result
 */
export async function runCatalogDiscovery(
    options: CatalogDiscoveryOptions,
): Promise<CatalogDiscoveryResult> {
    const { yes = false, catalogUrl: cliCatalogUrl, existingCatalog } = options;

    // If catalog provided via CLI, use it directly
    if (cliCatalogUrl) {
        const catalogDns = normalizeCatalogDns(cliCatalogUrl);
        console.log(chalk.blue(`Using catalog from CLI: ${catalogDns}\n`));
        return {
            catalogDns,
            wasManuallyEntered: true,
        };
    }

    // If existing config has a catalog, prioritize it over detection
    if (existingCatalog) {
        const catalogDns = normalizeCatalogDns(existingCatalog);
        console.log(chalk.blue(`Using catalog from existing profile: ${catalogDns}\n`));

        // In --yes mode, use existing catalog automatically
        if (yes) {
            return {
                catalogDns,
                wasManuallyEntered: false,
                detectedCatalog: catalogDns,
            };
        }

        // Ask user to confirm existing catalog
        const { isCorrect } = await inquirer.prompt([
            {
                type: "confirm",
                name: "isCorrect",
                message: `Is ${catalogDns} the correct catalog?`,
                default: true,
            },
        ]);

        if (isCorrect) {
            return {
                catalogDns,
                wasManuallyEntered: false,
                detectedCatalog: catalogDns,
            };
        }

        // User declined, ask for manual entry
        const { manualCatalog } = await inquirer.prompt([
            {
                type: "input",
                name: "manualCatalog",
                message: "Enter catalog DNS name:",
                validate: validateCatalogDns,
                filter: normalizeCatalogDns,
            },
        ]);

        return {
            catalogDns: manualCatalog,
            wasManuallyEntered: true,
            detectedCatalog: catalogDns,
        };
    }

    // Try to detect catalog from quilt3 CLI
    const detectedCatalog = detectQuilt3Catalog();

    if (detectedCatalog) {
        const catalogDns = normalizeCatalogDns(detectedCatalog);
        console.log(chalk.blue(`Detected catalog: ${catalogDns}\n`));

        // In --yes mode, use detected catalog automatically
        if (yes) {
            return {
                catalogDns,
                wasManuallyEntered: false,
                detectedCatalog: catalogDns,
            };
        }

        // Ask user to confirm
        const { isCorrect } = await inquirer.prompt([
            {
                type: "confirm",
                name: "isCorrect",
                message: `Is ${catalogDns} the correct catalog?`,
                default: true,
            },
        ]);

        if (isCorrect) {
            return {
                catalogDns,
                wasManuallyEntered: false,
                detectedCatalog: catalogDns,
            };
        }

        // User declined, ask for manual entry
        const { manualCatalog } = await inquirer.prompt([
            {
                type: "input",
                name: "manualCatalog",
                message: "Enter catalog DNS name:",
                validate: validateCatalogDns,
                filter: normalizeCatalogDns,
            },
        ]);

        return {
            catalogDns: manualCatalog,
            wasManuallyEntered: true,
            detectedCatalog: catalogDns,
        };
    }

    // No catalog detected
    console.log(chalk.yellow("No quilt3 CLI configuration detected.\n"));

    if (yes) {
        throw new Error(
            "No catalog detected and --yes flag prevents interactive prompt. " +
            "Provide catalog URL via --catalog-url argument.",
        );
    }

    // Prompt for manual entry
    const { manualCatalog } = await inquirer.prompt([
        {
            type: "input",
            name: "manualCatalog",
            message: "Enter Quilt Catalog DNS name (e.g., open.quiltdata.com):",
            validate: validateCatalogDns,
            filter: normalizeCatalogDns,
        },
    ]);

    return {
        catalogDns: manualCatalog,
        wasManuallyEntered: true,
    };
}
