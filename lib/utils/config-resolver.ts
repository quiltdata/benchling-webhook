/**
 * Configuration Resolver for Secrets-Only Architecture
 *
 * This module resolves complete application configuration from just two sources:
 * 1. QuiltStackARN - CloudFormation stack ARN for Quilt infrastructure
 * 2. BenchlingSecret - AWS Secrets Manager secret containing Benchling credentials
 *
 * All other configuration is derived from these two sources by querying AWS APIs.
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  validateSecretData,
  type BenchlingSecretData,
} from "./secrets";

/**
 * Complete resolved configuration for the application
 */
export interface ResolvedConfig {
  // AWS
  awsRegion: string;
  awsAccount: string;

  // Quilt
  quiltCatalog: string;
  quiltDatabase: string;
  quiltUserBucket: string;
  queueArn: string;

  // Benchling
  benchlingTenant: string;
  benchlingClientId: string;
  benchlingClientSecret: string;
  benchlingAppDefinitionId?: string;
  benchlingApiUrl?: string;

  // Optional
  pkgPrefix?: string;
  pkgKey?: string;
  logLevel?: string;
  webhookAllowList?: string;
  enableWebhookVerification?: boolean;
}

/**
 * Options for ConfigResolver
 */
export interface ConfigResolverOptions {
  quiltStackArn: string;
  benchlingSecret: string;
  // For testing: inject mocked clients
  mockCloudFormation?: CloudFormationClient;
  mockSecretsManager?: SecretsManagerClient;
}

/**
 * Parsed CloudFormation stack ARN
 */
export interface ParsedStackArn {
  region: string;
  account: string;
  stackName: string;
  stackId: string;
}

/**
 * Custom error for configuration resolution failures
 */
export class ConfigResolverError extends Error {
  constructor(
    message: string,
    public readonly suggestion?: string,
    public readonly details?: string,
  ) {
    super(message);
    this.name = "ConfigResolverError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConfigResolverError);
    }
  }

  /**
   * Format error for CLI/logs with suggestions
   */
  format(): string {
    let output = `❌ Configuration Error: ${this.message}`;

    if (this.suggestion) {
      output += `\n   💡 ${this.suggestion}`;
    }

    if (this.details) {
      output += `\n   ℹ️  ${this.details}`;
    }

    return output;
  }
}

/**
 * Parse CloudFormation stack ARN into components
 *
 * @param arn - CloudFormation stack ARN
 * @returns Parsed ARN components
 * @throws ConfigResolverError if ARN is invalid
 *
 * @example
 * parseStackArn('arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123')
 * // Returns: { region: 'us-east-1', account: '123456789012', stackName: 'QuiltStack', stackId: 'abc-123' }
 */
export function parseStackArn(arn: string): ParsedStackArn {
  const pattern =
    /^arn:aws:cloudformation:([a-z0-9-]+):(\d{12}):stack\/([^\/]+)\/(.+)$/;
  const match = arn.match(pattern);

  if (!match) {
    throw new ConfigResolverError(
      "Invalid CloudFormation stack ARN format",
      "ARN must match: arn:aws:cloudformation:region:account:stack/name/id",
      `Received: ${arn}`,
    );
  }

  const [, region, account, stackName, stackId] = match;

  return {
    region,
    account,
    stackName,
    stackId,
  };
}

/**
 * Extract stack outputs from CloudFormation
 *
 * @param client - CloudFormation client
 * @param stackName - Name of the stack
 * @returns Map of output keys to values
 * @throws ConfigResolverError if stack not found or inaccessible
 */
export async function extractStackOutputs(
  client: CloudFormationClient,
  stackName: string,
): Promise<Record<string, string>> {
  const command = new DescribeStacksCommand({ StackName: stackName });

  try {
    const response = await client.send(command);
    const stack = response.Stacks?.[0];

    if (!stack) {
      throw new ConfigResolverError(
        `Stack not found: ${stackName}`,
        "Ensure the CloudFormation stack exists and is accessible",
      );
    }

    const outputs = stack.Outputs || [];
    return Object.fromEntries(outputs.map((o) => [o.OutputKey!, o.OutputValue!]));
  } catch (error: any) {
    if (error instanceof ConfigResolverError) {
      throw error;
    }

    if (error.name === "ValidationError") {
      throw new ConfigResolverError(
        `Invalid stack name: ${stackName}`,
        "Check that the stack name is correct",
      );
    }

    throw new ConfigResolverError(
      `Failed to describe stack: ${error.message}`,
      "Check AWS credentials and permissions",
    );
  }
}

/**
 * Fetch and validate secret from AWS Secrets Manager
 *
 * @param client - Secrets Manager client
 * @param region - AWS region
 * @param secretIdentifier - Secret name or ARN
 * @returns Validated secret data
 * @throws ConfigResolverError if secret not found or invalid
 */
export async function resolveAndFetchSecret(
  client: SecretsManagerClient,
  region: string,
  secretIdentifier: string,
): Promise<BenchlingSecretData> {
  try {
    const command = new GetSecretValueCommand({ SecretId: secretIdentifier });
    const response = await client.send(command);

    if (!response.SecretString) {
      throw new ConfigResolverError(
        "Secret does not contain string data",
        "Ensure secret is stored as JSON string, not binary",
      );
    }

    // Parse JSON
    let data: unknown;
    try {
      data = JSON.parse(response.SecretString);
    } catch (parseError) {
      throw new ConfigResolverError(
        "Secret contains invalid JSON",
        "Ensure secret value is valid JSON",
        `Parse error: ${(parseError as Error).message}`,
      );
    }

    // Validate structure
    const validation = validateSecretData(data);

    if (!validation.valid) {
      const errors = validation.errors
        .map((e) => `${e.field}: ${e.message}`)
        .join("; ");
      throw new ConfigResolverError(
        "Invalid secret structure",
        errors,
        'Expected format: {"client_id":"...","client_secret":"...","tenant":"..."}',
      );
    }

    return data as BenchlingSecretData;
  } catch (error: any) {
    if (error instanceof ConfigResolverError) {
      throw error;
    }

    if (error.name === "ResourceNotFoundException") {
      throw new ConfigResolverError(
        `Secret not found: ${secretIdentifier}`,
        "Ensure the secret exists in AWS Secrets Manager and is accessible",
        `Region: ${region}`,
      );
    }

    if (error.name === "AccessDeniedException") {
      throw new ConfigResolverError(
        `Access denied to secret: ${secretIdentifier}`,
        "Ensure the IAM role has secretsmanager:GetSecretValue permission",
        `Region: ${region}`,
      );
    }

    throw new ConfigResolverError(
      `Failed to fetch secret: ${error.message}`,
      "Check AWS credentials and permissions",
    );
  }
}

/**
 * Main configuration resolver class
 *
 * Resolves complete application configuration from CloudFormation and Secrets Manager.
 * Implements caching to avoid repeated AWS API calls.
 */
export class ConfigResolver {
  private cache: ResolvedConfig | null = null;

  /**
   * Resolve complete configuration from AWS
   *
   * @param options - Configuration resolver options
   * @returns Complete resolved configuration
   * @throws ConfigResolverError if resolution fails
   */
  async resolve(options: ConfigResolverOptions): Promise<ResolvedConfig> {
    // Return cached config if available
    if (this.cache) {
      return this.cache;
    }

    // Step 1: Parse stack ARN
    const parsed = parseStackArn(options.quiltStackArn);

    // Step 2: Create AWS clients (or use mocks for testing)
    const cfnClient =
      options.mockCloudFormation ||
      new CloudFormationClient({ region: parsed.region });

    const smClient =
      options.mockSecretsManager ||
      new SecretsManagerClient({ region: parsed.region });

    // Step 3: Fetch stack outputs
    const outputs = await extractStackOutputs(cfnClient, parsed.stackName);

    // Step 4: Validate required outputs
    this.validateRequiredOutputs(outputs);

    // Step 5: Fetch Benchling secret
    const secret = await resolveAndFetchSecret(
      smClient,
      parsed.region,
      options.benchlingSecret,
    );

    // Step 6: Resolve catalog URL
    const catalog = this.resolveCatalogUrl(outputs);

    // Step 7: Assemble complete configuration
    const config: ResolvedConfig = {
      // AWS
      awsRegion: parsed.region,
      awsAccount: parsed.account,

      // Quilt
      quiltCatalog: catalog,
      quiltDatabase: outputs.UserAthenaDatabaseName,
      quiltUserBucket: outputs.UserBucket || outputs.BucketName,
      queueArn: outputs.PackagerQueueArn,

      // Benchling
      benchlingTenant: secret.tenant,
      benchlingClientId: secret.client_id,
      benchlingClientSecret: secret.client_secret,
      benchlingAppDefinitionId: secret.app_definition_id,
      benchlingApiUrl: secret.api_url,

      // Optional defaults
      pkgPrefix: "benchling",
      pkgKey: "experiment_id",
      logLevel: "INFO",
      enableWebhookVerification: true,
    };

    // Cache for container lifetime
    this.cache = config;

    return config;
  }

  /**
   * Validate that required CloudFormation outputs are present
   *
   * @param outputs - Stack outputs
   * @throws ConfigResolverError if required outputs are missing
   */
  private validateRequiredOutputs(outputs: Record<string, string>): void {
    const required = ["UserAthenaDatabaseName", "PackagerQueueArn"];

    // UserBucket or BucketName (at least one required)
    if (!outputs.UserBucket && !outputs.BucketName) {
      required.push("UserBucket or BucketName");
    }

    const missing = required.filter((key) => !outputs[key]);

    if (missing.length > 0) {
      throw new ConfigResolverError(
        `Missing required CloudFormation outputs: ${missing.join(", ")}`,
        "Ensure your Quilt stack exports these outputs",
        `Available outputs: ${Object.keys(outputs).join(", ")}`,
      );
    }
  }

  /**
   * Resolve catalog URL from stack outputs
   *
   * @param outputs - Stack outputs
   * @returns Normalized catalog URL (hostname only)
   * @throws ConfigResolverError if catalog URL cannot be determined
   */
  private resolveCatalogUrl(outputs: Record<string, string>): string {
    // Option 1: Direct from Catalog or CatalogDomain output
    if (outputs.Catalog) {
      return this.normalizeCatalogUrl(outputs.Catalog);
    }

    if (outputs.CatalogDomain) {
      return this.normalizeCatalogUrl(outputs.CatalogDomain);
    }

    // Option 2: Extract from API Gateway endpoint
    if (outputs.ApiGatewayEndpoint) {
      try {
        const url = new URL(outputs.ApiGatewayEndpoint);
        return url.hostname;
      } catch {
        // Invalid URL, fall through to error
      }
    }

    throw new ConfigResolverError(
      "Cannot determine catalog URL",
      'Stack must export "Catalog", "CatalogDomain", or "ApiGatewayEndpoint"',
    );
  }

  /**
   * Normalize catalog URL to hostname only (remove protocol and trailing slash)
   *
   * @param url - Catalog URL
   * @returns Normalized hostname
   */
  private normalizeCatalogUrl(url: string): string {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  /**
   * Clear cached configuration (for testing only)
   */
  clearCache(): void {
    this.cache = null;
  }
}
