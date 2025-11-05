#!/usr/bin/env node
/**
 * Interactive Configuration Wizard - CLI Entry Point
 *
 * This is the CLI entry point that delegates to the actual wizard implementation
 * in scripts/install-wizard.ts.
 *
 * Guided configuration setup with comprehensive validation:
 * - Benchling tenant and OAuth credentials
 * - S3 bucket access verification
 * - Quilt API connectivity testing
 * - AWS Secrets Manager integration
 *
 * Supports both interactive and --yes (non-interactive) modes.
 *
 * @module commands/setup-wizard
 */

import { runInstallWizard, InstallWizardOptions } from "../../scripts/install-wizard";

/**
 * Setup wizard command handler
 *
 * Delegates to the actual wizard implementation in scripts/install-wizard.ts
 *
 * @param options - Wizard options
 * @returns Promise that resolves when wizard completes
 */
export async function setupWizardCommand(options: InstallWizardOptions = {}): Promise<void> {
    await runInstallWizard(options);
}
