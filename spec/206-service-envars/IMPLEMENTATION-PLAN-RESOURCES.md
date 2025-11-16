# Implementation Plan: Stack Resource Discovery Enhancement

**Issue**: #206 - Service environment variables
**Branch**: `merge-main-into-206`
**Date**: 2025-11-16
**Status**: READY FOR IMPLEMENTATION

## Executive Summary

Enhance stack inference to discover additional AWS resources from Quilt CloudFormation stacks:
- **UserAthenaNonManagedRoleWorkgroup** (Athena Workgroup)
- **IcebergWorkGroup** (Athena Workgroup)
- **IcebergDatabase** (Glue Database)

These resources should be:
1. Discovered during stack query (deployment time)
2. Stored in configuration
3. Displayed in setup wizard
4. Shown in status command
5. Validated with integration tests using live AWS calls

## Current Architecture Analysis

### Stack Inference Flow

```
Setup Wizard (Phase 2: Stack Query)
  ↓
inferQuiltConfig() → findQuiltStacks() → DescribeStacksCommand
  ↓
Extract stack.Outputs[] (NOT stack.Resources[])
  ↓
Store in StackQueryResult
  ↓
Save to ProfileConfig
  ↓
Display in wizard & status command
```

### Key Distinction: Outputs vs Resources

**Current Implementation (Outputs)**:
```typescript
// From lib/utils/service-resolver.ts
const outputs = stack.Outputs || [];
for (const output of outputs) {
  if (output.OutputKey === "PackagerQueueUrl") {
    services.packagerQueueUrl = output.OutputValue;
  }
}
```

**What We Need (Resources)**:
```typescript
// NEW: Query stack resources, not outputs
const resourcesCommand = new DescribeStackResourcesCommand({
  StackName: stackArn
});
const resourcesResponse = await client.send(resourcesCommand);

for (const resource of resourcesResponse.StackResources || []) {
  if (resource.LogicalResourceId === "UserAthenaNonManagedRoleWorkgroup") {
    // Extract PhysicalResourceId (the actual workgroup name)
  }
}
```

### Current Stack Query Components

#### 1. Stack Query Phase (`lib/wizard/phase2-stack-query.ts`)
- Calls `inferQuiltConfig()` with catalogDns
- Returns `StackQueryResult` with discovered data
- Currently extracts: stackArn, database, queueUrl, region, account, benchlingSecretArn

#### 2. Stack Inference (`bin/commands/infer-quilt-config.ts`)
- Searches CloudFormation stacks by QuiltWebHost output
- Extracts outputs AND parameters
- Returns inference result with all discovered data

#### 3. Service Resolver (`lib/utils/service-resolver.ts`)
- Deployment-time service resolution
- Queries stack outputs for: PackagerQueueUrl, UserAthenaDatabaseName, QuiltWebHost, IcebergDatabase
- **Does NOT query stack resources**

#### 4. Configuration Types (`lib/types/config.ts`)
- `ProfileConfig.quilt` contains discovered values
- Currently has: catalog, database, queueUrl, region, icebergDatabase
- Missing: workgroup information

#### 5. Status Command (`bin/commands/status.ts`)
- Displays configuration and deployment info
- Shows outputs from CloudFormation stack
- Uses `DescribeStacksCommand` (outputs only, not resources)

### Current Test Structure

```
test/
├── unit/                           # Unit tests with mocks
│   ├── lib/
│   │   └── utils/
│   │       └── service-resolver.test.ts
│   └── bin/
│       └── commands/
│           └── infer-quilt-config.test.ts
├── integration/                    # Integration tests (currently empty)
└── __mocks__/                      # Mock implementations
```

**Key Finding**: No existing integration tests with live AWS calls!

## Implementation Plan

### Phase 1: Type System Updates

#### Files to Modify:
1. `/Users/ernest/GitHub/benchling-webhook/lib/types/config.ts`
2. `/Users/ernest/GitHub/benchling-webhook/lib/wizard/types.ts`

#### Changes Required:

**`lib/types/config.ts`** - Add to `QuiltConfig`:
```typescript
export interface QuiltConfig {
    // ... existing fields ...

    /**
     * Athena workgroup for user queries (non-managed role)
     *
     * Resolved from UserAthenaNonManagedRoleWorkgroup stack resource
     * This is a RESOURCE (not an output) - requires DescribeStackResources API
     *
     * @example "quilt-user-workgroup-prod"
     */
    athenaUserWorkgroup?: string;

    /**
     * Athena workgroup for Iceberg queries
     *
     * Resolved from IcebergWorkGroup stack resource
     * This is a RESOURCE (not an output) - requires DescribeStackResources API
     *
     * @example "quilt-iceberg-workgroup-prod"
     */
    athenaIcebergWorkgroup?: string;

    /**
     * Iceberg database name
     *
     * Already exists, but now resolved from IcebergDatabase stack resource
     * Previously only from outputs, now also from resources
     *
     * @example "quilt_iceberg_db"
     */
    icebergDatabase?: string;  // Already exists, but document new source
}
```

**`lib/wizard/types.ts`** - Add to `StackQueryResult`:
```typescript
export interface StackQueryResult {
    // ... existing fields ...

    /** Athena workgroup for user queries (optional) */
    athenaUserWorkgroup?: string;

    /** Athena workgroup for Iceberg queries (optional) */
    athenaIcebergWorkgroup?: string;

    /** Iceberg database name - now from both outputs and resources */
    icebergDatabase?: string;  // Already exists
}
```

### Phase 2: Stack Resource Discovery

#### Files to Modify:
1. `/Users/ernest/GitHub/benchling-webhook/lib/utils/stack-inference.ts`
2. `/Users/ernest/GitHub/benchling-webhook/bin/commands/infer-quilt-config.ts`

#### New Utility Function

**`lib/utils/stack-inference.ts`** - Add resource discovery:
```typescript
import {
    DescribeStackResourcesCommand,
    StackResource
} from "@aws-sdk/client-cloudformation";

/**
 * Get stack resources (physical resource IDs)
 *
 * Unlike outputs (which are user-defined exports), resources are the actual
 * AWS resources created by the stack.
 *
 * @param region AWS region
 * @param stackName CloudFormation stack name
 * @returns Stack resources with logical and physical IDs
 */
export interface StackResourceMap {
    [logicalId: string]: {
        physicalResourceId: string;
        resourceType: string;
        resourceStatus: string;
    };
}

export async function getStackResources(
    region: string,
    stackName: string,
    awsProvider?: IAwsProvider
): Promise<StackResourceMap> {
    const provider = awsProvider || new ExecSyncAwsProvider();

    try {
        const client = new CloudFormationClient({ region });
        const command = new DescribeStackResourcesCommand({
            StackName: stackName
        });
        const response = await client.send(command);

        const resourceMap: StackResourceMap = {};

        for (const resource of response.StackResources || []) {
            if (resource.LogicalResourceId && resource.PhysicalResourceId) {
                resourceMap[resource.LogicalResourceId] = {
                    physicalResourceId: resource.PhysicalResourceId,
                    resourceType: resource.ResourceType || "Unknown",
                    resourceStatus: resource.ResourceStatus || "Unknown"
                };
            }
        }

        return resourceMap;
    } catch (error) {
        console.error(
            `Warning: Could not get stack resources: ${(error as Error).message}`
        );
        return {};
    }
}

/**
 * Extract Athena workgroups and Glue databases from stack resources
 *
 * Target resources:
 * - UserAthenaNonManagedRoleWorkgroup (AWS::Athena::WorkGroup)
 * - IcebergWorkGroup (AWS::Athena::WorkGroup)
 * - IcebergDatabase (AWS::Glue::Database)
 */
export interface DiscoveredQuiltResources {
    athenaUserWorkgroup?: string;
    athenaIcebergWorkgroup?: string;
    icebergDatabase?: string;
}

export function extractQuiltResources(
    resources: StackResourceMap
): DiscoveredQuiltResources {
    const discovered: DiscoveredQuiltResources = {};

    // Extract UserAthenaNonManagedRoleWorkgroup
    if (resources.UserAthenaNonManagedRoleWorkgroup) {
        discovered.athenaUserWorkgroup =
            resources.UserAthenaNonManagedRoleWorkgroup.physicalResourceId;
    }

    // Extract IcebergWorkGroup
    if (resources.IcebergWorkGroup) {
        discovered.athenaIcebergWorkgroup =
            resources.IcebergWorkGroup.physicalResourceId;
    }

    // Extract IcebergDatabase
    if (resources.IcebergDatabase) {
        discovered.icebergDatabase =
            resources.IcebergDatabase.physicalResourceId;
    }

    return discovered;
}
```

#### Update Stack Inference

**`bin/commands/infer-quilt-config.ts`** - Extract resources:
```typescript
// In findQuiltStacks() function, after extracting outputs:

interface QuiltStackInfo {
    // ... existing fields ...
    athenaUserWorkgroup?: string;
    athenaIcebergWorkgroup?: string;
    icebergDatabase?: string;  // Can come from outputs OR resources
}

// After extracting outputs (line ~173):
for (const output of outputs) {
    // ... existing output extraction ...
}

// NEW: Query stack resources
try {
    const resources = await getStackResources(region, stack.StackName);
    const discovered = extractQuiltResources(resources);

    // Add discovered resources to stackInfo
    if (discovered.athenaUserWorkgroup) {
        stackInfo.athenaUserWorkgroup = discovered.athenaUserWorkgroup;
    }
    if (discovered.athenaIcebergWorkgroup) {
        stackInfo.athenaIcebergWorkgroup = discovered.athenaIcebergWorkgroup;
    }
    // Prefer resource over output for IcebergDatabase
    if (discovered.icebergDatabase) {
        stackInfo.icebergDatabase = discovered.icebergDatabase;
    }
} catch (error) {
    // Resource discovery is best-effort, don't fail stack inference
    console.error(`Warning: Could not discover stack resources: ${(error as Error).message}`);
}

// Add to inference result (line ~455):
if (selectedStack.athenaUserWorkgroup) {
    result.athenaUserWorkgroup = selectedStack.athenaUserWorkgroup;
}
if (selectedStack.athenaIcebergWorkgroup) {
    result.athenaIcebergWorkgroup = selectedStack.athenaIcebergWorkgroup;
}
// icebergDatabase already handled, ensure resource takes precedence
```

### Phase 3: Setup Wizard Display

#### Files to Modify:
1. `/Users/ernest/GitHub/benchling-webhook/lib/wizard/phase2-stack-query.ts`

#### Changes Required:

**Display discovered resources** (after line 98):
```typescript
console.log(chalk.dim(`Region: ${region}`));
console.log(chalk.dim(`Account: ${account}`));

// NEW: Display discovered Athena workgroups
if (athenaUserWorkgroup) {
    console.log(chalk.dim(`Athena User Workgroup: ${athenaUserWorkgroup}`));
}
if (athenaIcebergWorkgroup) {
    console.log(chalk.dim(`Athena Iceberg Workgroup: ${athenaIcebergWorkgroup}`));
}

if (benchlingSecretArn) {
    // ... existing code ...
}
```

**Update return value** (after line 100):
```typescript
return {
    stackArn,
    catalog: normalizedConfirmed,
    database,
    queueUrl,
    region,
    account,
    benchlingSecretArn,
    benchlingIntegrationEnabled,
    athenaUserWorkgroup,      // NEW
    athenaIcebergWorkgroup,   // NEW
    icebergDatabase,          // Already exists, but ensure it's returned
    stackQuerySucceeded: true,
};
```

### Phase 4: Status Command Display

#### Files to Modify:
1. `/Users/ernest/GitHub/benchling-webhook/bin/commands/status.ts`

#### Changes Required:

**Add to StatusResult interface** (line ~44):
```typescript
export interface StatusResult {
    // ... existing fields ...

    /** Discovered Quilt stack resources */
    quiltResources?: {
        athenaUserWorkgroup?: string;
        athenaIcebergWorkgroup?: string;
        icebergDatabase?: string;
    };
}
```

**Query resources in getStackStatus** (after line 147):
```typescript
// Extract stack outputs
const outputs = stack.Outputs || [];
const stackOutputs = {
    // ... existing outputs ...
};

// NEW: Query stack resources
let quiltResources: StatusResult["quiltResources"];
try {
    const resourcesCommand = new DescribeStackResourcesCommand({
        StackName: stackName
    });
    const resourcesResponse = await client.send(resourcesCommand);
    const resourceMap: Record<string, string> = {};

    for (const resource of resourcesResponse.StackResources || []) {
        if (resource.LogicalResourceId && resource.PhysicalResourceId) {
            resourceMap[resource.LogicalResourceId] = resource.PhysicalResourceId;
        }
    }

    quiltResources = {
        athenaUserWorkgroup: resourceMap.UserAthenaNonManagedRoleWorkgroup,
        athenaIcebergWorkgroup: resourceMap.IcebergWorkGroup,
        icebergDatabase: resourceMap.IcebergDatabase
    };
} catch (error) {
    // Resource query is optional, don't fail status command
    console.error(chalk.dim(`  Could not retrieve stack resources: ${(error as Error).message}`));
}

return {
    success: true,
    stackStatus: stack.StackStatus,
    benchlingIntegrationEnabled,
    lastUpdateTime: stack.LastUpdatedTime?.toISOString() || stack.CreationTime?.toISOString(),
    stackArn,
    region,
    stackOutputs,
    quiltResources,  // NEW
};
```

**Display resources in displayStatusResult** (after line 668):
```typescript
// After displaying log groups
if (result.stackOutputs?.ecsLogGroup || result.stackOutputs?.apiGatewayLogGroup) {
    // ... existing log group display ...
}

console.log("");

// NEW: Display Quilt stack resources
if (result.quiltResources) {
    const hasAnyResource =
        result.quiltResources.athenaUserWorkgroup ||
        result.quiltResources.athenaIcebergWorkgroup ||
        result.quiltResources.icebergDatabase;

    if (hasAnyResource) {
        console.log(chalk.bold("Quilt Stack Resources:"));

        if (result.quiltResources.athenaUserWorkgroup) {
            console.log(`  ${chalk.cyan("User Workgroup:")} ${chalk.dim(result.quiltResources.athenaUserWorkgroup)}`);
        }
        if (result.quiltResources.athenaIcebergWorkgroup) {
            console.log(`  ${chalk.cyan("Iceberg Workgroup:")} ${chalk.dim(result.quiltResources.athenaIcebergWorkgroup)}`);
        }
        if (result.quiltResources.icebergDatabase) {
            console.log(`  ${chalk.cyan("Iceberg Database:")} ${chalk.dim(result.quiltResources.icebergDatabase)}`);
        }

        console.log("");
    }
}

// Display listener rules
if (result.listenerRules && result.listenerRules.length > 0) {
    // ... existing code ...
}
```

### Phase 5: Integration Tests with Live AWS

#### Files to Create:
1. `/Users/ernest/GitHub/benchling-webhook/test/integration/stack-resource-discovery.test.ts`
2. `/Users/ernest/GitHub/benchling-webhook/test/integration/README.md`

#### Test Configuration

**`test/integration/README.md`**:
```markdown
# Integration Tests

Integration tests make LIVE AWS API calls and require:

1. AWS credentials configured (via `~/.aws/credentials` or environment variables)
2. A deployed Quilt CloudFormation stack to test against
3. Configuration profile with stackArn

## Running Integration Tests

```bash
# Run all integration tests
npm run test:integration

# Run specific test file
npm run test:integration -- stack-resource-discovery.test.ts

# Run with verbose output
npm run test:integration -- --verbose
```

## Test Configuration

Integration tests use configuration from:
- **Profile**: `~/.config/benchling-webhook/default/config.json` (XDG default)
- **Stack ARN**: Read from profile's `quilt.stackArn`
- **AWS Credentials**: Standard AWS SDK credential resolution

## Safety

Integration tests:
- Only make READ operations (DescribeStacks, DescribeStackResources)
- Do NOT create, update, or delete any AWS resources
- Can be safely run against production stacks

## Example Configuration

`~/.config/benchling-webhook/default/config.json`:
```json
{
  "quilt": {
    "stackArn": "arn:aws:cloudformation:us-east-2:123456789012:stack/tf-dev-bench/...",
    "catalog": "dev.quiltdata.com",
    "region": "us-east-2"
  },
  // ... other config ...
}
```
```

#### Test Implementation

**`test/integration/stack-resource-discovery.test.ts`**:
```typescript
/**
 * Integration tests for stack resource discovery
 *
 * These tests make LIVE AWS API calls to verify resource discovery works
 * against a real Quilt CloudFormation stack.
 *
 * Requirements:
 * - AWS credentials configured
 * - Quilt stack deployed
 * - Profile configured with stackArn
 */

import { XDGConfig } from "../../lib/xdg-config";
import { getStackResources, extractQuiltResources } from "../../lib/utils/stack-inference";
import { resolveQuiltServices } from "../../lib/utils/service-resolver";
import {
    CloudFormationClient,
    DescribeStacksCommand,
    DescribeStackResourcesCommand
} from "@aws-sdk/client-cloudformation";

describe("Stack Resource Discovery - Integration", () => {
    let stackArn: string;
    let region: string;
    let stackName: string;

    beforeAll(() => {
        // Load configuration from XDG default profile
        const xdg = new XDGConfig();

        try {
            const config = xdg.readProfile("default");

            if (!config.quilt.stackArn) {
                throw new Error(
                    "No stackArn found in default profile. " +
                    "Run: npm run setup"
                );
            }

            stackArn = config.quilt.stackArn;
            region = config.deployment.region;

            // Extract stack name from ARN
            const match = stackArn.match(/stack\/([^/]+)\//);
            if (!match) {
                throw new Error(`Invalid stack ARN: ${stackArn}`);
            }
            stackName = match[1];

            console.log(`\n  Using stack: ${stackName} (${region})\n`);
        } catch (error) {
            throw new Error(
                `Failed to load configuration: ${(error as Error).message}\n\n` +
                "Setup required:\n" +
                "  1. Run: npm run setup\n" +
                "  2. Ensure AWS credentials are configured\n" +
                "  3. Verify Quilt stack is deployed\n"
            );
        }
    });

    describe("getStackResources()", () => {
        it("should discover stack resources", async () => {
            const resources = await getStackResources(region, stackName);

            // Should return an object
            expect(resources).toBeDefined();
            expect(typeof resources).toBe("object");

            // Should have at least some resources
            const resourceCount = Object.keys(resources).length;
            expect(resourceCount).toBeGreaterThan(0);

            console.log(`    Discovered ${resourceCount} stack resources`);
        });

        it("should include resource metadata", async () => {
            const resources = await getStackResources(region, stackName);

            // Check structure of first resource
            const firstResource = Object.values(resources)[0];

            if (firstResource) {
                expect(firstResource).toHaveProperty("physicalResourceId");
                expect(firstResource).toHaveProperty("resourceType");
                expect(firstResource).toHaveProperty("resourceStatus");

                expect(typeof firstResource.physicalResourceId).toBe("string");
                expect(firstResource.physicalResourceId.length).toBeGreaterThan(0);
            }
        });
    });

    describe("extractQuiltResources()", () => {
        let resources: Awaited<ReturnType<typeof getStackResources>>;

        beforeAll(async () => {
            resources = await getStackResources(region, stackName);
        });

        it("should extract Athena workgroups if present", () => {
            const discovered = extractQuiltResources(resources);

            // Log what was found
            if (discovered.athenaUserWorkgroup) {
                console.log(`    Found User Workgroup: ${discovered.athenaUserWorkgroup}`);
            }
            if (discovered.athenaIcebergWorkgroup) {
                console.log(`    Found Iceberg Workgroup: ${discovered.athenaIcebergWorkgroup}`);
            }

            // If workgroups exist, they should be non-empty strings
            if (discovered.athenaUserWorkgroup) {
                expect(typeof discovered.athenaUserWorkgroup).toBe("string");
                expect(discovered.athenaUserWorkgroup.length).toBeGreaterThan(0);
            }

            if (discovered.athenaIcebergWorkgroup) {
                expect(typeof discovered.athenaIcebergWorkgroup).toBe("string");
                expect(discovered.athenaIcebergWorkgroup.length).toBeGreaterThan(0);
            }
        });

        it("should extract Iceberg database if present", () => {
            const discovered = extractQuiltResources(resources);

            if (discovered.icebergDatabase) {
                console.log(`    Found Iceberg Database: ${discovered.icebergDatabase}`);
                expect(typeof discovered.icebergDatabase).toBe("string");
                expect(discovered.icebergDatabase.length).toBeGreaterThan(0);
            }
        });

        it("should handle missing resources gracefully", () => {
            // Test with empty resource map
            const discovered = extractQuiltResources({});

            expect(discovered).toBeDefined();
            expect(discovered.athenaUserWorkgroup).toBeUndefined();
            expect(discovered.athenaIcebergWorkgroup).toBeUndefined();
            expect(discovered.icebergDatabase).toBeUndefined();
        });
    });

    describe("Live CloudFormation API", () => {
        it("should query stack resources directly", async () => {
            const client = new CloudFormationClient({ region });
            const command = new DescribeStackResourcesCommand({
                StackName: stackName
            });

            const response = await client.send(command);

            expect(response.StackResources).toBeDefined();
            expect(Array.isArray(response.StackResources)).toBe(true);
            expect(response.StackResources!.length).toBeGreaterThan(0);

            // Check for target resources
            const resourceIds = response.StackResources!
                .map(r => r.LogicalResourceId)
                .filter((id): id is string => !!id);

            console.log(`    Total resources: ${resourceIds.length}`);

            // Look for our target resources
            const hasUserWorkgroup = resourceIds.includes("UserAthenaNonManagedRoleWorkgroup");
            const hasIcebergWorkgroup = resourceIds.includes("IcebergWorkGroup");
            const hasIcebergDatabase = resourceIds.includes("IcebergDatabase");

            console.log(`    UserAthenaNonManagedRoleWorkgroup: ${hasUserWorkgroup ? "✓" : "✗"}`);
            console.log(`    IcebergWorkGroup: ${hasIcebergWorkgroup ? "✓" : "✗"}`);
            console.log(`    IcebergDatabase: ${hasIcebergDatabase ? "✓" : "✗"}`);
        });

        it("should resolve services and resources together", async () => {
            // Test that outputs (services) and resources work together
            const services = await resolveQuiltServices({ stackArn });
            const resources = await getStackResources(region, stackName);
            const discovered = extractQuiltResources(resources);

            // Verify we have both outputs and resources
            expect(services.packagerQueueUrl).toBeDefined();
            expect(services.athenaUserDatabase).toBeDefined();
            expect(services.quiltWebHost).toBeDefined();

            console.log("\n    Services (from outputs):");
            console.log(`      Queue: ${services.packagerQueueUrl}`);
            console.log(`      Database: ${services.athenaUserDatabase}`);
            console.log(`      Catalog: ${services.quiltWebHost}`);

            console.log("\n    Resources (from stack):");
            if (discovered.athenaUserWorkgroup) {
                console.log(`      User Workgroup: ${discovered.athenaUserWorkgroup}`);
            }
            if (discovered.athenaIcebergWorkgroup) {
                console.log(`      Iceberg Workgroup: ${discovered.athenaIcebergWorkgroup}`);
            }
            if (discovered.icebergDatabase) {
                console.log(`      Iceberg Database: ${discovered.icebergDatabase}`);
            }
        });
    });

    describe("End-to-End Resource Discovery", () => {
        it("should discover all resources in one call", async () => {
            // Simulate what setup wizard does
            const resources = await getStackResources(region, stackName);
            const discovered = extractQuiltResources(resources);

            // Should not throw
            expect(discovered).toBeDefined();

            // Count what was discovered
            let discoveredCount = 0;
            if (discovered.athenaUserWorkgroup) discoveredCount++;
            if (discovered.athenaIcebergWorkgroup) discoveredCount++;
            if (discovered.icebergDatabase) discoveredCount++;

            console.log(`    Discovered ${discoveredCount}/3 target resources`);

            // At least one resource should be found (depends on stack configuration)
            // This is informational, not a hard requirement
            if (discoveredCount === 0) {
                console.log("    ⚠️  No target resources found in this stack");
                console.log("    This may be expected for older Quilt stack versions");
            }
        });
    });
});
```

#### Package.json Test Scripts

**Add to `package.json`**:
```json
{
  "scripts": {
    "test:integration": "cross-env NODE_ENV=test jest --testMatch='**/test/integration/**/*.test.ts' --runInBand",
    "test:integration:verbose": "npm run test:integration -- --verbose"
  }
}
```

#### Jest Configuration

**Ensure `jest.config.js` includes integration tests**:
```javascript
module.exports = {
  // ... existing config ...
  testMatch: [
    '**/test/**/*.test.ts',
    '**/test/integration/**/*.test.ts'  // Include integration tests
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/cdk.out/'
  ]
};
```

### Phase 6: Configuration Persistence

#### Files to Modify:
1. `/Users/ernest/GitHub/benchling-webhook/lib/wizard/phase6-integrated-mode.ts`
2. `/Users/ernest/GitHub/benchling-webhook/lib/wizard/phase7-standalone-mode.ts`

#### Changes Required:

**Update config creation** (in both files):
```typescript
// Build final configuration
const finalConfig: ProfileConfig = {
    quilt: {
        stackArn: stackQuery.stackArn,
        catalog: `https://${catalogDns}`,
        database: stackQuery.database,
        queueUrl: stackQuery.queueUrl,
        region: stackQuery.region,
        icebergDatabase: stackQuery.icebergDatabase,
        // NEW: Add discovered workgroups
        athenaUserWorkgroup: stackQuery.athenaUserWorkgroup,
        athenaIcebergWorkgroup: stackQuery.athenaIcebergWorkgroup,
    },
    // ... rest of config ...
};
```

## Task Breakdown for TypeScript Agent

### Task 1: Type System Foundation
**Estimated Effort**: 1 hour

**Files**:
- `/Users/ernest/GitHub/benchling-webhook/lib/types/config.ts`
- `/Users/ernest/GitHub/benchling-webhook/lib/wizard/types.ts`

**Requirements**:
1. Add `athenaUserWorkgroup` and `athenaIcebergWorkgroup` to `QuiltConfig` interface
2. Add same fields to `StackQueryResult` interface
3. Update JSDoc comments to document these are resources (not outputs)
4. Ensure TypeScript compilation passes

**Acceptance Criteria**:
- ✅ `npm run build:typecheck` passes
- ✅ Fields are optional (marked with `?`)
- ✅ JSDoc comments explain resource vs output distinction

### Task 2: Stack Resource Discovery Utilities
**Estimated Effort**: 3 hours

**Files**:
- `/Users/ernest/GitHub/benchling-webhook/lib/utils/stack-inference.ts`

**Requirements**:
1. Implement `getStackResources()` function using `DescribeStackResourcesCommand`
2. Implement `extractQuiltResources()` to find target resources by LogicalResourceId
3. Add proper error handling (resources are optional, don't fail stack inference)
4. Add TypeScript interfaces for return types

**Acceptance Criteria**:
- ✅ Functions compile without errors
- ✅ Return types are properly typed
- ✅ Error handling allows graceful degradation

### Task 3: Integrate Resource Discovery into Stack Inference
**Estimated Effort**: 2 hours

**Files**:
- `/Users/ernest/GitHub/benchling-webhook/bin/commands/infer-quilt-config.ts`

**Requirements**:
1. Call `getStackResources()` after extracting outputs
2. Call `extractQuiltResources()` to find workgroups and database
3. Add discovered resources to `QuiltStackInfo`
4. Add to inference result return value
5. Handle errors gracefully (log warnings, don't fail)

**Acceptance Criteria**:
- ✅ Resources are discovered when present
- ✅ Inference continues if resource query fails
- ✅ Resources are returned in inference result

### Task 4: Update Setup Wizard Display
**Estimated Effort**: 1 hour

**Files**:
- `/Users/ernest/GitHub/benchling-webhook/lib/wizard/phase2-stack-query.ts`

**Requirements**:
1. Display discovered workgroups in console output
2. Update return value to include new fields
3. Use `chalk.dim()` for consistent styling

**Acceptance Criteria**:
- ✅ Workgroups are displayed when present
- ✅ Fields are included in return value
- ✅ Display matches existing output style

### Task 5: Update Status Command
**Estimated Effort**: 2 hours

**Files**:
- `/Users/ernest/GitHub/benchling-webhook/bin/commands/status.ts`

**Requirements**:
1. Query stack resources in `getStackStatus()`
2. Add `quiltResources` to `StatusResult`
3. Display resources in `displayStatusResult()`
4. Handle errors gracefully (resource query is optional)

**Acceptance Criteria**:
- ✅ Resources are queried when status command runs
- ✅ Resources are displayed in dedicated section
- ✅ Command continues if resource query fails

### Task 6: Configuration Persistence
**Estimated Effort**: 1 hour

**Files**:
- `/Users/ernest/GitHub/benchling-webhook/lib/wizard/phase6-integrated-mode.ts`
- `/Users/ernest/GitHub/benchling-webhook/lib/wizard/phase7-standalone-mode.ts`

**Requirements**:
1. Include discovered workgroups in saved configuration
2. Ensure fields are populated from `StackQueryResult`

**Acceptance Criteria**:
- ✅ Workgroups saved to config.json
- ✅ Fields are optional (only saved if present)

### Task 7: Integration Tests
**Estimated Effort**: 4 hours

**Files**:
- `/Users/ernest/GitHub/benchling-webhook/test/integration/stack-resource-discovery.test.ts`
- `/Users/ernest/GitHub/benchling-webhook/test/integration/README.md`
- `/Users/ernest/GitHub/benchling-webhook/package.json`

**Requirements**:
1. Create integration test file with live AWS calls
2. Load config from XDG default profile
3. Test `getStackResources()` with real stack
4. Test `extractQuiltResources()` with real data
5. Test end-to-end discovery flow
6. Add test script to package.json
7. Document test setup in README

**Acceptance Criteria**:
- ✅ Tests run against live AWS (read-only operations)
- ✅ Tests load config from `~/.config/benchling-webhook/default/`
- ✅ Tests verify all three target resources
- ✅ `npm run test:integration` executes tests
- ✅ README documents setup requirements

## Implementation Order

1. **Task 1**: Type system (foundation for everything else)
2. **Task 2**: Resource discovery utilities (core functionality)
3. **Task 3**: Stack inference integration (wire up utilities)
4. **Task 4**: Setup wizard display (user-visible)
5. **Task 6**: Configuration persistence (save discovered values)
6. **Task 5**: Status command (separate feature, can be parallel)
7. **Task 7**: Integration tests (validation, can be done incrementally)

## Testing Strategy

### Unit Tests
- Mock CloudFormation responses
- Test resource extraction logic
- Test error handling

### Integration Tests
- **LIVE AWS calls** to real Quilt stack
- Read-only operations (safe for production)
- Load config from XDG profile
- Verify discovery of all three resources

### Manual Testing
```bash
# Setup wizard should show discovered resources
npm run setup

# Status command should display resources
npm run status -- --profile default

# Verify config contains resources
cat ~/.config/benchling-webhook/default/config.json | jq '.quilt'
```

## Success Criteria

### Functional Requirements
- ✅ Discovers UserAthenaNonManagedRoleWorkgroup from stack resources
- ✅ Discovers IcebergWorkGroup from stack resources
- ✅ Discovers IcebergDatabase from stack resources
- ✅ Shows resources in setup wizard output
- ✅ Shows resources in status command output
- ✅ Saves resources to profile configuration
- ✅ Handles missing resources gracefully (no errors)

### Testing Requirements
- ✅ Integration tests make LIVE AWS calls
- ✅ Tests load config from XDG default profile
- ✅ Tests verify all three target resources
- ✅ Tests handle missing resources gracefully

### Documentation Requirements
- ✅ README explains resource vs output distinction
- ✅ JSDoc comments document new fields
- ✅ Integration test README documents setup

## Risk Mitigation

### Risk: Resource Names Change
**Mitigation**: Log warnings if resources not found, don't fail

### Risk: API Permission Errors
**Mitigation**: Catch errors, log warnings, continue setup

### Risk: Performance Impact
**Mitigation**: Resource query is fast (same as outputs), no impact

### Risk: Test Configuration Required
**Mitigation**: Clear README with setup instructions, fail-fast with helpful error

## Next Steps

1. Review this plan with team
2. Assign tasks to TypeScript specialist agent
3. Execute tasks in order
4. Run integration tests against real Quilt stack
5. Update documentation
6. Create PR with all changes

## Related Specifications

- **09-athena-workgroup-envar.md**: Uses TabulatorOpenQueryWorkGroup output (different from these resources)
- This plan focuses on discovering resources (not outputs) from Quilt stack
- Workgroups discovered here are stored in config but not currently used by application
- Future work may connect discovered workgroups to environment variables

---

**Total Estimated Effort**: 14 hours
**Complexity**: Medium (new API calls, but well-defined scope)
**Risk Level**: Low (read-only operations, graceful degradation)
