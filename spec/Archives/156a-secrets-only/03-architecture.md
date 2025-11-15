# Architecture - Secrets-Only Design

**Spec**: 156a-secrets-only
**Date**: 2025-10-31

## Overview

This document defines the detailed architecture for the secrets-only configuration approach, where the container accepts ONLY two environment variables and derives all other configuration from AWS services.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Container Startup                                          │
│                                                             │
│  Environment Variables:                                     │
│    • QuiltStackARN                                          │
│    • BenchlingSecret                                        │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌────────────────────────────────────────────────────────────┐
│  Configuration Resolver (New)                              │
│                                                            │
│  1. Parse QuiltStackARN                                    │
│     └─> Extract: region, account, stack_name              │
│                                                            │
│  2. Query CloudFormation                                   │
│     └─> Get stack outputs:                                │
│         • UserAthenaDatabaseName → quilt_database         │
│         • PackagerQueueArn → queue_arn                    │
│         • UserBucket → quilt_user_bucket                  │
│         • Catalog → quilt_catalog (or fetch config.json)  │
│                                                            │
│  3. Query Secrets Manager                                  │
│     └─> Get secret (BenchlingSecret):                     │
│         • client_id                                        │
│         • client_secret                                    │
│         • tenant                                           │
│         • app_definition_id (optional)                    │
│                                                            │
│  4. Build Complete Config Object                           │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ↓
┌────────────────────────────────────────────────────────────┐
│  Application Startup                                        │
│    • Initialize Benchling client                           │
│    • Initialize Quilt client                               │
│    • Connect to SQS queue                                  │
│    • Start webhook server                                  │
└────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Configuration Resolver

**File**: `lib/utils/config-resolver.ts` (new)

**Responsibilities**:
- Parse CloudFormation stack ARN
- Query CloudFormation for stack outputs
- Query Secrets Manager for Benchling credentials
- Assemble complete configuration object
- Cache results for container lifetime
- Provide detailed error messages for missing/invalid config

**Interface**:
```typescript
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

export interface ConfigResolverOptions {
  quiltStackArn: string;
  benchlingSecret: string;
  // Optional overrides for testing
  mockCloudFormation?: CloudFormationClient;
  mockSecretsManager?: SecretsManagerClient;
}

export class ConfigResolver {
  /**
   * Resolve complete configuration from AWS sources
   */
  async resolve(options: ConfigResolverOptions): Promise<ResolvedConfig>

  /**
   * Parse CloudFormation stack ARN
   */
  private parseStackArn(arn: string): {
    region: string;
    account: string;
    stackName: string;
  }

  /**
   * Query CloudFormation for stack outputs
   */
  private async getStackOutputs(
    region: string,
    stackName: string
  ): Promise<Record<string, string>>

  /**
   * Query Secrets Manager for secret value
   */
  private async getSecret(
    region: string,
    secretName: string
  ): Promise<BenchlingSecretData>

  /**
   * Assemble final configuration from all sources
   */
  private assembleConfig(
    stackArn: ParsedStackArn,
    stackOutputs: Record<string, string>,
    secretData: BenchlingSecretData
  ): ResolvedConfig
}
```

### 2. Stack ARN Parser

**Responsibilities**:
- Validate CloudFormation ARN format
- Extract region, account, and stack name
- Provide clear error messages for invalid ARNs

**Implementation**:
```typescript
export interface ParsedStackArn {
  region: string;
  account: string;
  stackName: string;
  stackId: string; // full UUID part
}

/**
 * Parse CloudFormation stack ARN
 *
 * Format: arn:aws:cloudformation:{region}:{account}:stack/{name}/{uuid}
 *
 * @throws ConfigResolverError if ARN is invalid
 */
export function parseStackArn(arn: string): ParsedStackArn {
  const pattern = /^arn:aws:cloudformation:([a-z0-9-]+):(\d{12}):stack\/([^\/]+)\/(.+)$/;
  const match = arn.match(pattern);

  if (!match) {
    throw new ConfigResolverError(
      'Invalid CloudFormation stack ARN format',
      'ARN must match: arn:aws:cloudformation:region:account:stack/name/id',
      `Received: ${arn}`
    );
  }

  const [, region, account, stackName, stackId] = match;

  return {
    region,
    account,
    stackName,
    stackId
  };
}
```

### 3. CloudFormation Output Extractor

**Responsibilities**:
- Query CloudFormation API for stack outputs
- Map output keys to configuration properties
- Handle missing outputs gracefully
- Provide suggestions for missing outputs

**Implementation**:
```typescript
export interface StackOutputMapping {
  // Required outputs
  database: string;      // UserAthenaDatabaseName
  queueArn: string;      // PackagerQueueArn
  userBucket: string;    // UserBucket or BucketName

  // Optional outputs
  catalog?: string;      // Catalog or CatalogDomain
  apiGateway?: string;   // ApiGatewayEndpoint (for fetching config.json)
}

/**
 * Extract and map CloudFormation stack outputs
 */
export async function extractStackOutputs(
  client: CloudFormationClient,
  stackName: string
): Promise<StackOutputMapping> {
  const command = new DescribeStacksCommand({ StackName: stackName });
  const response = await client.send(command);

  const stack = response.Stacks?.[0];
  if (!stack) {
    throw new ConfigResolverError(
      `Stack not found: ${stackName}`,
      'Ensure the CloudFormation stack exists and is accessible'
    );
  }

  const outputs = stack.Outputs || [];
  const outputMap = Object.fromEntries(
    outputs.map(o => [o.OutputKey!, o.OutputValue!])
  );

  // Extract required outputs
  const database = outputMap['UserAthenaDatabaseName'];
  const queueArn = outputMap['PackagerQueueArn'];
  const userBucket = outputMap['UserBucket'] || outputMap['BucketName'];

  // Validate required outputs
  const missing: string[] = [];
  if (!database) missing.push('UserAthenaDatabaseName');
  if (!queueArn) missing.push('PackagerQueueArn');
  if (!userBucket) missing.push('UserBucket or BucketName');

  if (missing.length > 0) {
    throw new ConfigResolverError(
      `Missing required CloudFormation outputs: ${missing.join(', ')}`,
      'Ensure your Quilt stack exports these outputs',
      `Available outputs: ${Object.keys(outputMap).join(', ')}`
    );
  }

  return {
    database,
    queueArn,
    userBucket,
    catalog: outputMap['Catalog'] || outputMap['CatalogDomain'],
    apiGateway: outputMap['ApiGatewayEndpoint']
  };
}
```

### 4. Catalog URL Resolver

**Responsibilities**:
- Determine catalog URL from stack outputs or config.json
- Fetch config.json if needed
- Extract catalog domain

**Implementation**:
```typescript
/**
 * Resolve catalog URL from stack outputs or API Gateway config
 */
export async function resolveCatalogUrl(
  outputs: StackOutputMapping
): Promise<string> {
  // Option 1: Direct from output
  if (outputs.catalog) {
    return normalizeCatalogUrl(outputs.catalog);
  }

  // Option 2: Fetch from API Gateway config.json
  if (outputs.apiGateway) {
    const configUrl = `${outputs.apiGateway}/config.json`;
    const config = await fetchJson(configUrl);
    // config.json doesn't have catalog URL directly, so construct from API Gateway
    const url = new URL(outputs.apiGateway);
    return url.hostname;
  }

  // Option 3: Fail
  throw new ConfigResolverError(
    'Cannot determine catalog URL',
    'Stack must export either "Catalog" or "ApiGatewayEndpoint"'
  );
}

/**
 * Normalize catalog URL to hostname only
 */
function normalizeCatalogUrl(url: string): string {
  // Remove protocol if present
  const withoutProtocol = url.replace(/^https?:\/\//, '');
  // Remove trailing slash
  return withoutProtocol.replace(/\/$/, '');
}
```

### 5. Secrets Manager Integration

**Responsibilities**:
- Resolve secret name/ARN to full ARN
- Fetch secret value from Secrets Manager
- Parse and validate secret JSON
- Handle secret not found errors

**Implementation**:
```typescript
/**
 * Resolve secret identifier to full ARN and fetch value
 */
export async function resolveAndFetchSecret(
  client: SecretsManagerClient,
  region: string,
  secretIdentifier: string
): Promise<BenchlingSecretData> {
  // Detect if identifier is ARN or name
  const isArn = secretIdentifier.startsWith('arn:aws:secretsmanager:');

  let secretArn: string;
  if (isArn) {
    secretArn = secretIdentifier;
  } else {
    // Construct ARN from name (assumes same region as stack)
    // Note: We don't know account ID yet, so we'll let AWS SDK resolve it
    secretArn = secretIdentifier; // SDK accepts name or ARN
  }

  try {
    const command = new GetSecretValueCommand({ SecretId: secretArn });
    const response = await client.send(command);

    if (!response.SecretString) {
      throw new ConfigResolverError(
        'Secret does not contain string data',
        'Ensure secret is stored as JSON string, not binary'
      );
    }

    // Parse and validate
    const data = JSON.parse(response.SecretString);
    const validation = validateSecretData(data);

    if (!validation.valid) {
      throw new ConfigResolverError(
        'Invalid secret structure',
        validation.errors.map(e => `${e.field}: ${e.message}`).join('; ')
      );
    }

    return data as BenchlingSecretData;
  } catch (error) {
    if (error instanceof ConfigResolverError) {
      throw error;
    }

    // Wrap AWS SDK errors
    const awsError = error as any;
    if (awsError.name === 'ResourceNotFoundException') {
      throw new ConfigResolverError(
        `Secret not found: ${secretIdentifier}`,
        'Ensure the secret exists in AWS Secrets Manager and is accessible',
        `Region: ${region}`
      );
    }

    if (awsError.name === 'AccessDeniedException') {
      throw new ConfigResolverError(
        `Access denied to secret: ${secretIdentifier}`,
        'Ensure the IAM role has secretsmanager:GetSecretValue permission',
        `Region: ${region}`
      );
    }

    throw new ConfigResolverError(
      `Failed to fetch secret: ${awsError.message}`,
      'Check AWS credentials and permissions'
    );
  }
}
```

### 6. Error Handling

**Custom Error Class**:
```typescript
export class ConfigResolverError extends Error {
  constructor(
    message: string,
    public readonly suggestion?: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'ConfigResolverError';
  }

  /**
   * Format error for CLI/logs
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
```

## Configuration Loading Flow

### 1. Container Startup Sequence

```typescript
// In main application entry point
async function main() {
  try {
    // Step 1: Read environment variables
    const quiltStackArn = process.env.QuiltStackARN;
    const benchlingSecret = process.env.BenchlingSecret;

    if (!quiltStackArn || !benchlingSecret) {
      throw new ConfigResolverError(
        'Missing required environment variables',
        'Set QuiltStackARN and BenchlingSecret',
        'Example:\n' +
        '  QuiltStackARN=arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/abc\n' +
        '  BenchlingSecret=my-benchling-creds'
      );
    }

    // Step 2: Resolve configuration
    console.log('Resolving configuration from AWS...');
    const resolver = new ConfigResolver();
    const config = await resolver.resolve({
      quiltStackArn,
      benchlingSecret
    });

    console.log('✓ Configuration resolved successfully');
    console.log(`  Region: ${config.awsRegion}`);
    console.log(`  Catalog: ${config.quiltCatalog}`);
    console.log(`  Database: ${config.quiltDatabase}`);

    // Step 3: Initialize application with resolved config
    await startApplication(config);
  } catch (error) {
    if (error instanceof ConfigResolverError) {
      console.error(error.format());
    } else {
      console.error('Unexpected error:', error);
    }
    process.exit(1);
  }
}
```

### 2. Caching Strategy

Configuration should be resolved once at startup and cached:

```typescript
export class ConfigResolver {
  private cache: ResolvedConfig | null = null;

  async resolve(options: ConfigResolverOptions): Promise<ResolvedConfig> {
    // Return cached config if available
    if (this.cache) {
      return this.cache;
    }

    // Resolve from AWS
    const config = await this.resolveFromAWS(options);

    // Cache for container lifetime
    this.cache = config;

    return config;
  }

  /**
   * Clear cache (for testing only)
   */
  clearCache(): void {
    this.cache = null;
  }
}
```

### 3. Backward Compatibility for Local Testing

For local mock testing (without Docker), we maintain backward compatibility:

```typescript
export function loadConfigForTesting(): Partial<ResolvedConfig> {
  // For mock tests, allow direct environment variables
  if (process.env.NODE_ENV === 'test') {
    return {
      awsRegion: process.env.AWS_REGION || 'us-east-1',
      awsAccount: process.env.CDK_DEFAULT_ACCOUNT || '123456789012',
      quiltCatalog: process.env.QUILT_CATALOG || 'test.catalog.com',
      quiltDatabase: process.env.QUILT_DATABASE || 'test_db',
      quiltUserBucket: process.env.QUILT_USER_BUCKET || 'test-bucket',
      queueArn: process.env.QUEUE_ARN || 'J3456789012:test-queue',
      benchlingTenant: process.env.BENCHLING_TENANT || 'test',
      benchlingClientId: process.env.BENCHLING_CLIENT_ID || 'test-id',
      benchlingClientSecret: process.env.BENCHLING_CLIENT_SECRET || 'test-secret',
      benchlingAppDefinitionId: process.env.BENCHLING_APP_DEFINITION_ID
    };
  }

  throw new Error('loadConfigForTesting() should only be used in test environment');
}
```

## CDK Stack Changes

### CloudFormation Parameters

**Old** (156-secrets-manager):
```typescript
const benchlingTenant = new CfnParameter(this, 'BenchlingTenant', { ... });
const benchlingClientId = new CfnParameter(this, 'BenchlingClientId', { ... });
const benchlingClientSecret = new CfnParameter(this, 'BenchlingClientSecret', { ... });
const quiltCatalog = new CfnParameter(this, 'QuiltCatalog', { ... });
const quiltDatabase = new CfnParameter(this, 'QuiltDatabase', { ... });
// ... many more
```

**New** (156a-secrets-only):
```typescript
const quiltStackArn = new CfnParameter(this, 'QuiltStackARN', {
  type: 'String',
  description: 'ARN of the Quilt CloudFormation stack',
  allowedPattern: 'arn:aws:cloudformation:[a-z0-9-]+:\\d{12}:stack/.+',
  constraintDescription: 'Must be a valid CloudFormation stack ARN'
});

const benchlingSecret = new CfnParameter(this, 'BenchlingSecret', {
  type: 'String',
  description: 'Name or ARN of Secrets Manager secret containing Benchling credentials'
});
```

### ECS Task Definition

**Old**:
```typescript
taskDefinition.addContainer('webhook', {
  environment: {
    QUILT_CATALOG: quiltCatalog.valueAsString,
    QUILT_DATABASE: quiltDatabase.valueAsString,
    QUILT_USER_BUCKET: quiltUserBucket.valueAsString,
    QUEUE_ARN: queueArn.valueAsString,
    BENCHLING_TENANT: benchlingTenant.valueAsString,
    // ... many more
  }
});
```

**New**:
```typescript
taskDefinition.addContainer('webhook', {
  environment: {
    QuiltStackARN: quiltStackArn.valueAsString,
    BenchlingSecret: benchlingSecret.valueAsString
  }
});
```

### IAM Permissions

**New Permissions Required**:
```typescript
// Add CloudFormation read permission
taskRole.addToPolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    'cloudformation:DescribeStacks',
    'cloudformation:DescribeStackResources'
  ],
  resources: [quiltStackArn.valueAsString]
}));

// Add Secrets Manager read permission
taskRole.addToPolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    'secretsmanager:GetSecretValue',
    'secretsmanager:DescribeSecret'
  ],
  resources: [
    // Allow access to secret by name or ARN
    `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${benchlingSecret.valueAsString}*`
  ]
}));
```

## Health Check Endpoint

Add a `/config` endpoint to display resolved configuration (with secrets masked):

```typescript
app.get('/config', (req, res) => {
  res.json({
    aws: {
      region: config.awsRegion,
      account: `***${config.awsAccount.slice(-4)}`
    },
    quilt: {
      catalog: config.quiltCatalog,
      database: config.quiltDatabase,
      bucket: config.quiltUserBucket,
      queueArn: maskArn(config.queueArn)
    },
    benchling: {
      tenant: config.benchlingTenant,
      clientId: `***${config.benchlingClientId.slice(-4)}`,
      hasClientSecret: !!config.benchlingClientSecret,
      hasAppDefinitionId: !!config.benchlingAppDefinitionId
    }
  });
});
```

## Summary

This architecture provides:

✅ **Simplicity**: Only 2 environment variables
✅ **Single Source of Truth**: AWS CloudFormation + Secrets Manager
✅ **Testability**: Easy to mock AWS SDK clients for testing
✅ **Debuggability**: Clear error messages, health check endpoint
✅ **Security**: All secrets in Secrets Manager
✅ **Flexibility**: Can update config by updating CloudFormation or secret

Next: Define testing strategy → `04-testing-strategy.md`
