# Implementation Plan - Secrets-Only Architecture

**Spec**: 156a-secrets-only
**Date**: 2025-10-31

## Overview

This document provides a step-by-step implementation plan for the secrets-only architecture. Each step is actionable and can be tested independently.

## Implementation Phases

### Phase 1: Core Configuration Resolver

**Goal**: Create the new `ConfigResolver` class that resolves configuration from AWS

**Files to Create**:
- `lib/utils/config-resolver.ts`
- `lib/utils/config-resolver.test.ts`

**Steps**:

#### Step 1.1: Create ConfigResolver Types and Interfaces

```typescript
// lib/utils/config-resolver.ts

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
  mockCloudFormation?: CloudFormationClient;
  mockSecretsManager?: SecretsManagerClient;
}

export interface ParsedStackArn {
  region: string;
  account: string;
  stackName: string;
  stackId: string;
}

export class ConfigResolverError extends Error {
  constructor(
    message: string,
    public readonly suggestion?: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'ConfigResolverError';
  }

  format(): string {
    let output = `❌ Configuration Error: ${this.message}`;
    if (this.suggestion) output += `\n   💡 ${this.suggestion}`;
    if (this.details) output += `\n   ℹ️  ${this.details}`;
    return output;
  }
}
```

**Test**: Type definitions compile without errors

#### Step 1.2: Implement ARN Parser

```typescript
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

**Tests**:
```typescript
describe('parseStackArn', () => {
  it('should parse valid ARN', () => {
    const result = parseStackArn(
      'arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123'
    );
    expect(result.region).toBe('us-east-1');
    expect(result.account).toBe('123456789012');
    expect(result.stackName).toBe('QuiltStack');
    expect(result.stackId).toBe('abc-123');
  });

  it('should throw on invalid ARN', () => {
    expect(() => parseStackArn('invalid')).toThrow(ConfigResolverError);
  });

  it('should throw on wrong service', () => {
    expect(() =>
      parseStackArn('arn:aws:s3:us-east-1:123456789012:bucket/mybucket')
    ).toThrow(ConfigResolverError);
  });
});
```

#### Step 1.3: Implement CloudFormation Output Extractor

```typescript
export async function extractStackOutputs(
  client: CloudFormationClient,
  stackName: string
): Promise<Record<string, string>> {
  const command = new DescribeStacksCommand({ StackName: stackName });

  try {
    const response = await client.send(command);
    const stack = response.Stacks?.[0];

    if (!stack) {
      throw new ConfigResolverError(
        `Stack not found: ${stackName}`,
        'Ensure the CloudFormation stack exists and is accessible'
      );
    }

    const outputs = stack.Outputs || [];
    return Object.fromEntries(
      outputs.map(o => [o.OutputKey!, o.OutputValue!])
    );
  } catch (error: any) {
    if (error instanceof ConfigResolverError) throw error;

    if (error.name === 'ValidationError') {
      throw new ConfigResolverError(
        `Invalid stack name: ${stackName}`,
        'Check that the stack name is correct'
      );
    }

    throw new ConfigResolverError(
      `Failed to describe stack: ${error.message}`,
      'Check AWS credentials and permissions'
    );
  }
}
```

**Tests** (with mocked AWS SDK):
```typescript
describe('extractStackOutputs', () => {
  const cfnMock = mockClient(CloudFormationClient);

  beforeEach(() => cfnMock.reset());

  it('should extract outputs', async () => {
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [{
        Outputs: [
          { OutputKey: 'Key1', OutputValue: 'Value1' },
          { OutputKey: 'Key2', OutputValue: 'Value2' }
        ]
      }]
    });

    const outputs = await extractStackOutputs(cfnMock as any, 'TestStack');
    expect(outputs).toEqual({ Key1: 'Value1', Key2: 'Value2' });
  });

  it('should throw if stack not found', async () => {
    cfnMock.on(DescribeStacksCommand).resolves({ Stacks: [] });
    await expect(extractStackOutputs(cfnMock as any, 'Missing'))
      .rejects.toThrow(ConfigResolverError);
  });
});
```

#### Step 1.4: Implement Secrets Manager Integration

```typescript
import { validateSecretData, type BenchlingSecretData } from './secrets';

export async function resolveAndFetchSecret(
  client: SecretsManagerClient,
  region: string,
  secretIdentifier: string
): Promise<BenchlingSecretData> {
  try {
    const command = new GetSecretValueCommand({ SecretId: secretIdentifier });
    const response = await client.send(command);

    if (!response.SecretString) {
      throw new ConfigResolverError(
        'Secret does not contain string data',
        'Ensure secret is stored as JSON string, not binary'
      );
    }

    const data = JSON.parse(response.SecretString);
    const validation = validateSecretData(data);

    if (!validation.valid) {
      throw new ConfigResolverError(
        'Invalid secret structure',
        validation.errors.map(e => `${e.field}: ${e.message}`).join('; ')
      );
    }

    return data as BenchlingSecretData;
  } catch (error: any) {
    if (error instanceof ConfigResolverError) throw error;

    if (error.name === 'ResourceNotFoundException') {
      throw new ConfigResolverError(
        `Secret not found: ${secretIdentifier}`,
        'Ensure the secret exists in AWS Secrets Manager',
        `Region: ${region}`
      );
    }

    if (error.name === 'AccessDeniedException') {
      throw new ConfigResolverError(
        `Access denied to secret: ${secretIdentifier}`,
        'Ensure IAM role has secretsmanager:GetSecretValue permission',
        `Region: ${region}`
      );
    }

    throw new ConfigResolverError(
      `Failed to fetch secret: ${error.message}`,
      'Check AWS credentials and permissions'
    );
  }
}
```

**Tests**:
```typescript
describe('resolveAndFetchSecret', () => {
  const smMock = mockClient(SecretsManagerClient);

  beforeEach(() => smMock.reset());

  it('should fetch and validate secret', async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        client_id: 'test-id',
        client_secret: 'test-secret',
        tenant: 'test-tenant'
      })
    });

    const secret = await resolveAndFetchSecret(
      smMock as any,
      'us-east-1',
      'test-secret'
    );

    expect(secret.client_id).toBe('test-id');
  });

  it('should throw if secret not found', async () => {
    smMock.on(GetSecretValueCommand).rejects({
      name: 'ResourceNotFoundException'
    });

    await expect(
      resolveAndFetchSecret(smMock as any, 'us-east-1', 'missing')
    ).rejects.toThrow('Secret not found');
  });
});
```

#### Step 1.5: Implement Main ConfigResolver Class

```typescript
export class ConfigResolver {
  private cache: ResolvedConfig | null = null;

  async resolve(options: ConfigResolverOptions): Promise<ResolvedConfig> {
    if (this.cache) return this.cache;

    // Step 1: Parse ARN
    const parsed = parseStackArn(options.quiltStackArn);

    // Step 2: Create AWS clients
    const cfnClient = options.mockCloudFormation ||
      new CloudFormationClient({ region: parsed.region });

    const smClient = options.mockSecretsManager ||
      new SecretsManagerClient({ region: parsed.region });

    // Step 3: Fetch stack outputs
    const outputs = await extractStackOutputs(cfnClient, parsed.stackName);

    // Step 4: Validate required outputs
    this.validateRequiredOutputs(outputs);

    // Step 5: Fetch secret
    const secret = await resolveAndFetchSecret(
      smClient,
      parsed.region,
      options.benchlingSecret
    );

    // Step 6: Resolve catalog URL
    const catalog = await this.resolveCatalogUrl(outputs);

    // Step 7: Assemble config
    const config: ResolvedConfig = {
      awsRegion: parsed.region,
      awsAccount: parsed.account,
      quiltCatalog: catalog,
      quiltDatabase: outputs.UserAthenaDatabaseName,
      quiltUserBucket: outputs.UserBucket || outputs.BucketName,
      queueArn: outputs.PackagerQueueArn,
      benchlingTenant: secret.tenant,
      benchlingClientId: secret.client_id,
      benchlingClientSecret: secret.client_secret,
      benchlingAppDefinitionId: secret.app_definition_id,
      benchlingApiUrl: secret.api_url,
      pkgPrefix: 'benchling',
      pkgKey: 'experiment_id',
      logLevel: 'INFO',
      enableWebhookVerification: true
    };

    this.cache = config;
    return config;
  }

  private validateRequiredOutputs(outputs: Record<string, string>): void {
    const required = [
      'UserAthenaDatabaseName',
      'PackagerQueueArn'
    ];

    // UserBucket or BucketName
    if (!outputs.UserBucket && !outputs.BucketName) {
      required.push('UserBucket or BucketName');
    }

    const missing = required.filter(key => !outputs[key]);

    if (missing.length > 0) {
      throw new ConfigResolverError(
        `Missing required CloudFormation outputs: ${missing.join(', ')}`,
        'Ensure your Quilt stack exports these outputs',
        `Available outputs: ${Object.keys(outputs).join(', ')}`
      );
    }
  }

  private async resolveCatalogUrl(
    outputs: Record<string, string>
  ): Promise<string> {
    // Option 1: Direct from output
    if (outputs.Catalog) {
      return this.normalizeCatalogUrl(outputs.Catalog);
    }

    if (outputs.CatalogDomain) {
      return this.normalizeCatalogUrl(outputs.CatalogDomain);
    }

    // Option 2: Extract from API Gateway endpoint
    if (outputs.ApiGatewayEndpoint) {
      const url = new URL(outputs.ApiGatewayEndpoint);
      return url.hostname;
    }

    throw new ConfigResolverError(
      'Cannot determine catalog URL',
      'Stack must export "Catalog", "CatalogDomain", or "ApiGatewayEndpoint"'
    );
  }

  private normalizeCatalogUrl(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  clearCache(): void {
    this.cache = null;
  }
}
```

**Tests**:
```typescript
describe('ConfigResolver', () => {
  const cfnMock = mockClient(CloudFormationClient);
  const smMock = mockClient(SecretsManagerClient);

  beforeEach(() => {
    cfnMock.reset();
    smMock.reset();
  });

  it('should resolve complete config', async () => {
    // Setup mocks...
    const resolver = new ConfigResolver();
    const config = await resolver.resolve({
      quiltStackArn: 'arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/abc',
      benchlingSecret: 'test-secret',
      mockCloudFormation: cfnMock as any,
      mockSecretsManager: smMock as any
    });

    expect(config.awsRegion).toBe('us-east-1');
    expect(config.quiltDatabase).toBeDefined();
    expect(config.benchlingClientId).toBeDefined();
  });

  it('should cache config', async () => {
    // First call
    const config1 = await resolver.resolve(options);
    // Second call should not hit AWS
    const config2 = await resolver.resolve(options);
    expect(config1).toBe(config2); // Same object
  });
});
```

**Checkpoint**: All Phase 1 tests pass

---

### Phase 2: Update Application Entry Point

**Goal**: Update the main application to use ConfigResolver

**Files to Modify**:
- `bin/benchling-webhook.ts` (or main app entry point)
- `lib/index.ts`

**Steps**:

#### Step 2.1: Add Config Loading Function

```typescript
// lib/utils/config-loader.ts

import { ConfigResolver, type ResolvedConfig } from './config-resolver';

/**
 * Load configuration for production (from AWS)
 */
export async function loadConfig(): Promise<ResolvedConfig> {
  const quiltStackArn = process.env.QuiltStackARN;
  const benchlingSecret = process.env.BenchlingSecret;

  if (!quiltStackArn || !benchlingSecret) {
    throw new Error(
      'Missing required environment variables: QuiltStackARN and BenchlingSecret\n' +
      'Example:\n' +
      '  QuiltStackARN=arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/abc\n' +
      '  BenchlingSecret=my-benchling-creds'
    );
  }

  const resolver = new ConfigResolver();
  return await resolver.resolve({
    quiltStackArn,
    benchlingSecret
  });
}

/**
 * Load configuration for testing (from env vars)
 */
export function loadConfigForTesting(): Partial<ResolvedConfig> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('loadConfigForTesting() should only be used in test environment');
  }

  return {
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    awsAccount: process.env.CDK_DEFAULT_ACCOUNT || '123456789012',
    quiltCatalog: process.env.QUILT_CATALOG || 'test.catalog.com',
    quiltDatabase: process.env.QUILT_DATABASE || 'test_db',
    quiltUserBucket: process.env.QUILT_USER_BUCKET || 'test-bucket',
    queueArn: process.env.QUEUE_ARN || 'arn:aws:sqs:us-east-1:123:test-queue',
    benchlingTenant: process.env.BENCHLING_TENANT || 'test',
    benchlingClientId: process.env.BENCHLING_CLIENT_ID || 'test-id',
    benchlingClientSecret: process.env.BENCHLING_CLIENT_SECRET || 'test-secret',
    benchlingAppDefinitionId: process.env.BENCHLING_APP_DEFINITION_ID
  };
}
```

#### Step 2.2: Update Main Application

```typescript
// bin/benchling-webhook.ts (or equivalent)

import { loadConfig } from '../lib/utils/config-loader';
import { ConfigResolverError } from '../lib/utils/config-resolver';

async function main() {
  try {
    console.log('Loading configuration from AWS...');
    const config = await loadConfig();

    console.log('✓ Configuration loaded successfully');
    console.log(`  Region: ${config.awsRegion}`);
    console.log(`  Catalog: ${config.quiltCatalog}`);
    console.log(`  Database: ${config.quiltDatabase}`);

    // Initialize application with config
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

main();
```

**Test**: Run application with correct env vars (manual test)

---

### Phase 3: Update CDK Stack

**Goal**: Simplify CDK stack to use only 2 parameters

**Files to Modify**:
- `lib/benchling-webhook-stack.ts`
- `bin/commands/deploy.ts`

**Steps**:

#### Step 3.1: Update CloudFormation Parameters

```typescript
// lib/benchling-webhook-stack.ts

// OLD: Remove all individual parameters
// const benchlingTenant = new CfnParameter(...);
// const benchlingClientId = new CfnParameter(...);
// ... many more

// NEW: Only 2 parameters
const quiltStackArn = new CfnParameter(this, 'QuiltStackARN', {
  type: 'String',
  description: 'ARN of the Quilt CloudFormation stack',
  allowedPattern: 'arn:aws:cloudformation:[a-z0-9-]+:\\d{12}:stack\/.+',
  constraintDescription: 'Must be a valid CloudFormation stack ARN'
});

const benchlingSecret = new CfnParameter(this, 'BenchlingSecret', {
  type: 'String',
  description: 'Name or ARN of Secrets Manager secret with Benchling credentials',
  minLength: 1
});
```

#### Step 3.2: Update ECS Task Definition

```typescript
// OLD: Many environment variables
// environment: {
//   QUILT_CATALOG: quiltCatalog.valueAsString,
//   QUILT_DATABASE: quiltDatabase.valueAsString,
//   ... many more
// }

// NEW: Only 2 environment variables
taskDefinition.addContainer('webhook', {
  image: containerImage,
  environment: {
    QuiltStackARN: quiltStackArn.valueAsString,
    BenchlingSecret: benchlingSecret.valueAsString
  },
  logging: LogDriver.awsLogs({ streamPrefix: 'benchling-webhook' }),
  // ... other config
});
```

#### Step 3.3: Update IAM Permissions

```typescript
// Add CloudFormation read permission
taskRole.addToPolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    'cloudformation:DescribeStacks',
    'cloudformation:DescribeStackResources',
    'cloudformation:DescribeStackEvents'
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
    `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${benchlingSecret.valueAsString}*`
  ]
}));
```

**Test**: `cdk synth` produces valid CloudFormation template

---

### Phase 4: Update CLI Deploy Command

**Goal**: Simplify deploy command to accept new parameters

**Files to Modify**:
- `bin/commands/deploy.ts`
- `lib/utils/config.ts` (or deprecate entirely)

**Steps**:

#### Step 4.1: Update CLI Options

```typescript
// bin/commands/deploy.ts

export interface DeployOptions {
  quiltStackArn?: string;
  benchlingSecret?: string;
  yes?: boolean;
  bootstrapCheck?: boolean;
  requireApproval?: string;
}

export async function deployCommand(options: DeployOptions): Promise<void> {
  console.log(boxen(chalk.bold('Benchling Webhook Deployment'), { ... }));

  // Load simplified config
  const quiltStackArn = options.quiltStackArn || process.env.QUILT_STACK_ARN;
  const benchlingSecret = options.benchlingSecret || process.env.BENCHLING_SECRET;

  if (!quiltStackArn) {
    console.error(chalk.red('Missing required parameter: --quilt-stack-arn'));
    console.log('Provide the ARN of your Quilt CloudFormation stack');
    process.exit(1);
  }

  if (!benchlingSecret) {
    console.error(chalk.red('Missing required parameter: --benchling-secret'));
    console.log('Provide the name or ARN of your Benchling secret in Secrets Manager');
    process.exit(1);
  }

  // Parse stack ARN to get region/account for CDK
  const parsed = parseStackArn(quiltStackArn);

  // Display deployment plan
  console.log(chalk.bold('Deployment Plan'));
  console.log(`  QuiltStackARN: ${quiltStackArn}`);
  console.log(`  BenchlingSecret: ${benchlingSecret}`);
  console.log(`  AWS Region: ${parsed.region}`);
  console.log(`  AWS Account: ${parsed.account}`);

  // Deploy with CDK
  const parameters = [
    `QuiltStackARN=${quiltStackArn}`,
    `BenchlingSecret=${benchlingSecret}`
  ].map(p => `--parameters ${p}`).join(' ');

  execSync(`npx cdk deploy --require-approval never ${parameters}`, {
    stdio: 'inherit',
    env: {
      ...process.env,
      CDK_DEFAULT_ACCOUNT: parsed.account,
      CDK_DEFAULT_REGION: parsed.region
    }
  });
}
```

#### Step 4.2: Update CLI Interface

```typescript
// bin/cli.ts

program
  .command('deploy')
  .description('Deploy Benchling webhook to AWS')
  .option('--quilt-stack-arn <arn>', 'ARN of Quilt CloudFormation stack')
  .option('--benchling-secret <name>', 'Name or ARN of Benchling secret in Secrets Manager')
  .option('--yes', 'Skip confirmation prompt')
  .action(async (options) => {
    await deployCommand(options);
  });
```

**Test**: CLI accepts new parameters, generates valid CDK command

---

### Phase 5: Add Health Check Endpoints

**Goal**: Add endpoints to display resolved configuration

**Files to Create/Modify**:
- `bin/server.ts` (or wherever Express app is defined)

**Steps**:

#### Step 5.1: Add /config Endpoint

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

#### Step 5.2: Update /health Endpoint

```typescript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    configSource: 'aws',
    timestamp: new Date().toISOString()
  });
});
```

**Test**: Endpoints return expected JSON

---

### Phase 6: Update Tests

**Goal**: Update all tests to work with new architecture

**Files to Modify**:
- All test files in `test/`

**Steps**:

#### Step 6.1: Update Config Loading in Tests

```typescript
// test/setup.ts (or similar)

import { loadConfigForTesting } from '../lib/utils/config-loader';

// Set test environment
process.env.NODE_ENV = 'test';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-cloudformation');
jest.mock('@aws-sdk/client-secrets-manager');

// Provide default config for all tests
beforeAll(() => {
  const config = loadConfigForTesting();
  // Make available globally or inject as needed
});
```

#### Step 6.2: Update Individual Tests

Update tests that rely on config to use mocked AWS clients or `loadConfigForTesting()`.

**Test**: All existing tests pass with new config approach

---

### Phase 7: Documentation

**Goal**: Update all documentation

**Files to Create/Modify**:
- `README.md`
- `docs/deployment.md`
- `docs/local-docker-testing.md` (new)
- `docs/migration-guide.md` (new)

**Steps**:

#### Step 7.1: Update README

Update quick start section with new 2-parameter approach.

#### Step 7.2: Create Local Docker Testing Guide

Document the process described in `04-testing-strategy.md`.

#### Step 7.3: Create Migration Guide

Document how to migrate from old to new approach:
1. Create secret in Secrets Manager
2. Get Quilt stack ARN
3. Deploy with new parameters
4. Update CI/CD pipelines

**Test**: Documentation is clear and complete

---

## Implementation Checklist

- [ ] Phase 1: ConfigResolver implementation complete
- [ ] Phase 1: All unit tests pass
- [ ] Phase 2: Application entry point updated
- [ ] Phase 2: Application starts with 2 env vars
- [ ] Phase 3: CDK stack simplified
- [ ] Phase 3: `cdk synth` succeeds
- [ ] Phase 4: CLI deploy command updated
- [ ] Phase 4: CLI accepts new parameters
- [ ] Phase 5: Health check endpoints added
- [ ] Phase 5: Endpoints return expected data
- [ ] Phase 6: All tests updated and passing
- [ ] Phase 7: Documentation updated
- [ ] Phase 7: Migration guide complete

## Testing Checklist (Post-Implementation)

- [ ] Unit tests pass: `npm test`
- [ ] TypeScript compiles: `npm run build`
- [ ] CDK synth works: `cdk synth`
- [ ] Docker image builds: `docker build -t test .`
- [ ] Create test secret in Secrets Manager
- [ ] Run Docker container with 2 env vars
- [ ] Container resolves config successfully
- [ ] `/health` endpoint returns success
- [ ] `/config` endpoint shows resolved config
- [ ] Test invalid QuiltStackARN (error handling)
- [ ] Test invalid BenchlingSecret (error handling)
- [ ] Test missing stack outputs (error handling)

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking existing deployments | Clear migration guide, major version bump |
| Slower container startup | Acceptable tradeoff, implement caching |
| CloudFormation API rate limits | Cache results, single call at startup |
| Complex error debugging | Detailed error messages, `/config` endpoint |
| Testing AWS integration | Provide test stack CloudFormation template |

## Rollback Plan

If implementation fails:
1. Revert to previous commit
2. Keep new code in feature branch
3. Address issues before re-attempting
4. Consider gradual rollout (feature flag)

## Success Criteria

Implementation is complete when:

✅ Container accepts only `QuiltStackARN` and `BenchlingSecret`
✅ All configuration derived from AWS
✅ All tests pass
✅ Docker container runs locally with manual AWS setup
✅ Documentation is complete
✅ Migration guide is available

## Next Steps

1. Review this implementation plan
2. Create feature branch: `git checkout -b feat/secrets-only-architecture`
3. Implement Phase 1 (ConfigResolver)
4. Implement Phase 2 (Application entry point)
5. Continue through phases sequentially
6. Test thoroughly at each phase
7. Create PR with complete implementation
