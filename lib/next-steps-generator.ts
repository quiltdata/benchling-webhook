/**
 * Next steps message generator
 *
 * Generates context-appropriate command suggestions after setup completion.
 * Supports both repository context (npm scripts) and npx context, and handles
 * deployment results for Phase 3 command chaining.
 *
 * @module lib/next-steps-generator
 */

import { NextStepsOptions } from "./types/next-steps";
import { detectExecutionContext } from "./context-detector";

/**
 * Generate next steps message after setup completion
 *
 * Produces context-appropriate command suggestions based on the
 * deployment profile, execution context, and deployment results.
 * Commands are formatted differently for repository context (npm scripts)
 * vs npx context.
 *
 * @param options - Configuration for next steps generation
 * @param options.profile - Deployment profile name (default, dev, prod, or custom)
 * @param options.stage - Deployment stage (optional)
 * @param options.context - Execution context (optional, auto-detected if not provided)
 * @param options.deployment - Deployment result (optional, for post-deploy next steps)
 * @param options.skipDeployment - Whether deployment was skipped (optional)
 * @returns Formatted next steps message with commands
 *
 * @example
 * ```typescript
 * // After setup only (no deployment)
 * const steps = generateNextSteps({ profile: 'default', skipDeployment: true });
 * console.log(steps);
 * // Output:
 * // Next steps:
 * //   1. Deploy to AWS: npm run deploy
 * //   2. Test integration: npm run test
 *
 * // After successful deployment
 * const steps = generateNextSteps({
 *     profile: 'default',
 *     deployment: {
 *         success: true,
 *         webhookUrl: 'https://example.com/webhook'
 *     }
 * });
 * // Output:
 * // Webhook URL: https://example.com/webhook
 * // Next steps:
 * //   1. Configure webhook URL in Benchling
 * //   2. Test webhook: npm run test
 * ```
 */
export function generateNextSteps(options: NextStepsOptions): string {
    const { profile = "default", deployment, skipDeployment = false, context } = options;

    // Auto-detect context if not provided (backward compatibility)
    const execContext = context || detectExecutionContext();

    const lines: string[] = [];

    // Handle deployment results (Phase 3)
    if (deployment) {
        if (deployment.success && deployment.webhookUrl) {
            // Successful deployment - show webhook URL
            lines.push("");
            lines.push(`Webhook URL: ${deployment.webhookUrl}`);
            lines.push("");
            lines.push("Next steps:");
            lines.push("  1. Configure webhook URL in Benchling app settings");
            lines.push(`  2. Test webhook: ${formatTestCommand(profile, execContext)}`);
            lines.push(`  3. Check logs: ${formatHealthCheckCommand(profile, execContext)}`);
        } else if (!deployment.success) {
            // Failed deployment - show recovery steps
            lines.push("");
            lines.push("Setup was successful, but deployment failed.");
            if (deployment.error) {
                lines.push(`Error: ${deployment.error}`);
            }
            lines.push("");
            lines.push("Next steps:");
            lines.push("  1. Fix the error above");
            lines.push(`  2. Retry deployment: ${formatDeployCommand(profile, execContext)}`);
            lines.push(`  3. Check configuration: ${formatHealthCheckCommand(profile, execContext)}`);
        }
    } else if (skipDeployment) {
        // Setup complete, deployment skipped - show deploy command
        lines.push("Next steps:");
        lines.push(`  1. Deploy to AWS: ${formatDeployCommand(profile, execContext)}`);
        lines.push(`  2. Test integration: ${formatTestCommand(profile, execContext)}`);
        lines.push(`  3. Check configuration: ${formatHealthCheckCommand(profile, execContext)}`);
    } else {
        // Default: setup complete without deployment info (backward compatibility)
        lines.push("Next steps:");
        lines.push(`  1. Deploy to AWS: ${formatDeployCommand(profile, execContext)}`);
        lines.push(`  2. Test integration: ${formatTestCommand(profile, execContext)}`);
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
        return `npx ${context.packageName} test --profile ${profile}`;
    }
}

/**
 * Format health check command for given profile and context
 *
 * @param profile - Profile name
 * @param context - Execution context
 * @returns Formatted health check command
 */
function formatHealthCheckCommand(profile: string, context: { isRepository: boolean; packageName: string }): string {
    if (context.isRepository) {
        // Repository context - use npm scripts
        if (profile === "default") return "npm run setup:health";
        return `npm run setup:health -- --profile ${profile}`;
    } else {
        // NPX context - use npx commands
        if (profile === "default") return `npx ${context.packageName} health-check`;
        return `npx ${context.packageName} health-check --profile ${profile}`;
    }
}
