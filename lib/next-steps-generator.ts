/**
 * Next steps message generator
 *
 * Generates context-appropriate command suggestions after setup completion.
 * Supports both repository context (npm scripts) and npx context.
 *
 * @module lib/next-steps-generator
 */

import { NextStepsOptions } from "./types/next-steps";
import { detectExecutionContext } from "./context-detector";

/**
 * Generate next steps message after setup completion
 *
 * Produces context-appropriate command suggestions based on the
 * deployment profile and execution context. Commands are formatted
 * differently for repository context (npm scripts) vs npx context.
 *
 * @param options - Configuration for next steps generation
 * @param options.profile - Deployment profile name (default, dev, prod, or custom)
 * @param options.stage - Deployment stage (optional)
 * @param options.context - Execution context (optional, auto-detected if not provided)
 * @returns Formatted next steps message with commands
 *
 * @example
 * ```typescript
 * // Repository context (npm scripts)
 * const steps = generateNextSteps({ profile: 'default' });
 * console.log(steps);
 * // Output:
 * // Next steps:
 * //   1. Deploy to AWS: npm run deploy
 * //   2. Test integration: npm run test
 *
 * // NPX context
 * const context = { isRepository: false, isNpx: true, packageName: '@quiltdata/benchling-webhook', availableScripts: [] };
 * const steps = generateNextSteps({ profile: 'default', context });
 * // Output:
 * // Next steps:
 * //   1. Deploy to AWS: npx @quiltdata/benchling-webhook deploy
 * //   2. Test integration: npx @quiltdata/benchling-webhook test
 * ```
 */
export function generateNextSteps(options: NextStepsOptions): string {
    const { profile = "default", context } = options;

    // Auto-detect context if not provided (backward compatibility)
    const execContext = context || detectExecutionContext();

    const lines: string[] = [];

    lines.push("Next steps:");

    if (profile === "default") {
        lines.push(`  1. Deploy to AWS: ${formatDeployCommand("default", execContext)}`);
        lines.push(`  2. Test integration: ${formatTestCommand("default", execContext)}`);
    } else if (profile === "dev") {
        lines.push(`  1. Deploy to AWS: ${formatDeployCommand("dev", execContext)}`);
        lines.push(`  2. Test integration: ${formatTestCommand("dev", execContext)}`);
    } else if (profile === "prod") {
        lines.push(`  1. Deploy to AWS: ${formatDeployCommand("prod", execContext)}`);
        lines.push(`  2. Test integration: ${formatTestCommand("prod", execContext)}`);
    } else {
        // Custom profile
        lines.push(`  1. Deploy to AWS: ${formatDeployCommand(profile, execContext)}`);
        lines.push(`  2. Check logs: ${formatTestCommand(profile, execContext)}`);
    }

    return lines.join("\n");
}

/**
 * Format deploy command for given profile and context
 *
 * @param profile - Profile name
 * @param context - Execution context
 * @returns Formatted deploy command
 */
function formatDeployCommand(profile: string, context: { isRepository: boolean; packageName: string }): string {
    if (context.isRepository) {
        // Repository context - use npm scripts
        if (profile === "default") return "npm run deploy";
        if (profile === "dev") return "npm run deploy:dev";
        if (profile === "prod") return "npm run deploy:prod";
        return `npm run deploy -- --profile ${profile} --stage ${profile}`;
    } else {
        // NPX context - use npx commands
        if (profile === "default") return `npx ${context.packageName} deploy`;
        if (profile === "dev") return `npx ${context.packageName} deploy --profile ${profile} --stage dev`;
        if (profile === "prod") return `npx ${context.packageName} deploy --profile ${profile} --stage prod`;
        return `npx ${context.packageName} deploy --profile ${profile} --stage ${profile}`;
    }
}

/**
 * Format test/logs command for given profile and context
 *
 * @param profile - Profile name
 * @param context - Execution context
 * @returns Formatted test or logs command
 */
function formatTestCommand(profile: string, context: { isRepository: boolean; packageName: string }): string {
    if (context.isRepository) {
        // Repository context - use npm scripts
        if (profile === "default") return "npm run test";
        if (profile === "dev") return "npm run test:dev";
        if (profile === "prod") return "npm run test:prod";
        return `npx ts-node scripts/check-logs.ts --profile ${profile}`;
    } else {
        // NPX context - use npx commands
        if (profile === "default") return `npx ${context.packageName} test`;
        if (profile === "dev") return `npx ${context.packageName} test --profile ${profile}`;
        if (profile === "prod") return `npx ${context.packageName} test --profile ${profile}`;
        return `npx ${context.packageName} logs --profile ${profile}`;
    }
}
