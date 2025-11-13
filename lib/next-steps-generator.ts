/**
 * Next steps message generator
 *
 * Generates context-appropriate command suggestions after setup completion.
 * In Phase 1, assumes repository context. Phase 2 will add context detection.
 *
 * @module lib/next-steps-generator
 */

import { NextStepsOptions } from './types/next-steps';

/**
 * Generate next steps message after setup completion
 *
 * Produces context-appropriate command suggestions based on the
 * deployment profile. In Phase 1, assumes repository context.
 *
 * @param options - Configuration for next steps generation
 * @param options.profile - Deployment profile name (default, dev, prod, or custom)
 * @param options.stage - Deployment stage (optional)
 * @param options.context - Execution context (optional, for future use)
 * @returns Formatted next steps message with commands
 *
 * @example
 * ```typescript
 * const steps = generateNextSteps({ profile: 'default' });
 * console.log(steps);
 * // Output:
 * // Next steps:
 * //   1. Deploy to AWS: npm run deploy
 * //   2. Test integration: npm run test
 * ```
 */
export function generateNextSteps(options: NextStepsOptions): string {
  const { profile = 'default' } = options;
  const lines: string[] = [];

  lines.push('Next steps:');

  if (profile === 'default') {
    lines.push('  1. Deploy to AWS: npm run deploy');
    lines.push('  2. Test integration: npm run test');
  } else if (profile === 'dev') {
    lines.push('  1. Deploy to AWS: npm run deploy:dev');
    lines.push('  2. Test integration: npm run test:dev');
  } else if (profile === 'prod') {
    lines.push('  1. Deploy to AWS: npm run deploy:prod');
    lines.push('  2. Test integration: npm run test:prod');
  } else {
    // Custom profile
    lines.push(`  1. Deploy to AWS: ${formatDeployCommand(profile)}`);
    lines.push(`  2. Check logs: ${formatTestCommand(profile)}`);
  }

  return lines.join('\n');
}

/**
 * Format deploy command for given profile
 *
 * @param profile - Profile name
 * @returns Formatted deploy command
 */
function formatDeployCommand(profile: string): string {
  if (profile === 'default') return 'npm run deploy';
  if (profile === 'dev') return 'npm run deploy:dev';
  if (profile === 'prod') return 'npm run deploy:prod';
  return `npm run deploy -- --profile ${profile} --stage ${profile}`;
}

/**
 * Format test/logs command for given profile
 *
 * @param profile - Profile name
 * @returns Formatted test or logs command
 */
function formatTestCommand(profile: string): string {
  if (profile === 'default') return 'npm run test';
  if (profile === 'dev') return 'npm run test:dev';
  if (profile === 'prod') return 'npm run test:prod';
  return `npx ts-node scripts/check-logs.ts --profile ${profile}`;
}
