/**
 * Type definitions for next steps generation
 *
 * @module types/next-steps
 */

/**
 * Execution context for command suggestions
 *
 * Determines whether to show npm script commands (repository context)
 * or npx commands (package user context).
 */
export interface ExecutionContext {
  /**
   * True if running in repository (has matching package.json with source files)
   */
  isRepository: boolean;

  /**
   * True if running via npx (installed as package)
   */
  isNpx: boolean;

  /**
   * Package name for npx commands
   * @example "@quiltdata/benchling-webhook"
   */
  packageName: string;

  /**
   * Available npm scripts (if repository context)
   * @example ["deploy", "deploy:dev", "deploy:prod", "test", "test:dev"]
   */
  availableScripts: string[];
}

/**
 * Deployment result information
 *
 * Contains outputs from a deployment operation for display in next steps.
 */
export interface DeploymentResult {
  /**
   * Whether deployment succeeded
   */
  success: boolean;

  /**
   * Webhook URL (if deployment succeeded)
   * @example "https://abc123.execute-api.us-east-1.amazonaws.com/prod/webhook"
   */
  webhookUrl?: string;

  /**
   * CloudFormation stack ARN
   * @example "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhook/abc123"
   */
  stackArn?: string;

  /**
   * AWS region where deployed
   * @example "us-east-1"
   */
  region?: string;

  /**
   * Error message (if deployment failed)
   */
  error?: string;
}

/**
 * Options for generating next steps message
 */
export interface NextStepsOptions {
  /**
   * Profile name (default, dev, prod, or custom)
   */
  profile: string;

  /**
   * Deployment stage (dev or prod)
   * @default Inferred from profile
   */
  stage?: string;

  /**
   * Execution context (optional in Phase 1, required in Phase 2)
   *
   * If not provided, defaults to repository context for backward compatibility.
   */
  context?: ExecutionContext;

  /**
   * Deployment result (optional, for Phase 3)
   *
   * If provided, next steps will include deployment-specific information.
   */
  deployment?: DeploymentResult;

  /**
   * Whether deployment was skipped
   * @default false
   */
  skipDeployment?: boolean;
}
