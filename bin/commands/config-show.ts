#!/usr/bin/env node
/**
 * Config Show Command
 *
 * Outputs the complete configuration for a profile as JSON.
 * This is used by Python code to avoid config logic duplication.
 */

import { XDGConfig } from "../../lib/xdg-config";

interface ConfigShowOptions {
    profile?: string;
    json?: boolean;
}

export async function configShowCommand(options: ConfigShowOptions): Promise<void> {
    const profile = options.profile || "default";

    const xdg = new XDGConfig();

    // Check if profile exists
    if (!xdg.profileExists(profile)) {
        throw new Error(`Profile does not exist: ${profile}`);
    }

    // Read the profile configuration
    const config = xdg.readProfile(profile);

    // Always output as JSON (for Python consumption)
    console.log(JSON.stringify(config, null, 2));
}
