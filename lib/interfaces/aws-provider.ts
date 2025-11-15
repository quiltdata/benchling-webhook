/**
 * AWS Provider Interface
 *
 * Abstracts AWS operations for stack inference, allowing multiple implementations:
 * - ExecSyncAwsProvider: Uses AWS CLI via execSync (default)
 * - SdkAwsProvider: Uses @aws-sdk/client-cloudformation directly (future)
 * - MockAwsProvider: In-memory implementation for testing
 */

/**
 * CloudFormation stack details
 */
export interface StackDetails {
  outputs: Array<{ OutputKey: string; OutputValue: string }>;
  parameters: Array<{ ParameterKey: string; ParameterValue: string }>;
}

/**
 * AWS Provider Interface
 *
 * Abstracts AWS operations for stack inference
 */
export interface IAwsProvider {
  /**
   * Find CloudFormation stack by physical resource ID
   * @param region AWS region
   * @param resourceId Physical resource ID (e.g., API Gateway ID)
   * @returns Stack name if found, null otherwise
   */
  findStackByResource(region: string, resourceId: string): Promise<string | null>;

  /**
   * Get stack outputs and parameters
   * @param region AWS region
   * @param stackName CloudFormation stack name
   * @returns Stack details with outputs and parameters
   */
  getStackDetails(region: string, stackName: string): Promise<StackDetails>;

  /**
   * Get AWS account ID for current credentials
   * @returns Account ID if available, null otherwise
   */
  getAccountId(): Promise<string | null>;
}

/**
 * HTTP Client Interface
 *
 * Abstracts HTTP requests for fetching external resources.
 */
export interface IHttpClient {
  /**
   * Fetch JSON from a URL
   * @param url URL to fetch
   * @returns Parsed JSON object
   * @throws Error if request fails or response is not valid JSON
   */
  fetchJson(url: string): Promise<unknown>;
}
