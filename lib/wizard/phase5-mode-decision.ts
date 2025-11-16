/**
 * Phase 5: Mode Decision
 *
 * Determines whether to use integrated mode (existing BenchlingSecret in Quilt stack)
 * or standalone mode (create new dedicated secret).
 *
 * @module wizard/phase5-mode-decision
 */

import inquirer from "inquirer";
import chalk from "chalk";
import { ModeDecisionInput, ModeDecisionResult } from "./types";

/**
 * Prompts user whether to use existing BenchlingSecret or create a new one
 *
 * @param yes - If true, auto-confirm using existing secret
 * @returns True if user wants to use existing secret, false otherwise
 */
async function shouldUseExisting(yes: boolean): Promise<boolean> {
    if (yes) {
        return true;
    }

    const { useExisting } = await inquirer.prompt([
        {
            type: "confirm",
            name: "useExisting",
            message: "Using Webhook built into the Quilt Stack (update existing secret)?",
            default: true,
        },
    ]);

    return useExisting;
}

/**
 * Phase 5: Mode Decision
 *
 * Responsibilities:
 * - Determine if integrated mode is available (BenchlingSecret exists)
 * - Ask user to choose mode (if applicable)
 * - Return mode decision
 *
 * @param input - Mode decision input
 * @returns Mode decision result
 */
export async function runModeDecision(input: ModeDecisionInput): Promise<ModeDecisionResult> {
    const { stackQuery, yes = false } = input;

    const hasBenchlingSecret = Boolean(stackQuery.benchlingSecretArn);

    // Use integrated mode if: (1) secret exists AND (2) user confirms usage
    if (hasBenchlingSecret && (await shouldUseExisting(yes))) {
        console.log(chalk.blue("Using integrated webhook mode (built-in secret)\n"));
        return {
            mode: "integrated",
            benchlingSecretArn: stackQuery.benchlingSecretArn!,
        };
    }

    // Otherwise, use standalone mode
    console.log(chalk.blue("Using standalone webhook mode (dedicated secret)\n"));
    return {
        mode: "standalone",
    };
}